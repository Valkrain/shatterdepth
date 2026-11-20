import { SeededRNG } from './prng';
import { BiomeConfig, BiomeId, HudPalette, LightingAtmosphere, Mat } from './types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrapHue(h: number): number {
  const m = h % 360;
  return m < 0 ? m + 360 : m;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = wrapHue(h) / 360;
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;

  if (sat === 0) {
    const v = Math.round(lig * 255);
    return [v, v, v];
  }

  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;

  const hue2rgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  return [
    Math.round(hue2rgb(hue + 1 / 3) * 255),
    Math.round(hue2rgb(hue) * 255),
    Math.round(hue2rgb(hue - 1 / 3) * 255),
  ];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const hex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function rgbaStr([r, g, b]: [number, number, number], alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

export function generateBiomePalette(biomeId: BiomeId, depth: number, seed: number): BiomeConfig {
  const safeDepth = Math.max(1, depth);
  const palSeed = (seed ^ (safeDepth * 2246822519) ^ (biomeId.length * 3266489917)) >>> 0;
  const rng = new SeededRNG(palSeed);

  const depthNorm = Math.min(1, (safeDepth - 1) / 22);
  const cycle = Math.floor((safeDepth - 1) / 3);
  const cycleOsc = Math.sin(cycle * 1.35 + (seed % 7) * 0.4);

  if (biomeId === 'SUNKEN_MASONRY') {
    // Cavern archetype: limestone & slate shifting deeper into abyssal indigo & bioluminescent teal
    const rockHue = wrapHue(210 + depthNorm * 24 + rng.range(-10, 10));
    const accentHue = wrapHue(195 + depthNorm * 22 + cycleOsc * 14 + rng.range(-10, 10));
    const mossHue = wrapHue(138 + depthNorm * 30 + rng.range(-10, 10));

    const bgSkyTop = hslToRgb(rockHue + 6, lerp(28, 36, depthNorm), lerp(8, 5, depthNorm));
    const bgSkyBottom = hslToRgb(rockHue - 6, lerp(28, 38, depthNorm), lerp(14, 9, depthNorm));

    const stoneBase = hslToRgb(rockHue, lerp(16, 24, depthNorm), lerp(34, 23, depthNorm));
    const dirtBase = hslToRgb(26 + rng.range(-8, 10), lerp(30, 20, depthNorm), lerp(29, 20, depthNorm));
    const brickBase = hslToRgb(16 + depthNorm * 10 + rng.range(-8, 8), lerp(26, 20, depthNorm), lerp(37, 26, depthNorm));
    const woodBase = hslToRgb(28 + rng.range(-6, 6), 44, lerp(33, 25, depthNorm));
    const mossBase = hslToRgb(mossHue, lerp(36, 52, depthNorm), lerp(38, 33, depthNorm));
    const crystalBase = hslToRgb(accentHue, 74, lerp(62, 66, depthNorm));
    const bannerRgb = hslToRgb(wrapHue(accentHue + 155), 54, 44);

    // Ensure high contrast on dark HUD panels (blue hues need slightly higher lightness)
    const accentL = accentHue >= 210 && accentHue <= 255 ? 68 : 62;
    const accentRgb = hslToRgb(accentHue, 82, accentL);
    const accentSoftRgb = hslToRgb(accentHue, 86, 78);
    const panelBgRgb = hslToRgb(rockHue, 20, lerp(10, 8, depthNorm));

    const atmosphereTitle =
      safeDepth <= 3
        ? 'Tidal Cavern'
        : safeDepth <= 9
        ? 'Deep Slate Grotto'
        : safeDepth <= 15
        ? 'Abyssal Masonry'
        : 'Hadal Trench';

    const atmosphere: LightingAtmosphere = {
      ambientTintRgb: hslToRgb(accentHue, 55, 38),
      ambientAlpha: lerp(0.04, 0.13, depthNorm),
      vignetteRgb: hslToRgb(rockHue + 10, 40, 5),
      vignetteAlpha: lerp(0.22, 0.44, depthNorm),
      lightColorRgb: hslToRgb(accentHue, 85, 66),
      lightAlpha: lerp(0.14, 0.24, depthNorm),
      lightRadiusScale: lerp(1.06, 0.88, depthNorm),
      crystalGlowRgb: hslToRgb(accentHue, 88, 68),
      portalHex: rgbToHex(accentRgb),
    };

    const hudPalette: HudPalette = {
      accentHex: rgbToHex(accentRgb),
      accentSoftHex: rgbToHex(accentSoftRgb),
      accentRgb,
      accentBorder: rgbaStr(accentRgb, 0.36),
      accentGlow: rgbaStr(accentRgb, 0.14),
      panelBg: rgbaStr(panelBgRgb, 0.88),
      atmosphereTitle,
    };

    return {
      id: biomeId,
      name: 'Sunken Masonry',
      bgSkyTop,
      bgSkyBottom,
      stoneBase,
      dirtBase,
      brickBase,
      woodBase,
      mossBase,
      crystalBase,
      bannerRgb,
      liquidPrimary: Mat.WATER,
      accentHex: hudPalette.accentHex,
      atmosphere,
      hudPalette,
    };
  }

  if (biomeId === 'ASHEN_FOUNDRY') {
    // Molten archetype: smoky basalt & kiln brick shifting deeper into superheated magma crimson & amber-gold
    const heatHue = wrapHue(lerp(34, 14, depthNorm) + cycleOsc * 8 + rng.range(-6, 6));
    const basaltHue = wrapHue(352 + rng.range(-10, 14));

    const bgSkyTop = hslToRgb(basaltHue, lerp(14, 26, depthNorm), lerp(7, 5, depthNorm));
    const bgSkyBottom = hslToRgb(heatHue - 6, lerp(28, 44, depthNorm), lerp(11, 14, depthNorm));

    const stoneBase = hslToRgb(basaltHue, lerp(8, 16, depthNorm), lerp(25, 17, depthNorm));
    const dirtBase = hslToRgb(22 + rng.range(-6, 6), lerp(24, 30, depthNorm), lerp(24, 18, depthNorm));
    const brickBase = hslToRgb(lerp(14, 4, depthNorm) + rng.range(-5, 5), lerp(42, 54, depthNorm), lerp(35, 29, depthNorm));
    const woodBase = hslToRgb(24 + rng.range(-5, 5), 48, lerp(28, 22, depthNorm));
    const mossBase = hslToRgb(wrapHue(heatHue + 6), 62, lerp(41, 46, depthNorm));
    const crystalBase = hslToRgb(wrapHue(heatHue + 6), 88, lerp(58, 64, depthNorm));
    const bannerRgb = hslToRgb(heatHue, 68, 48);

    const accentHue = wrapHue(heatHue + 4);
    const accentRgb = hslToRgb(accentHue, 90, 60);
    const accentSoftRgb = hslToRgb(accentHue, 92, 76);
    const panelBgRgb = hslToRgb(16, 18, lerp(10, 8, depthNorm));

    const atmosphereTitle =
      safeDepth <= 3
        ? 'Smoldering Forge'
        : safeDepth <= 9
        ? 'Cinder Smeltery'
        : safeDepth <= 15
        ? 'Magma Ducts'
        : 'Crucible Core';

    const atmosphere: LightingAtmosphere = {
      ambientTintRgb: hslToRgb(heatHue, 74, 42),
      ambientAlpha: lerp(0.05, 0.14, depthNorm),
      vignetteRgb: hslToRgb(6, 46, 5),
      vignetteAlpha: lerp(0.22, 0.42, depthNorm),
      lightColorRgb: hslToRgb(wrapHue(heatHue + 6), 94, 62),
      lightAlpha: lerp(0.16, 0.27, depthNorm),
      lightRadiusScale: lerp(1.04, 0.92, depthNorm),
      crystalGlowRgb: hslToRgb(wrapHue(heatHue + 8), 96, 64),
      portalHex: rgbToHex(accentRgb),
    };

    const hudPalette: HudPalette = {
      accentHex: rgbToHex(accentRgb),
      accentSoftHex: rgbToHex(accentSoftRgb),
      accentRgb,
      accentBorder: rgbaStr(accentRgb, 0.38),
      accentGlow: rgbaStr(accentRgb, 0.15),
      panelBg: rgbaStr(panelBgRgb, 0.88),
      atmosphereTitle,
    };

    return {
      id: biomeId,
      name: 'Ashen Foundry',
      bgSkyTop,
      bgSkyBottom,
      stoneBase,
      dirtBase,
      brickBase,
      woodBase,
      mossBase,
      crystalBase,
      bannerRgb,
      liquidPrimary: Mat.OIL,
      accentHex: hudPalette.accentHex,
      atmosphere,
      hudPalette,
    };
  }

  // Crystal archetype (VITRIOL_VAULTS): rotates across emerald-jade, prism-aqua, and amethyst-quartz mineral harmonics
  const crystalBands = [148, 168, 272, 134, 184, 286];
  const baseBandHue = crystalBands[(cycle + (seed % crystalBands.length)) % crystalBands.length];
  const crystalHue = wrapHue(baseBandHue + depthNorm * 14 + rng.range(-10, 10));
  const stoneHue = wrapHue(crystalHue + 28);
  const mossHue = wrapHue(138 + cycleOsc * 20 + rng.range(-8, 8));

  const bgSkyTop = hslToRgb(stoneHue, lerp(20, 28, depthNorm), lerp(7, 5, depthNorm));
  const bgSkyBottom = hslToRgb(crystalHue, lerp(26, 36, depthNorm), lerp(12, 9, depthNorm));

  const stoneBase = hslToRgb(stoneHue, lerp(14, 22, depthNorm), lerp(26, 19, depthNorm));
  const dirtBase = hslToRgb(wrapHue(stoneHue - 35), lerp(18, 24, depthNorm), lerp(26, 19, depthNorm));
  const brickBase = hslToRgb(wrapHue(crystalHue - 22), lerp(18, 28, depthNorm), lerp(35, 25, depthNorm));
  const woodBase = hslToRgb(42 + rng.range(-8, 8), 32, lerp(29, 22, depthNorm));
  const mossBase = hslToRgb(mossHue, 52, lerp(44, 38, depthNorm));
  const crystalBase = hslToRgb(crystalHue, 78, lerp(62, 68, depthNorm));
  const bannerRgb = hslToRgb(crystalHue, 58, 44);

  const accentL = crystalHue >= 240 && crystalHue <= 295 ? 70 : 60;
  const accentRgb = hslToRgb(crystalHue, 80, accentL);
  const accentSoftRgb = hslToRgb(crystalHue, 84, 78);
  const panelBgRgb = hslToRgb(stoneHue, 18, lerp(10, 8, depthNorm));

  const atmosphereTitle =
    safeDepth <= 3
      ? 'Jade Fracture'
      : safeDepth <= 9
      ? 'Prismatic Vault'
      : safeDepth <= 15
      ? 'Amethyst Fault'
      : 'Astral Geode';

  const atmosphere: LightingAtmosphere = {
    ambientTintRgb: hslToRgb(crystalHue, 62, 40),
    ambientAlpha: lerp(0.05, 0.14, depthNorm),
    vignetteRgb: hslToRgb(stoneHue, 42, 5),
    vignetteAlpha: lerp(0.23, 0.45, depthNorm),
    lightColorRgb: hslToRgb(crystalHue, 86, 66),
    lightAlpha: lerp(0.15, 0.25, depthNorm),
    lightRadiusScale: lerp(1.05, 0.90, depthNorm),
    crystalGlowRgb: hslToRgb(crystalHue, 92, 70),
    portalHex: rgbToHex(accentRgb),
  };

  const hudPalette: HudPalette = {
    accentHex: rgbToHex(accentRgb),
    accentSoftHex: rgbToHex(accentSoftRgb),
    accentRgb,
    accentBorder: rgbaStr(accentRgb, 0.36),
    accentGlow: rgbaStr(accentRgb, 0.14),
    panelBg: rgbaStr(panelBgRgb, 0.88),
    atmosphereTitle,
  };

  return {
    id: biomeId,
    name: 'Vitriol Vaults',
    bgSkyTop,
    bgSkyBottom,
    stoneBase,
    dirtBase,
    brickBase,
    woodBase,
    mossBase,
    crystalBase,
    bannerRgb,
    liquidPrimary: Mat.ACID,
    accentHex: hudPalette.accentHex,
    atmosphere,
    hudPalette,
  };
}
