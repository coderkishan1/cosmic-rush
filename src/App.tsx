import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Rocket, Play, Pause, RotateCcw, Home, Star, Moon, Trophy, Gauge, Shield,
  Magnet, Footprints, Zap, Volume2, VolumeX, Music, Sparkles, LifeBuoy,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Hand, Route, Skull, Share2,
  Copy, Check, QrCode, Smartphone, BookOpen, X, ThumbsUp, ThumbsDown,
} from "lucide-react";
import QRCode from "qrcode";
import { CosmicEngine, type HudData, type RunStats, type PowerId, type Difficulty, type TutorialState } from "./game/engine";
import { cn } from "./utils/cn";

type Screen = "menu" | "playing" | "paused" | "over" | "difficulty" | "tutorialPrompt";

const POWER_META: Record<PowerId, { name: string; icon: typeof Rocket; color: string; desc: string }> = {
  rocket: { name: "MINI ROCKET", icon: Rocket, color: "text-orange-400 border-orange-400/50", desc: "Blast above every obstacle" },
  shield: { name: "SPACE SHIELD", icon: Shield, color: "text-sky-400 border-sky-400/50", desc: "Absorbs one collision" },
  boots: { name: "GRAVITY BOOTS", icon: Footprints, color: "text-violet-400 border-violet-400/50", desc: "Unlock double jumps" },
  magnet: { name: "STAR MAGNET", icon: Magnet, color: "text-rose-400 border-rose-400/50", desc: "Pulls nearby stars to you" },
  kit: { name: "SAFETY KIT", icon: LifeBuoy, color: "text-emerald-400 border-emerald-400/50", desc: "Rescues you from one fall" },
  hyper: { name: "HYPER BOOST", icon: Zap, color: "text-yellow-300 border-yellow-300/50", desc: "Speed surge, double stars" },
};

const EMPTY_HUD: HudData = { score: 0, distance: 0, stars: 0, speed: 0, moon: 0, shield: false, kit: false, mult: 1, powers: [] };

function readNum(k: string) {
  try { return Number(localStorage.getItem(k) || 0); } catch { return 0; }
}
function readLast(): { score: number; distance: number; stars: number } | null {
  try { const v = localStorage.getItem("cr_last"); return v ? JSON.parse(v) : null; } catch { return null; }
}
function readBool(k: string, def: boolean) {
  try { const v = localStorage.getItem(k); return v === null ? def : v === "1"; } catch { return def; }
}
function save(k: string, v: boolean) {
  try { localStorage.setItem(k, v ? "1" : "0"); } catch { /* ignore */ }
}

const Key = ({ children }: { children: React.ReactNode }) => <span className="keycap">{children}</span>;

function Toggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "btn-cosmic clip-btn flex items-center gap-2 px-3 py-2 text-[10px] font-bold tracking-widest",
        on ? "btn-ghost text-cyan-300" : "btn-ghost text-slate-500"
      )}
    >
      {icon}
      <span>{label}</span>
      <span className={cn("ml-1 h-1.5 w-1.5 rounded-full", on ? "bg-cyan-300 shadow-[0_0_8px_#22d3ee]" : "bg-slate-600")} />
    </button>
  );
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<CosmicEngine | null>(null);
  const screenRef = useRef<Screen>("menu");
  const [screen, setScreen] = useState<Screen>("menu");
  const [hud, setHud] = useState<HudData>(EMPTY_HUD);
  const [stats, setStats] = useState<RunStats | null>(null);
  const [sfxOn, setSfxOn] = useState(() => readBool("cr_sound", true));
  const [musicOn, setMusicOn] = useState(() => readBool("cr_music", true));
  const [hiFx, setHiFx] = useState(() => readBool("cr_fx", true));
  const [goKey, setGoKey] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [difficulty, setDifficultyState] = useState<Difficulty>(() => {
    const s = typeof window !== "undefined" ? localStorage.getItem("cr_diff") : null;
    return (s === "amateur" || s === "challenging" || s === "extreme") ? s : "challenging";
  });
  const [tutorialEnabled, setTutorialEnabled] = useState(() => readBool("cr_tut", true));
  const [tutorialState, setTutorialState] = useState<TutorialState | null>(null);
  const [pendingDiff, setPendingDiff] = useState<Difficulty>("challenging");
  const [records, setRecords] = useState({ best: readNum("cr_best"), bestDist: readNum("cr_bestdist"), last: readLast() });
  const isTouch = typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

  screenRef.current = screen;

  // Build share URL (works in dev and production)
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, []);
  const shareText = encodeURIComponent(
    "🚀🌙 COSMIC RUSH – Journey to the Moon! Ek darawna alien tumhare peeche pada hai… bhaag ke Moon tak pahuncho! 🌌✨"
  );
  const waLink = useMemo(
    () => `https://wa.me/?text=${shareText}%0A%0A${encodeURIComponent(shareUrl)}`,
    [shareText, shareUrl]
  );
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  useEffect(() => {
    if (!shareUrl) return;
    QRCode.toDataURL(shareUrl, {
      color: { dark: "#0b1026", light: "#00000000" },
      margin: 1,
      width: 288,
      errorCorrectionLevel: "M",
    }).then(setQrDataUrl).catch(() => setQrDataUrl(""));
  }, [shareUrl]);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  };

  const openShare = () => {
    setShareOpen(true);
    engineRef.current?.sound.click();
    if (screenRef.current === "playing") togglePause();
  };
  const closeShare = () => { setShareOpen(false); engineRef.current?.sound.click(); };

  const togglePause = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    const inTut = e.mode === "tutorial";
    if (screenRef.current === "playing" || inTut) {
      e.setPaused(true);
      setScreen("paused");
      e.sound.click();
    } else if (screenRef.current === "paused") {
      e.setPaused(false);
      setScreen(e.tutorialActive ? "playing" : "playing");
      // if in tutorial, keep the world running but we still show the playing HUD is fine
      setGoKey((k) => k + 1);
      e.sound.click();
    }
  }, []);

  // Resume into the right UI state after unpause
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (screen === "playing" && e.mode === "tutorial") {
      // keep screen state as "playing" but our overlay still renders from tutorialState
    }
  }, [screen]);

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new CosmicEngine(mountRef.current, {
      onHud: setHud,
      onGameOver: (s) => {
        setStats(s);
        setScreen("over");
        setRecords({ best: s.best, bestDist: s.bestDist, last: { score: s.score, distance: s.distance, stars: s.stars } });
      },
      onPauseKey: togglePause,
      onTutorial: (s) => {
        setTutorialState(s);
        if (!s) {
          // Tutorial done – engine will switch to playing mode automatically
          setScreen("playing");
        }
      },
    });
    engine.sound.setMuted(!readBool("cr_sound", true));
    engine.sound.setMusic(readBool("cr_music", true));
    engine.setDifficulty(difficulty);
    engine.setQuality(readBool("cr_fx", true));
    engineRef.current = engine;
    const onVis = () => {
      if (document.hidden && (screenRef.current === "playing" || engine.mode === "tutorial")) togglePause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      engine.dispose();
      engineRef.current = null;
    };
  }, [togglePause, difficulty]);

  const openDifficulty = () => {
    const e = engineRef.current;
    e?.sound.ensure(); e?.sound.click();
    setPendingDiff(difficulty);
    setScreen("difficulty");
  };

  const startWithDifficulty = (diff: Difficulty, skipPrompt: boolean) => {
    const e = engineRef.current;
    if (!e) return;
    setDifficultyState(diff);
    try { localStorage.setItem("cr_diff", diff); } catch { /* ignore */ }
    e.setDifficulty(diff);
    e.sound.click();
    if (tutorialEnabled && !skipPrompt) {
      setScreen("tutorialPrompt");
    } else {
      actuallyStart(diff);
    }
  };

  const actuallyStart = useCallback((diff?: Difficulty) => {
    const e = engineRef.current;
    if (!e) return;
    e.sound.ensure();
    e.sound.setMuted(!readBool("cr_sound", true));
    e.start();
    setHud(EMPTY_HUD);
    setScreen("playing");
    setGoKey((k) => k + 1);
    setShowHint(true);
    setTutorialState(null);
    window.setTimeout(() => setShowHint(false), 5200);
    void diff;
  }, []);

  const startTutorial = () => {
    const e = engineRef.current; if (!e) return;
    e.sound.ensure(); e.sound.click();
    e.startTutorial(pendingDiff);
    setHud(EMPTY_HUD);
    setScreen("playing"); // HUD overlay renders on top
    setGoKey((k) => k + 1);
  };

  const skipTutorialAndStart = () => {
    try { localStorage.setItem("cr_tut_done", "1"); } catch { /* ignore */ }
    actuallyStart(pendingDiff);
  };

  const replayTutorial = () => {
    const e = engineRef.current; if (!e) return;
    e.sound.ensure(); e.sound.click();
    e.startTutorial(difficulty);
    setHud(EMPTY_HUD);
    setScreen("playing");
    setGoKey((k) => k + 1);
  };

  const toggleTutorialEnabled = () => {
    const v = !tutorialEnabled;
    setTutorialEnabled(v);
    save("cr_tut", v);
    engineRef.current?.sound.click();
  };

  // Space / Enter to open difficulty from menu & game-over
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.code === "Space" || ev.code === "Enter") && (screenRef.current === "menu" || screenRef.current === "over")) {
        ev.preventDefault();
        openDifficulty();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toMenu = () => {
    const e = engineRef.current;
    e?.sound.click();
    e?.toMenu();
    setScreen("menu");
  };

  const flipSfx = () => {
    const v = !sfxOn;
    setSfxOn(v);
    save("cr_sound", v);
    const e = engineRef.current;
    e?.sound.ensure();
    e?.sound.setMuted(!v);
    if (v) e?.sound.click();
  };
  const flipMusic = () => {
    const v = !musicOn;
    setMusicOn(v);
    save("cr_music", v);
    const e = engineRef.current;
    e?.sound.ensure();
    e?.sound.setMusic(v);
    e?.sound.click();
  };
  const flipFx = () => {
    const v = !hiFx;
    setHiFx(v);
    save("cr_fx", v);
    engineRef.current?.setQuality(v);
    engineRef.current?.sound.click();
  };

  const menuToggles = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Toggle on={sfxOn} onClick={flipSfx} icon={sfxOn ? <Volume2 size={13} /> : <VolumeX size={13} />} label="SFX" />
      <Toggle on={musicOn} onClick={flipMusic} icon={<Music size={13} />} label="MUSIC" />
      <Toggle on={hiFx} onClick={flipFx} icon={<Sparkles size={13} />} label={hiFx ? "FX HIGH" : "FX LOW"} />
      <Toggle on={tutorialEnabled} onClick={toggleTutorialEnabled} icon={<BookOpen size={13} />} label={tutorialEnabled ? "TUT ON" : "TUT OFF"} />
      <button
        onClick={replayTutorial}
        className="btn-cosmic clip-btn flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold tracking-widest text-violet-300 btn-ghost"
      >
        <Play size={11} /> REPLAY TUTORIAL
      </button>
    </div>
  );
  const toggles = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Toggle on={sfxOn} onClick={flipSfx} icon={sfxOn ? <Volume2 size={13} /> : <VolumeX size={13} />} label="SFX" />
      <Toggle on={musicOn} onClick={flipMusic} icon={<Music size={13} />} label="MUSIC" />
      <Toggle on={hiFx} onClick={flipFx} icon={<Sparkles size={13} />} label={hiFx ? "FX HIGH" : "FX LOW"} />
    </div>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-void text-slate-100">
      {/* 3D viewport */}
      <div ref={mountRef} className="absolute inset-0" />
      {/* ambient overlays */}
      <div className="vignette pointer-events-none absolute inset-0" />
      <div className="scanlines pointer-events-none absolute inset-0 opacity-60" />

      {/* ============ HUD ============ */}
      {(screen === "playing" || screen === "paused") && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            {/* score */}
            <div className="panel-hud clip-panel anim-pop px-4 py-2.5">
              <div className="text-[9px] font-bold tracking-[0.3em] text-cyan-400/80">SCORE</div>
              <div className="font-display text-xl font-bold leading-none text-white text-glow-cyan sm:text-3xl">
                {hud.score.toLocaleString()}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                <Route size={11} className="text-cyan-400" />
                {hud.distance.toLocaleString()} m
                {hud.mult > 1 && <span className="ml-2 rounded-sm bg-yellow-400/20 px-1.5 font-display text-[9px] font-bold text-yellow-300">×2</span>}
              </div>
            </div>
            {/* moon progress */}
            <div className="panel-hud clip-panel hidden w-64 px-4 py-2.5 sm:block">
              <div className="flex items-center justify-between text-[9px] font-bold tracking-[0.25em] text-slate-400">
                <span>LUNAR APPROACH</span>
                <span className="text-cyan-300">{Math.floor(hud.moon * 100)}%</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-fuchsia-400 transition-[width] duration-300"
                    style={{ width: `${Math.max(2, hud.moon * 100)}%` }}
                  />
                </div>
                <Moon size={14} className="shrink-0 text-slate-200" />
              </div>
            </div>
            {/* stars + pause */}
            <div className="flex items-start gap-2">
              <div className="panel-hud clip-panel anim-pop px-4 py-2.5 text-right">
                <div className="text-[9px] font-bold tracking-[0.3em] text-amber-400/80">MINI STARS</div>
                <div key={hud.stars} className="anim-starpulse flex items-center justify-end gap-1.5 font-display text-xl font-bold leading-none text-amber-300 text-glow-gold sm:text-2xl">
                  <Star size={18} fill="currentColor" />
                  {hud.stars}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={openShare}
                  className="btn-cosmic btn-ghost clip-btn pointer-events-auto p-3 text-fuchsia-300"
                  aria-label="Share"
                  title="Share with friends"
                >
                  <Share2 size={16} />
                </button>
                <button
                  onClick={togglePause}
                  className="btn-cosmic btn-ghost clip-btn pointer-events-auto p-3 text-cyan-300"
                  aria-label="Pause"
                >
                  <Pause size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-2">
            {/* active powers */}
            <div className="flex flex-col gap-1.5">
              {hud.powers.map((p) => {
                const meta = POWER_META[p.id];
                const Icon = meta.icon;
                return (
                  <div key={p.id} className={cn("panel-hud clip-panel anim-pop flex w-44 items-center gap-2 border px-3 py-1.5", meta.color)}>
                    <Icon size={15} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-[8px] font-bold tracking-widest">{meta.name}</div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-current transition-[width] duration-150" style={{ width: `${(p.remain / p.total) * 100}%` }} />
                      </div>
                    </div>
                    <span className="font-display text-[10px] font-bold">{p.remain.toFixed(0)}</span>
                  </div>
                );
              })}
              <div className="flex gap-1.5">
                {hud.shield && (
                  <div className="panel-hud clip-panel flex items-center gap-1.5 border border-sky-400/50 px-2.5 py-1.5 text-sky-300">
                    <Shield size={13} /><span className="font-display text-[8px] font-bold tracking-widest">SHIELD</span>
                  </div>
                )}
                {hud.kit && (
                  <div className="panel-hud clip-panel flex items-center gap-1.5 border border-emerald-400/50 px-2.5 py-1.5 text-emerald-300">
                    <LifeBuoy size={13} /><span className="font-display text-[8px] font-bold tracking-widest">SAFETY</span>
                  </div>
                )}
              </div>
            </div>
            {/* speed */}
            <div className="panel-hud clip-panel px-3 py-2 text-right">
              <div className="flex items-center justify-end gap-1.5 text-cyan-300">
                <Gauge size={13} />
                <span className="font-display text-sm font-bold">{hud.speed.toFixed(1)}</span>
                <span className="text-[9px] text-slate-400">m/s</span>
              </div>
            </div>
          </div>

          {/* control hint */}
          {showHint && screen === "playing" && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2">
              <div className="panel-hud clip-panel anim-pop flex items-center gap-3 px-4 py-2 text-[11px] font-semibold text-slate-300">
                {isTouch ? (
                  <>
                    <Hand size={14} className="text-cyan-300" />
                    Swipe ◀ ▶ to switch · Swipe ▲ jump · Swipe ▼ slide · Tap jump
                  </>
                ) : (
                  <>
                    <Key>◀</Key><Key>▶</Key> lanes
                    <Key>SPACE</Key> jump
                    <Key>▼</Key> slide
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* GO! toast */}
      {goKey > 0 && screen === "playing" && (
        <div key={goKey} className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="anim-toast font-display text-6xl font-black tracking-widest text-cyan-300 text-glow-cyan">GO!</span>
        </div>
      )}

      {/* ============ MAIN MENU ============ */}
      {screen === "menu" && (
        <div className="absolute inset-0 flex overflow-y-auto bg-gradient-to-b from-[#05030fdd] via-transparent to-[#05030fee]">
          <div className="m-auto flex w-full max-w-6xl flex-col items-center gap-5 px-4 py-8">
            <div className="anim-pop text-center">
              <div className="mb-3 inline-flex items-center gap-2 border border-cyan-400/30 bg-cyan-950/40 px-3 py-1 text-[9px] font-bold tracking-[0.35em] text-cyan-300">
                <Sparkles size={11} /> DEEP SPACE TRANSIT · SECTOR 7
              </div>
              <h1 className="title-cosmic font-display text-5xl font-black leading-none tracking-tight text-white sm:text-7xl">
                COSMIC<span className="text-cyan-300">RUSH</span>
              </h1>
              <div className="mt-3 flex items-center justify-center gap-3 text-fuchsia-300">
                <span className="h-px w-10 bg-gradient-to-r from-transparent to-fuchsia-400 sm:w-20" />
                <Moon size={15} className="anim-floaty" />
                <span className="shimmer-text font-display text-[11px] font-bold tracking-[0.45em] sm:text-sm">JOURNEY TO THE MOON</span>
                <span className="h-px w-10 bg-gradient-to-l from-transparent to-fuchsia-400 sm:w-20" />
              </div>
            </div>

            <div className="grid w-full items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
              {/* controls */}
              <div className="panel-hud clip-panel anim-pop delay-1 order-2 p-4 md:order-1">
                <div className="mb-3 font-display text-[10px] font-bold tracking-[0.3em] text-cyan-300">FLIGHT CONTROLS</div>
                {isTouch ? (
                  <ul className="space-y-2.5 text-[13px] font-semibold text-slate-300">
                    <li className="flex items-center gap-2"><Hand size={14} className="text-cyan-400" /> Swipe left / right — change lane</li>
                    <li className="flex items-center gap-2"><ArrowUp size={14} className="text-cyan-400" /> Swipe up or tap — jump</li>
                    <li className="flex items-center gap-2"><ArrowDown size={14} className="text-cyan-400" /> Swipe down — slide / dive</li>
                    <li className="flex items-center gap-2"><Pause size={14} className="text-cyan-400" /> Pause button — top right</li>
                  </ul>
                ) : (
                  <ul className="space-y-2.5 text-[13px] font-semibold text-slate-300">
                    <li className="flex items-center justify-between gap-2">
                      <span>Change lane</span>
                      <span className="flex gap-1"><Key>◀</Key><Key>▶</Key><Key>A</Key><Key>D</Key></span>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Jump <span className="text-slate-500">(holes & low bars)</span></span>
                      <span className="flex gap-1"><Key>SPACE</Key><Key>▲</Key></span>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Slide <span className="text-slate-500">(under barriers)</span></span>
                      <span className="flex gap-1"><Key>▼</Key><Key>S</Key></span>
                    </li>
                    <li className="flex items-center justify-between gap-2">
                      <span>Pause</span>
                      <span className="flex gap-1"><Key>ESC</Key><Key>P</Key></span>
                    </li>
                  </ul>
                )}
                <div className="mt-3 border-t border-cyan-400/15 pt-2.5 text-[11px] font-medium leading-relaxed text-slate-400">
                  Jump the <span className="text-orange-300">void gaps</span>, dodge the asteroids, slide under satellites. The Moon always beckons — it never arrives.
                </div>
              </div>

              {/* play */}
              <div className="anim-pop delay-2 order-1 flex flex-col items-center justify-center gap-4 px-2 py-2 md:order-2 md:px-6">
                <button
                  onClick={openDifficulty}
                  className="btn-cosmic btn-primary clip-btn flex items-center gap-3 px-12 py-5 text-xl font-black text-white sm:px-14 sm:text-2xl"
                >
                  <Rocket size={26} className="-rotate-45" />
                  PLAY
                </button>
                {!isTouch && <div className="anim-blink font-display text-[10px] font-bold tracking-[0.35em] text-cyan-300/90">PRESS SPACE TO CHOOSE DIFFICULTY</div>}
                {menuToggles}
                <button
                  onClick={openShare}
                  className="btn-cosmic btn-ghost clip-btn flex items-center gap-2 px-5 py-2.5 text-[11px] font-bold tracking-[0.25em] text-fuchsia-300"
                >
                  <Share2 size={14} /> SHARE WITH FRIENDS
                </button>
              </div>

              {/* power-up codex */}
              <div className="panel-hud clip-panel anim-pop delay-3 order-3 p-4">
                <div className="mb-3 font-display text-[10px] font-bold tracking-[0.3em] text-fuchsia-300">POWER-UP CODEX</div>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                  {(Object.keys(POWER_META) as PowerId[]).map((id) => {
                    const m = POWER_META[id];
                    const Icon = m.icon;
                    return (
                      <li key={id} className="flex items-center gap-2.5">
                        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center border bg-slate-950/60", m.color)}>
                          <Icon size={14} />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-display text-[8.5px] font-bold tracking-wider text-slate-200">{m.name}</span>
                          <span className="block truncate text-[11px] font-medium text-slate-400">{m.desc}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* records */}
            <div className="panel-hud clip-panel anim-pop delay-4 flex w-full flex-wrap items-center justify-center gap-x-8 gap-y-2 px-5 py-3">
              <span className="flex items-center gap-2 text-[12px] font-bold text-slate-300">
                <Trophy size={14} className="text-amber-300" />
                BEST SCORE <span className="font-display text-amber-300 text-glow-gold">{records.best.toLocaleString()}</span>
              </span>
              <span className="flex items-center gap-2 text-[12px] font-bold text-slate-300">
                <Route size={14} className="text-cyan-300" />
                BEST DISTANCE <span className="font-display text-cyan-300">{records.bestDist.toLocaleString()} m</span>
              </span>
              {records.last && (
                <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-400">
                  LAST RUN {records.last.score.toLocaleString()} pts ·
                  <Star size={11} className="text-amber-300" fill="currentColor" /> {records.last.stars}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============ PAUSE ============ */}
      {screen === "paused" && (
        <div className="absolute inset-0 flex justify-center overflow-y-auto bg-[#05030f]/72 backdrop-blur-[3px]">
          <div className="panel-hud clip-panel anim-pop m-auto w-[min(92vw,380px)] p-7 text-center">
            <Pause size={30} className="mx-auto text-cyan-300" />
            <h2 className="mt-2 font-display text-2xl font-black tracking-widest text-white text-glow-cyan">PAUSED</h2>
            <p className="mt-1 text-[11px] font-bold tracking-[0.3em] text-slate-400">SYSTEMS ON STANDBY</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button onClick={togglePause} className="btn-cosmic btn-primary clip-btn flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-black text-white">
                <Play size={16} /> RESUME
              </button>
              <button onClick={() => actuallyStart(difficulty)} className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold text-cyan-300">
                <RotateCcw size={14} /> RESTART RUN
              </button>
              <button onClick={toMenu} className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold text-slate-300">
                <Home size={14} /> EXIT TO MENU
              </button>
            </div>
            <div className="mt-5">{toggles}</div>
          </div>
        </div>
      )}

      {/* ============ GAME OVER ============ */}
      {screen === "over" && stats && (
        <div className="absolute inset-0 flex justify-center overflow-y-auto bg-gradient-to-b from-[#1a051acc] via-[#05030f]/78 to-[#05030fdd] py-4">
          <div className="panel-hud clip-panel anim-pop m-auto w-[min(94vw,440px)] p-7 text-center">
            <Skull size={30} className="mx-auto text-fuchsia-400" />
            <h2 className="mt-2 font-display text-3xl font-black tracking-wider text-fuchsia-300 text-glow-pink">SIGNAL LOST</h2>
            <p className="mt-1.5 text-[13px] font-semibold text-slate-400">{stats.reason}</p>

            {stats.isRecord && (
              <div className="anim-blink mx-auto mt-3 inline-flex items-center gap-2 border border-amber-300/60 bg-amber-400/10 px-3 py-1 font-display text-[10px] font-black tracking-[0.3em] text-amber-300">
                <Trophy size={12} /> NEW GALACTIC RECORD
              </div>
            )}

            <div className="mt-5 border-y border-cyan-400/15 py-4">
              <div className="text-[10px] font-bold tracking-[0.35em] text-cyan-400/80">FINAL SCORE</div>
              <div className="font-display text-5xl font-black text-white text-glow-cyan">{stats.score.toLocaleString()}</div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-950/50 px-2 py-2.5">
                <Route size={14} className="mx-auto text-cyan-300" />
                <div className="mt-1 font-display text-sm font-bold text-white">{stats.distance.toLocaleString()}</div>
                <div className="text-[9px] font-bold tracking-widest text-slate-500">METERS</div>
              </div>
              <div className="bg-slate-950/50 px-2 py-2.5">
                <Star size={14} className="mx-auto text-amber-300" fill="currentColor" />
                <div className="mt-1 font-display text-sm font-bold text-amber-300">{stats.stars}</div>
                <div className="text-[9px] font-bold tracking-widest text-slate-500">MINI STARS</div>
              </div>
              <div className="bg-slate-950/50 px-2 py-2.5">
                <Trophy size={14} className="mx-auto text-fuchsia-300" />
                <div className="mt-1 font-display text-sm font-bold text-white">{stats.best.toLocaleString()}</div>
                <div className="text-[9px] font-bold tracking-widest text-slate-500">BEST</div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <button onClick={() => actuallyStart(difficulty)} className="btn-cosmic btn-primary clip-btn flex items-center justify-center gap-2 px-6 py-4 text-base font-black text-white">
                <RotateCcw size={18} /> RUN AGAIN
              </button>
              <button onClick={openShare} className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold text-fuchsia-300">
                <Share2 size={14} /> CHALLENGE A FRIEND ON WHATSAPP
              </button>
              <button onClick={toMenu} className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold text-slate-300">
                <Home size={14} /> BACK TO MENU
              </button>
            </div>
            {!isTouch && <p className="anim-blink mt-4 text-[10px] font-bold tracking-[0.3em] text-cyan-400/70">PRESS SPACE TO RETRY</p>}
          </div>
        </div>
      )}

      {/* SHARE MODAL */}
      {shareOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#05030f]/78 backdrop-blur-[4px]">
          <div className="panel-hud clip-panel anim-pop w-[min(94vw,460px)] p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-none border border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-300">
              <Smartphone size={22} />
            </div>
            <h2 className="mt-3 font-display text-2xl font-black tracking-widest text-white text-glow-pink">
              SEND TO A FRIEND
            </h2>
            <p className="mt-1 text-[12px] font-semibold text-slate-400">
              Wo bhi Cosmic Rush khel sakein — direct browser me, koi install nahi.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
              {/* QR code */}
              <div className="flex flex-col items-center gap-2">
                <div className="border border-cyan-400/40 bg-[#05030f]/80 p-3 shadow-[0_0_24px_rgba(34,211,238,0.18)]">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="Scan to play" className="block h-40 w-40" />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center text-slate-500"><QrCode size={48} /></div>
                  )}
                </div>
                <p className="text-[10px] font-bold tracking-widest text-cyan-300/80">SCAN QR · PLAY INSTANTLY</p>
              </div>

              {/* Buttons */}
              <div className="flex flex-col justify-center gap-2.5">
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => engineRef.current?.sound.click()}
                  className="btn-cosmic clip-btn flex items-center justify-center gap-2 bg-[#25d366] px-5 py-3 text-sm font-black text-white shadow-[0_0_24px_rgba(37,211,102,0.35)] hover:bg-[#1ebe5b]"
                >
                  <svg width="16" height="16" viewBox="0 0 32 32" fill="currentColor" aria-hidden>
                    <path d="M16 3C9 3 3.3 8.7 3.3 15.7c0 2.4.7 4.6 1.8 6.6L3 29l6.9-1.8c1.9 1 4.1 1.6 6.1 1.6h.1C23 28.8 28.7 23.1 28.7 16S23 3 16 3z" />
                  </svg>
                  WHATSAPP
                </a>
                <button
                  onClick={copyLink}
                  className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-5 py-3 text-xs font-bold text-cyan-300"
                >
                  {copied ? <><Check size={14} /> COPIED!</> : <><Copy size={14} /> COPY LINK</>}
                </button>
                <button
                  onClick={async () => {
                    engineRef.current?.sound.click();
                    try {
                      await navigator.share({
                        title: "COSMIC RUSH – Journey to the Moon",
                        text: "🚀🌙 Ek alien peeche pada hai — bhaag ke Moon tak pahuncho!",
                        url: shareUrl,
                      });
                    } catch { /* ignore */ }
                  }}
                  className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-5 py-3 text-xs font-bold text-slate-200"
                >
                  <Share2 size={14} /> MORE APPS…
                </button>
                <button
                  onClick={closeShare}
                  className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-5 py-2.5 text-[10px] font-bold tracking-widest text-slate-400"
                >
                  CLOSE
                </button>
              </div>
            </div>

            <div className="mt-4 truncate border border-cyan-400/20 bg-black/30 px-3 py-1.5 text-[10px] font-mono text-cyan-200/80">
              {shareUrl}
            </div>
          </div>
        </div>
      )}

      {/* ============ DIFFICULTY SELECTION ============ */}
      {screen === "difficulty" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-[#05030f]/82 backdrop-blur-[3px]">
          <div className="panel-hud clip-panel anim-pop w-[min(96vw,900px)] p-6 sm:p-8">
            <button
              onClick={toMenu}
              className="btn-cosmic btn-ghost clip-btn absolute right-4 top-4 p-2 text-slate-400"
              aria-label="Back"
            >
              <X size={16} />
            </button>
            <div className="text-center">
              <div className="mb-2 inline-flex items-center gap-2 border border-cyan-400/30 bg-cyan-950/40 px-3 py-1 text-[9px] font-bold tracking-[0.35em] text-cyan-300">
                <Gauge size={11} /> DIFFICULTY
              </div>
              <h2 className="title-cosmic font-display text-3xl font-black tracking-wider text-white sm:text-5xl">CHOOSE YOUR CHALLENGE</h2>
              <p className="mt-2 text-[12px] font-semibold text-slate-400">
                Select your skill level. You can change it anytime from the main menu.
              </p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {([
                {
                  id: "amateur",
                  label: "AMATEUR",
                  emoji: "🟢",
                  color: "emerald",
                  hex: "#34d399",
                  sub: "For first-time runners",
                  bullets: ["Slower start speed", "More space between hazards", "Generous reaction time", "Calmer obstacle patterns"],
                },
                {
                  id: "challenging",
                  label: "CHALLENGING",
                  emoji: "🟡",
                  color: "amber",
                  hex: "#fbbf24",
                  sub: "Balanced classic experience",
                  bullets: ["Moderate running speed", "Steady obstacle frequency", "Fair reaction windows", "Scaled difficulty curve"],
                },
                {
                  id: "extreme",
                  label: "EXTREME",
                  emoji: "🔴",
                  color: "rose",
                  hex: "#f43f5e",
                  sub: "Veteran runners only",
                  bullets: ["Blazing top speed", "Dense hazard waves", "Tight reaction windows", "Bonus score multiplier ×1.45"],
                },
              ] as const).map((d) => {
                const selected = pendingDiff === d.id;
                return (
                  <button
                    key={d.id}
                    onClick={() => { engineRef.current?.sound.click(); setPendingDiff(d.id); }}
                    className={cn(
                      "group relative clip-btn p-4 text-left transition-all",
                      "border bg-gradient-to-b from-slate-950/80 to-slate-900/60",
                      selected ? "scale-[1.03] shadow-[0_0_40px_rgba(34,211,238,0.18)]" : "hover:scale-[1.02]"
                    )}
                    style={{
                      borderColor: selected ? d.hex : "rgba(148,163,184,0.25)",
                      boxShadow: selected ? `0 0 46px ${d.hex}55, inset 0 0 30px ${d.hex}33` : undefined,
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-3xl">{d.emoji}</span>
                      <div className={cn(
                        "h-3 w-3 rounded-full border-2",
                        selected ? "border-transparent" : "border-slate-600 bg-transparent"
                      )} style={selected ? { background: d.hex, boxShadow: `0 0 12px ${d.hex}` } : undefined} />
                    </div>
                    <div className="mt-3 font-display text-lg font-black tracking-widest" style={{ color: d.hex, textShadow: `0 0 18px ${d.hex}88` }}>
                      {d.label}
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{d.sub}</div>
                    <ul className="mt-3 space-y-1.5 text-[11px] font-semibold text-slate-300">
                      {d.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-1.5">
                          <span className="mt-[3px] block h-1 w-1 shrink-0 rounded-full" style={{ background: d.hex }} />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>

            <div className="mt-7 flex flex-col items-center gap-3">
              <button
                onClick={() => startWithDifficulty(pendingDiff, false)}
                className="btn-cosmic btn-primary clip-btn flex items-center gap-3 px-12 py-4 text-lg font-black text-white"
              >
                <Rocket size={22} className="-rotate-45" /> LAUNCH
              </button>
              <button
                onClick={toMenu}
                className="btn-cosmic btn-ghost clip-btn px-6 py-2.5 text-[11px] font-bold tracking-[0.25em] text-slate-400"
              >
                BACK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ TUTORIAL PROMPT ============ */}
      {screen === "tutorialPrompt" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#05030f]/82 backdrop-blur-[3px]">
          <div className="panel-hud clip-panel anim-pop w-[min(94vw,480px)] p-7 text-center">
            <BookOpen size={32} className="mx-auto text-fuchsia-300" />
            <h2 className="mt-3 font-display text-2xl font-black tracking-wider text-white text-glow-pink">NEW TO COSMIC RUSH?</h2>
            <p className="mt-2 text-[13px] font-semibold leading-relaxed text-slate-300">
              Would you like a quick interactive tutorial? We'll teach you to dodge, jump, slide and collect mini-stars before the real run starts.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                onClick={startTutorial}
                className="btn-cosmic btn-primary clip-btn flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-black text-white"
              >
                <ThumbsUp size={16} /> YES, SHOW ME HOW TO PLAY
              </button>
              <button
                onClick={skipTutorialAndStart}
                className="btn-cosmic btn-ghost clip-btn flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold text-cyan-300"
              >
                <ThumbsDown size={14} /> NO, I'LL FIGURE IT OUT
              </button>
              <button
                onClick={() => { setScreen("difficulty"); engineRef.current?.sound.click(); }}
                className="btn-cosmic btn-ghost clip-btn px-6 py-2 text-[10px] font-bold tracking-widest text-slate-500"
              >
                ← CHANGE DIFFICULTY
              </button>
            </div>
            <p className="mt-4 text-[10px] font-semibold tracking-widest text-slate-500">
              You can replay the tutorial any time from the main menu.
            </p>
          </div>
        </div>
      )}

      {/* ============ IN-GAME TUTORIAL OVERLAY ============ */}
      {tutorialState && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-between p-6">
          <div className="pointer-events-auto w-full max-w-xl">
            <div className="panel-hud clip-panel anim-pop px-5 py-4 text-center">
              <div className="flex items-center justify-between">
                <span className="font-display text-[9px] font-bold tracking-[0.4em] text-fuchsia-300">COSMIC TRAINING</span>
                <button
                  onClick={() => { engineRef.current?.sound.click(); engineRef.current?.finishTutorial(); }}
                  className="btn-cosmic clip-btn px-2.5 py-1 text-[9px] font-bold tracking-widest text-slate-300 btn-ghost"
                >
                  SKIP →
                </button>
              </div>
              <div className="mt-2 font-display text-xl font-black tracking-wider text-white text-glow-cyan">
                {tutorialState.title}
              </div>
              <p className="mt-1 text-[12px] font-semibold text-slate-300">{tutorialState.hint}</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-[width] duration-150"
                  style={{ width: `${Math.min(100, tutorialState.progress * 100)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-center gap-2 text-[10px] font-bold tracking-widest text-slate-400">
                {isTouch ? (
                  <>
                    {tutorialState.step === "left" && <><Hand size={11} /> Swipe ◀ left</>}
                    {tutorialState.step === "right" && <><Hand size={11} /> Swipe ▶ right</>}
                    {tutorialState.step === "jump" && <><Hand size={11} /> Swipe ▲ or tap</>}
                    {tutorialState.step === "slide" && <><Hand size={11} /> Swipe ▼ down</>}
                    {tutorialState.step === "collect" && <>Run through the stars!</>}
                    {tutorialState.step === "avoid" && <>Dodge the hazards!</>}
                  </>
                ) : (
                  <>
                    {tutorialState.step === "left" && <><Key>◀</Key> or <Key>A</Key></>}
                    {tutorialState.step === "right" && <><Key>▶</Key> or <Key>D</Key></>}
                    {tutorialState.step === "jump" && <><Key>SPACE</Key> to jump</>}
                    {tutorialState.step === "slide" && <><Key>▼</Key> or <Key>S</Key> to slide</>}
                    {tutorialState.step === "collect" && <>Just run through them</>}
                    {tutorialState.step === "avoid" && <>Dodge left/right/jump as needed</>}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Directional hand/arrow indicators */}
          {(tutorialState.step === "left" || tutorialState.step === "right") && (
            <div className="anim-floaty text-6xl font-black text-cyan-300 text-glow-cyan">
              {tutorialState.step === "left" ? "◀" : "▶"}
            </div>
          )}
          {tutorialState.step === "jump" && (
            <div className="anim-floaty text-6xl font-black text-cyan-300 text-glow-cyan">▲</div>
          )}
          {tutorialState.step === "slide" && (
            <div className="anim-floaty text-6xl font-black text-fuchsia-300 text-glow-pink">▼</div>
          )}
          {(tutorialState.step === "collect" || tutorialState.step === "avoid") && (
            <div />
          )}

          <div className="w-full max-w-sm">
            {tutorialState.step === "done" ? (
              <button
                onClick={() => engineRef.current?.finishTutorial()}
                className="btn-cosmic btn-primary clip-btn pointer-events-auto mx-auto flex items-center gap-2 px-10 py-4 text-base font-black text-white"
              >
                <Check size={18} /> CONTINUE
              </button>
            ) : (
              <div className="flex justify-center gap-2 text-[10px] font-bold tracking-widest text-slate-500">
                <span className="anim-blink">●</span>
                <span>{(tutorialState?.step ? ["left","right","jump","slide","collect","avoid","done"].indexOf(tutorialState.step as "left" | "right" | "jump" | "slide" | "collect" | "avoid" | "done") : 0) + 1} / 7</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* mobile swipe arrows during first hint */}
      {screen === "playing" && showHint && isTouch && !tutorialState && (
        <div className="pointer-events-none absolute bottom-40 left-1/2 flex -translate-x-1/2 items-center gap-6 text-cyan-300/70">
          <ArrowLeft size={26} className="anim-blink" />
          <ArrowUp size={26} className="anim-blink" />
          <ArrowDown size={26} className="anim-blink" />
          <ArrowRight size={26} className="anim-blink" />
        </div>
      )}
    </div>
  );
}
