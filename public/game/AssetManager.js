import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * AssetManager
 * ------------
 * Loads the banana hero model with a resilient multi-source chain:
 *   1. Local vendored CC0 GLB (Kenney Food Kit, mirrored on GitHub)
 *   2. The remote GLTF URL from the design doc (three.js repo)
 *   3. Fully procedural banana mesh (TubeGeometry, tapered + curved,
 *      brown tip caps) — the game never fails to boot.
 *
 * Reports progress (0..1) for the loading screen via onProgress.
 */

const BANANA_SOURCES = [
  { url: './assets/banana.glb', label: 'local CC0 (Kenney Food Kit)' },
  { url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Banana/Banana.gltf', label: 'three.js repo' },
];

const TARGET_HEIGHT = 1.7; // world units, long axis

export class AssetManager {
  constructor() {
    this.bananaTemplate = null; // THREE.Group (normalized)
    this.bananaSource = 'procedural';
    this.bananaBodyGeometry = null; // main geometry, for peel shells
    this._onProgress = null;
  }

  /**
   * @param {(p:number, label:string)=>void} onProgress progress 0..1
   * @returns {Promise<{bananaTemplate:THREE.Group, source:string}>}
   */
  loadAll(onProgress) {
    this._onProgress = onProgress;
    return this._loadBanana().then((template) => {
      this.bananaTemplate = template;
      onProgress(1, 'ready');
      return { bananaTemplate: template, source: this.bananaSource };
    });
  }

  _report(p, label) {
    if (this._onProgress) this._onProgress(Math.min(1, Math.max(0, p)), label);
  }

  _loadBanana() {
    return new Promise((resolve) => {
      const loader = new GLTFLoader();
      let index = 0;
      const timeoutMs = 8000;
      let settled = false;

      const tryNext = () => {
        if (index >= BANANA_SOURCES.length) {
          // All remote sources failed -> procedural fallback (always works)
          console.warn('[AssetManager] All GLTF sources failed — building procedural banana.');
          this.bananaSource = 'procedural';
          resolve(this._buildProceduralBanana());
          return;
        }
        const source = BANANA_SOURCES[index++];

        const cleanup = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

        const onSuccess = (gltf) => {
          if (settled) return;
          settled = true; cleanup();
          this.bananaSource = source.url.startsWith('http') ? 'remote-gltf' : 'local-glb';
          try {
            resolve(this._normalizeBanana(gltf.scene));
          } catch (err) {
            console.warn('[AssetManager] normalize failed, using procedural banana.', err);
            this.bananaSource = 'procedural';
            resolve(this._buildProceduralBanana());
          }
        };

        const onFail = () => {
          if (settled) return;
          cleanup();
          console.warn(`[AssetManager] Source failed: ${source.label} (${source.url})`);
          tryNext();
        };

        const onProgress = (evt) => {
          if (evt.total > 0) {
            const p = 0.25 + 0.55 * ((index - 1 + evt.loaded / evt.total) / BANANA_SOURCES.length);
            this._report(p, `banana: ${source.label}`);
          }
        };

        let timer = setTimeout(onFail, timeoutMs);
        this._report(0.25 + 0.55 * (index - 1) / BANANA_SOURCES.length, `banana: ${source.label}`);
        loader.load(source.url, onSuccess, onProgress, onFail);
      };

      tryNext();
    });
  }

  /**
   * Center + scale + orient the loaded model so its longest axis is Y,
   * total height ~ TARGET_HEIGHT. Enables shadows & a subtle glow.
   */
  _normalizeBanana(scene) {
    const group = new THREE.Group();
    group.add(scene);

    // Orient longest axis to Y
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const axes = [size.x, size.y, size.z];
    const longest = Math.max(...axes);
    if (longest === size.z) {
      scene.rotation.x = -Math.PI / 2; // +Z -> +Y
    } else if (longest === size.x) {
      scene.rotation.z = Math.PI / 2; // +X -> +Y
    }

    // Uniform scale to target height
    const scale = TARGET_HEIGHT / longest;
    scene.scale.setScalar(scale);

    // Re-center vertically on origin
    const box2 = new THREE.Box3().setFromObject(scene);
    const center = box2.getCenter(new THREE.Vector3());
    scene.position.set(-center.x, -center.y, -center.z);

    // Material polish: warmer glow so the hero pops in the synthwave scene
    scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = false;
        if (obj.material && obj.material.isMeshStandardMaterial) {
          obj.material.roughness = Math.min(obj.material.roughness, 0.55);
          obj.material.emissive = new THREE.Color(0x3a2a05);
          obj.material.emissiveIntensity = 0.35;
          if (!this.bananaBodyGeometry) this.bananaBodyGeometry = obj.geometry;
        }
      }
    });
    return group;
  }

  /**
   * Procedural fallback banana — curved tapered tube + ridged profile +
   * brown stem tip caps. Used when every GLTF source fails.
   */
  _buildProceduralBanana() {
    const group = new THREE.Group();
    const inner = new THREE.Group();

    // Banana spine: an arc bending toward +X while running along Y
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0, -0.85, 0),
      new THREE.Vector3(0.22, -0.35, 0),
      new THREE.Vector3(0.42, 0.15, 0),
      new THREE.Vector3(0.34, 0.6, 0),
      new THREE.Vector3(0.1, 0.9, 0),
    ]);

    const TUBULAR = 28;
    const RADIAL = 12;
    const tube = new THREE.TubeGeometry(curve, TUBULAR, 0.34, RADIAL, false);

    // Taper the tube radially: fat belly, narrow tips + subtle lengthwise ridges
    const pos = tube.attributes.position;
    const ringVerts = RADIAL + 1;
    const curvePoint = new THREE.Vector3();
    const radial = new THREE.Vector3();
    for (let v = 0; v < pos.count; v++) {
      const ring = Math.floor(v / ringVerts);
      const t = ring / TUBULAR;
      curve.getPointAt(t, curvePoint);
      radial.set(pos.getX(v) - curvePoint.x, pos.getY(v) - curvePoint.y, pos.getZ(v) - curvePoint.z);
      const angle = Math.atan2(radial.z, radial.x);
      const profile =
        0.16 + 0.9 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.55);
      const ridge = 1 + 0.07 * Math.cos(angle * 5); // ridged cross-section
      const k = profile * ridge;
      pos.setXYZ(v, curvePoint.x + radial.x * k, curvePoint.y + radial.y * k, curvePoint.z + radial.z * k);
    }
    tube.computeVertexNormals();

    const bananaMat = new THREE.MeshStandardMaterial({
      color: 0xffe135,
      roughness: 0.4,
      metalness: 0.05,
      emissive: 0x3a2a05,
      emissiveIntensity: 0.35,
    });
    const body = new THREE.Mesh(tube, bananaMat);
    body.castShadow = true;
    inner.add(body);
    this.bananaBodyGeometry = tube;

    // Brown tip caps
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x6b4415, roughness: 0.85 });
    const capBottom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), tipMat);
    capBottom.position.copy(curve.getPointAt(0));
    capBottom.scale.set(1, 1.5, 1);
    const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), tipMat);
    capTop.position.copy(curve.getPointAt(1));
    capTop.scale.set(1, 1.7, 1);
    capBottom.castShadow = capTop.castShadow = true;
    inner.add(capBottom, capTop);

    inner.scale.setScalar(TARGET_HEIGHT / 1.9);
    const box = new THREE.Box3().setFromObject(inner);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.set(-center.x, -center.y, -center.z);
    group.add(inner);
    return group;
  }

  /** Clone the hero banana for the player (geometry shared, materials cloned). */
  cloneBanana() {
    const clone = this.bananaTemplate.clone(true);
    clone.traverse((obj) => {
      if (obj.isMesh && obj.material) obj.material = obj.material.clone();
    });
    return clone;
  }
}
