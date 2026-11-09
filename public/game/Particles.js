import * as THREE from 'three';

/**
 * Particles
 * ---------
 * Pooled CPU particle system on THREE.Points — RETRO GLITCH confetti:
 * hard-edged pixel chips (dark rim + coloured core, nearest filtering)
 * composited with NORMAL blending. It is matter, not light: no additive
 * pass, no soft radial glow sprite, so collect pops and double-jump bursts
 * can physically never brighten or wash the screen.
 *   - peel debris / potassium pops / golden jackpots / boss impacts
 *   - MEGA BONUS confetti storms
 * Speed FEEL comes from FOV + camera; brightness never moves.
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
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

function makeSpriteTexture() {
  // RETRO GLITCH chip: a hard-edged square pixel with a dark rim. The rim
  // multiplies the particle colour (see _FRAG) so every chip reads as a
  // matte 8-bit confetti bit — outline and all — never as a glowing orb.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(10,4,26,0.92)';
  ctx.fillRect(6, 6, 52, 52);      // dark rim / outline
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(12, 12, 40, 40);    // white core (tinted per particle)
  // cut the corners: chunky 8-bit silhouette
  ctx.fillStyle = 'rgba(10,4,26,0.92)';
  ctx.fillRect(6, 6, 5, 5); ctx.fillRect(53, 6, 5, 5);
  ctx.fillRect(6, 53, 5, 5); ctx.fillRect(53, 53, 5, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
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

    // NORMAL blending: matte confetti composited over the world. The old
    // additive pass IS what read as "glow on collect / double jump" — it
    // is gone for good. Glow belongs to the road edges and nothing else.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: makeSpriteTexture() } },
      vertexShader: _VERT,
      fragmentShader: _FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
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

  /** Potassium pop on star pickup — a tiny candy-chip pop. Collectibles
   *  carry ZERO light: no additive cloud, no white bloom, ever. */
  starSparkle(x, y, z) {
    this.spawn(x, y, z, {
      count: 7, spread: 0.35, speed: 4.5, upBias: 0.5, size: 7, life: 0.34,
      gravity: -2, drag: 2.8, colors: [0xffcf3f, 0xffb347, 0xe3be1a],
    });
  }

  /** Obstacle smashed (Super Yellow Mode / banana missile) */
  smashBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 22, spread: 1.2, speed: 12, upBias: 0.9, size: 11, life: 0.8,
      gravity: 12, drag: 0.8, colors: [0xffe135, 0xff2e92, 0xff6ec7, 0xc9a80f],
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

  /** Near-miss graze: quick chips whipping past the camera. */
  nearMissStreak(x, y, z) {
    this.spawn(x, y, z, {
      count: 9, spread: 0.8, dir: { x: 0, y: 0, z: 1 }, speed: 18, jitter: 3.5,
      size: 7, life: 0.24, gravity: 0, drag: 0.6, colors: [0xcfd8ff, 0xffd9f2, 0x00ffa3],
    });
  }

  /** Golden banana jackpot explosion. */
  goldenBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 26, spread: 0.9, speed: 11, upBias: 1.0, size: 12, life: 0.85,
      gravity: 10, drag: 0.9, colors: [0xffd700, 0xfff1c4, 0xffb700, 0xffe135],
    });
  }

  /** Speed pad activation: teal ring pop. */
  speedPadBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 14, spread: 1.6, dir: { x: 0, y: 1, z: 0 }, speed: 10, jitter: 5,
      size: 10, life: 0.45, gravity: 6, drag: 1.2, colors: [0x00ffa3, 0x00c97b, 0x39d0ff],
    });
  }

  /** Dive-stomp landing shockwave. */
  shockwave(x, y, z) {
    this.spawn(x, y, z, {
      count: 18, spread: 2.6, speed: 8, upBias: 0.12, size: 11, life: 0.42,
      gravity: 4, drag: 1.8, colors: [0x9b5de5, 0xff6ec7, 0x39d0ff],
    });
  }

  /** Hot toast impact crumbs. */
  toastCrumbs(x, y, z) {
    this.spawn(x, y, z, {
      count: 10, spread: 0.5, speed: 6, upBias: 0.6, size: 8, life: 0.55,
      gravity: 14, drag: 1.0, colors: [0xffb35c, 0xd9a066, 0xff5500],
    });
  }

  /* ================= v4 BOSS & MEGA BONUS confetti ================= */

  /** MEGA BONUS confetti storm (boss kill): a fat multicoloured pixel rain. */
  bonusStorm(x, y, z, count = 60) {
    this.spawn(x, y, z, {
      count, spread: 3.4, speed: 15, upBias: 1.5, size: 13, life: 1.3,
      gravity: 9, drag: 0.55, colors: [0xffe135, 0xff2e92, 0x00ffa3, 0xffd700, 0xfff1c4, 0x9b5de5],
    });
  }

  /** Boss takes a banana missile: fur + banana chips. */
  bossHitBurst(x, y, z) {
    this.spawn(x, y, z, {
      count: 20, spread: 1.1, speed: 11, upBias: 1.0, size: 12, life: 0.7,
      gravity: 11, drag: 0.8, colors: [0x8b5a2b, 0xffe135, 0xff2e92, 0x5e3d1f],
    });
  }

  /** Boss coconut shatters on the banana. */
  coconutBits(x, y, z) {
    this.spawn(x, y, z, {
      count: 10, spread: 0.4, speed: 7, upBias: 0.8, size: 9, life: 0.5,
      gravity: 14, drag: 1.0, colors: [0x8b5a2b, 0x6e4520, 0xd9a066],
    });
  }

  /** Boss barrel shatters on the banana. */
  barrelBits(x, y, z) {
    this.spawn(x, y, z, {
      count: 14, spread: 0.6, speed: 8, upBias: 0.9, size: 10, life: 0.6,
      gravity: 13, drag: 0.9, colors: [0x7a4a1d, 0x9c6a35, 0xffe135],
    });
  }

  /** PEEL PATCH first-aid kit pickup. */
  patchPop(x, y, z) {
    this.spawn(x, y, z, {
      count: 12, spread: 0.5, speed: 6, upBias: 1.0, size: 9, life: 0.55,
      gravity: 5, drag: 1.4, colors: [0xfff1c4, 0xff2e92, 0x00ffa3],
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
