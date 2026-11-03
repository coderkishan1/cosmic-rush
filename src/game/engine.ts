/* ============================================================
   COSMIC RUSH – Journey to the Moon
   Core 3D endless-runner engine (Three.js, world-scroll model)
   ============================================================ */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SoundEngine } from "./audio";

/* ---------------- types ---------------- */
export type PowerId = "rocket" | "shield" | "boots" | "magnet" | "kit" | "hyper";
export type EngineMode = "menu" | "playing" | "paused" | "dying" | "over" | "tutorial";
export type Difficulty = "amateur" | "challenging" | "extreme";
export type TutorialStepId = "left" | "right" | "jump" | "slide" | "collect" | "avoid" | "done";
export interface TutorialState {
  step: TutorialStepId | null;
  progress: number; // 0..1 within current step
  title: string;
  hint: string;
  canSkip: boolean;
}
export interface PowerHud { id: PowerId; remain: number; total: number }
export interface HudData {
  score: number; distance: number; stars: number; speed: number; moon: number;
  shield: boolean; kit: boolean; mult: number; powers: PowerHud[];
}
export interface RunStats {
  score: number; distance: number; stars: number; best: number; bestDist: number;
  isRecord: boolean; reason: string;
}
export interface EngineCallbacks {
  onHud: (h: HudData) => void;
  onGameOver: (s: RunStats) => void;
  onPauseKey: () => void;
  onTutorial?: (s: TutorialState | null) => void;
}
type ObKind = "asteroid" | "satellite" | "meteor" | "laser" | "container" | "energy" | "spinner";
type TileKind = "solid" | "glass" | "hole" | "moving" | "blink" | "spin";

const LANES = [-2.3, 0, 2.3];
const SEG_LEN = 7;
const SEG_COUNT = 26;
const KILL_Z = 16;
const GRAVITY = 30;
const JUMP_V = 10.6;
const PALETTE = [0x22d3ee, 0xa78bfa, 0xf471b5, 0xfb923c, 0x60a5fa];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randi = (a: number, b: number) => Math.floor(rand(a, b + 1));
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ---------------- procedural textures ---------------- */
function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.35, "rgba(255,255,255,0.5)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

function nebulaTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#030212";
  g.fillRect(0, 0, 1024, 512);
  const cols = ["109,40,217", "29,78,216", "219,39,119", "8,145,178", "147,51,234", "190,24,93"];
  for (let i = 0; i < 26; i++) {
    const x = rand(0, 1024), y = rand(0, 512), r = rand(60, 240);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${pick(cols)},${rand(0.03, 0.09)})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // milky band
  for (let i = 0; i < 40; i++) {
    const x = rand(0, 1024), y = 250 + Math.sin(x * 0.01) * 60 + rand(-50, 50), r = rand(20, 70);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(196,181,253,${rand(0.012, 0.04)})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // stars
  for (let i = 0; i < 1100; i++) {
    const s = Math.random();
    g.fillStyle = `rgba(255,255,255,${rand(0.15, 0.95)})`;
    g.fillRect(rand(0, 1024), rand(0, 512), s > 0.97 ? 2 : 1, s > 0.97 ? 2 : 1);
  }
  for (let i = 0; i < 24; i++) {
    const x = rand(0, 1024), y = rand(0, 512), r = rand(2, 5);
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 3);
    gr.addColorStop(0, "rgba(255,255,255,0.9)");
    gr.addColorStop(0.4, `rgba(${pick(["165,243,252", "249,168,212", "253,230,138"])},0.4)`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function moonTexture(): THREE.Texture {
  // Photo-real blue-white full moon (2048px) matching the key-art reference.
  const size = 2048;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 16;

  g.clearRect(0, 0, size, size);

  // Base disc: cool blue-white full moon. Bright sunlit top-left, subtle blue terminator shadow to lower-right.
  const base = g.createRadialGradient(cx - R * 0.4, cy - R * 0.42, R * 0.04, cx, cy, R);
  base.addColorStop(0.00, "#ffffff");
  base.addColorStop(0.10, "#f2f7ff");
  base.addColorStop(0.30, "#dbe7fb");
  base.addColorStop(0.65, "#8faadf");
  base.addColorStop(1.00, "#263f72");
  g.fillStyle = base;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();

  // Bright upper-left sun highlight (crisp sheen where the sun hits the full moon)
  const hi = g.createRadialGradient(cx - R * 0.48, cy - R * 0.5, 0, cx - R * 0.48, cy - R * 0.5, R * 0.62);
  hi.addColorStop(0.0, "rgba(255,255,255,0.65)");
  hi.addColorStop(0.3, "rgba(220,232,255,0.25)");
  hi.addColorStop(1.0, "rgba(255,255,255,0)");
  g.fillStyle = hi;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();

  // Subtle blue atmospheric tint across the lower-right quadrant
  const coolWash = g.createRadialGradient(cx + R * 0.25, cy + R * 0.2, R * 0.1, cx, cy, R * 0.9);
  coolWash.addColorStop(0, "rgba(90,140,220,0.22)");
  coolWash.addColorStop(1, "rgba(90,140,220,0)");
  g.fillStyle = coolWash;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

  // Limb darkening (subtle — keeps edges crisp near top-left, deepens bottom-right)
  const limb = g.createRadialGradient(cx - R * 0.15, cy - R * 0.15, R * 0.55, cx, cy, R);
  limb.addColorStop(0, "rgba(0,0,0,0)");
  limb.addColorStop(0.75, "rgba(8,14,36,0.08)");
  limb.addColorStop(1.0, "rgba(8,14,36,0.5)");
  g.fillStyle = limb;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

  // Major lunar maria (placed to match a real full moon as seen in the reference)
  // Coordinates are in -1..1 disc space with North up.
  const mariaDefs = [
    // Oceanus Procellarum — big dark western (left) ocean
    { x: -0.32, y:  0.02, rx: 0.28, ry: 0.42, rot:  0.22, dark: 0.58 },
    // Mare Imbrium — large round mare upper-left
    { x: -0.16, y: -0.25, rx: 0.22, ry: 0.18, rot: -0.4, dark: 0.62 },
    // Mare Serenitatis + Mare Tranquillitatis — upper-middle to upper-right
    { x:  0.05, y: -0.23, rx: 0.22, ry: 0.16, rot:  0.2, dark: 0.56 },
    { x:  0.22, y: -0.16, rx: 0.14, ry: 0.12, rot:  0.3, dark: 0.5 },
    // Mare Nubium + Mare Humorum — south-west (bottom-left)
    { x: -0.18, y:  0.25, rx: 0.20, ry: 0.16, rot: -0.3, dark: 0.55 },
    { x: -0.36, y:  0.20, rx: 0.10, ry: 0.09, rot:  0.3, dark: 0.52 },
    // Mare Fecunditatis / Mare Nectaris — eastern (right) seas
    { x:  0.32, y:  0.05, rx: 0.11, ry: 0.18, rot: -0.2, dark: 0.5 },
    // Mare Frigoris — northern band across top
    { x:  0.00, y: -0.42, rx: 0.26, ry: 0.06, rot:  0.0, dark: 0.4 },
    // Sinus Iridum rim glow area (upper-left of Imbrium) — leave highlight, don't darken
    // Small central Mare Vaporum
    { x:  0.02, y: -0.04, rx: 0.08, ry: 0.06, rot:  0.2, dark: 0.4 },
  ];
  for (const m of mariaDefs) {
    g.save();
    g.translate(cx + m.x * R, cy + m.y * R);
    g.rotate(m.rot);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(m.rx, m.ry) * R);
    gr.addColorStop(0, `rgba(22,36,70,${m.dark})`);
    gr.addColorStop(0.6, `rgba(28,46,88,${m.dark * 0.55})`);
    gr.addColorStop(1, "rgba(28,46,88,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, 0, m.rx * R, m.ry * R, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // Medium dark highland blotches
  for (let i = 0; i < 90; i++) {
    const x = (Math.random() - 0.5) * 1.5 * R;
    const y = (Math.random() - 0.5) * 1.5 * R;
    const r = rand(10, 42);
    if (Math.hypot(x, y) + r > R * 0.97) continue;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(40,62,110,${rand(0.12, 0.28)})`);
    gr.addColorStop(1, "rgba(40,62,110,0)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // Thousands of tiny craters (pinprick shadows + highlights)
  for (let i = 0; i < 1600; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * R * 0.98;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const r = rand(1, 4);
    g.fillStyle = `rgba(20,34,66,${rand(0.18, 0.5)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(255,255,255,${rand(0.2, 0.6)})`;
    g.beginPath(); g.arc(x - r * 0.4, y - r * 0.4, r * 0.55, 0, Math.PI * 2); g.fill();
  }

  // Bright ray craters (matching the reference's prominent ray systems)
  // Tycho dominates the southern hemisphere with long sweeping rays; Copernicus/Keple/Aristarchus upper-left.
  const rayCraters = [
    { x:  0.00, y:  0.44, r: 13, rays: 46, len: 0.32, bright: 0.95, name: "Tycho"     },
    { x: -0.30, y: -0.24, r: 11, rays: 30, len: 0.22, bright: 0.8,  name: "Copernicus" },
    { x: -0.44, y:  0.05, r:  8, rays: 22, len: 0.18, bright: 0.7,  name: "Kepler"    },
    { x: -0.42, y: -0.32, r:  7, rays: 20, len: 0.17, bright: 0.75, name: "Aristarchus"},
    { x:  0.42, y: -0.08, r:  6, rays: 18, len: 0.14, bright: 0.6,  name: "Proclus"   },
  ];
  for (const rc of rayCraters) {
    const rx = cx + rc.x * R, ry = cy + rc.y * R;
    for (let k = 0; k < rc.rays; k++) {
      const ang = (k / rc.rays) * Math.PI * 2;
      // Rays are slightly irregular streaks tapering with distance
      const len = (0.4 + Math.random() * 0.9) * rc.len * R;
      g.save();
      g.globalAlpha = rand(0.12, rc.bright) * (rc.name === "Tycho" ? 0.9 : 0.7);
      g.strokeStyle = "rgba(255,255,255,1)";
      g.lineWidth = rand(0.6, rc.name === "Tycho" ? 2.6 : 1.6);
      g.beginPath();
      // Wavy ray for realism
      const midX = rx + Math.cos(ang) * len * 0.5 + rand(-len * 0.05, len * 0.05);
      const midY = ry + Math.sin(ang) * len * 0.5 + rand(-len * 0.05, len * 0.05);
      const ex = rx + Math.cos(ang) * len;
      const ey = ry + Math.sin(ang) * len;
      g.moveTo(rx, ry);
      g.quadraticCurveTo(midX, midY, ex, ey);
      g.stroke();
      g.restore();
    }
    // Bright crater pit
    g.fillStyle = `rgba(255,255,255,${0.95})`;
    g.beginPath(); g.arc(rx, ry, rc.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(235,245,255,1)";
    g.beginPath(); g.arc(rx - rc.r * 0.35, ry - rc.r * 0.35, rc.r * 0.55, 0, Math.PI * 2); g.fill();
    // Faint dark halo around crater
    const halo = g.createRadialGradient(rx, ry, rc.r * 0.8, rx, ry, rc.r * 3.2);
    halo.addColorStop(0, "rgba(30,45,80,0.25)");
    halo.addColorStop(1, "rgba(30,45,80,0)");
    g.fillStyle = halo;
    g.beginPath(); g.arc(rx, ry, rc.r * 3.2, 0, Math.PI * 2); g.fill();
  }

  // Smaller bright craterlets scattered (reference has many tiny sparkly highlights)
  for (let i = 0; i < 120; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * R * 0.96;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const r = rand(0.8, 2.4);
    g.fillStyle = `rgba(255,255,255,${rand(0.5, 0.9)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // Warm bright rim highlight near upper-left (crescent sheen)
  const sheen = g.createRadialGradient(cx - R * 0.82, cy - R * 0.86, 0, cx - R * 0.82, cy - R * 0.86, R * 0.35);
  sheen.addColorStop(0, "rgba(255,245,225,0.7)");
  sheen.addColorStop(1, "rgba(255,245,225,0)");
  g.fillStyle = sheen;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

  // Outer atmospheric blue rim (brightest along the sunlit top-left edge)
  const rim = g.createRadialGradient(cx - R * 0.4, cy - R * 0.4, R * 0.85, cx, cy, R * 1.03);
  rim.addColorStop(0, "rgba(200,230,255,0)");
  rim.addColorStop(0.78, "rgba(180,220,255,0.0)");
  rim.addColorStop(0.92, "rgba(200,230,255,0.7)");
  rim.addColorStop(1, "rgba(80,130,220,0)");
  g.fillStyle = rim;
  g.beginPath(); g.arc(cx, cy, R * 1.03, 0, Math.PI * 2); g.fill();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

function emojiTexture(emoji: string): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "46px serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 32, 36);
  return new THREE.CanvasTexture(c);
}

function starGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.34 : 0.145;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  geo.center();
  return geo;
}

/* ---------------- particle system ---------------- */
class Particles {
  points: THREE.Points;
  private cap: number;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseCol: Float32Array;
  private grav: Float32Array;
  private cursor = 0;

  constructor(cap: number, tex: THREE.Texture) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3).fill(9999);
    this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.baseCol = new Float32Array(cap * 3);
    this.grav = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({
      size: 0.34, map: tex, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  burst(p: THREE.Vector3 | { x: number; y: number; z: number }, count: number, color: THREE.Color | number, opts: { speed?: number; life?: number; gravity?: number; up?: number } = {}) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const th = rand(0, Math.PI * 2), ph = rand(-1, 1);
      const s = (opts.speed ?? 5) * rand(0.3, 1);
      this.vel[i * 3] = Math.cos(th) * s;
      this.vel[i * 3 + 1] = ph * s * 0.8 + (opts.up ?? 0);
      this.vel[i * 3 + 2] = Math.sin(th) * s;
      this.life[i] = this.maxLife[i] = (opts.life ?? 0.8) * rand(0.6, 1.15);
      this.grav[i] = opts.gravity ?? 0;
      const v = rand(0.7, 1.3);
      this.baseCol[i * 3] = c.r * v; this.baseCol[i * 3 + 1] = c.g * v; this.baseCol[i * 3 + 2] = c.b * v;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = 9999; this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] = this.baseCol[i * 3] * f;
      this.col[i * 3 + 1] = this.baseCol[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.baseCol[i * 3 + 2] * f;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ---------------- world object interfaces ---------------- */
interface Tile {
  lane: number; kind: TileKind; phase: number; x: number; solidNow: boolean;
  variants: THREE.Object3D[]; activeIdx: number; holeFrame: THREE.Object3D;
  bodyMeshes: THREE.Mesh[]; edgeLines: THREE.LineSegments[];
}
interface Segment {
  group: THREE.Group; z: number; tiles: Tile[]; crystals: THREE.Mesh[];
  glow: THREE.Mesh; rails: THREE.Mesh[];
}
interface Obstacle {
  kind: ObKind; group: THREE.Group; active: boolean; z: number; lane: number;
  x: number; hx: number; hy0: number; hy1: number; hd: number; t: number;
  data: Record<string, any>;
}
interface StarItem { active: boolean; x: number; y: number; z: number; val: number; scale: number; pull: boolean }
interface Pickup { id: PowerId; group: THREE.Group; active: boolean; z: number; x: number; t: number }

/* ============================================================ */
export class CosmicEngine {
  mode: EngineMode = "menu";
  sound = new SoundEngine();

  private container: HTMLElement;
  private cb: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private hiFx = true;
  private raf = 0;
  private clock = new THREE.Clock();
  private time = 0;
  private disposed = false;

  /* run state */
  difficulty: Difficulty = "challenging";
  tutorialActive = false;
  tutorialStep: TutorialStepId | null = null;
  tutorialStepTime = 0;
  tutorialWaitInput = false;
  tutorialCompletedThisStep = false;
  onTutorialStep: ((s: TutorialState | null) => void) | null = null;
  tutorialFirstInput = false;

  private difficultyMult = {
    // base speed, hazard freq multiplier, hazard min gap bonus, hazard cooldown floor bonus
    amateur:     { base: 9.5,  hazardFreq: 0.55, gapBonus: 1,   cdFloor: 2, scoreMult: 0.7 },
    challenging: { base: 12.5, hazardFreq: 1.0,  gapBonus: 0,   cdFloor: 0, scoreMult: 1.0 },
    extreme:     { base: 16,   hazardFreq: 1.45, gapBonus: -1,  cdFloor: -1, scoreMult: 1.45 },
  } as const;

  private speed = 12.5;
  private dist = 0;
  private score = 0;
  private starCount = 0;
  private starPoints = 0;
  private streak = 0;
  private streakT = 0;
  private segSerial = 0;
  private hazardCooldown = 0;
  private deathTimer = 0;
  private deathReason = "";
  private hudTimer = 0;

  /* player */
  private player = new THREE.Group();
  private visual = new THREE.Group();
  private parts: Record<string, THREE.Object3D> = {};
  private lane = 1;
  private px = 0;
  private py = 0;
  private vy = 0;
  private grounded = true;
  private falling = false;
  private sliding = 0;
  private runT = 0;
  private jumpsUsed = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private invuln = 0;
  private autoT = 0;

  /* powers */
  private powers: Record<PowerId, number> = { rocket: 0, shield: 0, boots: 0, magnet: 0, kit: 0, hyper: 0 };
  private powerTotals: Record<PowerId, number> = { rocket: 5.5, shield: 0, boots: 11, magnet: 9, kit: 0, hyper: 6.5 };

  /* world */
  private segments: Segment[] = [];
  private obstacles: Obstacle[] = [];
  private obPool = new Map<ObKind, Obstacle[]>();
  private pickups: Pickup[] = [];
  private pickPool = new Map<PowerId, Pickup[]>();
  private stars: StarItem[] = [];
  private starMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private particles: Particles;
  private glowTex: THREE.Texture;
  private moonGroup = new THREE.Group();
  private sky!: THREE.Mesh;
  private starClouds: THREE.Points[] = [];
  private dust!: THREE.Points;
  private dustPos!: Float32Array;
  private comets: { head: THREE.Sprite; trail: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];
  private bgRocks: THREE.Mesh[] = [];
  private bgSats: THREE.Group[] = [];
  private flashLight: THREE.PointLight;
  private nextExplode = 6;
  private playerLight: THREE.PointLight;
  private trauma = 0;

  /* shared materials / geometry */
  private bodyMats: THREE.MeshStandardMaterial[] = [];
  private edgeMats: THREE.LineBasicMaterial[] = [];
  private glowMats: THREE.MeshBasicMaterial[] = [];
  private holeMat: THREE.LineBasicMaterial;
  private glassMat: THREE.MeshPhongMaterial;
  private glassEdge: THREE.LineBasicMaterial;
  private tileGeos: { geo: THREE.BufferGeometry; edges: THREE.EdgesGeometry; offsets: number[]; rotY: number[] }[] = [];
  private asteroidGeo: THREE.BufferGeometry;
  private chunkGeos: THREE.BufferGeometry[] = [];
  private rockMat: THREE.MeshStandardMaterial;
  private rockDarkMat: THREE.MeshStandardMaterial;
  private metalMat: THREE.MeshStandardMaterial;
  private metalDarkMat: THREE.MeshStandardMaterial;
  private crateMat: THREE.MeshStandardMaterial;
  private meteorHotMat: THREE.MeshStandardMaterial;
  private laserPostMat: THREE.MeshStandardMaterial;
  private panelMat: THREE.MeshStandardMaterial;
  private panelGlowMat: THREE.MeshStandardMaterial;
  private alienGroup = new THREE.Group();
  private alienData: {
    eyes: THREE.Mesh[]; tendrils: THREE.Mesh[]; body: THREE.Group;
    breathT: number; gap: number; roarT: number; threat: number; trailParticles: { x: number; y: number; z: number; life: number }[];
  } | null = null;
  private starGeo: THREE.ExtrudeGeometry;

  constructor(container: HTMLElement, cb: EngineCallbacks) {
    this.container = container;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.setClearColor(0x05030f);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, container.clientWidth / container.clientHeight, 0.1, 2200);
    this.camera.position.set(0, 4.4, 8.2);
    this.scene.fog = new THREE.FogExp2(0x040615, 0.0092);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.28, 0.45, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.glowTex = glowTexture();
    this.particles = new Particles(900, this.glowTex);
    this.scene.add(this.particles.points);

    /* shared tile materials */
    for (const c of PALETTE) {
      this.bodyMats.push(new THREE.MeshStandardMaterial({ color: 0x222856, emissive: c, emissiveIntensity: 0.32, roughness: 0.4, metalness: 0.55 }));
      this.edgeMats.push(new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.95 }));
      this.glowMats.push(new THREE.MeshBasicMaterial({ map: this.glowTex, color: c, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }));
    }
    this.holeMat = new THREE.LineBasicMaterial({ color: 0xff5533, transparent: true, opacity: 0.8 });
    this.glassMat = new THREE.MeshPhongMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.32, shininess: 120, emissive: 0x14324f, depthWrite: false });
    this.glassEdge = new THREE.LineBasicMaterial({ color: 0xbdf3ff, transparent: true, opacity: 0.9 });
    this.asteroidGeo = new THREE.IcosahedronGeometry(1.05, 1);
    const pa = this.asteroidGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pa, i);
      v.multiplyScalar(1 + rand(-0.2, 0.24));
      pa.setXYZ(i, v.x, v.y, v.z);
    }
    this.asteroidGeo.computeVertexNormals();
    // Pre-make a few smaller rock chunks for clustered realistic asteroids
    for (let i = 0; i < 5; i++) {
      const g = new THREE.IcosahedronGeometry(rand(0.35, 0.7), 0);
      const pa = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pa.count; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(pa, k);
        v.multiplyScalar(1 + rand(-0.28, 0.3));
        pa.setXYZ(k, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      this.chunkGeos.push(g);
    }
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6570, roughness: 0.98, flatShading: true, metalness: 0.05 });
    this.rockDarkMat = new THREE.MeshStandardMaterial({ color: 0x3d3742, roughness: 1, flatShading: true, metalness: 0.05 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x8891a0, metalness: 0.9, roughness: 0.35 });
    this.metalDarkMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3d, metalness: 0.85, roughness: 0.45 });
    this.crateMat = new THREE.MeshStandardMaterial({ color: 0x3b4555, metalness: 0.7, roughness: 0.55 });
    this.meteorHotMat = new THREE.MeshStandardMaterial({ color: 0x4a3228, roughness: 0.92, flatShading: true, emissive: 0xff5522, emissiveIntensity: 1.3 });
    this.laserPostMat = new THREE.MeshStandardMaterial({ color: 0x232733, metalness: 0.85, roughness: 0.35, emissive: 0x7a1522, emissiveIntensity: 0.35 });
    this.panelMat = new THREE.MeshStandardMaterial({ color: 0x0c1a33, metalness: 0.7, roughness: 0.3, emissive: 0x1e3a6b, emissiveIntensity: 0.25 });
    this.panelGlowMat = new THREE.MeshStandardMaterial({ color: 0x0b1226, emissive: 0x22d3ee, emissiveIntensity: 1.1, metalness: 0.6, roughness: 0.25 });
    this.starGeo = starGeometry();

    this.buildTileGeos();
    this.buildLights();
    this.buildBackground();
    this.buildTrack();
    this.buildPlayer();
    this.buildAlien();
    this.starMesh = this.buildStars();
    this.flashLight = new THREE.PointLight(0xffaa66, 0, 300, 1.2);
    this.flashLight.position.set(0, 40, -250);
    this.scene.add(this.flashLight);
    this.playerLight = new THREE.PointLight(0x67e8f9, 9, 11, 1.8);
    this.playerLight.position.set(0, 2.4, 1);
    this.scene.add(this.playerLight);

    this.resetWorld();
    this.bindInput();
    window.addEventListener("resize", this.onResize);
    this.loop();
  }

  /* ---------------- construction ---------------- */
  private buildTileGeos() {
    // hex trio
    const hex = new THREE.CylinderGeometry(1.32, 1.32, 0.26, 6);
    // long rect
    const rect = new THREE.BoxGeometry(2.16, 0.26, 6.8);
    // triangle prism (half plate)
    const triShape = new THREE.Shape();
    triShape.moveTo(-1.08, -3.4); triShape.lineTo(1.08, -3.4); triShape.lineTo(-1.08, 3.4); triShape.closePath();
    const tri = new THREE.ExtrudeGeometry(triShape, { depth: 0.26, bevelEnabled: false });
    tri.rotateX(Math.PI / 2);
    tri.translate(0, 0.13, 0);
    this.tileGeos = [
      { geo: hex, edges: new THREE.EdgesGeometry(hex, 20), offsets: [-2.32, 0, 2.32], rotY: [0, 0, 0] },
      { geo: rect, edges: new THREE.EdgesGeometry(rect), offsets: [0], rotY: [0] },
      { geo: tri, edges: new THREE.EdgesGeometry(tri, 20), offsets: [0, 0], rotY: [0, Math.PI] },
      { geo: rect, edges: new THREE.EdgesGeometry(rect), offsets: [0], rotY: [0] }, // glass uses rect
    ];
  }

  private buildLights() {
    this.scene.add(new THREE.AmbientLight(0x1f2b4f, 0.75));
    const hemi = new THREE.HemisphereLight(0x5c86c6, 0x03050f, 0.45);
    this.scene.add(hemi);
    const moonLight = new THREE.DirectionalLight(0x8ab6ff, 1.25);
    moonLight.position.set(0, 55, -300);
    this.scene.add(moonLight);
    const rim = new THREE.DirectionalLight(0x3d5aa0, 0.22);
    rim.position.set(-40, 20, 60);
    this.scene.add(rim);
  }

  private buildBackground() {
    // nebula sky sphere
    const skyGeo = new THREE.SphereGeometry(1200, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ map: nebulaTexture(), side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    // Deep-space gradient layer (black top, blue horizon, dark below) – reference mood
    const spaceGrad = (() => {
      const c = document.createElement("canvas");
      c.width = 8; c.height = 1024;
      const g = c.getContext("2d")!;
      const gr = g.createLinearGradient(0, 0, 0, 1024);
      gr.addColorStop(0.00, "#010206");
      gr.addColorStop(0.35, "#030618");
      gr.addColorStop(0.50, "#06102e");
      gr.addColorStop(0.55, "#0e2255");
      gr.addColorStop(0.60, "#06102e");
      gr.addColorStop(1.00, "#02040c");
      g.fillStyle = gr;
      g.fillRect(0, 0, 8, 1024);
      return new THREE.CanvasTexture(c);
    })();
    const bgGrad = new THREE.Mesh(
      new THREE.PlaneGeometry(2200, 1200),
      new THREE.MeshBasicMaterial({ map: spaceGrad, transparent: true, opacity: 0.68, depthWrite: false, fog: false })
    );
    bgGrad.position.set(0, 0, -620);
    this.scene.add(bgGrad);
    this.moonGroup.userData.bgGrad = bgGrad;

    // parallax star clouds
    for (let layer = 0; layer < 2; layer++) {
      const n = 700;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = rand(300, 1000);
        const th = rand(0, Math.PI * 2), ph = Math.acos(rand(-1, 1));
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.7 - 60;
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        size: layer === 0 ? 2.4 : 4.2, map: this.glowTex, transparent: true, opacity: 0.55,
        color: layer === 0 ? 0xffffff : 0xa5c8ff, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      this.starClouds.push(pts);
    }

    // THE MOON – destination, forever ahead. Crisp full-moon disc like the reference.
    const moonMat = new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, opacity: 0.98, color: 0xffffff, fog: false, depthWrite: false });
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(132, 132), moonMat);
    this.moonGroup.add(moon);
    const innerHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    innerHalo.scale.set(152, 152, 1);
    this.moonGroup.add(innerHalo);
    const midHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x9fc2ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    midHalo.scale.set(250, 250, 1);
    this.moonGroup.add(midHalo);
    const outerHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x4a7fd8, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    outerHalo.scale.set(460, 460, 1);
    this.moonGroup.add(outerHalo);
    // Horizon atmospheric blue band beneath the moon (subtle, dimmer)
    const horizonTex = (() => {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 128;
      const g = c.getContext("2d")!;
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, "rgba(90,140,220,0.0)");
      gr.addColorStop(0.38, "rgba(80,130,210,0.28)");
      gr.addColorStop(0.5, "rgba(130,180,240,0.42)");
      gr.addColorStop(0.62, "rgba(60,100,180,0.22)");
      gr.addColorStop(1, "rgba(10,20,50,0.0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 512, 128);
      return new THREE.CanvasTexture(c);
    })();
    const horizonBand = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 90),
      new THREE.MeshBasicMaterial({ map: horizonTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    );
    horizonBand.position.set(0, -55, -20);
    this.moonGroup.add(horizonBand);
    // store reference for per-frame lookAt
    this.moonGroup.userData.moonDisc = moon;
    this.moonGroup.position.set(0, 26, -500);
    this.moonGroup.scale.setScalar(1);
    this.scene.add(this.moonGroup);

    // cosmic dust rushing past the track
    const dn = 420;
    this.dustPos = new Float32Array(dn * 3);
    for (let i = 0; i < dn; i++) {
      this.dustPos[i * 3] = rand(-28, 28);
      this.dustPos[i * 3 + 1] = rand(-10, 26);
      this.dustPos[i * 3 + 2] = rand(-170, 12);
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute("position", new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ size: 0.14, map: this.glowTex, color: 0x9fd8ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    // comets / shooting stars
    for (let i = 0; i < 4; i++) {
      const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xd8f6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      head.scale.setScalar(6);
      const trail = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: this.glowTex, color: 0x9fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
      );
      this.scene.add(head, trail);
      this.comets.push({ head, trail, vel: new THREE.Vector3(), life: 0 });
    }

    // drifting far asteroids
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5d5470, roughness: 1, flatShading: true, fog: false });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(this.asteroidGeo, rockMat);
      m.scale.setScalar(rand(1.5, 6));
      m.position.set(rand(18, 80) * (Math.random() < 0.5 ? -1 : 1), rand(-18, 40), rand(-450, -80));
      m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      this.scene.add(m);
      this.bgRocks.push(m);
    }

    // orbiting satellites
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 3.4), new THREE.MeshStandardMaterial({ color: 0xb8c2d8, metalness: 0.8, roughness: 0.3, fog: false }));
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d3f8f, emissive: 0x2563eb, emissiveIntensity: 0.7, fog: false });
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(6, 0.15, 2.2), panelMat);
      p1.position.x = 4.2;
      const p2 = p1.clone(); p2.position.x = -4.2;
      g.add(body, p1, p2);
      g.scale.setScalar(1.6);
      this.scene.add(g);
      this.bgSats.push(g);
    }
  }

  private buildTrack() {
    // continuous lane-divider strips: two lines demarcating the 3 lanes
    const divGeo = new THREE.BoxGeometry(0.07, 0.02, SEG_LEN * 0.985);
    const divMat = new THREE.MeshBasicMaterial({ color: 0xa5f0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let s = 0; s < SEG_COUNT; s++) {
      const group = new THREE.Group();
      const tiles: Tile[] = [];
      for (let l = 0; l < 3; l++) {
        const variants: THREE.Object3D[] = [];
        const bodyMeshes: THREE.Mesh[] = [];
        const edgeLines: THREE.LineSegments[] = [];
        for (let v = 0; v < 4; v++) {
          const vg = new THREE.Group();
          const spec = this.tileGeos[v];
          spec.offsets.forEach((off, k) => {
            const mesh = new THREE.Mesh(spec.geo, v === 3 ? this.glassMat : this.bodyMats[0]);
            mesh.position.z = off;
            mesh.rotation.y = spec.rotY[k];
            const edge = new THREE.LineSegments(spec.edges, v === 3 ? this.glassEdge : this.edgeMats[0]);
            edge.position.copy(mesh.position);
            edge.rotation.copy(mesh.rotation);
            vg.add(mesh, edge);
            bodyMeshes.push(mesh);
            edgeLines.push(edge);
          });
          vg.visible = false;
          group.add(vg);
          variants.push(vg);
        }
        // hole warning frame
        const frameGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-1.1, 0.05, -3.4), new THREE.Vector3(1.1, 0.05, -3.4),
          new THREE.Vector3(1.1, 0.05, 3.4), new THREE.Vector3(-1.1, 0.05, 3.4),
        ]);
        const holeFrame = new THREE.LineLoop(frameGeo, this.holeMat);
        holeFrame.visible = false;
        group.add(holeFrame);
        variants.forEach((v) => (v.position.x = LANES[l]));
        holeFrame.position.x = LANES[l];
        tiles.push({ lane: l, kind: "solid", phase: rand(0, 3), x: LANES[l], solidNow: true, variants, activeIdx: 0, holeFrame, bodyMeshes, edgeLines });
      }
      // under-glow
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(10.5, SEG_LEN * 1.05), this.glowMats[0]);
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = -0.9;
      group.add(glow);
      // side rails
      const railGeo = new THREE.BoxGeometry(0.1, 0.1, SEG_LEN * 0.94);
      const rails: THREE.Mesh[] = [];
      for (const sx of [-3.65, 3.65]) {
        const rail = new THREE.Mesh(railGeo, new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
        rail.position.set(sx, 0.02, 0);
        group.add(rail);
        rails.push(rail);
      }
      for (const dx of [-1.15, 1.15]) {
        const divider = new THREE.Mesh(divGeo, divMat);
        divider.position.set(dx, 0.15, 0);
        group.add(divider);
      }
      // floating crystals
      const crystals: THREE.Mesh[] = [];
      for (let c = 0; c < 2; c++) {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(rand(0.25, 0.6)), new THREE.MeshStandardMaterial({ color: 0x111133, emissive: pick(PALETTE), emissiveIntensity: 1.4, roughness: 0.2 }));
        m.position.set(rand(5, 10) * (Math.random() < 0.5 ? -1 : 1), rand(-3, 5), rand(-3, 3));
        group.add(m);
        crystals.push(m);
      }
      this.scene.add(group);
      this.segments.push({ group, z: 0, tiles, crystals, glow, rails });
    }
  }

  private buildPlayer() {
    // Stylized boy runner inspired by the key art: navy jacket, grey sleeves, spiky black hair,
    // cyan chest core, dark pants, glowing cyan sneakers, slim backpack.
    const skinMat    = new THREE.MeshStandardMaterial({ color: 0xf1c9a7, roughness: 0.7, metalness: 0.0 });
    const jacketMat  = new THREE.MeshStandardMaterial({ color: 0x16244a, roughness: 0.55, metalness: 0.25 });
    const sleeveMat  = new THREE.MeshStandardMaterial({ color: 0xcdcfd6, roughness: 0.65, metalness: 0.1 });
    const pantsMat   = new THREE.MeshStandardMaterial({ color: 0x0f1a33, roughness: 0.7, metalness: 0.2 });
    const hairMat    = new THREE.MeshStandardMaterial({ color: 0x0a0d18, roughness: 0.7, metalness: 0.1 });
    const coreMat    = new THREE.MeshStandardMaterial({ color: 0x02222e, emissive: 0x22d3ee, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.6 });
    const bootMat    = new THREE.MeshStandardMaterial({ color: 0x05203a, emissive: 0x38bdf8, emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 });
    const packMat    = new THREE.MeshStandardMaterial({ color: 0x283a6b, roughness: 0.5, metalness: 0.5 });
    const packStrap  = new THREE.MeshStandardMaterial({ color: 0x0c1430, roughness: 0.7, metalness: 0.2 });

    // Torso (jacket)
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.48, 4, 10), jacketMat);
    torso.position.y = 1.02;
    // Jacket collar
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 6, 16, Math.PI), jacketMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 1.38, -0.1);
    // Subtle chest emblem (jacket front — camera is behind, so keep small)
    const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 14), coreMat);
    coreRing.position.set(0, 1.1, -0.3);
    const coreDot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), coreMat);
    coreDot.rotation.x = Math.PI / 2;
    coreDot.position.set(0, 1.1, -0.31);
    // Jacket hem stripe
    const hem = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.38), new THREE.MeshStandardMaterial({ color: 0x1f3468, roughness: 0.6, metalness: 0.3 }));
    hem.position.set(0, 0.76, 0);
    // Backpack (large tech-pack with glowing circular core on its back — visible from behind like the reference)
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.22), packMat);
    pack.position.set(0, 1.08, 0.32);
    const packEdge = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.26), coreMat);
    packEdge.position.set(0, 1.34, 0.31);
    // Glowing core disc on the backpack face (back side, where the camera sees it)
    const packCoreRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.024, 8, 22), coreMat);
    packCoreRing.position.set(0, 1.12, 0.44);
    const packCoreDot = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0x072030, emissive: 0x67e8f9, emissiveIntensity: 1.8, roughness: 0.2, metalness: 0.5 }));
    packCoreDot.rotation.x = Math.PI / 2;
    packCoreDot.position.set(0, 1.12, 0.45);
    // Straps over shoulders
    for (const sx of [-0.2, 0.2]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.5, 0.08), packStrap);
      strap.position.set(sx, 1.1, 0.14);
      this.visual.add(strap);
    }

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 14), skinMat);
    head.position.y = 1.66;
    head.scale.set(0.95, 1.02, 0.95);
    // Spiky hair (multiple cones)
    const hairGroup = new THREE.Group();
    hairGroup.position.y = 1.72;
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hairMat);
    hairCap.position.y = -0.02;
    hairGroup.add(hairCap);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(rand(0.05, 0.09), rand(0.18, 0.32), 5), hairMat);
      sp.position.set(Math.cos(a) * 0.22, rand(-0.02, 0.22), Math.sin(a) * 0.22);
      sp.rotation.z = rand(-0.4, 0.4);
      sp.rotation.x = rand(-0.3, 0.3);
      hairGroup.add(sp);
    }
    // Tiny face (no astronaut visor – more human)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a0d14 });
    for (const ex of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 8), eyeMat);
      eye.position.set(ex, 1.66, -0.22);
      this.visual.add(eye);
    }
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshBasicMaterial({ color: 0xd0826a, transparent: true, opacity: 0.5 }));
    cheek.position.set(-0.1, 1.6, -0.23);
    const cheek2 = cheek.clone(); cheek2.position.x = 0.1;
    this.visual.add(cheek, cheek2);

    // Arms (grey sleeves with dark cuffs, closed skin-tone fists)
    const cuffMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.6, metalness: 0.2 });
    const mkArm = () => {
      const g = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.22, 4, 8), sleeveMat);
      upper.position.y = -0.22;
      const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.24, 3, 8), sleeveMat);
      lower.position.y = -0.55;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), cuffMat);
      cuff.position.y = -0.74;
      // Stylised fist (padded hand, slightly curled)
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), skinMat);
      fist.scale.set(1, 0.9, 1.2);
      fist.position.set(0, -0.86, 0.03);
      g.add(upper, lower, cuff, fist);
      return g;
    };
    const armL = mkArm(); armL.position.set(0.42, 1.34, 0.02);
    const armR = mkArm(); armR.position.set(-0.42, 1.34, 0.02);

    // Legs (dark pants; LEFT leg (player's left = +x side, camera right) has yellow stripe as in reference)
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf8c43a, emissive: 0xf59e0b, emissiveIntensity: 0.4, roughness: 0.5, metalness: 0.1 });
    const mkLeg = (withStripe: boolean) => {
      const g = new THREE.Group();
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.22, 4, 8), pantsMat);
      thigh.position.y = -0.22;
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.25, 3, 8), pantsMat);
      shin.position.y = -0.6;
      if (withStripe) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.03), stripeMat);
        stripe.position.set(0.09, -0.5, -0.03);
        g.add(stripe);
        // small thigh pocket
        const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), cuffMat);
        pocket.position.set(0.02, -0.1, -0.11);
        g.add(pocket);
      }
      g.add(thigh, shin);
      return g;
    };
    const legL = mkLeg(true);  legL.position.set(0.16, 0.8, 0);
    const legR = mkLeg(false); legR.position.set(-0.16, 0.8, 0);

    // Glowing cyan sneakers (shaped more like reference: toe forward, thick bright sole)
    const shoeUpperGeo = new THREE.BoxGeometry(0.28, 0.14, 0.48);
    const toeGeo = new THREE.BoxGeometry(0.26, 0.1, 0.16);
    const mkShoe = () => {
      const g = new THREE.Group();
      const upper = new THREE.Mesh(shoeUpperGeo, bootMat);
      upper.position.y = -0.82;
      const toe = new THREE.Mesh(toeGeo, bootMat);
      toe.position.set(0, -0.8, 0.27);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.58), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x8be9fd, emissiveIntensity: 0.95, roughness: 0.25 }));
      sole.position.y = -0.95;
      const heelTab = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.08), bootMat);
      heelTab.position.set(0, -0.75, -0.26);
      g.add(upper, toe, sole, heelTab);
      return g;
    };
    const shoeL = mkShoe(); legL.add(shoeL);
    const shoeR = mkShoe(); legR.add(shoeR);

    // Bootpack flame (kept for rocket power-up)
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 1.1, 10),
      new THREE.MeshBasicMaterial({ color: 0xffa63d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.set(0, 1.0, 1.0);
    flame.visible = false;

    this.visual.add(
      torso, collar, coreRing, coreDot, hem, pack, packEdge, packCoreRing, packCoreDot,
      head, hairGroup, armL, armR, legL, legR, flame
    );
    this.player.add(this.visual);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 20, 14),
      new THREE.MeshPhongMaterial({ color: 0x38bdf8, emissive: 0x38bdf8, emissiveIntensity: 0.5, transparent: true, opacity: 0.2, shininess: 100, depthWrite: false })
    );
    shield.position.y = 1.0;
    shield.visible = false;
    this.player.add(shield);

    // landing shadow / target ring
    const shadow = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 24), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    shadow.add(disc, ring);
    shadow.position.y = 0.16;

    this.parts = { armL, armR, legL, legR, flame, shield, shadow, visor: head, coreDot };
    this.scene.add(this.player, shadow);
  }

  private buildStars(): THREE.InstancedMesh {
    const cap = 220;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa22, emissiveIntensity: 1.5, metalness: 0.4, roughness: 0.25 });
    const mesh = new THREE.InstancedMesh(this.starGeo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) {
      this.stars.push({ active: false, x: 0, y: -999, z: 0, val: 1, scale: 1, pull: false });
      mesh.setColorAt(i, new THREE.Color(0xffd75e));
      this.dummy.position.set(0, -999, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(mesh);
    return mesh;
  }

  /* ---------------- obstacle factories ---------------- */
  private makeObstacle(kind: ObKind): Obstacle {
    const group = new THREE.Group();
    const data: Record<string, any> = {};
    let hx = 1.05, hy0 = 0, hy1 = 2.2, hd = 0.8;
    if (kind === "asteroid") {
      // Realistic clustered rock: a big central chunk with smaller bonded chunks
      const rockCluster = new THREE.Group();
      const main = new THREE.Mesh(this.asteroidGeo, this.rockMat);
      main.scale.setScalar(1.05);
      rockCluster.add(main);
      for (let i = 0; i < 3; i++) {
        const chunk = new THREE.Mesh(pick(this.chunkGeos), Math.random() < 0.5 ? this.rockMat : this.rockDarkMat);
        chunk.position.set(rand(-0.7, 0.7), rand(-0.3, 0.8), rand(-0.6, 0.6));
        chunk.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        rockCluster.add(chunk);
      }
      // small crater indent
      const crater = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), this.rockDarkMat);
      crater.position.set(0.3, 0.6, 0.5);
      crater.scale.set(1, 0.35, 1);
      rockCluster.add(crater);
      rockCluster.position.y = 1.22;
      const s = rand(0.85, 1.05);
      rockCluster.scale.setScalar(s);
      group.add(rockCluster);
      data.spin = rockCluster; data.main = main;
      hy1 = 2.4; hx = 1.0;
    } else if (kind === "spinner") {
      // Spiked alien drone / energy sentinel – grounded hazard (jump over)
      const hub = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), this.metalDarkMat);
      hub.position.y = 0.78;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 8, 22), this.panelGlowMat);
      ring.position.y = 0.78;
      // spikes
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 5), this.metalMat);
        spike.position.set(Math.cos(a) * 0.62, 0.78, Math.sin(a) * 0.62);
        spike.lookAt(new THREE.Vector3(Math.cos(a) * 2, 0.78, Math.sin(a) * 2));
        spike.rotateX(Math.PI / 2);
        group.add(spike);
      }
      group.add(hub, ring);
      data.spin = ring; data.core = hub;
      hy1 = 1.0; hx = 0.85; hd = 0.5;
    } else if (kind === "satellite") {
      // Overhead utility satellite with dish + solar panels — slide under
      const poleMat = this.metalDarkMat;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 2.6, 10), poleMat);
      pole.position.y = 1.3;
      const hub = new THREE.Group();
      hub.position.y = 1.62;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.56), this.metalMat);
      // Solar panels with cell detail
      const makePanel = (sx: number) => {
        const g = new THREE.Group();
        const pane = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.05, 0.52), this.panelMat);
        g.add(pane);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.07, 0.56), this.metalDarkMat);
        g.add(frame);
        for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
          const cell = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.2), this.panelGlowMat);
          cell.position.set(-0.42 + c * 0.28, 0.03, -0.2 + r * 0.28);
          g.add(cell);
        }
        g.position.x = sx;
        return g;
      };
      const p1 = makePanel(0.85);
      const p2 = makePanel(-0.85);
      // dish antenna
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), this.metalMat);
      dish.rotation.x = -Math.PI / 2.6;
      dish.position.set(0, 0.05, -0.36);
      const feed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), this.panelGlowMat);
      feed.position.set(0, 0.16, -0.4);
      // antenna
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.32), this.metalMat);
      ant.position.set(0, 0.34, 0.2);
      const blinker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4060 }));
      blinker.position.set(0, 0.49, 0.2);
      data.blinker = blinker;
      hub.add(body, p1, p2, dish, feed, ant, blinker);
      group.add(pole, hub);
      data.hub = hub;
      hy0 = 1.18; hy1 = 2.3; hx = 1.05; hd = 0.6;
    } else if (kind === "laser") {
      // Armoured posts + thick containment beam with pulsing core
      const postGeo = new THREE.CylinderGeometry(0.11, 0.15, 2.5, 10);
      const p1 = new THREE.Mesh(postGeo, this.laserPostMat);
      p1.position.y = 1.25;
      const p2 = new THREE.Mesh(postGeo, this.laserPostMat);
      // emitter rings
      const emitGeo = new THREE.TorusGeometry(0.16, 0.04, 6, 14);
      const emitMat = new THREE.MeshStandardMaterial({ color: 0x441218, emissive: 0xff2b3c, emissiveIntensity: 1.4, metalness: 0.8, roughness: 0.25 });
      const e1 = new THREE.Mesh(emitGeo, emitMat); e1.rotation.x = Math.PI / 2;
      const e2 = new THREE.Mesh(emitGeo, emitMat); e2.rotation.x = Math.PI / 2;
      p1.add(e1); p2.add(e2);
      const innerBeamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
      const midBeamMat = new THREE.MeshBasicMaterial({ color: 0xff2b3c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
      const outerBeamMat = new THREE.MeshBasicMaterial({ color: 0xff5566, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
      const beamInner = new THREE.Mesh(new THREE.BoxGeometry(1, 0.07, 0.05), innerBeamMat);
      const beamMid = new THREE.Mesh(new THREE.BoxGeometry(1, 0.18, 0.1), midBeamMat);
      const beamOuter = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 0.28), outerBeamMat);
      const y = 1.25;
      beamInner.position.y = y; beamMid.position.y = y; beamOuter.position.y = y;
      group.add(p1, p2, beamOuter, beamMid, beamInner);
      data.p1 = p1; data.p2 = p2; data.beam = beamMid; data.glowBeam = beamOuter;
      data.inner = beamInner; data.beamMat = midBeamMat; data.innerMat = innerBeamMat;
      hd = 0.35;
    } else if (kind === "container") {
      // Sci-fi cargo crate with bevels, hazard tape, and corner lights
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), this.crateMat);
      box.position.y = 0.9;
      // Beveled edges
      const edgeMat = this.metalDarkMat;
      const edgeGeo = new THREE.BoxGeometry(1.9, 0.14, 0.14);
      const corners: [number, number, number][] = [
        [-0.95, -0.9, -0.9], [0.95, -0.9, -0.9], [-0.95, -0.9, 0.9], [0.95, -0.9, 0.9],
        [-0.95, 0.9, -0.9], [0.95, 0.9, -0.9], [-0.95, 0.9, 0.9], [0.95, 0.9, 0.9],
      ];
      const edgeGroup = new THREE.Group();
      for (const [x, y, z] of corners) {
        for (const axis of [0, 1, 2] as const) {
          const e = new THREE.Mesh(axis === 0 ? edgeGeo : axis === 1 ? new THREE.BoxGeometry(0.14, 1.9, 0.14) : new THREE.BoxGeometry(0.14, 0.14, 1.9), edgeMat);
          e.position.set(x * (axis === 0 ? 0 : 1), y * (axis === 1 ? 0 : 1), z * (axis === 2 ? 0 : 1));
          edgeGroup.add(e);
        }
      }
      edgeGroup.position.y = 0.9;
      // Yellow hazard stripe
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.83, 0.22, 1.83), new THREE.MeshStandardMaterial({ color: 0x150c02, emissive: 0xffb020, emissiveIntensity: 0.75, roughness: 0.6 }));
      stripe.position.y = 0.9;
      // Warning symbol (X)
      const warnMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff9020, emissiveIntensity: 1.6 });
      const armGeo = new THREE.BoxGeometry(0.9, 0.08, 0.02);
      const a1 = new THREE.Mesh(armGeo, warnMat); a1.rotation.z = Math.PI / 4; a1.position.set(0, 0.9, 0.92);
      const a2 = new THREE.Mesh(armGeo, warnMat); a2.rotation.z = -Math.PI / 4; a2.position.set(0, 0.9, 0.92);
      // Corner indicator lights
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xff6a1a });
      for (let i = 0; i < 4; i++) {
        const lx = (i % 2 === 0 ? -1 : 1) * 0.78;
        const lz = (i < 2 ? -1 : 1) * 0.78;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), lightMat);
        bulb.position.set(lx, 1.85, lz);
        group.add(bulb);
        data["bulb" + i] = bulb;
      }
      group.add(box, edgeGroup, stripe, a1, a2);
      data.box = box;
      hy1 = 1.9; hx = 0.95; hd = 0.95;
    } else if (kind === "energy") {
      // Armoured gate posts + flickering blue plasma field
      const postMat = new THREE.MeshStandardMaterial({ color: 0x0b1122, metalness: 0.85, roughness: 0.35, emissive: 0x0a2342, emissiveIntensity: 0.35 });
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.9, 0.22), postMat);
      post.position.x = -1.1;
      const post2 = post.clone(); post2.position.x = 1.1;
      // Caps
      const capMat = this.panelGlowMat;
      const cap1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), capMat);
      cap1.position.set(-1.1, 2.72, 0);
      const cap2 = cap1.clone(); cap2.position.x = 1.1;
      const cap3 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), capMat);
      cap3.position.set(-1.1, 0.1, 0);
      const cap4 = cap3.clone(); cap4.position.x = 1.1;
      // Central field (two planes crossed for volume)
      const fieldMat = new THREE.MeshBasicMaterial({ color: 0x77ddff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const fieldA = new THREE.Mesh(new THREE.PlaneGeometry(1.98, 2.55), fieldMat);
      fieldA.position.y = 1.4;
      const fieldB = new THREE.Mesh(new THREE.PlaneGeometry(1.98, 2.55), fieldMat);
      fieldB.position.y = 1.4; fieldB.rotation.y = Math.PI / 2;
      group.add(post, post2, cap1, cap2, cap3, cap4, fieldA, fieldB);
      const bolts: THREE.Line[] = [];
      for (let b = 0; b < 3; b++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
        group.add(line);
        bolts.push(line);
      }
      data.bolts = bolts; data.fieldMat = fieldMat; data.zapT = 0;
      hy1 = 2.78; hx = 1.05; hd = 0.3;
    } else if (kind === "meteor") {
      // Fiery meteor with a trailing flame cone
      const rock = new THREE.Mesh(this.asteroidGeo, this.meteorHotMat);
      rock.scale.setScalar(0.82);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.98, 24), new THREE.MeshBasicMaterial({ color: 0xff7a22, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.18;
      // flame trail
      const trailMat = new THREE.MeshBasicMaterial({ color: 0xff9933, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
      const trail = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.0, 10), trailMat);
      trail.rotation.x = Math.PI;
      trail.position.y = 1.25;
      const trail2 = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.1, 10), new THREE.MeshBasicMaterial({ color: 0xffe39a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      trail2.rotation.x = Math.PI;
      trail2.position.y = 1.2;
      const trailGroup = new THREE.Group();
      trailGroup.add(trail, trail2);
      group.add(rock, ring, trailGroup);
      data.rock = rock; data.ring = ring; data.trail = trailGroup; data.landed = false;
      hy1 = 2.0; hx = 0.95; hd = 0.85;
    }
    this.scene.add(group);
    return { kind, group, active: false, z: 0, lane: 1, x: 0, hx, hy0, hy1, hd, t: 0, data };
  }

  /* ---------------- the chasing alien ---------------- */
  private buildAlien() {
    const g = new THREE.Group();
    // Body – dark sinewy creature, hunched
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a0b28, roughness: 0.85, emissive: 0x2b0a3a, emissiveIntensity: 0.4 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x2a1246, roughness: 0.75, emissive: 0x42125e, emissiveIntensity: 0.35 });

    // Armoured shell on top
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12), bodyMat);
    shell.scale.set(1.1, 0.85, 1.3);
    shell.position.y = 1.9;
    g.add(shell);

    // Under-belly (lighter purple skin)
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.78, 14, 10), skinMat);
    belly.scale.set(1.0, 0.9, 1.2);
    belly.position.y = 1.35;
    g.add(belly);

    // Head / snout – elongated forward with sharp teeth
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.2, 10), bodyMat);
    head.rotation.x = Math.PI / 2.2;
    head.position.set(0, 1.95, -0.8);
    g.add(head);

    // Glowing red eyes (two pairs for a menacing look)
    const eyes: THREE.Mesh[] = [];
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1122 });
    const eyeGlow = new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 2; i++) {
      const ex = i === 0 ? -0.22 : 0.22;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
      eye.position.set(ex, 2.05, -0.35);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), eyeGlow);
      glow.position.copy(eye.position);
      g.add(eye, glow);
      eyes.push(eye);
    }
    // Mouth / teeth row
    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 4), new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.3, metalness: 0.2 }));
      tooth.position.set(-0.3 + i * 0.12, 1.68, -1.3);
      tooth.rotation.x = Math.PI / 3;
      g.add(tooth);
    }

    // Wriggling tentacles / tail spines behind
    const tendrils: THREE.Mesh[] = [];
    const tendrilMat = bodyMat;
    for (let i = 0; i < 6; i++) {
      const chain = new THREE.Group();
      const segs = 5;
      let prev: THREE.Object3D | null = null;
      for (let s = 0; s < segs; s++) {
        const r = 0.12 - s * 0.015;
        const seg = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.05, r), 8, 6), tendrilMat);
        seg.position.z = -0.3;
        if (prev) prev.add(seg);
        else chain.add(seg);
        prev = seg;
      }
      const ang = (i / 6) * Math.PI * 2;
      chain.position.set(Math.cos(ang) * 0.55, 1.1 + Math.sin(ang) * 0.1, 0.7 + (i % 2) * 0.2);
      chain.rotation.y = ang;
      chain.rotation.x = 0.2 + (i % 3) * 0.1;
      g.add(chain);
      tendrils.push(chain as unknown as THREE.Mesh);
    }
    // Two long back horns
    for (const sx of [-0.3, 0.3]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 6), this.metalDarkMat);
      horn.position.set(sx, 2.55, 0.2);
      horn.rotation.x = -0.3;
      horn.rotation.z = sx * 0.2;
      g.add(horn);
    }
    // Shoulder spikes
    for (const sx of [-0.9, 0.9]) {
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 5), this.metalDarkMat);
        sp.position.set(sx * 0.9, 2.0 - k * 0.18, 0.1 - k * 0.12);
        sp.rotation.z = sx > 0 ? -0.4 : 0.4;
        g.add(sp);
      }
    }

    // Glowing red core at chest
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    core.position.set(0, 1.6, -0.55);
    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    coreGlow.position.copy(core.position);
    g.add(core, coreGlow);

    // Red menacing spotlight shining down on the player
    const spot = new THREE.SpotLight(0xff3344, 6, 22, Math.PI / 5, 0.6, 1.2);
    spot.position.set(0, 2.2, 1.4);
    spot.target.position.set(0, 0.8, 3.2);
    const spotTarget = spot.target;
    g.add(spot, spotTarget);

    // Scale bigger than player
    g.scale.setScalar(1.1);
    g.position.set(0, 0.4, 11);
    this.scene.add(g);
    this.alienGroup = g;
    g.visible = false;
    this.alienData = { eyes, tendrils, body: g, breathT: 0, gap: 11, roarT: 0, threat: 0, trailParticles: [] };
  }

  private spawnObstacle(kind: ObKind, lane: number, z: number, opts: { high?: boolean; span?: number } = {}): Obstacle {
    const pool = this.obPool.get(kind) || [];
    const ob = pool.pop() || this.makeObstacle(kind);
    ob.active = true;
    ob.z = z;
    ob.lane = lane;
    ob.t = rand(0, 5);
    ob.x = LANES[lane];
    ob.group.visible = true;
    if (kind === "laser") {
      const span = opts.span ?? 1;
      const high = opts.high ?? false;
      const width = span * 2.3 - 0.15;
      const cx = span === 3 ? 0 : LANES[lane] + ((span - 1) * 2.3) / 2;
      ob.x = cx;
      ob.hx = width / 2;
      ob.hy0 = high ? 1.16 : 0.34;
      ob.hy1 = high ? 1.78 : 0.96;
      ob.data.high = high;
      ob.data.p1.position.x = cx - width / 2;
      ob.data.p2.position.x = cx + width / 2;
      ob.data.beam.scale.x = width;
      ob.data.glowBeam.scale.x = width;
      ob.data.beam.position.set(0, (ob.hy0 + ob.hy1) / 2, 0);
      ob.data.glowBeam.position.set(0, (ob.hy0 + ob.hy1) / 2, 0);
      ob.group.position.x = 0;
    } else if (kind === "container") {
      // sweep two adjacent lanes max so one lane is always open
      ob.data.baseLane = lane === 1 ? pick([0, 2]) : lane;
      ob.data.amp = 1.15;
      ob.data.rate = rand(1.0, 1.6);
      ob.x = LANES[ob.data.baseLane];
    } else if (kind === "meteor") {
      ob.data.landed = false;
      ob.data.rock.material = this.meteorHotMat;
      ob.data.rock.position.y = Math.max(2, (-z - 46) * 0.6);
      ob.data.ring.visible = true;
    }
    if (kind !== "laser") ob.group.position.x = ob.x;
    this.obstacles.push(ob);
    return ob;
  }

  private freeObstacle(ob: Obstacle) {
    ob.active = false;
    ob.group.visible = false;
    const pool = this.obPool.get(ob.kind) || [];
    pool.push(ob);
    this.obPool.set(ob.kind, pool);
  }

  /* ---------------- pickup factories ---------------- */
  private makePickup(id: PowerId): Pickup {
    const group = new THREE.Group();
    const colors: Record<PowerId, number> = { rocket: 0xff6b35, shield: 0x38bdf8, boots: 0xa78bfa, magnet: 0xf43f5e, kit: 0x34d399, hyper: 0xfde047 };
    const emojis: Record<PowerId, string> = { rocket: "🚀", shield: "🛡️", boots: "👢", magnet: "🧲", kit: "💚", hyper: "⚡" };
    const c = colors[id];
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 26), new THREE.MeshStandardMaterial({ color: 0x0b1020, emissive: c, emissiveIntensity: 1.8 }));
    group.add(ring);
    const mat = new THREE.MeshStandardMaterial({ color: 0xdde3ee, emissive: c, emissiveIntensity: 0.7, metalness: 0.5, roughness: 0.3 });
    let icon: THREE.Object3D;
    if (id === "rocket") {
      icon = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 10), mat);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 10), new THREE.MeshStandardMaterial({ color: 0xff6b35, emissive: 0xff6b35, emissiveIntensity: 1 }));
      nose.position.y = 0.37;
      icon.add(body, nose);
    } else if (id === "shield") {
      icon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshPhongMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, transparent: true, opacity: 0.75 }));
    } else if (id === "boots") {
      icon = new THREE.Group();
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.34), mat); b1.position.x = -0.14;
      const b2 = b1.clone(); b2.position.x = 0.14;
      icon.add(b1, b2);
    } else if (id === "magnet") {
      icon = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.09, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0xf43f5e, emissive: 0xf43f5e, emissiveIntensity: 0.9 }));
      icon.rotation.z = Math.PI;
    } else if (id === "kit") {
      icon = new THREE.Group();
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.16), mat);
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mat);
      icon.add(h, v);
    } else {
      icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), mat);
      icon.scale.y = 1.5;
    }
    group.add(icon);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emojis[id]), transparent: true, depthWrite: false }));
    label.scale.setScalar(0.72);
    label.position.y = 1.0;
    group.add(label);
    this.scene.add(group);
    return { id, group, active: false, z: 0, x: 0, t: 0 };
  }

  private spawnPickup(lane: number, z: number) {
    const ids: PowerId[] = ["magnet", "magnet", "shield", "shield", "boots", "boots", "hyper", "rocket", "kit"];
    const id = pick(ids);
    const pool = this.pickPool.get(id) || [];
    const p = pool.pop() || this.makePickup(id);
    p.active = true;
    p.z = z;
    p.x = LANES[lane];
    p.t = rand(0, 4);
    p.group.visible = true;
    this.pickups.push(p);
  }

  private spawnStar(x: number, y: number, z: number, val: number) {
    const s = this.stars.find((it) => !it.active);
    if (!s) return;
    s.active = true;
    s.x = x; s.y = y; s.z = z; s.val = val;
    s.scale = val === 1 ? 1 : val === 3 ? 1.4 : 1.85;
    s.pull = false;
    const idx = this.stars.indexOf(s);
    this.starMesh.setColorAt(idx, new THREE.Color(val === 5 ? 0xffe3f2 : val === 3 ? 0xffe9a0 : 0xffd75e));
    if (this.starMesh.instanceColor) this.starMesh.instanceColor.needsUpdate = true;
  }

  /* ---------------- segment generation ---------------- */
  private configureSegment(seg: Segment) {
    const ci = randi(0, PALETTE.length - 1);
    const d = this.dist;
    const attract = this.mode === "menu";
    this.segSerial++;
    if (this.hazardCooldown > 0) this.hazardCooldown--;

    // pick tile shapes / kinds
    const shapeRoll = Math.random();
    const shapeIdx = shapeRoll < 0.3 ? 0 : shapeRoll < 0.62 ? 1 : shapeRoll < 0.8 ? 2 : 3;
    for (const t of seg.tiles) {
      t.kind = shapeIdx === 3 ? "glass" : "solid";
      t.phase = rand(0, 3.2);
      t.x = LANES[t.lane];
      t.solidNow = true;
      t.variants.forEach((v, i) => (v.visible = i === shapeIdx));
      t.activeIdx = shapeIdx;
      t.holeFrame.visible = false;
      for (const m of t.bodyMeshes) if (shapeIdx !== 3) m.material = this.bodyMats[ci];
      for (const e of t.edgeLines) if (shapeIdx !== 3) e.material = this.edgeMats[ci];
    }
    seg.glow.material = this.glowMats[ci];
    for (const r of seg.rails) {
      r.visible = Math.random() < 0.65;
      (r.material as THREE.MeshBasicMaterial).color.setHex(PALETTE[ci]);
    }
    for (const cr of seg.crystals) {
      cr.position.set(rand(5, 10) * (Math.random() < 0.5 ? -1 : 1), rand(-3, 5), rand(-3, 3));
      (cr.material as THREE.MeshStandardMaterial).emissive.setHex(pick(PALETTE));
    }

    // During tutorial, early segments are hazard-free; later segments scripted
    const isTut = this.mode === "tutorial";
    const canHazard = !isTut && this.segSerial > 9 && this.hazardCooldown === 0;
    let freeLanes = [0, 1, 2];
    let lowHazard = false;

    const dm = this.difficultyMult[this.difficulty];
    const hazardChance = attract
      ? 0.34
      : clamp((0.42 + d / 3800) * dm.hazardFreq, 0.22, 0.9);

    if (canHazard && Math.random() < hazardChance) {
      const roll = Math.random();
      const z = seg.z + rand(-1.5, 1.5);
      if (roll < 0.2 && !attract) {
        // ---- gap / broken platform ----
        const full = d > 260 && Math.random() < 0.3;
        const n = full ? 3 : randi(1, d > 500 ? 2 : 1);
        const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, n);
        for (const l of lanes) {
          const t = seg.tiles[l];
          t.kind = "hole";
          t.solidNow = false;
          t.variants.forEach((v) => (v.visible = false));
          t.holeFrame.visible = true;
        }
        freeLanes = full ? [0, 1, 2] : [0, 1, 2].filter((l) => !lanes.includes(l));
        lowHazard = true;
        // star arc over the gap
        const arcLane = pick(full ? [0, 1, 2] : lanes);
        for (let i = 0; i < 7; i++) {
          const fz = seg.z - 3.6 + (i / 6) * 7.2;
          this.spawnStar(LANES[arcLane], 0.9 + Math.sin((i / 6) * Math.PI) * 1.5, fz, 1);
        }
        if (full) this.hazardCooldown = 1;
      } else if (roll < 0.3 && d > 380) {
        // ---- moving platform row ----
        const l = randi(0, 2);
        seg.tiles[l].kind = "moving";
        seg.tiles[l].phase = rand(0, 6);
      } else if (roll < 0.38 && d > 620) {
        // ---- disappearing platform ----
        const l = randi(0, 2);
        seg.tiles[l].kind = "blink";
        seg.tiles[l].phase = rand(0, 3.2);
      } else if (roll < 0.52) {
        // ---- dodge obstacles (1-2 lanes blocked) ----
        const n = d > 420 && Math.random() < 0.55 ? 2 : 1;
        const kinds: ObKind[] = ["asteroid", "spinner"];
        if (d > 320) kinds.push("energy");
        if (d > 480 && n === 1) kinds.push("container");
        const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, n);
        for (const l of lanes) {
          const k = pick(kinds);
          this.spawnObstacle(k, l, z + rand(-0.5, 0.5));
          if (k === "spinner") lowHazard = true;
        }
        if (lanes.includes(1) && n === 2) { /* keep at least one open lane by construction */ }
        freeLanes = [0, 1, 2].filter((l) => !lanes.includes(l));
      } else if (roll < 0.65 && d > 130) {
        // ---- laser gate (jump or slide) ----
        const high = Math.random() < 0.5;
        const span = d > 700 && Math.random() < 0.5 ? 3 : randi(1, 2);
        const lane = span === 3 ? 1 : span === 2 ? (Math.random() < 0.5 ? 0 : 1) : randi(0, 2);
        this.spawnObstacle("laser", lane, z, { high, span });
        lowHazard = !high;
        if (span < 3) {
          const covered = [lane, lane + span - 1];
          freeLanes = [0, 1, 2].filter((l) => l < covered[0] || l > covered[1]);
        }
      } else if (roll < 0.78 && d > 200) {
        // ---- satellite barrier (slide) ----
        const n = d > 800 && Math.random() < 0.4 ? 3 : randi(1, 2);
        const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, n);
        for (const l of lanes) this.spawnObstacle("satellite", l, z);
        if (n === 3) freeLanes = [0, 1, 2];
        else freeLanes = [0, 1, 2].filter((l) => !lanes.includes(l));
      } else if (roll < 0.9 && d > 300) {
        // ---- falling meteor ----
        const l = randi(0, 2);
        this.spawnObstacle("meteor", l, z);
        freeLanes = [0, 1, 2].filter((x) => x !== l);
      } else {
        // ---- spinner jump row ----
        const n = d > 900 && Math.random() < 0.4 ? 3 : randi(1, 2);
        const lanes = [0, 1, 2].sort(() => Math.random() - 0.5).slice(0, n);
        for (const l of lanes) this.spawnObstacle("spinner", l, z);
        lowHazard = true;
        freeLanes = n === 3 ? [0, 1, 2] : [0, 1, 2].filter((l) => !lanes.includes(l));
      }
      // rotating plate flavor (always solid ground)
      if (Math.random() < 0.25) {
        const l = randi(0, 2);
        if (seg.tiles[l].kind === "solid") seg.tiles[l].kind = "spin";
      }
      const cdFloor = Math.max(1 + dm.cdFloor, this.speed > 26 ? 2 : this.speed > 19 ? 1 : 0) + dm.gapBonus;
      this.hazardCooldown = Math.max(this.hazardCooldown, cdFloor);
    }

    // During tutorial: always spawn stars in the middle lane so collect step shows them
    if (isTut && this.segSerial % 3 === 0 && this.tutorialStep === "collect") {
      for (let i = 0; i < 5; i++) this.spawnStar(LANES[1], 0.85, seg.z - 2 + i * 1.2, 1);
    }

    // ---- star lines on a free lane ----
    if (Math.random() < (isTut ? 0.2 : 0.62) && freeLanes.length > 0) {
      const l = pick(freeLanes);
      const n = randi(4, 6);
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        const val = r < 0.08 ? 5 : r < 0.24 ? 3 : 1;
        const y = lowHazard ? 0.9 + Math.sin((i / (n - 1)) * Math.PI) * 1.3 : 0.85;
        this.spawnStar(LANES[l], y, seg.z - SEG_LEN / 2 + 0.8 + i * 1.15, val);
      }
    }
    // ---- power-up (slightly more common, still balanced) ----
    if (this.segSerial > 10 && Math.random() < (attract ? 0.02 : 0.042) && freeLanes.length > 0) {
      this.spawnPickup(pick(freeLanes), seg.z + rand(-1, 1));
    }
  }

  /* ---------------- lifecycle ---------------- */
  private resetWorld() {
    for (const ob of this.obstacles) this.freeObstacle(ob);
    this.obstacles = [];
    for (const p of this.pickups) {
      p.active = false; p.group.visible = false;
      const pool = this.pickPool.get(p.id) || [];
      pool.push(p);
      this.pickPool.set(p.id, pool);
    }
    this.pickups = [];
    for (const s of this.stars) { s.active = false; s.y = -999; }
    this.segSerial = 0;
    this.hazardCooldown = 0;
    this.segments.forEach((seg, i) => {
      seg.z = KILL_Z - (i + 1) * SEG_LEN;
      seg.group.position.z = seg.z;
      this.configureSegment(seg);
    });
    this.lane = 1; this.px = 0; this.py = 0; this.vy = 0;
    this.grounded = true; this.falling = false; this.sliding = 0;
    this.jumpsUsed = 0; this.coyote = 0; this.jumpBuffer = 0;
    this.visual.rotation.set(0, 0, 0);
    this.visual.position.y = 0;
    this.player.visible = true;
    (this.parts.shield as THREE.Mesh).visible = false;
    (this.parts.flame as THREE.Mesh).visible = false;
    // reset chaser
    if (this.alienData) {
      this.alienGroup.visible = this.mode === "playing";
      this.alienGroup.position.set(0, 0.4, 11);
      this.alienData.threat = 0;
      this.alienData.gap = 11;
    }
  }

  setDifficulty(d: Difficulty) { this.difficulty = d; }

  start() {
    this.sound.ensure();
    this.tutorialActive = false;
    this.tutorialStep = null;
    this.mode = "playing";
    this.runReset();
    this.alienGroup.visible = true;
    if (this.alienData) { this.alienData.gap = 12; this.alienData.threat = 0; }
    this.sound.setDucked(false);
    this.emitHud();
  }

  startTutorial(diff: Difficulty = "amateur") {
    this.sound.ensure();
    this.difficulty = diff;
    this.tutorialActive = true;
    this.tutorialStep = "left";
    this.tutorialStepTime = 0;
    this.tutorialWaitInput = true;
    this.tutorialCompletedThisStep = false;
    this.runReset();
    this.mode = "tutorial";
    this.alienGroup.visible = false;
    this.invuln = 9999;
    this.emitTutorialStep();
  }

  skipTutorial() {
    this.tutorialActive = false;
    this.tutorialStep = null;
    this.cb.onTutorial?.(null);
  }

  finishTutorial() {
    this.tutorialActive = false;
    this.tutorialStep = null;
    this.cb.onTutorial?.(null);
    this.start();
  }

  private runReset() {
    this.dist = 0; this.score = 0; this.starCount = 0; this.starPoints = 0;
    this.streak = 0; this.speed = this.difficultyMult[this.difficulty].base;
    this.powers = { rocket: 0, shield: 0, boots: 0, magnet: 0, kit: 0, hyper: 0 };
    this.invuln = 1.2;
    this.trauma = 0;
    this.resetWorld();
    if (this.mode !== "tutorial") {
      this.alienGroup.visible = true;
      if (this.alienData) { this.alienData.gap = 12; this.alienData.threat = 0; }
    }
  }

  setPaused(p: boolean) {
    if (p && (this.mode === "playing" || this.mode === "tutorial")) {
      this.mode = "paused";
      this.sound.setDucked(true);
    } else if (!p && this.mode === "paused") {
      this.mode = this.tutorialActive ? "tutorial" : "playing";
      this.invuln = Math.max(this.invuln, 0.8);
      this.sound.setDucked(false);
      this.clock.getDelta();
    }
  }

  toMenu() {
    this.mode = "menu";
    this.sound.setDucked(false);
    this.dist = 0;
    this.speed = 9;
    this.powers = { rocket: 0, shield: 0, boots: 0, magnet: 0, kit: 0, hyper: 0 };
    this.resetWorld();
    this.alienGroup.visible = false;
  }

  setQuality(hi: boolean) {
    this.hiFx = hi;
    this.renderer.setPixelRatio(hi ? Math.min(window.devicePixelRatio, 1.6) : 1);
    this.onResize();
  }

  private die(reason: string) {
    if (this.mode !== "playing") return;
    this.mode = "dying";
    this.deathTimer = reason === "VOID" ? 0.7 : 1.15;
    this.deathReason = reason;
    this.trauma = 1;
    if (reason === "VOID") {
      this.sound.fall();
    } else {
      this.sound.crash();
      this.particles.burst({ x: this.px, y: this.py + 1, z: 0 }, 60, 0xff8844, { speed: 9, life: 1.1, gravity: 6 });
      this.particles.burst({ x: this.px, y: this.py + 1, z: 0 }, 40, 0x67e8f9, { speed: 7, life: 0.9 });
      this.player.visible = false;
    }
  }

  private finishRun() {
    this.mode = "over";
    let best = 0, bestDist = 0;
    try {
      best = Number(localStorage.getItem("cr_best") || 0);
      bestDist = Number(localStorage.getItem("cr_bestdist") || 0);
    } catch { /* ignore */ }
    const finalScore = Math.floor(this.score);
    const finalDist = Math.floor(this.dist);
    const isRecord = finalScore > best;
    if (isRecord) best = finalScore;
    if (finalDist > bestDist) bestDist = finalDist;
    try {
      localStorage.setItem("cr_best", String(best));
      localStorage.setItem("cr_bestdist", String(bestDist));
      localStorage.setItem("cr_last", JSON.stringify({ score: finalScore, distance: finalDist, stars: this.starCount }));
    } catch { /* ignore */ }
    if (isRecord) this.sound.record(); else this.sound.gameOver();
    const reasons: Record<string, string> = {
      ASTEROID: "Shattered against a drifting asteroid",
      SATELLITE: "Clipped by a rotating satellite",
      METEOR: "Flattened by a falling meteor",
      LASER: "Sliced by a laser grid",
      CONTAINER: "Slammed into a cargo container",
      ENERGY: "Zapped by an energy barrier",
      SPINNER: "Caught by a spinning construct",
      VOID: "Lost to the endless void",
    };
    this.cb.onGameOver({
      score: finalScore, distance: finalDist, stars: this.starCount,
      best, bestDist, isRecord, reason: reasons[this.deathReason] || "Signal lost in deep space",
    });
  }

  /* ---------------- input ---------------- */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Escape" || e.code === "KeyP") {
      if (this.mode === "playing" || this.mode === "paused") {
        e.preventDefault();
        this.cb.onPauseKey();
      }
      return;
    }
    if (this.mode !== "playing" && this.mode !== "tutorial") return;
    switch (e.code) {
      case "ArrowLeft": case "KeyA": e.preventDefault(); this.moveLane(-1); break;
      case "ArrowRight": case "KeyD": e.preventDefault(); this.moveLane(1); break;
      case "ArrowUp": case "KeyW": case "Space": e.preventDefault(); this.queueJump(); break;
      case "ArrowDown": case "KeyS": e.preventDefault(); this.slideOrDive(); break;
    }
  };

  private touchStart: { x: number; y: number; t: number; used: boolean } | null = null;
  private onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    this.touchStart = { x: t.clientX, y: t.clientY, t: performance.now(), used: false };
  };
  private onTouchMove = (e: TouchEvent) => {
    if (!this.touchStart || this.touchStart.used || (this.mode !== "playing" && this.mode !== "tutorial")) return;
    const t = e.touches[0];
    const dx = t.clientX - this.touchStart.x;
    const dy = t.clientY - this.touchStart.y;
    if (Math.abs(dx) < 32 && Math.abs(dy) < 32) return;
    this.touchStart.used = true;
    if (Math.abs(dx) > Math.abs(dy)) this.moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) this.queueJump();
    else this.slideOrDive();
  };
  private onTouchEnd = () => {
    if (!this.touchStart) return;
    const dt = performance.now() - this.touchStart.t;
    if (!this.touchStart.used && dt < 260 && (this.mode === "playing" || this.mode === "tutorial")) this.queueJump();
    this.touchStart = null;
  };

  private bindInput() {
    window.addEventListener("keydown", this.onKeyDown);
    this.container.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.container.addEventListener("touchmove", this.onTouchMove, { passive: true });
    this.container.addEventListener("touchend", this.onTouchEnd, { passive: true });
  }

  private moveLane(dir: number) {
    const next = clamp(this.lane + dir, 0, 2);
    if (next !== this.lane) {
      this.lane = next;
      this.sound.lane();
    }
  }
  private queueJump() { this.jumpBuffer = 0.14; }
  private slideOrDive() {
    if (this.powers.rocket > 0) return;
    if (!this.grounded) {
      this.vy = -26; // dive
    } else {
      this.sliding = 0.78;
      if (this.mode === "playing") this.sound.slide();
      this.particles.burst({ x: this.px, y: 0.2, z: 0.4 }, 6, 0x67e8f9, { speed: 2.5, life: 0.4 });
    }
  }

  private doJump() {
    const maxJumps = this.powers.boots > 0 ? 2 : 1;
    if (this.grounded || this.coyote > 0) {
      this.vy = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.falling = false;
      this.jumpsUsed = 1;
      this.sliding = 0;
      if (this.mode === "playing") this.sound.jump();
      this.particles.burst({ x: this.px, y: 0.15, z: 0.3 }, 8, 0x22d3ee, { speed: 3, life: 0.45 });
    } else if (this.jumpsUsed < maxJumps && !this.falling) {
      this.vy = JUMP_V * 0.94;
      this.jumpsUsed++;
      if (this.mode === "playing") this.sound.doubleJump();
      this.particles.burst({ x: this.px, y: this.py + 0.2, z: 0.2 }, 14, 0xa78bfa, { speed: 4, life: 0.5 });
    }
  }

  /* ---------------- ground query ---------------- */
  private groundUnder(x: number): boolean {
    if (this.mode === "menu") return true;
    for (const seg of this.segments) {
      if (Math.abs(seg.z) > SEG_LEN / 2 + 0.05) continue;
      for (const t of seg.tiles) {
        if (!t.solidNow || t.kind === "hole") continue;
        if (Math.abs(x - t.x) < 1.18) return true;
      }
      return false;
    }
    return true;
  }

  /* ---------------- main loop ---------------- */
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.mode !== "paused") {
      this.time += dt;
      if (this.mode === "playing") this.sim(dt, false);
      else if (this.mode === "menu") this.sim(dt, true);
      else if (this.mode === "dying") {
        this.deathTimer -= dt;
        this.speed = Math.max(0, this.speed - dt * 26);
        this.scrollWorld(dt);
        this.updateObstacles(dt, true);
        if (this.deathReason === "VOID") this.py -= 12 * dt;
        this.updatePlayerVisual(dt);
        if (this.deathTimer <= 0) this.finishRun();
      } else if (this.mode === "over") {
        this.updateBackground(dt * 0.4);
      }
      this.particles.update(dt);
      this.updateCamera(dt);
    }
    if (this.hiFx) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  };

  private sim(dt: number, attract: boolean) {
    const isTutorial = this.mode === "tutorial";
    const dm = this.difficultyMult[this.difficulty];
    // speed & difficulty
    if (!attract) {
      let base = dm.base + 17.5 * (1 - Math.exp(-this.dist / 2400));
      // Slow-mo during tutorial steps to give beginners reaction time
      if (isTutorial) base = Math.min(base, 8.5);
      let mult = 1;
      if (this.powers.hyper > 0) mult *= 1.5;
      if (this.powers.rocket > 0) mult *= 1.3;
      this.speed = base * mult;
      this.dist += this.speed * dt;
      const perMeterScore = 2.8 * dm.scoreMult * (this.powers.hyper > 0 ? 2 : 1);
      this.score += this.speed * dt * perMeterScore;
    } else {
      this.speed = 9;
    }

    this.scrollWorld(dt);
    this.updateTiles(dt);
    this.updateObstacles(dt, attract);
    this.updateStars(dt, attract);
    this.updatePickups(dt, attract);
    this.updateBackground(dt);
    this.updatePowers(dt);
    if (!attract && !isTutorial) this.updateAlien(dt);

    if (attract) this.autopilot(dt);
    this.updatePlayerPhysics(dt, attract);
    if (isTutorial) this.updateTutorial(dt);
    this.updatePlayerVisual(dt);
    if (!attract && !isTutorial) this.checkCollisions();

    this.streakT -= dt;
    if (this.streakT <= 0) this.streak = 0;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (!isTutorial) this.invuln = Math.max(0, this.invuln - dt);

    this.hudTimer -= dt;
    if (!attract && this.hudTimer <= 0) {
      this.hudTimer = 0.12;
      this.emitHud();
    }
  }

  private scrollWorld(dt: number) {
    const dz = this.speed * dt;
    for (const seg of this.segments) {
      seg.z += dz;
      if (seg.z - SEG_LEN / 2 > KILL_Z) {
        seg.z -= SEG_COUNT * SEG_LEN;
        this.configureSegment(seg);
      }
      seg.group.position.z = seg.z;
    }
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const ob = this.obstacles[i];
      ob.z += dz;
      if (ob.z > KILL_Z) {
        this.freeObstacle(ob);
        this.obstacles.splice(i, 1);
      }
    }
    for (const s of this.stars) {
      if (!s.active) continue;
      if (!s.pull) s.z += dz;
      if (s.z > KILL_Z) { s.active = false; s.y = -999; }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.z += dz;
      if (p.z > KILL_Z) {
        p.active = false; p.group.visible = false;
        const pool = this.pickPool.get(p.id) || [];
        pool.push(p);
        this.pickPool.set(p.id, pool);
        this.pickups.splice(i, 1);
      }
    }
    // dust
    for (let i = 0; i < this.dustPos.length / 3; i++) {
      this.dustPos[i * 3 + 2] += dz * 1.05;
      if (this.dustPos[i * 3 + 2] > 14) {
        this.dustPos[i * 3 + 2] = -170;
        this.dustPos[i * 3] = rand(-28, 28);
        this.dustPos[i * 3 + 1] = rand(-10, 26);
      }
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateTiles(dt: number) {
    const t = this.time;
    this.holeMat.opacity = 0.55 + Math.sin(t * 5) * 0.3;
    for (const seg of this.segments) {
      if (seg.z < -SEG_LEN * (SEG_COUNT - 2)) continue;
      for (const tile of seg.tiles) {
        const vg = tile.variants[tile.activeIdx];
        if (tile.kind === "moving") {
          tile.x = LANES[tile.lane] + Math.sin(t * 1.7 + tile.phase) * 1.18;
          vg.position.x = tile.x;
        } else if (tile.kind === "blink") {
          const cyc = (t + tile.phase) % 3.4;
          let vis = cyc < 2.7;
          if (cyc > 2.2 && cyc < 2.7) vis = Math.sin(t * 34) > -0.3;
          vg.visible = vis;
          tile.solidNow = cyc < 2.55;
          tile.holeFrame.visible = !tile.solidNow;
        } else if (tile.kind === "spin") {
          vg.rotation.y += dt * 0.9;
          tile.x = LANES[tile.lane];
        } else if (tile.kind !== "hole") {
          vg.position.x = LANES[tile.lane];
          vg.rotation.y = 0;
          tile.x = LANES[tile.lane];
        }
      }
      for (const cr of seg.crystals) {
        cr.rotation.y += dt * 1.2;
        cr.rotation.x += dt * 0.5;
      }
    }
  }

  private updateObstacles(dt: number, attract: boolean) {
    for (const ob of this.obstacles) {
      ob.t += dt;
      const g = ob.group;
      g.position.z = ob.z;
      if (ob.kind === "asteroid") {
        ob.data.spin.rotation.y += dt * 0.8;
        ob.data.spin.rotation.x += dt * 0.3;
        ob.data.spin.position.y = 1.15 + Math.sin(ob.t * 1.4) * 0.15;
      } else if (ob.kind === "spinner") {
        ob.data.spin.rotation.z += dt * 4.2;
        ob.data.core.rotation.y += dt * 3;
      } else if (ob.kind === "satellite") {
        ob.data.hub.rotation.y += dt * 2.6;
        const blink = ob.data.blinker as THREE.Mesh;
        const bm = blink.material as THREE.MeshBasicMaterial;
        bm.transparent = true;
        bm.opacity = Math.sin(this.time * 7 + ob.t) > 0.2 ? 1 : 0.18;
      } else if (ob.kind === "laser") {
        const flick = 0.72 + Math.sin(this.time * 26 + ob.t * 7) * 0.28;
        ob.data.beamMat.opacity = flick;
        (ob.data.innerMat as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(this.time * 38) * 0.3;
      } else if (ob.kind === "container") {
        ob.x = LANES[ob.data.baseLane] + Math.sin(ob.t * ob.data.rate) * ob.data.amp;
        g.position.x = ob.x;
        ob.data.box.rotation.y = Math.sin(ob.t * 0.7) * 0.08;
        const pulse = 0.5 + Math.abs(Math.sin(this.time * 4 + ob.t)) * 0.5;
        for (let i = 0; i < 4; i++) {
          const b = ob.data["bulb" + i] as THREE.Mesh;
          if (b) (b.material as THREE.MeshBasicMaterial).opacity = pulse;
        }
      } else if (ob.kind === "energy") {
        ob.data.fieldMat.opacity = 0.1 + Math.abs(Math.sin(this.time * 18 + ob.t)) * 0.14;
        ob.data.zapT -= dt;
        if (ob.data.zapT <= 0 && ob.z > -90) {
          ob.data.zapT = 0.06;
          for (const bolt of ob.data.bolts as THREE.Line[]) {
            const attr = bolt.geometry.attributes.position as THREE.BufferAttribute;
            for (let i = 0; i < 12; i++) {
              const f = i / 11;
              attr.setXYZ(i, rand(-0.9, 0.9) * Math.sin(f * Math.PI), 0.1 + f * 2.65, 0.02);
            }
            attr.needsUpdate = true;
          }
        }
      } else if (ob.kind === "meteor") {
        const rock = ob.data.rock as THREE.Mesh;
        const trail = ob.data.trail as THREE.Group;
        if (!ob.data.landed) {
          rock.position.y = Math.max(1.0, (-ob.z - 46) * 0.6);
          rock.rotation.x += dt * 5;
          rock.rotation.z += dt * 3;
          (ob.data.ring as THREE.Mesh).rotation.z += dt * 2;
          const sc = 1 + Math.sin(this.time * 10) * 0.15;
          (ob.data.ring as THREE.Mesh).scale.setScalar(sc);
          trail.visible = true;
          trail.scale.y = 0.9 + Math.sin(this.time * 18) * 0.2;
          const t0Mat = (trail.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
          t0Mat.opacity = 0.6 + Math.sin(this.time * 22) * 0.2;
          if (rock.position.y > 1.4 && ob.z > -110 && Math.random() < 0.6) {
            this.particles.burst({ x: ob.x, y: rock.position.y - 0.2, z: ob.z }, 2, 0xff7722, { speed: 1.8, life: 0.4 });
          }
          if (rock.position.y <= 1.02) {
            ob.data.landed = true;
            rock.material = this.rockMat;
            ob.data.ring.visible = false;
            trail.visible = false;
            if (!attract) {
              this.sound.boom();
              this.trauma = Math.min(1, this.trauma + 0.35);
            }
            this.particles.burst({ x: ob.x, y: 0.4, z: ob.z }, 26, 0xff8833, { speed: 6, life: 0.8, gravity: 8, up: 3 });
          }
        } else {
          rock.rotation.y += dt * 0.4;
          trail.visible = false;
        }
      }
      if (ob.kind === "asteroid") {
        (ob.data.spin as THREE.Group).rotation.y += dt * 0.8;
        (ob.data.spin as THREE.Group).rotation.x += dt * 0.3;
      }
    }
  }

  private updateStars(dt: number, attract: boolean) {
    const magnetR = this.powers.rocket > 0 ? 12 : this.powers.magnet > 0 ? 8 : 0;
    const py = this.py + 0.9;
    let i = 0;
    for (const s of this.stars) {
      if (s.active) {
        s.pull = false;
        // magnet pull
        if (!attract && magnetR > 0 && s.z > -magnetR - 2 && s.z < 3) {
          const dx = this.px - s.x, dy = py - s.y, dz = -s.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < magnetR) {
            s.pull = true;
            const sp = 22 * dt;
            s.x += (dx / (d + 0.001)) * sp;
            s.y += (dy / (d + 0.001)) * sp;
            s.z += (dz / (d + 0.001)) * sp;
          }
        }
        // collection
        const dx = Math.abs(s.x - this.px), dz = Math.abs(s.z), dy = Math.abs(s.y - py);
        if (!attract && dz < 1.1 && dx < 1.0 && (dy < 1.35 || s.pull)) {
          s.active = false;
          const val = s.val * (this.powers.hyper > 0 ? 2 : 1);
          this.starCount += val;
          this.starPoints += val;
          this.score += val * 8;
          this.streak++;
          this.streakT = 0.7;
          this.sound.star(this.streak);
          this.particles.burst({ x: s.x, y: s.y, z: s.z }, 7, 0xffd75e, { speed: 3, life: 0.5 });
        } else if (attract && dz < 1.1 && dx < 1.0 && dy < 1.35) {
          s.active = false;
          this.particles.burst({ x: s.x, y: s.y, z: s.z }, 5, 0xffd75e, { speed: 2.5, life: 0.4 });
        }
      }
      if (s.active) {
        this.dummy.position.set(s.x, s.y + Math.sin(this.time * 3 + i) * 0.07, s.z);
        this.dummy.rotation.set(0, this.time * 2.6 + i * 0.7, 0);
        this.dummy.scale.setScalar(s.scale);
      } else {
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0.0001);
      }
      this.dummy.updateMatrix();
      this.starMesh.setMatrixAt(i, this.dummy.matrix);
      i++;
    }
    this.starMesh.instanceMatrix.needsUpdate = true;
  }

  private updatePickups(dt: number, attract: boolean) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t += dt;
      p.group.position.set(p.x, 1.15 + Math.sin(p.t * 2.4) * 0.18, p.z);
      p.group.rotation.y += dt * 2;
      if (!attract && Math.abs(p.z) < 1.2 && Math.abs(p.x - this.px) < 1.15 && this.py < 2.4) {
        this.activatePower(p.id);
        p.active = false;
        p.group.visible = false;
        const pool = this.pickPool.get(p.id) || [];
        pool.push(p);
        this.pickPool.set(p.id, pool);
        this.pickups.splice(i, 1);
      }
    }
  }

  private activatePower(id: PowerId) {
    this.sound.power();
    const colors: Record<PowerId, number> = { rocket: 0xff6b35, shield: 0x38bdf8, boots: 0xa78bfa, magnet: 0xf43f5e, kit: 0x34d399, hyper: 0xfde047 };
    this.particles.burst({ x: this.px, y: this.py + 1.2, z: 0 }, 24, colors[id], { speed: 5, life: 0.8 });
    if (id === "shield" || id === "kit") {
      this.powers[id] = 1;
    } else {
      this.powers[id] = this.powerTotals[id];
    }
    if (id === "rocket") {
      this.sound.rocket();
      this.sliding = 0;
      this.falling = false;
      // bonus star stream at flight altitude
      for (let i = 0; i < 22; i++) {
        this.spawnStar(LANES[this.lane], 4.8, -14 - i * 2.4, i % 6 === 5 ? 3 : 1);
      }
    }
    (this.parts.shield as THREE.Mesh).visible = this.powers.shield > 0;
    this.emitHud();
  }

  private updatePowers(dt: number) {
    for (const id of ["rocket", "boots", "magnet", "hyper"] as PowerId[]) {
      if (this.powers[id] > 0) {
        this.powers[id] = Math.max(0, this.powers[id] - dt);
        if (id === "rocket" && this.powers[id] === 0) {
          this.invuln = Math.max(this.invuln, 1.3);
          this.vy = 0;
        }
      }
    }
    if (this.powers.rocket > 0) {
      this.particles.burst({ x: this.px, y: this.py + 0.9, z: 0.9 }, 2, 0xffa63d, { speed: 2, life: 0.4 });
    }
    if (this.powers.hyper > 0 && Math.random() < 0.5) {
      this.particles.burst({ x: rand(-4, 4), y: rand(0.2, 3.4), z: -30 }, 1, 0x9ff5ff, { speed: 0.1, life: 0.5 });
    }
    (this.parts.shield as THREE.Mesh).visible = this.powers.shield > 0;
    if (this.powers.shield > 0) {
      const sm = (this.parts.shield as THREE.Mesh).material as THREE.MeshPhongMaterial;
      sm.opacity = 0.16 + Math.sin(this.time * 5) * 0.06;
    }
  }

  /* ---------------- player ---------------- */
  private updatePlayerPhysics(dt: number, attract: boolean) {
    // lane lerp
    const targetX = LANES[this.lane];
    this.px += (targetX - this.px) * Math.min(1, dt * 13);

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.sliding = Math.max(0, this.sliding - dt);

    if (this.powers.rocket > 0) {
      this.py += (4.7 - this.py) * Math.min(1, dt * 5);
      this.vy = 0;
      this.grounded = false;
      this.falling = false;
      return;
    }

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0 || (this.powers.boots > 0 && this.jumpsUsed < 2 && !this.falling))) {
      this.jumpBuffer = 0;
      this.doJump();
    }

    if (this.grounded) {
      if (!this.groundUnder(this.px)) {
        this.grounded = false;
        this.coyote = 0.11;
        this.vy = 0;
      }
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.py += this.vy * dt;
      if (this.py <= 0 && this.vy <= 0 && !this.falling) {
        if (this.groundUnder(this.px)) {
          this.py = 0; this.vy = 0; this.grounded = true; this.jumpsUsed = 0;
          this.particles.burst({ x: this.px, y: 0.12, z: 0.3 }, 5, 0x22d3ee, { speed: 2.2, life: 0.35 });
        } else if (this.py < -0.35) {
          this.falling = true;
        } else {
          this.py = Math.max(this.py, -0.3);
        }
      }
      if (this.falling) {
        // ledge grab: drifted back over solid ground
        if (this.py > -1.1 && this.groundUnder(this.px) && this.vy < 0) {
          this.falling = false;
          this.py = 0.02; this.vy = 0; this.grounded = true; this.jumpsUsed = 0;
        }
        if (this.py < -1.8 && !attract) {
          if (this.powers.kit > 0) {
            this.powers.kit = 0;
            this.py = -0.4; this.vy = 11.5;
            this.falling = false;
            this.invuln = 2;
            this.sound.rescue();
            this.particles.burst({ x: this.px, y: 0, z: 0 }, 34, 0x34d399, { speed: 6, life: 0.9, up: 4 });
            this.emitHud();
          }
        }
        if (this.py < -9 && !attract) this.die("VOID");
      }
    }
  }

  private updatePlayerVisual(dt: number) {
    this.player.position.set(this.px, this.py + 0.14, 0);
    this.player.rotation.set(0, 0, 0);
    const v = this.visual;
    const rocket = this.powers.rocket > 0;
    this.runT += dt * (7 + this.speed * 0.4);

    const legL = this.parts.legL as THREE.Group;
    const legR = this.parts.legR as THREE.Group;
    const armL = this.parts.armL as THREE.Group;
    const armR = this.parts.armR as THREE.Group;
    const flame = this.parts.flame as THREE.Mesh;

    // reset arm twist each frame (set by states below)
    armL.rotation.z = 0; armR.rotation.z = 0;

    // Lateral lean when switching lanes
    const targetRoll = (LANES[this.lane] - this.px) * -0.14;
    v.rotation.z += (targetRoll - v.rotation.z) * Math.min(1, dt * 10);
    const targetLeanX = this.sliding > 0 ? -1.05 : this.grounded ? 0.14 : (!this.grounded && this.vy < 0 ? 0.22 : 0.08);
    v.rotation.x += (targetLeanX - v.rotation.x) * Math.min(1, dt * 10);

    if (rocket) {
      v.position.y += (0.4 - v.position.y) * Math.min(1, dt * 8);
      legL.rotation.x += (0.3 - legL.rotation.x) * Math.min(1, dt * 10);
      legR.rotation.x += (0.3 - legR.rotation.x) * Math.min(1, dt * 10);
      armL.rotation.x += (-2.6 - armL.rotation.x) * Math.min(1, dt * 10);
      armR.rotation.x += (-2.6 - armR.rotation.x) * Math.min(1, dt * 10);
      v.rotation.y += (0 - v.rotation.y) * Math.min(1, dt * 8);
      flame.visible = true;
      flame.scale.set(1, 1 + Math.sin(this.time * 40) * 0.3, 1);
    } else if (this.sliding > 0) {
      v.position.y += (-0.42 - v.position.y) * Math.min(1, dt * 14);
      legL.rotation.x += (0.55 - legL.rotation.x) * Math.min(1, dt * 14);
      legR.rotation.x += (0.25 - legR.rotation.x) * Math.min(1, dt * 14);
      armL.rotation.x += (-0.9 - armL.rotation.x) * Math.min(1, dt * 14);
      armR.rotation.x += (-0.9 - armR.rotation.x) * Math.min(1, dt * 14);
      v.rotation.y += (0 - v.rotation.y) * Math.min(1, dt * 14);
      flame.visible = false;
    } else if (!this.grounded) {
      v.position.y += (0 - v.position.y) * Math.min(1, dt * 8);
      const tuck = this.vy < 0 ? 0.6 : 0.75;
      legL.rotation.x += (tuck - legL.rotation.x) * Math.min(1, dt * 10);
      legR.rotation.x += (-0.45 - legR.rotation.x) * Math.min(1, dt * 10);
      armL.rotation.x += (-2.2 - armL.rotation.x) * Math.min(1, dt * 10);
      armR.rotation.x += (-2.2 - armR.rotation.x) * Math.min(1, dt * 10);
      v.rotation.y += (0 - v.rotation.y) * Math.min(1, dt * 8);
      flame.visible = this.powers.boots > 0 && this.jumpsUsed === 2;
    } else {
      const s = Math.sin(this.runT);
      const c = Math.cos(this.runT);
      // Natural run: extended leg back, bent leg forward, opposing arms, slight torso twist & bob
      legL.rotation.x = s * 1.15;
      legR.rotation.x = -s * 1.15;
      armL.rotation.x = -s * 1.0;
      armR.rotation.x = s * 1.0;
      // Elbow/arm bend adds natural forward swing
      (armL as THREE.Group).rotation.z = 0.12 + c * 0.06;
      (armR as THREE.Group).rotation.z = -0.12 - c * 0.06;
      v.position.y = Math.abs(c) * 0.09;
      v.rotation.y = s * 0.06;
      flame.visible = false;
    }

    // shadow ring
    const shadow = this.parts.shadow as THREE.Group;
    shadow.position.x = this.px;
    shadow.position.z = 0;
    const over = this.groundUnder(this.px);
    shadow.visible = over && this.py > -0.5 && !this.falling && this.player.visible;
    const sc = clamp(1 - this.py * 0.09, 0.35, 1);
    shadow.scale.setScalar(sc);
    // invulnerability blink
    this.visual.visible = this.invuln > 0.15 && this.mode === "playing" ? Math.sin(this.time * 24) > -0.4 : true;
    this.playerLight.position.set(this.px, this.py + 2.4, 1);
  }

  private autopilot(dt: number) {
    this.autoT -= dt;
    // dodge nearest obstacle
    for (const ob of this.obstacles) {
      if (ob.z > -13 && ob.z < -3 && Math.abs(ob.x - this.px) < 1.4 && ob.hy0 < 1) {
        const options = [0, 1, 2].filter((l) => l !== this.lane && !this.obstacles.some((o) => o.z > -16 && o.z < -2 && Math.abs(o.x - LANES[l]) < 1.3));
        if (options.length) this.lane = pick(options);
        else if (ob.hy1 < 1.2) this.queueJump();
        break;
      }
    }
    if (this.autoT <= 0) {
      this.autoT = rand(0.8, 1.8);
      const r = Math.random();
      if (r < 0.35) this.lane = randi(0, 2);
      else if (r < 0.55) this.queueJump();
      else if (r < 0.65) this.slideOrDive();
    }
    if (this.jumpBuffer > 0 && this.grounded) { this.jumpBuffer = 0; this.doJump(); }
  }

  /* ---------------- collisions ---------------- */
  private checkCollisions() {
    if (this.invuln > 0 || this.powers.rocket > 0) {
      // rocket smashes obstacles for bonus points
      if (this.powers.rocket > 0) {
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
          const ob = this.obstacles[i];
          if (Math.abs(ob.z) < 1.6 && Math.abs(ob.x - this.px) < ob.hx + 0.5) {
            this.particles.burst({ x: ob.x, y: 1.2, z: ob.z }, 30, 0xffa63d, { speed: 7, life: 0.8 });
            this.score += 40;
            this.sound.boom();
            this.freeObstacle(ob);
            this.obstacles.splice(i, 1);
          }
        }
      }
      return;
    }
    const pHx = 0.38;
    const pY0 = this.py + 0.08;
    const pY1 = this.py + (this.sliding > 0 ? 0.82 : 1.66);
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const ob = this.obstacles[i];
      if (Math.abs(ob.z) > ob.hd + 0.42) continue;
      if (ob.kind === "meteor" && !ob.data.landed) continue;
      if (Math.abs(ob.x - this.px) > ob.hx + pHx) continue;
      if (pY1 < ob.hy0 || pY0 > ob.hy1) continue;
      // ---- hit ----
      if (this.powers.shield > 0) {
        this.powers.shield = 0;
        this.invuln = 1.2;
        this.sound.shieldPop();
        this.trauma = Math.min(1, this.trauma + 0.5);
        this.particles.burst({ x: this.px, y: this.py + 1, z: 0 }, 36, 0x38bdf8, { speed: 7, life: 0.8 });
        this.particles.burst({ x: ob.x, y: 1.2, z: ob.z }, 22, 0xffa63d, { speed: 6, life: 0.7 });
        this.freeObstacle(ob);
        this.obstacles.splice(i, 1);
        this.emitHud();
        return;
      }
      const names: Record<ObKind, string> = {
        asteroid: "ASTEROID", satellite: "SATELLITE", meteor: "METEOR", laser: "LASER",
        container: "CONTAINER", energy: "ENERGY", spinner: "SPINNER",
      };
      this.die(names[ob.kind]);
      return;
    }
  }

  /* ---------------- alien chaser ---------------- */
  private updateAlien(dt: number) {
    if (!this.alienData) return;
    const a = this.alienData;
    const chasing = this.mode === "playing" || this.mode === "dying";
    this.alienGroup.visible = chasing;
    if (!chasing) return;

    a.breathT += dt;
    a.roarT -= dt;

    // Threat dynamics: gains on slides/obstacle near misses, falls back on hyper/rocket/long ground runs
    const target =
      this.py < 0.2 && this.grounded ? 0.25 :
      this.sliding > 0.1 ? 0.55 :
      this.powers.hyper > 0 ? -0.4 :
      this.powers.rocket > 0 ? -0.9 :
      0.4;
    a.threat += (target - a.threat) * Math.min(1, dt * 0.9);

    // When dying, lunges forward to grab you
    const catchBoost = this.mode === "dying" ? Math.min(1, (1.15 - this.deathTimer) * 1.3) : 0;

    // gap: smaller = closer. Start ~11, min ~2.5
    const desiredGap = 10.5 - a.threat * 6 - catchBoost * 7;
    a.gap += (desiredGap - a.gap) * Math.min(1, dt * 0.8);

    // Chase follows player's lane with lag, hunches lower when close
    const laneTarget = LANES[this.lane] * 0.55;
    const curX = this.alienGroup.position.x;
    this.alienGroup.position.x += (laneTarget - curX) * Math.min(1, dt * 2.4);
    const close = 1 - clamp((a.gap - 2.5) / 8, 0, 1);
    this.alienGroup.position.y = 0.2 - close * 0.2 + Math.sin(a.breathT * 2.2) * 0.06;
    this.alienGroup.position.z = a.gap;
    this.alienGroup.rotation.z = (laneTarget - curX) * -0.15;
    // Lean forward, mouth open when close
    this.alienGroup.rotation.x = -0.08 - close * 0.25;
    const scale = 1.0 + close * 0.35;
    this.alienGroup.scale.setScalar(scale);

    // Tendril wriggle
    a.tendrils.forEach((chain, i) => {
      let obj: THREE.Object3D = chain;
      let depth = 0;
      while (obj.children.length > 0 && depth < 5) {
        const phase = a.breathT * (2 + (i % 3)) + i;
        obj.rotation.y = Math.sin(phase + depth * 0.9) * 0.4;
        obj.rotation.x = Math.cos(phase * 0.8 + depth * 0.7) * 0.25;
        obj = obj.children[0];
        depth++;
      }
    });

    // Eye pulse – brighter when close
    const eyePulse = 0.6 + Math.sin(a.breathT * 4) * 0.15 + close * 0.6;
    a.eyes.forEach((e) => {
      const m = e.material as THREE.MeshBasicMaterial;
      m.color.setRGB(1, 0.1 + close * 0.2, 0.15);
      m.opacity = Math.min(1.1, eyePulse);
      (m as any).transparent = false;
    });

    // Emit a smoke/dark particle trail behind and a red glow when close
    if (Math.random() < 0.3 + close * 0.6) {
      const col = close > 0.6 ? 0xff2233 : 0x3b1050;
      this.particles.burst(
        { x: this.alienGroup.position.x + rand(-0.6, 0.6), y: 0.7 + rand(0, 1.2), z: this.alienGroup.position.z + rand(0.3, 1.2) },
        close > 0.6 ? 3 : 1,
        col,
        { speed: 2.2, life: 0.55 }
      );
    }

    // Occasional roar when close
    if (a.roarT <= 0 && close > 0.5) {
      a.roarT = rand(1.6, 3.2);
      if (this.mode === "playing") {
        // low whoosh via engine sound helper
        this.sound.boom();
        this.trauma = Math.min(1, this.trauma + 0.25);
      }
    }
  }

  /* ---------------- tutorial ---------------- */
  private emitTutorialStep() {
    if (!this.cb.onTutorial) return;
    if (!this.tutorialStep) { this.cb.onTutorial(null); return; }
    const stepInfo: Record<TutorialStepId, { title: string; hint: string }> = {
      left:    { title: "STEP 1 · MOVE LEFT",  hint: this.onMobile() ? "Swipe LEFT to switch to the left lane." : "Press ◀ or A to move left." },
      right:   { title: "STEP 2 · MOVE RIGHT", hint: this.onMobile() ? "Swipe RIGHT to switch to the right lane." : "Press ▶ or D to move right." },
      jump:    { title: "STEP 3 · JUMP",       hint: this.onMobile() ? "Swipe UP to leap over the rock!" : "Press SPACE / ▲ to jump over obstacles." },
      slide:   { title: "STEP 4 · SLIDE",      hint: this.onMobile() ? "Swipe DOWN to slide under the barrier!" : "Press ▼ or S to slide under satellites." },
      collect: { title: "STEP 5 · COLLECT REWARDS", hint: "Run through the glowing mini-stars and power-ups." },
      avoid:   { title: "STEP 6 · STAY ALERT",  hint: "One wrong move ends the run! Dodge the hazards ahead." },
      done:    { title: "YOU'RE READY!",       hint: "Tap CONTINUE to start your run." },
    };
    const info = stepInfo[this.tutorialStep];
    this.cb.onTutorial({
      step: this.tutorialStep,
      progress: Math.min(1, this.tutorialStepTime / this.expectedStepDuration()),
      title: info.title,
      hint: info.hint,
      canSkip: true,
    });
  }

  private onMobile() {
    return typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }

  private expectedStepDuration() {
    switch (this.tutorialStep) {
      case "left": return 2.2;
      case "right": return 2.2;
      case "jump": return 5;
      case "slide": return 5;
      case "collect": return 5;
      case "avoid": return 7;
      case "done": return 999;
      default: return 3;
    }
  }

  private advanceStep() {
    if (!this.tutorialStep) return;
    const order: TutorialStepId[] = ["left", "right", "jump", "slide", "collect", "avoid", "done"];
    const idx = order.indexOf(this.tutorialStep);
    const next = order[idx + 1] ?? "done";
    this.tutorialStep = next;
    this.tutorialStepTime = 0;
    this.tutorialWaitInput = next !== "collect" && next !== "done";
    this.tutorialCompletedThisStep = false;
    // Clear obstacles between steps
    for (const ob of this.obstacles) this.freeObstacle(ob);
    this.obstacles.length = 0;
    // Reset lane to center for next instruction
    if (next === "right" || next === "jump" || next === "slide" || next === "collect" || next === "avoid") {
      this.lane = 1;
      this.py = 0; this.vy = 0; this.sliding = 0; this.grounded = true; this.falling = false;
    }
    // Script the right obstacle for each step
    if (next === "jump") this.spawnObstacle("asteroid", 1, -14);
    if (next === "slide") this.spawnObstacle("satellite", 1, -16);
    if (next === "avoid") {
      this.spawnObstacle("asteroid", 1, -22);
      this.spawnObstacle("asteroid", 0, -12);
    }
    if (next === "collect") {
      for (let i = 0; i < 7; i++) this.spawnStar(LANES[1], 0.85, -20 + i * 1.8, 1);
      this.spawnPickup(1, -14);
    }
    this.emitTutorialStep();
  }

  private updateTutorial(dt: number) {
    if (!this.tutorialStep) return;
    this.tutorialStepTime += dt;
    const dur = this.expectedStepDuration();

    // Lane change steps: advance when player performs the move, or after auto-demo window
    if (this.tutorialStep === "left" && !this.tutorialCompletedThisStep) {
      if (this.lane === 0) { this.tutorialCompletedThisStep = true; this.tutorialStepTime = Math.max(this.tutorialStepTime, dur - 0.8); }
    }
    if (this.tutorialStep === "right" && !this.tutorialCompletedThisStep) {
      if (this.lane === 2) { this.tutorialCompletedThisStep = true; this.tutorialStepTime = Math.max(this.tutorialStepTime, dur - 0.8); }
    }
    if (this.tutorialStep === "jump" && !this.tutorialCompletedThisStep) {
      if (!this.grounded && this.py > 0.6) { this.tutorialCompletedThisStep = true; this.tutorialStepTime = Math.max(this.tutorialStepTime, dur - 0.8); }
    }
    if (this.tutorialStep === "slide" && !this.tutorialCompletedThisStep) {
      if (this.sliding > 0.1) { this.tutorialCompletedThisStep = true; this.tutorialStepTime = Math.max(this.tutorialStepTime, dur - 0.8); }
    }
    if (this.tutorialStep === "collect") {
      if (this.dist > 45) { this.tutorialCompletedThisStep = true; this.tutorialStepTime = Math.max(this.tutorialStepTime, dur - 0.6); }
    }
    if (this.tutorialStep === "avoid") {
      if (this.dist > 55) { this.tutorialCompletedThisStep = true; this.tutorialStepTime = Math.max(this.tutorialStepTime, dur - 0.6); }
    }

    // Force player back to ground if they fall off in tutorial
    if (this.py < -1.2) { this.py = 0; this.vy = 0; this.grounded = true; this.falling = false; }

    // Advance when step duration elapsed (also works if player didn't act: moves forward gently)
    if (this.tutorialStepTime > dur) this.advanceStep();
    else this.emitTutorialStep();
  }

  /* ---------------- background ---------------- */
  private updateBackground(dt: number) {
    this.sky.rotation.y += dt * 0.004;
    this.starClouds[0].rotation.y += dt * 0.0022;
    this.starClouds[1].rotation.y -= dt * 0.0015;
    (this.starClouds[1].material as THREE.PointsMaterial).opacity = 0.45 + Math.sin(this.time * 1.7) * 0.12;

    // Moon approach – asymptotic, never arrives (big and low like the reference)
    const f = 1 - Math.exp(-this.dist / 2600);
    this.moonGroup.position.z = -500 + f * 110;
    this.moonGroup.position.y = 26 + f * 9;
    this.moonGroup.scale.setScalar(1 + f * 1.35);
    // Keep the moon disc billboarded toward the camera
    const disc = this.moonGroup.userData.moonDisc as THREE.Mesh;
    if (disc) disc.lookAt(this.camera.position);
    // subtle shimmer on outer halo
    (this.moonGroup.children[3] as THREE.Sprite).material.opacity = 0.55 + Math.sin(this.time * 1.6) * 0.06;

    // comets
    for (const c of this.comets) {
      c.life -= dt;
      if (c.life <= 0) {
        const fast = Math.random() < 0.4;
        c.life = fast ? rand(0.8, 1.4) : rand(2.5, 5);
        c.head.position.set(rand(-350, 350), rand(60, 260), rand(-700, -300));
        const sp = fast ? rand(180, 300) : rand(40, 90);
        c.vel.set(rand(-1, 1) * sp, rand(-0.5, -0.15) * sp, rand(-0.2, 0.2) * sp);
        c.head.scale.setScalar(fast ? 3.5 : rand(5, 9));
      }
      c.head.position.addScaledVector(c.vel, dt);
      const len = c.vel.length() * 0.16;
      c.trail.position.copy(c.head.position).addScaledVector(c.vel.clone().normalize(), -len / 2);
      c.trail.scale.set(len, c.head.scale.x * 0.32, 1);
      c.trail.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), c.vel.clone().normalize());
    }

    // drifting rocks
    for (const r of this.bgRocks) {
      r.rotation.y += dt * 0.12;
      r.rotation.x += dt * 0.05;
      r.position.z += dt * 2.2;
      if (r.position.z > 30) {
        r.position.z = -450;
        r.position.x = rand(18, 80) * (Math.random() < 0.5 ? -1 : 1);
        r.position.y = rand(-18, 40);
      }
    }
    // satellites orbit
    this.bgSats.forEach((s, i) => {
      const t = this.time * 0.05 + i * 2.6;
      s.position.set(Math.cos(t) * 90 * (i === 0 ? 1 : -1), 34 + Math.sin(t * 1.6) * 12, -240 + Math.sin(t) * 90);
      s.rotation.y += dt * 0.3;
    });

    // distant explosions
    this.nextExplode -= dt;
    if (this.nextExplode <= 0) {
      this.nextExplode = rand(7, 15);
      const p = { x: rand(-220, 220), y: rand(20, 130), z: rand(-500, -250) };
      this.particles.burst(p, 42, pick([0xffa63d, 0x67e8f9, 0xf471b5]), { speed: 26, life: 1.6 });
      this.flashLight.position.set(p.x, p.y, p.z);
      this.flashLight.color.setHex(0xffcc88);
      this.flashLight.intensity = 340;
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 1400);
  }

  /* ---------------- camera ---------------- */
  private updateCamera(dt: number) {
    const cam = this.camera;
    const menu = this.mode === "menu";
    const targetX = menu ? Math.sin(this.time * 0.16) * 2.6 : this.px * 0.55;
    const targetY = menu ? 5.0 : 4.3 + Math.max(-1.2, this.py) * 0.34;
    const targetZ = menu ? 9.6 : 8.2;
    cam.position.x += (targetX - cam.position.x) * Math.min(1, dt * 5);
    cam.position.y += (targetY - cam.position.y) * Math.min(1, dt * 5);
    cam.position.z += (targetZ - cam.position.z) * Math.min(1, dt * 3);
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * 0.45;
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
    }
    const lookY = menu ? 2.4 : 1.7 + Math.max(-2, this.py) * 0.3;
    cam.lookAt(menu ? 0 : this.px * 0.7, lookY, -8);
    const targetFov = 62 + (this.speed - 12.5) * 0.5 + (this.powers.hyper > 0 ? 7 : 0);
    cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 4);
    cam.updateProjectionMatrix();
  }

  /* ---------------- HUD ---------------- */
  private emitHud() {
    const powers: PowerHud[] = [];
    for (const id of ["rocket", "boots", "magnet", "hyper"] as PowerId[]) {
      if (this.powers[id] > 0) powers.push({ id, remain: this.powers[id], total: this.powerTotals[id] });
    }
    this.cb.onHud({
      score: Math.floor(this.score),
      distance: Math.floor(this.dist),
      stars: this.starCount,
      speed: this.speed,
      moon: 1 - Math.exp(-this.dist / 3200),
      shield: this.powers.shield > 0,
      kit: this.powers.kit > 0,
      mult: this.powers.hyper > 0 ? 2 : 1,
      powers,
    });
  }

  /* ---------------- misc ---------------- */
  private onResize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKeyDown);
    this.container.removeEventListener("touchstart", this.onTouchStart);
    this.container.removeEventListener("touchmove", this.onTouchMove);
    this.container.removeEventListener("touchend", this.onTouchEnd);
    this.sound.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mm) => mm.dispose());
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
