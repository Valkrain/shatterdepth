export const WORLD_W = 1280;
export const WORLD_H = 384;
export const CHUNK_SIZE = 32;
export const CHUNKS_X = WORLD_W / CHUNK_SIZE; // 40
export const CHUNKS_Y = WORLD_H / CHUNK_SIZE; // 12

export enum Mat {
  EMPTY = 0,
  BEDROCK = 1,
  STONE = 2,
  DIRT = 3,
  SAND = 4,
  BRICK = 5,
  WOOD = 6,
  METAL = 7,
  CRYSTAL = 8,
  GOLD = 9,
  MOSS = 10,
  WATER = 11,
  ACID = 12,
  OIL = 13,
  FIRE = 14,
  EMBER = 15,
  SMOKE = 16,
  ASH = 17,
  RUBBLE = 18,
  BANNER = 19,
  JAR = 20,
  CHAIN = 21,
  TORCH = 22,
  BARREL = 23,
}

export type DamageType =
  | 'KINETIC'
  | 'EXPLOSIVE'
  | 'THERMAL'
  | 'PLASMA'
  | 'ARC'
  | 'CORROSIVE'
  | 'LASER';

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  KINETIC: 'Kinetic',
  EXPLOSIVE: 'Explosive',
  THERMAL: 'Thermal',
  PLASMA: 'Plasma',
  ARC: 'Arc',
  CORROSIVE: 'Corrosive',
  LASER: 'Laser',
};

export interface MaterialProps {
  solid: boolean;
  liquid: boolean;
  gas: boolean;
  powder: boolean;
  flammable: boolean;
  hardness: number; // 1..255 (255 = indestructible)
  maxHp: number; // per-pixel durability before breaking (0..255)
  weight: number;
  corrodible: boolean;
  damageMul: Partial<Record<DamageType, number>>;
}

export const MAT_PROPS: Record<Mat, MaterialProps> = {
  [Mat.EMPTY]: {
    solid: false, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 0, maxHp: 0, weight: 0, corrodible: false, damageMul: {},
  },
  [Mat.BEDROCK]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 255, maxHp: 255, weight: 100, corrodible: false, damageMul: {},
  },
  [Mat.STONE]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 5, maxHp: 52, weight: 10, corrodible: true,
    damageMul: { KINETIC: 0.35, THERMAL: 0.4, ARC: 0.6, EXPLOSIVE: 1.85, PLASMA: 1.6, LASER: 1.55, CORROSIVE: 1.4 },
  },
  [Mat.DIRT]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 1, maxHp: 8, weight: 4, corrodible: true,
    damageMul: { EXPLOSIVE: 1.8, KINETIC: 1.45, LASER: 1.4, THERMAL: 1.2, ARC: 0.3, CORROSIVE: 1.25 },
  },
  [Mat.SAND]: {
    solid: true, liquid: false, gas: false, powder: true, flammable: false,
    hardness: 1, maxHp: 7, weight: 4, corrodible: true,
    damageMul: { EXPLOSIVE: 1.9, KINETIC: 1.5, LASER: 1.4, PLASMA: 1.35, ARC: 0.25 },
  },
  [Mat.BRICK]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 3, maxHp: 30, weight: 8, corrodible: true,
    damageMul: { EXPLOSIVE: 2.2, CORROSIVE: 1.6, PLASMA: 1.45, LASER: 1.35, KINETIC: 0.78, THERMAL: 0.5, ARC: 0.55 },
  },
  [Mat.WOOD]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: true,
    hardness: 2, maxHp: 16, weight: 3, corrodible: true,
    damageMul: { THERMAL: 2.8, EXPLOSIVE: 1.5, LASER: 1.45, KINETIC: 1.35, PLASMA: 1.6, ARC: 0.35, CORROSIVE: 0.9 },
  },
  [Mat.METAL]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 8, maxHp: 86, weight: 14, corrodible: true,
    damageMul: { KINETIC: 0.22, THERMAL: 0.45, EXPLOSIVE: 0.65, LASER: 0.75, PLASMA: 1.65, ARC: 2.3, CORROSIVE: 2.6 },
  },
  [Mat.CRYSTAL]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 2, maxHp: 24, weight: 5, corrodible: false,
    damageMul: { ARC: 3.0, EXPLOSIVE: 2.2, LASER: 1.7, PLASMA: 1.4, KINETIC: 0.95, THERMAL: 0.55, CORROSIVE: 0.15 },
  },
  [Mat.GOLD]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 2, maxHp: 22, weight: 9, corrodible: false,
    damageMul: { EXPLOSIVE: 1.6, LASER: 1.6, KINETIC: 1.3, ARC: 1.5, PLASMA: 1.4, THERMAL: 0.6, CORROSIVE: 0.1 },
  },
  [Mat.MOSS]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: true,
    hardness: 1, maxHp: 6, weight: 1, corrodible: true,
    damageMul: { THERMAL: 3.0, CORROSIVE: 1.8, KINETIC: 1.5, EXPLOSIVE: 1.7, LASER: 1.6, ARC: 0.4 },
  },
  [Mat.WATER]: {
    solid: false, liquid: true, gas: false, powder: false, flammable: false,
    hardness: 0, maxHp: 1, weight: 2, corrodible: false, damageMul: { ARC: 1.5 },
  },
  [Mat.ACID]: {
    solid: false, liquid: true, gas: false, powder: false, flammable: false,
    hardness: 0, maxHp: 1, weight: 2, corrodible: false, damageMul: {},
  },
  [Mat.OIL]: {
    solid: false, liquid: true, gas: false, powder: false, flammable: true,
    hardness: 0, maxHp: 1, weight: 1, corrodible: false, damageMul: { THERMAL: 2.5, PLASMA: 2.0 },
  },
  [Mat.FIRE]: {
    solid: false, liquid: false, gas: true, powder: false, flammable: false,
    hardness: 0, maxHp: 1, weight: 0, corrodible: false, damageMul: {},
  },
  [Mat.EMBER]: {
    solid: false, liquid: false, gas: false, powder: true, flammable: false,
    hardness: 0, maxHp: 1, weight: 1, corrodible: false, damageMul: {},
  },
  [Mat.SMOKE]: {
    solid: false, liquid: false, gas: true, powder: false, flammable: false,
    hardness: 0, maxHp: 1, weight: 0, corrodible: false, damageMul: {},
  },
  [Mat.ASH]: {
    solid: true, liquid: false, gas: false, powder: true, flammable: false,
    hardness: 1, maxHp: 5, weight: 1, corrodible: true,
    damageMul: { EXPLOSIVE: 2.0, KINETIC: 1.5, LASER: 1.5 },
  },
  [Mat.RUBBLE]: {
    solid: true, liquid: false, gas: false, powder: true, flammable: false,
    hardness: 2, maxHp: 14, weight: 5, corrodible: true,
    damageMul: { EXPLOSIVE: 2.0, PLASMA: 1.5, LASER: 1.4, CORROSIVE: 1.35, KINETIC: 1.1, ARC: 0.7 },
  },
  [Mat.BANNER]: {
    solid: false, liquid: false, gas: false, powder: false, flammable: true,
    hardness: 1, maxHp: 5, weight: 1, corrodible: true,
    damageMul: { THERMAL: 3.0, KINETIC: 1.6, EXPLOSIVE: 1.8, LASER: 1.6 },
  },
  [Mat.JAR]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 1, maxHp: 8, weight: 3, corrodible: true,
    damageMul: { EXPLOSIVE: 2.4, KINETIC: 2.0, ARC: 1.7, LASER: 1.5, THERMAL: 0.8 },
  },
  [Mat.CHAIN]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 2, maxHp: 24, weight: 4, corrodible: true,
    damageMul: { ARC: 2.6, CORROSIVE: 2.2, PLASMA: 1.7, LASER: 1.5, KINETIC: 0.65, THERMAL: 0.45 },
  },
  [Mat.TORCH]: {
    solid: false, liquid: false, gas: false, powder: false, flammable: false,
    hardness: 1, maxHp: 5, weight: 1, corrodible: true,
    damageMul: { KINETIC: 1.5, EXPLOSIVE: 1.8, LASER: 1.5 },
  },
  [Mat.BARREL]: {
    solid: true, liquid: false, gas: false, powder: false, flammable: true,
    hardness: 1, maxHp: 6, weight: 4, corrodible: true,
    damageMul: { THERMAL: 3.0, EXPLOSIVE: 2.5, PLASMA: 2.5, KINETIC: 1.8, ARC: 1.8 },
  },
};

export type BiomeId = 'SUNKEN_MASONRY' | 'ASHEN_FOUNDRY' | 'VITRIOL_VAULTS';

export interface LightingAtmosphere {
  ambientTintRgb: [number, number, number];
  ambientAlpha: number;
  vignetteRgb: [number, number, number];
  vignetteAlpha: number;
  lightColorRgb: [number, number, number];
  lightAlpha: number;
  lightRadiusScale: number;
  crystalGlowRgb: [number, number, number];
  portalHex: string;
}

export interface HudPalette {
  accentHex: string;
  accentSoftHex: string;
  accentRgb: [number, number, number];
  accentBorder: string;
  accentGlow: string;
  panelBg: string;
  atmosphereTitle: string;
}

export interface BiomeConfig {
  id: BiomeId;
  name: string;
  bgSkyTop: [number, number, number];
  bgSkyBottom: [number, number, number];
  stoneBase: [number, number, number];
  dirtBase: [number, number, number];
  brickBase: [number, number, number];
  woodBase: [number, number, number];
  mossBase: [number, number, number];
  crystalBase: [number, number, number];
  bannerRgb: [number, number, number];
  liquidPrimary: Mat.WATER | Mat.OIL | Mat.ACID;
  accentHex: string;
  atmosphere: LightingAtmosphere;
  hudPalette: HudPalette;
}

export type GameState = 'TITLE_MENU' | 'PLAYING' | 'PAUSED' | 'LEVEL_UPGRADE' | 'BOSS_RELIC' | 'GAME_OVER';

export type WeaponId =
  | 'PULSE_CARBINE'
  | 'EMBER_SCATTER'
  | 'FLAK_CANNON'
  | 'PLASMA_RAIL'
  | 'ARC_CASTER'
  | 'ACID_MORTAR'
  | 'MINING_BEAM';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  damageType: DamageType;
  description: string;
  cooldown: number; // seconds
  damage: number;
  speed: number;
  spread: number;
  pellets: number;
  blastRadius: number;
  blastPower: number;
  pierce: number;
  gravity: number;
  ignite: boolean;
  acid: boolean;
  isBeam?: boolean;
  color: string;
}

export type ClassId = 'BREACHER' | 'PYROMANCER' | 'EXCAVATOR';

export interface ClassDef {
  id: ClassId;
  name: string;
  summary: string;
  maxHp: number;
  primaryWeapon: WeaponId;
  secondaryWeapon: WeaponId;
  maxBombs: number;
  speedMul: number;
}

export type PerkId =
  | 'SEISMIC_ROUNDS'
  | 'DEMOLITIONIST'
  | 'THERMITE_PAYLOAD'
  | 'TITAN_PLATING'
  | 'VAMPIRIC_CORE'
  | 'TWIN_THRUSTERS'
  | 'MAGNET_RELAY'
  | 'OVERCLOCKED_BARREL'
  | 'TUNGSTEN_SLUGS'
  | 'CLUSTER_SHRAPNEL'
  | 'CRYO_SHIELDING'
  | 'STRUCTURAL_SABOTEUR';

export interface PerkDef {
  id: PerkId;
  name: string;
  description: string;
  category: 'Demolition' | 'Combat' | 'Mobility' | 'Survival';
}

export type RelicId =
  | 'SIEGE_HEART'
  | 'THERMAL_REACTOR'
  | 'RAIL_FOCUSER'
  | 'CHRONO_THRUSTER'
  | 'ALCHEMIST_HEART'
  | 'SALVAGE_MAGNET';

export interface RelicDef {
  id: RelicId;
  name: string;
  buildFocus: string;
  description: string;
  accentColor: string;
}

export interface RelicDraftOption {
  def: RelicDef;
  currentLevel: number;
  nextLevel: number;
}

export interface DynamicParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mat: Mat;
  color: number; // packed Uint32 ABGR
  life: number;
  maxLife: number;
  bounces: number;
  settleOnRest: boolean;
  igniteOnHit: boolean;
}

export interface CrumblingBody {
  id: number;
  x: number; // center world x
  y: number; // center world y
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  w: number;
  h: number;
  cx: number; // local center of mass x
  cy: number; // local center of mass y
  mats: Uint8Array;
  colors: Uint32Array;
  pixelCount: number;
  age: number;
  settledFrames: number;
  hasCrushedOnce: boolean;
}

export type EnemyKind =
  | 'CRAWLER'
  | 'DRONE'
  | 'SENTINEL'
  | 'SLIME'
  | 'TURRET'
  | 'STONE_WARDEN'
  | 'PYRO_IMP'
  | 'CRYSTAL_WISP';

export interface PixelBoss {
  id: number;
  biomeId: BiomeId;
  name: string;
  subtitle: string;
  weakSpotName: string;
  x: number; // center x
  y: number; // bottom y
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  corePixelsRemaining: number;
  corePixelsTotal: number;
  totalPixelsInitial: number;
  mats: Uint8Array;
  colors: Uint32Array;
  pixelDmg: Uint8Array;
  isCore: Uint8Array;
  canvasDirty: boolean;
  facing: 1 | -1;
  phaseTimer: number;
  attackCd: number;
  secondaryCd: number;
  hurtFlash: number;
  anchorX: number;
  anchorY: number;
  arenaMinX: number;
  arenaMaxX: number;
  arenaFloorY: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  grounded: boolean;
  attackCd: number;
  aiTimer: number;
  hurtFlash: number;
  goldValue: number;
}

export interface Projectile {
  id: number;
  fromPlayer: boolean;
  damageType: DamageType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  blastRadius: number;
  blastPower: number;
  pierce: number;
  gravity: number;
  ignite: boolean;
  acid: boolean;
  isBomb: boolean;
  fuse: number;
  color: string;
  radius: number;
  age: number;
}

export interface Pickup {
  id: number;
  kind: 'GOLD' | 'HEALTH' | 'BOMB' | 'WEAPON';
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  weaponId?: WeaponId;
  age: number;
}

export interface RelicPedestal {
  id: number;
  x: number;
  y: number;
  used: boolean;
  weaponOffer?: WeaponId;
}

export interface Portal {
  x: number;
  y: number;
  active: boolean;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  facing: 1 | -1;
  aimAngle: number;
  grounded: boolean;
  coyoteTimer: number;
  jumpBufferTimer: number;
  jumpsRemaining: number;
  maxAirJumps: number;
  dashTimer: number;
  dashCooldown: number;
  invulnTimer: number;
  weapons: WeaponId[];
  weaponDupes: Partial<Record<WeaponId, number>>;
  activeWeaponIdx: number;
  fireCooldown: number;
  bombs: number;
  maxBombs: number;
  bombRechargeTimer: number;
  gold: number;
  perks: PerkId[];
  relics: RelicId[];
  relicLevels: Partial<Record<RelicId, number>>;
}

export interface RunStats {
  depth: number;
  biomeName: string;
  seed: number;
  kills: number;
  pixelsDestroyed: number;
  segmentsCollapsed: number;
  goldCollected: number;
  elapsedSeconds: number;
}

export interface HudSnapshot {
  hp: number;
  maxHp: number;
  bombs: number;
  maxBombs: number;
  bombRechargePct: number;
  dashReadyPct: number;
  gold: number;
  depth: number;
  biomeName: string;
  hudPalette: HudPalette;
  seed: number;
  weapons: WeaponDef[];
  weaponDupes: number[];
  activeWeaponIdx: number;
  perks: PerkDef[];
  relics: { def: RelicDef; level: number }[];
  kills: number;
  pixelsDestroyed: number;
  segmentsCollapsed: number;
  nearInteractable: string | null;
  enemiesRemaining: number;
  bossAlert: string | null;
  boss: {
    name: string;
    subtitle: string;
    weakSpotName: string;
    hp: number;
    maxHp: number;
    corePct: number;
  } | null;
}

export interface MetaProgress {
  bestDepth: number;
  bestGold: number;
  totalPixelsDestroyed: number;
  totalCollapses: number;
  runsCompleted: number;
}
