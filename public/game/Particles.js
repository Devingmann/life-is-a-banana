import * as THREE from 'three';

/**
 * Particles
 * ---------
 * Pooled CPU particle system on THREE.Points with a soft-sprite shader:
 *   - peel debris on impacts (gravity chunks)
 *   - potassium pops on collection (small, brief, non-white)
 *   - golden pops on golden-banana jackpots
 * The old additive "speed lines" velocity field was removed for good:
 * NO GLOW OF SPEED anywhere — speed reads through FOV, camera and world.
 */

const MAX_PARTICLES = 700;

const _VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const _FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

function makeSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Particles {
  constructor(scene) {
    this.scene = scene;

    // ---- pooled point particles ----
    this.count = MAX_PARTICLES;
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.size = new Float32Array(MAX_PARTICLES);
    this.alpha = new Float32Array(MAX_PARTICLES);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    this.grav = new Float32Array(MAX_PARTICLES);
    this.drag = new Float32Array(MAX_PARTICLES);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // never culled

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: makeSpriteTexture() } },
      vertexShader: _VERT,
      fragmentShader: _FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    this._rand = Math.random;
  }

  /** Generic spawner */
  spawn(x, y, z, opts = {}) {
    const n = opts.count || 10;
    for (let i = 0; i < n; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const i3 = idx * 3;
      this.pos[i3] = x + (Math.random() - 0.5) * (opts.spread || 0.6);
      this.pos[i3 + 1] = y + (Math.random() - 0.5) * (opts.spread || 0.6);
      this.pos[i3 + 2] = z + (Math.random() - 0.5) * (opts.spread || 0.6);
      const speed = opts.speed || 4;
      const dir = opts.dir || null;
      if (dir) {
        this.vel[i3] = dir.x * speed + (Math.random() - 0.5) * (opts.jitter || 2);
        this.vel[i3 + 1] = dir.y * speed + (Math.random() - 0.5) * (opts.jitter || 2);
        this.vel[i3 + 2] = dir.z * speed + (Math.random() - 0.5) * (opts.jitter || 2);
      } else {
        this.vel[i3] = (Math.random() - 0.5) * speed;
        this.vel[i3 + 1] = Math.random() * speed * (opts.upBias ?? 0.8);
        this.vel[i3 + 2] = (Math.random() - 0.5) * speed;
      }
      const c = Array.isArray(opts.colors) ? opts.colors[(Math.random() * opts.colors.length) | 0] : (opts.color || 0xffe135);
      this.col[i3] = ((c >> 16) & 255) / 255;
      this.col[i3 + 1] = ((c >> 8) & 255) / 255;
      this.col[i3 + 2] = (c & 255) / 255;
      this.size[idx] = (opts.size || 10) * (0.6 + Math.random() * 0.8);
      this.maxLife[idx] = (opts.life || 0.8) * (0.7 + Math.random() * 0.6);
      this.life[idx] = this.maxLife[idx];
      this.alpha[idx] = 1;
      this.grav[idx] = opts.gravity ?? 9;
      this.drag[idx] = opts.drag ?? 1.6;
    }
  }

  /** Banana peel shrapnel on damage */
  peelBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 22, spread: 0.9, speed: 9, upBias: 1.1, size: 12, life: 0.9,
      gravity: 16, drag: 0.7, colors: [0xffe135, 0xf5c71a, 0xfff2a0, 0xd9a90f],
    });
  }

  /** Potassium pop on star pickup — tiny and quick on purpose: collectibles
   *  carry ZERO glow, so the pickup feedback is a brief candy pop, never a
   *  white additive cloud. */
  starSparkle(x, y, z) {
    this.spawn(x, y, z, {
      count: 6, spread: 0.35, speed: 4, upBias: 0.45, size: 6, life: 0.3,
      gravity: -2, drag: 2.6, colors: [0xffd24a, 0xffb347],
    });
  }

  /** Obstacle smashed (Super Yellow Mode / banana missile) */
  smashBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 22, spread: 1.2, speed: 12, upBias: 0.9, size: 11, life: 0.8,
      gravity: 12, drag: 0.8, colors: [0xffe135, 0xff2e92, 0xffffff, 0xff6ec7],
    });
  }

  /** Super-mode warm pop — called rarely (mode start), no persistent trail. */
  goldenTrail(x, y, z) {
    this.spawn(x, y, z, {
      count: 6, spread: 0.5, speed: 3, upBias: 0.5, size: 7, life: 0.4,
      gravity: -1.5, drag: 2.4, colors: [0xffd24a, 0xffb347],
    });
  }

  /** Void fall purple implosion */
  voidBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 20, spread: 1.4, speed: 8, upBias: -0.6, size: 12, life: 0.75,
      gravity: -6, drag: 1.2, colors: [0x9b5de5, 0xff2e92, 0x160a2e, 0xff6ec7],
    });
  }

  /* ================= v2 COSMIC+ bursts ================= */

  /** Near-miss graze: fast white streaks whipping past the camera. */
  nearMissStreak(x, y, z) {
    this.spawn(x, y, z, {
      count: 9, spread: 0.8, dir: { x: 0, y: 0, z: 1 }, speed: 18, jitter: 3.5,
      size: 7, life: 0.24, gravity: 0, drag: 0.6, colors: [0xffffff, 0xffd9f2, 0x00ffa3],
    });
  }

  /** Golden banana jackpot explosion. */
  goldenBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 26, spread: 0.9, speed: 11, upBias: 1.0, size: 12, life: 0.85,
      gravity: 10, drag: 0.9, colors: [0xffd700, 0xfff6c8, 0xffb700, 0xffffff],
    });
  }

  /** Speed pad activation: teal ring pop. */
  speedPadBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 14, spread: 1.6, dir: { x: 0, y: 1, z: 0 }, speed: 10, jitter: 5,
      size: 10, life: 0.45, gravity: 6, drag: 1.2, colors: [0x00ffa3, 0xb6fff0, 0xffffff],
    });
  }

  /** Dive-stomp landing shockwave. */
  shockwave(x, y, z) {
    this.spawn(x, y, z, {
      count: 18, spread: 2.6, speed: 8, upBias: 0.12, size: 11, life: 0.42,
      gravity: 4, drag: 1.8, colors: [0xd8c9ff, 0xff6ec7, 0xffffff, 0x9b5de5],
    });
  }

  /** Hot toast impact crumbs. */
  toastCrumbs(x, y, z) {
    this.spawn(x, y, z, {
      count: 10, spread: 0.5, speed: 6, upBias: 0.6, size: 8, life: 0.55,
      gravity: 14, drag: 1.0, colors: [0xffb35c, 0xd9a066, 0xff5500],
    });
  }

  resetSpeedLines(playerZ) { /* removed: NO speed glow — kept as no-op for API compat */ }

  /**
   * @param {number} dt
   */
  update(dt) {
    // --- points integration ---
    const { pos, vel, life, maxLife, alpha, grav, drag } = this;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      life[i] -= dt;
      const i3 = i * 3;
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= dr;
      vel[i3 + 1] = vel[i3 + 1] * dr - grav[i] * dt;
      vel[i3 + 2] *= dr;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = Math.max(0, life[i] / maxLife[i]);
      alpha[i] = t * t * (3 - 2 * t); // smooth fade
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
  }
}
