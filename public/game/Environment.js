import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Environment
 * -----------
 * Procedural chunk manager for the infinite "Highway of Life".
 *  - Recycled 50-unit road chunks with neon edges, void gaps & warning strips
 *  - Obstacles: Monkeys, Gorilla Bosses, Electric Toasters, the Giant Blender
 *    of Fate — all merged single-draw-call meshes with cannon hitboxes
 *  - Potassium stars (distance-collected + magnetized in Super Yellow Mode)
 *  - Banana-peel slip traps (thin physics triggers → chaotic friction loss)
 *  - Cyber-tropical scenery: neon palms, floating banana moons, neon arches,
 *    synthwave grid floor, striped sun, starfield
 */

const CHUNK_LEN = 50;
const CHUNK_COUNT = 10;
const ROAD_W = 14;
const START_Z = 20;

const COL = {
  banana: 0xffe135, magenta: 0xff2e92, pink: 0xff6ec7, teal: 0x00ffa3,
  gold: 0xffd24a, purple: 0x9b5de5, trunk: 0x241338, frond: 0x0d6b4f,
};

/* ---------- tiny geometry helper: tint + transform + merge ---------- */
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

export class Environment {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./PhysicsWorld.js').PhysicsWorld} physics
   * @param {THREE.Group} bananaTemplate from AssetManager (for banana moons)
   */
  constructor(scene, physics, bananaTemplate) {
    this.scene = scene;
    this.physics = physics;
    this.chunks = [];
    this.chunkIndex = 0;
    this.nextZ = START_Z;
    this.time = 0;

    this.group = new THREE.Group();
    scene.add(this.group);

    this._buildSharedAssets(bananaTemplate);
    this._buildSky();

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const chunk = { group: new THREE.Group(), zEnd: 0, allBodies: [], obstacles: [], stars: [], anims: [], gapSpan: null, disposables: [] };
      this.group.add(chunk.group);
      this.chunks.push(chunk);
    }
    this.reset();
  }

  /* ================================================================
     SHARED ASSETS (built once)
     ================================================================ */

  _buildSharedAssets(bananaTemplate) {
    // --- road ---
    this.roadTex = this._makeRoadTexture();
    this.matRoad = new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.85, metalness: 0.15 });
    this.matEdge = new THREE.MeshStandardMaterial({ color: COL.pink, emissive: COL.magenta, emissiveIntensity: 0.85, roughness: 0.4 });
    this.geoEdge = new THREE.BoxGeometry(1, 1, 1); // scaled per segment
    this.matWarn = new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff4d00, emissiveIntensity: 1.2 });
    this.geoWarn = new THREE.BoxGeometry(ROAD_W, 0.09, 0.8);

    // --- flat colored material for merged meshes ---
    this.matFlat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
    this.matChrome = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.9 });

    // --- potassium star ---
    this.geoStar = this._makeStarGeometry();
    this.matStar = new THREE.MeshStandardMaterial({
      color: COL.gold, emissive: COL.gold, emissiveIntensity: 1.0,
      roughness: 0.3, metalness: 0.7,
    });

    // --- neon palm (silhouette + teal fronds + pink rings) ---
    this._buildPalm();

    // --- obstacles ---
    this._buildMonkey();
    this._buildGorilla();
    this._buildToaster();
    this._buildBlender();

    // --- slip-zone peel bits ---
    this.geoPeel = new THREE.BoxGeometry(0.55, 0.1, 1.05);
    this.matPeel = new THREE.MeshStandardMaterial({ color: COL.banana, emissive: 0xcaa500, emissiveIntensity: 0.22, roughness: 0.5 });

    // --- banana moons ---
    this.moonMat = new THREE.MeshStandardMaterial({ color: 0xffdf6b, emissive: 0xffca28, emissiveIntensity: 0.8, roughness: 0.5 });
    this.moonTemplate = bananaTemplate ? bananaTemplate.clone(true) : null;
    if (this.moonTemplate) {
      this.moonTemplate.traverse((o) => {
        if (o.isMesh) { o.material = this.moonMat; o.castShadow = false; }
      });
    }

    // --- neon arch ---
    this.geoArch = new THREE.TorusGeometry(8.4, 0.3, 10, 42);
    this.matArchPink = new THREE.MeshStandardMaterial({ color: COL.pink, emissive: COL.magenta, emissiveIntensity: 0.9, roughness: 0.4 });
    this.matArchTeal = new THREE.MeshStandardMaterial({ color: COL.teal, emissive: COL.teal, emissiveIntensity: 0.8, roughness: 0.4 });

    // --- grid floor ---
    this.gridTex = this._makeGridTexture();
    this.matGrid = new THREE.MeshBasicMaterial({ map: this.gridTex });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.matGrid);
    this.grid.rotation.x = -Math.PI / 2;
    this.grid.position.y = -7;
    this.scene.add(this.grid);
  }

  _makeRoadTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#171029';
    ctx.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 1100; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.3)';
      ctx.fillRect(Math.random() * 256, Math.random() * 512, 2, 2);
    }
    ctx.strokeStyle = 'rgba(255,46,146,0.22)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 256; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke(); }
    for (let y = 0; y <= 512; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,110,199,0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(5, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(251, 0); ctx.lineTo(251, 512); ctx.stroke();
    ctx.fillStyle = 'rgba(255,225,53,0.8)';
    ctx.fillRect(124, 24, 8, 110);
    ctx.fillRect(124, 276, 8, 110);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  _makeGridTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#100a20';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,46,146,0.55)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(42, 42);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeStarGeometry() {
    const shape = new THREE.Shape();
    const outer = 0.52, inner = 0.22;
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 1,
    });
    geo.center();
    return geo;
  }

  _buildPalm() {
    const trunk = new THREE.CylinderGeometry(0.16, 0.3, 5.4, 7);
    const coco = new THREE.SphereGeometry(0.22, 8, 6);
    const ring = new THREE.CylinderGeometry(0.33, 0.33, 0.09, 8);
    const frond = new THREE.PlaneGeometry(3.1, 0.8, 4, 1);
    // bend the frond into a droopy leaf
    const fp = frond.attributes.position;
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i);
      fp.setY(i, fp.getY(i) * (1 - Math.pow(Math.abs(x) / 1.55, 2) * 0.55));
      fp.setZ(i, -Math.pow(Math.abs(x) / 1.55, 2) * 0.9);
    }
    frond.computeVertexNormals();

    const silParts = [part(trunk, COL.trunk, [0, 2.7, 0])];
    const ringParts = [];
    [[1.2], [2.4], [3.6]].forEach(([h]) => ringParts.push(part(ring, 0, [0, h, 0])));
    const cocoParts = [
      part(coco, 0x3a2153, [0.3, 5.25, 0.12]),
      part(coco, 0x3a2153, [-0.25, 5.3, -0.18]),
    ];
    const frondParts = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const dir = [Math.cos(a) * 1.35, 5.4, Math.sin(a) * 1.35];
      frondParts.push(part(frond, 0, dir, [0, -a, -0.42], [1, 1, 1]));
    }
    this.geoPalmSil = mergeGeometries([...silParts, ...cocoParts], false);
    this.geoPalmRings = mergeGeometries(ringParts, false);
    this.geoPalmFronds = mergeGeometries(frondParts, false);
    this.matPalmSil = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    this.matPalmRings = new THREE.MeshStandardMaterial({ color: COL.pink, emissive: COL.magenta, emissiveIntensity: 1.1 });
    this.matPalmFronds = new THREE.MeshStandardMaterial({
      color: 0x0e2b1f, emissive: COL.teal, emissiveIntensity: 0.65, roughness: 0.6, side: THREE.DoubleSide,
    });
  }

  _buildMonkey() {
    const sph = new THREE.SphereGeometry(1, 12, 9);
    const parts = [
      part(sph, 0x8b5a2b, [0, 0.6, 0], [0, 0, 0], [0.58, 0.5, 0.52]),      // body
      part(sph, 0x9c6a35, [0, 1.28, 0], [0, 0, 0], [0.4, 0.38, 0.38]),     // head
      part(sph, 0x6e4520, [0.34, 1.28, 0.12], [0, 0, 0], [0.15, 0.15, 0.15]), // ear R
      part(sph, 0x6e4520, [-0.34, 1.28, 0.12], [0, 0, 0], [0.15, 0.15, 0.15]), // ear L
      part(sph, 0xd9a066, [0, 1.2, 0.3], [0, 0, 0], [0.2, 0.16, 0.12]),    // muzzle
      part(sph, 0x180d05, [0.12, 1.36, 0.36], [0, 0, 0], [0.05, 0.05, 0.03]), // eye R
      part(sph, 0x180d05, [-0.12, 1.36, 0.36], [0, 0, 0], [0.05, 0.05, 0.03]), // eye L
      part(new THREE.CylinderGeometry(0.07, 0.05, 0.7, 6), 0x8b5a2b, [0.4, 0.75, 0.2], [0, 0, -0.7]), // arm R
      part(new THREE.CylinderGeometry(0.07, 0.05, 0.7, 6), 0x8b5a2b, [-0.4, 0.75, 0.2], [0, 0, 0.7]),  // arm L
      part(new THREE.CylinderGeometry(0.05, 0.03, 0.9, 6), 0x8b5a2b, [0, 0.55, -0.5], [0.9, 0, 0]),    // tail
    ];
    this.geoMonkey = mergeGeometries(parts, false);
  }

  _buildGorilla() {
    const sph = new THREE.SphereGeometry(1, 14, 10);
    const parts = [
      part(sph, 0x2e2018, [0, 1.05, 0], [0, 0, 0], [1.0, 0.85, 0.8]),      // body
      part(sph, 0x241811, [0, 2.05, 0.12], [0, 0, 0], [0.52, 0.45, 0.5]),  // head
      part(new THREE.BoxGeometry(0.75, 0.2, 0.5), 0x241811, [0, 2.32, 0.2], [ -0.2, 0, 0]), // crest
      part(sph, 0x8a6843, [0, 1.62, 0.55], [0, 0, 0], [0.52, 0.4, 0.3]),   // chest
      part(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8), 0x241811, [0.62, 0.3, 0], [0, 0, 0]), // leg R
      part(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8), 0x241811, [-0.62, 0.3, 0], [0, 0, 0]), // leg L
    ];
    this.geoGorilla = mergeGeometries(parts, false);
    // arms are separate animated meshes
    this.geoGorillaArm = new THREE.CapsuleGeometry(0.24, 1.0, 4, 10);
    this.matGorillaArm = new THREE.MeshStandardMaterial({ color: 0x241811, roughness: 0.85 });
    this.geoGorillaFist = new THREE.SphereGeometry(0.3, 10, 8);
  }

  _buildToaster() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const parts = [
      part(box, 0xc9cdd6, [0, 0.5, 0], [0, 0, 0], [1.35, 0.95, 1.05]),     // chrome body
      part(box, 0x9fa6b5, [0, 0.06, 0], [0, 0, 0], [1.5, 0.14, 1.2]),      // base
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8), 0xd9a066, [0.72, 0.72, 0], [0, 0, 0]), // lever
      part(new THREE.SphereGeometry(0.09, 8, 6), 0xff2255, [-0.66, 0.86, 0.38], [0, 0, 0]), // knob R
      part(new THREE.SphereGeometry(0.09, 8, 6), 0xff2255, [-0.66, 0.86, -0.38], [0, 0, 0]), // knob L
    ];
    this.geoToaster = mergeGeometries(parts, false);
    this.matToaster = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.85 });
    // glowing slots
    const slot = new THREE.BoxGeometry(0.52, 0.1, 0.78);
    this.geoSlots = mergeGeometries([part(slot, 0, [0.3, 1.0, 0]), part(slot, 0, [-0.3, 1.0, 0])], false);
    this.matSlots = new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff4400, emissiveIntensity: 1.3 });
    // pop-up toast
    this.geoToast = new THREE.BoxGeometry(0.46, 0.3, 0.7);
    this.matToast = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.9 });
  }

  _buildBlender() {
    // glass jar
    this.geoBlenderGlass = new THREE.CylinderGeometry(1.85, 1.55, 3.7, 18, 1, true);
    this.matBlenderGlass = new THREE.MeshStandardMaterial({
      color: 0xff9de2, transparent: true, opacity: 0.26, roughness: 0.08,
      metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
    });
    // metal base + lid
    const base = new THREE.CylinderGeometry(1.95, 2.05, 0.55, 18);
    const lid = new THREE.CylinderGeometry(1.7, 1.9, 0.35, 18);
    const cap = new THREE.SphereGeometry(0.35, 10, 8);
    this.geoBlenderMetal = mergeGeometries([
      part(base, 0xb9bfd0, [0, 0.28, 0]),
      part(lid, 0xb9bfd0, [0, 4.05, 0]),
      part(cap, 0xff2e92, [0, 4.35, 0]),
    ], false);
    this.matBlenderMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.85 });
    // spinning fate blades
    const fin = new THREE.BoxGeometry(0.16, 1.5, 0.42);
    this.geoBlades = mergeGeometries([
      part(fin, 0, [0, 0.95, 0], [0, 0, 0]),
      part(fin, 0, [0, 0.95, 0], [0, Math.PI / 2, 0]),
      part(fin, 0, [0, 0.95, 0], [0, Math.PI / 4, 0]),
      part(fin, 0, [0, 0.95, 0], [0, (Math.PI * 3) / 4, 0]),
    ], false);
    this.matBlades = new THREE.MeshStandardMaterial({ color: 0x4a2a6b, emissive: COL.purple, emissiveIntensity: 1.0, metalness: 0.7, roughness: 0.3 });
    // glowing smoothie vortex inside
    this.geoSmoothie = new THREE.CylinderGeometry(1.5, 1.25, 2.4, 16);
    this.matSmoothie = new THREE.MeshStandardMaterial({ color: 0xff2e92, emissive: 0xff2e92, emissiveIntensity: 0.8, transparent: true, opacity: 0.4 });
  }

  /* ================================================================
     SKY
     ================================================================ */

  _buildSky() {
    // striped synthwave sun
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#ffe95c');
    grad.addColorStop(0.45, '#ff9d2e');
    grad.addColorStop(1, '#ff2e92');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    let y = 128;
    for (let i = 0; i < 6; i++) {
      const h = 3 + i * 2.6;
      ctx.fillRect(0, y, 256, h);
      y += h + 20 - i * 2;
    }
    const sunTex = new THREE.CanvasTexture(c);
    sunTex.colorSpace = THREE.SRGBColorSpace;
    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.sun.renderOrder = -10;
    this.scene.add(this.sun);

    // starfield
    const N = 700;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const palette = [new THREE.Color(0xffffff), new THREE.Color(0xffd6f0), new THREE.Color(0xb6fff0), new THREE.Color(0xfff3b0)];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.asin(Math.random() * 0.95); // upper hemisphere bias
      const r = 280 + Math.random() * 50;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      pos[i * 3 + 1] = Math.sin(el) * r * 0.9 + 10;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
      const c2 = palette[(Math.random() * palette.length) | 0];
      col[i * 3] = c2.r; col[i * 3 + 1] = c2.g; col[i * 3 + 2] = c2.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starfield = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.8, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, fog: false, depthWrite: false,
    }));
    this.starfield.renderOrder = -11;
    this.scene.add(this.starfield);
  }

  /* ================================================================
     CHUNK GENERATION
     ================================================================ */

  reset() {
    this.chunkIndex = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      chunk.zEnd = START_Z - i * CHUNK_LEN;
      this._generate(chunk, 0, i);
    }
    this.nextZ = START_Z - this.chunks.length * CHUNK_LEN;
  }

  _recycle(chunk, difficulty) {
    chunk.zEnd = this.nextZ;
    this.nextZ -= CHUNK_LEN;
    this._generate(chunk, difficulty, this.chunkIndex++);
  }

  _generate(chunk, D, index) {
    // ---- clear previous content ----
    for (const b of chunk.allBodies) this.physics.removeBody(b);
    chunk.allBodies.length = 0;
    chunk.obstacles.length = 0;
    chunk.stars.length = 0;
    chunk.anims.length = 0;
    for (const d of chunk.disposables) d.dispose();
    chunk.disposables.length = 0;
    chunk.group.clear();
    chunk.gapSpan = null;

    const zEnd = chunk.zEnd;
    chunk.group.position.z = zEnd; // children use local z in [-CHUNK_LEN, 0]

    const rng = Math.random;
    const safeRunway = index < 2;

    // ---- void gap layout ----
    let gapLocal = null;
    if (!safeRunway && index > 3 && rng() < Math.min(0.07 + D * 0.24, 0.33)) {
      const gapLen = 7 + D * 5;
      const gz = -(12 + rng() * (CHUNK_LEN - 26 - gapLen));
      gapLocal = { near: gz, far: gz - gapLen };
    }

    // ---- solid road segments ----
    const segments = [];
    if (gapLocal) {
      segments.push({ z0: 0, z1: gapLocal.near });
      segments.push({ z0: gapLocal.far, z1: -CHUNK_LEN });
    } else {
      segments.push({ z0: 0, z1: -CHUNK_LEN });
    }
    for (const seg of segments) {
      if (seg.z0 - seg.z1 < 1) continue; // skip degenerate segments (length is z0 - z1)
      const len = seg.z0 - seg.z1;
      const mid = (seg.z0 + seg.z1) / 2;
      const worldMid = zEnd + mid;
      // road plane
      const geo = new THREE.PlaneGeometry(ROAD_W, len);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (len / 10));
      const road = new THREE.Mesh(geo, this.matRoad);
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0, mid);
      road.receiveShadow = true;
      chunk.group.add(road);
      chunk.disposables.push(geo);
      // physics slab (top at y=0)
      chunk.allBodies.push(this.physics.addStaticBox(
        { x: ROAD_W / 2, y: 0.5, z: len / 2 }, { x: 0, y: -0.5, z: worldMid }, { kind: 'ground' }
      ));
      // neon edge strips
      for (const sx of [-ROAD_W / 2 + 0.15, ROAD_W / 2 - 0.15]) {
        const strip = new THREE.Mesh(this.geoEdge, this.matEdge);
        strip.scale.set(0.3, 0.17, len);
        strip.position.set(sx, 0.08, mid);
        chunk.group.add(strip);
      }
    }

    // gap warning strips + span bookkeeping
    if (gapLocal) {
      for (const gz of [gapLocal.near + 0.4, gapLocal.far - 0.4]) {
        const w = new THREE.Mesh(this.geoWarn, this.matWarn);
        w.position.set(0, 0.045, gz);
        chunk.group.add(w);
      }
      chunk.gapSpan = { zNear: zEnd + gapLocal.near, zFar: zEnd + gapLocal.far };
    }

    if (safeRunway) {
      this._addScenery(chunk, rng);
      this._addStarLine(chunk, rng, D, null);
      return;
    }

    // ---- slip zones (banana peel traps) ----
    const slipZones = [];
    if (rng() < 0.22 + D * 0.16) {
      const patchZ = -(8 + rng() * (CHUNK_LEN - 18));
      if (!this._inGap(gapLocal, patchZ, 6)) {
        const px = (rng() - 0.5) * 6.4;
        const half = { x: 2.7, y: 0.09, z: 4.2 };
        const body = this.physics.addStaticBox(half, { x: px, y: 0.1, z: zEnd + patchZ }, {
          kind: 'slipzone', material: this.physics.groundMaterial, userData: { chunk, id: rng() },
        });
        chunk.allBodies.push(body);
        slipZones.push(patchZ);
        // scattered peel bits
        const nPeels = 7 + ((rng() * 3) | 0);
        for (let i = 0; i < nPeels; i++) {
          const peel = new THREE.Mesh(this.geoPeel, this.matPeel);
          peel.position.set(px + (rng() - 0.5) * 4.6, 0.06, patchZ + (rng() - 0.5) * 7);
          peel.rotation.set(0, rng() * Math.PI * 2, (rng() - 0.5) * 0.25);
          peel.scale.setScalar(0.8 + rng() * 0.5);
          chunk.group.add(peel);
        }
      }
    }

    // ---- obstacles ----
    const count = 2 + Math.round(D * 3) + (D > 0.55 && rng() < 0.35 ? 1 : 0);
    const placed = [];
    for (let i = 0; i < count; i++) {
      let lz = null;
      for (let attempt = 0; attempt < 26; attempt++) {
        const z = -(5 + rng() * (CHUNK_LEN - 10));
        if (this._inGap(gapLocal, z, 7)) continue;
        if (slipZones.some((s) => Math.abs(s - z) < 6)) continue;
        if (placed.some((s) => Math.abs(s - z) < 8.5)) continue;
        lz = z;
        break;
      }
      if (lz === null) continue;
      placed.push(lz);
      const type = this._pickObstacleType(D, rng, placed.length === 1);
      this._addObstacle(chunk, type, lz, rng, D);
    }

    // ---- potassium star lines ----
    if (rng() < 0.68) this._addStarLine(chunk, rng, D, gapLocal);

    // ---- scenery ----
    this._addScenery(chunk, rng);
  }

  _inGap(gapLocal, z, margin) {
    return !!gapLocal && z < gapLocal.near + margin && z > gapLocal.far - margin;
  }

  _pickObstacleType(D, rng, first) {
    const entries = [
      ['monkey', 10],
      ['toaster', D > 0.08 ? 7 : 0],
      ['blender', D > 0.18 ? 4 + D * 5 : 0],
      ['gorilla', D > 0.3 && first ? 3.5 : 0],
    ];
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = rng() * total;
    for (const [t, w] of entries) { r -= w; if (r <= 0) return t; }
    return 'monkey';
  }

  _addObstacle(chunk, type, lz, rng, D) {
    const zEnd = chunk.zEnd;
    let mesh, body, damage = 1, knock = 7;

    if (type === 'monkey') {
      mesh = new THREE.Mesh(this.geoMonkey, this.matFlat);
      mesh.castShadow = true;
      const x = (rng() - 0.5) * 8.8;
      mesh.position.set(x, 0, lz);
      const phase = rng() * 9;
      chunk.anims.push((t) => {
        mesh.position.y = Math.abs(Math.sin(t * 2.2 + phase)) * 0.22;
        mesh.rotation.z = Math.sin(t * 1.6 + phase) * 0.07;
      });
      body = this.physics.addStaticBox({ x: 0.62, y: 0.75, z: 0.6 }, { x, y: 0.75, z: zEnd + lz }, { userData: { type } });
    } else if (type === 'gorilla') {
      mesh = new THREE.Group();
      const g = new THREE.Mesh(this.geoGorilla, this.matFlat);
      g.castShadow = true;
      mesh.add(g);
      const arms = [];
      for (const sx of [0.95, -0.95]) {
        const arm = new THREE.Group();
        const am = new THREE.Mesh(this.geoGorillaArm, this.matGorillaArm);
        am.position.y = -0.65;
        am.castShadow = true;
        const fist = new THREE.Mesh(this.geoGorillaFist, this.matGorillaArm);
        fist.position.y = -1.35;
        arm.add(am, fist);
        arm.position.set(sx, 1.95, 0.15);
        mesh.add(arm);
        arms.push(arm);
      }
      const x = rng() < 0.5 ? -3.1 : 3.1;
      mesh.position.set(x, 0, lz);
      const phase = rng() * 9;
      chunk.anims.push((t) => {
        const thump = Math.max(0, Math.sin(t * 0.9 + phase));
        const swing = Math.sin(t * 3 + phase) * 0.45;
        arms[0].rotation.x = thump > 0.94 ? -2.4 : swing;
        arms[1].rotation.x = thump > 0.94 ? -2.4 : -swing;
        mesh.position.y = Math.abs(Math.sin(t * 2 + phase)) * 0.12;
      });
      damage = 2; knock = 11;
      body = this.physics.addStaticBox({ x: 1.05, y: 1.35, z: 0.85 }, { x, y: 1.35, z: zEnd + lz }, { userData: { type } });
    } else if (type === 'toaster') {
      mesh = new THREE.Group();
      const tm = new THREE.Mesh(this.geoToaster, this.matToaster);
      tm.castShadow = true;
      const slots = new THREE.Mesh(this.geoSlots, this.matSlots);
      slots.position.y = 0.0;
      const toasts = [];
      for (const tx of [0.3, -0.3]) {
        const toast = new THREE.Mesh(this.geoToast, this.matToast);
        toast.position.set(tx, 0.85, 0);
        toasts.push(toast);
        mesh.add(toast);
      }
      mesh.add(tm, slots);
      const x = (rng() - 0.5) * 8.6;
      mesh.position.set(x, 0, lz);
      const phase = rng() * 9;
      chunk.anims.push((t) => {
        const pop = Math.max(0, Math.sin(t * 1.7 + phase));
        const h = 0.85 + Math.pow(pop, 3) * 0.75;
        toasts[0].position.y = h;
        toasts[1].position.y = 0.85 + Math.pow(Math.max(0, Math.sin(t * 1.7 + phase + 0.7)), 3) * 0.75;
        slots.material.emissiveIntensity = 1.05 + Math.pow(pop, 4) * 1.6;
      });
      body = this.physics.addStaticBox({ x: 0.75, y: 0.55, z: 0.62 }, { x, y: 0.55, z: zEnd + lz }, { userData: { type } });
    } else {
      // blender of fate
      mesh = new THREE.Group();
      const glass = new THREE.Mesh(this.geoBlenderGlass, this.matBlenderGlass);
      glass.position.y = 2.35;
      const metal = new THREE.Mesh(this.geoBlenderMetal, this.matBlenderMetal);
      metal.castShadow = true;
      const blades = new THREE.Mesh(this.geoBlades, this.matBlades);
      blades.position.y = 1.0;
      const smoothie = new THREE.Mesh(this.geoSmoothie, this.matSmoothie);
      smoothie.position.y = 1.5;
      mesh.add(glass, metal, blades, smoothie);
      const x = (rng() - 0.5) * 4.6;
      mesh.position.set(x, 0, lz);
      chunk.anims.push((t, dt) => {
        blades.rotation.y += 15 * dt;
        smoothie.rotation.y -= 4 * dt;
      });
      knock = 13;
      body = this.physics.addStaticCylinder(2.0, 4.1, { x, y: 2.05, z: zEnd + lz }, { userData: { type } });
    }

    chunk.group.add(mesh);
    body.userData.kind = 'obstacle';
    body.userData.damage = damage;
    body.userData.knock = knock;
    body.userData.mesh = mesh;
    body.userData.chunk = chunk;
    body.userData.dead = false;
    const obstacle = { mesh, body, dead: false };
    chunk.obstacles.push(obstacle);
    chunk.allBodies.push(body);
  }

  _addStarLine(chunk, rng, D, gapLocal) {
    const n = 6 + ((rng() * 3) | 0);
    const pattern = rng();
    const startX = (rng() - 0.5) * 8;
    const startZ = -(6 + rng() * (CHUNK_LEN - 16));
    const spacing = 2.3;
    for (let i = 0; i < n; i++) {
      let x = startX, y = 1.35, z = startZ - i * spacing;
      if (pattern < 0.36) {
        y = 1.35 + Math.sin((i / (n - 1)) * Math.PI) * 2.2; // arc
        x = startX + Math.sin((i / (n - 1)) * Math.PI) * 1.6;
      } else if (pattern < 0.62) {
        x = startX + Math.sin(i * 0.85) * 2.4; // sine weave
      }
      // straight lines skip gap sections; arcs are allowed to float over gaps
      if (pattern >= 0.36 && this._inGap(gapLocal, z, 1)) continue;
      const mesh = new THREE.Mesh(this.geoStar, this.matStar);
      const phase = rng() * 9;
      const baseY = y;
      mesh.position.set(x, y, z);
      mesh.rotation.z = rng() * Math.PI;
      chunk.group.add(mesh);
      const star = { mesh, wx: x, wy: y, wz: chunk.zEnd + z, baseY, phase, collected: false };
      chunk.stars.push(star);
      chunk.anims.push((t, dt) => {
        if (star.collected) return;
        mesh.rotation.y += 2.6 * dt;
        mesh.position.y = star.baseY + Math.sin(t * 2.4 + phase) * 0.26;
        star.wy = mesh.position.y;
      });
    }
  }

  _addScenery(chunk, rng) {
    // neon palms
    const palmsPerSide = 2 + ((rng() * 4) | 0);
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < palmsPerSide; i++) {
        const sgn = side === 0 ? -1 : 1;
        const x = sgn * (10.5 + rng() * 13);
        const z = -(4 + rng() * (CHUNK_LEN - 8));
        const palm = new THREE.Group();
        const sil = new THREE.Mesh(this.geoPalmSil, this.matPalmSil);
        sil.castShadow = true;
        const rings = new THREE.Mesh(this.geoPalmRings, this.matPalmRings);
        const fronds = new THREE.Mesh(this.geoPalmFronds, this.matPalmFronds);
        palm.add(sil, rings, fronds);
        palm.position.set(x, 0, z);
        palm.rotation.y = rng() * Math.PI * 2;
        palm.scale.setScalar(0.8 + rng() * 0.55);
        chunk.group.add(palm);
      }
    }
    // floating banana moons
    if (rng() < 0.3 && this.moonTemplate) {
      const moon = this.moonTemplate.clone(true);
      moon.traverse((o) => { if (o.isMesh) o.material = this.moonMat; });
      const sgn = rng() < 0.5 ? -1 : 1;
      moon.position.set(sgn * (16 + rng() * 26), 17 + rng() * 14, -(10 + rng() * (CHUNK_LEN - 20)));
      moon.scale.setScalar(5.5 + rng() * 4);
      moon.rotation.z = (rng() - 0.5) * 1.2;
      chunk.group.add(moon);
      const rot = 0.15 + rng() * 0.25;
      chunk.anims.push((t, dt) => { moon.rotation.y += rot * dt; });
    }
    // neon arch
    if (rng() < 0.24) {
      const arch = new THREE.Mesh(this.geoArch, rng() < 0.5 ? this.matArchPink : this.matArchTeal);
      arch.position.set(0, 0, -(8 + rng() * (CHUNK_LEN - 16)));
      chunk.group.add(arch);
    }
  }

  /* ================================================================
     RUNTIME
     ================================================================ */

  /** Remove an obstacle (Super Yellow Mode smash). */
  smashObstacle(body) {
    if (!body.userData || body.userData.dead) return null;
    body.userData.dead = true;
    const mesh = body.userData.mesh;
    const pos = mesh ? mesh.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    if (mesh) mesh.visible = false;
    this.physics.removeBody(body);
    const ob = (body.userData.chunk && body.userData.chunk.obstacles || []).find((o) => o.body === body);
    if (ob) ob.dead = true;
    return pos;
  }

  /** A z position ahead of fromZ guaranteed to be solid road. */
  findSafeZ(fromZ) {
    let z = fromZ - 13;
    for (let iter = 0; iter < 4; iter++) {
      for (const chunk of this.chunks) {
        if (!chunk.gapSpan) continue;
        const g = chunk.gapSpan;
        if (z < g.zNear + 5 && z > g.zFar - 5) z = g.zFar - 7;
      }
    }
    return z;
  }

  /**
   * @param {number} dt
   * @param {{playerPos:THREE.Vector3, camera:THREE.Camera, canCollect:boolean,
   *          superMode:boolean, onStar:Function, difficulty:number, time:number}} ctx
   */
  update(dt, ctx) {
    this.time += dt;
    const t = ctx.time;
    const pz = ctx.playerPos.z;
    const px = ctx.playerPos.x;
    const py = ctx.playerPos.y;

    // ---- recycle chunks that fell behind ----
    for (const chunk of this.chunks) {
      if (chunk.zEnd - CHUNK_LEN > pz + 26) this._recycle(chunk, ctx.difficulty);
    }

    // ---- animate & collect ----
    for (const chunk of this.chunks) {
      for (const anim of chunk.anims) anim(t, dt);
      if (!ctx.canCollect) continue;
      for (const star of chunk.stars) {
        if (star.collected) continue;
        const dx = star.wx - px, dy = star.wy - py, dz = star.wz - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (ctx.superMode && d2 < 90) {
          const d = Math.sqrt(d2) || 1;
          const k = Math.min(1, (dt * 20) / d);
          star.wx += (px - star.wx) * k;
          star.wy += (py - star.wy) * k;
          star.wz += (pz - star.wz) * k;
          star.mesh.position.set(star.wx, star.wy, star.wz - chunk.zEnd);
          if (d < 2.4) this._collect(star, ctx);
        } else if (d2 < 2.9) {
          this._collect(star, ctx);
        }
      }
    }

    // ---- world-fixed grid floor follows the runner ----
    this.grid.position.z = pz;
    this.gridTex.offset.y = -pz / 10;

    // ---- sky follows camera ----
    const cp = ctx.camera.position;
    this.sun.position.set(cp.x * 0.25, 30 + cp.y * 0.1, cp.z - 300);
    this.starfield.position.copy(cp);
  }

  _collect(star, ctx) {
    star.collected = true;
    star.mesh.visible = false;
    if (ctx.onStar) ctx.onStar(star);
  }
}
