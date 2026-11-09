# 🍌 Life is a Banana: The Cosmic Slip

> **Synthwave physics arcade runner** — pure client-side, zero build, playable offline & on GitHub Pages.

[![Play](https://img.shields.io/badge/▶_Play_Now-ff2d95?style=for-the-badge)](https://devingmann.github.io/life-is-a-banana/public/game/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Three.js](https://img.shields.io/badge/Three.js-0.187-black?style=flat-square&logo=threedotjs)](https://threejs.org)
[![cannon-es](https://img.shields.io/badge/cannon--es-0.20-blue?style=flat-square)](https://github.com/pmndrs/cannon-es)

---

## 🎮 Play

**Live demo** → [https://devingmann.github.io/life-is-a-banana/public/game/](https://devingmann.github.io/life-is-a-banana/public/game/)

Or open `public/game/index.html` locally in Chrome / Edge / Firefox.

---

## 🕹️ Controls

| Action | Keyboard | Touch |
|--------|----------|-------|
| Steer | **ZQSD** / **WASD** / **← →** | Left / Right pads |
| Jump | **Space** / **↑** / **Z/W** (hold = bounce) | JUMP button |
| Double Jump *Heli-Peel* | **Space ×2** (in air) | JUMP while airborne |
| Dive / Stomp | **↓** / **S** | — |
| Turbo Banana Split | **Shift** | TURBO button |
| Banana Missile | **F** / **E** / **Click** | FEU button |
| Pause / Mute | **P** / **M** | — |
| Restart | **Space** / **Enter** / **R** | — |

---

## ✨ Features (v3 BANANA BALLISTICS)

- Full physics runner with **cannon-es**
- **Banana Missiles** with soft auto-aim
- Zone system every 400 m (Jungle Néon → Ouragan Violet → Inferno Solaire…)
- Bosses: Singe Suprême & Roi Kong Cosmique
- Endurance-governed jumps + Heli-Peel double jump
- Near-miss **GRAZE** bonuses, golden bananas, peel patches
- Adaptive quality + anti-stuck watchdog
- Pure retro-glitch post-processing (VHS + CRT, never washes the screen)
- 100 % offline, no backend, no build step

---

## 🛠️ Tech Stack

- **Three.js** 0.187 (ES modules + importmap)
- **cannon-es** 0.20
- Vanilla JS (no React / no bundler for the game itself)
- Optional Next.js wrapper for the landing page

---

## 📁 Project Structure

```
public/game/          ← the actual playable game (open index.html)
download/             ← standalone zip
src/                  ← Next.js shell (iframe)
```

---

## 🚀 Local

```bash
# Just open the game
open public/game/index.html
# or
npx serve public/game
```

---

## 📜 License

MIT — free to play, fork, and peel.

Made with 🍌 and excessive potassium.
