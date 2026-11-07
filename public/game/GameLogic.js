/**
 * GameLogic
 * ---------
 * State machine (LOADING → MENU → PLAYING ⇄ PAUSED → GAMEOVER),
 * score & difficulty scaling, peel-layer damage, potassium meter &
 * Super Yellow Mode, Banana Split Turbo, slip chaos, void falls, HUD
 * updates and floating announcements.
 */

const BEST_KEY = 'liab-best-v1';
const SUPER_DURATION = 7;
const POTASSIUM_PER_STAR = 0.09;
const BOOST_DRAIN = 1 / 2.6;   // full meter = 2.6s of boost
const BOOST_REGEN = 1 / 5.2;

export const State = { LOADING: 'LOADING', MENU: 'MENU', PLAYING: 'PLAYING', PAUSED: 'PAUSED', GAMEOVER: 'GAMEOVER' };

export class GameLogic {
  /**
   * @param {{player:import('./Player.js').Player,
   *          environment:import('./Environment.js').Environment,
   *          particles:import('./Particles.js').Particles,
   *          sound:import('./SoundManager.js').SoundManager}} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.state = State.LOADING;
    this.time = 0;
    this.events = []; // consumed by main.js: {type:'shake'|'slowmo', ...}

    this._resetRun();
    this.best = this._loadBest();

    this._dom = {
      hud: document.getElementById('hud'),
      score: document.getElementById('hud-score'),
      dist: document.getElementById('hud-dist'),
      speed: document.getElementById('hud-speed'),
      mult: document.getElementById('hud-mult'),
      kFill: document.getElementById('k-fill'),
      boostFill: document.getElementById('boost-fill'),
      peelIcons: Array.from(document.querySelectorAll('#peel-icons .peel-icon')),
      menu: document.getElementById('menu'),
      menuBest: document.getElementById('menu-best'),
      gameover: document.getElementById('gameover'),
      goScore: document.getElementById('go-score'),
      goDist: document.getElementById('go-dist'),
      goStars: document.getElementById('go-stars'),
      goBest: document.getElementById('go-best'),
      goReason: document.getElementById('go-reason'),
      goNewBest: document.getElementById('go-newbest'),
      paused: document.getElementById('paused'),
      announce: document.getElementById('announce-layer'),
    };
    this._lastHud = { score: -1, dist: -1, speed: -1, peel: -1, k: -1, boost: -1, mult: '' };
  }

  _resetRun() {
    this.score = 0;
    this.scoreF = 0;
    this.distance = 0;
    this.stars = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.potassium = 0;
    this.peel = 4;
    this.difficulty = 0;
    this.targetSpeed = 0;
    this.boostMeter = 1;
    this.boostActive = false;
    this.boostFactor = 0;
    this.superActive = false;
    this.superTimer = 0;
    this.invulnUntil = 0;
    this.slipping = false;
    this._wasBoosting = false;
    this.time = 0;
    this.goTime = 0;
  }

  /* ================= state transitions ================= */

  toMenu() {
    this.state = State.MENU;
    this._resetRun();
    this.player.reset();
    this.environment.reset();
    this.sound.setIntensity('menu');
    this._dom.menu.classList.remove('hidden');
    this._dom.gameover.classList.add('hidden');
    this._dom.paused.classList.add('hidden');
    this._dom.hud.classList.add('hidden');
    this._dom.menuBest.textContent = `BEST SCORE: ${this.best.toLocaleString()}`;
  }

  start() {
    this.sound.init();
    this.sound.sfxClick();
    this._beginRun();
    this.announce('LA VIE EST UNE BANANE!', 'teal');
  }

  restart() {
    this.sound.sfxClick();
    this._beginRun();
    this.announce('RE-PEELED. GO!', 'teal');
  }

  _beginRun() {
    this._resetRun();
    this.player.reset();
    this.environment.reset();
    this.sound.setIntensity('playing');
    this.state = State.PLAYING;
    this._dom.menu.classList.add('hidden');
    this._dom.gameover.classList.add('hidden');
    this._dom.paused.classList.add('hidden');
    this._dom.hud.classList.remove('hidden');
    this._lastHud = { score: -1, dist: -1, speed: -1, peel: -1, k: -1, boost: -1, mult: '' };
  }

  togglePause() {
    if (this.state === State.PLAYING) {
      this.state = State.PAUSED;
      this._dom.paused.classList.remove('hidden');
      this.sound.suspend();
    } else if (this.state === State.PAUSED) {
      this.state = State.PLAYING;
      this._dom.paused.classList.add('hidden');
      this.sound.resume();
    }
  }

  quitToMenu() {
    this.sound.resume();
    this.toMenu();
  }

  gameOver(reason) {
    if (this.state !== State.PLAYING) return;
    this.state = State.GAMEOVER;
    this.goTime = performance.now(); // guards accidental instant restarts
    this.sound.setIntensity('menu');
    this.sound.sfxGameOver();
    this.events.push({ type: 'slowmo', scale: 0.25, dur: 0.8 });
    this.events.push({ type: 'shake', power: 1 });

    const isBest = this.score > this.best;
    if (isBest) {
      this.best = this.score;
      this._saveBest();
    }
    const reasons = {
      peeled: 'You hit something. Something hit back harder.',
      void: 'The Existential Void swallowed your potassium.',
    };
    this._dom.goReason.textContent = reasons[reason] || 'The cosmos slipped on you.';
    this._dom.goScore.textContent = this.score.toLocaleString();
    this._dom.goDist.textContent = `${Math.floor(this.distance)} m`;
    this._dom.goStars.textContent = `${this.stars}`;
    this._dom.goBest.textContent = this.best.toLocaleString();
    this._dom.goNewBest.classList.toggle('hidden', !isBest);
    this._dom.gameover.classList.remove('hidden');
  }

  /* ================= collisions & pickups ================= */

  handleCollision(kind, body) {
    if (this.state !== State.PLAYING) return;
    if (kind === 'obstacle') {
      if (body.userData.dead) return;
      if (this.superActive) {
        const pos = this.environment.smashObstacle(body);
        if (pos) this.particles.smashBurst(pos.x, pos.y, pos.z);
        this.sound.sfxSmash();
        this.scoreF += 60;
        this.announce('SMASHED! +60', 'small');
        return;
      }
      // The WHOLE response (bounce + damage) is gated by invulnerability and
      // a per-obstacle cooldown. Previously the knockback fired on every new
      // contact, so one bump could chain into the next obstacle and the run
      // degenerated into a permanent stun-lock ("the banana stopped working").
      const now = this.time;
      if (now < this.invulnUntil) return;
      if (body.userData.lastHit !== undefined && now - body.userData.lastHit < 0.8) return;
      body.userData.lastHit = now;

      // Softer comedic bounce: mostly sideways, a short backward hop, a
      // brief hands-off-the-wheel stun. Recovery stays snappy.
      const v = this.player.body.velocity;
      const knock = (body.userData.knock || 8) * 0.55;
      const side = Math.sign(this.player.position.x - body.position.x) || (Math.random() < 0.5 ? -1 : 1);
      v.z = knock;                 // small backward hop (forward is -Z)
      v.y += 5.2;
      v.x = side * 5.5;            // sideways shove — slide past it
      this.player.stun(0.3);
      this.applyDamage(body.userData.damage || 1, 'peeled');
    } else if (kind === 'slipzone') {
      const now = this.time;
      if (body.userData.lastTrig !== undefined && now - body.userData.lastTrig < 2) return;
      body.userData.lastTrig = now;
      this.player.setSlip(1.35);
      this.sound.sfxSlip();
      this.announce('WHOOPS!', 'danger small');
      this.events.push({ type: 'shake', power: 0.35 });
    }
  }

  applyDamage(n, reason) {
    if (this.state !== State.PLAYING) return;
    if (this.time < this.invulnUntil || this.superActive) return;
    this.peel -= n;
    this.player.setInvuln(1.5);
    this.particles.peelBurst(
      this.player.position.x, this.player.position.y, this.player.position.z
    );
    this.sound.sfxPeelHit();
    this.events.push({ type: 'shake', power: 0.8 });
    this.events.push({ type: 'slowmo', scale: 0.35, dur: 0.32 });
    if (this.peel <= 0) {
      this.peel = 0;
      this.gameOver(reason);
    } else {
      this.player.ejectPeel();
      this.announce('PEEL LOST!', 'danger');
    }
  }

  onStar(star) {
    this.stars += 1;
    this.combo += 1;
    this.comboTimer = 3.5;
    this.scoreF += 50;
    // no potassium charging while super is already running (avoids infinite chains)
    if (!this.superActive) this.potassium = Math.min(1, this.potassium + POTASSIUM_PER_STAR);
    this.boostMeter = Math.min(1, this.boostMeter + 0.12);
    this.sound.sfxCollect(this.combo);
    this.particles.starSparkle(star.wx, star.wy, star.wz);
    if (this.combo > 2 && this.combo % 5 === 0) this.announce(`COMBO x${this.combo}`, 'small');
    if (this.potassium >= 1 && !this.superActive) this._triggerSuper();
  }

  _triggerSuper() {
    this.superActive = true;
    this.superTimer = SUPER_DURATION;
    this.potassium = 0;
    this.sound.sfxSuper();
    this.sound.setIntensity('super');
    this.announce('SUPER YELLOW MODE!', 'big');
    this.events.push({ type: 'slowmo', scale: 0.45, dur: 0.25 });
  }

  _endSuper() {
    this.superActive = false;
    this.sound.setIntensity('playing');
    this.announce('super faded...', 'small');
  }

  /* ================= main update ================= */

  update(dt) {
    if (this.state === State.PLAYING) {
      this.time += dt;
      this._updateRun(dt);
    }
    this._updateHud();
  }

  _updateRun(dt) {
    const player = this.player;

    this.distance += player.speed * dt;
    this.difficulty = 1 - Math.exp(-this.distance / 700);

    // ---- turbo boost ----
    const wantBoost = player.input.boost && this.boostMeter > 0.04;
    if (wantBoost && !this._wasBoosting) this.sound.sfxBoost();
    this._wasBoosting = wantBoost;
    this.boostActive = wantBoost;
    if (wantBoost) this.boostMeter = Math.max(0, this.boostMeter - BOOST_DRAIN * dt);
    else this.boostMeter = Math.min(1, this.boostMeter + BOOST_REGEN * dt);
    this.boostFactor += ((this.boostActive || this.superActive ? 1 : 0) - this.boostFactor) * Math.min(1, dt * 5);

    // ---- super yellow mode ----
    if (this.superActive) {
      this.superTimer -= dt;
      this.particles.goldenTrail(player.position.x, player.position.y, player.position.z);
      if (this.superTimer <= 0) this._endSuper();
    }

    // ---- slip state ----
    this.slipping = player.slipUntil > player.time;

    // ---- speed target ----
    this.targetSpeed = (17 + 31 * this.difficulty) * (this.boostActive ? 1.85 : 1) * (this.superActive ? 1.3 : 1);

    // ---- score ----
    const mult = (this.boostActive ? 2 : 1) * (this.superActive ? 3 : 1);
    this.scoreF += player.speed * dt * 10 * mult;
    this.score = Math.floor(this.scoreF);

    // ---- combo decay ----
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // ---- existential void check ----
    if (player.position.y < -3.4) {
      this.sound.sfxVoidFall();
      this.particles.voidBurst(player.position.x, -2, player.position.z);
      if (this.peel > 1) {
        const safeZ = this.environment.findSafeZ(player.position.z);
        player.respawn(0, 2.4, safeZ);
        player.setInvuln(1.6);
        this.peel -= 1;
        player.ejectPeel();
        this.announce('THE VOID CLAIMS A PEEL', 'danger');
        this.events.push({ type: 'shake', power: 0.6 });
      } else {
        this.peel = 0;
        this.gameOver('void');
      }
    }
  }

  /* ================= HUD & announcements ================= */

  _updateHud() {
    const d = this._dom;
    const h = this._lastHud;
    if (this.state !== State.PLAYING && this.state !== State.PAUSED) return;

    if (this.score !== h.score) { d.score.textContent = this.score.toLocaleString(); h.score = this.score; }
    const dist = Math.floor(this.distance);
    if (dist !== h.dist) { d.dist.textContent = `${dist} m`; h.dist = dist; }
    const spd = Math.round(this.player.speed * 4);
    if (spd !== h.speed) { d.speed.textContent = spd; h.speed = spd; }

    if (this.peel !== h.peel) {
      d.peelIcons.forEach((icon, i) => icon.classList.toggle('lost', i >= this.peel));
      h.peel = this.peel;
    }
    const k = Math.round(this.potassium * 100);
    if (k !== h.k) {
      d.kFill.style.width = `${k}%`;
      d.kFill.classList.toggle('full', this.potassium >= 1);
      h.k = k;
    }
    const b = Math.round(this.boostMeter * 100);
    if (b !== h.boost) { d.boostFill.style.width = `${b}%`; h.boost = b; }
    const mult = (this.boostActive ? 2 : 1) * (this.superActive ? 3 : 1);
    const mLabel = mult > 1 ? `x${mult}` : '';
    if (mLabel !== h.mult) {
      d.mult.textContent = mLabel;
      d.mult.classList.toggle('hidden', mLabel === '');
      h.mult = mLabel;
    }
  }

  announce(text, cls = '') {
    const layer = this._dom.announce;
    while (layer.children.length > 4) layer.removeChild(layer.firstChild);
    const el = document.createElement('div');
    el.className = `announce ${cls}`.trim();
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  _loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch { return 0; }
  }

  _saveBest() {
    try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* private mode */ }
  }
}
