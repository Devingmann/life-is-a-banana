import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Bosses — ARCADE BOSS FIGHTS on the Highway of Life
 * ---------------------------------------------------
 *   - MINI-BOSS « SINGE SUPREME »: a giant monkey 45 m ahead that hurls
 *     coconuts at your lane. Survive the timer — or missile it 4 times.
 *   - BOSS « ROI KONG COSMIQUE »: a crowned mega-gorilla that throws
 *     bouncing rolling barrels AND pounds shockwaves you must jump.
 *     8 hits. Killing him = MEGA JACKPOT.
 * Killing any boss pays a MEGA BONUS (GameLogic): thousands of points,
 * peel repair, full ammo, full endurance, potassium charge.
 *
 * Bosses are GLOW-FREE by design: flat kitsch paint jobs (brown fur, gold
 * crown, wooden barrels, dark coconut shells). The only glow in the world
 * stays on the neon road edges. Projectiles are pooled and merged into a
 * single draw call each; the whole module is cheap enough for any GPU.
 */

const GRAVITY = 26;

const BOSS_DEFS = {
  mini: {
    name: 'SINGE SUPREME',
    hp: 4,
    fight: 24,
    throwEvery: 1.7,
    taunts: ['TU NE VAUX PAS UNE BANANE !', 'POTASSIUM ? JAMAIS !', 'MONKEY BUSINESS, BABE !'],
  },
  mega: {
    name: 'ROI KONG COSMIQUE',
    hp: 8,
    fight: 32,
    throwEvery: 1.2,
    taunts: ['INCLINE-TOI, FRUIT !', 'MA COURONNE, MA GLOIRE !', 'LE SMOOTHIE EST INÉVITABLE !'],
  },
};

/* ---------- tiny geometry helper (same as Environment's) ---------- */
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function part(geoSrc, hex, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  const g = geoSrc.clone();
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _v.set(pos[0], pos[1], pos[2]);
  _s.set(scl[0], scl[1], scl[2]);
  _m4.compose(_v, _q, _s);
  g.applyMatrix4(_m4);
  const n = g.attributes.position.count;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export class Bosses {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.boss = null;          // live boss state or null
    this.projectiles = [];     // coconuts + barrels in flight
    this.waves = [];           // ground-pound shockwave rings
    this._coconutPool = [];
    this._barrelPool = [];
    this._wavePool = [];
    this._buildAssets();

    this._dom = {
      bar: document.getElementById('boss-bar'),
      name: document.getElementById('boss-name'),
      hp: document.getElementById('boss-hp-fill'),
      timer: document.getElementById('boss-timer'),
    };
  }

  /* ================================================================
     ASSETS (built once, merged, matte)
     ================================================================ */

  _buildAssets() {
    const sph = new THREE.SphereGeometry(1, 14, 10);

    // ---- giant monkey (faces +Z, toward the player) ----
    this.geoMonkeyBoss = mergeGeometries([
      part(sph, 0x8b5a2b, [0, 1.55, 0], [0, 0, 0], [1.15, 1.0, 0.95]),      // body
      part(sph, 0x9c6a35, [0, 3.15, 0], [0, 0, 0], [0.78, 0.72, 0.72]),     // head
      part(sph, 0x6e4520, [0.68, 3.15, 0.12], [0, 0, 0], [0.28, 0.28, 0.2]),// ear R
      part(sph, 0x6e4520, [-0.68, 3.15, 0.12], [0, 0, 0], [0.28, 0.28, 0.2]),// ear L
      part(sph, 0xd9a066, [0, 3.0, 0.64], [0, 0, 0], [0.42, 0.32, 0.26]),    // muzzle
      part(sph, 0x180d05, [0.24, 3.25, 0.7], [0, 0, 0], [0.09, 0.09, 0.05]),// eye R
      part(sph, 0x180d05, [-0.24, 3.25, 0.7], [0, 0, 0], [0.09, 0.09, 0.05]),// eye L
      part(new THREE.CylinderGeometry(0.15, 0.11, 1.6, 8), 0x8b5a2b, [0.95, 2.0, 0.32], [0, 0, -0.55]), // arm R
      part(new THREE.CylinderGeometry(0.15, 0.11, 1.6, 8), 0x8b5a2b, [-0.95, 2.0, 0.32], [0, 0, 0.55]),// arm L
      part(new THREE.CylinderGeometry(0.11, 0.07, 2.0, 8), 0x8b5a2b, [0, 1.5, -1.1], [1.15, 0, 0]),     // tail
      part(sph, 0x3a2153, [0.95, 1.25, 0.4], [0, 0, 0], [0.34, 0.34, 0.34]), // fist R
      part(sph, 0x3a2153, [-0.95, 1.25, 0.4], [0, 0, 0], [0.34, 0.34, 0.34]),// fist L
    ], false);

    // ---- mega gorilla ----
    this.geoGorillaBoss = mergeGeometries([
      part(sph, 0x2e2018, [0, 2.25, 0], [0, 0, 0], [1.6, 1.4, 1.25]),        // body
      part(sph, 0x241811, [0, 4.05, 0.12], [0, 0, 0], [0.82, 0.72, 0.78]),   // head
      part(new THREE.BoxGeometry(1.15, 0.32, 0.75), 0x241811, [0, 4.42, 0.3], [-0.25, 0, 0]), // crest
      part(sph, 0x8a6843, [0, 3.25, 0.95], [0, 0, 0], [0.85, 0.62, 0.45]),   // chest
      part(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 10), 0x241811, [1.05, 0.5, 0]),           // leg R
      part(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 10), 0x241811, [-1.05, 0.5, 0]),          // leg L
      part(new THREE.CylinderGeometry(0.44, 0.36, 2.5, 10), 0x2e2018, [1.55, 3.5, 0.35], [0, 0, -0.7]), // arm R
      part(new THREE.CylinderGeometry(0.44, 0.36, 2.5, 10), 0x2e2018, [-1.55, 3.5, 0.35], [0, 0, 0.7]), // arm L
      part(sph, 0x241811, [1.55, 2.3, 0.45], [0, 0, 0], [0.6, 0.6, 0.6]),    // fist R
      part(sph, 0x241811, [-1.55, 2.3, 0.45], [0, 0, 0], [0.6, 0.6, 0.6]),   // fist L
    ], false);

    // ---- royal crown (matte gold) ----
    this.geoCrown = mergeGeometries([
      part(new THREE.CylinderGeometry(0.55, 0.62, 0.34, 10), 0xffd24a),
      part(new THREE.ConeGeometry(0.14, 0.36, 6), 0xffd24a, [0.34, 0.28, 0]),
      part(new THREE.ConeGeometry(0.14, 0.36, 6), 0xffd24a, [-0.34, 0.28, 0]),
      part(new THREE.ConeGeometry(0.14, 0.36, 6), 0xffd24a, [0, 0.28, 0.34]),
      part(new THREE.ConeGeometry(0.14, 0.36, 6), 0xffd24a, [0, 0.28, -0.34]),
    ], false);
    this.matCrown = new THREE.MeshStandardMaterial({ color: 0xffd24a, roughness: 0.35, metalness: 0.6 });

    this.matBoss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

    // ---- projectiles: matte coconut + wooden barrel (axis along Z) ----
    this.geoCoconut = mergeGeometries([
      part(new THREE.SphereGeometry(0.45, 12, 9), 0x6e4520),
      part(new THREE.SphereGeometry(0.13, 8, 6), 0x3a2153, [0.24, 0.3, 0.26]),
      part(new THREE.SphereGeometry(0.13, 8, 6), 0x3a2153, [-0.28, 0.18, -0.2]),
      part(new THREE.SphereGeometry(0.13, 8, 6), 0x3a2153, [0.05, -0.36, 0.24]),
    ], false);
    this.geoBarrel = mergeGeometries([
      part(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12), 0x9c6a35, [0, 0, 0], [Math.PI / 2, 0, 0]),
      part(new THREE.CylinderGeometry(0.53, 0.53, 0.16, 12), 0x5e3d1f, [0, 0, 0.34], [Math.PI / 2, 0, 0]),
      part(new THREE.CylinderGeometry(0.53, 0.53, 0.16, 12), 0x5e3d1f, [0, 0, -0.34], [Math.PI / 2, 0, 0]),
    ], false);
    this.matProj = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

    // ---- shockwave ring (flat on the road, matte danger red) ----
    this.geoWave = new THREE.RingGeometry(0.94, 1.06, 48);
    this.geoWave.rotateX(-Math.PI / 2);
  }

  _makeMonkey() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geoMonkeyBoss, this.matBoss);
    body.castShadow = true;
    g.add(body);
    return g;
  }

  _makeGorilla() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(this.geoGorillaBoss, this.matBoss);
    body.castShadow = true;
    const crown = new THREE.Mesh(this.geoCrown, this.matCrown);
    crown.position.set(0, 4.6, 0.08);
    crown.rotation.z = 0.14;
    g.add(body, crown);
    return g;
  }

  /* ================================================================
     PUBLIC API
     ================================================================ */

  /** Launch a boss fight. Returns the boss state object. */
  spawn(kind, playerZ) {
    if (this.boss) this.clear();
    const def = BOSS_DEFS[kind];
    const group = kind === 'mini' ? this._makeMonkey() : this._makeGorilla();
    this.boss = {
      kind, def, group,
      hp: def.hp, maxHp: def.hp,
      timer: def.fight,
      throwT: 1.4,
      poundT: kind === 'mega' ? 3.4 : Infinity,
      hopBonus: 0, phase: Math.random() * 9, hitT: 0,
      dying: 0, fleeing: 0,
      x: 0, z: playerZ - 46,
    };
    group.position.set(0, 0, this.boss.z);
    this.scene.add(group);
    if (this._dom.bar) {
      this._dom.bar.classList.remove('hidden');
      this._dom.name.textContent = def.name;
    }
    this._syncBar();
    return this.boss;
  }

  /** Sphere test for banana missiles (boss has priority over obstacles). */
  testHit(x, y, z) {
    const b = this.boss;
    if (!b || b.dying > 0 || b.fleeing > 0) return null;
    const mega = b.kind === 'mega';
    const cy = mega ? 3.0 : 2.2;
    const r = mega ? 3.6 : 2.7;
    const dx = x - b.x, dy = y - cy, dz = z - b.z;
    if (dx * dx + dy * dy + dz * dz < r * r) return { boss: true, x: b.x, y: cy, z: b.z };
    return null;
  }

  /** Normalized aim direction toward the boss center (for auto-aim). */
  aimAt(px, py, pz) {
    const b = this.boss;
    if (!b || b.dying > 0 || b.fleeing > 0) return null;
    const cy = b.kind === 'mega' ? 3.0 : 2.2;
    const dx = b.x - px, dy = cy - py, dz = b.z - pz;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / len, y: dy / len, z: dz / len };
  }

  /** One banana missile connects. Returns {killed, hp, maxHp, kind, x,y,z}. */
  damage() {
    const b = this.boss;
    if (!b || b.dying > 0 || b.fleeing > 0) return null;
    b.hp -= 1;
    b.hitT = 0.32;
    const out = {
      killed: false, hp: Math.max(0, b.hp), maxHp: b.maxHp, kind: b.kind,
      x: b.x, y: b.kind === 'mega' ? 3.0 : 2.2, z: b.z,
    };
    if (b.hp <= 0) { out.killed = true; b.dying = 1.25; }
    this._syncBar();
    return out;
  }

  /**
   * @param {number} dt
   * @param {{active:boolean, playerPos:THREE.Vector3, playerSpeed:number,
   *          time:number, particles:import('./Particles.js').Particles,
   *          onTaunt:Function, onCoconutHit:Function, onBarrelHit:Function,
   *          onWaveHit:Function, onPound:Function, onFlee:Function}} ctx
   */
  update(dt, ctx) {
    this._updateProjectiles(dt, ctx);
    this._updateWaves(dt, ctx);
    const b = this.boss;
    if (!b) return;

    // ---- death spin-sink ----
    if (b.dying > 0) {
      b.dying -= dt;
      const k = Math.max(0, b.dying) / 1.25;
      b.group.rotation.y += 22 * dt;
      b.group.position.y = -(1.25 - k) * 6;
      b.group.scale.setScalar(Math.max(0.001, k));
      this._syncBar();
      if (b.dying <= 0) this._remove();
      return;
    }

    // ---- rage-quit flee (hop away down the highway) ----
    if (b.fleeing > 0) {
      b.fleeing -= dt;
      b.z -= 30 * dt;
      b.group.position.set(b.x, Math.abs(Math.sin(b.fleeing * 10)) * 3, b.z);
      this._syncBar();
      if (b.fleeing <= 0) this._remove();
      return;
    }

    const pp = ctx.playerPos;
    const mega = b.kind === 'mega';

    // ---- hold the fight ~45 m ahead; hop away if the banana closes in ----
    const wantZ = pp.z - (45 + b.hopBonus);
    b.z += (wantZ - b.z) * Math.min(1, dt * 2.5);
    if (pp.z - b.z < 30) {
      b.hopBonus += 14;
      b.group.position.y = 4.5; // escape hop
      if (b.hopBonus >= 70) {
        // the banana is simply too fast — the boss rage-quits
        b.fleeing = 1.5;
        if (ctx.onFlee) ctx.onFlee(b.kind);
        return;
      } else if (ctx.onTaunt) {
        ctx.onTaunt(b.def.taunts[(Math.random() * b.def.taunts.length) | 0]);
      }
    }

    // ---- kitsch idle drift + bob ----
    b.x = Math.sin(ctx.time * (mega ? 1.05 : 0.75) + b.phase) * 3.4;
    b.group.position.x = b.x;
    b.group.position.z = b.z;
    b.group.position.y = Math.max(0, b.group.position.y - 10 * dt)
      + Math.abs(Math.sin(ctx.time * 2.4 + b.phase)) * 0.35;
    b.group.rotation.y = Math.sin(ctx.time * 1.3 + b.phase) * 0.25;

    // ---- hit punch scale ----
    if (b.hitT > 0) {
      b.hitT -= dt;
      b.group.scale.setScalar(1 + b.hitT * 0.55);
    } else {
      b.group.scale.setScalar(1);
    }

    // ---- fight timer: survive until zero and the boss leaves ----
    b.timer -= dt;
    if (b.timer <= 0) {
      b.fleeing = 1.5;
      if (ctx.onFlee) ctx.onFlee(b.kind);
      return;
    }

    // ---- attacks ----
    if (ctx.active) {
      b.throwT -= dt;
      if (b.throwT <= 0) {
        b.throwT = b.def.throwEvery * (0.7 + Math.random() * 0.6);
        this._throw(b, ctx);
        b.group.rotation.x = -0.2; // wind-up pose
      }
      if (b.poundT !== Infinity) {
        b.poundT -= dt;
        if (b.poundT <= 0) {
          b.poundT = 4.6 + Math.random() * 2.4;
          this._pound(b, ctx);
        }
      }
    }
    b.group.rotation.x *= 1 - Math.min(1, dt * 6);
    this._syncBar();
  }

  /** Hide everything (restart / back to menu). */
  clear() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this._releaseProj(i);
    for (let i = this.waves.length - 1; i >= 0; i--) this._releaseWave(i);
    if (this.boss) {
      this.scene.remove(this.boss.group);
      this.boss = null;
    }
    if (this._dom.bar) this._dom.bar.classList.add('hidden');
  }

  /* ================================================================
     ATTACKS
     ================================================================ */

  _throw(b, ctx) {
    const pp = ctx.playerPos;
    const mega = b.kind === 'mega';
    const kind = mega ? 'barrel' : 'coconut';
    const T = mega ? 0.62 : 0.85;                       // intercept time
    const fx = b.x, fy = mega ? 3.6 : 2.9, fz = b.z;
    const vx = (pp.x - fx) / T;                          // lead the lane
    const vz = (pp.z - fz) / T - ctx.playerSpeed * 0.92; // lead the run
    const vy = (0.9 - fy + 0.5 * GRAVITY * T * T) / T;  // comedic arc
    const mesh = this._acquireProj(kind);
    mesh.position.set(fx, fy, fz);
    this.projectiles.push({
      mesh, kind, x: fx, y: fy, z: fz, vx, vy, vz,
      spin: (Math.random() - 0.5) * 10, bounces: 0, life: 4, hit: false,
    });
  }

  _pound(b, ctx) {
    const mesh = this._acquireWave();
    mesh.position.set(b.x, 0.12, b.z);
    mesh.scale.setScalar(1);
    this.waves.push({ mesh, x: b.x, z: b.z, r: 1, v: 15, life: 1.35, hit: false });
    b.group.position.y = 0; // the slam
    if (ctx.onPound) ctx.onPound();
  }

  _updateProjectiles(dt, ctx) {
    const pp = ctx.playerPos;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.vy -= GRAVITY * dt;
      // barrels home a little while rolling: the chase is part of the joke
      if (p.kind === 'barrel' && p.bounces > 0) {
        p.vz += Math.sign(pp.z - p.z) * 8 * dt;
        p.vx *= 1 - Math.min(1, 0.4 * dt);
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

      // ground bounce: one comedic bounce, then settle/roll
      if (p.y < 0.5 && p.vy < 0) {
        p.y = 0.5;
        p.bounces += 1;
        if (p.bounces === 1) p.vy = p.kind === 'barrel' ? 5.6 : 3.4;
        else { p.vy = 0; p.y = 0.5; }
      }
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.z += p.spin * dt;
      if (p.kind === 'barrel') p.mesh.rotation.x += 9 * dt; // rolls along Z

      // player hit (barrel bites a peel, coconut just slips you up)
      if (!p.hit && ctx.active) {
        const dx = p.x - pp.x, dy = p.y - pp.y, dz = p.z - pp.z;
        if (dx * dx + dy * dy + dz * dz < 1.9) {
          p.hit = true;
          if (p.kind === 'barrel') { if (ctx.onBarrelHit) ctx.onBarrelHit(); }
          else { if (ctx.onCoconutHit) ctx.onCoconutHit(); }
          if (ctx.particles) ctx.particles[p.kind === 'barrel' ? 'barrelBits' : 'coconutBits'](p.x, p.y, p.z);
          this._releaseProj(i);
          continue;
        }
      }
      if (p.life <= 0 || p.z > pp.z + 14) this._releaseProj(i);
    }
  }

  _updateWaves(dt, ctx) {
    const pp = ctx.playerPos;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.r += w.v * dt;
      w.life -= dt;
      w.mesh.scale.setScalar(w.r);
      w.mesh.position.set(w.x, 0.12, w.z);
      w.mesh.material.opacity = Math.min(0.85, w.life * 1.4);
      // trip the banana if it is rolling (not jumping) when the ring passes
      if (!w.hit && ctx.active) {
        const dx = pp.x - w.x, dz = pp.z - w.z;
        const dist = Math.hypot(dx, dz);
        if (Math.abs(dist - w.r) < 1.0 && pp.y < 1.15) {
          w.hit = true;
          if (ctx.onWaveHit) ctx.onWaveHit();
        }
      }
      if (w.r > 17 || w.life <= 0) this._releaseWave(i);
    }
  }

  /* ================================================================
     POOLS & DOM
     ================================================================ */

  _acquireProj(kind) {
    const pool = kind === 'barrel' ? this._barrelPool : this._coconutPool;
    let mesh = pool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(kind === 'barrel' ? this.geoBarrel : this.geoCoconut, this.matProj);
      this.scene.add(mesh);
    }
    mesh.visible = true;
    mesh.rotation.set(0, 0, 0);
    return mesh;
  }

  _releaseProj(i) {
    const p = this.projectiles[i];
    p.mesh.visible = false;
    (p.kind === 'barrel' ? this._barrelPool : this._coconutPool).push(p.mesh);
    this.projectiles.splice(i, 1);
  }

  _acquireWave() {
    let mesh = this._wavePool.pop();
    if (!mesh) {
      // each ring owns its material so opacity can fade independently
      mesh = new THREE.Mesh(this.geoWave, new THREE.MeshBasicMaterial({
        color: 0xff2255, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
      }));
      this.scene.add(mesh);
    }
    mesh.visible = true;
    return mesh;
  }

  _releaseWave(i) {
    const w = this.waves[i];
    w.mesh.visible = false;
    this._wavePool.push(w.mesh);
    this.waves.splice(i, 1);
  }

  _remove() {
    if (!this.boss) return;
    this.scene.remove(this.boss.group);
    this.boss = null;
    if (this._dom.bar) this._dom.bar.classList.add('hidden');
  }

  _syncBar() {
    const b = this.boss;
    if (!this._dom.bar || !b) return;
    if (this._dom.hp) this._dom.hp.style.width = `${Math.max(0, b.hp / b.maxHp) * 100}%`;
    if (this._dom.timer) {
      this._dom.timer.textContent = b.dying > 0 ? 'KO !'
        : (b.fleeing > 0 ? 'FUIT !' : `${Math.max(0, Math.ceil(b.timer))}s`);
    }
  }
}
