import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { AssetManager } from './AssetManager.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Player } from './Player.js';
import { Environment } from './Environment.js';
import { Particles } from './Particles.js';
import { Missiles } from './Missiles.js';
import { Bosses } from './Bosses.js';
import { SoundManager } from './SoundManager.js';
import { GameLogic, State } from './GameLogic.js';

/**
 * main.js — bootstraps the Cosmic Slip: renderer, cinematic lighting,
 * post-processing stack (bloom + RETRO GLITCH pass), the fixed-timestep
 * game loop with slow-mo juice, camera choreography, input bindings
 * (keyboard + touch), resize handling and UI wiring.
 */

const FOG_COLOR = 0x160a2e;

/* ====================================================================
 * RETRO GLITCH — BANANA STYLE
 * A full-screen corruption pass: VHS tracking rows that slip sideways,
 * a constant sub-pixel CRT wobble, chromatic (RGB) separation, DARK
 * scanlines, a slow rolling VHS band and subtractive grain. It is pure
 * corruption — everything it does darkens or displaces — so it can
 * never brighten the screen. Big gameplay events (boss spawn, hits,
 * MEGA BONUS, damage) pulse uGlitch up to 1 for a proper signal-torn
 * freak-out, then it decays back to the ambient CRT jitter.
 * ==================================================================== */
const RetroGlitchShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGlitch: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGlitch;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;

      // VHS tracking très subtil + varié
      float rowNoise = hash(vec2(floor(uv.y * 42.0), floor(uTime * 14.0)));
      float slipGate = smoothstep(0.97 - uGlitch * 0.35, 1.0, rowNoise);
      uv.x += slipGate * (hash(vec2(floor(uTime * 9.0), floor(uv.y * 42.0))) - 0.5)
              * (0.008 + uGlitch * 0.045);

      // jitter CRT ultra fin
      uv.x += sin(uv.y * 210.0 + uTime * 1.8) * (0.00018 + uGlitch * 0.0007);

      // chromatic aberration douce
      float ca = 0.0006 + uGlitch * 0.0038;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ca, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ca, 0.0)).b;

      // scanlines très légères
      col *= 1.0 - 0.022 * (0.5 + 0.5 * sin(uv.y * 780.0));

      // bande VHS lente et discrète
      float roll = fract(uTime * 0.06);
      float rollDist = abs(fract(uv.y - roll) - 0.5);
      col *= 1.0 - 0.028 * smoothstep(0.48, 0.0, rollDist);

      // grain très fin et varié
      col -= hash(uv + fract(uTime * 1.3) * 47.0) * (0.012 + uGlitch * 0.028);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

class Game {
  constructor() {
    this.container = document.getElementById('game-container');
    this.timeScale = 1;
    this.slowTimer = 0;
    this.slowScale = 1;
    this.shakeAmp = 0;
    this.glitchAmp = 0;   // RETRO GLITCH event pulse (decays on its own)
    this.envTime = 0;
    this.fov = 72;
    this.camRoll = 0;
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
    this.keyLight = new THREE.DirectionalLight(0xfff2cf, 2.05);
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
    // GLOW POLICY — the bloom exists for ONE thing: the neon strips on the
    // EDGES OF THE ROAD (emissiveIntensity 3, always over threshold).
    // Collectibles, missiles, particles, bosses, the banana and every
    // speed / turbo / super feedback stay flat matte paint, below the
    // threshold, so ZERO light leaves them. The strength is a constant and
    // never reacts to gameplay — the screen cannot white out, ever.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.55, 0.95);
    this.composer.addPass(this.bloom);
    // RETRO GLITCH pass: VHS tracking slips, chromatic split, dark CRT
    // scanlines and subtractive grain. Pure corruption, zero brightness.
    this.glitchPass = new ShaderPass(RetroGlitchShader);
    this.composer.addPass(this.glitchPass);
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
    this.missiles = new Missiles(this.scene, assets.bananaTemplate);
    this.bosses = new Bosses(this.scene);
    this.sound = new SoundManager();
    this.logic = new GameLogic({
      player: this.player,
      environment: this.environment,
      particles: this.particles,
      missiles: this.missiles,
      bosses: this.bosses,
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
    // after resuming). Hard-reset every held input instead — including the
    // held-jump state that powers auto-bounce landings.
    const releaseAll = () => {
      player.input.left = false;
      player.input.right = false;
      player.input.down = false;
      player.input.boost = false;
      player.input.jump = false;
    };

    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      const st = logic.state;

      // ---- meta keys (pause / mute / restart / turbo / fire) ----
      switch (e.code) {
        case 'Enter':
          if (st === State.MENU) logic.start();
          else if (st === State.GAMEOVER && performance.now() - logic.goTime > 600) logic.restart();
          else if (st === State.PAUSED) logic.togglePause();
          break;
        case 'KeyR':
          if (st === State.GAMEOVER) logic.restart();
          break;
        case 'ShiftLeft': case 'ShiftRight':
          if (st === State.PLAYING) player.input.boost = true;
          break;
        case 'KeyP': case 'Escape':
          if (st === State.PLAYING || st === State.PAUSED) logic.togglePause();
          break;
        case 'KeyM': this._toggleMute(); break;
        case 'KeyF': case 'KeyE':
          if (st === State.PLAYING) logic.fireMissile();
          break;
      }

      // ---- gameplay keys — QWERTY + AZERTY + arrows all resolve the same ----
      const action = Game.resolveAction(e);
      if (!action) return;

      // ANY gameplay key un-pauses a run that was auto-paused by a focus
      // loss: keys must NEVER feel dead. The key being held is registered
      // right away so steering resumes instantly.
      if (st === State.PAUSED) {
        logic.togglePause();
        if (action === 'left' || action === 'right') player.input[action] = true;
        else if (action === 'dive') player.input.down = true;
        if (action === 'jump') { player.input.jump = true; player.queueJump(); }
        return;
      }

      if (action === 'left' || action === 'right') {
        player.input[action] = st === State.PLAYING;
      } else if (action === 'dive') {
        player.input.down = st === State.PLAYING;
      } else if (action === 'jump') {
        // track the HELD state — this is what makes space work ALL the time:
        // holding it re-buffers the jump, so every landing bounces and a
        // deliberate hold chains the HELI-PEEL double jump.
        player.input.jump = true;
        if (st === State.MENU) logic.start();
        else if (st === State.GAMEOVER) {
          if (performance.now() - logic.goTime > 600) logic.restart();
        } else if (st === State.PLAYING) {
          player.queueJump();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const action = Game.resolveAction(e);
      if (action === 'left' || action === 'right') player.input[action] = false;
      else if (action === 'dive') player.input.down = false;
      else if (action === 'jump') player.input.jump = false;
      switch (e.code) {
        case 'ShiftLeft': case 'ShiftRight': player.input.boost = false; break;
      }
    });

    // auto-pause when the tab loses focus (and never leave a key stuck).
    // On refocus, reset inputs again defensively so the run resumes clean.
    window.addEventListener('blur', () => {
      releaseAll();
      if (logic.state === State.PLAYING) logic.togglePause();
    });
    window.addEventListener('focus', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        releaseAll();
        if (logic.state === State.PLAYING) logic.togglePause();
      }
    });

    // ---- clicking anywhere on the pause overlay resumes the run ----
    // (previously only the RESUME button worked, so a blur-pause in the
    // iframe could feel like the game had frozen with dead keys)
    const pausedEl = document.getElementById('paused');
    if (pausedEl) {
      pausedEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('#btn-quit')) return;
        if (logic.state === State.PAUSED) logic.togglePause();
      });
    }

    // ---- banana missiles: click / tap the track to fire ----
    this.renderer.domElement.addEventListener('pointerdown', () => {
      window.focus(); // self-heal if the iframe ever lost focus
      if (logic.state === State.PLAYING) logic.fireMissile();
    });

    // no context menu stealing focus mid-run
    this.container.addEventListener('contextmenu', (e) => e.preventDefault());

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
      bindHold('tc-fire', () => { logic.fireMissile(); }, () => {});
      bindHold('tc-jump', () => {
        player.input.jump = true;
        if (logic.state === State.PLAYING) player.queueJump();
      }, () => { player.input.jump = false; });
    }
  }

  _bindUI() {
    // Blur every button after its click: a focused button would otherwise
    // swallow Space/Enter (re-triggering itself) and make the jump feel
    // broken right after using the mouse.
    const wire = (id, fn) => {
      const el = document.getElementById(id);
      el.addEventListener('click', () => { el.blur(); fn(); });
    };
    wire('btn-start', () => this.logic && this.logic.start());
    wire('btn-restart', () => this.logic && this.logic.restart());
    wire('btn-resume', () => this.logic && this.logic.togglePause());
    wire('btn-quit', () => this.logic && this.logic.quitToMenu());
    wire('btn-pause', () => {
      if (this.logic && (this.logic.state === State.PLAYING || this.logic.state === State.PAUSED)) this.logic.togglePause();
    });
    wire('btn-mute', () => this._toggleMute());
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

    // ---- consume juice events (shake / slow-mo / glitch) ----
    for (const ev of this.logic.events) {
      if (ev.type === 'shake') {
        this.shakeAmp = Math.min(1.5, this.shakeAmp + ev.power);
        if (ev.power >= 0.7) {
          this.glitchAmp = Math.min(1.1, this.glitchAmp + 0.45);
          const c = this.container;
          c.classList.remove('shake');
          void c.offsetWidth;
          c.classList.add('shake');
        }
      } else if (ev.type === 'slowmo') {
        this.slowScale = ev.scale;
        this.slowTimer = ev.dur;
        this.timeScale = ev.scale;
      } else if (ev.type === 'glitch') {
        this.glitchAmp = Math.min(1.2, this.glitchAmp + ev.power);
      } else if (ev.type === 'redflash') {
        const f = document.getElementById('flash-overlay');
        if (f) { f.classList.remove('red'); void f.offsetWidth; f.classList.add('red'); }
      } else if (ev.type === 'zoneflash') {
        // zone change = CSS tint flash only — bloom strength never moves
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
          // matte banana-dust chips — ZERO light
          this.particles.spawn(this.player.position.x, this.player.position.y - 0.7, this.player.position.z, {
            count: 8, speed: 2.5, size: 9, life: 0.45, gravity: 1, upBias: 0.5, colors: [0xe3be1a, 0xc9a80f],
          });
        },
        onDoubleJump: () => {
          this.sound.sfxDoubleJump();
          // HELI-PEEL: chunky retro confetti, ZERO light — no additive cloud
          this.particles.spawn(this.player.position.x, this.player.position.y - 0.55, this.player.position.z, {
            count: 16, speed: 5.5, size: 10, life: 0.42, gravity: -1, upBias: 0.4,
            colors: [0xffe135, 0xff2e92, 0x9b5de5],
          });
        },
        // jump pressed with an empty endurance meter: dry-click feedback +
        // the HUD bar flashes red — the reason is always visible.
        onJumpDenied: () => {
          this.sound.sfxEmpty();
          const bar = document.getElementById('e-fill');
          if (bar) { bar.classList.remove('deny'); void bar.offsetWidth; bar.classList.add('deny'); }
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
            colors: [0x9b5de5, 0x39d0ff, 0xff6ec7],
          });
        },
        onLand: () => {
          this.particles.spawn(this.player.position.x, 0.15, this.player.position.z, {
            count: 12, speed: 4, size: 11, life: 0.5, gravity: 3, upBias: 0.35, colors: [0x8f7bff, 0xff6ec7, 0xffe135],
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
        onPatch: (p) => this.logic.onPatch(p),
        onToastHit: () => this.logic.onToastHit(),
        onNearMiss: (x, y, z) => {
          this.logic.onNearMiss();
          this.particles.nearMissStreak(x, y, z);
        },
        nearMissOK: state === State.PLAYING && !this.logic.superActive,
        difficulty: this.logic.difficulty,
        time: this.envTime,
      });

      // ---- banana missiles in flight (bosses take priority over props) ----
      this.missiles.update(dt, {
        playerZ: this.player.position.z,
        particles: this.particles,
        testHit: (x, y, z) => (this.bosses.testHit(x, y, z) || this.environment.missileHitTest(x, y, z)),
        onHit: (hit) => (hit.boss ? this.logic.onBossMissileHit(hit) : this.logic.onMissileHit(hit)),
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

    this.particles.update(dt);

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
    // FOV kick during boost / super / speed pads — widens with raw speed too.
    // Speed FEEL comes from the lens and the world, never from brightness.
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
    // ---- RETRO GLITCH: corruption pulses, never brightness ----
    // A faint VHS jitter always runs; big events (boss spawn / hit, damage,
    // MEGA BONUS) slam uGlitch up and it decays on its own. Boosting adds a
    // touch of extra tracking stress — signal trouble, not light.
    this.glitchAmp *= Math.exp(-2.6 * dt);
    const u = this.glitchPass.uniforms;
    u.uTime.value = this.envTime;
    u.uGlitch.value = 0.015 + this.logic.boostFactor * 0.06 + this.glitchAmp;
  }
}

const game = new Game();
window.__LIAB = game; // debug/testing handle
game.boot().catch((err) => {
  console.error('[main] boot failed:', err);
  const el = document.getElementById('loader-pct');
  if (el) el.textContent = 'BOOT ERROR: ' + (err && err.message ? err.message : err);
});
