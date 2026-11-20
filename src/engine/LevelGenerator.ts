import { getBiomeForDepth, LOOTABLE_WEAPONS } from './catalog';
import { PixelWorld } from './PixelWorld';
import { fbm2D, jitterColor, packColor, SeededRNG, tintColor } from './prng';
import {
  BiomeConfig,
  BiomeId,
  Enemy,
  EnemyKind,
  Mat,
  Pickup,
  PixelBoss,
  Portal,
  RelicPedestal,
  WORLD_H,
  WORLD_W,
} from './types';

export interface GeneratedLevel {
  biome: BiomeConfig;
  spawnX: number;
  spawnY: number;
  portal: Portal;
  enemies: Enemy[];
  pickups: Pickup[];
  pedestals: RelicPedestal[];
  boss: PixelBoss | null;
}

type RoomKind =
  | 'START'
  | 'RUIN'
  | 'BRIDGE'
  | 'SHAFT'
  | 'VAULT'
  | 'CATACOMB'
  | 'FOUNDRY_CHAMBER'
  | 'CRYSTAL_GROTTO'
  | 'GAUNTLET'
  | 'PORTAL';

type PathProfile = 'ASCENDING' | 'DESCENDING' | 'UNDULATING' | 'STEPPED_TIERS' | 'CHASM_CAVERNS';

interface Waypoint {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RoomKind;
}

export function generateLevel(world: PixelWorld, seed: number, depth: number): GeneratedLevel {
  const levelSeed = (seed ^ (depth * 2654435761)) >>> 0;
  const rng = new SeededRNG(levelSeed);
  const biome = getBiomeForDepth(depth, seed);

  world.clear(biome.bgSkyTop, biome.bgSkyBottom);

  // 1. Base cavern rock & dirt strata using 2D FBM noise (varied strata frequency per depth)
  const noiseScaleX = rng.range(0.018, 0.029);
  const noiseScaleY = rng.range(0.022, 0.036);
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      if (x < 4 || x >= WORLD_W - 4 || y < 4 || y >= WORLD_H - 4) {
        world.setPixel(x, y, Mat.BEDROCK, jitterColor([32, 34, 40], () => rng.next(), 6));
        continue;
      }

      const n = fbm2D(x * noiseScaleX, y * noiseScaleY, levelSeed, 3);
      const detail = fbm2D(x * 0.09, y * 0.09, levelSeed + 313, 2);

      const bgShade = 0.32 + detail * 0.16;
      world.setBgPixel(
        x,
        y,
        packColor(
          biome.stoneBase[0] * bgShade,
          biome.stoneBase[1] * bgShade,
          biome.stoneBase[2] * bgShade
        )
      );

      if (n > 0.62 && detail > 0.63) {
        world.setPixel(x, y, Mat.GOLD, jitterColor([245, 194, 52], () => rng.next(), 24));
      } else if (n > 0.56) {
        world.setPixel(x, y, Mat.STONE, jitterColor(biome.stoneBase, () => rng.next(), 14));
      } else if (n > 0.42) {
        world.setPixel(x, y, Mat.DIRT, jitterColor(biome.dirtBase, () => rng.next(), 15));
      } else {
        world.setPixel(x, y, Mat.STONE, jitterColor(biome.stoneBase, () => rng.next(), 12));
      }
    }
  }

  // Boss Floor every 10 depths!
  if (depth > 0 && depth % 10 === 0) {
    return generateBossLevel(world, biome, depth, rng);
  }

  // 2. Varied Macro Path Profile
  const profiles: PathProfile[] = ['ASCENDING', 'DESCENDING', 'UNDULATING', 'STEPPED_TIERS', 'CHASM_CAVERNS'];
  const profile = profiles[(depth + rng.int(0, profiles.length - 1)) % profiles.length];
  const waypoints: Waypoint[] = [];
  const numZones = 8;

  let startY = rng.int(165, 225);
  if (profile === 'ASCENDING') startY = rng.int(248, 286);
  else if (profile === 'DESCENDING') startY = rng.int(92, 134);
  else if (profile === 'CHASM_CAVERNS') startY = rng.int(140, 185);

  waypoints.push({ x: 74, y: startY, w: 96, h: 74, kind: 'START' });

  let curY = startY;
  for (let i = 1; i < numZones - 1; i++) {
    const t = i / (numZones - 1);
    const wx = Math.round(148 + ((i - 0.5) / (numZones - 2)) * (WORLD_W - 314)) + rng.int(-20, 20);

    let targetY = curY;
    if (profile === 'ASCENDING') {
      targetY = curY - rng.int(18, 42) + rng.int(-14, 10);
    } else if (profile === 'DESCENDING') {
      targetY = curY + rng.int(18, 42) + rng.int(-10, 14);
    } else if (profile === 'STEPPED_TIERS') {
      targetY = i % 2 === 1 ? curY + rng.int(-76, -44) : curY + rng.int(44, 76);
    } else if (profile === 'UNDULATING') {
      targetY = 192 + Math.round(Math.sin(t * Math.PI * 2.4 + rng.next() * 0.6) * 86);
    } else {
      // CHASM_CAVERNS
      targetY = curY + rng.int(-56, 56);
    }

    curY = Math.max(84, Math.min(WORLD_H - 92, targetY));
    const kind = pickRoomKind(biome.id, i, rng);
    const baseW = profile === 'CHASM_CAVERNS' ? rng.int(120, 162) : rng.int(104, 148);
    const baseH = profile === 'CHASM_CAVERNS' ? rng.int(98, 132) : rng.int(80, 118);

    waypoints.push({
      x: wx,
      y: curY,
      w: baseW,
      h: baseH,
      kind,
    });
  }

  const portalY =
    profile === 'ASCENDING'
      ? Math.max(82, curY - rng.int(12, 34))
      : profile === 'DESCENDING'
      ? Math.min(WORLD_H - 86, curY + rng.int(12, 34))
      : Math.max(88, Math.min(WORLD_H - 90, curY + rng.int(-42, 42)));

  waypoints.push({ x: WORLD_W - 82, y: portalY, w: 102, h: 84, kind: 'PORTAL' });

  // Carve rooms + connecting tunnels (with extra cavern pockets on Chasm/Undulating)
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    carveCavernBox(world, wp.x, wp.y, wp.w, wp.h, rng);

    if (i > 0) {
      const prev = waypoints[i - 1];
      carveTunnel(world, prev.x, prev.y, wp.x, wp.y, rng.int(24, 38), rng);
    }
  }

  // Carve 2–3 optional upper/lower side chambers sealed behind destructible walls
  const sideCount = rng.int(2, 3);
  for (let s = 0; s < sideCount; s++) {
    const anchor = waypoints[rng.int(1, waypoints.length - 2)];
    const dirY = anchor.y > WORLD_H * 0.5 ? -1 : 1;
    const sy = Math.max(64, Math.min(WORLD_H - 64, anchor.y + dirY * rng.int(74, 96)));
    const sx = Math.max(90, Math.min(WORLD_W - 90, anchor.x + rng.int(-36, 36)));
    carveCavernBox(world, sx, sy, rng.int(78, 96), rng.int(52, 66), rng);
    carveTunnel(world, anchor.x, anchor.y, sx, sy, 13, rng);
    drawBrickBlock(world, sx - 14, Math.round((anchor.y + sy) / 2) - 5, 28, 10, biome, rng);
    drawBrickBlock(world, sx - 24, sy + 18, 48, 6, biome, rng);
    drawFoundationPier(world, sx - 24, sy + 23, 10, biome, rng);
    drawFoundationPier(world, sx + 14, sy + 23, 10, biome, rng);
    stampCrystalCluster(world, sx - 16, sy + 17, biome, rng, -1);
    stampGoldVein(world, sx + 12, sy + 10, rng);
    if (rng.chance(0.55)) {
      stampJar(world, sx - 2, sy + 12, rng);
    }
  }

  // Flatten spawn & portal stone pedestals with grounded foundation piers
  const spawnWp = waypoints[0];
  const portalWp = waypoints[waypoints.length - 1];
  const spawnFloorY = spawnWp.y + Math.floor(spawnWp.h * 0.34);
  const portalFloorY = portalWp.y + Math.floor(portalWp.h * 0.34);

  drawBrickBlock(world, spawnWp.x - 32, spawnFloorY, 64, 10, biome, rng);
  drawFoundationPier(world, spawnWp.x - 32, spawnFloorY + 9, 10, biome, rng);
  drawFoundationPier(world, spawnWp.x + 22, spawnFloorY + 9, 10, biome, rng);

  drawBrickBlock(world, portalWp.x - 36, portalFloorY, 72, 10, biome, rng);
  drawFoundationPier(world, portalWp.x - 36, portalFloorY + 9, 10, biome, rng);
  drawFoundationPier(world, portalWp.x + 26, portalFloorY + 9, 10, biome, rng);

  decorateCavernSurfaces(world, biome, rng);

  // 4. Populate each waypoint room with destructible architecture, traps, and biome-scaled enemies
  const enemies: Enemy[] = [];
  const pickups: Pickup[] = [];
  const pedestals: RelicPedestal[] = [];
  let entityId = 1;

  stampTorch(world, spawnWp.x - 20, spawnFloorY - 1, rng);
  stampTorch(world, spawnWp.x + 20, spawnFloorY - 1, rng);
  stampBanner(world, spawnWp.x - 10, spawnFloorY - 26, biome, rng);

  for (let i = 1; i < waypoints.length - 1; i++) {
    const wp = waypoints[i];
    const floorY = wp.y + Math.floor(wp.h * 0.34);

    if (wp.kind === 'BRIDGE') {
      const pitDepth = rng.int(24, 30);
      carveRect(world, wp.x - 34, floorY - 4, 68, pitDepth);
      drawVatBasin(world, wp.x - 32, floorY + 8, 64, pitDepth - 12, biome.liquidPrimary, biome, rng);

      // Grounded masonry abutments + stepped corbels + overlapping timber span
      drawBrickBlock(world, wp.x - 46, floorY, 14, 24, biome, rng);
      drawBrickBlock(world, wp.x + 32, floorY, 14, 24, biome, rng);
      drawFoundationPier(world, wp.x - 46, floorY + 23, 14, biome, rng);
      drawFoundationPier(world, wp.x + 32, floorY + 23, 14, biome, rng);
      drawCorbelBracket(world, wp.x - 32, floorY + 4, 1, 5, biome, rng);
      drawCorbelBracket(world, wp.x + 31, floorY + 4, -1, 5, biome, rng);
      drawWoodPlank(world, wp.x - 38, floorY, 76, 4, biome, rng);

      if (rng.chance(0.8)) {
        const bx = wp.x + rng.int(-14, 14);
        const ceilY = findCeilingSolidY(world, bx, wp.y);
        if (ceilY !== null && floorY - ceilY > 42) {
          stampHangingBarrel(world, bx, ceilY - 1, rng.int(12, Math.min(22, floorY - ceilY - 26)), rng);
        }
      }
      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x, floorY - 10, depth));
      if (depth >= 4 && rng.chance(0.55)) {
        enemies.push(makeEnemy(entityId++, pickAerialEnemy(biome.id, rng), wp.x + rng.int(-24, 24), wp.y - 18, depth));
      }
    } else if (wp.kind === 'CATACOMB') {
      // Multi-tiered crypt with full load-bearing piers, continuous walls to vaulted roof, and pillared shelves
      const cw = rng.int(72, 90);
      const cx = wp.x - Math.floor(cw / 2);
      const roofY = floorY - 54;
      paintInteriorBg(world, cx + 2, roofY + 2, cw - 4, 52, biome, rng);

      drawBrickBlock(world, cx - 4, floorY, cw + 8, 8, biome, rng);
      drawFoundationPier(world, cx - 4, floorY + 7, 10, biome, rng);
      drawFoundationPier(world, wp.x - 5, floorY + 7, 10, biome, rng);
      drawFoundationPier(world, cx + cw - 6, floorY + 7, 10, biome, rng);

      // Continuous brick walls connected into both floor and roof cap
      drawBrickBlock(world, cx, roofY + 4, 8, 50, biome, rng);
      drawBrickBlock(world, cx + cw - 8, roofY + 4, 8, 50, biome, rng);
      drawBrickBlock(world, cx - 4, roofY, cw + 8, 7, biome, rng);
      drawCorbelBracket(world, cx + 8, roofY + 7, 1, 5, biome, rng);
      drawCorbelBracket(world, cx + cw - 9, roofY + 7, -1, 5, biome, rng);

      // Wall-anchored side shelves + pillared central sand-hopper platform
      drawWoodPlank(world, cx + 6, floorY - 22, 26, 4, biome, rng);
      drawCorbelBracket(world, cx + 8, floorY - 18, 1, 4, biome, rng);

      drawWoodPlank(world, cx + cw - 32, floorY - 30, 26, 4, biome, rng);
      drawCorbelBracket(world, cx + cw - 9, floorY - 26, -1, 4, biome, rng);

      drawBrickBlock(world, wp.x - 2, floorY - 40, 4, 40, biome, rng);
      drawWoodPlank(world, wp.x - 16, floorY - 42, 32, 3, biome, rng);
      drawSandBed(world, wp.x - 13, floorY - 49, 26, 7, rng);

      stampJar(world, cx + 14, floorY - 28, rng);
      stampJar(world, cx + cw - 24, floorY - 36, rng);
      stampTorch(world, cx + 13, floorY - 1, rng);
      stampBanner(world, wp.x - 12, roofY + 8, biome, rng);

      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x - 14, floorY - 10, depth));
      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), cx + cw - 22, floorY - 38, depth));
    } else if (wp.kind === 'FOUNDRY_CHAMBER') {
      // Grounded steel-framed chamber with contained liquid vat and roof-anchored hanging barrel
      const fw = rng.int(76, 94);
      const fx = wp.x - Math.floor(fw / 2);
      paintInteriorBg(world, fx + 2, floorY - 58, fw - 4, 58, biome, rng);
      drawBrickBlock(world, fx, floorY, fw, 8, biome, rng);
      drawFoundationPier(world, fx, floorY + 7, 10, biome, rng);
      drawFoundationPier(world, fx + fw - 10, floorY + 7, 10, biome, rng);

      // Contained central vat strictly between the steel stanchions
      carveRect(world, wp.x - 17, floorY - 2, 34, 12);
      drawVatBasin(world, wp.x - 17, floorY + 1, 34, 10, biome.liquidPrimary, biome, rng);

      // Heavy steel gantry grounded onto outer masonry & braced with rivets/corbels
      drawMetalBeam(world, fx + 6, floorY - 34, 6, 36, rng);
      drawMetalBeam(world, fx + fw - 12, floorY - 34, 6, 36, rng);
      drawMetalBeam(world, fx + 4, floorY - 36, fw - 8, 5, rng);
      drawCorbelBracket(world, fx + 12, floorY - 31, 1, 5, biome, rng, true);
      drawCorbelBracket(world, fx + fw - 13, floorY - 31, -1, 5, biome, rng, true);

      stampBarrel(world, wp.x - 20, floorY - 44, rng);
      stampBarrel(world, wp.x + 14, floorY - 44, rng);
      const ceilY = findCeilingSolidY(world, wp.x, wp.y);
      if (ceilY !== null && floorY - 36 - ceilY > 28) {
        stampHangingBarrel(world, wp.x, ceilY - 1, Math.min(16, floorY - 36 - ceilY - 18), rng);
      }
      stampTorch(world, fx + 15, floorY - 1, rng);

      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x, floorY - 42, depth));
      enemies.push(makeEnemy(entityId++, pickAerialEnemy(biome.id, rng), wp.x + 16, wp.y - 20, depth));
    } else if (wp.kind === 'CRYSTAL_GROTTO') {
      // Grounded crystal floor, pillared wooden walkway, and ceiling-rooted spire
      drawBrickBlock(world, wp.x - 36, floorY, 72, 8, biome, rng);
      drawFoundationPier(world, wp.x - 36, floorY + 7, 10, biome, rng);
      drawFoundationPier(world, wp.x + 26, floorY + 7, 10, biome, rng);

      drawWoodPlank(world, wp.x - 24, floorY - 26, 4, 26, biome, rng);
      drawWoodPlank(world, wp.x + 20, floorY - 26, 4, 26, biome, rng);
      drawWoodPlank(world, wp.x - 26, floorY - 27, 52, 4, biome, rng);
      drawCorbelBracket(world, wp.x - 20, floorY - 23, 1, 4, biome, rng);
      drawCorbelBracket(world, wp.x + 19, floorY - 23, -1, 4, biome, rng);

      stampCrystalCluster(world, wp.x - 14, floorY - 1, biome, rng, -1);
      stampCrystalCluster(world, wp.x + 14, floorY - 1, biome, rng, -1);
      const ceilY = findCeilingSolidY(world, wp.x, wp.y);
      if (ceilY !== null) {
        stampCrystalCluster(world, wp.x, ceilY - 1, biome, rng, 1);
      }
      stampGoldVein(world, wp.x, floorY + 12, rng);

      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x - 6, floorY - 34, depth));
      enemies.push(makeEnemy(entityId++, pickAerialEnemy(biome.id, rng), wp.x + 14, wp.y - 16, depth));
    } else if (wp.kind === 'GAUNTLET') {
      // Twin grounded brick fortifications + braced overhead firing bridge
      drawBrickBlock(world, wp.x - 42, floorY, 84, 8, biome, rng);
      drawFoundationPier(world, wp.x - 42, floorY + 7, 10, biome, rng);
      drawFoundationPier(world, wp.x + 32, floorY + 7, 10, biome, rng);

      drawBrickBlock(world, wp.x - 22, floorY - 27, 9, 28, biome, rng);
      drawBrickBlock(world, wp.x + 13, floorY - 34, 9, 35, biome, rng);
      drawWoodPlank(world, wp.x - 16, floorY - 27, 32, 4, biome, rng);
      drawCorbelBracket(world, wp.x - 13, floorY - 23, 1, 4, biome, rng);
      drawCorbelBracket(world, wp.x + 12, floorY - 23, -1, 4, biome, rng);
      stampBarrel(world, wp.x - 2, floorY - 35, rng);
      stampCrate(world, wp.x - 34, floorY - 8, biome, rng);

      enemies.push(makeEnemy(entityId++, 'TURRET', wp.x + 17, floorY - 42, depth));
      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x - 4, floorY - 10, depth));
    } else if (wp.kind === 'RUIN' || wp.kind === 'VAULT') {
      const rw = rng.int(62, 82);
      const rh = rng.int(46, 58);
      const rx = wp.x - Math.floor(rw / 2);
      const ry = floorY - rh;

      paintInteriorBg(world, rx + 2, ry + 2, rw - 4, rh - 2, biome, rng);
      drawBrickBlock(world, rx - 4, floorY, rw + 8, 8, biome, rng);
      drawFoundationPier(world, rx - 4, floorY + 7, 10, biome, rng);
      drawFoundationPier(world, rx + rw - 6, floorY + 7, 10, biome, rng);

      // Continuous load-bearing masonry walls from floor all the way into the roof cap
      drawBrickBlock(world, rx, ry + 5, 7, rh - 4, biome, rng);
      drawBrickBlock(world, rx + rw - 7, ry + 5, 7, rh - 4, biome, rng);
      drawBrickBlock(world, rx - 4, ry, rw + 8, 7, biome, rng);
      drawCorbelBracket(world, rx + 7, ry + 7, 1, 5, biome, rng);
      drawCorbelBracket(world, rx + rw - 8, ry + 7, -1, 5, biome, rng);
      for (let cx = rx - 2; cx < rx + rw; cx += 10) {
        drawBrickBlock(world, cx, ry - 4, 5, 5, biome, rng);
      }

      // Mid-level timber floor anchored into both walls + central load-bearing strut
      const midY = ry + Math.floor(rh * 0.54);
      drawWoodPlank(world, rx + 5, midY, rw - 10, 4, biome, rng);
      drawCorbelBracket(world, rx + 7, midY + 4, 1, 4, biome, rng);
      drawCorbelBracket(world, rx + rw - 8, midY + 4, -1, 4, biome, rng);
      drawWoodPlank(world, wp.x - 2, midY + 3, 4, floorY - (midY + 3), biome, rng);
      drawWoodPlank(world, rx + 12, ry + 6, 4, midY - (ry + 5), biome, rng);

      stampTorch(world, rx + 12, floorY - 1, rng);
      stampTorch(world, rx + rw - 13, midY - 1, rng);
      stampBanner(world, wp.x - 3, ry + 8, biome, rng);
      stampCrate(world, rx + 18, floorY - 8, biome, rng);
      stampJar(world, rx + rw - 16, floorY - 6, rng);

      if (rng.chance(0.75)) {
        stampBarrel(world, wp.x + rng.int(-6, 8), midY - 8, rng);
      }

      if (wp.kind === 'VAULT') {
        pedestals.push({
          id: entityId++,
          x: wp.x,
          y: floorY - 2,
          used: false,
          weaponOffer: rng.pick(LOOTABLE_WEAPONS),
        });
        stampCrystalCluster(world, rx + 10, midY - 1, biome, rng, -1);
      }

      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x + 8, midY - 10, depth));
      if (rng.chance(0.75)) {
        enemies.push(makeEnemy(entityId++, depth > 1 ? 'TURRET' : pickEnemyKind(depth, biome.id, rng), wp.x - 10, ry - 9, depth));
      }
      if (rng.chance(0.65)) {
        enemies.push(makeEnemy(entityId++, pickAerialEnemy(biome.id, rng), wp.x + rng.int(-22, 22), wp.y - 18, depth));
      }
    } else {
      // SHAFT: grounded scaffolding posts so elevated timber platforms never float
      drawBrickBlock(world, wp.x - 34, floorY, 68, 8, biome, rng);
      drawFoundationPier(world, wp.x - 34, floorY + 7, 10, biome, rng);
      drawFoundationPier(world, wp.x + 24, floorY + 7, 10, biome, rng);

      drawWoodPlank(world, wp.x - 26, floorY - 24, 4, 24, biome, rng);
      drawWoodPlank(world, wp.x - 8, floorY - 24, 4, 24, biome, rng);
      drawWoodPlank(world, wp.x - 30, floorY - 25, 28, 4, biome, rng);

      drawWoodPlank(world, wp.x + 8, floorY - 40, 4, 40, biome, rng);
      drawWoodPlank(world, wp.x + 26, floorY - 40, 4, 40, biome, rng);
      drawWoodPlank(world, wp.x + 4, floorY - 41, 28, 4, biome, rng);

      stampCrystalCluster(world, wp.x - 16, floorY - 1, biome, rng, -1);
      stampCrate(world, wp.x + 14, floorY - 8, biome, rng);
      stampJar(world, wp.x + 16, floorY - 47, rng);
      enemies.push(makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x, floorY - 10, depth));
      if (rng.chance(0.72)) {
        enemies.push(makeEnemy(entityId++, pickAerialEnemy(biome.id, rng), wp.x, floorY - 46, depth));
      }
    }

    // Extra enemy patrols scaling smoothly with depth
    if (depth >= 2 && rng.chance(Math.min(0.85, 0.35 + depth * 0.05))) {
      enemies.push(
        makeEnemy(entityId++, pickEnemyKind(depth, biome.id, rng), wp.x + rng.int(-22, 22), floorY - 12, depth)
      );
    }
    if (depth >= 6 && rng.chance(0.45)) {
      enemies.push(
        makeEnemy(entityId++, pickAerialEnemy(biome.id, rng), wp.x + rng.int(-26, 26), wp.y - 22, depth)
      );
    }
  }

  // Portal shrine frame
  stampTorch(world, portalWp.x - 22, portalFloorY - 1, rng);
  stampTorch(world, portalWp.x + 22, portalFloorY - 1, rng);
  stampCrystalCluster(world, portalWp.x - 30, portalFloorY - 1, biome, rng, -1);
  stampCrystalCluster(world, portalWp.x + 30, portalFloorY - 1, biome, rng, -1);

  world.markAllDirty();

  return {
    biome,
    spawnX: spawnWp.x,
    spawnY: spawnFloorY - 16,
    portal: {
      x: portalWp.x,
      y: portalFloorY - 16,
      active: true,
    },
    enemies,
    pickups,
    pedestals,
    boss: null,
  };
}

function generateBossLevel(
  world: PixelWorld,
  biome: BiomeConfig,
  depth: number,
  rng: SeededRNG
): GeneratedLevel {
  const enemies: Enemy[] = [];
  const pickups: Pickup[] = [];
  const pedestals: RelicPedestal[] = [];
  let entityId = 1;

  // 1. Staging Vestibule (left) + Breach Tunnel + Grand Vaulted Boss Arena (center-right) + Portal Sanctuary (far right)
  const spawnX = 110;
  const spawnFloorY = 236;
  const arenaMinX = 336;
  const arenaMaxX = 1120;
  const arenaCenterX = Math.round((arenaMinX + arenaMaxX) * 0.5);
  const arenaFloorY = 296;
  const portalX = 1192;
  const portalFloorY = 266;

  // Carve Staging Vestibule
  carveCavernBox(world, 130, 200, 150, 98, rng);
  // Carve connecting breach corridor into Arena
  carveTunnel(world, 185, 205, 365, 232, 34, rng);
  // Carve Grand Boss Arena
  carveCavernBox(world, arenaCenterX, 182, 820, 236, rng);
  carveRect(world, arenaMinX, 82, arenaMaxX - arenaMinX, arenaFloorY - 82);
  // Carve Portal Sanctuary
  carveTunnel(world, arenaMaxX - 24, 244, portalX, 236, 34, rng);
  carveCavernBox(world, portalX, 230, 110, 88, rng);

  // Solid Arena Floor + Spawn Ledge + Portal Ledge (grounded into rock)
  drawBrickBlock(world, 58, spawnFloorY, 128, 12, biome, rng);
  drawFoundationPier(world, 58, spawnFloorY + 11, 14, biome, rng);
  drawFoundationPier(world, 172, spawnFloorY + 11, 14, biome, rng);

  drawBrickBlock(world, arenaMinX - 18, arenaFloorY, arenaMaxX - arenaMinX + 42, 16, biome, rng);
  drawFoundationPier(world, arenaMinX - 18, arenaFloorY + 15, 18, biome, rng);
  drawFoundationPier(world, arenaMaxX + 6, arenaFloorY + 15, 18, biome, rng);

  drawBrickBlock(world, portalX - 42, portalFloorY, 84, 12, biome, rng);
  drawFoundationPier(world, portalX - 42, portalFloorY + 11, 12, biome, rng);
  drawFoundationPier(world, portalX + 30, portalFloorY + 11, 12, biome, rng);

  decorateCavernSurfaces(world, biome, rng);

  // Vestibule supplies: weapon pedestal + jars + torches + thin destructible gate
  pedestals.push({
    id: entityId++,
    x: 162,
    y: spawnFloorY - 2,
    used: false,
    weaponOffer: rng.pick(LOOTABLE_WEAPONS),
  });
  stampTorch(world, 82, spawnFloorY - 1, rng);
  stampTorch(world, 144, spawnFloorY - 1, rng);
  stampJar(world, 72, spawnFloorY - 7, rng);
  stampJar(world, 198, spawnFloorY - 7, rng);
  stampBanner(world, 118, spawnFloorY - 30, biome, rng);

  // Destructible Arena Architecture: Elevated fighting balconies, destructible cover pillars, ceiling-rooted hangers
  const balconyY1 = arenaFloorY - 66;
  const balconyY2 = arenaFloorY - 120;

  // Left fighting balcony (anchored down into arenaFloorY with stepped brick corbels)
  drawBrickBlock(world, arenaMinX + 44, balconyY1 + 3, 16, 65, biome, rng);
  drawBrickBlock(world, arenaMinX + 132, balconyY1 + 3, 16, 65, biome, rng);
  drawCorbelBracket(world, arenaMinX + 60, balconyY1 + 5, 1, 6, biome, rng);
  drawCorbelBracket(world, arenaMinX + 131, balconyY1 + 5, -1, 6, biome, rng);
  drawWoodPlank(world, arenaMinX + 34, balconyY1, 126, 5, biome, rng);
  stampTorch(world, arenaMinX + 52, balconyY1 - 1, rng);
  stampBarrel(world, arenaMinX + 94, balconyY1 - 9, rng);

  // Right fighting balcony
  drawBrickBlock(world, arenaMaxX - 148, balconyY1 + 3, 16, 65, biome, rng);
  drawBrickBlock(world, arenaMaxX - 60, balconyY1 + 3, 16, 65, biome, rng);
  drawCorbelBracket(world, arenaMaxX - 132, balconyY1 + 5, 1, 6, biome, rng);
  drawCorbelBracket(world, arenaMaxX - 61, balconyY1 + 5, -1, 6, biome, rng);
  drawWoodPlank(world, arenaMaxX - 160, balconyY1, 126, 5, biome, rng);
  stampTorch(world, arenaMaxX - 52, balconyY1 - 1, rng);
  stampBarrel(world, arenaMaxX - 102, balconyY1 - 9, rng);

  // Upper central catwalk suspended from thick riveted steel stanchions rooted into solid ceiling rock
  drawWoodPlank(world, arenaCenterX - 96, balconyY2, 192, 5, biome, rng);
  drawMetalBeam(world, arenaCenterX - 78, 72, 6, balconyY2 - 70, rng);
  drawMetalBeam(world, arenaCenterX + 72, 72, 6, balconyY2 - 70, rng);
  drawCorbelBracket(world, arenaCenterX - 72, balconyY2, 1, 5, biome, rng, true);
  drawCorbelBracket(world, arenaCenterX + 71, balconyY2, -1, 5, biome, rng, true);

  for (const hx of [arenaCenterX - 165, arenaCenterX + 165, arenaCenterX]) {
    const hCeil = findCeilingSolidY(world, hx, 110);
    if (hCeil !== null) {
      stampHangingBarrel(world, hx, hCeil - 1, hx === arenaCenterX ? 22 : 30, rng);
    }
  }

  // Arena floor cover & biome crystal pillars
  drawBrickBlock(world, arenaCenterX - 150, arenaFloorY - 28, 12, 30, biome, rng);
  drawBrickBlock(world, arenaCenterX + 138, arenaFloorY - 28, 12, 30, biome, rng);
  stampCrystalCluster(world, arenaMinX + 22, arenaFloorY - 1, biome, rng, -1);
  stampCrystalCluster(world, arenaMaxX - 24, arenaFloorY - 1, biome, rng, -1);

  // Portal shrine frames
  stampTorch(world, portalX - 22, portalFloorY - 1, rng);
  stampTorch(world, portalX + 22, portalFloorY - 1, rng);
  stampBanner(world, portalX - 26, portalFloorY - 30, biome, rng);
  stampBanner(world, portalX + 26, portalFloorY - 30, biome, rng);

  // Build Pixel-Based Boss!
  const boss = buildPixelBoss(
    biome,
    depth,
    arenaCenterX + 90,
    arenaFloorY - 18,
    arenaMinX + 36,
    arenaMaxX - 36,
    arenaFloorY,
    entityId++,
    rng
  );

  world.markAllDirty();

  return {
    biome,
    spawnX,
    spawnY: spawnFloorY - 16,
    portal: {
      x: portalX,
      y: portalFloorY - 16,
      active: false, // Sealed until Boss is defeated!
    },
    enemies,
    pickups,
    pedestals,
    boss,
  };
}

type HullStyle = 'CITADEL' | 'BOILER' | 'DIAMOND' | 'RIBCAGE';
type CrownStyle = 'HORNED' | 'SMOKESTACKS' | 'DOME' | 'PRONG_SPIRE' | 'TURRET_CAP';
type LimbStyle = 'PAULDRON_ARM' | 'CANNON_POD' | 'CRYSTAL_WING' | 'SHIELD_PLATE' | 'CLAW_PINCER';
type BaseStyle = 'PILLAR_LEGS' | 'TANK_TREADS' | 'THRUSTER_BELLS' | 'SPIKE_KEEL';
type CoreSlot = 'CHEST' | 'CROWN' | 'LEFT_POD' | 'RIGHT_POD' | 'KEEL';

function buildPixelBoss(
  biome: BiomeConfig,
  depth: number,
  startX: number,
  startY: number,
  arenaMinX: number,
  arenaMaxX: number,
  arenaFloorY: number,
  id: number,
  rng: SeededRNG
): PixelBoss {
  const tier = Math.max(1, Math.floor(depth / 10));
  const maxHp = Math.round(560 * (1 + (tier - 1) * 0.65));

  const w = 44;
  const h = 44;
  const cx = 22;
  const cy = 22;

  const hullStyle = rng.pick<HullStyle>(['CITADEL', 'BOILER', 'DIAMOND', 'RIBCAGE']);
  const crownStyle = rng.pick<CrownStyle>(
    biome.id === 'ASHEN_FOUNDRY'
      ? ['SMOKESTACKS', 'TURRET_CAP', 'HORNED', 'DOME']
      : biome.id === 'VITRIOL_VAULTS'
      ? ['PRONG_SPIRE', 'DOME', 'HORNED', 'TURRET_CAP']
      : ['HORNED', 'DOME', 'PRONG_SPIRE', 'TURRET_CAP']
  );
  const leftLimb = rng.pick<LimbStyle>([
    'PAULDRON_ARM',
    'CANNON_POD',
    'CRYSTAL_WING',
    'SHIELD_PLATE',
    'CLAW_PINCER',
  ]);
  const rightLimb = rng.chance(0.55)
    ? leftLimb
    : rng.pick<LimbStyle>(['PAULDRON_ARM', 'CANNON_POD', 'CRYSTAL_WING', 'SHIELD_PLATE', 'CLAW_PINCER']);
  const baseStyle = rng.pick<BaseStyle>(
    biome.id === 'VITRIOL_VAULTS'
      ? ['THRUSTER_BELLS', 'SPIKE_KEEL', 'PILLAR_LEGS']
      : ['PILLAR_LEGS', 'TANK_TREADS', 'THRUSTER_BELLS', 'SPIKE_KEEL']
  );
  const coreSlot = rng.pick<CoreSlot>(['CHEST', 'CROWN', 'LEFT_POD', 'RIGHT_POD', 'KEEL']);

  const hw = rng.int(8, 12);
  const hh = rng.int(8, 11);
  const leftMountY = rng.int(16, 24);
  const rightMountY = rng.chance(0.6) ? leftMountY : rng.int(16, 24);

  const mats = new Uint8Array(w * h);
  const colors = new Uint32Array(w * h);
  const isCore = new Uint8Array(w * h);

  const primaryMat: Mat =
    biome.id === 'SUNKEN_MASONRY'
      ? Mat.STONE
      : biome.id === 'ASHEN_FOUNDRY'
      ? Mat.BRICK
      : Mat.CRYSTAL;
  const primaryRgb: [number, number, number] =
    biome.id === 'SUNKEN_MASONRY'
      ? biome.stoneBase
      : biome.id === 'ASHEN_FOUNDRY'
      ? biome.brickBase
      : biome.crystalBase;
  const secondaryMat: Mat =
    biome.id === 'SUNKEN_MASONRY' ? Mat.BRICK : biome.id === 'ASHEN_FOUNDRY' ? Mat.METAL : Mat.STONE;
  const secondaryRgb: [number, number, number] =
    biome.id === 'SUNKEN_MASONRY'
      ? biome.brickBase
      : biome.id === 'ASHEN_FOUNDRY'
      ? [72, 66, 70]
      : biome.stoneBase;
  const trimRgb: [number, number, number] =
    biome.id === 'SUNKEN_MASONRY'
      ? [235, 192, 62]
      : biome.id === 'ASHEN_FOUNDRY'
      ? [240, 128, 48]
      : [110, 232, 148];
  const coreRgb: [number, number, number] =
    biome.id === 'SUNKEN_MASONRY'
      ? [56, 210, 255]
      : biome.id === 'ASHEN_FOUNDRY'
      ? [255, 168, 42]
      : [92, 255, 138];

  const setBossPx = (lx: number, ly: number, mat: Mat, col: number, core = false) => {
    const ix = Math.round(lx);
    const iy = Math.round(ly);
    if (ix < 0 || ix >= w || iy < 0 || iy >= h) return;
    const idx = iy * w + ix;
    mats[idx] = mat;
    colors[idx] = col;
    isCore[idx] = core ? 1 : 0;
  };

  const paintPlatePx = (lx: number, ly: number, isEdge: boolean) => {
    if (isEdge) {
      setBossPx(lx, ly, Mat.METAL, jitterColor([76, 84, 98], () => rng.next(), 10));
    } else if ((lx + ly * 2) % 6 === 0) {
      setBossPx(lx, ly, secondaryMat, jitterColor(secondaryRgb, () => rng.next(), 10));
    } else {
      setBossPx(lx, ly, primaryMat, jitterColor(primaryRgb, () => rng.next(), 12));
    }
  };

  // 1. Assemble Torso / Core Chassis
  for (let y = cy - hh; y <= cy + hh; y++) {
    for (let x = cx - hw; x <= cx + hw; x++) {
      const nx = Math.abs(x - cx) / hw;
      const ny = Math.abs(y - cy) / hh;
      let inside = false;
      let edge = false;
      if (hullStyle === 'CITADEL') {
        inside = nx <= 1 && ny <= 1;
        edge = nx > 0.82 || ny > 0.82;
      } else if (hullStyle === 'BOILER') {
        inside = nx * nx * 0.85 + ny * ny <= 1.05;
        edge = nx * nx * 0.85 + ny * ny > 0.78;
      } else if (hullStyle === 'DIAMOND') {
        inside = nx + ny <= 1.25;
        edge = nx + ny > 1.02;
      } else {
        // RIBCAGE
        const rib = Math.abs(y - cy) % 4 === 0;
        inside = nx <= 0.65 || (rib && nx <= 1.05);
        edge = nx > 0.85 || (ny > 0.8 && nx < 0.7);
      }
      if (inside) {
        paintPlatePx(x, y, edge);
      }
    }
  }

  // 2. Assemble Head / Crown Segment
  const crownBaseY = cy - hh;
  if (crownStyle === 'HORNED') {
    for (let y = crownBaseY - 9; y <= crownBaseY + 1; y++) {
      for (let x = cx - 8; x <= cx + 8; x++) {
        const ax = Math.abs(x - cx);
        const dy = crownBaseY - y;
        const inHorn = ax >= 4 && ax <= 8 && dy >= ax - 3;
        const inHelm = ax <= 5 && dy <= 5;
        if (inHorn || inHelm) {
          paintPlatePx(x, y, inHorn || dy >= 4);
        }
      }
    }
  } else if (crownStyle === 'SMOKESTACKS') {
    for (let y = crownBaseY - 10; y <= crownBaseY + 1; y++) {
      for (let x = cx - 9; x <= cx + 9; x++) {
        const ax = Math.abs(x - cx);
        const inStack = ax >= 4 && ax <= 7;
        const inDome = ax <= 3 && y >= crownBaseY - 4;
        if (inStack || inDome) {
          setBossPx(
            x,
            y,
            Mat.METAL,
            y <= crownBaseY - 8 ? jitterColor(trimRgb, () => rng.next(), 10) : jitterColor([72, 74, 80], () => rng.next(), 8)
          );
        }
      }
    }
  } else if (crownStyle === 'DOME') {
    for (let y = crownBaseY - 8; y <= crownBaseY + 1; y++) {
      for (let x = cx - 7; x <= cx + 7; x++) {
        const d = Math.hypot((x - cx) / 7, (y - crownBaseY) / 8);
        if (d <= 1) paintPlatePx(x, y, d > 0.78);
      }
    }
  } else if (crownStyle === 'PRONG_SPIRE') {
    for (let y = crownBaseY - 11; y <= crownBaseY + 1; y++) {
      for (let x = cx - 7; x <= cx + 7; x++) {
        const ax = Math.abs(x - cx);
        const dy = crownBaseY - y;
        const centerSpire = ax <= Math.max(0, 3 - Math.floor(dy / 3));
        const sideProng = ax >= 5 && ax <= 6 && dy <= 7;
        if (centerSpire || sideProng) {
          setBossPx(x, y, Mat.CRYSTAL, jitterColor(biome.crystalBase, () => rng.next(), 14));
        }
      }
    }
  } else {
    // TURRET_CAP
    for (let y = crownBaseY - 7; y <= crownBaseY + 1; y++) {
      for (let x = cx - 6; x <= cx + 6; x++) {
        paintPlatePx(x, y, y === crownBaseY - 7 || Math.abs(x - cx) === 6);
      }
    }
    for (let x = cx - 10; x <= cx + 10; x++) {
      if (Math.abs(x - cx) > 6) {
        setBossPx(x, crownBaseY - 4, Mat.METAL, packColor(92, 98, 112));
        setBossPx(x, crownBaseY - 3, Mat.METAL, packColor(68, 74, 86));
      }
    }
  }

  // 3. Assemble Left & Right Limb / Wing Modules
  const attachLimb = (side: -1 | 1, style: LimbStyle, mountY: number) => {
    const startX = cx + side * (hw - 1);
    if (style === 'PAULDRON_ARM') {
      for (let dy = -5; dy <= 10; dy++) {
        for (let step = 0; step <= 8; step++) {
          const lx = startX + side * step;
          const ly = mountY + dy;
          const inShoulder = dy <= 1 && step <= 7;
          const inForearm = dy > 1 && step >= 3 && step <= 7;
          if (inShoulder || inForearm) {
            paintPlatePx(lx, ly, step >= 6 || dy <= -4);
          }
        }
      }
    } else if (style === 'CANNON_POD') {
      for (let dy = -4; dy <= 4; dy++) {
        for (let step = 0; step <= 10; step++) {
          const lx = startX + side * step;
          const ly = mountY + dy;
          if (Math.abs(dy) <= 3 || step <= 6) {
            setBossPx(
              lx,
              ly,
              step >= 8 ? Mat.GOLD : Mat.METAL,
              step >= 8 ? jitterColor(trimRgb, () => rng.next(), 10) : jitterColor([74, 80, 94], () => rng.next(), 10)
            );
          }
        }
      }
    } else if (style === 'CRYSTAL_WING') {
      for (let step = 0; step <= 11; step++) {
        const wingHalfH = Math.max(1, Math.round(7 - step * 0.45));
        for (let dy = -wingHalfH; dy <= wingHalfH - 2; dy++) {
          const lx = startX + side * step;
          const ly = mountY + dy - Math.floor(step * 0.35);
          setBossPx(
            lx,
            ly,
            Mat.CRYSTAL,
            tintColor(jitterColor(biome.crystalBase, () => rng.next(), 14), 0.9 + step * 0.03)
          );
        }
      }
    } else if (style === 'SHIELD_PLATE') {
      for (let dy = -8; dy <= 9; dy++) {
        for (let step = 0; step <= 5; step++) {
          const lx = startX + side * step;
          const ly = mountY + dy;
          if (Math.abs(dy) < 9 - Math.floor(step * 0.6)) {
            setBossPx(
              lx,
              ly,
              step >= 4 ? Mat.METAL : Mat.BRICK,
              step >= 4 ? jitterColor([102, 112, 128], () => rng.next(), 8) : jitterColor(biome.brickBase, () => rng.next(), 10)
            );
          }
        }
      }
    } else {
      // CLAW_PINCER
      for (let step = 0; step <= 10; step++) {
        for (let dy = -5; dy <= 5; dy++) {
          const isStrut = step <= 5 && Math.abs(dy) <= 2;
          const isJaw = step > 5 && Math.abs(dy) >= 2 && Math.abs(dy) <= 5;
          if (isStrut || isJaw) {
            paintPlatePx(startX + side * step, mountY + dy, step > 7);
          }
        }
      }
    }
  };

  attachLimb(-1, leftLimb, leftMountY);
  attachLimb(1, rightLimb, rightMountY);

  // 4. Assemble Lower Base / Locomotion Segment
  const baseTopY = cy + hh - 1;
  if (baseStyle === 'PILLAR_LEGS') {
    for (let y = baseTopY; y <= h - 2; y++) {
      for (let x = cx - hw; x <= cx + hw; x++) {
        const ax = Math.abs(x - cx);
        if (ax >= 3 && ax <= Math.min(hw - 1, 9)) {
          paintPlatePx(x, y, y >= h - 4 || ax === 3);
        }
      }
    }
  } else if (baseStyle === 'TANK_TREADS') {
    for (let y = baseTopY; y <= h - 2; y++) {
      for (let x = cx - hw - 3; x <= cx + hw + 3; x++) {
        const ax = Math.abs(x - cx);
        if (y >= h - 7 || ax >= 3) {
          setBossPx(
            x,
            y,
            Mat.METAL,
            (x + y) % 3 === 0 ? packColor(52, 56, 64) : jitterColor([76, 82, 92], () => rng.next(), 8)
          );
        }
      }
    }
  } else if (baseStyle === 'THRUSTER_BELLS') {
    for (let y = baseTopY; y <= h - 3; y++) {
      for (let x = cx - hw + 1; x <= cx + hw - 1; x++) {
        const ax = Math.abs(x - cx);
        const flare = Math.floor((y - baseTopY) * 0.45);
        if (ax <= 2 + flare || (ax >= 5 && ax <= 8 + flare)) {
          setBossPx(x, y, Mat.METAL, jitterColor([80, 92, 108], () => rng.next(), 10));
        }
      }
    }
  } else {
    // SPIKE_KEEL
    for (let y = baseTopY; y <= h - 2; y++) {
      const t = (y - baseTopY) / Math.max(1, h - 2 - baseTopY);
      const halfSpan = Math.max(1, Math.round((hw - 1) * (1 - t)));
      for (let x = cx - halfSpan; x <= cx + halfSpan; x++) {
        paintPlatePx(x, y, Math.abs(x - cx) >= halfSpan - 1);
      }
    }
  }

  // 5. Stamp Procedural Special Spot (`isCore`) + Protective Armor Bezel
  let coreCx = cx;
  let coreCy = cy;
  let coreSlotLabel = 'Chest-Core';
  if (coreSlot === 'CROWN') {
    coreCx = cx;
    coreCy = Math.max(7, crownBaseY - 3);
    coreSlotLabel = 'Crown-Node';
  } else if (coreSlot === 'LEFT_POD') {
    coreCx = Math.max(7, cx - hw - 3);
    coreCy = leftMountY;
    coreSlotLabel = 'Port-Reactor';
  } else if (coreSlot === 'RIGHT_POD') {
    coreCx = Math.min(w - 8, cx + hw + 3);
    coreCy = rightMountY;
    coreSlotLabel = 'Starboard-Reactor';
  } else if (coreSlot === 'KEEL') {
    coreCx = cx;
    coreCy = Math.min(h - 7, baseTopY + 1);
    coreSlotLabel = 'Keel-Core';
  }

  const coreShape = rng.pick<'ORB' | 'DIAMOND' | 'SLIT'>(['ORB', 'DIAMOND', 'SLIT']);
  const coreRadius = rng.range(4.2, 5.1);
  for (let y = coreCy - 7; y <= coreCy + 7; y++) {
    for (let x = coreCx - 7; x <= coreCx + 7; x++) {
      const dx = Math.abs(x - coreCx);
      const dy = Math.abs(y - coreCy);
      const d =
        coreShape === 'ORB'
          ? Math.hypot(dx, dy)
          : coreShape === 'DIAMOND'
          ? dx * 0.95 + dy * 0.95
          : Math.max(dx * 1.45, dy * 0.85);

      if (d <= coreRadius) {
        const glow = 1.05 + (1 - d / coreRadius) * 0.28;
        setBossPx(
          x,
          y,
          Mat.CRYSTAL,
          tintColor(jitterColor(coreRgb, () => rng.next(), 12), glow),
          true
        );
      } else if (d <= coreRadius + 1.8 && (y >= coreCy - 1 || x % 2 === 0)) {
        // Gold/metal bezel frame around weak spot
        setBossPx(x, y, Mat.GOLD, jitterColor(trimRgb, () => rng.next(), 10), false);
      }
    }
  }

  let corePixelsTotal = 0;
  let totalPixelsInitial = 0;
  for (let i = 0; i < mats.length; i++) {
    if (mats[i] !== Mat.EMPTY) {
      totalPixelsInitial++;
      if (isCore[i]) corePixelsTotal++;
    }
  }

  let baseTitle = 'Monolith Warden';
  let weakSpotName = 'Sapphire Core';
  if (biome.id === 'ASHEN_FOUNDRY') {
    baseTitle = 'Slag Colossus';
    weakSpotName = 'Furnace Heart';
  } else if (biome.id === 'VITRIOL_VAULTS') {
    baseTitle = 'Sovereign Spire';
    weakSpotName = 'Crystal Nucleus';
  }

  const crownWord: Record<CrownStyle, string> = {
    HORNED: 'Horned',
    SMOKESTACKS: 'Foundry-Stack',
    DOME: 'Vaulted',
    PRONG_SPIRE: 'Spire-Crowned',
    TURRET_CAP: 'Bastion',
  };
  const hullWord: Record<HullStyle, string> = {
    CITADEL: 'Citadel',
    BOILER: 'Juggernaut',
    DIAMOND: 'Prism',
    RIBCAGE: 'Automaton',
  };

  const name = `The ${crownWord[crownStyle]} ${baseTitle}`;
  const subtitle = `${coreSlotLabel} ${hullWord[hullStyle]}`;

  return {
    id,
    biomeId: biome.id,
    name,
    subtitle,
    weakSpotName,
    x: startX,
    y: startY,
    vx: 0,
    vy: 0,
    w,
    h,
    hp: maxHp,
    maxHp,
    corePixelsRemaining: corePixelsTotal,
    corePixelsTotal,
    totalPixelsInitial,
    mats,
    colors,
    pixelDmg: new Uint8Array(w * h),
    isCore,
    canvasDirty: true,
    facing: -1,
    phaseTimer: 0,
    attackCd: 1.6,
    secondaryCd: 3.4,
    hurtFlash: 0,
    anchorX: startX,
    anchorY: startY,
    arenaMinX,
    arenaMaxX,
    arenaFloorY,
  };
}

function pickRoomKind(biomeId: BiomeId, slotIdx: number, rng: SeededRNG): RoomKind {
  if (slotIdx === 3) return 'VAULT';
  if (biomeId === 'SUNKEN_MASONRY') {
    return rng.pick(['RUIN', 'CATACOMB', 'BRIDGE', 'GAUNTLET', 'SHAFT']);
  }
  if (biomeId === 'ASHEN_FOUNDRY') {
    return rng.pick(['FOUNDRY_CHAMBER', 'BRIDGE', 'GAUNTLET', 'RUIN', 'SHAFT']);
  }
  return rng.pick(['CRYSTAL_GROTTO', 'BRIDGE', 'SHAFT', 'CATACOMB', 'VAULT']);
}

function pickAerialEnemy(biomeId: BiomeId, rng: SeededRNG): EnemyKind {
  if (biomeId === 'ASHEN_FOUNDRY') return rng.chance(0.65) ? 'PYRO_IMP' : 'DRONE';
  if (biomeId === 'VITRIOL_VAULTS') return rng.chance(0.65) ? 'CRYSTAL_WISP' : 'DRONE';
  return rng.chance(0.25) ? 'CRYSTAL_WISP' : 'DRONE';
}

function pickEnemyKind(depth: number, biomeId: BiomeId, rng: SeededRNG): EnemyKind {
  const pool: EnemyKind[] = ['CRAWLER', 'DRONE', 'SLIME'];

  if (biomeId === 'SUNKEN_MASONRY') {
    pool.push('STONE_WARDEN', 'STONE_WARDEN', 'SENTINEL');
    if (depth >= 2) pool.push('TURRET');
  } else if (biomeId === 'ASHEN_FOUNDRY') {
    pool.push('PYRO_IMP', 'PYRO_IMP', 'TURRET');
    if (depth >= 2) pool.push('SENTINEL', 'CRAWLER');
  } else {
    pool.push('CRYSTAL_WISP', 'CRYSTAL_WISP', 'SLIME');
    if (depth >= 2) pool.push('SENTINEL', 'TURRET');
  }

  return rng.pick(pool);
}

function makeEnemy(id: number, kind: EnemyKind, x: number, y: number, depth: number): Enemy {
  const scale = 1 + (depth - 1) * 0.28 + Math.floor(depth / 5) * 0.3;
  switch (kind) {
    case 'STONE_WARDEN':
      return {
        id,
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        w: 13,
        h: 17,
        hp: Math.round(78 * scale),
        maxHp: Math.round(78 * scale),
        facing: -1,
        grounded: false,
        attackCd: 1.5,
        aiTimer: Math.random() * 2,
        hurtFlash: 0,
        goldValue: 20 + depth * 3,
      };
    case 'PYRO_IMP':
      return {
        id,
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        w: 10,
        h: 10,
        hp: Math.round(36 * scale),
        maxHp: Math.round(36 * scale),
        facing: -1,
        grounded: false,
        attackCd: 1.1,
        aiTimer: Math.random() * 3,
        hurtFlash: 0,
        goldValue: 13 + depth * 2,
      };
    case 'CRYSTAL_WISP':
      return {
        id,
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        w: 9,
        h: 11,
        hp: Math.round(40 * scale),
        maxHp: Math.round(40 * scale),
        facing: 1,
        grounded: false,
        attackCd: 1.35,
        aiTimer: Math.random() * 3,
        hurtFlash: 0,
        goldValue: 14 + depth * 2,
      };
    case 'DRONE':
      return {
        id,
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        w: 9,
        h: 7,
        hp: Math.round(28 * scale),
        maxHp: Math.round(28 * scale),
        facing: 1,
        grounded: false,
        attackCd: 1.2,
        aiTimer: Math.random() * 2,
        hurtFlash: 0,
        goldValue: 8 + depth * 2,
      };
    case 'SENTINEL':
      return {
        id,
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        w: 11,
        h: 15,
        hp: Math.round(62 * scale),
        maxHp: Math.round(62 * scale),
        facing: -1,
        grounded: false,
        attackCd: 1.4,
        aiTimer: 0,
        hurtFlash: 0,
        goldValue: 16 + depth * 3,
      };
    case 'SLIME':
      return {
        id,
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        w: 9,
        h: 8,
        hp: Math.round(34 * scale),
        maxHp: Math.round(34 * scale),
        facing: 1,
        grounded: false,
        attackCd: 0.9,
        aiTimer: 0,
        hurtFlash: 0,
        goldValue: 9 + depth * 2,
      };
    case 'TURRET':
      return {
        id,
        kind,
        x,
        y,
        vx: 0,
        vy: 0,
        w: 9,
        h: 9,
        hp: Math.round(42 * scale),
        maxHp: Math.round(42 * scale),
        facing: -1,
        grounded: false,
        attackCd: 1.6,
        aiTimer: 0,
        hurtFlash: 0,
        goldValue: 12 + depth * 2,
      };
    case 'CRAWLER':
    default:
      return {
        id,
        kind: 'CRAWLER',
        x,
        y,
        vx: 0,
        vy: 0,
        w: 9,
        h: 8,
        hp: Math.round(26 * scale),
        maxHp: Math.round(26 * scale),
        facing: 1,
        grounded: false,
        attackCd: 0.7,
        aiTimer: 0,
        hurtFlash: 0,
        goldValue: 6 + depth * 2,
      };
  }
}

function carveRect(world: PixelWorld, x: number, y: number, w: number, h: number): void {
  for (let py = y; py < y + h; py++) {
    if (py <= 4 || py >= WORLD_H - 5) continue;
    for (let px = x; px < x + w; px++) {
      if (px <= 4 || px >= WORLD_W - 5) continue;
      world.setPixel(px, py, Mat.EMPTY, 0);
    }
  }
}

function carveCavernBox(
  world: PixelWorld,
  cx: number,
  cy: number,
  w: number,
  h: number,
  rng: SeededRNG
): void {
  const rx = w * 0.5;
  const ry = h * 0.5;
  const x0 = Math.max(5, Math.floor(cx - rx - 6));
  const x1 = Math.min(WORLD_W - 6, Math.ceil(cx + rx + 6));
  const y0 = Math.max(5, Math.floor(cy - ry - 6));
  const y1 = Math.min(WORLD_H - 6, Math.ceil(cy + ry + 6));
  const noiseSeed = rng.int(1, 99999);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const organic = (fbm2D(x * 0.08, y * 0.08, noiseSeed, 2) - 0.5) * 0.38;
      const floorBias = ny > 0.45 ? 0.15 : 0;
      if (nx * nx + ny * ny + organic + floorBias < 1.0) {
        world.setPixel(x, y, Mat.EMPTY, 0);
      }
    }
  }
}

function carveTunnel(
  world: PixelWorld,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  rng: SeededRNG
): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const s = rng.int(1, 99999);
  for (let i = 0; i <= steps; i += 2) {
    const t = steps === 0 ? 0 : i / steps;
    const mx = x0 + (x1 - x0) * t;
    const my = y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * (rng.next() - 0.5) * 8;
    const r = radius * 0.5 + (fbm2D(mx * 0.06, my * 0.06, s, 2) - 0.5) * 6;
    const ir = Math.ceil(r);
    for (let dy = -ir; dy <= ir; dy++) {
      const py = Math.round(my + dy);
      if (py <= 4 || py >= WORLD_H - 5) continue;
      for (let dx = -ir; dx <= ir; dx++) {
        const px = Math.round(mx + dx);
        if (px <= 4 || px >= WORLD_W - 5) continue;
        if (dx * dx + dy * dy <= r * r) {
          world.setPixel(px, py, Mat.EMPTY, 0);
        }
      }
    }
  }
}

function drawBrickBlock(
  world: PixelWorld,
  x: number,
  y: number,
  w: number,
  h: number,
  biome: BiomeConfig,
  rng: SeededRNG
): void {
  for (let py = y; py < y + h; py++) {
    if (py <= 4 || py >= WORLD_H - 5) continue;
    const rowIdx = Math.floor((py - y) / 3);
    const isMortarY = (py - y) % 3 === 2;
    for (let px = x; px < x + w; px++) {
      if (px <= 4 || px >= WORLD_W - 5) continue;
      const offset = (rowIdx % 2) * 3;
      const isMortarX = (px - x + offset) % 6 === 5;
      const base = jitterColor(biome.brickBase, () => rng.next(), 10);
      const col = isMortarY || isMortarX ? tintColor(base, 0.72) : base;
      world.setPixel(px, py, Mat.BRICK, col);
    }
  }
}

function drawMetalBeam(
  world: PixelWorld,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: SeededRNG
): void {
  for (let py = y; py < y + h; py++) {
    if (py <= 4 || py >= WORLD_H - 5) continue;
    for (let px = x; px < x + w; px++) {
      if (px <= 4 || px >= WORLD_W - 5) continue;
      const rivet = (px - x) % 6 === 0 && (py - y) % 3 === 1;
      const base = jitterColor([84, 92, 106], () => rng.next(), 8);
      world.setPixel(px, py, Mat.METAL, rivet ? tintColor(base, 1.3) : base);
    }
  }
}

function drawSandBed(
  world: PixelWorld,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: SeededRNG
): void {
  for (let py = y; py < y + h; py++) {
    if (py <= 4 || py >= WORLD_H - 5) continue;
    for (let px = x; px < x + w; px++) {
      if (px <= 4 || px >= WORLD_W - 5) continue;
      world.setPixel(px, py, Mat.SAND, jitterColor([204, 174, 108], () => rng.next(), 14));
    }
  }
}

function drawWoodPlank(
  world: PixelWorld,
  x: number,
  y: number,
  w: number,
  h: number,
  biome: BiomeConfig,
  rng: SeededRNG
): void {
  for (let py = y; py < y + h; py++) {
    if (py <= 4 || py >= WORLD_H - 5) continue;
    for (let px = x; px < x + w; px++) {
      if (px <= 4 || px >= WORLD_W - 5) continue;
      const grain = (px + py * 2) % 5 === 0 ? 0.85 : 1.0;
      const col = tintColor(jitterColor(biome.woodBase, () => rng.next(), 10), grain);
      world.setPixel(px, py, Mat.WOOD, col);
    }
  }
}

function paintInteriorBg(
  world: PixelWorld,
  x: number,
  y: number,
  w: number,
  h: number,
  biome: BiomeConfig,
  rng: SeededRNG
): void {
  for (let py = y; py < y + h; py++) {
    if (py < 0 || py >= WORLD_H) continue;
    for (let px = x; px < x + w; px++) {
      if (px < 0 || px >= WORLD_W) continue;
      const beam = py % 12 === 0 || px % 16 === 0;
      const factor = beam ? 0.28 : 0.22 + (rng.next() - 0.5) * 0.03;
      world.setBgPixel(
        px,
        py,
        packColor(
          biome.brickBase[0] * factor,
          biome.brickBase[1] * factor,
          biome.brickBase[2] * factor
        )
      );
    }
  }
}

function findCeilingSolidY(world: PixelWorld, x: number, startY: number, maxRise = 96): number | null {
  for (let dy = 0; dy <= maxRise; dy++) {
    const y = startY - dy;
    if (y <= 5) return 6;
    const m = world.getMat(x, y);
    if (m === Mat.STONE || m === Mat.DIRT || m === Mat.BRICK || m === Mat.BEDROCK) {
      return y + 1;
    }
  }
  return null;
}

function drawFoundationPier(
  world: PixelWorld,
  x: number,
  topY: number,
  w: number,
  biome: BiomeConfig,
  rng: SeededRNG,
  maxDrop = 68
): void {
  for (let px = x; px < x + w; px++) {
    if (px <= 4 || px >= WORLD_W - 5) continue;
    let solidDepth = 0;
    for (let dy = 0; dy < maxDrop; dy++) {
      const py = topY + dy;
      if (py >= WORLD_H - 4) break;
      const existing = world.getMat(px, py);
      if (existing === Mat.STONE || existing === Mat.DIRT || existing === Mat.BEDROCK) {
        solidDepth++;
        if (solidDepth >= 3) break;
      } else {
        solidDepth = 0;
      }
      const rowIdx = Math.floor(dy / 3);
      const isMortar = dy % 3 === 2 || (px - x + (rowIdx % 2) * 3) % 6 === 5;
      const base = jitterColor(biome.brickBase, () => rng.next(), 10);
      world.setPixel(px, py, Mat.BRICK, isMortar ? tintColor(base, 0.72) : base);
    }
  }
}

function drawCorbelBracket(
  world: PixelWorld,
  cornerX: number,
  cornerY: number,
  dirX: 1 | -1,
  size: number,
  biome: BiomeConfig,
  rng: SeededRNG,
  useMetal = false
): void {
  for (let row = 0; row < size; row++) {
    const span = size - row;
    for (let s = 0; s < span; s++) {
      const px = cornerX + dirX * s;
      const py = cornerY + row;
      if (px <= 4 || px >= WORLD_W - 5 || py <= 4 || py >= WORLD_H - 5) continue;
      if (useMetal) {
        world.setPixel(px, py, Mat.METAL, jitterColor([84, 92, 106], () => rng.next(), 8));
      } else {
        world.setPixel(px, py, Mat.BRICK, tintColor(jitterColor(biome.brickBase, () => rng.next(), 8), 0.88));
      }
    }
  }
}

function drawVatBasin(
  world: PixelWorld,
  x: number,
  y: number,
  w: number,
  h: number,
  liquidMat: Mat.WATER | Mat.OIL | Mat.ACID,
  biome: BiomeConfig,
  rng: SeededRNG
): void {
  // Acid-resistant crystal liner for Vitriol vats, masonry liner for water/oil
  const wallMat = liquidMat === Mat.ACID ? Mat.CRYSTAL : Mat.BRICK;
  const wallRgb = liquidMat === Mat.ACID ? biome.crystalBase : biome.brickBase;

  for (let py = y; py < y + h + 2; py++) {
    if (py <= 4 || py >= WORLD_H - 5) continue;
    for (let px = x - 2; px < x + w + 2; px++) {
      if (px <= 4 || px >= WORLD_W - 5) continue;
      const isLiner = px < x || px >= x + w || py >= y + h;
      if (isLiner) {
        world.setPixel(px, py, wallMat, tintColor(jitterColor(wallRgb, () => rng.next(), 10), 0.85));
      } else {
        world.setPixel(px, py, Mat.EMPTY, 0);
      }
    }
  }
  fillLiquidBasin(world, x, y, w, h, liquidMat, rng);
}

function fillLiquidBasin(
  world: PixelWorld,
  x: number,
  y: number,
  w: number,
  h: number,
  mat: Mat.WATER | Mat.OIL | Mat.ACID,
  rng: SeededRNG
): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (world.getMat(px, py) !== Mat.EMPTY) continue;
      let col = 0;
      if (mat === Mat.WATER) {
        col = jitterColor([42, 132, 214], () => rng.next(), 14, 230);
      } else if (mat === Mat.OIL) {
        col = jitterColor([34, 28, 36], () => rng.next(), 8, 255);
      } else {
        col = jitterColor([74, 224, 92], () => rng.next(), 18, 240);
      }
      world.setPixel(px, py, mat, col);
    }
  }
}

function stampTorch(world: PixelWorld, x: number, bottomY: number, _rng: SeededRNG): void {
  // Wrought-iron sconce post so torches never ignite their own mount or planks
  for (let i = 0; i < 6; i++) {
    world.setPixel(x, bottomY - i, Mat.METAL, packColor(76, 80, 90));
  }
  world.setPixel(x, bottomY - 6, Mat.TORCH, packColor(255, 200, 80), 1);
}

function stampBanner(
  world: PixelWorld,
  x: number,
  topY: number,
  biome: BiomeConfig,
  rng: SeededRNG
): void {
  const bannerRgb = biome.bannerRgb;

  for (let dx = -3; dx <= 3; dx++) {
    world.setPixel(x + dx, topY, Mat.WOOD, packColor(118, 82, 44));
  }
  for (let dy = 1; dy <= 11; dy++) {
    const halfW = dy > 8 ? Math.max(0, 2 - (dy - 8)) : 2;
    for (let dx = -halfW; dx <= halfW; dx++) {
      const trim = Math.abs(dx) === halfW && dy < 8 ? 1.25 : 1.0;
      world.setPixel(
        x + dx,
        topY + dy,
        Mat.BANNER,
        tintColor(jitterColor(bannerRgb, () => rng.next(), 10), trim)
      );
    }
  }
}

function stampCrate(
  world: PixelWorld,
  x: number,
  topY: number,
  biome: BiomeConfig,
  rng: SeededRNG
): void {
  const s = 8;
  for (let dy = 0; dy < s; dy++) {
    for (let dx = 0; dx < s; dx++) {
      const border = dx === 0 || dx === s - 1 || dy === 0 || dy === s - 1 || dx === dy;
      const base = jitterColor(biome.woodBase, () => rng.next(), 8);
      world.setPixel(x + dx, topY + dy, Mat.WOOD, border ? tintColor(base, 0.72) : base);
    }
  }
}

function stampJar(world: PixelWorld, x: number, topY: number, rng: SeededRNG): void {
  const pattern = [
    ' 111 ',
    '  1  ',
    ' 111 ',
    '11211',
    '11211',
    ' 111 ',
  ];
  for (let dy = 0; dy < pattern.length; dy++) {
    for (let dx = 0; dx < pattern[dy].length; dx++) {
      const ch = pattern[dy][dx];
      if (ch === ' ') continue;
      if (ch === '2') {
        world.setPixel(x + dx, topY + dy, Mat.GOLD, jitterColor([245, 198, 60], () => rng.next(), 12));
      } else {
        world.setPixel(x + dx, topY + dy, Mat.JAR, jitterColor([168, 104, 72], () => rng.next(), 12));
      }
    }
  }
}

function stampBarrel(world: PixelWorld, x: number, topY: number, rng: SeededRNG): void {
  for (let dy = 0; dy < 8; dy++) {
    for (let dx = 0; dx < 6; dx++) {
      const band = dy === 2 || dy === 5;
      const col = band
        ? packColor(68, 72, 78)
        : jitterColor([196, 56, 44], () => rng.next(), 12);
      world.setPixel(x + dx, topY + dy, Mat.BARREL, col);
    }
  }
}

function stampHangingBarrel(
  world: PixelWorld,
  x: number,
  ceilY: number,
  chainLen: number,
  rng: SeededRNG
): void {
  for (let dy = 0; dy < chainLen; dy++) {
    world.setPixel(x, ceilY + dy, Mat.CHAIN, packColor(124, 130, 140));
  }
  stampBarrel(world, x - 3, ceilY + chainLen, rng);
}

function stampCrystalCluster(
  world: PixelWorld,
  x: number,
  baseY: number,
  biome: BiomeConfig,
  rng: SeededRNG,
  dir: 1 | -1
): void {
  for (let s = 0; s < 3; s++) {
    const sx = x + (s - 1) * 3;
    const len = rng.int(7, 13);
    for (let i = 0; i < len; i++) {
      const py = baseY + dir * i;
      const halfW = i < len - 3 ? 1 : 0;
      for (let dx = -halfW; dx <= halfW; dx++) {
        const glow = 0.85 + (i / len) * 0.35;
        world.setPixel(
          sx + dx,
          py,
          Mat.CRYSTAL,
          tintColor(jitterColor(biome.crystalBase, () => rng.next(), 14), glow)
        );
      }
    }
  }
}

function stampGoldVein(world: PixelWorld, cx: number, cy: number, rng: SeededRNG): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      if (dx * dx * 0.6 + dy * dy <= 14 && rng.chance(0.75)) {
        world.setPixel(cx + dx, cy + dy, Mat.GOLD, jitterColor([248, 202, 58], () => rng.next(), 18));
      }
    }
  }
}

function decorateCavernSurfaces(
  world: PixelWorld,
  biome: BiomeConfig,
  rng: SeededRNG
): void {
  for (let x = 8; x < WORLD_W - 8; x++) {
    for (let y = 8; y < WORLD_H - 8; y++) {
      const m = world.getMat(x, y);
      if (m === Mat.STONE || m === Mat.DIRT) {
        if (world.getMat(x, y - 1) === Mat.EMPTY && rng.chance(0.32)) {
          world.setPixel(x, y - 1, Mat.MOSS, jitterColor(biome.mossBase, () => rng.next(), 16));
          if (rng.chance(0.35) && world.getMat(x, y - 2) === Mat.EMPTY) {
            world.setPixel(x, y - 2, Mat.MOSS, jitterColor(biome.mossBase, () => rng.next(), 20));
          }
        }
        if (world.getMat(x, y + 1) === Mat.EMPTY) {
          if (rng.chance(0.05)) {
            const vineLen = rng.int(4, 14);
            for (let v = 1; v <= vineLen; v++) {
              if (world.getMat(x, y + v) !== Mat.EMPTY) break;
              world.setPixel(x, y + v, Mat.MOSS, jitterColor(biome.mossBase, () => rng.next(), 14));
            }
          } else if (rng.chance(0.015)) {
            const stalLen = rng.int(5, 11);
            for (let s = 1; s <= stalLen; s++) {
              if (world.getMat(x, y + s) !== Mat.EMPTY) break;
              world.setPixel(x, y + s, Mat.STONE, jitterColor(biome.stoneBase, () => rng.next(), 10));
              if (s < stalLen * 0.5 && world.getMat(x + 1, y + s) === Mat.EMPTY) {
                world.setPixel(x + 1, y + s, Mat.STONE, jitterColor(biome.stoneBase, () => rng.next(), 10));
              }
            }
          }
        }
      }
    }
  }
}
