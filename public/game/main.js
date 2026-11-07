import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';

import { AssetManager } from './AssetManager.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Player } from './Player.js';
import { Environment } from './Environment.js';
import { Particles } from './Particles.js';
import { SoundManager } from './SoundManager.js';
import { GameLogic, State } from './GameLogic.js';

/**
 * main.js — bootstraps the Cosmic Slip: renderer, cinematic lighting,
 * post-processing stack (bloom + chromatic aberration), the fixed-timestep
 * game loop with slow-mo juice, camera choreography, input bindings
 * (keyboard + touch), resize handling and UI wiring.
 */

const FOG_COLOR = 0x160a2e;

class Game {
  constructor() {
    this.container = document.getElementById('game-container');
    this.timeScale = 1;
    this.slowTimer = 0;
    this.slowScale = 1;
    this.shakeAmp = 0;
    this.rgbPulse = 0;
    this.envTime = 0;
    this.fov = 72;
    this.camRoll = 0;
    this.bloomPulse = 0;
    this._lastT = performance.now();
    this._quality = 2;      // adaptive quality steps (2 = full)
    this._fpsAcc = 0;
    this._fpsFrames = 0;

    this._initRenderer();
    this._initScene();
    this._initPostFX();
    this._bindUI();
  }

  _initRenderer() {
    try {
      if (!window.WebGL2RenderingContext) throw new Error('WebGL2 unavailable');
      this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    } catch (err) {
      console.error('[main] WebGL init failed:', err);
      document.getElementById('webgl-error').classList.remove('hidden');
      document.getElementById('loading-screen').classList.add('hidden');
      this.dead = true;
      return;
    }
    // Cap at 1.5: full 2x DPR quadruples the pixels the bloom pass has to
    // chew on and is the #1 cause of frame drops (and the slow-motion that
    // comes with it) on mid-range GPUs / laptops.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.container.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0115);

    this.camera = new THREE.PerspectiveCamera(70, this.container.clientWidth / this.container.clientHeight, 0.1, 700);
    this.camera.position.set(0, 6, 12);

    // ---- cinematic 3-point lighting ----
    // key: warm sun
    this.keyLight = new THREE.DirectionalLight(0xfff2cf, 2.3);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    const sc = this.keyLight.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 90;
    this.keyLight.shadow.bias = -0.0006;
    this.scene.add(this.keyLight, this.keyLight.target);
    // fill: magenta/dark-green hemisphere
    this.scene.add(new THREE.HemisphereLight(0xb0486e, 0x0a1f14, 0.65));
    // rim: tropical teal back light
    this.rimLight = new THREE.DirectionalLight(0x00ffa3, 1.1);
    this.rimLight.position.set(-6, 7, -16);
    this.scene.add(this.rimLight);
    this.scene.add(new THREE.AmbientLight(0x2a1f3d, 0.55));
  }

  _initPostFX() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 2, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // Tamer glow: higher threshold so only true highlights bloom, lower
    // strength + radius so the scene stays readable instead of drowning
    // in neon haze.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.45, 0.85);
    this.composer.addPass(this.bloom);
    this.rgbPass = new ShaderPass(RGBShiftShader);
    this.rgbPass.uniforms.amount.value = 0.0006;
    this.rgbPass.uniforms.angle.value = 0.6;
    this.composer.addPass(this.rgbPass);
    this.composer.addPass(new OutputPass());
  }

  async boot() {
    if (this.dead) return;

    // ---- assets (with progress + procedural fallback) ----
    const assets = new AssetManager();
    const fill = document.getElementById('loader-fill');
    const pct = document.getElementById('loader-pct');
    await assets.loadAll((p) => {
      fill.style.width = `${Math.round(p * 100)}%`;
      pct.textContent = `${Math.round(p * 100)}%`;
    });

    // ---- world ----
    this.physics = new PhysicsWorld();
    this.particles = new Particles(this.scene);
    this.player = new Player(this.physics, assets.cloneBanana(), assets.bananaBodyGeometry, this.scene);
    this.environment = new Environment(this.scene, this.physics, assets.bananaTemplate);
    this.sound = new SoundManager();
    this.logic = new GameLogic({
      player: this.player,
      environment: this.environment,
      particles: this.particles,
      sound: this.sound,
    });
    this.physics.onPlayerCollide((kind, body) => this.logic.handleCollision(kind, body));

    // ---- go ----
    const loading = document.getElementById('loading-screen');
    loading.classList.add('fade-out');
    setTimeout(() => loading.remove(), 700);
    this.logic.toMenu();
    this._bindInput();
    this._bindResize();
    this.camera.position.set(10, 5.5, 7);
    this.camera.lookAt(0, 1.2, 0);
    this.particles.resetSpeedLines(0);
    requestAnimationFrame((t) => this._loop(t));
  }

  /* ================= input ================= */

  // Physical key codes are layout-independent: 'KeyA' is the key to the left
  // of 'KeyS' whether the keyboard prints QWERTY or AZERTY. We also fall
  // back to the printed character (e.key) for exotic setups, so the game
  // steers correctly with ZQSD (AZERTY), WASD (QWERTY) AND arrow keys.
  static KEY_ACTIONS = {
    left: ['ArrowLeft', 'KeyA', 'KeyQ'],
    right: ['ArrowRight', 'KeyD'],
    jump: ['Space', 'ArrowUp', 'KeyW', 'KeyZ'],
    dive: ['ArrowDown', 'KeyS'],
  };
  static KEY_CHARS = {
    left: ['a', 'q', 'arrowleft'],
    right: ['d', 'arrowright'],
    jump: [' ', 'z', 'w', 'arrowup'],
    dive: ['s', 'arrowdown'],
  };

  static resolveAction(e) {
    const byCode = Game.KEY_ACTIONS;
    for (const action in byCode) {
      if (byCode[action].includes(e.code)) return action;
    }
    const k = typeof e.key === 'string' ? e.key.toLowerCase() : '';
    if (k === '' || k === 'shift' || k === 'control' || k === 'alt' || k === 'meta') return null;
    const byChar = Game.KEY_CHARS;
    for (const action in byChar) {
      if (byChar[action].includes(k)) return action;
    }
    return null;
  }

  _bindInput() {
    const player = this.player, logic = this.logic;

    // If the window/tab ever loses focus mid-press, the matching keyup never
    // fires and a steering key stays "stuck" (banana drifting on its own
    // after resuming). Hard-reset every held input instead.
    const releaseAll = () => {
      player.input.left = false;
      player.input.right = false;
      player.input.down = false;
      player.input.boost = false;
    };

    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;

      // meta keys (pause / mute / restart / turbo)
      switch (e.code) {
        case 'Enter':
          if (logic.state === State.MENU) logic.start();
          else if (logic.state === State.GAMEOVER && performance.now() - logic.goTime > 600) logic.restart();
          break;
        case 'KeyR':
          if (logic.state === State.GAMEOVER) logic.restart();
          break;
        case 'ShiftLeft': case 'ShiftRight': player.input.boost = true; break;
        case 'KeyP': case 'Escape':
          if (logic.state === State.PLAYING || logic.state === State.PAUSED) logic.togglePause();
          break;
        case 'KeyM': this._toggleMute(); break;
      }

      // gameplay keys — QWERTY + AZERTY + arrows all resolve the same way
      const action = Game.resolveAction(e);
      if (!action) return;
      if (action === 'left' || action === 'right') {
        if (logic.state === State.PLAYING) player.input[action] = true;
      } else if (action === 'dive') {
        if (logic.state === State.PLAYING) player.input.down = true;
      } else if (action === 'jump') {
        if (logic.state === State.MENU) logic.start();
        else if (logic.state === State.GAMEOVER) {
          if (performance.now() - logic.goTime > 600) logic.restart();
        } else if (logic.state === State.PLAYING) player.queueJump();
      }
    });

    window.addEventListener('keyup', (e) => {
      const action = Game.resolveAction(e);
      if (action === 'left' || action === 'right') player.input[action] = false;
      else if (action === 'dive') player.input.down = false;
      switch (e.code) {
        case 'ShiftLeft': case 'ShiftRight': player.input.boost = false; break;
      }
    });

    // auto-pause when the tab loses focus (and never leave a key stuck)
    window.addEventListener('blur', () => {
      releaseAll();
      if (logic.state === State.PLAYING) logic.togglePause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        releaseAll();
        if (logic.state === State.PLAYING) logic.togglePause();
      }
    });

    // ---- touch controls ----
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      document.body.classList.add('touch');
      const bindHold = (id, on, off) => {
        const el = document.getElementById(id);
        const down = (e) => { e.preventDefault(); el.classList.add('pressed'); on(); };
        const up = (e) => { e.preventDefault(); el.classList.remove('pressed'); off(); };
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointerleave', up);
        el.addEventListener('pointercancel', up);
      };
      bindHold('tc-left', () => { player.input.left = true; }, () => { player.input.left = false; });
      bindHold('tc-right', () => { player.input.right = true; }, () => { player.input.right = false; });
      bindHold('tc-boost', () => { player.input.boost = true; }, () => { player.input.boost = false; });
      bindHold('tc-jump', () => {
        if (logic.state === State.PLAYING) player.queueJump();
      }, () => {});
    }
  }

  _bindUI() {
    document.getElementById('btn-start').addEventListener('click', () => this.logic && this.logic.start());
    document.getElementById('btn-restart').addEventListener('click', () => this.logic && this.logic.restart());
    document.getElementById('btn-resume').addEventListener('click', () => this.logic && this.logic.togglePause());
    document.getElementById('btn-quit').addEventListener('click', () => this.logic && this.logic.quitToMenu());
    document.getElementById('btn-pause').addEventListener('click', () => {
      if (this.logic && (this.logic.state === State.PLAYING || this.logic.state === State.PAUSED)) this.logic.togglePause();
    });
    document.getElementById('btn-mute').addEventListener('click', () => this._toggleMute());
  }

  _toggleMute() {
    if (!this.sound) return;
    const muted = this.sound.toggleMute();
    document.getElementById('btn-mute').classList.toggle('muted', muted);
    document.getElementById('mute-waves').style.opacity = muted ? '0.15' : '1';
  }

  _bindResize() {
    const onResize = () => {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(onResize).observe(this.container);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  }

  /* ================= loop ================= */

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    const rawDt = Math.min((now - this._lastT) / 1000, 0.05);
    this._lastT = now;

    // ---- consume juice events (shake / slow-mo) ----
    for (const ev of this.logic.events) {
      if (ev.type === 'shake') {
        this.shakeAmp = Math.min(1.5, this.shakeAmp + ev.power);
        if (ev.power >= 0.7) {
          this.rgbPulse = 0.005;
          const c = this.container;
          c.classList.remove('shake');
          void c.offsetWidth;
          c.classList.add('shake');
        }
      } else if (ev.type === 'slowmo') {
        this.slowScale = ev.scale;
        this.slowTimer = ev.dur;
        this.timeScale = ev.scale;
      } else if (ev.type === 'redflash') {
        const f = document.getElementById('flash-overlay');
        if (f) { f.classList.remove('red'); void f.offsetWidth; f.classList.add('red'); }
      } else if (ev.type === 'zoneflash') {
        this.bloomPulse = 0.7;
        const f = document.getElementById('flash-overlay');
        if (f) { f.classList.remove('zone'); void f.offsetWidth; f.classList.add('zone'); }
      }
    }
    this.logic.events.length = 0;

    // ---- time scale ----
    if (this.slowTimer > 0) {
      this.slowTimer -= rawDt;
    } else {
      this.timeScale += (1 - this.timeScale) * Math.min(1, rawDt * 6);
    }
    const dt = rawDt * this.timeScale;

    const state = this.logic.state;
    const running = state === State.PLAYING || state === State.MENU || state === State.GAMEOVER;

    if (running) {
      this.envTime += dt;

      this.physics.step(dt);

      const pctx = {
        targetSpeed: state === State.PLAYING ? this.logic.targetSpeed : 0,
        difficulty: this.logic.difficulty,
        slipping: this.logic.slipping,
        superMode: this.logic.superActive,
        active: state === State.PLAYING,
        onJump: () => {
          this.sound.sfxJump();
          this.particles.spawn(this.player.position.x, this.player.position.y - 0.7, this.player.position.z, {
            count: 8, speed: 2.5, size: 9, life: 0.45, gravity: 1, upBias: 0.5, colors: [0xd8c9ff, 0xffffff],
          });
        },
        onDoubleJump: () => {
          this.sound.sfxDoubleJump();
          this.particles.spawn(this.player.position.x, this.player.position.y - 0.55, this.player.position.z, {
            count: 16, speed: 5.5, size: 10, life: 0.42, gravity: -1, upBias: 0.4,
            colors: [0xd8c9ff, 0x00ffa3, 0xffffff],
          });
        },
        onDiveLand: () => {
          this.sound.sfxDiveLand();
          this.particles.shockwave(this.player.position.x, 0.12, this.player.position.z);
          this.shakeAmp = Math.min(1.5, this.shakeAmp + 0.35);
          this.logic.diveBoost();
        },
        onUnstuck: () => {
          this.sound.sfxUnstuck();
          this.particles.spawn(this.player.position.x, this.player.position.y, this.player.position.z, {
            count: 22, speed: 8, size: 13, life: 0.55, gravity: 2, upBias: 0.7,
            colors: [0x9b5de5, 0xd8c9ff, 0xff6ec7],
          });
        },
        onLand: () => {
          this.particles.spawn(this.player.position.x, 0.15, this.player.position.z, {
            count: 12, speed: 4, size: 11, life: 0.5, gravity: 3, upBias: 0.35, colors: [0xd8c9ff, 0xff6ec7, 0xffffff],
          });
          this.shakeAmp = Math.min(1.5, this.shakeAmp + 0.12);
        },
      };
      this.player.update(dt, pctx);

      this.environment.update(dt, {
        playerPos: this.player.position,
        camera: this.camera,
        canCollect: state === State.PLAYING,
        superMode: this.logic.superActive,
        onStar: (star) => this.logic.onStar(star),
        onGolden: (g) => this.logic.onGolden(g),
        onToastHit: () => this.logic.onToastHit(),
        onNearMiss: (x, y, z) => {
          this.logic.onNearMiss();
          this.particles.nearMissStreak(x, y, z);
        },
        nearMissOK: state === State.PLAYING && !this.logic.superActive,
        difficulty: this.logic.difficulty,
        time: this.envTime,
      });

      // ---- zone fog tint (seamless horizon) ----
      if (this.environment.fogColor) {
        this.scene.fog.color.lerp(this.environment.fogColor, Math.min(1, rawDt * 1.8));
        this.scene.background.copy(this.scene.fog.color);
      }

      this.logic.update(dt);

      // key light follows the hero
      const pp = this.player.position;
      this.keyLight.position.set(pp.x + 13, 24, pp.z + 11);
      this.keyLight.target.position.set(pp.x, 0, pp.z - 6);
      this.keyLight.target.updateMatrixWorld();
    }

    this.particles.update(dt, {
      playerZ: this.player.position.z,
      speed: this.player.speed,
      boostFactor: Math.min(1, this.logic.boostFactor + (this.logic.superActive ? 1 : 0) + (this.logic.padActive ? 0.55 : 0)),
    });

    this._updateCamera(rawDt);
    this._updateEffects(rawDt);
    this.composer.render();

    // ---- adaptive quality (keeps the game smooth on weak GPUs) ----
    // If the average frame rate dips, shed pixel ratio first, then shadows.
    // This directly fights the "game slows to a crawl" feel on laptops.
    this._fpsAcc += rawDt;
    this._fpsFrames += 1;
    if (this._fpsFrames >= 90 && this._fpsAcc > 0.01) {
      const avgFps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
      if (avgFps < 42 && this._quality > 0) this._downgradeQuality();
    }
  }

  _downgradeQuality() {
    this._quality -= 1;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (this._quality === 1) {
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.composer.setSize(w, h);
      console.info('[main] adaptive quality: pixel ratio -> 1');
    } else if (this._quality === 0) {
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((o) => {
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.needsUpdate = true;
        }
      });
      console.info('[main] adaptive quality: shadows off');
    }
  }

  _updateCamera(dt) {
    const state = this.logic.state;
    const pp = this.player.position;
    const target = this._camTarget || (this._camTarget = new THREE.Vector3());
    const desired = this._camDesired || (this._camDesired = new THREE.Vector3());

    if (state === State.MENU) {
      const a = this.envTime * 0.32;
      desired.set(pp.x + Math.sin(a) * 10.5, 5.2 + Math.sin(a * 0.6) * 1.2, pp.z + Math.cos(a) * 10.5);
      target.set(pp.x, pp.y + 0.9, pp.z);
    } else {
      desired.set(pp.x * 0.82, pp.y + 4.25 + Math.min(2.2, this.player.speed * 0.028), pp.z + 8.7);
      target.set(pp.x * 0.9, pp.y + 1.4, pp.z - 8);
    }
    const k = 1 - Math.exp(-(state === State.MENU ? 2.2 : 5.5) * dt);
    this.camera.position.lerp(desired, k);
    this._lookAt = this._lookAt || new THREE.Vector3();
    this._lookAt.lerp(target, 1 - Math.exp(-7 * dt));
    this.camera.lookAt(this._lookAt);

    // ---- cinematic roll on steering (pro chase-cam feel) ----
    const steerInput = (this.player.input.left ? 1 : 0) - (this.player.input.right ? 1 : 0);
    const rollTarget = state === State.PLAYING ? steerInput * 0.05 : 0;
    this.camRoll += (rollTarget - this.camRoll) * Math.min(1, dt * 6);
    this.camera.rotateZ(this.camRoll);

    // shake
    if (this.shakeAmp > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.4;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp * 0.3;
      this.shakeAmp *= Math.exp(-4.2 * dt);
    }
  }

  _updateEffects(dt) {
    // FOV kick during boost / super / speed pads — widens with raw speed too
    const pad = this.logic.padActive ? 1 : 0;
    const fovTarget = 72
      + Math.max(0, this.player.speed - 24) * 0.14
      + this.logic.boostFactor * 12
      + this.player.superT * 4
      + pad * 5;
    this.fov += (fovTarget - this.fov) * Math.min(1, dt * 5);
    if (Math.abs(this.camera.fov - this.fov) > 0.02) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    // bloom breathing (kept subtle: super mode should pop, not blind)
    this.bloomPulse = Math.max(0, this.bloomPulse - dt * 1.4);
    const bloomTarget = 0.45 + this.logic.boostFactor * 0.18 + this.player.superT * 0.5 + this.bloomPulse;
    this.bloom.strength += (bloomTarget - this.bloom.strength) * Math.min(1, dt * 4);
    // chromatic aberration
    this.rgbPulse = Math.max(0, this.rgbPulse - dt * 0.006);
    const rgbTarget = 0.0006 + this.logic.boostFactor * 0.0026 + this.player.superT * 0.0014 + this.rgbPulse;
    this.rgbPass.uniforms.amount.value += (rgbTarget - this.rgbPass.uniforms.amount.value) * Math.min(1, dt * 7);
  }
}

const game = new Game();
window.__LIAB = game; // debug/testing handle
game.boot().catch((err) => {
  console.error('[main] boot failed:', err);
  const el = document.getElementById('loader-pct');
  if (el) el.textContent = 'BOOT ERROR: ' + (err && err.message ? err.message : err);
});
