/**
 * GameLogic
 * ---------
 * State machine (LOADING → MENU → PLAYING ⇄ PAUSED → GAMEOVER),
 * score & aggressive difficulty scaling, ZONES (palette + music shifts every
 * 400 m), peel-layer damage, potassium meter & Super Yellow Mode, Banana
 * Split Turbo, speed pads, near-miss GRAZE bonuses, golden bananas, toast
 * barrage hits, slip chaos, void falls, anti-stuck recovery, HUD updates,
 * arcade RANK grading and floating announcements.
 */

const BEST_KEY = 'liab-best-v1';
const SUPER_DURATION = 6.2;
const POTASSIUM_PER_STAR = 0.08;
const BOOST_DRAIN = 1 / 2.2;   // full meter = 2.2s of boost
const BOOST_REGEN = 1 / 5.0;

const ZONE_LEN = 400;
const ZONES = [
  { name: 'JUNGLE NÉON' },
  { name: 'OURAGAN VIOLET' },
  { name: 'INFERNO SOLAIRE' },
  { name: 'VIDE FANTÔME' },
  { name: 'SINGULARITÉ BANANE' },
];
const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

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
    this.events = []; // consumed by main.js: {type:'shake'|'slowmo'|'redflash'|'zoneflash', ...}

    this._resetRun();
    this.best = this._loadBest();

    this._dom = {
      hud: document.getElementById('hud'),
      score: document.getElementById('hud-score'),
      dist: document.getElementById('hud-dist'),
      speed: document.getElementById('hud-speed'),
      mult: document.getElementById('hud-mult'),
      zone: document.getElementById('hud-zone'),
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
      goRank: document.getElementById('go-rank'),
      goTopSpeed: document.getElementById('go-topspeed'),
      goNearMiss: document.getElementById('go-nearmiss'),
      goSmashed: document.getElementById('go-smashed'),
      paused: document.getElementById('paused'),
      announce: document.getElementById('announce-layer'),
    };
    this._lastHud = { score: -1, dist: -1, speed: -1, peel: -1, k: -1, boost: -1, mult: '', zone: -1 };
  }

  _resetRun() {
    this.score = 0;
    this.scoreF = 0;
    this.distance = 0;
    this.stars = 0;
    this.goldens = 0;
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
    this.zone = 0;
    this.topSpeed = 0;
    this.nearMisses = 0;
    this.smashed = 0;
    this.speedPadUntil = 0;
    this.toastCdUntil = 0;
    this._wasBoosting = false;
    this.time = 0;
    this.goTime = 0;
  }

  /** Speed-pad (or dive-stomp) speed burst currently running? */
  get padActive() { return this.time < this.speedPadUntil; }

  /** Short dive-landing speed pop. */
  diveBoost() { this.speedPadUntil = Math.max(this.speedPadUntil, this.time + 0.45); }

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
    this._lastHud = { score: -1, dist: -1, speed: -1, peel: -1, k: -1, boost: -1, mult: '', zone: -1 };
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

    // ---- arcade RANK + run stats ----
    const rank = this._rank(this.score);
    if (this._dom.goRank) {
      this._dom.goRank.textContent = rank.r;
      this._dom.goRank.className = `go-rank ${rank.cls}`;
    }
    if (this._dom.goTopSpeed) this._dom.goTopSpeed.textContent = `${Math.round(this.topSpeed * 4)} km/h`;
    if (this._dom.goNearMiss) this._dom.goNearMiss.textContent = `${this.nearMisses}`;
    if (this._dom.goSmashed) this._dom.goSmashed.textContent = `${this.smashed}`;

    this._dom.gameover.classList.remove('hidden');
  }

  _rank(score) {
    if (score >= 60000) return { r: 'S+', cls: 'rank-splus' };
    if (score >= 35000) return { r: 'S', cls: 'rank-s' };
    if (score >= 20000) return { r: 'A', cls: 'rank-a' };
    if (score >= 10000) return { r: 'B', cls: 'rank-b' };
    if (score >= 4000) return { r: 'C', cls: 'rank-c' };
    return { r: 'D', cls: 'rank-d' };
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
        this.smashed += 1;
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

      // Comedic bounce that CLEARS the obstacle: high arc + strong sideways
      // shove so the banana lands beside/behind the box instead of wedging
      // against its face (the root cause of the "stuck after 5s" freeze).
      const v = this.player.body.velocity;
      const knock = (body.userData.knock || 8) * 0.5;
      const side = Math.sign(this.player.position.x - body.position.x) || (Math.random() < 0.5 ? -1 : 1);
      v.z = knock;                 // short backward hop (forward is -Z)
      v.y = Math.max(v.y, 7.4);    // big arc — flies OVER the hitbox
      v.x = side * 7.5;            // slides decisively PAST it
      this.player.stun(0.32);
      this.applyDamage(body.userData.damage || 1, 'peeled');
    } else if (kind === 'slipzone') {
      const now = this.time;
      if (body.userData.lastTrig !== undefined && now - body.userData.lastTrig < 2) return;
      body.userData.lastTrig = now;
      this.player.setSlip(1.35);
      this.sound.sfxSlip();
      this.announce('WHOOPS!', 'danger small');
      this.events.push({ type: 'shake', power: 0.35 });
    } else if (kind === 'speedpad') {
      const now = this.time;
      if (body.userData.lastTrig !== undefined && now - body.userData.lastTrig < 1.4) return;
      body.userData.lastTrig = now;
      this.speedPadUntil = Math.max(this.speedPadUntil, now + 1.15);
      this.sound.sfxSpeedPad();
      this.particles.speedPadBurst(this.player.position.x, 0.3, this.player.position.z);
      this.announce('ZOOM !', 'small teal');
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
    this.events.push({ type: 'redflash' });
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

  /** Rare golden banana pickup: jackpot. */
  onGolden(g) {
    if (this.state !== State.PLAYING) return;
    this.goldens += 1;
    this.scoreF += 500;
    this.boostMeter = 1;
    if (!this.superActive) this.potassium = Math.min(1, this.potassium + 0.3);
    this.sound.sfxGolden();
    this.particles.goldenBurst(g.wx, g.wy, g.wz);
    this.announce('BANANE DORÉE ! +500', 'big');
    this.events.push({ type: 'slowmo', scale: 0.5, dur: 0.22 });
    if (this.potassium >= 1 && !this.superActive) this._triggerSuper();
  }

  /** Grazed an obstacle at speed without getting hit: risk pays. */
  onNearMiss() {
    if (this.state !== State.PLAYING || this.superActive) return;
    this.nearMisses += 1;
    const pts = 30 + Math.min(70, this.combo * 5);
    this.scoreF += pts;
    if (!this.superActive) this.potassium = Math.min(1, this.potassium + 0.02);
    this.sound.sfxNearMiss();
    this.events.push({ type: 'slowmo', scale: 0.78, dur: 0.1 });
    if (this.nearMisses % 3 === 1) this.announce(`FRÔLÉ ! +${pts}`, 'small teal');
    if (this.potassium >= 1 && !this.superActive) this._triggerSuper();
  }

  /** Hot toast projectile hit: chaos, no peel damage. */
  onToastHit() {
    if (this.state !== State.PLAYING) return;
    if (this.time < this.toastCdUntil) return;
    this.toastCdUntil = this.time + 0.6;
    this.player.setSlip(0.9);
    this.sound.sfxToastHit();
    this.announce('TOASTÉ !', 'danger small');
    this.events.push({ type: 'shake', power: 0.3 });
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
    this.topSpeed = Math.max(this.topSpeed, player.speed);

    // ---- aggressive difficulty curve (full pressure ~1200 m) ----
    this.difficulty = 1 - Math.exp(-this.distance / 380);

    // ---- ZONES: every 400 m the cosmos changes face ----
    const zi = Math.floor(this.distance / ZONE_LEN);
    if (zi !== this.zone) {
      this.zone = zi;
      const def = ZONES[zi % ZONES.length];
      const label = def.name + (ROMAN[Math.min(ROMAN.length - 1, Math.floor(zi / ZONES.length))] || '');
      this.environment.setZone(zi % ZONES.length);
      this.sound.sfxZone();
      this.announce(`ZONE: ${label}`, 'big');
      this.events.push({ type: 'zoneflash' });
    }

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

    // ---- speed target: fast base, zones stack, hard cap for playability ----
    const zoneBonus = 1 + Math.min(0.3, this.zone * 0.05);
    const pad = this.padActive ? 1.22 : 1;
    this.targetSpeed = Math.min(
      85,
      (18 + 44 * this.difficulty) * zoneBonus * pad
        * (this.boostActive ? 1.9 : 1) * (this.superActive ? 1.28 : 1)
    );

    // ---- score ----
    const mult = (this.boostActive ? 2 : 1) * (this.superActive ? 3 : 1) * (this.padActive ? 1.5 : 1);
    this.scoreF += player.speed * dt * 12 * mult;
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

  _zoneLabel() {
    const zi = this.zone;
    const def = ZONES[zi % ZONES.length];
    return def.name + (ROMAN[Math.min(ROMAN.length - 1, Math.floor(zi / ZONES.length))] || '');
  }

  _updateHud() {
    const d = this._dom;
    const h = this._lastHud;
    if (this.state !== State.PLAYING && this.state !== State.PAUSED) return;

    if (this.score !== h.score) { d.score.textContent = this.score.toLocaleString(); h.score = this.score; }
    const dist = Math.floor(this.distance);
    if (dist !== h.dist) { d.dist.textContent = `${dist} m`; h.dist = dist; }
    const spd = Math.round(this.player.speed * 4);
    if (spd !== h.speed) { d.speed.textContent = spd; h.speed = spd; }

    if (this.zone !== h.zone && d.zone) {
      d.zone.textContent = this._zoneLabel();
      d.zone.classList.remove('hidden');
      h.zone = this.zone;
    }

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
    const mult = (this.boostActive ? 2 : 1) * (this.superActive ? 3 : 1) * (this.padActive ? 1.5 : 1);
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
