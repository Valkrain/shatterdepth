import { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import {
  Volume2,
  VolumeX,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Zap,
  Bomb,
  ArrowLeftRight,
  ChevronUp,
  RotateCw,
  Maximize2,
  Minimize2,
  Download,
  Share,
  X,
  Crosshair,
} from 'lucide-react';
import { BIOMES, CLASSES } from './engine/catalog';
import { GameEngine } from './engine/GameEngine';
import { sfx } from './engine/SoundFX';
import {
  ClassId,
  DAMAGE_TYPE_LABELS,
  GameState,
  HudPalette,
  HudSnapshot,
  MetaProgress,
  PerkDef,
  RelicDraftOption,
  RunStats,
} from './engine/types';
import { enterImmersiveFullscreen, useFullscreenAndInstall } from './hooks/useFullscreenAndInstall';

const META_KEY = 'shatterdepth_meta_v1';

const DEFAULT_META: MetaProgress = {
  bestDepth: 0,
  bestGold: 0,
  totalPixelsDestroyed: 0,
  totalCollapses: 0,
  runsCompleted: 0,
};

function loadMeta(): MetaProgress {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return DEFAULT_META;
    return { ...DEFAULT_META, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_META;
  }
}

function saveMeta(meta: MetaProgress): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // Ignore storage quota errors
  }
}

function randomSeed(): number {
  return Math.floor(100000 + Math.random() * 899999);
}

function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    'ontouchstart' in window ||
    window.innerWidth < 900
  );
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const [selectedClass, setSelectedClass] = useState<ClassId>('BREACHER');
  const [seedInput, setSeedInput] = useState<string>(() => String(randomSeed()));
  const [muted, setMuted] = useState<boolean>(false);
  const [isTouchMode, setIsTouchMode] = useState<boolean>(() => detectTouchDevice());
  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false
  );
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [palette, setPalette] = useState<HudPalette>(() => BIOMES.SUNKEN_MASONRY.hudPalette);
  const [upgradeChoices, setUpgradeChoices] = useState<PerkDef[]>([]);
  const [bossRelicChoices, setBossRelicChoices] = useState<RelicDraftOption[]>([]);
  const [gameOverStats, setGameOverStats] = useState<RunStats | null>(null);
  const [meta, setMeta] = useState<MetaProgress>(() => loadMeta());
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState<boolean>(false);

  const {
    isFullscreen,
    isStandalone,
    isIOS,
    isInstallable,
    toggleFullscreen,
    installApp,
  } = useFullscreenAndInstall();

  // Left movement thumbstick tracking (dynamic floating origin within general left zone)
  const stickZoneRef = useRef<HTMLDivElement | null>(null);
  const stickRestAnchorRef = useRef<HTMLDivElement | null>(null);
  const stickTouchIdRef = useRef<number | null>(null);
  const stickCenterRef = useRef<{ x: number; y: number; maxR: number }>({ x: 0, y: 0, maxR: 40 });
  const stickJumpActiveRef = useRef<boolean>(false);
  const [stickBaseShift, setStickBaseShift] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [stickOffset, setStickOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [stickActive, setStickActive] = useState<boolean>(false);

  // Right aiming & firing thumbstick tracking
  const aimBaseRef = useRef<HTMLDivElement | null>(null);
  const aimTouchIdRef = useRef<number | null>(null);
  const [aimOffset, setAimOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [aimActive, setAimActive] = useState<boolean>(false);

  // Quick-react weapon switch visual feedback
  const [weaponFlash, setWeaponFlash] = useState<boolean>(false);
  const weaponFlashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const updateViewportFlags = () => {
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);
      if (portrait && engineRef.current) {
        // Pause if rotated into portrait mid-game
        setGameState((curr) => {
          if (curr === 'PLAYING') {
            engineRef.current?.setState('PAUSED');
            return 'PAUSED';
          }
          return curr;
        });
      }
      if (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900) {
        setIsTouchMode(true);
      }
    };

    const onFirstTouch = () => setIsTouchMode(true);
    window.addEventListener('touchstart', onFirstTouch, { passive: true, once: true });
    window.addEventListener('resize', updateViewportFlags);
    window.addEventListener('orientationchange', updateViewportFlags);
    window.visualViewport?.addEventListener('resize', updateViewportFlags);

    return () => {
      window.removeEventListener('touchstart', onFirstTouch);
      window.removeEventListener('resize', updateViewportFlags);
      window.removeEventListener('orientationchange', updateViewportFlags);
      window.visualViewport?.removeEventListener('resize', updateViewportFlags);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, {
      onStateChange: (s) => setGameState(s),
      onHudUpdate: (snapshot) => {
        setHud(snapshot);
        setPalette(snapshot.hudPalette);
      },
      onPaletteChange: (nextPalette) => setPalette(nextPalette),
      onUpgradeChoices: (choices) => setUpgradeChoices(choices),
      onBossRelicChoices: (choices) => setBossRelicChoices(choices),
      onGameOver: (stats) => {
        setGameOverStats(stats);
        setMeta((prev) => {
          const next: MetaProgress = {
            bestDepth: Math.max(prev.bestDepth, stats.depth),
            bestGold: Math.max(prev.bestGold, stats.goldCollected),
            totalPixelsDestroyed: prev.totalPixelsDestroyed + stats.pixelsDestroyed,
            totalCollapses: prev.totalCollapses + stats.segmentsCollapsed,
            runsCompleted: prev.runsCompleted + 1,
          };
          saveMeta(next);
          return next;
        });
      },
    });

    engineRef.current = engine;
    engine.startLoop();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const parsedSeed = useCallback((): number => {
    const n = parseInt(seedInput.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 482913;
  }, [seedInput]);

  const handleRandomizeSeed = () => {
    const next = randomSeed();
    setSeedInput(String(next));
    if (gameState === 'TITLE_MENU') {
      engineRef.current?.loadTitlePreview(next);
    }
  };

  const handleStartRun = () => {
    enterImmersiveFullscreen();
    engineRef.current?.startNewRun(selectedClass, parsedSeed());
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    sfx.setMuted(next);
  };

  const handleResume = () => {
    enterImmersiveFullscreen();
    engineRef.current?.setState('PLAYING');
  };

  const handlePause = () => {
    engineRef.current?.setState('PAUSED');
  };

  const handleReturnTitle = () => {
    engineRef.current?.loadTitlePreview(parsedSeed());
    engineRef.current?.setState('TITLE_MENU');
  };

  const handlePickUpgrade = (perk: PerkDef) => {
    engineRef.current?.applyPerkAndDescend(perk.id);
  };

  const handlePickRelic = (option: RelicDraftOption) => {
    engineRef.current?.applyRelicAndContinue(option.def.id);
  };

  // Left Thumbstick handlers (moves to thumb in general left zone; X moves, push UP jumps)
  const updateThumbstickFromPoint = (clientX: number, clientY: number) => {
    const { x: cx, y: cy, maxR } = stickCenterRef.current;
    if (maxR <= 0) return;

    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }

    setStickOffset({ x: dx, y: dy });

    const nx = dx / maxR;
    const ny = dy / maxR;
    const moveAxis = Math.abs(nx) < 0.16 ? 0 : nx;
    engineRef.current?.setTouchMove(moveAxis);

    if (ny < -0.42 && !stickJumpActiveRef.current) {
      stickJumpActiveRef.current = true;
      engineRef.current?.setTouchJump(true);
    } else if (ny > -0.28 && stickJumpActiveRef.current) {
      stickJumpActiveRef.current = false;
      engineRef.current?.setTouchJump(false);
    }
  };

  const resetThumbstick = () => {
    stickTouchIdRef.current = null;
    setStickActive(false);
    setStickBaseShift({ x: 0, y: 0 });
    setStickOffset({ x: 0, y: 0 });
    engineRef.current?.setTouchMove(0);
    if (stickJumpActiveRef.current) {
      stickJumpActiveRef.current = false;
      engineRef.current?.setTouchJump(false);
    }
  };

  const handleStickTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (stickTouchIdRef.current !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;

    const anchorEl = stickRestAnchorRef.current;
    const zoneEl = stickZoneRef.current;
    if (!anchorEl || !zoneEl) return;

    const anchorRect = anchorEl.getBoundingClientRect();
    const zoneRect = zoneEl.getBoundingClientRect();
    const restCx = anchorRect.left + anchorRect.width * 0.5;
    const restCy = anchorRect.top + anchorRect.height * 0.5;
    const maxR = anchorRect.width * 0.36;

    const cx = Math.max(zoneRect.left + 20, Math.min(zoneRect.right - 20, t.clientX));
    const cy = Math.max(zoneRect.top + 20, Math.min(window.innerHeight - 20, t.clientY));

    stickTouchIdRef.current = t.identifier;
    stickCenterRef.current = { x: cx, y: cy, maxR };
    setStickBaseShift({ x: cx - restCx, y: cy - restCy });
    setStickActive(true);
    updateThumbstickFromPoint(t.clientX, t.clientY);
  };

  const handleStickTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (stickTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === stickTouchIdRef.current) {
        updateThumbstickFromPoint(t.clientX, t.clientY);
        break;
      }
    }
  };

  const handleStickTouchEnd = (e: ReactTouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === stickTouchIdRef.current) {
        resetThumbstick();
        break;
      }
    }
  };

  // Right Thumbstick handlers (360-degree aiming + firing)
  const updateAimStickFromPoint = (clientX: number, clientY: number) => {
    const el = aimBaseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxR = rect.width * 0.36;

    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }

    setAimOffset({ x: dx, y: dy });
    engineRef.current?.setTouchAim(dx / maxR, dy / maxR, true);
  };

  const resetAimStick = () => {
    aimTouchIdRef.current = null;
    setAimActive(false);
    setAimOffset({ x: 0, y: 0 });
    engineRef.current?.setTouchAim(0, 0, false);
  };

  const handleAimTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (aimTouchIdRef.current !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    aimTouchIdRef.current = t.identifier;
    setAimActive(true);
    updateAimStickFromPoint(t.clientX, t.clientY);
  };

  const handleAimTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (aimTouchIdRef.current === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === aimTouchIdRef.current) {
        updateAimStickFromPoint(t.clientX, t.clientY);
        break;
      }
    }
  };

  const handleAimTouchEnd = (e: ReactTouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === aimTouchIdRef.current) {
        resetAimStick();
        break;
      }
    }
  };

  const handleQuickWeaponSwitch = () => {
    engineRef.current?.cycleWeapon();
    setWeaponFlash(true);
    if (weaponFlashTimerRef.current !== null) {
      window.clearTimeout(weaponFlashTimerRef.current);
    }
    weaponFlashTimerRef.current = window.setTimeout(() => {
      setWeaponFlash(false);
      weaponFlashTimerRef.current = null;
    }, 140);
  };

  useEffect(() => {
    if (gameState !== 'PLAYING' || isPortrait) {
      resetThumbstick();
      resetAimStick();
    }
  }, [gameState, isPortrait]);

  const hpPct = hud ? Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100)) : 100;
  const hpStatus = hpPct > 55 ? 'Stable' : hpPct > 25 ? 'Damaged' : 'Critical';
  const activeWeapon = hud ? hud.weapons[hud.activeWeaponIdx] : null;
  const activeWeaponDupes = hud ? (hud.weaponDupes[hud.activeWeaponIdx] ?? 0) : 0;
  const activePalette = hud?.hudPalette ?? palette;

  return (
    <div className="relative w-screen h-dvh overflow-hidden bg-[#0C0E12] text-[#F4F4F5]">
      {/* Live Per-Pixel Simulation Canvas */}
      <canvas
        ref={canvasRef}
        className={`block w-full h-full pixel-canvas ${gameState === 'PLAYING' ? 'cursor-crosshair' : 'cursor-default'}`}
      />

      {/* Active Gameplay HUD */}
      {gameState === 'PLAYING' && hud && !isPortrait && (
        <div className="pointer-events-none fixed inset-0 flex flex-col justify-between px-3 py-2 sm:p-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-[max(0.5rem,env(safe-area-inset-top))]">
          {/* Top Compact Bar */}
          <div className="flex items-start justify-between gap-2 sm:gap-4">
            {/* Left: Health, Bombs, Dash */}
            <div
              className="pointer-events-auto flex flex-col gap-1 sm:gap-1.5 border rounded-lg px-2.5 py-1.5 sm:px-3.5 sm:py-2.5 min-w-[165px] sm:min-w-[230px] transition-colors duration-300"
              style={{
                backgroundColor: activePalette.panelBg,
                borderColor: activePalette.accentBorder,
              }}
            >
              <div className="flex items-center justify-between gap-3 text-[11px] sm:text-xs">
                <span className="font-semibold text-zinc-200 whitespace-nowrap">
                  HP <span className="font-mono-tabular">{hud.hp}/{hud.maxHp}</span>
                </span>
                <span
                  className={`font-medium whitespace-nowrap ${
                    hpPct > 55 ? 'text-emerald-400' : hpPct > 25 ? 'text-amber-400' : 'text-rose-400'
                  }`}
                >
                  {hpStatus}
                </span>
              </div>
              <div className="w-full h-1.5 sm:h-2 bg-zinc-800 rounded-sm overflow-hidden">
                <div
                  className={`h-full transition-all duration-150 ${
                    hpPct > 55 ? 'bg-emerald-500' : hpPct > 25 ? 'bg-amber-500' : 'bg-rose-500'
                  }`}
                  style={{ width: `${hpPct}%` }}
                />
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs text-zinc-300 font-mono-tabular">
                <span className="whitespace-nowrap">Bombs {hud.bombs}/{hud.maxBombs}</span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span className="whitespace-nowrap">
                  Dash {hud.dashReadyPct >= 1 ? 'Ready' : `${Math.round(hud.dashReadyPct * 100)}%`}
                </span>
              </div>
            </div>

            {/* Center: Depth/Biome/Atmosphere or Active Boss Bar */}
            {hud.boss ? (
              <div
                className="flex flex-col gap-1 border rounded-lg px-2.5 py-1.5 sm:px-3.5 sm:py-2 min-w-[180px] sm:min-w-[290px] max-w-[340px] transition-colors duration-300"
                style={{
                  backgroundColor: activePalette.panelBg,
                  borderColor: activePalette.accentBorder,
                }}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                  <span className="font-semibold text-white truncate">{hud.boss.name}</span>
                  <span
                    className="font-mono-tabular whitespace-nowrap"
                    style={{ color: activePalette.accentSoftHex }}
                  >
                    {hud.boss.hp}/{hud.boss.maxHp}
                  </span>
                </div>
                <div className="w-full h-1.5 sm:h-2 bg-zinc-800 rounded-sm overflow-hidden">
                  <div
                    className="h-full transition-all duration-100"
                    style={{
                      width: `${Math.max(0, Math.min(100, (hud.boss.hp / Math.max(1, hud.boss.maxHp)) * 100))}%`,
                      backgroundColor: activePalette.accentHex,
                    }}
                  />
                </div>
                <div
                  className="flex items-center justify-between gap-2 text-[10px] sm:text-[11px] font-mono-tabular"
                  style={{ color: activePalette.accentSoftHex }}
                >
                  <span className="truncate">{hud.boss.weakSpotName}</span>
                  <span className="whitespace-nowrap">{hud.boss.corePct}%</span>
                </div>
              </div>
            ) : (
              <div
                className="flex items-center gap-1.5 sm:gap-2 border rounded-lg px-2.5 sm:px-3.5 py-1.5 text-[11px] sm:text-xs text-zinc-300 transition-colors duration-300"
                style={{
                  backgroundColor: activePalette.panelBg,
                  borderColor: activePalette.accentBorder,
                }}
              >
                <span
                  className="font-semibold font-mono-tabular whitespace-nowrap"
                  style={{ color: activePalette.accentSoftHex }}
                >
                  Depth {hud.depth}
                </span>
                <span aria-hidden="true" className="text-zinc-600">·</span>
                <span className="whitespace-nowrap truncate max-w-[120px] sm:max-w-none">{hud.biomeName}</span>
                <span aria-hidden="true" className="hidden md:inline text-zinc-600">·</span>
                <span className="hidden md:inline text-zinc-400 whitespace-nowrap">{activePalette.atmosphereTitle}</span>
                <span aria-hidden="true" className="hidden lg:inline text-zinc-600">·</span>
                <span className="hidden lg:inline font-mono-tabular text-zinc-400 whitespace-nowrap">
                  Seed {hud.seed}
                </span>
                <span aria-hidden="true" className="hidden sm:inline text-zinc-600">·</span>
                <span className="hidden sm:inline font-mono-tabular text-zinc-400 whitespace-nowrap">
                  {hud.enemiesRemaining} Hostiles
                </span>
              </div>
            )}

            {/* Right: Gold, Audio & Pause */}
            <div
              className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 border rounded-lg px-2.5 py-1 sm:px-3.5 sm:py-1.5 shrink-0 transition-colors duration-300"
              style={{
                backgroundColor: activePalette.panelBg,
                borderColor: activePalette.accentBorder,
              }}
            >
              <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs pr-1.5 sm:pr-2 border-r border-white/10">
                <span
                  className="font-mono-tabular font-semibold whitespace-nowrap"
                  style={{ color: activePalette.accentSoftHex }}
                >
                  {hud.gold} Gold
                </span>
                <span aria-hidden="true" className="hidden lg:inline text-zinc-600">·</span>
                <span className="hidden lg:inline font-mono-tabular text-zinc-400 whitespace-nowrap">
                  {hud.pixelsDestroyed.toLocaleString()} px
                </span>
                <span aria-hidden="true" className="hidden lg:inline text-zinc-600">·</span>
                <span className="hidden lg:inline font-mono-tabular text-zinc-400 whitespace-nowrap">
                  {hud.segmentsCollapsed} Collapses
                </span>
              </div>
              {!isStandalone && !isIOS && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    toggleFullscreen();
                  }}
                  aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-md text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleToggleMute();
                }}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-md text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  handlePause();
                }}
                aria-label="Pause game"
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-md text-zinc-300 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400"
              >
                <Pause className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Bottom Controls Area */}
          <div className="flex flex-col items-center gap-2 w-full">
            {hud.nearInteractable && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  engineRef.current?.triggerTouchInteract();
                }}
                className="pointer-events-auto relative z-20 min-h-[42px] border rounded-lg px-4 py-1.5 text-xs sm:text-sm font-medium active:scale-[0.98] transition-transform"
                style={{
                  backgroundColor: activePalette.panelBg,
                  borderColor: activePalette.accentHex,
                  color: activePalette.accentSoftHex,
                }}
              >
                {isTouchMode ? hud.nearInteractable.replace('Press F to ', 'Tap to ') : hud.nearInteractable}
              </button>
            )}

            {/* Touch Mode: Left Dynamic Movement Zone + Right Aiming Stick with Bomb, Dash & Quick-React Weapon Switch */}
            {isTouchMode ? (
              <div className="w-full flex items-end justify-end gap-4">
                {/* General Bottom-Left Touch Zone: Pressing anywhere moves the stick to the thumb */}
                <div
                  ref={stickZoneRef}
                  role="application"
                  aria-label="Movement thumbstick zone"
                  onTouchStart={handleStickTouchStart}
                  onTouchMove={handleStickTouchMove}
                  onTouchEnd={handleStickTouchEnd}
                  onTouchCancel={handleStickTouchEnd}
                  className="pointer-events-auto fixed left-0 bottom-0 z-10 w-[44vw] max-w-[240px] h-[46dvh] max-h-[210px] pl-[max(0.75rem,env(safe-area-inset-left))] pb-[max(0.625rem,env(safe-area-inset-bottom))] flex items-end justify-start touch-none"
                >
                  <div ref={stickRestAnchorRef} className="relative w-28 h-28 pointer-events-none">
                    <div
                      className="relative w-28 h-28 rounded-full border transition-colors flex items-center justify-center"
                      style={{
                        transform: `translate3d(${stickBaseShift.x}px, ${stickBaseShift.y}px, 0)`,
                        backgroundColor: stickActive ? activePalette.panelBg : 'rgba(20, 24, 32, 0.55)',
                        borderColor: stickActive ? activePalette.accentHex : activePalette.accentBorder,
                      }}
                    >
                      <ChevronUp className="absolute top-1.5 w-4 h-4 text-zinc-400/75 pointer-events-none" />
                      <div className="w-10 h-10 rounded-full border border-white/10 pointer-events-none" />
                      <div
                        className="absolute w-12 h-12 rounded-full border shadow-lg pointer-events-none transition-colors"
                        style={{
                          transform: `translate3d(${stickOffset.x}px, ${stickOffset.y}px, 0)`,
                          backgroundColor: stickActive ? activePalette.accentHex : 'rgba(212, 212, 216, 0.75)',
                          borderColor: stickActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.4)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Bottom-Right: Quick-React Weapon Button + Rearranged Bomb/Dash + Aiming Thumbstick */}
                <div className="pointer-events-auto relative z-10 flex flex-col items-end gap-2 touch-none">
                  {/* Top of right cluster: Quick-React Weapon Switch Button */}
                  <button
                    type="button"
                    aria-label="Quick switch weapon"
                    onTouchStart={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleQuickWeaponSwitch();
                    }}
                    onClick={(e) => {
                      e.currentTarget.blur();
                      handleQuickWeaponSwitch();
                    }}
                    className={`min-h-[44px] px-3 py-1.5 rounded-xl border flex items-center gap-2 touch-none transition-transform duration-75 ${
                      weaponFlash ? 'scale-95 bg-white/15' : 'active:scale-95'
                    }`}
                    style={{
                      backgroundColor: weaponFlash ? undefined : activePalette.panelBg,
                      borderColor: weaponFlash
                        ? activeWeapon?.color ?? activePalette.accentHex
                        : activePalette.accentBorder,
                    }}
                  >
                    <ArrowLeftRight
                      className="w-4 h-4 shrink-0"
                      style={{ color: activeWeapon?.color ?? '#F4F4F5' }}
                    />
                    <span
                      className="text-xs font-semibold whitespace-nowrap"
                      style={{ color: activeWeapon?.color ?? '#F4F4F5' }}
                    >
                      {activeWeapon?.name ?? 'Weapon'}
                    </span>
                    <span className="text-[10px] font-mono-tabular text-zinc-400 whitespace-nowrap">
                      {activeWeapon ? `${DAMAGE_TYPE_LABELS[activeWeapon.damageType]} · ` : ''}
                      {activeWeaponDupes > 0 ? `+${(activeWeaponDupes * 0.01).toFixed(2)}% · ` : ''}
                      {hud.activeWeaponIdx + 1}/{hud.weapons.length}
                    </span>
                  </button>

                  {/* Bottom row: Bomb + Dash tucked next to Right Aim Thumbstick */}
                  <div className="flex items-end gap-2.5 touch-none">
                    <button
                      type="button"
                      aria-label="Throw bomb"
                      onTouchStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        engineRef.current?.triggerTouchBomb();
                      }}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        engineRef.current?.triggerTouchBomb();
                      }}
                      className={`w-14 h-14 rounded-2xl border flex flex-col items-center justify-center gap-0.5 touch-none transition-transform duration-75 active:scale-95 ${
                        hud.bombs > 0 ? '' : 'text-zinc-500 opacity-70'
                      }`}
                      style={{
                        backgroundColor: hud.bombs > 0 ? activePalette.panelBg : 'rgba(20, 24, 32, 0.6)',
                        borderColor: hud.bombs > 0 ? activePalette.accentBorder : 'rgba(255, 255, 255, 0.1)',
                        color: hud.bombs > 0 ? activePalette.accentSoftHex : undefined,
                      }}
                    >
                      <Bomb className="w-5 h-5" />
                      <span className="text-[10px] font-mono-tabular font-semibold leading-none">
                        {hud.bombs}
                      </span>
                    </button>

                    <button
                      type="button"
                      aria-label="Dash"
                      onTouchStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        engineRef.current?.triggerTouchDash();
                      }}
                      onClick={(e) => {
                        e.currentTarget.blur();
                        engineRef.current?.triggerTouchDash();
                      }}
                      className={`w-14 h-14 rounded-2xl border flex flex-col items-center justify-center gap-0.5 touch-none transition-transform duration-75 active:scale-95 ${
                        hud.dashReadyPct >= 1 ? '' : 'text-zinc-500 opacity-70'
                      }`}
                      style={{
                        backgroundColor: hud.dashReadyPct >= 1 ? activePalette.panelBg : 'rgba(20, 24, 32, 0.6)',
                        borderColor: hud.dashReadyPct >= 1 ? activePalette.accentBorder : 'rgba(255, 255, 255, 0.1)',
                        color: hud.dashReadyPct >= 1 ? activePalette.accentSoftHex : undefined,
                      }}
                    >
                      <Zap className="w-5 h-5" />
                      <span className="text-[10px] font-mono-tabular font-medium leading-none">
                        {hud.dashReadyPct >= 1 ? 'Dash' : `${Math.round(hud.dashReadyPct * 100)}%`}
                      </span>
                    </button>

                    {/* Right Aim & Fire Thumbstick */}
                    <div
                      ref={aimBaseRef}
                      role="application"
                      aria-label="Aiming and fire thumbstick"
                      onTouchStart={handleAimTouchStart}
                      onTouchMove={handleAimTouchMove}
                      onTouchEnd={handleAimTouchEnd}
                      onTouchCancel={handleAimTouchEnd}
                      className="relative w-28 h-28 rounded-full border transition-colors touch-none flex items-center justify-center"
                      style={{
                        backgroundColor: aimActive ? activePalette.panelBg : 'rgba(20, 24, 32, 0.55)',
                        borderColor: aimActive ? activePalette.accentHex : activePalette.accentBorder,
                      }}
                    >
                      <Crosshair className="w-4 h-4 text-zinc-400/60 pointer-events-none" />
                      <div className="absolute w-10 h-10 rounded-full border border-white/10 pointer-events-none" />
                      <div
                        className="absolute w-12 h-12 rounded-full border shadow-lg pointer-events-none transition-colors"
                        style={{
                          transform: `translate3d(${aimOffset.x}px, ${aimOffset.y}px, 0)`,
                          backgroundColor: aimActive ? activePalette.accentHex : 'rgba(212, 212, 216, 0.75)',
                          borderColor: aimActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.4)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Desktop Weapon Switcher Bar */
              <div
                className="pointer-events-auto max-w-full overflow-x-auto flex items-center gap-1.5 border rounded-lg p-1.5 transition-colors duration-300"
                style={{
                  backgroundColor: activePalette.panelBg,
                  borderColor: activePalette.accentBorder,
                }}
              >
                {hud.weapons.map((w, idx) => {
                  const active = idx === hud.activeWeaponIdx;
                  const dupes = hud.weaponDupes[idx] ?? 0;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        engineRef.current?.selectWeapon(idx);
                      }}
                      className={`min-h-[32px] px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-400 ${
                        active ? 'text-zinc-950 font-semibold' : 'text-zinc-300 hover:text-white hover:bg-white/5'
                      }`}
                      style={active ? { backgroundColor: activePalette.accentHex } : undefined}
                    >
                      <span className="font-mono-tabular mr-1.5 opacity-75">{idx + 1}.</span>
                      {w.name}
                      <span
                        className={`ml-1.5 text-[11px] ${active ? 'text-zinc-900/75' : 'text-zinc-400'}`}
                      >
                        · {DAMAGE_TYPE_LABELS[w.damageType]}
                      </span>
                      {dupes > 0 && (
                        <span
                          className={`ml-1.5 font-mono-tabular text-[11px] ${active ? 'text-zinc-900/80' : ''}`}
                          style={active ? undefined : { color: activePalette.accentSoftHex }}
                        >
                          +{(dupes * 0.01).toFixed(2)}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Title Screen Overlay */}
      {gameState === 'TITLE_MENU' && !isPortrait && (
        <div className="fixed inset-0 overflow-y-auto bg-gradient-to-t from-[#0C0E12] via-[#0C0E12]/75 to-[#0C0E12]/45 flex p-3 sm:p-6">
          <div className="m-auto w-full max-w-4xl bg-[#141820]/95 border border-white/10 rounded-xl p-4 sm:p-7 md:p-9 shadow-2xl">
            <div className="flex flex-row items-end justify-between gap-4 pb-4 sm:pb-5 border-b border-white/10">
              <div>
                <h1 className="font-display text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white">
                  Shatterdepth
                </h1>
                <p className="mt-1.5 text-xs sm:text-sm md:text-base text-zinc-300 max-w-xl leading-relaxed">
                  A 2D side-scrolling platforming roguelite where every stone, brick wall, wooden beam,
                  barrel, and decoration is physically simulated per pixel. Sever structural supports to
                  collapse entire wall segments onto enemies below.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!isStandalone && (isInstallable || isIOS) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isInstallable) {
                        void installApp();
                      } else {
                        setShowIOSInstallGuide(true);
                      }
                    }}
                    className="min-h-[42px] flex items-center gap-2 px-3.5 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs font-medium text-amber-200 hover:bg-amber-500/20 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    Install App
                  </button>
                )}
                {!isStandalone && !isIOS && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="min-h-[42px] flex items-center gap-2 px-3.5 py-2 rounded-lg border border-white/10 text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap shrink-0"
                  >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="min-h-[42px] flex items-center gap-2 px-3.5 py-2 rounded-lg border border-white/10 text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap shrink-0"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  {muted ? 'Audio Off' : 'Audio On'}
                </button>
              </div>
            </div>

            {/* Class Selector */}
            <div className="mt-4 sm:mt-5">
              <h2 className="text-xs font-semibold text-zinc-400 tracking-wide mb-2">
                Select Loadout
              </h2>
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                {(Object.keys(CLASSES) as ClassId[]).map((cid) => {
                  const cls = CLASSES[cid];
                  const active = selectedClass === cid;
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => setSelectedClass(cid)}
                      className={`text-left p-3 sm:p-4 rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                        active ? 'text-white' : 'bg-[#0C0E12]/60 border-white/10 text-zinc-300 hover:border-white/25'
                      }`}
                      style={
                        active
                          ? {
                              backgroundColor: activePalette.accentGlow,
                              borderColor: activePalette.accentHex,
                            }
                          : undefined
                      }
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <span className="font-semibold text-xs sm:text-sm text-white">{cls.name}</span>
                        <span className="font-mono-tabular text-[11px] sm:text-xs text-zinc-400">
                          {cls.maxHp} HP · {cls.maxBombs} Bombs
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] sm:text-xs text-zinc-400 leading-relaxed line-clamp-2 sm:line-clamp-none">
                        {cls.summary}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Seed & Controls */}
            <div className="mt-4 sm:mt-5 pt-4 sm:pt-5 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 items-end">
              <div>
                <label htmlFor="world-seed" className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Procedural World Seed
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="world-seed"
                    type="text"
                    inputMode="numeric"
                    value={seedInput}
                    onChange={(e) => setSeedInput(e.target.value)}
                    className="w-32 sm:w-40 min-h-[40px] bg-[#0C0E12] border border-white/15 rounded-lg px-3 py-1.5 text-sm font-mono-tabular text-white focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={handleRandomizeSeed}
                    className="min-h-[40px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    New Seed
                  </button>
                </div>
                <p className="mt-2 text-[11px] sm:text-xs text-zinc-400 leading-relaxed">
                  {isTouchMode
                    ? 'Left stick: Move & push up to jump · Right stick: Aim & fire · Quick buttons: Weapon, Bomb, Dash'
                    : 'Move: A / D · Jump: Space / W · Dash: Shift · Aim & Fire: Left Click · Bomb: Right Click / E · Switch Weapon: 1–3 / Scroll · Interact: F'}
                </p>
              </div>

              <div className="flex flex-row justify-end items-center gap-4">
                {meta.bestDepth > 0 && (
                  <div className="text-xs text-zinc-400 font-mono-tabular">
                    Best Depth {meta.bestDepth} · {meta.totalCollapses} Collapses
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleStartRun}
                  className="min-h-[46px] px-6 py-2.5 rounded-lg text-zinc-950 font-semibold text-sm transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-white"
                  style={{ backgroundColor: activePalette.accentHex }}
                >
                  Start Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {gameState === 'PAUSED' && !isPortrait && (
        <div className="fixed inset-0 overflow-y-auto bg-black/70 flex p-4 sm:p-6">
          <div
            className="m-auto w-full max-w-md bg-[#141820] border rounded-xl p-5 sm:p-7"
            style={{ borderColor: activePalette.accentBorder }}
          >
            <h2 className="font-display text-3xl font-bold text-white">Run Paused</h2>
            <p className="mt-1 text-xs text-zinc-400 font-mono-tabular">
              {hud ? `Depth ${hud.depth} · ${hud.biomeName} · ${activePalette.atmosphereTitle} · Seed ${hud.seed}` : ''}
            </p>
            {hud && hud.relics.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="text-xs font-semibold text-zinc-400 mb-2">Bound Boss Relics</div>
                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {hud.relics.map((rel, idx) => (
                    <div key={`${rel.def.id}-${idx}`} className="text-xs text-zinc-200">
                      <span className="font-medium" style={{ color: rel.def.accentColor }}>
                        {rel.def.name}
                      </span>
                      <span className="font-mono-tabular text-zinc-400"> Rank {rel.level}</span>
                      <span className="text-zinc-500"> — {rel.def.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {hud && hud.perks.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="text-xs font-semibold text-zinc-400 mb-2">Active Upgrades</div>
                <div className="space-y-1.5 max-h-28 overflow-y-auto">
                  {hud.perks.map((pk, idx) => (
                    <div key={`${pk.id}-${idx}`} className="text-xs text-zinc-200">
                      <span className="font-medium" style={{ color: activePalette.accentSoftHex }}>
                        {pk.name}
                      </span>
                      <span className="text-zinc-500"> — {pk.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handleResume}
                className="min-h-[44px] flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-zinc-950 font-semibold text-sm transition-opacity hover:opacity-90 whitespace-nowrap"
                style={{ backgroundColor: activePalette.accentHex }}
              >
                <Play className="w-4 h-4" />
                Resume
              </button>
              <button
                type="button"
                onClick={handleReturnTitle}
                className="min-h-[44px] px-4 py-2.5 rounded-lg border border-white/15 text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap"
              >
                Quit Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Depth Cleared — Upgrade Selection Modal */}
      {gameState === 'LEVEL_UPGRADE' && !isPortrait && (
        <div className="fixed inset-0 overflow-y-auto bg-black/75 flex p-4 sm:p-6">
          <div
            className="m-auto w-full max-w-3xl bg-[#141820] border rounded-xl p-5 sm:p-7"
            style={{ borderColor: activePalette.accentBorder }}
          >
            <div className="flex flex-row items-baseline justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
                  Depth {hud?.depth ?? 1} Cleared
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-zinc-400">
                  Choose one upgrade before descending into Depth {(hud?.depth ?? 1) + 1}.
                </p>
              </div>
              <span
                className="text-xs font-mono-tabular whitespace-nowrap"
                style={{ color: activePalette.accentSoftHex }}
              >
                +15 HP Restored
              </span>
            </div>

            <div className="mt-4 sm:mt-5 grid grid-cols-3 gap-3 sm:gap-4">
              {upgradeChoices.map((perk) => (
                <button
                  key={perk.id}
                  type="button"
                  onClick={() => handlePickUpgrade(perk)}
                  className="text-left p-3.5 sm:p-5 rounded-lg bg-[#0C0E12] border border-white/10 hover:border-white/40 transition-colors flex flex-col justify-between gap-3 focus-visible:outline-2 focus-visible:outline-amber-400"
                >
                  <div>
                    <div
                      className="text-[11px] sm:text-xs font-medium"
                      style={{ color: activePalette.accentSoftHex }}
                    >
                      {perk.category}
                    </div>
                    <h3 className="mt-1 text-sm sm:text-base font-semibold text-white">{perk.name}</h3>
                    <p className="mt-1.5 text-[11px] sm:text-xs text-zinc-400 leading-relaxed">{perk.description}</p>
                  </div>
                  <span className="text-xs font-semibold" style={{ color: activePalette.accentSoftHex }}>
                    Select Upgrade
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Boss Defeated — Special Build-Focusing Relic Modal */}
      {gameState === 'BOSS_RELIC' && !isPortrait && (
        <div className="fixed inset-0 overflow-y-auto bg-black/80 flex p-4 sm:p-6">
          <div
            className="m-auto w-full max-w-3xl bg-[#141820] border rounded-xl p-5 sm:p-7 shadow-2xl"
            style={{ borderColor: activePalette.accentBorder }}
          >
            <div className="flex flex-row items-baseline justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
                  Guardian Shattered
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-zinc-400">
                  Portal unlocked on Depth {hud?.depth ?? 10}. Bind one Boss Relic to focus your build.
                </p>
              </div>
              <span className="text-xs font-mono-tabular text-emerald-300 whitespace-nowrap">
                +25 HP · Portal Open
              </span>
            </div>

            <div className="mt-4 sm:mt-5 grid grid-cols-3 gap-3 sm:gap-4">
              {bossRelicChoices.map((opt) => {
                const relic = opt.def;
                const isUpgrade = opt.currentLevel > 0;
                return (
                  <button
                    key={relic.id}
                    type="button"
                    onClick={() => handlePickRelic(opt)}
                    className="text-left p-3.5 sm:p-5 rounded-lg bg-[#0C0E12] border border-white/15 hover:border-amber-400 transition-colors flex flex-col justify-between gap-3 focus-visible:outline-2 focus-visible:outline-amber-400"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-semibold">
                        <span style={{ color: relic.accentColor }}>{relic.buildFocus}</span>
                        <span className="font-mono-tabular text-zinc-400 whitespace-nowrap">
                          {isUpgrade ? `Rank ${opt.currentLevel} -> ${opt.nextLevel}` : 'Rank 1'}
                        </span>
                      </div>
                      <h3 className="mt-1 text-sm sm:text-base font-semibold text-white">{relic.name}</h3>
                      <p className="mt-1.5 text-[11px] sm:text-xs text-zinc-400 leading-relaxed">{relic.description}</p>
                    </div>
                    <span className="text-xs font-semibold text-amber-300">
                      {isUpgrade ? `Upgrade to Rank ${opt.nextLevel}` : 'Claim Relic'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Game Over Summary */}
      {gameState === 'GAME_OVER' && gameOverStats && !isPortrait && (
        <div className="fixed inset-0 overflow-y-auto bg-black/80 flex p-4 sm:p-6">
          <div className="m-auto w-full max-w-lg bg-[#141820] border border-white/10 rounded-xl p-5 sm:p-8">
            <h2 className="font-display text-3xl sm:text-4xl font-bold text-white">Expedition Ended</h2>
            <p className="mt-1 text-xs sm:text-sm text-zinc-400">
              Fallen on Depth {gameOverStats.depth} · {gameOverStats.biomeName} · Seed {gameOverStats.seed}
            </p>

            <div className="mt-5 grid grid-cols-2 gap-4 py-4 border-y border-white/10 text-sm">
              <div>
                <div className="text-xs text-zinc-400">Pixels Destroyed</div>
                <div className="mt-1 font-mono-tabular text-lg sm:text-xl font-semibold text-white">
                  {gameOverStats.pixelsDestroyed.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">Wall Segments Collapsed</div>
                <div className="mt-1 font-mono-tabular text-lg sm:text-xl font-semibold text-amber-400">
                  {gameOverStats.segmentsCollapsed}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">Hostiles Defeated</div>
                <div className="mt-1 font-mono-tabular text-lg sm:text-xl font-semibold text-white">
                  {gameOverStats.kills}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-400">Gold Collected</div>
                <div className="mt-1 font-mono-tabular text-lg sm:text-xl font-semibold text-amber-300">
                  {gameOverStats.goldCollected}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={handleStartRun}
                className="min-h-[44px] flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-sm transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                Play Again
              </button>
              <button
                type="button"
                onClick={handleReturnTitle}
                className="min-h-[44px] px-4 py-2.5 rounded-lg border border-white/15 text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap"
              >
                Title Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS Home Screen Fullscreen Guide Modal */}
      {showIOSInstallGuide && (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-md bg-[#141820] border border-white/10 rounded-xl p-5 sm:p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-white">Launch Fullscreen on iOS</h2>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  iOS hides the Safari address bar and bottom controls when launched from your Home Screen.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close guide"
                onClick={() => setShowIOSInstallGuide(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ol className="mt-4 space-y-2.5 text-xs sm:text-sm text-zinc-200 border-t border-white/10 pt-4">
              <li className="flex items-center gap-2.5">
                <span className="font-mono-tabular text-amber-400 font-semibold">1.</span>
                <span>
                  Tap the <Share className="inline w-3.5 h-3.5 mx-0.5 text-amber-300" /> Share button in Safari.
                </span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="font-mono-tabular text-amber-400 font-semibold">2.</span>
                <span>
                  Choose <span className="font-semibold text-white">Add to Home Screen</span>, then open Shatterdepth.
                </span>
              </li>
            </ol>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowIOSInstallGuide(false)}
                className="min-h-[40px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold text-xs sm:text-sm transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Landscape Mode Enforcement Overlay */}
      {isPortrait && (
        <div className="fixed inset-0 z-50 bg-[#0C0E12]/95 flex items-center justify-center p-6 text-center">
          <div className="max-w-xs bg-[#141820] border border-white/10 rounded-xl p-6 flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <RotateCw className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-white">Rotate to Landscape</h2>
              <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                Shatterdepth plays in landscape mode. Rotate your screen horizontally to continue.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
