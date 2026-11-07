import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld, GROUP_PLAYER } from './PhysicsWorld.js';

const ROAD_HALF = 5.9;      // playable half-width (neon rails beyond)
const RADIUS = 0.85;        // physics sphere radius
const JUMP_VELOCITY = 13.8;
const LATERAL_SPEED = 11.5;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.14;

/**
 * Player — the Cosmic Banana
 * --------------------------
 * A physics sphere drives the motion; the banana mesh tumbles, banks and
 * squashes on top of it. Handles steering, jumping (coyote time + input
 * buffer), slip chaos, peel-layer shells that tear off on damage, and the
 * golden glow of Super Yellow Mode.
 */
export class Player {
  /**
   * @param {PhysicsWorld} physics
   * @param {THREE.Group} bananaTemplate normalized banana (from AssetManager)
   * @param {THREE.BufferGeometry} bodyGeometry main banana geometry (for shells)
   */
  constructor(physics, bananaTemplate, bodyGeometry, scene) {
    this.physics = physics;
    this.scene = scene;
    this.bodyGeometry = bodyGeometry;

    // ---- visual hierarchy ----
    this.root = new THREE.Group();
    this.bankGroup = new THREE.Group();
    this.tumbleGroup = new THREE.Group();
    this.modelGroup = bananaTemplate;
    this.root.add(this.bankGroup);
    this.bankGroup.add(this.tumbleGroup);
    this.tumbleGroup.add(this.modelGroup);
    scene.add(this.root);

    // collect materials for glow / blink control
    this.materials = [];
    this.modelGroup.traverse((o) => { if (o.isMesh && o.material) this.materials.push(o.material); });

    // find the main body mesh (for peel shells)
    this.bodyMesh = null;
    this.modelGroup.traverse((o) => {
      if (o.isMesh && o.geometry === bodyGeometry) this.bodyMesh = o;
    });

    // ---- peel shells (outer layers that tear off) ----
    this.shellPool = [];
    this.shells = [];
    this.flyingPeels = [];
    const shellMat = () => new THREE.MeshStandardMaterial({
      color: 0xffe135, transparent: true, opacity: 0.5,
      emissive: 0xcaa500, emissiveIntensity: 0.22,
      roughness: 0.45, depthWrite: false,
    });
    if (this.bodyMesh) {
      [1.16, 1.11, 1.06].forEach((s, i) => {
        const shell = this.bodyMesh.clone();
        shell.material = shellMat();
        shell.scale.multiplyScalar(s);
        shell.castShadow = false;
        shell.userData.shellIndex = i;
        this.shells.push(shell);
        this.modelGroup.add(shell);
      });
    }

    // ---- physics body ----
    this.body = new CANNON.Body({
      mass: 6,
      shape: new CANNON.Sphere(RADIUS),
      material: physics.playerMaterial,
      position: new CANNON.Vec3(0, 1.5, 0),
      linearDamping: 0.02,
    });
    this.body.fixedRotation = true;
    this.body.updateMassProperties();
    this.body.collisionFilterGroup = GROUP_PLAYER;
    physics.world.addBody(this.body);
    physics.registerPlayer(this.body);

    // ---- input & state ----
    this.input = { left: false, right: false, boost: false, down: false };
    this.jumpBuffered = 0;
    this.lastGroundedAt = -999;
    this.prevGrounded = false;
    this.prevVy = 0;
    this.invulnUntil = 0;
    this.slipUntil = 0;
    this.stunUntil = 0;
    this.superT = 0;        // 0..1 visual super glow
    this.squash = 1;
    this.squashVel = 0;
    this.time = 0;
    this.speed = 0;
    this.wasAirborne = false;

    this._tmpV = new THREE.Vector3();
  }

  queueJump() { this.jumpBuffered = JUMP_BUFFER; }

  setSlip(duration) { this.slipUntil = Math.max(this.slipUntil, this.time + duration); }
  setInvuln(duration) { this.invulnUntil = Math.max(this.invulnUntil, this.time + duration); }
  stun(duration) { this.stunUntil = Math.max(this.stunUntil, this.time + duration); }

  get position() { return this.root.position; }
  get grounded() { return this.time - this.lastGroundedAt < COYOTE_TIME; }

  /** Tear off the outermost peel shell (visual only — logic lives in GameLogic). */
  ejectPeel() {
    const shell = this.shells.pop();
    if (!shell) return;
    shell.getWorldPosition(this._tmpV);
    const q = new THREE.Quaternion();
    shell.getWorldQuaternion(q);
    this.modelGroup.remove(shell);
    shell.position.copy(this._tmpV);
    shell.quaternion.copy(q);
    shell.scale.setScalar(0.9);
    this.scene.add(shell);
    this.flyingPeels.push({
      mesh: shell,
      vel: new THREE.Vector3((Math.random() - 0.5) * 7, 7 + Math.random() * 5, 4 + Math.random() * 6),
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
      life: 1.15,
    });
  }

  /**
   * @param {number} dt
   * @param {{targetSpeed:number, slipping:boolean, superMode:boolean, active:boolean,
   *          onJump:Function, onLand:Function}} ctx
   */
  update(dt, ctx) {
    this.time += dt;
    const v = this.body.velocity;

    // ---------- grounded check ----------
    const ray = this.physics.raycastDown(this.body.position, RADIUS + 0.3);
    const onGround = !!ray && v.y <= 0.5;
    if (onGround) this.lastGroundedAt = this.time;
    const coyote = this.grounded;

    // landing event
    if (this.prevGrounded === false && coyote && this.prevVy < -5 && ctx.onLand) ctx.onLand();
    if (onGround && this.wasAirborne && this.prevVy < -5 && ctx.onLand) ctx.onLand();
    this.prevGrounded = coyote;
    this.wasAirborne = !onGround;
    this.prevVy = v.y;

    // ---------- jump (buffered + coyote) ----------
    this.jumpBuffered = Math.max(0, this.jumpBuffered - dt);
    if (this.jumpBuffered > 0 && coyote && v.y < 2.5) {
      v.y = JUMP_VELOCITY;
      this.jumpBuffered = 0;
      this.lastGroundedAt = -999; // consume
      this.squashVel = 6.5;       // stretch pop
      if (ctx.onJump) ctx.onJump();
    }

    // ---------- dive / fast-fall (S or ArrowDown while airborne) ----------
    if (ctx.active && this.input.down && !onGround && v.y < 3) {
      v.y = Math.min(v.y, -17); // rocket toward the road
      if (this.squash > 0.9) this.squashVel = -3.2; // slight tuck
    }

    // ---------- forward speed (paused during knockback stun) ----------
    // When knocked backward (v.z > 0 means flying backwards, forward is -Z)
    // recover with extra authority so a bump never becomes a crawl.
    const stunned = this.time < this.stunUntil;
    const accel = v.z > 0 ? 11 : (coyote ? 6.5 : 2.4);
    const desiredZ = ctx.active && !stunned ? -ctx.targetSpeed : 0;
    if (!stunned) v.z += (desiredZ - v.z) * Math.min(1, accel * dt);
    this.speed = Math.abs(v.z);

    // ---------- lateral steering ----------
    // NOTE: with the chase camera behind the banana looking down -Z, world +X
    // is the RIGHT side of the screen. 'left' must push toward -X (steer -1)
    // and 'right' toward +X (steer +1) — the original signs were inverted,
    // which made the banana steer the opposite way from the key pressed.
    let steer = 0;
    if (ctx.active) {
      if (this.input.left) steer -= 1;
      if (this.input.right) steer += 1;
    }
    const slipping = this.slipUntil > this.time;
    let targetX = steer * LATERAL_SPEED * (coyote ? 1 : 0.55);
    if (slipping && ctx.active) {
      // chaotic banana-peel drift: wobble + jitter impulses (tuned down —
      // the old value could hurl the banana into the neon rails)
      targetX *= 0.45;
      targetX += Math.sin(this.time * 11.3) * 7.5;
      v.x += (Math.random() - 0.5) * 22 * dt;
    }
    if (!stunned) v.x += (targetX - v.x) * Math.min(1, (coyote ? 9 : 3.2) * dt);

    // ---------- road rails (soft clamp) ----------
    const p = this.body.position;
    if (p.x < -ROAD_HALF) { p.x = -ROAD_HALF; if (v.x < 0) v.x *= -0.35; }
    if (p.x > ROAD_HALF) { p.x = ROAD_HALF; if (v.x > 0) v.x *= -0.35; }

    // ---------- sync visuals ----------
    this.root.position.set(p.x, p.y, p.z);

    // tumble (rolling + airborne somersault)
    const tumbleRate = this.speed / (RADIUS + 0.12) * (coyote ? 1 : 1.55);
    this.tumbleGroup.rotation.x += tumbleRate * dt;
    if (slipping) this.tumbleGroup.rotation.y += 6.2 * dt;
    else this.tumbleGroup.rotation.y *= 1 - Math.min(1, dt * 4);

    // banking + yaw
    const lean = -steer * 0.38;
    this.bankGroup.rotation.z += (lean - this.bankGroup.rotation.z) * Math.min(1, dt * 8);
    this.root.rotation.y += (-steer * 0.2 - this.root.rotation.y) * Math.min(1, dt * 6);

    // squash & stretch spring
    this.squashVel += (1 - this.squash) * 160 * dt - this.squashVel * 12 * dt;
    this.squash += this.squashVel * dt;
    this.squash = THREE.MathUtils.clamp(this.squash, 0.7, 1.35);
    const sq = this.squash;
    this.modelGroup.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    // ---------- super yellow glow ----------
    this.superT += ((ctx.superMode ? 1 : 0) - this.superT) * Math.min(1, dt * 4);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 11);
    for (const m of this.materials) {
      if (!m.emissive) continue;
      if (this.superT > 0.01) {
        m.emissive.setRGB(0.85 * this.superT + 0.05 * pulse * this.superT, 0.62 * this.superT, 0.1 * this.superT);
        m.emissiveIntensity = 0.9 + 0.9 * this.superT;
      } else {
        m.emissive.setHex(0x3a2a05);
        m.emissiveIntensity = 0.35;
      }
    }
    if (this.superT > 0.01) {
      const s = 1 + 0.07 * this.superT * pulse;
      this.root.scale.setScalar(s);
    } else {
      this.root.scale.setScalar(1);
    }

    // ---------- invulnerability blink ----------
    const invuln = this.invulnUntil > this.time;
    const blink = invuln ? (Math.sin(this.time * 26) > -0.2) : true;
    this.bankGroup.visible = blink;

    // ---------- flying peel debris ----------
    for (let i = this.flyingPeels.length - 1; i >= 0; i--) {
      const f = this.flyingPeels[i];
      f.life -= dt;
      f.vel.y -= 26 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      f.mesh.rotation.x += f.spin.x * dt;
      f.mesh.rotation.y += f.spin.y * dt;
      f.mesh.rotation.z += f.spin.z * dt;
      const s = Math.max(0.05, 0.9 * (f.life / 1.15));
      f.mesh.scale.setScalar(s);
      if (f.mesh.material) f.mesh.material.opacity = 0.5 * (f.life / 1.15);
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        this.flyingPeels.splice(i, 1);
      }
    }
  }

  /** Teleport after a void fall. */
  respawn(x, y, z) {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.stunUntil = 0;
  }

  /** Full reset (new run). */
  reset() {
    this.respawn(0, 1.6, 0);
    this.input.left = this.input.right = this.input.boost = this.input.down = false;
    this.jumpBuffered = 0;
    this.lastGroundedAt = -999;
    this.invulnUntil = 0;
    this.slipUntil = 0;
    this.superT = 0;
    this.tumbleGroup.rotation.set(0, 0, 0);
    this.bankGroup.rotation.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.modelGroup.scale.set(1, 1, 1);
    // recall flying peels + restore shells
    for (const f of this.flyingPeels) this.scene.remove(f.mesh);
    this.flyingPeels.length = 0;
    for (const s of this.shells) this.modelGroup.remove(s);
    this.shells.length = 0;
    if (this.bodyMesh) {
      const scales = [1.16, 1.11, 1.06];
      this.shellPool.forEach(() => {}); // pool kept for future reuse
      scales.forEach((s, i) => {
        const shell = this.bodyMesh.clone();
        shell.material = new THREE.MeshStandardMaterial({
          color: 0xffe135, transparent: true, opacity: 0.5,
          emissive: 0xcaa500, emissiveIntensity: 0.22, roughness: 0.45, depthWrite: false,
        });
        shell.scale.multiplyScalar(s);
        shell.castShadow = false;
        shell.userData.shellIndex = i;
        this.shells.push(shell);
        this.modelGroup.add(shell);
      });
    }
  }
}
