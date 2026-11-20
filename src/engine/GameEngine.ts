import { BOSS_RELICS, CLASSES, LOOTABLE_WEAPONS, PERKS, WEAPONS } from './catalog';
import { generateLevel } from './LevelGenerator';
import { PixelWorld } from './PixelWorld';
import { packColor } from './prng';
import { sfx } from './SoundFX';
import {
  BiomeConfig,
  ClassId,
  DamageType,
  Enemy,
  GameState,
  HudPalette,
  HudSnapshot,
  MAT_PROPS,
  Mat,
  PerkDef,
  PerkId,
  Pickup,
  PixelBoss,
  Player,
  Portal,
  Projectile,
  RelicDraftOption,
  RelicId,
  RelicPedestal,
  RunStats,
  WORLD_H,
  WORLD_W,
  WeaponId,
} from './types';

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
}

interface BeamFlash {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  life: number;
}

interface ShockRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface EngineCallbacks {
  onStateChange: (state: GameState) => void;
  onHudUpdate: (hud: HudSnapshot) => void;
  onPaletteChange?: (palette: HudPalette) => void;
  onUpgradeChoices: (choices: PerkDef[]) => void;
  onBossRelicChoices: (choices: RelicDraftOption[]) => void;
  onGameOver: (stats: RunStats) => void;
}

const GRAVITY = 420;

export class GameEngine {
  readonly world = new PixelWorld();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: EngineCallbacks;

  private state: GameState = 'TITLE_MENU';
  private rafId = 0;
  private lastTime = 0;
  private hudTimer = 0;

  // Level & run state
  private seed = 482913;
  private depth = 1;
  private biome!: BiomeConfig;
  private player!: Player;
  private enemies: Enemy[] = [];
  private boss: PixelBoss | null = null;
  private bossCanvas: HTMLCanvasElement = document.createElement('canvas');
  private bossRelicPendingTimer = 0;
  private projectiles: Projectile[] = [];
  private pickups: Pickup[] = [];
  private pedestals: RelicPedestal[] = [];
  private portal!: Portal;
  private floatingTexts: FloatingText[] = [];
  private beamFlashes: BeamFlash[] = [];
  private shockRings: ShockRing[] = [];
  private nextId = 1000;

  // Stats
  private kills = 0;
  private elapsedSeconds = 0;
  private playerSpeedMul = 1.0;
  private dashCount = 0;
  private collapseHealCooldown = 0;

  // Camera
  private camX = 0;
  private camY = 0;
  private viewSimW = 400;
  private viewSimH = 225;
  private shakeMag = 0;
  private demoPanDir = 1;

  // Input
  private keys = new Set<string>();
  private mouseScreenX = 0;
  private mouseScreenY = 0;
  private hasPointerMoved = false;
  private mouseDownLeft = false;
  private mouseDownRight = false;
  private touchMoveAxis = 0;
  private touchAimActive = false;
  private touchAimFiring = false;
  private touchAimAngle = 0;
  private touchAimHoldTimer = 0;

  // Bound event listeners
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;
  private onMouseMoveBound: (e: MouseEvent) => void;
  private onMouseDownBound: (e: MouseEvent) => void;
  private onMouseUpBound: (e: MouseEvent) => void;
  private onTouchStartBound: (e: TouchEvent) => void;
  private onTouchMoveBound: (e: TouchEvent) => void;
  private onTouchEndBound: (e: TouchEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;
  private onContextMenuBound: (e: MouseEvent) => void;
  private onResizeBound: () => void;

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not initialize 2D context');
    this.ctx = ctx;
    this.callbacks = callbacks;

    this.onKeyDownBound = this.handleKeyDown.bind(this);
    this.onKeyUpBound = this.handleKeyUp.bind(this);
    this.onMouseMoveBound = this.handleMouseMove.bind(this);
    this.onMouseDownBound = this.handleMouseDown.bind(this);
    this.onMouseUpBound = this.handleMouseUp.bind(this);
    this.onTouchStartBound = this.handleTouchStart.bind(this);
    this.onTouchMoveBound = this.handleTouchMove.bind(this);
    this.onTouchEndBound = this.handleTouchEnd.bind(this);
    this.onWheelBound = this.handleWheel.bind(this);
    this.onContextMenuBound = (e) => e.preventDefault();
    this.onResizeBound = this.handleResize.bind(this);

    window.addEventListener('keydown', this.onKeyDownBound);
    window.addEventListener('keyup', this.onKeyUpBound);
    window.addEventListener('mousemove', this.onMouseMoveBound);
    canvas.addEventListener('mousedown', this.onMouseDownBound);
    window.addEventListener('mouseup', this.onMouseUpBound);
    canvas.addEventListener('touchstart', this.onTouchStartBound, { passive: false });
    canvas.addEventListener('touchmove', this.onTouchMoveBound, { passive: false });
    window.addEventListener('touchend', this.onTouchEndBound);
    window.addEventListener('touchcancel', this.onTouchEndBound);
    canvas.addEventListener('wheel', this.onWheelBound, { passive: true });
    canvas.addEventListener('contextmenu', this.onContextMenuBound);
    window.addEventListener('resize', this.onResizeBound);
    window.addEventListener('orientationchange', this.onResizeBound);
    window.visualViewport?.addEventListener('resize', this.onResizeBound);

    this.handleResize();
    this.loadTitlePreview(this.seed);
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.onKeyDownBound);
    window.removeEventListener('keyup', this.onKeyUpBound);
    window.removeEventListener('mousemove', this.onMouseMoveBound);
    this.canvas.removeEventListener('mousedown', this.onMouseDownBound);
    window.removeEventListener('mouseup', this.onMouseUpBound);
    this.canvas.removeEventListener('touchstart', this.onTouchStartBound);
    this.canvas.removeEventListener('touchmove', this.onTouchMoveBound);
    window.removeEventListener('touchend', this.onTouchEndBound);
    window.removeEventListener('touchcancel', this.onTouchEndBound);
    this.canvas.removeEventListener('wheel', this.onWheelBound);
    this.canvas.removeEventListener('contextmenu', this.onContextMenuBound);
    window.removeEventListener('resize', this.onResizeBound);
    window.removeEventListener('orientationchange', this.onResizeBound);
    window.visualViewport?.removeEventListener('resize', this.onResizeBound);
  }

  startLoop(): void {
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(0.033, Math.max(0.001, rawDt));
      this.update(dt);
      this.render();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  loadTitlePreview(seed: number): void {
    this.seed = seed;
    this.depth = 1;
    const lvl = generateLevel(this.world, this.seed, 1);
    this.biome = lvl.biome;
    this.enemies = lvl.enemies;
    this.boss = null;
    this.pedestals = lvl.pedestals;
    this.portal = lvl.portal;
    this.pickups = [];
    this.projectiles = [];
    this.camX = 120;
    this.camY = Math.max(0, Math.min(WORLD_H - this.viewSimH, lvl.spawnY - this.viewSimH * 0.5));
    this.callbacks.onPaletteChange?.(this.biome.hudPalette);
  }

  startNewRun(classId: ClassId, seed: number): void {
    sfx.unlock();
    const cls = CLASSES[classId];
    this.seed = seed;
    this.depth = 1;
    this.kills = 0;
    this.elapsedSeconds = 0;
    this.dashCount = 0;
    this.collapseHealCooldown = 0;
    this.playerSpeedMul = cls.speedMul;
    this.world.pixelsDestroyedCount = 0;
    this.world.segmentsCollapsedCount = 0;

    this.player = {
      x: 60,
      y: 120,
      vx: 0,
      vy: 0,
      w: 8,
      h: 15,
      hp: cls.maxHp,
      maxHp: cls.maxHp,
      facing: 1,
      aimAngle: 0,
      grounded: false,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      jumpsRemaining: 0,
      maxAirJumps: 0,
      dashTimer: 0,
      dashCooldown: 0,
      invulnTimer: 0,
      weapons: [cls.primaryWeapon, cls.secondaryWeapon],
      weaponDupes: {},
      activeWeaponIdx: 0,
      fireCooldown: 0,
      bombs: cls.maxBombs,
      maxBombs: cls.maxBombs,
      bombRechargeTimer: 0,
      gold: 0,
      perks: [],
      relics: [],
      relicLevels: {},
    };

    this.loadDepth(1);
    this.setState('PLAYING');
  }

  private loadDepth(depth: number): void {
    this.depth = depth;
    const lvl = generateLevel(this.world, this.seed, depth);
    this.biome = lvl.biome;
    this.enemies = lvl.enemies;
    this.boss = lvl.boss;
    this.bossRelicPendingTimer = 0;
    if (this.boss) {
      this.bossCanvas.width = this.boss.w;
      this.bossCanvas.height = this.boss.h;
    }
    this.pickups = lvl.pickups;
    this.pedestals = lvl.pedestals;
    this.portal = lvl.portal;
    this.projectiles = [];
    this.floatingTexts = [];
    this.beamFlashes = [];
    this.shockRings = [];

    this.player.x = lvl.spawnX;
    this.player.y = lvl.spawnY;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.invulnTimer = 1.0;

    this.camX = Math.max(0, Math.min(WORLD_W - this.viewSimW, this.player.x - this.viewSimW * 0.35));
    this.camY = Math.max(0, Math.min(WORLD_H - this.viewSimH, this.player.y - this.viewSimH * 0.55));
    this.callbacks.onPaletteChange?.(this.biome.hudPalette);
    this.emitHud();
  }

  setState(newState: GameState): void {
    this.state = newState;
    this.mouseDownLeft = false;
    this.mouseDownRight = false;
    this.touchMoveAxis = 0;
    this.touchAimActive = false;
    this.touchAimFiring = false;
    this.touchAimHoldTimer = 0;
    this.callbacks.onStateChange(newState);
  }

  setTouchMove(axis: number): void {
    this.touchMoveAxis = Math.max(-1, Math.min(1, axis));
  }

  setTouchAim(dx: number, dy: number, active: boolean): void {
    if (active) {
      sfx.unlock();
      this.touchAimActive = true;
      const mag = Math.hypot(dx, dy);
      if (mag > 0.12) {
        this.touchAimAngle = Math.atan2(dy, dx);
        this.touchAimHoldTimer = 1.4;
        this.hasPointerMoved = false;
      }
      this.touchAimFiring = mag > 0.24;
    } else {
      this.touchAimActive = false;
      this.touchAimFiring = false;
    }
  }

  setTouchJump(pressed: boolean): void {
    sfx.unlock();
    if (this.state !== 'PLAYING' || !this.player) return;
    if (pressed) {
      this.player.jumpBufferTimer = 0.14;
    } else if (this.player.vy < -75) {
      this.player.vy *= 0.55;
    }
  }

  triggerTouchDash(): void {
    sfx.unlock();
    if (this.state === 'PLAYING' && this.player) {
      this.tryDash();
    }
  }

  triggerTouchBomb(): void {
    sfx.unlock();
    if (this.state === 'PLAYING' && this.player) {
      this.tryThrowBomb();
    }
  }

  triggerTouchInteract(): void {
    sfx.unlock();
    if (this.state === 'PLAYING' && this.player) {
      this.tryInteract();
    }
  }

  cycleWeapon(): void {
    sfx.unlock();
    if (!this.player || this.player.weapons.length <= 1) return;
    this.player.activeWeaponIdx = (this.player.activeWeaponIdx + 1) % this.player.weapons.length;
    this.emitHud();
  }

  selectWeapon(idx: number): void {
    if (!this.player) return;
    if (idx >= 0 && idx < this.player.weapons.length) {
      this.player.activeWeaponIdx = idx;
      this.emitHud();
    }
  }

  applyPerkAndDescend(perkId: PerkId): void {
    sfx.playPickup('upgrade');
    this.player.perks.push(perkId);
    if (perkId === 'TITAN_PLATING') {
      this.player.maxHp += 35;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 35);
    } else if (perkId === 'DEMOLITIONIST') {
      this.player.maxBombs += 2;
      this.player.bombs = Math.min(this.player.maxBombs, this.player.bombs + 2);
    } else if (perkId === 'TWIN_THRUSTERS') {
      this.player.maxAirJumps += 1;
    }
    // Small depth recovery
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 15);
    this.loadDepth(this.depth + 1);
    this.setState('PLAYING');
  }

  applyRelicAndContinue(relicId: RelicId): void {
    sfx.playPickup('upgrade');
    const nextLv = (this.player.relicLevels[relicId] ?? 0) + 1;
    this.player.relicLevels[relicId] = nextLv;
    if (!this.player.relics.includes(relicId)) {
      this.player.relics.push(relicId);
    }
    if (relicId === 'SIEGE_HEART') {
      this.player.maxBombs += 1;
      this.player.bombs = Math.min(this.player.maxBombs, this.player.bombs + 1);
    } else if (relicId === 'SALVAGE_MAGNET') {
      this.player.maxHp += 45;
      this.player.hp = this.player.maxHp;
    } else if (relicId === 'CHRONO_THRUSTER') {
      this.playerSpeedMul *= nextLv === 1 ? 1.2 : 1.1;
    }
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
    const label = nextLv > 1 ? `${BOSS_RELICS[relicId].name} Rank ${nextLv}` : BOSS_RELICS[relicId].name;
    this.spawnFloatingText(this.player.x, this.player.y - 18, label, BOSS_RELICS[relicId].accentColor);
    this.setState('PLAYING');
    this.emitHud();
  }

  private getRelicLevel(id: RelicId): number {
    return this.player?.relicLevels[id] ?? 0;
  }

  private hasRelic(id: RelicId): boolean {
    return this.getRelicLevel(id) > 0;
  }

  private hasPerk(id: PerkId): boolean {
    return this.player.perks.includes(id);
  }

  private countPerk(id: PerkId): number {
    let c = 0;
    for (const p of this.player.perks) if (p === id) c++;
    return c;
  }

  private handleResize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(200, Math.round(rect.width || window.innerWidth));
    const h = Math.max(200, Math.round(rect.height || window.innerHeight));
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;

    const aspect = w / h;
    if (aspect >= 1) {
      // Landscape (desktop, tablet, or landscape phone): keep square pixels
      const targetH = h < 500 ? 170 : 216;
      this.viewSimH = Math.min(WORLD_H, targetH);
      this.viewSimW = Math.min(WORLD_W, Math.round(this.viewSimH * aspect));
      if (this.viewSimW >= WORLD_W) {
        this.viewSimW = WORLD_W;
        this.viewSimH = Math.min(WORLD_H, Math.round(this.viewSimW / aspect));
      }
    } else {
      // Portrait phone: target comfortable horizontal width while maintaining 1:1 square pixels
      const targetW = 192;
      const rawH = Math.round(targetW / aspect);
      this.viewSimH = Math.min(WORLD_H, rawH);
      this.viewSimW = Math.min(WORLD_W, Math.round(this.viewSimH * aspect));
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const code = e.code;

    if (code === 'Escape') {
      if (this.state === 'PLAYING') {
        this.setState('PAUSED');
      } else if (this.state === 'PAUSED') {
        this.setState('PLAYING');
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    if (code === 'Space' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight') {
      e.preventDefault();
    }

    if (code === 'Space' || code === 'KeyW' || code === 'ArrowUp') {
      this.player.jumpBufferTimer = 0.14;
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      this.tryDash();
    }
    if (code === 'KeyE' || code === 'KeyQ') {
      this.tryThrowBomb();
    }
    if (code === 'Digit1') this.selectWeapon(0);
    if (code === 'Digit2') this.selectWeapon(1);
    if (code === 'Digit3') this.selectWeapon(2);
    if (code === 'KeyF') {
      this.tryInteract();
    }

    this.keys.add(code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    // Variable jump height cut
    if (
      this.state === 'PLAYING' &&
      (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') &&
      this.player.vy < -75
    ) {
      this.player.vy *= 0.55;
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreenX = e.clientX - rect.left;
    this.mouseScreenY = e.clientY - rect.top;
    this.hasPointerMoved = true;
  }

  private handleMouseDown(e: MouseEvent): void {
    sfx.unlock();
    if (this.state !== 'PLAYING') return;
    if (e.button === 0) {
      this.mouseDownLeft = true;
    } else if (e.button === 2) {
      this.mouseDownRight = true;
      this.tryThrowBomb();
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    if (e.button === 0) this.mouseDownLeft = false;
    if (e.button === 2) this.mouseDownRight = false;
  }

  private handleTouchStart(e: TouchEvent): void {
    sfx.unlock();
    if (this.state !== 'PLAYING') return;
    e.preventDefault();
  }

  private handleTouchMove(e: TouchEvent): void {
    if (this.state !== 'PLAYING') return;
    e.preventDefault();
  }

  private handleTouchEnd(_e: TouchEvent): void {
    // Touch aiming and firing are handled by the right thumbstick
  }

  private handleWheel(e: WheelEvent): void {
    if (this.state !== 'PLAYING' || !this.player) return;
    const len = this.player.weapons.length;
    if (len <= 1) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    this.player.activeWeaponIdx = (this.player.activeWeaponIdx + dir + len) % len;
    this.emitHud();
  }

  private getMouseWorld(): { x: number; y: number } {
    const wx = this.camX + (this.mouseScreenX / Math.max(1, this.canvas.width)) * this.viewSimW;
    const wy = this.camY + (this.mouseScreenY / Math.max(1, this.canvas.height)) * this.viewSimH;
    return { x: wx, y: wy };
  }

  private update(dt: number): void {
    if (this.state === 'TITLE_MENU') {
      this.world.step(dt);
      this.camX += this.demoPanDir * 14 * dt;
      if (this.camX > WORLD_W - this.viewSimW - 40) this.demoPanDir = -1;
      if (this.camX < 40) this.demoPanDir = 1;
      return;
    }

    if (this.state !== 'PLAYING') return;

    this.elapsedSeconds += dt;
    this.collapseHealCooldown = Math.max(0, this.collapseHealCooldown - dt);

    if (this.bossRelicPendingTimer > 0) {
      this.bossRelicPendingTimer -= dt;
      if (this.bossRelicPendingTimer <= 0 && !this.boss) {
        this.openBossRelicChoice();
        return;
      }
    }

    // Step pixel world (CA, falling particles, rotating crumbling wall segments!)
    this.world.step(dt);

    // Spawn collectible gold shards from mined GOLD veins & smashed JARs
    const goldDrops = this.world.consumeGoldDrops();
    for (const g of goldDrops) {
      this.pickups.push({
        id: this.nextId++,
        kind: 'GOLD',
        x: g.x,
        y: g.y,
        vx: (Math.random() - 0.5) * 65,
        vy: -55 - Math.random() * 45,
        value: 2,
        age: 0,
      });
    }

    // Apply crushing hits from falling CrumblingBody segments!
    const crushHits = this.world.consumeCrushHits();
    if (crushHits.length > 0) {
      const saboteurMul = this.hasPerk('STRUCTURAL_SABOTEUR') ? 2.0 : 1.0;
      const siegeLv = this.getRelicLevel('SIEGE_HEART');
      if (siegeLv > 0 && this.collapseHealCooldown <= 0) {
        this.collapseHealCooldown = 1.2;
        const healAmt = 8 * siegeLv;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + healAmt);
        this.spawnFloatingText(this.player.x, this.player.y - this.player.h - 6, `+${healAmt} HP`, '#F59E0B');
      }
      for (const hit of crushHits) {
        this.shakeMag = Math.max(this.shakeMag, 3.2);
        if (siegeLv > 0) {
          const hx = hit.x + hit.w * 0.5;
          const hy = hit.y + hit.h * 0.5;
          this.spawnShockRing(hx, hy, 20 + (siegeLv - 1) * 6, '#F59E0B');
        }
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          const en = this.enemies[i];
          if (
            en.x + en.w * 0.5 >= hit.x &&
            en.x - en.w * 0.5 <= hit.x + hit.w &&
            en.y + en.h * 0.5 >= hit.y &&
            en.y - en.h * 0.5 <= hit.y + hit.h
          ) {
            this.damageEnemy(en, Math.round(hit.damage * saboteurMul), true);
          }
        }
        if (this.boss) {
          const bx0 = this.boss.x - this.boss.w * 0.5;
          const by0 = this.boss.y - this.boss.h;
          if (
            hit.x + hit.w >= bx0 &&
            hit.x <= bx0 + this.boss.w &&
            hit.y + hit.h >= by0 &&
            hit.y <= this.boss.y
          ) {
            const cx = Math.max(bx0, Math.min(bx0 + this.boss.w, hit.x + hit.w * 0.5));
            const cy = Math.max(by0, Math.min(this.boss.y, hit.y + hit.h * 0.5));
            this.damageBossAtWorld(cx, cy, 10, 7, Math.round(hit.damage * saboteurMul), 'EXPLOSIVE', false, false);
          }
        }
      }
    }

    this.updatePlayer(dt);
    this.updateWeapons(dt);
    this.updateProjectiles(dt);
    this.updateEnemies(dt);
    this.updateBoss(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);

    this.hudTimer += dt;
    if (this.hudTimer >= 0.08) {
      this.hudTimer = 0;
      this.emitHud();
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    p.invulnTimer = Math.max(0, p.invulnTimer - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.coyoteTimer = Math.max(0, p.coyoteTimer - dt);
    p.jumpBufferTimer = Math.max(0, p.jumpBufferTimer - dt);

    // Bomb recharge
    if (p.bombs < p.maxBombs) {
      const rechargeDur = this.hasPerk('DEMOLITIONIST') ? 4.8 : 7.5;
      p.bombRechargeTimer += dt;
      if (p.bombRechargeTimer >= rechargeDur) {
        p.bombRechargeTimer = 0;
        p.bombs++;
      }
    } else {
      p.bombRechargeTimer = 0;
    }

    // Horizontal input (keyboard + analog left thumbstick)
    const keyLeft = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const keyRight = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const keyDir = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
    const moveDir = keyDir !== 0 ? keyDir : this.touchMoveAxis;

    if (!this.touchAimActive && this.touchAimHoldTimer > 0) {
      this.touchAimHoldTimer = Math.max(0, this.touchAimHoldTimer - dt);
    }

    // Aim angle (right thumbstick > mouse pointer > movement facing)
    if (this.touchAimActive || this.touchAimHoldTimer > 0) {
      p.aimAngle = this.touchAimAngle;
      p.facing = Math.cos(this.touchAimAngle) >= 0 ? 1 : -1;
    } else if (this.hasPointerMoved) {
      const mw = this.getMouseWorld();
      const aimDx = mw.x - p.x;
      const aimDy = mw.y - (p.y - p.h * 0.45);
      p.aimAngle = Math.atan2(aimDy, aimDx);
      p.facing = aimDx >= 0 ? 1 : -1;
    } else {
      if (Math.abs(moveDir) > 0.2) p.facing = moveDir > 0 ? 1 : -1;
      p.aimAngle = p.facing >= 0 ? 0 : Math.PI;
    }

    const maxRunSpeed = 108 * this.playerSpeedMul;
    if (p.dashTimer > 0) {
      // Thruster sparks during dash
      this.world.spawnParticle(
        p.x - p.facing * 4,
        p.y - p.h * 0.4 + (Math.random() - 0.5) * 4,
        -p.facing * 60 + (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 25,
        Mat.EMBER,
        packColor(255, 190, 60),
        0.35,
        false
      );
    } else {
      const targetVx = moveDir * maxRunSpeed;
      const accel = p.grounded ? 920 : 620;
      if (p.vx < targetVx) {
        p.vx = Math.min(targetVx, p.vx + accel * dt);
      } else if (p.vx > targetVx) {
        p.vx = Math.max(targetVx, p.vx - accel * dt);
      }
    }

    // Water buoyancy check
    const bodyMat = this.world.getMat(Math.round(p.x), Math.round(p.y - 4));
    const inLiquid = bodyMat === Mat.WATER || bodyMat === Mat.OIL || bodyMat === Mat.ACID;

    if (p.dashTimer <= 0) {
      p.vy += (inLiquid ? GRAVITY * 0.42 : GRAVITY) * dt;
      if (p.vy > (inLiquid ? 95 : 270)) p.vy = inLiquid ? 95 : 270;
    }

    // Jump execution (with coyote time + air jump)
    if (p.jumpBufferTimer > 0) {
      if (p.coyoteTimer > 0 || inLiquid) {
        p.vy = -175;
        p.grounded = false;
        p.coyoteTimer = 0;
        p.jumpBufferTimer = 0;
        sfx.playJump();
      } else if (p.jumpsRemaining > 0) {
        p.vy = -162;
        p.jumpsRemaining--;
        p.jumpBufferTimer = 0;
        sfx.playJump();
        for (let i = 0; i < 6; i++) {
          this.world.spawnParticle(
            p.x + (Math.random() - 0.5) * 6,
            p.y,
            (Math.random() - 0.5) * 55,
            45 + Math.random() * 40,
            Mat.EMBER,
            packColor(140, 220, 255),
            0.25,
            false
          );
        }
      }
    }

    // Move & collide horizontally with step-up, leg-pixel wading, and jump clearance
    this.moveEntityWithPixelCollision(p, p.vx * dt, p.vy * dt, true, true);

    if (p.grounded) {
      p.coyoteTimer = 0.11;
      p.jumpsRemaining = 1 + p.maxAirJumps;
    }

    // Environmental hazard check (FIRE or ACID)
    if (p.invulnTimer <= 0) {
      let fireHits = 0;
      let acidHits = 0;
      for (let py = Math.round(p.y - p.h + 2); py <= Math.round(p.y - 1); py += 3) {
        const m = this.world.getMat(Math.round(p.x), py);
        if (m === Mat.FIRE && !this.hasRelic('THERMAL_REACTOR')) fireHits++;
        if (m === Mat.ACID && !this.hasRelic('ALCHEMIST_HEART')) acidHits++;
      }
      if (acidHits > 0 || fireHits > 1) {
        const resist = this.hasPerk('CRYO_SHIELDING') ? 0.4 : 1.0;
        const dmg = Math.max(1, Math.round((acidHits > 0 ? 7 : 5) * resist));
        this.damagePlayer(dmg, 0);
      }
    }
  }

  private tryDash(): void {
    const p = this.player;
    if (p.dashCooldown > 0) return;
    const moveLeft = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const moveRight = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const dir = moveRight
      ? 1
      : moveLeft
      ? -1
      : Math.abs(this.touchMoveAxis) > 0.2
      ? this.touchMoveAxis > 0
        ? 1
        : -1
      : p.facing;

    p.vx = dir * 245;
    p.vy = Math.min(p.vy, 0) * 0.2;
    p.dashTimer = 0.14;
    p.invulnTimer = Math.max(p.invulnTimer, 0.22);
    p.dashCooldown = this.hasPerk('TWIN_THRUSTERS') ? 0.65 : 0.95;

    const chronoLv = this.getRelicLevel('CHRONO_THRUSTER');
    if (chronoLv > 0) {
      this.dashCount++;
      const bx = p.x;
      const by = p.y - p.h * 0.5;
      const pulseRad = 14 + (chronoLv - 1) * 6;
      const pulseDmg = 28 * chronoLv;
      this.world.destroyCircle(bx, by, pulseRad, 6 + (chronoLv - 1) * 2, 'EXPLOSIVE', this.hasRelic('THERMAL_REACTOR'), this.hasRelic('ALCHEMIST_HEART'));
      this.spawnShockRing(bx, by, pulseRad + 8, '#A78BFA');
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const en = this.enemies[i];
        if (Math.hypot(en.x - bx, en.y - en.h * 0.5 - by) <= pulseRad + 12) {
          this.damageEnemy(en, pulseDmg, false);
        }
      }
      if (this.boss && Math.hypot(this.boss.x - bx, this.boss.y - this.boss.h * 0.5 - by) <= pulseRad + 22) {
        this.damageBossAtWorld(bx, by, pulseRad, 6 + (chronoLv - 1) * 2, 32 * chronoLv, 'EXPLOSIVE', false, false);
      }
      const bombCadence = chronoLv >= 2 ? 1 : 2;
      if (this.dashCount % bombCadence === 0 && p.bombs < p.maxBombs) {
        const restoreAmt = chronoLv >= 3 ? 2 : 1;
        p.bombs = Math.min(p.maxBombs, p.bombs + restoreAmt);
        this.spawnFloatingText(p.x, p.y - p.h - 4, `+${restoreAmt} Bomb`, '#A78BFA');
      }
    }

    sfx.playDash();
  }

  private tryThrowBomb(): void {
    const p = this.player;
    if (p.bombs <= 0) return;
    p.bombs--;
    const spd = 215;
    const muzzleX = p.x + Math.cos(p.aimAngle) * 6;
    const muzzleY = p.y - p.h * 0.5 + Math.sin(p.aimAngle) * 6;

    const siegeLv = this.getRelicLevel('SIEGE_HEART');
    const demoBonus = (this.hasPerk('DEMOLITIONIST') ? 1.35 : 1.0) * (siegeLv > 0 ? 1 + 0.5 * siegeLv : 1.0);
    const powerBonus = 3 * siegeLv;
    this.projectiles.push({
      id: this.nextId++,
      fromPlayer: true,
      damageType: 'EXPLOSIVE',
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(p.aimAngle) * spd + p.vx * 0.25,
      vy: Math.sin(p.aimAngle) * spd - 35,
      damage: 60,
      blastRadius: 19 * demoBonus,
      blastPower: 8 + powerBonus,
      pierce: 0,
      gravity: 260,
      ignite: this.hasPerk('THERMITE_PAYLOAD') || this.hasRelic('THERMAL_REACTOR'),
      acid: this.hasRelic('ALCHEMIST_HEART'),
      isBomb: true,
      fuse: 1.15,
      color: '#F59E0B',
      radius: 2.5,
      age: 0,
    });
    sfx.playShoot('flak');
    this.emitHud();
  }

  private grantWeaponOrDupe(weaponId: WeaponId, fx: number, fy: number): void {
    const p = this.player;
    const wDef = WEAPONS[weaponId];
    if (!p.weapons.includes(weaponId)) {
      if (p.weapons.length < 3) {
        p.weapons.push(weaponId);
        p.activeWeaponIdx = p.weapons.length - 1;
      } else {
        p.weapons[p.activeWeaponIdx] = weaponId;
      }
      this.spawnFloatingText(fx, fy, wDef.name, wDef.color);
    } else {
      const nextDupe = (p.weaponDupes[weaponId] ?? 0) + 1;
      p.weaponDupes[weaponId] = nextDupe;
      p.gold += 15;
      const totalPct = (nextDupe * 0.01).toFixed(2);
      this.spawnFloatingText(fx, fy, `${wDef.name} +0.01% (+${totalPct}%)`, wDef.color);
    }
  }

  private tryInteract(): void {
    const p = this.player;
    // Check pedestals
    for (const ped of this.pedestals) {
      if (ped.used) continue;
      if (Math.hypot(ped.x - p.x, ped.y - p.y) < 22) {
        ped.used = true;
        if (ped.weaponOffer) {
          this.grantWeaponOrDupe(ped.weaponOffer, ped.x, ped.y - 16);
        }
        p.hp = Math.min(p.maxHp, p.hp + 20);
        sfx.playPickup('upgrade');
        this.emitHud();
        return;
      }
    }

    // Check portal
    if (this.portal.active && Math.hypot(this.portal.x - p.x, this.portal.y - (p.y - 8)) < 22) {
      this.openUpgradeChoice();
    }
  }

  private openUpgradeChoice(): void {
    const allIds = Object.keys(PERKS) as PerkId[];
    const shuffled = [...allIds].sort(() => Math.random() - 0.5);
    const choices = shuffled.slice(0, 3).map((id) => PERKS[id]);
    this.setState('LEVEL_UPGRADE');
    this.callbacks.onUpgradeChoices(choices);
  }

  private updateWeapons(dt: number): void {
    if (!this.mouseDownLeft && !this.touchAimFiring) return;
    const p = this.player;
    if (p.fireCooldown > 0) return;

    const wId = p.weapons[p.activeWeaponIdx];
    const wDef = WEAPONS[wId];
    const dupes = p.weaponDupes[wId] ?? 0;
    const dupeMul = 1 + dupes * 0.0001; // +0.01% weapon stats per duplicate

    const siegeLv = this.getRelicLevel('SIEGE_HEART');
    const thermalLv = this.getRelicLevel('THERMAL_REACTOR');
    const railLv = this.getRelicLevel('RAIL_FOCUSER');
    const alchLv = this.getRelicLevel('ALCHEMIST_HEART');
    const salvageLv = this.getRelicLevel('SALVAGE_MAGNET');

    let rateMul = (this.hasPerk('OVERCLOCKED_BARREL') ? 1.28 : 1.0) * dupeMul;
    if (thermalLv > 0 && this.isNearFlames(p.x, p.y - 6, 20)) {
      rateMul *= 1 + 0.4 * thermalLv;
    }
    p.fireCooldown = wDef.cooldown / rateMul;

    const goldBonus = salvageLv > 0 ? Math.floor(p.gold / 15) * 0.01 * salvageLv : 0;
    const alchemistBonus = alchLv > 0 && wDef.acid ? 0.35 * alchLv : 0;
    const dmgMul = (1 + this.countPerk('TUNGSTEN_SLUGS') * 0.35 + goldBonus + alchemistBonus) * dupeMul;
    const extraPierce = this.countPerk('TUNGSTEN_SLUGS') + 2 * railLv;
    const seismicMul = (1 + this.countPerk('SEISMIC_ROUNDS') * 0.65) * (siegeLv > 0 ? 1 + 0.5 * siegeLv : 1.0) * dupeMul;
    const powerBonus = 3 * siegeLv;
    const speedMul = (railLv > 0 ? 1.6 + 0.25 * (railLv - 1) : 1.0) * dupeMul;
    const ignite = wDef.ignite || this.hasPerk('THERMITE_PAYLOAD') || thermalLv > 0;
    const acid = wDef.acid || alchLv > 0;
    const shotDamage = wDef.damage * dmgMul;

    const muzzleX = p.x + Math.cos(p.aimAngle) * 7;
    const muzzleY = p.y - p.h * 0.5 + Math.sin(p.aimAngle) * 7;

    if (wDef.isBeam) {
      sfx.playShoot('beam');
      let hitX = muzzleX;
      let hitY = muzzleY;
      const step = 1.5;
      const maxDist = 88;
      const cos = Math.cos(p.aimAngle);
      const sin = Math.sin(p.aimAngle);
      let hitSomething = false;

      for (let d = 0; d <= maxDist; d += step) {
        const rx = muzzleX + cos * d;
        const ry = muzzleY + sin * d;
        hitX = rx;
        hitY = ry;
        if (this.world.isSolid(Math.round(rx), Math.round(ry))) {
          this.world.destroyCircle(rx, ry, wDef.blastRadius * seismicMul, wDef.blastPower + powerBonus, wDef.damageType, ignite, acid);
          hitSomething = true;
          break;
        }
        if (this.boss && this.isBossSolidAtWorld(rx, ry)) {
          this.damageBossAtWorld(
            rx,
            ry,
            wDef.blastRadius * seismicMul,
            wDef.blastPower + powerBonus,
            shotDamage,
            wDef.damageType,
            ignite,
            true
          );
          hitSomething = true;
          break;
        }
        // Check enemy hit
        for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
          const en = this.enemies[ei];
          if (Math.abs(rx - en.x) <= en.w * 0.55 && Math.abs(ry - (en.y - en.h * 0.5)) <= en.h * 0.55) {
            this.damageEnemy(en, shotDamage, false);
            hitSomething = true;
            break;
          }
        }
        if (hitSomething) break;
      }

      this.beamFlashes.push({
        x0: muzzleX,
        y0: muzzleY,
        x1: hitX,
        y1: hitY,
        color: wDef.color,
        life: 0.06,
      });
      return;
    }

    const soundMap: Record<WeaponId, 'pulse' | 'scatter' | 'flak' | 'rail' | 'arc' | 'acid' | 'beam'> = {
      PULSE_CARBINE: 'pulse',
      EMBER_SCATTER: 'scatter',
      FLAK_CANNON: 'flak',
      PLASMA_RAIL: 'rail',
      ARC_CASTER: 'arc',
      ACID_MORTAR: 'acid',
      MINING_BEAM: 'beam',
    };
    sfx.playShoot(soundMap[wId]);

    for (let i = 0; i < wDef.pellets; i++) {
      const ang = p.aimAngle + (Math.random() - 0.5) * wDef.spread;
      this.projectiles.push({
        id: this.nextId++,
        fromPlayer: true,
        damageType: wDef.damageType,
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(ang) * wDef.speed * speedMul,
        vy: Math.sin(ang) * wDef.speed * speedMul,
        damage: shotDamage,
        blastRadius: wDef.blastRadius * seismicMul,
        blastPower: wDef.blastPower + powerBonus,
        pierce: wDef.pierce + extraPierce,
        gravity: wDef.gravity,
        ignite,
        acid,
        isBomb: false,
        fuse: 0,
        color: wDef.color,
        radius: wId === 'FLAK_CANNON' || wId === 'ACID_MORTAR' ? 2.2 : 1.4,
        age: 0,
      });
    }
  }

  private isNearFlames(cx: number, cy: number, radius: number): boolean {
    const r = Math.round(radius);
    let count = 0;
    for (let dy = -r; dy <= r; dy += 4) {
      for (let dx = -r; dx <= r; dx += 4) {
        const m = this.world.getMat(Math.round(cx + dx), Math.round(cy + dy));
        if (m === Mat.FIRE || m === Mat.EMBER) {
          count++;
          if (count >= 2) return true;
        }
      }
    }
    return false;
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.age += dt;
      if (pr.age > 5.0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      pr.vy += pr.gravity * dt;

      if (pr.isBomb) {
        pr.fuse -= dt;
        const nx = pr.x + pr.vx * dt;
        const ny = pr.y + pr.vy * dt;
        if (this.world.isSolid(Math.round(nx), Math.round(pr.y))) {
          pr.vx = -pr.vx * 0.45;
        } else {
          pr.x = nx;
        }
        if (this.world.isSolid(Math.round(pr.x), Math.round(ny))) {
          pr.vy = -pr.vy * 0.4;
          pr.vx *= 0.72;
        } else {
          pr.y = ny;
        }
        if (pr.fuse <= 0) {
          this.detonateBomb(pr);
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      const dist = Math.hypot(pr.vx * dt, pr.vy * dt);
      const steps = Math.max(1, Math.ceil(dist / 2));
      const sdx = (pr.vx * dt) / steps;
      const sdy = (pr.vy * dt) / steps;
      let removed = false;

      for (let s = 0; s < steps && !removed; s++) {
        pr.x += sdx;
        pr.y += sdy;

        const ix = Math.round(pr.x);
        const iy = Math.round(pr.y);

        if (ix <= 1 || ix >= WORLD_W - 2 || iy <= 1 || iy >= WORLD_H - 2) {
          removed = true;
          break;
        }

        if (pr.fromPlayer) {
          // Check pixel-based Boss hit
          if (this.boss && this.isBossSolidAtWorld(pr.x, pr.y)) {
            this.damageBossAtWorld(
              pr.x,
              pr.y,
              Math.max(2.6, pr.blastRadius),
              pr.blastPower,
              pr.damage,
              pr.damageType,
              pr.ignite,
              true
            );
            if (pr.blastRadius >= 6) {
              this.spawnShockRing(pr.x, pr.y, pr.blastRadius * 1.4, pr.color);
              sfx.playExplosion(0.7);
            }
            if (pr.pierce > 0) {
              pr.pierce--;
            } else {
              removed = true;
            }
            break;
          }

          for (let ei = this.enemies.length - 1; ei >= 0; ei--) {
            const en = this.enemies[ei];
            if (
              Math.abs(pr.x - en.x) <= en.w * 0.55 + pr.radius &&
              Math.abs(pr.y - (en.y - en.h * 0.5)) <= en.h * 0.55 + pr.radius
            ) {
              this.damageEnemy(en, pr.damage, false);
              if (pr.blastRadius >= 6) {
                this.world.destroyCircle(pr.x, pr.y, pr.blastRadius, pr.blastPower, pr.damageType, pr.ignite, pr.acid);
                this.spawnShockRing(pr.x, pr.y, pr.blastRadius * 1.4, pr.color);
                sfx.playExplosion(0.7);
              }
              if (pr.pierce > 0) {
                pr.pierce--;
              } else {
                removed = true;
              }
              break;
            }
          }
        } else {
          const p = this.player;
          if (
            p.invulnTimer <= 0 &&
            Math.abs(pr.x - p.x) <= p.w * 0.5 + pr.radius &&
            Math.abs(pr.y - (p.y - p.h * 0.5)) <= p.h * 0.5 + pr.radius
          ) {
            this.damagePlayer(pr.damage, pr.vx >= 0 ? 1 : -1);
            removed = true;
            break;
          }
        }

        if (removed) break;

        if (this.world.isSolid(ix, iy)) {
          this.world.destroyCircle(pr.x, pr.y, pr.blastRadius, pr.blastPower, pr.damageType, pr.ignite, pr.acid);
          if (pr.blastRadius >= 7) {
            this.spawnShockRing(pr.x, pr.y, pr.blastRadius * 1.4, pr.color);
            this.shakeMag = Math.max(this.shakeMag, 2.5);
            sfx.playExplosion(0.65);
          }
          if (pr.pierce > 0) {
            pr.pierce--;
          } else {
            removed = true;
          }
        }
      }

      if (removed) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  private detonateBomb(bomb: Projectile): void {
    sfx.playExplosion(1.3);
    this.shakeMag = Math.max(this.shakeMag, 5.5);
    this.world.destroyCircle(bomb.x, bomb.y, bomb.blastRadius, bomb.blastPower, bomb.damageType, bomb.ignite, bomb.acid);
    this.spawnShockRing(bomb.x, bomb.y, bomb.blastRadius * 1.6, '#F59E0B');

    // Damage enemies in blast radius
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const en = this.enemies[i];
      const dist = Math.hypot(en.x - bomb.x, en.y - en.h * 0.5 - bomb.y);
      if (dist <= bomb.blastRadius * 1.5) {
        const falloff = 1 - (dist / (bomb.blastRadius * 1.6)) * 0.5;
        this.damageEnemy(en, Math.round(bomb.damage * falloff), false);
      }
    }

    // Damage & carve pixels on Boss if inside blast radius
    if (this.boss) {
      const bossDist = Math.hypot(
        this.boss.x - bomb.x,
        this.boss.y - this.boss.h * 0.5 - bomb.y
      );
      if (bossDist <= bomb.blastRadius + Math.max(this.boss.w, this.boss.h) * 0.65) {
        this.damageBossAtWorld(
          bomb.x,
          bomb.y,
          bomb.blastRadius * 0.9,
          bomb.blastPower,
          bomb.damage,
          bomb.damageType,
          bomb.ignite,
          false
        );
      }
    }

    // Self-damage check
    const p = this.player;
    if (p.invulnTimer <= 0) {
      const pDist = Math.hypot(p.x - bomb.x, p.y - p.h * 0.5 - bomb.y);
      if (pDist <= bomb.blastRadius * 1.15) {
        const resist = this.hasPerk('CRYO_SHIELDING') ? 0.35 : 0.65;
        this.damagePlayer(Math.round(14 * resist), p.x >= bomb.x ? 1 : -1);
      }
    }

    // Cluster shrapnel perk
    if (this.hasPerk('CLUSTER_SHRAPNEL')) {
      for (let k = 0; k < 6; k++) {
        const ang = -Math.PI * 0.15 - (k / 5) * Math.PI * 0.7 + (Math.random() - 0.5) * 0.2;
        const spd = 110 + Math.random() * 55;
        this.projectiles.push({
          id: this.nextId++,
          fromPlayer: true,
          damageType: 'EXPLOSIVE',
          x: bomb.x,
          y: bomb.y - 2,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          damage: 20,
          blastRadius: 9,
          blastPower: 5,
          pierce: 0,
          gravity: 250,
          ignite: bomb.ignite,
          acid: bomb.acid,
          isBomb: false,
          fuse: 0,
          color: '#FBBF24',
          radius: 2,
          age: 0,
        });
      }
    }
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    const dmgScale = 1 + (this.depth - 1) * 0.12;
    const spdScale = 1 + Math.min(0.65, (this.depth - 1) * 0.045);
    const cdScale = Math.max(0.55, 1 - (this.depth - 1) * 0.03);

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const en = this.enemies[i];
      en.hurtFlash = Math.max(0, en.hurtFlash - dt);
      en.attackCd = Math.max(0, en.attackCd - dt);
      en.aiTimer += dt;

      const dx = p.x - en.x;
      const dy = p.y - en.y;
      const dist = Math.hypot(dx, dy);

      if (en.kind === 'DRONE') {
        if (dist < 215) {
          en.facing = dx >= 0 ? 1 : -1;
          const targetVx = dist > 55 ? Math.sign(dx) * 44 * spdScale : -Math.sign(dx) * 24 * spdScale;
          const hoverY = p.y - 28 + Math.sin(en.aiTimer * 3.5) * 8;
          const targetVy = Math.max(-48, Math.min(48, (hoverY - en.y) * 2.2));
          en.vx += (targetVx - en.vx) * 3 * dt;
          en.vy += (targetVy - en.vy) * 3 * dt;

          if (en.attackCd <= 0 && dist < 175) {
            en.attackCd = 1.65 * cdScale;
            const ang = Math.atan2(p.y - p.h * 0.5 - en.y, p.x - en.x);
            this.spawnEnemyShot(en.x, en.y, ang, 165 * spdScale, Math.round(9 * dmgScale), '#FB7185');
            if (this.depth >= 6) {
              this.spawnEnemyShot(en.x, en.y, ang + 0.18, 155 * spdScale, Math.round(8 * dmgScale), '#FB7185');
            }
          }
        } else {
          en.vx *= 0.92;
          en.vy = Math.sin(en.aiTimer * 2.5) * 12;
        }
        this.moveEntityWithPixelCollision(en, en.vx * dt, en.vy * dt, false);
      } else if (en.kind === 'PYRO_IMP') {
        // Ashen Foundry signature aerial enemy: weaves erratically & lobs igniting ember bolts
        if (dist < 230) {
          en.facing = dx >= 0 ? 1 : -1;
          const strafe = Math.sin(en.aiTimer * 4.2) * 34;
          const targetVx = (dist > 68 ? Math.sign(dx) * 48 : -Math.sign(dx) * 34) * spdScale + strafe;
          const hoverY = p.y - 36 + Math.cos(en.aiTimer * 3.8) * 12;
          const targetVy = Math.max(-55, Math.min(55, (hoverY - en.y) * 2.5));
          en.vx += (targetVx - en.vx) * 3.5 * dt;
          en.vy += (targetVy - en.vy) * 3.5 * dt;

          if (en.attackCd <= 0 && dist < 185) {
            en.attackCd = 1.5 * cdScale;
            const ang = Math.atan2(p.y - p.h * 0.5 - en.y, p.x - en.x);
            this.spawnEnemyShot(en.x, en.y, ang, 155 * spdScale, Math.round(11 * dmgScale), '#FB923C', 65, true, false);
            if (this.depth >= 4) {
              this.spawnEnemyShot(en.x, en.y, ang - 0.22, 145 * spdScale, Math.round(10 * dmgScale), '#FB923C', 65, true, false);
            }
          }
        } else {
          en.vx *= 0.92;
          en.vy = Math.sin(en.aiTimer * 3.1) * 15;
        }
        this.moveEntityWithPixelCollision(en, en.vx * dt, en.vy * dt, false);
      } else if (en.kind === 'CRYSTAL_WISP') {
        // Vitriol Vaults signature enemy: figure-8 hover, bursts crystal/acid shards
        if (dist < 225) {
          en.facing = dx >= 0 ? 1 : -1;
          const targetVx = Math.cos(en.aiTimer * 2.1) * 36 * spdScale + Math.sign(dx) * 14;
          const hoverY = p.y - 26 + Math.sin(en.aiTimer * 4.2) * 14;
          const targetVy = Math.max(-44, Math.min(44, (hoverY - en.y) * 2.3));
          en.vx += (targetVx - en.vx) * 2.8 * dt;
          en.vy += (targetVy - en.vy) * 2.8 * dt;

          if (en.attackCd <= 0 && dist < 185) {
            en.attackCd = 1.85 * cdScale;
            const ang = Math.atan2(p.y - p.h * 0.5 - en.y, p.x - en.x);
            const count = this.depth >= 5 ? 3 : 2;
            for (let s = 0; s < count; s++) {
              const offset = (s - (count - 1) * 0.5) * 0.22;
              this.spawnEnemyShot(en.x, en.y, ang + offset, 145 * spdScale, Math.round(10 * dmgScale), '#4ADE80', 0, false, true);
            }
          }
        } else {
          en.vx = Math.cos(en.aiTimer * 1.5) * 14;
          en.vy = Math.sin(en.aiTimer * 3) * 12;
        }
        this.moveEntityWithPixelCollision(en, en.vx * dt, en.vy * dt, false);
      } else if (en.kind === 'TURRET') {
        en.vy += GRAVITY * dt;
        this.moveEntityWithPixelCollision(en, 0, en.vy * dt, false);
        if (dist < 200) {
          en.facing = dx >= 0 ? 1 : -1;
          if (en.attackCd <= 0) {
            en.attackCd = 1.85 * cdScale;
            const ang = Math.atan2(p.y - p.h * 0.5 - (en.y - 5), p.x - en.x);
            this.spawnEnemyShot(en.x, en.y - 5, ang, 210 * spdScale, Math.round(12 * dmgScale), '#F43F5E');
          }
        }
      } else if (en.kind === 'STONE_WARDEN') {
        // Sunken Masonry heavy armored colossus
        en.vy += GRAVITY * dt;
        if (dist < 220) {
          en.facing = dx >= 0 ? 1 : -1;
          en.vx = en.facing * 26 * spdScale;
          if (en.grounded && Math.abs(dy) > 16 && en.attackCd <= 0) {
            en.vy = -126;
            en.attackCd = 1.4;
          }
          if (dist > 36 && en.attackCd <= 0) {
            en.attackCd = 2.1 * cdScale;
            const ang = Math.atan2(p.y - p.h * 0.5 - (en.y - 9), p.x - en.x);
            const shots = this.depth >= 4 ? 3 : 2;
            for (let s = 0; s < shots; s++) {
              const spread = (s - (shots - 1) * 0.5) * 0.16;
              this.spawnEnemyShot(en.x, en.y - 9, ang + spread, 150 * spdScale, Math.round(13 * dmgScale), '#38BDF8');
            }
          }
        } else {
          en.vx = Math.sin(en.aiTimer * 1.1) * 14;
        }
        this.moveEntityWithPixelCollision(en, en.vx * dt, en.vy * dt, true);
      } else {
        // Grounded enemies: CRAWLER, SENTINEL, SLIME
        en.vy += GRAVITY * dt;
        if (dist < 205) {
          en.facing = dx >= 0 ? 1 : -1;
          const baseSpd = en.kind === 'CRAWLER' ? 54 : en.kind === 'SENTINEL' ? 32 : 40;
          en.vx = en.facing * baseSpd * spdScale;

          if (en.grounded && (en.kind === 'SLIME' || Math.abs(dy) > 14) && en.attackCd <= 0) {
            en.vy = en.kind === 'SLIME' ? -145 : -130;
            en.attackCd = 1.25 * cdScale;
          }

          if (en.kind === 'SENTINEL' && dist > 42 && en.attackCd <= 0) {
            en.attackCd = 2.0 * cdScale;
            const ang = Math.atan2(p.y - p.h * 0.5 - (en.y - 7), p.x - en.x);
            this.spawnEnemyShot(en.x, en.y - 7, ang, 155 * spdScale, Math.round(13 * dmgScale), '#FBBF24');
          }
        } else {
          en.vx = Math.sin(en.aiTimer * 1.4) * 16;
        }

        this.moveEntityWithPixelCollision(en, en.vx * dt, en.vy * dt, true);
      }

      if (
        p.invulnTimer <= 0 &&
        Math.abs(p.x - en.x) < (p.w + en.w) * 0.45 &&
        Math.abs(p.y - p.h * 0.5 - (en.y - en.h * 0.5)) < (p.h + en.h) * 0.45
      ) {
        const contactDmg = Math.round((en.kind === 'STONE_WARDEN' ? 16 : en.kind === 'SENTINEL' ? 14 : 10) * dmgScale);
        this.damagePlayer(contactDmg, p.x >= en.x ? 1 : -1);
      }
    }
  }

  private spawnEnemyShot(
    x: number,
    y: number,
    ang: number,
    spd: number,
    dmg: number,
    color: string,
    gravity = 0,
    ignite = false,
    acid = false
  ): void {
    const damageType: DamageType = acid ? 'CORROSIVE' : ignite ? 'THERMAL' : 'KINETIC';
    this.projectiles.push({
      id: this.nextId++,
      fromPlayer: false,
      damageType,
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      damage: dmg,
      blastRadius: ignite || acid ? 3.2 : 2.2,
      blastPower: 2,
      pierce: 0,
      gravity,
      ignite,
      acid,
      isBomb: false,
      fuse: 0,
      color,
      radius: 1.6,
      age: 0,
    });
  }

  private damageEnemy(en: Enemy, dmg: number, fromCrush: boolean): void {
    const isArmored = en.kind === 'SENTINEL' || en.kind === 'STONE_WARDEN' || en.kind === 'TURRET';
    const railLv = this.getRelicLevel('RAIL_FOCUSER');
    const finalDmg = !fromCrush && isArmored && railLv > 0 ? dmg * (1 + 0.45 * railLv) : dmg;
    const dispDmg = Math.max(1, Math.round(finalDmg));

    en.hp -= finalDmg;
    en.hurtFlash = 0.14;
    this.spawnFloatingText(
      en.x,
      en.y - en.h - 2,
      fromCrush ? `CRUSH -${dispDmg}` : `${dispDmg}`,
      fromCrush ? '#FBBF24' : '#F4F4F5'
    );

    if (en.kind === 'SLIME' || en.kind === 'CRYSTAL_WISP') {
      for (let k = 0; k < 4; k++) {
        this.world.spawnParticle(
          en.x,
          en.y - 3,
          (Math.random() - 0.5) * 65,
          -40 - Math.random() * 35,
          Mat.ACID,
          packColor(75, 235, 95),
          1.2,
          true
        );
      }
    }

    if (en.hp <= 0) {
      const idx = this.enemies.indexOf(en);
      if (idx !== -1) this.enemies.splice(idx, 1);
      this.kills++;

      let healAmt = 0;
      if (this.hasPerk('VAMPIRIC_CORE')) healAmt += 5;
      healAmt += 3 * this.getRelicLevel('ALCHEMIST_HEART');
      if (healAmt > 0) {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + healAmt);
      }

      // Burst of pixel sparks
      for (let k = 0; k < 14; k++) {
        this.world.spawnParticle(
          en.x,
          en.y - en.h * 0.5,
          (Math.random() - 0.5) * 110,
          -35 - Math.random() * 80,
          en.kind === 'DRONE' || en.kind === 'PYRO_IMP' ? Mat.EMBER : Mat.RUBBLE,
          en.kind === 'SLIME' || en.kind === 'CRYSTAL_WISP'
            ? packColor(80, 235, 95)
            : packColor(245, 165, 55),
          0.9,
          false
        );
      }

      const bonusGold = fromCrush && this.hasPerk('STRUCTURAL_SABOTEUR') ? 8 : 0;
      const shards = Math.max(2, Math.round((en.goldValue + bonusGold) / 3));
      for (let g = 0; g < shards; g++) {
        this.pickups.push({
          id: this.nextId++,
          kind: 'GOLD',
          x: en.x,
          y: en.y - 4,
          vx: (Math.random() - 0.5) * 85,
          vy: -65 - Math.random() * 45,
          value: 3,
          age: 0,
        });
      }
      if (Math.random() < 0.25) {
        this.pickups.push({
          id: this.nextId++,
          kind: 'HEALTH',
          x: en.x,
          y: en.y - 4,
          vx: (Math.random() - 0.5) * 40,
          vy: -70,
          value: 15,
          age: 0,
        });
      }
      const weaponDropChance = en.kind === 'STONE_WARDEN' || en.kind === 'SENTINEL' ? 0.22 : 0.05;
      if (Math.random() < weaponDropChance) {
        const wId = LOOTABLE_WEAPONS[Math.floor(Math.random() * LOOTABLE_WEAPONS.length)];
        this.pickups.push({
          id: this.nextId++,
          kind: 'WEAPON',
          x: en.x,
          y: en.y - 5,
          vx: (Math.random() - 0.5) * 50,
          vy: -85,
          value: 1,
          weaponId: wId,
          age: 0,
        });
      }
    }
  }

  private updateBoss(dt: number): void {
    const boss = this.boss;
    if (!boss) return;

    boss.hurtFlash = Math.max(0, boss.hurtFlash - dt);
    boss.attackCd = Math.max(0, boss.attackCd - dt);
    boss.secondaryCd = Math.max(0, boss.secondaryCd - dt);
    boss.phaseTimer += dt;

    const p = this.player;
    if (p.x < boss.arenaMinX - 50 && boss.hp === boss.maxHp) {
      return;
    }

    const tier = Math.max(1, Math.floor(this.depth / 10));
    const dx = p.x - boss.x;
    const dy = p.y - p.h * 0.5 - (boss.y - boss.h * 0.5);
    boss.facing = dx >= 0 ? 1 : -1;

    if (boss.biomeId === 'SUNKEN_MASONRY') {
      // The Monolith Warden: strides and leaps toward arena positions, slams + sapphire barrages
      const patrolX = boss.anchorX + Math.sin(boss.phaseTimer * 0.85) * 140;
      const targetVx = Math.max(-52, Math.min(52, (patrolX - boss.x) * 1.6));
      boss.vx += (targetVx - boss.vx) * 3 * dt;
      boss.vy += GRAVITY * 0.85 * dt;

      boss.x += boss.vx * dt;
      boss.y += boss.vy * dt;
      if (boss.y >= boss.arenaFloorY) {
        if (boss.vy > 120) {
          this.shakeMag = Math.max(this.shakeMag, 4.5);
          this.spawnShockRing(boss.x, boss.arenaFloorY - 2, 34, '#38BDF8');
          sfx.playExplosion(0.8);
        }
        boss.y = boss.arenaFloorY;
        boss.vy = 0;
      }

      if (boss.secondaryCd <= 0 && boss.y >= boss.arenaFloorY - 1) {
        boss.secondaryCd = Math.max(2.6, 4.2 - tier * 0.35);
        boss.vy = -175;
        boss.vx = Math.sign(dx) * 85;
      }

      if (boss.attackCd <= 0) {
        boss.attackCd = Math.max(1.15, 2.0 - tier * 0.15);
        const baseAng = Math.atan2(p.y - p.h * 0.5 - (boss.y - boss.h * 0.55), p.x - boss.x);
        const count = 3 + Math.min(2, tier - 1);
        for (let k = 0; k < count; k++) {
          const offset = (k - (count - 1) * 0.5) * 0.2;
          this.spawnEnemyShot(
            boss.x,
            boss.y - boss.h * 0.55,
            baseAng + offset,
            165 + tier * 14,
            12 + tier * 2,
            '#38BDF8'
          );
        }
      }
    } else if (boss.biomeId === 'ASHEN_FOUNDRY') {
      // The Slag Colossus: surging bulldozer charges + arcing molten bombs & ember sweeps
      const targetX = p.x + Math.sin(boss.phaseTimer * 1.1) * 90;
      const desiredVx = Math.max(-68, Math.min(68, (targetX - boss.x) * 1.4));
      boss.vx += (desiredVx - boss.vx) * 2.5 * dt;
      boss.vy += GRAVITY * dt;
      boss.x += boss.vx * dt;
      boss.y += boss.vy * dt;
      if (boss.y >= boss.arenaFloorY) {
        boss.y = boss.arenaFloorY;
        boss.vy = 0;
      }

      if (boss.secondaryCd <= 0) {
        boss.secondaryCd = Math.max(2.0, 3.2 - tier * 0.25);
        // Lob 2 arcing fire bombs from twin stacks
        for (const stackSign of [-1, 1]) {
          const ang = Math.atan2(-115, dx + stackSign * 35);
          this.spawnEnemyShot(
            boss.x + stackSign * 8,
            boss.y - boss.h + 4,
            ang,
            175 + Math.abs(dx) * 0.35,
            14 + tier * 2,
            '#FB923C',
            210,
            true,
            false
          );
        }
      }

      if (boss.attackCd <= 0) {
        boss.attackCd = Math.max(1.0, 1.7 - tier * 0.15);
        const baseAng = Math.atan2(dy, dx);
        for (let k = -1; k <= 1; k++) {
          this.spawnEnemyShot(
            boss.x,
            boss.y - boss.h * 0.5,
            baseAng + k * 0.16,
            180,
            11 + tier * 2,
            '#F59E0B',
            0,
            true,
            false
          );
        }
      }
    } else {
      // The Sovereign Spire: hovering geometric glide + rotating vitriol shard rings
      const targetX = boss.anchorX + Math.sin(boss.phaseTimer * 0.95) * 160;
      const targetY = boss.arenaFloorY - 46 + Math.sin(boss.phaseTimer * 2.1) * 32;
      boss.vx += ((targetX - boss.x) * 1.8 - boss.vx) * 3 * dt;
      boss.vy += ((targetY - boss.y) * 2.2 - boss.vy) * 3 * dt;
      boss.x += boss.vx * dt;
      boss.y += boss.vy * dt;

      if (boss.attackCd <= 0) {
        boss.attackCd = Math.max(1.1, 1.85 - tier * 0.15);
        const baseAng = Math.atan2(dy, dx);
        for (let k = -1; k <= 1; k++) {
          this.spawnEnemyShot(
            boss.x,
            boss.y - boss.h * 0.55,
            baseAng + k * 0.2,
            170,
            12 + tier * 2,
            '#4ADE80',
            0,
            false,
            true
          );
        }
      }

      if (boss.secondaryCd <= 0) {
        boss.secondaryCd = Math.max(2.4, 3.6 - tier * 0.25);
        const ringCount = 8 + Math.min(4, tier * 2);
        for (let k = 0; k < ringCount; k++) {
          const ang = (k / ringCount) * Math.PI * 2 + boss.phaseTimer;
          this.spawnEnemyShot(
            boss.x,
            boss.y - boss.h * 0.5,
            ang,
            125,
            11 + tier * 2,
            '#10B981',
            0,
            false,
            true
          );
        }
      }
    }

    boss.x = Math.max(boss.arenaMinX + boss.w * 0.5, Math.min(boss.arenaMaxX - boss.w * 0.5, boss.x));
    boss.y = Math.max(115 + boss.h, Math.min(boss.arenaFloorY, boss.y));

    // Contact check against actual remaining Boss pixels
    if (p.invulnTimer <= 0) {
      const samplePts: [number, number][] = [
        [p.x, p.y - p.h * 0.5],
        [p.x - p.w * 0.4, p.y - 3],
        [p.x + p.w * 0.4, p.y - 3],
        [p.x, p.y - p.h + 2],
      ];
      for (const [sx, sy] of samplePts) {
        if (this.isBossSolidAtWorld(sx, sy)) {
          this.damagePlayer(16 + tier * 2, p.x >= boss.x ? 1 : -1);
          break;
        }
      }
    }
  }

  private isBossSolidAtWorld(wx: number, wy: number): boolean {
    const boss = this.boss;
    if (!boss) return false;
    const lx = Math.floor(wx - (boss.x - boss.w * 0.5));
    const ly = Math.floor(wy - (boss.y - boss.h));
    if (lx < 0 || lx >= boss.w || ly < 0 || ly >= boss.h) return false;
    return boss.mats[ly * boss.w + lx] !== Mat.EMPTY;
  }

  private damageBossAtWorld(
    wx: number,
    wy: number,
    radius: number,
    power: number,
    baseDmg: number,
    damageType: DamageType,
    ignite: boolean,
    isDirectHit: boolean
  ): void {
    const boss = this.boss;
    if (!boss) return;

    const originX = boss.x - boss.w * 0.5;
    const originY = boss.y - boss.h;
    const clx = wx - originX;
    const cly = wy - originY;
    const ir = Math.ceil(radius);

    let armorCleared = 0;
    let coreCleared = 0;
    let touchedCore = false;
    let mulSum = 0;
    let mulCount = 0;

    for (let dy = -ir; dy <= ir; dy++) {
      const ly = Math.round(cly + dy);
      if (ly < 0 || ly >= boss.h) continue;
      for (let dx = -ir; dx <= ir; dx++) {
        const lx = Math.round(clx + dx);
        if (lx < 0 || lx >= boss.w) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;

        const idx = ly * boss.w + lx;
        const m = boss.mats[idx] as Mat;
        if (m === Mat.EMPTY) continue;

        const props = MAT_PROPS[m];
        const isCorePx = boss.isCore[idx] === 1;
        if (isCorePx) touchedCore = true;

        const rawMul = props.damageMul[damageType] ?? 1.0;
        const effMul = isCorePx ? Math.max(0.95, rawMul) : rawMul;
        mulSum += effMul;
        mulCount++;

        const distRatio = dist / Math.max(1, radius);
        const rawHit = power * 5.2 * (1.25 - distRatio * 0.75);
        const effDmg = rawHit * effMul;
        const dmgDelta = effDmg >= 0.85 ? Math.round(effDmg) : Math.random() < effDmg ? 1 : 0;
        const nextDmg = boss.pixelDmg[idx] + dmgDelta;

        if (nextDmg >= props.maxHp || (isCorePx && dist <= radius * 0.65)) {
          const col = boss.colors[idx];
          boss.mats[idx] = Mat.EMPTY;
          boss.colors[idx] = 0;
          boss.pixelDmg[idx] = 0;
          boss.canvasDirty = true;
          this.world.pixelsDestroyedCount++;

          if (isCorePx) {
            boss.isCore[idx] = 0;
            boss.corePixelsRemaining = Math.max(0, boss.corePixelsRemaining - 1);
            coreCleared++;
          } else {
            armorCleared++;
          }

          if (Math.random() < 0.45) {
            this.world.spawnParticle(
              originX + lx + 0.5,
              originY + ly + 0.5,
              (dx + (Math.random() - 0.5) * 4) * 14,
              (dy - 2) * 14 - Math.random() * 45,
              isCorePx ? Mat.EMBER : ignite ? Mat.EMBER : Mat.RUBBLE,
              col,
              0.85,
              !isCorePx
            );
          }
        } else if (dmgDelta > 0) {
          boss.pixelDmg[idx] = Math.min(254, nextDmg);
          boss.canvasDirty = true;
          if (effMul < 0.55 && Math.random() < 0.25) {
            this.world.spawnParticle(
              originX + lx + 0.5,
              originY + ly + 0.5,
              (Math.random() - 0.5) * 90,
              -30 - Math.random() * 45,
              Mat.EMBER,
              packColor(255, 232, 160),
              0.24,
              false
            );
          }
        }
      }
    }

    const avgMul = mulCount > 0 ? Math.max(0.5, Math.min(1.55, mulSum / mulCount)) : 1.0;
    const railLv = this.getRelicLevel('RAIL_FOCUSER');
    const focuserMul = railLv > 0 ? 1 + 0.45 * railLv : 1.0;
    const coreBonus = touchedCore || coreCleared > 0 ? 2.6 : 1.0;
    const chipBonus = armorCleared * 0.45 + coreCleared * 3.5;
    const rawDmg = isDirectHit ? baseDmg : Math.max(baseDmg * 0.65, chipBonus);
    const totalDmg = rawDmg * avgMul * coreBonus * focuserMul;
    const dispDmg = Math.max(1, Math.round(totalDmg));

    boss.hp = Math.max(0, boss.hp - totalDmg);
    boss.hurtFlash = 0.1;

    const label =
      coreBonus > 1
        ? `CORE -${dispDmg}!`
        : avgMul >= 1.35
        ? `WEAK -${dispDmg}`
        : avgMul <= 0.65
        ? `RESIST -${dispDmg}`
        : `${dispDmg}`;
    const labelColor =
      coreBonus > 1
        ? '#38BDF8'
        : avgMul >= 1.35
        ? '#FACC15'
        : avgMul <= 0.65
        ? '#94A3B8'
        : '#F4F4F5';

    this.spawnFloatingText(wx, wy - 6, label, labelColor);

    const coreThreshold = Math.floor(boss.corePixelsTotal * 0.08);
    if (boss.corePixelsRemaining <= coreThreshold || boss.hp <= 0) {
      this.defeatBoss(boss.corePixelsRemaining <= coreThreshold);
    }
  }

  private defeatBoss(byWeakSpot: boolean): void {
    const boss = this.boss;
    if (!boss) return;

    const originX = boss.x - boss.w * 0.5;
    const originY = boss.y - boss.h;
    for (let ly = 0; ly < boss.h; ly++) {
      for (let lx = 0; lx < boss.w; lx++) {
        const idx = ly * boss.w + lx;
        const m = boss.mats[idx] as Mat;
        if (m === Mat.EMPTY) continue;
        this.world.pixelsDestroyedCount++;
        if (Math.random() < 0.42) {
          this.world.spawnParticle(
            originX + lx + 0.5,
            originY + ly + 0.5,
            (lx - boss.w * 0.5) * 8 + (Math.random() - 0.5) * 80,
            (ly - boss.h * 0.5) * 6 - 40 - Math.random() * 60,
            boss.isCore[idx] ? Mat.EMBER : Mat.RUBBLE,
            boss.colors[idx],
            1.1,
            !boss.isCore[idx]
          );
        }
      }
    }

    sfx.playExplosion(1.6);
    this.shakeMag = Math.max(this.shakeMag, 8.5);
    this.spawnShockRing(boss.x, boss.y - boss.h * 0.5, 58, '#38BDF8');
    this.spawnShockRing(boss.x, boss.y - boss.h * 0.5, 36, '#F59E0B');

    this.kills++;
    this.portal.active = true;

    this.spawnFloatingText(
      boss.x,
      boss.y - boss.h - 10,
      byWeakSpot ? `${boss.weakSpotName.toUpperCase()} SHATTERED!` : `${boss.name.toUpperCase()} DEFEATED!`,
      '#FACC15'
    );

    const goldShards = 18 + this.depth;
    for (let g = 0; g < goldShards; g++) {
      this.pickups.push({
        id: this.nextId++,
        kind: 'GOLD',
        x: boss.x + (Math.random() - 0.5) * 16,
        y: boss.y - boss.h * 0.5,
        vx: (Math.random() - 0.5) * 130,
        vy: -80 - Math.random() * 75,
        value: 5,
        age: 0,
      });
    }
    for (let h = 0; h < 2; h++) {
      this.pickups.push({
        id: this.nextId++,
        kind: 'HEALTH',
        x: boss.x + (h === 0 ? -8 : 8),
        y: boss.y - boss.h * 0.5,
        vx: (h === 0 ? -1 : 1) * 45,
        vy: -90,
        value: 25,
        age: 0,
      });
    }
    const dropWeaponId = LOOTABLE_WEAPONS[Math.floor(Math.random() * LOOTABLE_WEAPONS.length)];
    this.pickups.push({
      id: this.nextId++,
      kind: 'WEAPON',
      x: boss.x,
      y: boss.y - boss.h * 0.5,
      vx: 0,
      vy: -105,
      value: 1,
      weaponId: dropWeaponId,
      age: 0,
    });

    this.boss = null;
    this.bossRelicPendingTimer = 0.85;
    this.emitHud();
  }

  private openBossRelicChoice(): void {
    const allIds = Object.keys(BOSS_RELICS) as RelicId[];
    const shuffled = [...allIds].sort(() => Math.random() - 0.5);
    const choices: RelicDraftOption[] = shuffled.slice(0, 3).map((id) => {
      const currentLevel = this.getRelicLevel(id);
      return {
        def: BOSS_RELICS[id],
        currentLevel,
        nextLevel: currentLevel + 1,
      };
    });
    this.setState('BOSS_RELIC');
    this.callbacks.onBossRelicChoices(choices);
  }

  private damagePlayer(dmg: number, knockDir: number): void {
    const p = this.player;
    p.hp = Math.max(0, p.hp - dmg);
    p.invulnTimer = 0.65;
    if (knockDir !== 0) {
      p.vx = knockDir * 115;
      p.vy = -85;
    }
    this.shakeMag = Math.max(this.shakeMag, 4.0);
    this.spawnFloatingText(p.x, p.y - p.h - 4, `-${dmg}`, '#EF4444');
    sfx.playHurt();
    this.emitHud();

    if (p.hp <= 0) {
      this.setState('GAME_OVER');
      this.callbacks.onGameOver({
        depth: this.depth,
        biomeName: this.biome.name,
        seed: this.seed,
        kills: this.kills,
        pixelsDestroyed: this.world.pixelsDestroyedCount,
        segmentsCollapsed: this.world.segmentsCollapsedCount,
        goldCollected: p.gold,
        elapsedSeconds: Math.round(this.elapsedSeconds),
      });
    }
  }

  private findPickupSurfaceAbove(px: number, py: number, maxSearch = 72): number | null {
    for (let step = 0; step <= maxSearch; step++) {
      const ty = py - step;
      if (ty <= 5) return null;
      if (
        !this.world.isSolid(px, ty) &&
        !(this.world.isSolid(px - 1, ty) && this.world.isSolid(px + 1, ty)) &&
        !this.world.isSolid(px, ty - 1) &&
        !this.world.isSolid(px, ty - 2)
      ) {
        return ty;
      }
    }
    return null;
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    const salvageLv = this.getRelicLevel('SALVAGE_MAGNET');
    const magnetRadius = salvageLv > 0
      ? 150 + 50 * (salvageLv - 1)
      : this.hasPerk('MAGNET_RELAY')
      ? 92
      : 24;

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.age += dt;

      const dx = p.x - pk.x;
      const dy = p.y - p.h * 0.5 - pk.y;
      const dist = Math.hypot(dx, dy);

      const px = Math.round(pk.x);
      const py = Math.round(pk.y);
      const buriedCenter =
        this.world.isSolid(px, py) ||
        (this.world.isSolid(px - 1, py) && this.world.isSolid(px + 1, py));
      const buriedTop =
        pk.vy >= -10 &&
        (this.world.isSolid(px, py - 1) ||
          (this.world.isSolid(px - 1, py - 1) && this.world.isSolid(px + 1, py - 1)));

      let migrating = false;
      if (buriedCenter || buriedTop) {
        const topY = this.findPickupSurfaceAbove(px, py, 72);
        if (topY !== null) {
          migrating = true;
          const migrateSpeed = 120;
          pk.y = Math.max(topY, pk.y - migrateSpeed * dt);
          pk.vy = 0;
          pk.vx *= 0.85;
        }
      }

      if (!migrating) {
        pk.vy += GRAVITY * 0.75 * dt;

        if (dist < magnetRadius && dist > 1) {
          pk.vx += (dx / dist) * 320 * dt;
          pk.vy += (dy / dist) * 320 * dt;
        }

        const nx = pk.x + pk.vx * dt;
        const ny = pk.y + pk.vy * dt;
        if (!this.world.isSolid(Math.round(nx), Math.round(pk.y))) {
          pk.x = nx;
        } else {
          pk.vx *= -0.3;
        }
        if (!this.world.isSolid(Math.round(pk.x), Math.round(ny))) {
          pk.y = ny;
        } else {
          pk.vy = 0;
          pk.vx *= 0.8;
        }
      } else if (dist < magnetRadius && dist > 1) {
        // Still allow subtle horizontal pull toward player while emerging
        const nx = pk.x + Math.sign(dx) * Math.min(Math.abs(dx), 60 * dt);
        if (!this.world.isSolid(Math.round(nx), Math.round(pk.y))) {
          pk.x = nx;
        }
      }

      if (dist < 10) {
        if (pk.kind === 'GOLD') {
          p.gold += pk.value;
          sfx.playPickup('gold');
        } else if (pk.kind === 'HEALTH') {
          p.hp = Math.min(p.maxHp, p.hp + pk.value);
          this.spawnFloatingText(p.x, p.y - p.h - 3, `+${pk.value} HP`, '#10B981');
          sfx.playPickup('health');
        } else if (pk.kind === 'WEAPON' && pk.weaponId) {
          this.grantWeaponOrDupe(pk.weaponId, p.x, p.y - p.h - 6);
          sfx.playPickup('upgrade');
          this.emitHud();
        }
        this.pickups.splice(i, 1);
      }
    }
  }

  private moveEntityWithPixelCollision(
    ent: { x: number; y: number; vx: number; vy: number; w: number; h: number; grounded: boolean },
    dx: number,
    dy: number,
    allowStepUp: boolean,
    isPlayer = false
  ): void {
    const halfW = Math.floor(ent.w * 0.5);
    const legH = 6; // bottom 6px correspond to player's feet & legs

    // If fallen pixels settled around the player's feet/legs, gently float up onto them when headroom allows
    if (isPlayer && !this.collidesUpperBody(ent.x, ent.y, halfW, ent.h, legH)) {
      for (let lift = 0; lift < 2; lift++) {
        if (
          this.collidesBox(ent.x, ent.y, halfW, ent.h) &&
          !this.collidesUpperBody(ent.x, ent.y - 1, halfW, ent.h, legH)
        ) {
          ent.y -= 1;
        } else {
          break;
        }
      }
    }

    const maxStepUp = isPlayer ? legH : 3;

    // Horizontal move + step-up over rubble + leg-pixel wading for player
    if (dx !== 0) {
      const steps = Math.max(1, Math.ceil(Math.abs(dx)));
      const stepX = dx / steps;
      for (let s = 0; s < steps; s++) {
        const testX = ent.x + stepX;
        if (!this.collidesBox(testX, ent.y, halfW, ent.h)) {
          ent.x = testX;
        } else if (allowStepUp) {
          let stepped = false;
          for (let up = 1; up <= maxStepUp; up++) {
            if (!this.collidesBox(testX, ent.y - up, halfW, ent.h)) {
              ent.x = testX;
              ent.y -= up;
              stepped = true;
              break;
            }
          }
          if (!stepped && isPlayer && !this.collidesUpperBody(testX, ent.y, halfW, ent.h, legH)) {
            const alreadyEmbedded = this.collidesBox(ent.x, ent.y, halfW, ent.h);
            if (this.tryWadeLegPixels(testX, ent.y, halfW, legH, Math.sign(dx), alreadyEmbedded)) {
              ent.x = testX;
              stepped = true;
            }
          }
          if (!stepped) {
            ent.vx = 0;
            break;
          }
        } else {
          ent.vx = 0;
          break;
        }
      }
    }

    // Vertical move
    ent.grounded = false;
    if (dy !== 0) {
      const steps = Math.max(1, Math.ceil(Math.abs(dy)));
      const stepY = dy / steps;
      for (let s = 0; s < steps; s++) {
        const testY = ent.y + stepY;
        const blocked =
          isPlayer && dy < 0
            ? this.collidesUpperBody(ent.x, testY, halfW, ent.h, legH)
            : this.collidesBox(ent.x, testY, halfW, ent.h);
        if (!blocked) {
          ent.y = testY;
        } else {
          if (dy > 0) ent.grounded = true;
          ent.vy = 0;
          break;
        }
      }
    } else {
      ent.grounded =
        this.collidesBox(ent.x, ent.y + 1, halfW, ent.h) ||
        (isPlayer && this.collidesBox(ent.x, ent.y, halfW, ent.h));
    }

    ent.x = Math.max(6 + halfW, Math.min(WORLD_W - 6 - halfW, ent.x));
    ent.y = Math.max(ent.h + 5, Math.min(WORLD_H - 5, ent.y));
  }

  private tryWadeLegPixels(
    cx: number,
    bottomY: number,
    halfW: number,
    legH: number,
    moveDir: number,
    alreadyEmbedded: boolean
  ): boolean {
    const x0 = Math.round(cx - halfW);
    const x1 = Math.round(cx + halfW);
    const y0 = Math.round(bottomY - legH + 1);
    const y1 = Math.round(bottomY);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const m = this.world.getMat(x, y);
        if (!MAT_PROPS[m].solid) continue;
        if (m === Mat.BEDROCK) return false;
        if (!MAT_PROPS[m].powder && (!alreadyEmbedded || MAT_PROPS[m].hardness > 3)) {
          return false;
        }
      }
    }

    // Scatter overlapping pixels in the leading foot edge so debris yields around player boots
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const m = this.world.getMat(x, y);
        if (!MAT_PROPS[m].solid) continue;
        const idx = y * WORLD_W + x;
        const col = this.world.color[idx];
        this.world.setPixel(x, y, Mat.EMPTY, 0);
        if (Math.random() < 0.35) {
          this.world.spawnParticle(
            x + 0.5,
            y + 0.5,
            -moveDir * (18 + Math.random() * 28) + (Math.random() - 0.5) * 16,
            -26 - Math.random() * 34,
            m,
            col,
            1.1,
            true
          );
        }
      }
    }
    return true;
  }

  private collidesUpperBody(
    cx: number,
    bottomY: number,
    halfW: number,
    h: number,
    legH: number
  ): boolean {
    return this.collidesRange(cx, bottomY - h + 1, bottomY - legH, halfW);
  }

  private collidesRange(cx: number, yTop: number, yBot: number, halfW: number): boolean {
    const x0 = Math.round(cx - halfW);
    const x1 = Math.round(cx + halfW);
    const xc = Math.round(cx);
    const y0 = Math.round(yTop);
    const y1 = Math.round(yBot);
    for (let y = y0; y <= y1; y += 2) {
      if (this.world.isSolid(x0, y) || this.world.isSolid(x1, y) || this.world.isSolid(xc, y)) {
        return true;
      }
    }
    return this.world.isSolid(x0, y1) || this.world.isSolid(x1, y1) || this.world.isSolid(xc, y1);
  }

  private collidesBox(cx: number, bottomY: number, halfW: number, h: number): boolean {
    return this.collidesRange(cx, bottomY - h + 1, bottomY, halfW);
  }

  private spawnFloatingText(x: number, y: number, text: string, color: string): void {
    this.floatingTexts.push({ x, y, vy: -22, text, color, life: 0.75 });
  }

  private spawnShockRing(x: number, y: number, maxRadius: number, color: string): void {
    this.shockRings.push({ x, y, radius: 2, maxRadius, color, life: 0.24, maxLife: 0.24 });
  }

  private updateEffects(dt: number): void {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const f = this.floatingTexts[i];
      f.y += f.vy * dt;
      f.life -= dt;
      if (f.life <= 0) this.floatingTexts.splice(i, 1);
    }
    for (let i = this.beamFlashes.length - 1; i >= 0; i--) {
      this.beamFlashes[i].life -= dt;
      if (this.beamFlashes[i].life <= 0) this.beamFlashes.splice(i, 1);
    }
    for (let i = this.shockRings.length - 1; i >= 0; i--) {
      const r = this.shockRings[i];
      r.life -= dt;
      r.radius = r.maxRadius * (1 - r.life / r.maxLife);
      if (r.life <= 0) this.shockRings.splice(i, 1);
    }
  }

  private getAimWorldTarget(): { x: number; y: number } {
    const p = this.player;
    if (this.touchAimActive || this.touchAimHoldTimer > 0 || !this.hasPointerMoved) {
      return {
        x: p.x + Math.cos(p.aimAngle) * 44,
        y: p.y - p.h * 0.45 + Math.sin(p.aimAngle) * 44,
      };
    }
    return this.getMouseWorld();
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    const mw = this.getAimWorldTarget();
    const leadX = Math.max(-32, Math.min(32, (mw.x - p.x) * 0.2));
    const leadY = Math.max(-20, Math.min(20, (mw.y - p.y) * 0.16));

    const targetX = p.x + leadX - this.viewSimW * 0.5;
    const targetY = p.y - p.h * 0.5 + leadY - this.viewSimH * (this.viewSimH > 260 ? 0.44 : 0.52);

    this.camX += (targetX - this.camX) * Math.min(1, 8 * dt);
    this.camY += (targetY - this.camY) * Math.min(1, 8 * dt);

    this.camX = Math.max(0, Math.min(WORLD_W - this.viewSimW, this.camX));
    this.camY = Math.max(0, Math.min(WORLD_H - this.viewSimH, this.camY));

    this.shakeMag = Math.max(0, this.shakeMag - 16 * dt);
  }

  private emitHud(): void {
    if (!this.player) return;
    const p = this.player;
    let nearInteractable: string | null = null;
    for (const ped of this.pedestals) {
      if (!ped.used && Math.hypot(ped.x - p.x, ped.y - p.y) < 22) {
        nearInteractable = `Press F to claim ${ped.weaponOffer ? WEAPONS[ped.weaponOffer].name : 'Relic'}`;
        break;
      }
    }
    if (!nearInteractable && Math.hypot(this.portal.x - p.x, this.portal.y - (p.y - 8)) < 22) {
      if (this.portal.active) {
        nearInteractable = `Press F to descend to Depth ${this.depth + 1}`;
      } else if (this.boss) {
        nearInteractable = `Portal sealed — defeat ${this.boss.name} to unlock`;
      }
    }

    const rechargeDur = this.hasPerk('DEMOLITIONIST') ? 4.8 : 7.5;
    const dashMax = this.hasPerk('TWIN_THRUSTERS') ? 0.65 : 0.95;

    this.callbacks.onHudUpdate({
      hp: p.hp,
      maxHp: p.maxHp,
      bombs: p.bombs,
      maxBombs: p.maxBombs,
      bombRechargePct: p.bombs >= p.maxBombs ? 1 : p.bombRechargeTimer / rechargeDur,
      dashReadyPct: p.dashCooldown <= 0 ? 1 : 1 - p.dashCooldown / dashMax,
      gold: p.gold,
      depth: this.depth,
      biomeName: this.biome.name,
      hudPalette: this.biome.hudPalette,
      seed: this.seed,
      weapons: p.weapons.map((id) => WEAPONS[id]),
      weaponDupes: p.weapons.map((id) => p.weaponDupes[id] ?? 0),
      activeWeaponIdx: p.activeWeaponIdx,
      perks: p.perks.map((id) => PERKS[id]),
      relics: p.relics.map((id) => ({
        def: BOSS_RELICS[id],
        level: p.relicLevels[id] ?? 1,
      })),
      kills: this.kills,
      pixelsDestroyed: this.world.pixelsDestroyedCount,
      segmentsCollapsed: this.world.segmentsCollapsedCount,
      nearInteractable,
      enemiesRemaining: this.enemies.length + (this.boss ? 1 : 0),
      bossAlert: this.boss ? `${this.boss.name} — ${this.boss.subtitle}` : null,
      boss: this.boss
        ? {
            name: this.boss.name,
            subtitle: this.boss.subtitle,
            weakSpotName: this.boss.weakSpotName,
            hp: Math.ceil(this.boss.hp),
            maxHp: this.boss.maxHp,
            corePct: Math.max(
              0,
              Math.round((this.boss.corePixelsRemaining / Math.max(1, this.boss.corePixelsTotal)) * 100)
            ),
          }
        : null,
    });
  }

  private render(): void {
    this.world.renderToOffscreen();

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scaleX = cw / this.viewSimW;
    const scaleY = ch / this.viewSimH;

    const shakeX = this.shakeMag > 0.1 ? (Math.random() - 0.5) * this.shakeMag : 0;
    const shakeY = this.shakeMag > 0.1 ? (Math.random() - 0.5) * this.shakeMag : 0;
    const sx = Math.max(0, Math.min(WORLD_W - this.viewSimW, this.camX + shakeX));
    const sy = Math.max(0, Math.min(WORLD_H - this.viewSimH, this.camY + shakeY));

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      this.world.offscreen,
      sx,
      sy,
      this.viewSimW,
      this.viewSimH,
      0,
      0,
      cw,
      ch
    );

    if (this.state === 'TITLE_MENU') {
      this.renderAtmosphereLighting(sx, sy, cw, ch, scaleX, scaleY, false);
      return;
    }

    this.ctx.save();
    this.ctx.scale(scaleX, scaleY);
    this.ctx.translate(-sx, -sy);

    // 1. Descent Portal
    if (this.portal) {
      const t = performance.now() * 0.004;
      const px = this.portal.x;
      const py = this.portal.y + 4;
      const [pr, pg, pb] = this.biome.hudPalette.accentRgb;
      if (this.portal.active) {
        this.ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, 0.24)`;
        this.ctx.beginPath();
        this.ctx.ellipse(px, py, 10 + Math.sin(t) * 1.5, 14 + Math.cos(t) * 1.5, 0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.strokeStyle = this.biome.atmosphere.portalHex;
        this.ctx.lineWidth = 1.4;
        this.ctx.beginPath();
        this.ctx.ellipse(px, py, 7, 11, 0, 0, Math.PI * 2);
        this.ctx.stroke();

        this.ctx.fillStyle = '#F8FAFC';
        this.ctx.fillRect(px - 1, py - 1 + Math.sin(t * 2) * 3, 2, 2);
      } else {
        this.ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
        this.ctx.beginPath();
        this.ctx.ellipse(px, py, 9, 13, 0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.strokeStyle = '#EF4444';
        this.ctx.lineWidth = 1.2;
        this.ctx.beginPath();
        this.ctx.ellipse(px, py, 7, 11, 0, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }

    // 2. Relic Pedestals
    for (const ped of this.pedestals) {
      this.ctx.fillStyle = '#475569';
      this.ctx.fillRect(ped.x - 5, ped.y - 4, 10, 4);
      this.ctx.fillStyle = '#94A3B8';
      this.ctx.fillRect(ped.x - 3, ped.y - 7, 6, 3);
      if (!ped.used) {
        const bob = Math.sin(performance.now() * 0.005) * 1.5;
        this.ctx.fillStyle = '#38BDF8';
        this.ctx.fillRect(ped.x - 2, ped.y - 13 + bob, 4, 4);
      }
    }

    // 3. Pickups
    for (const pk of this.pickups) {
      if (pk.kind === 'GOLD') {
        this.ctx.fillStyle = '#FACC15';
        this.ctx.fillRect(Math.round(pk.x - 1), Math.round(pk.y - 2), 3, 3);
        this.ctx.fillStyle = '#FEF08A';
        this.ctx.fillRect(Math.round(pk.x), Math.round(pk.y - 2), 1, 1);
      } else if (pk.kind === 'WEAPON' && pk.weaponId) {
        const wCol = WEAPONS[pk.weaponId].color;
        const bob = Math.sin(performance.now() * 0.008 + pk.id) * 1.2;
        const wx = Math.round(pk.x - 3);
        const wy = Math.round(pk.y - 5 + bob);
        this.ctx.fillStyle = '#0F172A';
        this.ctx.fillRect(wx - 1, wy - 1, 8, 6);
        this.ctx.fillStyle = wCol;
        this.ctx.fillRect(wx, wy, 6, 4);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(wx + 1, wy + 1, 4, 1);
      } else {
        this.ctx.fillStyle = '#10B981';
        this.ctx.fillRect(Math.round(pk.x - 2), Math.round(pk.y - 3), 4, 4);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(Math.round(pk.x - 1), Math.round(pk.y - 2), 2, 2);
      }
    }

    // 4. Enemies & Pixel Boss
    for (const en of this.enemies) {
      this.drawEnemy(en);
    }
    if (this.boss) {
      this.drawBoss(this.boss);
    }

    // 5. Player
    if (this.player) {
      this.drawPlayer(this.player);
    }

    // 6. Projectiles & Bombs
    for (const pr of this.projectiles) {
      if (pr.isBomb) {
        const blink = Math.floor(pr.fuse * 10) % 2 === 0;
        this.ctx.fillStyle = blink ? '#F59E0B' : '#EF4444';
        this.ctx.fillRect(Math.round(pr.x - 2), Math.round(pr.y - 2), 5, 5);
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(Math.round(pr.x), Math.round(pr.y - 3), 1, 1);
      } else {
        this.ctx.fillStyle = pr.color;
        this.ctx.fillRect(Math.round(pr.x - pr.radius * 0.5), Math.round(pr.y - pr.radius * 0.5), Math.ceil(pr.radius * 1.4), Math.ceil(pr.radius * 1.4));
      }
    }

    // 7. Beams & Shockwaves
    for (const b of this.beamFlashes) {
      this.ctx.strokeStyle = b.color;
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      this.ctx.moveTo(b.x0, b.y0);
      this.ctx.lineTo(b.x1, b.y1);
      this.ctx.stroke();
    }

    for (const r of this.shockRings) {
      this.ctx.globalAlpha = Math.max(0, r.life / r.maxLife);
      this.ctx.strokeStyle = r.color;
      this.ctx.lineWidth = 1.2;
      this.ctx.beginPath();
      this.ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    }

    this.ctx.restore();

    // Depth-reactive lighting atmosphere & dynamic emissive light pools
    this.renderAtmosphereLighting(sx, sy, cw, ch, scaleX, scaleY, true);

    // 8. Floating damage / info numbers & 9. Reticle (rendered above atmosphere haze for crisp legibility)
    this.ctx.save();
    this.ctx.scale(scaleX, scaleY);
    this.ctx.translate(-sx, -sy);

    this.ctx.font = 'bold 6px "JetBrains Mono", monospace';
    this.ctx.textAlign = 'center';
    for (const f of this.floatingTexts) {
      this.ctx.globalAlpha = Math.min(1, f.life * 1.8);
      this.ctx.fillStyle = f.color;
      this.ctx.fillText(f.text, Math.round(f.x), Math.round(f.y));
      this.ctx.globalAlpha = 1;
    }

    if (this.state === 'PLAYING' && (this.hasPointerMoved || this.touchAimActive || this.touchAimHoldTimer > 0)) {
      const mw = this.getAimWorldTarget();
      const rx = Math.round(mw.x);
      const ry = Math.round(mw.y);
      this.ctx.strokeStyle = this.biome.hudPalette.accentHex;
      this.ctx.lineWidth = 0.85;
      this.ctx.strokeRect(rx - 3, ry - 3, 6, 6);
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.fillRect(rx, ry, 1, 1);
    }

    this.ctx.restore();
  }

  private renderAtmosphereLighting(
    sx: number,
    sy: number,
    cw: number,
    ch: number,
    scaleX: number,
    scaleY: number,
    withEntities: boolean
  ): void {
    const atm = this.biome?.atmosphere;
    if (!atm) return;
    const ctx = this.ctx;

    // 1. Depth-shifted ambient atmospheric gradient wash
    const [ar, ag, ab] = atm.ambientTintRgb;
    const hazeGrad = ctx.createLinearGradient(0, 0, 0, ch);
    hazeGrad.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${(atm.ambientAlpha * 0.45).toFixed(3)})`);
    hazeGrad.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, ${atm.ambientAlpha.toFixed(3)})`);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, 0, cw, ch);

    // 2. Subterranean lantern vignette focused around player (or viewport center on Title)
    const focusScreenX =
      withEntities && this.player ? (this.player.x - sx) * scaleX : cw * 0.5;
    const focusScreenY =
      withEntities && this.player ? (this.player.y - this.player.h * 0.5 - sy) * scaleY : ch * 0.5;
    const outerRadius = Math.max(cw, ch) * 0.78 * atm.lightRadiusScale;
    const innerRadius = Math.min(cw, ch) * 0.16 * atm.lightRadiusScale;
    const [vr, vg, vb] = atm.vignetteRgb;

    const vigGrad = ctx.createRadialGradient(
      focusScreenX,
      focusScreenY,
      Math.max(8, innerRadius),
      focusScreenX,
      focusScreenY,
      Math.max(24, outerRadius)
    );
    vigGrad.addColorStop(0, `rgba(${vr}, ${vg}, ${vb}, 0)`);
    vigGrad.addColorStop(0.55, `rgba(${vr}, ${vg}, ${vb}, ${(atm.vignetteAlpha * 0.35).toFixed(3)})`);
    vigGrad.addColorStop(1, `rgba(${vr}, ${vg}, ${vb}, ${atm.vignetteAlpha.toFixed(3)})`);
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, cw, ch);

    // 3. Additive light blooms from player lantern, torches, fire, crystals, portal & boss
    const drawBloom = (wx: number, wy: number, simRad: number, rgb: [number, number, number], alpha: number) => {
      const gx = (wx - sx) * scaleX;
      const gy = (wy - sy) * scaleY;
      const rad = simRad * Math.max(scaleX, scaleY);
      if (gx + rad < 0 || gx - rad > cw || gy + rad < 0 || gy - rad > ch) return;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
      grad.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`);
      grad.addColorStop(0.45, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(alpha * 0.36).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
    };

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const pulse = 0.92 + 0.08 * Math.sin(performance.now() * 0.005);

    if (withEntities && this.player) {
      drawBloom(
        this.player.x,
        this.player.y - this.player.h * 0.55,
        54 * atm.lightRadiusScale * pulse,
        atm.lightColorRgb,
        atm.lightAlpha * 0.85
      );
    }

    // Sparse viewport scan for active torches, fire & glowing crystals
    const xStart = Math.max(2, Math.floor(sx));
    const xEnd = Math.min(WORLD_W - 3, Math.ceil(sx + this.viewSimW));
    const yStart = Math.max(2, Math.floor(sy));
    const yEnd = Math.min(WORLD_H - 3, Math.ceil(sy + this.viewSimH));
    let emittersDrawn = 0;
    for (let wy = yStart; wy < yEnd && emittersDrawn < 18; wy += 9) {
      for (let wx = xStart; wx < xEnd && emittersDrawn < 18; wx += 9) {
        const m = this.world.getMat(wx, wy);
        if (m === Mat.TORCH || m === Mat.FIRE) {
          drawBloom(wx + 0.5, wy + 0.5, 26 * pulse, [255, 162, 58], atm.lightAlpha * 0.88);
          emittersDrawn++;
        } else if (m === Mat.CRYSTAL) {
          drawBloom(wx + 0.5, wy + 0.5, 20 * pulse, atm.crystalGlowRgb, atm.lightAlpha * 0.65);
          emittersDrawn++;
        }
      }
    }

    if (withEntities) {
      if (this.portal) {
        drawBloom(
          this.portal.x,
          this.portal.y + 4,
          this.portal.active ? 34 * pulse : 20,
          this.portal.active ? atm.lightColorRgb : [239, 68, 68],
          atm.lightAlpha * 0.9
        );
      }
      if (this.boss) {
        drawBloom(
          this.boss.x,
          this.boss.y - this.boss.h * 0.5,
          44 * pulse,
          atm.crystalGlowRgb,
          atm.lightAlpha * 0.95
        );
      }
      let ringCount = 0;
      for (const r of this.shockRings) {
        if (ringCount++ >= 4) break;
        drawBloom(r.x, r.y, r.radius + 14, atm.lightColorRgb, (r.life / r.maxLife) * 0.32);
      }
    }

    ctx.restore();
  }

  private drawPlayer(p: Player): void {
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (p.invulnTimer > 0 && Math.floor(p.invulnTimer * 18) % 2 === 0) {
      this.ctx.globalAlpha = 0.45;
    }

    const walk = Math.abs(p.vx) > 10 ? Math.sin(performance.now() * 0.02) * 2 : 0;
    this.ctx.fillStyle = '#334155';
    this.ctx.fillRect(px - 3, py - 5 + (walk > 0 ? -1 : 0), 2, 5);
    this.ctx.fillRect(px + 1, py - 5 + (walk < 0 ? -1 : 0), 2, 5);

    this.ctx.fillStyle = '#1E293B';
    this.ctx.fillRect(px - 3, py - 11, 6, 6);
    this.ctx.fillStyle = '#D97706';
    this.ctx.fillRect(px - p.facing * 4, py - 11, 2, 6);

    this.ctx.fillStyle = '#E2E8F0';
    this.ctx.fillRect(px - 3, py - 15, 6, 4);
    this.ctx.fillStyle = '#38BDF8';
    this.ctx.fillRect(p.facing > 0 ? px + 1 : px - 3, py - 14, 2, 2);

    const bx = px + Math.cos(p.aimAngle) * 6;
    const by = py - 8 + Math.sin(p.aimAngle) * 6;
    this.ctx.strokeStyle = WEAPONS[p.weapons[p.activeWeaponIdx]].color;
    this.ctx.lineWidth = 1.6;
    this.ctx.beginPath();
    this.ctx.moveTo(px, py - 8);
    this.ctx.lineTo(bx, by);
    this.ctx.stroke();

    this.ctx.globalAlpha = 1;
  }

  private drawBoss(boss: PixelBoss): void {
    const bctx = this.bossCanvas.getContext('2d');
    if (bctx && boss.canvasDirty) {
      const img = bctx.createImageData(boss.w, boss.h);
      const u32 = new Uint32Array(img.data.buffer);
      for (let i = 0; i < boss.mats.length; i++) {
        const m = boss.mats[i] as Mat;
        if (m === Mat.EMPTY) {
          u32[i] = 0;
        } else {
          const d = boss.pixelDmg[i];
          if (d === 0) {
            u32[i] = boss.colors[i];
          } else {
            const maxHp = MAT_PROPS[m].maxHp || 24;
            const frac = Math.min(1, d / maxHp);
            const mul = frac > 0.45 && ((i ^ (i >> 5)) & 1) === 0 ? 0.44 : 1 - frac * 0.4;
            const c = boss.colors[i];
            const r = ((c & 0xff) * mul) | 0;
            const g = (((c >>> 8) & 0xff) * mul) | 0;
            const b = (((c >>> 16) & 0xff) * mul) | 0;
            u32[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
          }
        }
      }
      bctx.putImageData(img, 0, 0);
      boss.canvasDirty = false;
    }

    const bx = Math.round(boss.x - boss.w * 0.5);
    const by = Math.round(boss.y - boss.h);
    this.ctx.drawImage(this.bossCanvas, bx, by);

    // Shimmer highlight over intact Special Spot pixels + subtle target brackets
    const pulse = 0.45 + 0.35 * Math.sin(performance.now() * 0.008);
    this.ctx.fillStyle =
      boss.hurtFlash > 0
        ? 'rgba(255,255,255,0.65)'
        : boss.biomeId === 'SUNKEN_MASONRY'
        ? `rgba(56, 189, 248, ${pulse * 0.45})`
        : boss.biomeId === 'ASHEN_FOUNDRY'
        ? `rgba(251, 146, 60, ${pulse * 0.5})`
        : `rgba(74, 222, 128, ${pulse * 0.5})`;

    let minCx = boss.w;
    let maxCx = -1;
    let minCy = boss.h;
    let maxCy = -1;
    for (let ly = 0; ly < boss.h; ly++) {
      for (let lx = 0; lx < boss.w; lx++) {
        const idx = ly * boss.w + lx;
        if (boss.mats[idx] !== Mat.EMPTY && boss.isCore[idx] === 1) {
          this.ctx.fillRect(bx + lx, by + ly, 1, 1);
          if (lx < minCx) minCx = lx;
          if (lx > maxCx) maxCx = lx;
          if (ly < minCy) minCy = ly;
          if (ly > maxCy) maxCy = ly;
        }
      }
    }

    if (maxCx >= minCx) {
      this.ctx.strokeStyle =
        boss.biomeId === 'SUNKEN_MASONRY'
          ? `rgba(125, 211, 252, ${0.4 + pulse * 0.4})`
          : boss.biomeId === 'ASHEN_FOUNDRY'
          ? `rgba(253, 186, 116, ${0.4 + pulse * 0.4})`
          : `rgba(134, 239, 172, ${0.4 + pulse * 0.4})`;
      this.ctx.lineWidth = 0.7;
      this.ctx.strokeRect(bx + minCx - 1, by + minCy - 1, maxCx - minCx + 3, maxCy - minCy + 3);
    }
  }

  private drawEnemy(en: Enemy): void {
    const ex = Math.round(en.x);
    const ey = Math.round(en.y);
    const flash = en.hurtFlash > 0;

    if (en.kind === 'STONE_WARDEN') {
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#475569';
      this.ctx.fillRect(ex - 6, ey - 17, 12, 17);
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#78716C';
      this.ctx.fillRect(ex - 5, ey - 15, 10, 11);
      this.ctx.fillStyle = '#38BDF8';
      this.ctx.fillRect(ex - 2, ey - 11, 4, 3);
    } else if (en.kind === 'PYRO_IMP') {
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#9A3412';
      this.ctx.fillRect(ex - 4, ey - 9, 8, 7);
      this.ctx.fillStyle = '#F97316';
      this.ctx.fillRect(ex - 6, ey - 10, 2, 4);
      this.ctx.fillRect(ex + 4, ey - 10, 2, 4);
      this.ctx.fillStyle = '#FDE047';
      this.ctx.fillRect(ex + en.facing * 2, ey - 7, 2, 2);
    } else if (en.kind === 'CRYSTAL_WISP') {
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#10B981';
      this.ctx.fillRect(ex - 3, ey - 10, 6, 8);
      this.ctx.fillStyle = '#BBF7D0';
      this.ctx.fillRect(ex - 1, ey - 8, 2, 4);
      this.ctx.fillRect(ex - 4, ey - 6, 1, 3);
      this.ctx.fillRect(ex + 3, ey - 6, 1, 3);
    } else if (en.kind === 'DRONE') {
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#475569';
      this.ctx.fillRect(ex - 4, ey - 6, 9, 5);
      this.ctx.fillStyle = '#FB7185';
      this.ctx.fillRect(ex + en.facing * 2, ey - 4, 2, 2);
    } else if (en.kind === 'SENTINEL') {
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#64748B';
      this.ctx.fillRect(ex - 5, ey - 15, 10, 15);
      this.ctx.fillStyle = '#F59E0B';
      this.ctx.fillRect(ex - 2, ey - 12, 4, 2);
    } else if (en.kind === 'SLIME') {
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#22C55E';
      this.ctx.fillRect(ex - 4, ey - 7, 8, 7);
      this.ctx.fillStyle = '#BBF7D0';
      this.ctx.fillRect(ex - 2, ey - 5, 2, 2);
    } else if (en.kind === 'TURRET') {
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#94A3B8';
      this.ctx.fillRect(ex - 4, ey - 8, 8, 8);
      this.ctx.fillStyle = '#F43F5E';
      this.ctx.fillRect(ex + en.facing * 3, ey - 6, 3, 2);
    } else {
      // CRAWLER
      this.ctx.fillStyle = flash ? '#FFFFFF' : '#B91C1C';
      this.ctx.fillRect(ex - 4, ey - 7, 8, 5);
      this.ctx.fillStyle = '#FDE047';
      this.ctx.fillRect(ex + en.facing * 2, ey - 6, 2, 2);
      this.ctx.fillStyle = '#7F1D1D';
      this.ctx.fillRect(ex - 4, ey - 2, 2, 2);
      this.ctx.fillRect(ex + 2, ey - 2, 2, 2);
    }

    if (en.hp < en.maxHp) {
      const pct = Math.max(0, en.hp / en.maxHp);
      this.ctx.fillStyle = 'rgba(0,0,0,0.7)';
      this.ctx.fillRect(ex - 5, ey - en.h - 4, 10, 2);
      this.ctx.fillStyle = '#EF4444';
      this.ctx.fillRect(ex - 5, ey - en.h - 4, Math.round(10 * pct), 2);
    }
  }
}
