# 🚀🌙 COSMIC RUSH – Journey to the Moon

> A fully playable 3D endless runner for the web. Outrun a darawna alien hunter across a floating neon pathway in deep space while a giant blue Moon glows on the horizon.

**[Play in your browser – no install required](https://your-github-username.github.io/cosmic-rush/)** (update this URL after deploying to GitHub Pages).

![cosmic-rush](https://img.shields.io/badge/made%20with-Three.js-8be9fd?style=flat-square) ![license](https://img.shields.io/badge/license-MIT-pink?style=flat-square) ![version](https://img.shields.io/badge/version-1.0.0-cyan?style=flat-square)

## ✨ Features

- **Endless 3-lane runner** with lane switches, jumps, slides, double jumps & ledge grab
- **Three difficulty levels** — Amateur 🟢, Challenging 🟡, Extreme 🔴
- **Interactive first-time tutorial** (7 steps inside the actual game world)
- **Darawna alien chaser** breathing down your neck with screen shake + roars
- **6 power-ups** — 🚀 Mini Rocket, 🛡️ Space Shield, 👢 Gravity Boots, 🧲 Star Magnet, 💚 Safety Kit, ⚡ Hyper Boost
- **Glowing mini-stars** with magnetic pull & gold / large bonuses
- **Obstacles** — clustered asteroids, satellite barriers, falling meteors with fire trails, laser gates, cargo crates with warning X, plasma energy barriers, spiked drones, broken platforms
- **Beautiful environment** — purple / blue nebula sky, starfield parallax, comets, drifting asteroids, orbiting satellites, distant explosions, and a giant blue full Moon
- **Fully procedural audio** — synthesized SFX + generative ambient space music (no asset files, ~250 KB gzipped total)
- **Bloom post-processing**, neon glow, shock particles, cinematic fog
- **Mobile + desktop** — swipe, touch, keyboard, gamepad-free controls
- **Persistent high score, best distance, last-run stats, settings**
- **Share via WhatsApp** with built-in QR code + native share sheet

## 🎮 Controls

| Action | Keyboard | Touch |
|---|---|---|
| Move left | `◀` / `A` | Swipe ◀ |
| Move right | `▶` / `D` | Swipe ▶ |
| Jump | `Space` / `▲` / `W` | Swipe ▲ or tap |
| Slide (or dive mid-air) | `▼` / `S` | Swipe ▼ |
| Pause | `Esc` / `P` | Pause button |

## 🛠️ Tech Stack

- **React 19** + **TypeScript** + **Vite 7**
- **Three.js** for 3D rendering + `UnrealBloomPass` post-processing
- Procedurally generated textures (canvas 2D) — no external image/audio assets
- Web Audio API for fully-synthesized SFX + generative ambient soundtrack
- Tailwind CSS 4 for the HUD / menus
- Ships as a **single self-contained HTML file** via `vite-plugin-singlefile`

## 🚀 Getting Started (development)

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server (opens http://localhost:5173)
npm run dev

# 3. Build the production bundle -> dist/index.html
npm run build

# 4. Preview the production build locally
npm run preview
```

The production `dist/index.html` is a single self-contained file — double-click it to play offline, or drop it onto any static host.

## 📦 Project Structure

```
cosmic-rush/
├── index.html            # HTML shell + Orbitron/Rajdhani fonts
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx          # React entry
│   ├── App.tsx           # All UI (menu, HUD, difficulty, tutorial, game-over, share)
│   ├── index.css         # Tailwind 4 + cosmic theme, neon panels, keycaps, animations
│   ├── utils/cn.ts
│   └── game/
│       ├── engine.ts     # Full Three.js runner (world, player, obstacles, alien, particles, moon, sky)
│       └── audio.ts      # Procedural WebAudio SFX + generative music
└── dist/                 # Production build (single index.html)
```

## 🎯 Gameplay Tips

- 🟢 Start on **Amateur** the first time and do the tutorial — it walks you through every move.
- Collect glowing **mini-stars** to build score; big stars (×5) give massive bonuses.
- Look ahead: satellite barriers always require a **slide**, red lasers near the ground require a **jump**, high lasers can be slid under.
- Gravity Boots let you **double-jump** — use it to save yourself from a mistimed leap.
- Safety Kit rescues you from **one** fall into the void; Space Shield absorbs one collision.
- The darawna alien creeps up if you slide too much or stay grounded too long — use Hyper Boost or Rocket to drop him back.

## 📈 Difficulty Differences

| | Amateur | Challenging | Extreme |
|---|---|---|---|
| Start speed | 9.5 m/s | 12.5 m/s | 16 m/s |
| Hazard frequency | ×0.55 | ×1.0 | ×1.45 |
| Hazard gaps | generous | normal | tight |
| Score multiplier | ×0.7 | ×1.0 | ×1.45 |

## 📦 Versioning

Current version: **v1.0** (initial release).

## 📝 License

MIT — use, fork, remix. Credit appreciated but not required.

## 🙏 Credits

Built as a hand-coded web game — no external 3D models, image textures, or audio samples. Every asteroid, star, moon crater, sound and note is generated in code.
