/**
 * GameLogic
 * ---------
 * State machine (LOADING → MENU → PLAYING ⇄ PAUSED → GAMEOVER),
 * score & aggressive difficulty scaling, ZONES (palette + music shifts every
 * 400 m), peel-layer damage, potassium meter & Super Yellow Mode, Banana
 * Split Turbo, speed pads, near-miss GRAZE bonuses, golden bananas, PEEL
 * PATCH repairs, toast barrage hits, slip chaos, void falls, anti-stuck
 * recovery, BANANA MISSILES (ammo economy + firing + smash scoring),
 * COMBO chains with escalating multipliers + COMBO BANK payout, ARCADE
 * BOSS FIGHTS (SINGE SUPREME / ROI KONG COSMIQUE — killed = MEGA BONUS),
 * HUD updates, arcade RANK grading and floating announcements.
 */

const BEST_KEY = 'liab-best-v1';
const SUPER_DURATION = 6.2;
const POTASSIUM_PER_STAR = 0.08;
const BOOST_DRAIN = 1 / 2.2;   // full meter = 2.2s of boost
const BOOST_REGEN = 1 / 5.0;

const MISSILE_MAX = 6;         // HUD slots
const MISSILE_START = 3;
const MISSILE_CD = 0.3;        // seconds between shots
const STARS_PER_MISSILE = 8;   // star streak → +1 ammo

// ---- COMBO tiers: long chains escalate the score multiplier ----
const COMBO_TIERS = [
  { at: 25, mult: 12, label: 'GALAXY GRADE' },
  { at: 15, mult: 8, label: 'COSMIC FEVER' },
  { at: 10, mult: 5, label: 'POTASSIUM PUMP' },
  { at: 6, mult: 3, label: 'SPLIT RUSH' },
  { at: 3, mult: 2, label: 'BANANA BABY' },
];
const COMBO_TIME = 3.5;       // seconds of chain slack
const FEVER_AT = 15;          // COSMIC FEVER: potassium charges x2

// ---- BOSS scheduling: first fight at 550 m, every 3rd fight is MEGA ----
const FIRST_BOSS_AT = 550;

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
   *          missiles:import('./Missiles.js').Missiles,
   *          sound:import('./SoundManager.js').SoundManager}} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.state = State.LOADING;
    this.time = 0;
    this.events = []; // consumed by main.js: {type:'shake'|'slowmo'|'redflash'|'zoneflash'|'glitch', ...}

    this._resetRun();
    this.best = this._loadBest();

    this._dom = {
      hud: document.getElementById('hud'),
      score: document.getElementById('hud-score'),
      dist: document.getElementById('hud-dist'),
      speed: document.getElementById('hud-speed'),
      mult: document.getElementById('hud-mult'),
      zone: document.getElementById('hud-zone'),
      eFill: document.getElementById('e-fill'),
      kFill: document.getElementById('k-fill'),
      boostFill: document.getElementById('boost-fill'),
      peelIcons: Array.from(document.querySelectorAll('#peel-icons .peel-icon')),
      missileIcons: Array.from(document.querySelectorAll('#missile-icons .missile-icon')),
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
      comboEl: document.getElementById('hud-combo'),
      comboCount: document.getElementById('combo-count'),
      comboTierEl: document.getElementById('combo-tier'),
      comboFill: document.getElementById('combo-fill'),
      goMaxCombo: document.getElementById('go-maxcombo'),
      goBosses: document.getElementById('go-bosses'),
    };
    this._lastHud = { score: -1, dist: -1, speed: -1, peel: -1, k: -1, boost: -1, end: -1, mult: '', zone: -1, msl: -1, comboN: -1, comboTier: '', comboOn: false };
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
    this.missileAmmo = MISSILE_START;
    this.missileCdUntil = 0;
    this._starsSinceMissile = 0;
    this._wasBoosting = false;
    // ---- combo & boss bookkeeping ----
    this.maxCombo = 0;
    this.bossesKilled = 0;
    this.bossN = 0;
    this.nextBossAt = FIRST_BOSS_AT;
    this.bossCdUntil = 0;
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
    if (this.missiles) this.missiles.clear();
    if (this.bosses) this.bosses.clear();
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
    if (this.missiles) this.missiles.clear();
    if (this.bosses) this.bosses.clear();
    this.sound.setIntensity('playing');
    this.state = State.PLAYING;
    this._dom.menu.classList.add('hidden');
    this._dom.gameover.classList.add('hidden');
    this._dom.paused.classList.add('hidden');
    this._dom.hud.classList.remove('hidden');
    this._lastHud = { score: -1, dist: -1, speed: -1, peel: -1, k: -1, boost: -1, end: -1, mult: '', zone: -1, msl: -1, comboN: -1, comboTier: '', comboOn: false };
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
    if (this._dom.goMaxCombo) this._dom.goMaxCombo.textContent = `${this.maxCombo}`;
    if (this._dom.goBosses) this._dom.goBosses.textContent = `${this.bossesKilled}`;

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
    const prevTier = this._comboTier();
    this.combo += 1;
    this.comboTimer = COMBO_TIME;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const tier = this._comboTier();
    // combo chains escalate the value of every star in the run
    this.scoreF += 50 * tier.mult;
    // COSMIC FEVER: fat chains charge potassium twice as fast
    const fever = this.combo >= FEVER_AT;
    // no potassium charging while super is already running (avoids infinite chains)
    if (!this.superActive) {
      this.potassium = Math.min(1, this.potassium + POTASSIUM_PER_STAR * (fever ? 2 : 1));
    }
    this.boostMeter = Math.min(1, this.boostMeter + 0.12);
    this.sound.sfxCollect(this.combo);
    // RETRO GLITCH pickup feedback: chunky matte pixel chips, ZERO light
    this.particles.starSparkle(star.wx, star.wy, star.wz);
    if (tier !== prevTier && tier.label) {
      this.announce(`${tier.label} ! x${tier.mult}`, 'small teal');
      this.events.push({ type: 'glitch', power: 0.22 });
    }
    // star streaks reload the banana launcher
    this._starsSinceMissile += 1;
    if (this._starsSinceMissile >= STARS_PER_MISSILE) {
      this._starsSinceMissile = 0;
      this._grantMissile(1);
    }
    if (this.potassium >= 1 && !this.superActive) this._triggerSuper();
  }

  /** Rare golden banana pickup: jackpot (also feeds the combo chain). */
  onGolden(g) {
    if (this.state !== State.PLAYING) return;
    this.goldens += 1;
    this.combo += 3;
    this.comboTimer = COMBO_TIME;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.scoreF += 500 * Math.max(1, this._comboTier().mult * 0.5);
    this.boostMeter = 1;
    if (!this.superActive) this.potassium = Math.min(1, this.potassium + 0.3);
    this.sound.sfxGolden();
    this.particles.goldenBurst(g.wx, g.wy, g.wz);
    this.announce('BANANE DORÉE ! +500', 'big');
    this.events.push({ type: 'slowmo', scale: 0.5, dur: 0.22 });
    this._grantMissile(2);
    if (this.potassium >= 1 && !this.superActive) this._triggerSuper();
  }

  /** Grazed an obstacle at speed without getting hit: risk pays. */
  onNearMiss() {
    if (this.state !== State.PLAYING || this.superActive) return;
    this.nearMisses += 1;
    this.combo += 1;
    this.comboTimer = COMBO_TIME;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
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

  /* ================= banana missiles ================= */

  /** Fire a banana missile (F / E / click). Auto-aims at the nearest
   *  obstacle ahead; ammo comes from star streaks + golden bananas. */
  fireMissile() {
    if (this.state !== State.PLAYING) return;
    if (this.time < this.missileCdUntil) return;
    if (this.missileAmmo <= 0) {
      this.missileCdUntil = this.time + 0.35; // spam guard on the empty click
      this.sound.sfxEmpty();
      this.announce('PLUS DE MISSILES — RAMASSE DES ÉTOILES !', 'small danger');
      return;
    }
    this.missileCdUntil = this.time + MISSILE_CD;
    this.missileAmmo -= 1;
    const p = this.player.position;
    // while a boss fight runs, the launcher tracks the boss (missiles hit it)
    const aim = (this.bosses && this.bosses.aimAt(p.x, p.y, p.z)) || this.environment.aimAssist(p.x, p.y, p.z);
    const speed = 46 + this.player.speed * 0.9;
    this.missiles.fire(p.x, p.y + 0.45, p.z - 1.1, aim, speed);
    this.sound.sfxMissile();
    // no muzzle flash: missiles are glow-free by design
  }

  /** Missile reached an obstacle: KABOOM + smash scoring. */
  onMissileHit(hit) {
    const pos = this.environment.smashObstacle(hit.body);
    if (!pos) return;
    this.particles.smashBurst(pos.x, pos.y, pos.z);
    this.sound.sfxExplosion();
    this.events.push({ type: 'shake', power: 0.5 });
    if (this.state !== State.PLAYING) return;
    this.smashed += 1;
    this.combo += 1;
    this.comboTimer = COMBO_TIME;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const pts = 80 + Math.min(140, this.combo * 6);
    this.scoreF += pts;
    this.announce(`KABOOM ! +${pts}`, 'small teal');
    this.events.push({ type: 'slowmo', scale: 0.62, dur: 0.1 });
  }

  _grantMissile(n) {
    if (this.missileAmmo >= MISSILE_MAX) return;
    this.missileAmmo = Math.min(MISSILE_MAX, this.missileAmmo + n);
    this.announce('MISSILE BANANE PRÊT !', 'small');
    this.sound.sfxZone();
  }

  /* ================= bosses: coconuts, barrels, waves, KILLS ================= */

  /** Boss coconut hit: comedic slip, no peel damage. */
  onCoconutHit() {
    if (this.state !== State.PLAYING) return;
    if (this.time < this.bossCdUntil) return;
    this.bossCdUntil = this.time + 0.5;
    this.player.setSlip(1.0);
    this.sound.sfxToastHit();
    this.announce('COCOT TÊTE !', 'danger small');
    this.events.push({ type: 'shake', power: 0.3 });
  }

  /** Boss barrel hit: the real threat — costs a peel layer. */
  onBarrelHit() {
    if (this.state !== State.PLAYING) return;
    if (this.time < this.bossCdUntil) return;
    this.bossCdUntil = this.time + 0.9;
    this.applyDamage(1, 'peeled');
  }

  /** Kong ground-pound shockwave: trip the banana if grounded. */
  onWaveHit() {
    if (this.state !== State.PLAYING) return;
    if (this.time < this.bossCdUntil) return;
    this.bossCdUntil = this.time + 0.6;
    this.player.setSlip(0.9);
    this.sound.sfxSlip();
    this.announce('SECOUSSE ROYALE !', 'danger small');
    this.events.push({ type: 'shake', power: 0.3 });
  }

  /** Boss gave up (timer out / banana too fast): small consolation. */
  onBossFlee(kind) {
    if (this.state !== State.PLAYING) return;
    this.scoreF += 300;
    this.sound.setIntensity('playing');
    this.announce(kind === 'mega' ? 'LE ROI S’EST ENFUI ! LÂCHE ! +300' : 'LE SINGE S’EST ENFUI ! +300', 'small');
    this.events.push({ type: 'glitch', power: 0.5 });
    this.nextBossAt = this.distance + 650;
  }

  /** A banana missile connected with the boss — KABOOM + maybe MEGA BONUS. */
  onBossMissileHit(hit) {
    const res = this.bosses ? this.bosses.damage() : null;
    if (!res) return;
    this.particles.bossHitBurst(res.x, res.y, res.z);
    this.sound.sfxExplosion();
    this.events.push({ type: 'shake', power: 0.35 });
    this.events.push({ type: 'glitch', power: 0.4 });
    if (this.state !== State.PLAYING) return;
    this.combo += 1;
    this.comboTimer = COMBO_TIME;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (res.killed) {
      this.bossesKilled += 1;
      const mega = res.kind === 'mega';
      const pts = mega ? 10000 : 2500;
      this.scoreF += pts;
      // MEGA BONUS: peel repair + full ammo + full endurance + potassium
      this.peel = Math.min(4, this.peel + (mega ? 4 : 1));
      this.player.restorePeel(mega ? 4 : 1);
      this.missileAmmo = MISSILE_MAX;
      this.player.endurance = 1;
      this.boostMeter = 1;
      if (!this.superActive) this.potassium = mega ? 1 : Math.min(1, this.potassium + 0.45);
      this.sound.sfxMegaBonus();
      this.sound.setIntensity('playing');
      this.announce(mega ? 'ROI KONG VAINCU !! MEGA JACKPOT +10000' : 'SINGE ÉCRASÉ !! MEGA BONUS +2500', 'big');
      this.particles.bonusStorm(this.player.position.x, 2.6, this.player.position.z - 6, mega ? 90 : 55);
      this.events.push({ type: 'slowmo', scale: 0.3, dur: 0.55 });
      this.events.push({ type: 'glitch', power: 1 });
      this.nextBossAt = this.distance + (mega ? 1500 : 750);
      if (this.potassium >= 1 && !this.superActive) this._triggerSuper();
    } else {
      this.scoreF += 150;
      this.announce(`TOUCHE ! ${res.hp}/${res.maxHp}`, 'small');
    }
  }

  /** PEEL PATCH first-aid kit: repairs a torn peel layer (or pays points). */
  onPatch(p) {
    if (this.state !== State.PLAYING) return;
    this.sound.sfxPatch();
    this.particles.patchPop(p.wx, p.wy, p.wz);
    if (this.peel < 4) {
      this.peel += 1;
      this.player.restorePeel(1);
      this.scoreF += 100;
      this.announce('PEEL RÉPARÉ ! +1', 'small teal');
      this.events.push({ type: 'glitch', power: 0.25 });
    } else {
      this.scoreF += 250;
      this.announce('PANSEMENT GASPILLÉ ! +250', 'small');
    }
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
    // (no glow trail anymore: the mode reads through the banana's tint,
    // pulse and the sound — nothing additive follows the player)
    if (this.superActive) {
      this.superTimer -= dt;
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

    // ---- combo decay + COMBO BANK payout ----
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        if (this.combo >= 6) {
          const bank = this.combo * 15;
          this.scoreF += bank;
          this.announce(`COMBO BANKÉE ! +${bank}`, 'small teal');
        }
        this.combo = 0;
      }
    }

    // ---- ARCADE BOSSES: SINGE SUPREME & ROI KONG COSMIQUE ----
    if (this.bosses) {
      if (!this.bosses.boss && this.distance >= this.nextBossAt) {
        this.bossN += 1;
        const kind = this.bossN % 3 === 0 ? 'mega' : 'mini';
        this.bosses.spawn(kind, player.position.z);
        this.sound.sfxBoss(kind === 'mega');
        this.sound.setIntensity('super'); // boss music!
        this.announce(kind === 'mega'
          ? '!! BOSS: ROI KONG COSMIQUE !!'
          : '!! MINI-BOSS: SINGE SUPREME !!', 'boss');
        this.events.push({ type: 'glitch', power: 1 });
        this.events.push({ type: 'shake', power: 0.5 });
        this.events.push({ type: 'slowmo', scale: 0.55, dur: 0.3 });
      }
      if (this.bosses.boss) {
        this.bosses.update(dt, {
          active: true,
          playerPos: player.position,
          playerSpeed: player.speed,
          time: this.time,
          particles: this.particles,
          onTaunt: (t) => this.announce(t, 'danger small'),
          onCoconutHit: () => this.onCoconutHit(),
          onBarrelHit: () => this.onBarrelHit(),
          onWaveHit: () => this.onWaveHit(),
          onPound: () => {
            this.sound.sfxDiveLand();
            this.events.push({ type: 'shake', power: 0.45 });
          },
          onFlee: (kind) => this.onBossFlee(kind),
        });
      }
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
    if (this.missileAmmo !== h.msl && d.missileIcons.length) {
      d.missileIcons.forEach((icon, i) => icon.classList.toggle('empty', i >= this.missileAmmo));
      h.msl = this.missileAmmo;
    }
    // ENDURANCE — the jump governor, always on screen so a denied jump is
    // never a mystery: the bar says exactly how much bounce is left.
    const e = Math.round(this.player.endurance * 100);
    if (e !== h.end) {
      if (d.eFill) {
        d.eFill.style.width = `${e}%`;
        d.eFill.classList.toggle('low', this.player.endurance < 0.3);
      }
      h.end = e;
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

    // ---- COMBO chain (tiers + timer bar) ----
    const tier = this._comboTier();
    const showCombo = this.combo >= 2;
    if (showCombo !== h.comboOn || this.combo !== h.comboN || tier.label !== h.comboTier) {
      h.comboOn = showCombo;
      h.comboN = this.combo;
      h.comboTier = tier.label;
      if (d.comboEl) {
        d.comboEl.classList.toggle('hidden', !showCombo);
        d.comboEl.classList.toggle('fever', tier.mult >= 8);
        if (d.comboCount) d.comboCount.textContent = `x${this.combo}`;
        if (d.comboTierEl) d.comboTierEl.textContent = tier.label || 'COMBO';
      }
    }
    if (showCombo && d.comboFill) {
      d.comboFill.style.width = `${Math.round(Math.max(0, Math.min(1, this.comboTimer / COMBO_TIME)) * 100)}%`;
    }
  }

  /** Current combo tier (identity-comparable object or the base tier). */
  _comboTier() {
    for (const t of COMBO_TIERS) {
      if (this.combo >= t.at) return t;
    }
    return { at: 0, mult: 1, label: null };
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
