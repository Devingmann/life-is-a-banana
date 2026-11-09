import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsWorld, GROUP_PLAYER } from './PhysicsWorld.js';

const ROAD_HALF = 5.9;      // playable half-width (neon rails beyond)
const RADIUS = 0.85;        // physics sphere radius
const JUMP_VELOCITY = 13.8;
const DOUBLE_JUMP_VELOCITY = 10.6; // HELI-PEEL: mid-air spin jump
const LATERAL_BASE = 13.0;
const LATERAL_PER_DIFF = 9.0;      // steering authority scales with speed
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.15;

// ---- ENDURANCE: the one and only jump governor ----
// Jumps work ALL THE TIME. There is no jump-count state machine left to
// eat inputs: press = jump, as long as the banana has juice. The meter
// (HUD "ENDURANCE") drains per jump and refills fast while rolling,
// slowly while airborne.
const ENDURANCE_COST_GROUND = 0.24;   // a road bounce is cheap
const ENDURANCE_COST_AIR = 0.40;      // each HELI-PEEL costs more
const ENDURANCE_REGEN_GROUND = 0.50;  // full meter back in ~2 s of rolling
const ENDURANCE_REGEN_AIR = 0.16;

/**
 * Player — the Cosmic Banana
 * --------------------------
 * A physics sphere drives the motion; the banana mesh tumbles, banks and
 * squashes on top of it. Handles steering, ENDURANCE-governed jumping
 * (coyote time + input buffer + HELI-PEEL: as many air jumps as the meter
 * can pay for — a press is NEVER eaten by hidden state), dive-stomps, slip
 * chaos, peel-layer shells that tear off on damage, the warm tint of Super
 * Yellow Mode and an anti-stuck watchdog that guarantees the run NEVER
 * freezes solid.
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
    if (this.bodyMesh) {
      [1.16, 1.11, 1.06].forEach((s, i) => {
        const shell = this.bodyMesh.clone();
        shell.material = this._makeShellMaterial();
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
    this.input = { left: false, right: false, boost: false, down: false, jump: false };
    this.jumpBuffered = 0;
    this.endurance = 1;       // 0..1 — the jump governor (HUD ENDURANCE bar)
    this.lastDeniedAt = -999; // throttle for the "not enough endurance" feedback
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
    this.diving = false;    // tracking dive-stomps
    this.spinT = 0;         // double-jump flourish timer
    this.stuckTimer = 0;    // anti-stuck watchdog accumulator

    this._tmpV = new THREE.Vector3();
  }

  _makeShellMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xffe135, transparent: true, opacity: 0.5,
      emissive: 0xcaa500, emissiveIntensity: 0.22,
      roughness: 0.45, depthWrite: false,
    });
  }

  queueJump() { this.jumpBuffered = JUMP_BUFFER; }

  /** Jump pressed while the endurance meter is dry: crisp, throttled "pfft"
   *  feedback so the player ALWAYS understands why nothing happened — the
   *  key is never silently dead. */
  _denyJump(ctx) {
    if (this.time - this.lastDeniedAt < 0.3) return;
    this.lastDeniedAt = this.time;
    this.jumpBuffered = 0;
    if (ctx.onJumpDenied) ctx.onJumpDenied();
  }

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
   * @param {{targetSpeed:number, difficulty:number, slipping:boolean, superMode:boolean, active:boolean,
   *          onJump:Function, onDoubleJump:Function, onDiveLand:Function, onUnstuck:Function}} ctx
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

    // ---------- dive-stomp landing (fast-fall impact) ----------
    if (onGround && this.diving) {
      this.diving = false;
      if (this.prevVy < -14 && ctx.onDiveLand) ctx.onDiveLand();
    }

    // ---------- jump bookkeeping ----------
    // (nothing left to bookkeep: availability is purely ENDURANCE)

    // ---------- ENDURANCE: refills fast on the road, slowly in the air ----
    this.endurance = Math.min(1, this.endurance + dt * (coyote ? ENDURANCE_REGEN_GROUND : ENDURANCE_REGEN_AIR));

    // ---------- jump (buffered + coyote) & HELI-PEEL — endurance-gated ----
    this.jumpBuffered = Math.max(0, this.jumpBuffered - dt);

    // HELD jump key = persistent intent WHILE ON THE ROAD: the buffer keeps
    // refreshing, so the banana auto-bounces on every landing the meter can
    // pay for. In the air, each HELI-PEEL requires a fresh press — a long
    // hold can never again silently waste the double jump.
    if (ctx.active && this.input.jump && coyote) {
      this.jumpBuffered = Math.max(this.jumpBuffered, JUMP_BUFFER);
    }

    if (this.jumpBuffered > 0 && ctx.active) {
      if (coyote && v.y < 3.0) {
        if (this.endurance >= ENDURANCE_COST_GROUND) {
          v.y = JUMP_VELOCITY;
          this.endurance -= ENDURANCE_COST_GROUND;
          this.jumpBuffered = 0;
          this.lastGroundedAt = -999; // consume coyote
          this.squashVel = 6.5;       // stretch pop
          if (ctx.onJump) ctx.onJump();
        } else {
          this._denyJump(ctx);
        }
      } else if (!coyote) {
        // HELI-PEEL: mid-air spin jump — as many as endurance can pay for
        if (this.endurance >= ENDURANCE_COST_AIR) {
          v.y = Math.max(v.y, DOUBLE_JUMP_VELOCITY);
          this.endurance -= ENDURANCE_COST_AIR;
          this.jumpBuffered = 0;
          this.spinT = 0.55;
          this.squashVel = 4.5;
          if (ctx.onDoubleJump) ctx.onDoubleJump();
        } else {
          this._denyJump(ctx);
        }
      }
    }

    this.prevGrounded = coyote;
    this.wasAirborne = !onGround;
    this.prevVy = v.y;

    // ---------- dive / fast-fall (S or ArrowDown while airborne) ----------
    if (ctx.active && this.input.down && !onGround && v.y < 3) {
      v.y = Math.min(v.y, -17); // rocket toward the road
      this.diving = true;
      if (this.squash > 0.9) this.squashVel = -3.2; // slight tuck
    }

    // ---------- forward speed (paused during knockback stun) ----------
    // When knocked backward (v.z > 0 means flying backwards, forward is -Z)
    // recover with extra authority so a bump never becomes a crawl.
    const stunned = this.time < this.stunUntil;
    const accel = v.z > 0 ? 13 : (coyote ? 6.5 : 2.8);
    const desiredZ = ctx.active && !stunned ? -ctx.targetSpeed : 0;
    if (!stunned) v.z += (desiredZ - v.z) * Math.min(1, accel * dt);
    this.speed = Math.abs(v.z);

    // ---------- lateral steering ----------
    // NOTE: with the chase camera behind the banana looking down -Z, world +X
    // is the RIGHT side of the screen. 'left' must push toward -X (steer -1)
    // and 'right' toward +X (steer +1).
    let steer = 0;
    if (ctx.active) {
      if (this.input.left) steer -= 1;
      if (this.input.right) steer += 1;
    }
    const slipping = this.slipUntil > this.time;
    const lateral = LATERAL_BASE + LATERAL_PER_DIFF * Math.min(1, ctx.difficulty || 0);
    let targetX = steer * lateral * (coyote ? 1 : 0.8);
    if (slipping && ctx.active) {
      // chaotic banana-peel drift: wobble + jitter impulses (tuned down —
      // the old value could hurl the banana into the neon rails)
      targetX *= 0.45;
      targetX += Math.sin(this.time * 11.3) * 7.5;
      v.x += (Math.random() - 0.5) * 22 * dt;
    }
    // snappier convergence than before (14/s grounded, 7/s airborne) so
    // steering never feels laggy at high speed
    if (!stunned) v.x += (targetX - v.x) * Math.min(1, (coyote ? 14 : 7) * dt);

    // ---------- road rails (soft clamp) ----------
    const p = this.body.position;
    if (p.x < -ROAD_HALF) { p.x = -ROAD_HALF; if (v.x < 0) v.x *= -0.35; }
    if (p.x > ROAD_HALF) { p.x = ROAD_HALF; if (v.x > 0) v.x *= -0.35; }

    // ---------- ANTI-STUCK WATCHDOG ----------
    // If the banana is wedged against an obstacle face / gap lip and its
    // velocity collapses, phase it forward past the blocker after ~0.85s.
    // This is the hard guarantee that a run can NEVER freeze solid.
    if (ctx.active && this.time > 1.0) {
      if (this.speed < 3.4 && Math.abs(v.x) < 4.5 && v.y < 2) {
        this.stuckTimer += dt;
      } else {
        this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
      }
      if (this.stuckTimer > 0.85) {
        this.stuckTimer = 0;
        p.z -= 3.4; // slip THROUGH the cosmos, past whatever blocked us
        v.set(0, 5.5, -Math.max(9, ctx.targetSpeed * 0.55));
        this.setInvuln(1.1);
        this.squashVel = 5;
        this.spinT = 0.4;
        if (ctx.onUnstuck) ctx.onUnstuck();
      }
    }

    // ---------- sync visuals ----------
    this.root.position.set(p.x, p.y, p.z);

    // tumble (rolling + airborne somersault + heli-peel flourish)
    const tumbleRate = this.speed / (RADIUS + 0.12) * (coyote ? 1 : 1.55);
    this.tumbleGroup.rotation.x += tumbleRate * dt;
    if (this.spinT > 0) {
      this.spinT -= dt;
      this.tumbleGroup.rotation.y += 24 * dt;
    } else if (slipping) {
      this.tumbleGroup.rotation.y += 6.2 * dt;
    } else {
      this.tumbleGroup.rotation.y *= 1 - Math.min(1, dt * 4);
    }

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

    // ---------- super yellow mode (NO glow) ----------
    // Super mode reads through the scale pulse, the spin and the sound.
    // The emissive stays tiny (≈0.27 max) — far below the bloom threshold —
    // so it can never feed the glow or wash the screen, mid star-streak or
    // not.
    this.superT += ((ctx.superMode ? 1 : 0) - this.superT) * Math.min(1, dt * 4);
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 11);
    for (const m of this.materials) {
      if (!m.emissive) continue;
      if (this.superT > 0.01) {
        m.emissive.setRGB(0.30 * this.superT, 0.22 * this.superT, 0.05 * this.superT);
        m.emissiveIntensity = 0.9;
      } else {
        m.emissive.setHex(0x2a1e06);
        m.emissiveIntensity = 0.35;
      }
    }
    if (this.superT > 0.01) {
      const s = 1 + 0.05 * this.superT * pulse;
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
    this.stuckTimer = 0;
    this.endurance = 1; // fresh legs after a cosmic respawn
  }

  /** Full reset (new run). */
  reset() {
    this.respawn(0, 1.6, 0);
    this.input.left = this.input.right = this.input.boost = this.input.down = this.input.jump = false;
    this.jumpBuffered = 0;
    this.endurance = 1;
    this.lastDeniedAt = -999;
    this.lastGroundedAt = -999;
    this.invulnUntil = 0;
    this.slipUntil = 0;
    this.superT = 0;
    this.diving = false;
    this.spinT = 0;
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
      [1.16, 1.11, 1.06].forEach((s, i) => {
        const shell = this.bodyMesh.clone();
        shell.material = this._makeShellMaterial();
        shell.scale.multiplyScalar(s);
        shell.castShadow = false;
        shell.userData.shellIndex = i;
        this.shells.push(shell);
        this.modelGroup.add(shell);
      });
    }
  }
}
