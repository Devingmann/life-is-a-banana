import * as THREE from 'three';

/**
 * Missiles — BANANA BALLISTICS
 * ----------------------------
 * Pooled projectile system: spinning bananas launched forward with a
 * subtle auto-aim (computed by Environment.aimAssist) and sphere
 * hit-testing against obstacles (Environment.missileHitTest). On impact
 * the caller (GameLogic) smashes the obstacle for score + KABOOM.
 *
 * ZERO GLOW by design: no emissive, no additive trail, no muzzle flash —
 * a fat matte-yellow cartoon banana that is visible through size + spin.
 *
 * Kept deliberately cheap: max ~8 live missiles, one shared material,
 * meshes pooled instead of rebuilt.
 */

const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

export class Missiles {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Group|null} bananaTemplate normalized banana (AssetManager)
   */
  constructor(scene, bananaTemplate) {
    this.scene = scene;
    this.active = [];
    this.pool = [];

    // NO GLOW: pure matte-yellow arcade bullet — no emissive, no additive
    // anything. Visibility = chunky size + fast spin.
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xffe135,
      roughness: 0.42,
      metalness: 0.1,
      flatShading: true,
    });

    this.template = bananaTemplate ? bananaTemplate.clone(true) : null;
    if (this.template) {
      this.template.traverse((o) => {
        if (o.isMesh) { o.material = this.mat; o.castShadow = false; }
      });
    }

    this.group = new THREE.Group();
    scene.add(this.group);
  }

  _acquire() {
    let mesh = this.pool.pop();
    if (!mesh) {
      if (this.template) {
        mesh = this.template.clone(true);
      } else {
        mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.65, 4, 10), this.mat);
      }
      this.group.add(mesh);
    }
    mesh.visible = true;
    return mesh;
  }

  _release(i) {
    const m = this.active[i];
    m.mesh.visible = false;
    this.pool.push(m.mesh);
    this.active.splice(i, 1);
  }

  /**
   * Launch one banana missile.
   * @param {number} x y z muzzle world position
   * @param {{x:number,y:number,z:number}|null} dir normalized aim (null = straight ahead)
   * @param {number} speed world units / second
   */
  fire(x, y, z, dir, speed) {
    if (this.active.length >= 8) this._release(0); // recycle oldest, never grow unbounded
    _dir.set(dir ? dir.x : 0, dir ? dir.y : 0.04, dir ? dir.z : -1).normalize();
    const mesh = this._acquire();
    mesh.scale.setScalar(0.82);
    mesh.position.set(x, y, z);
    this.active.push({
      mesh,
      x, y, z,
      vx: _dir.x * speed,
      vy: _dir.y * speed,
      vz: _dir.z * speed,
      life: 2.4,
      angle: Math.random() * Math.PI * 2,
    });
  }

  /**
   * @param {number} dt
   * @param {{playerZ:number,
   *          testHit:Function,   // (x,y,z) => {body,x,y,z}|null
   *          onHit:Function}}    // (hit) => void
   */
  update(dt, ctx) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const m = this.active[i];
      m.life -= dt;

      // gentle gravity so long shots arc slightly instead of sailing forever
      m.vy -= 1.6 * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      m.angle += 15 * dt;

      m.mesh.position.set(m.x, m.y, m.z);
      // point the banana's long axis along its velocity, then spin around it
      _dir.set(m.vx, m.vy, m.vz).normalize();
      m.mesh.quaternion.setFromUnitVectors(UP, _dir);
      m.mesh.rotateY(m.angle);

      // ---- obstacle hit test ----
      if (ctx.testHit) {
        const hit = ctx.testHit(m.x, m.y, m.z);
        if (hit) {
          if (ctx.onHit) ctx.onHit(hit);
          this._release(i);
          continue;
        }
      }

      if (m.life <= 0 || m.y < -1.2 || m.z < ctx.playerZ - 95) this._release(i);
    }
  }

  /** Hide everything (run restart / back to menu). */
  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this._release(i);
  }
}
