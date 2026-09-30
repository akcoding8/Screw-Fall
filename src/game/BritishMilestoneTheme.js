import * as THREE from 'three';
import { normalizePaletteStyle } from './PaletteManager.js';
import { britishThemeSeed } from './BritishMilestone.js';

const freeze = palette => Object.freeze({ ...palette, confetti: Object.freeze(palette.confetti), flagColours: Object.freeze(palette.flagColours) });
export const BRITISH_PALETTES = Object.freeze({
  soft: freeze({ id: 'british-heritage', name: 'British Heritage', family: 'soft', milestone: true,
    background: '#eeeade', column: '#254362', safe: '#356696', safeSide: '#254b75',
    hazard: '#a72b4b', hazardSide: '#791f38', hazardDetail: '#f4ddd2', ball: '#ffe3a3',
    ballShadow: '#17283b', particle: '#f4ebd8', finish: '#244b7b', accent: '#233d5a', uiBackground: '#eeeade',
    confetti: ['#a72b4b', '#f4ebd8', '#356696'], flagColours: { navy: '#254362', white: '#f4ebd8', red: '#a72b4b' },
  }),
  vivid: freeze({ id: 'british-royal', name: 'British Royal', family: 'vivid', milestone: true,
    background: '#f2f5ff', column: '#17378d', safe: '#165ac5', safeSide: '#123d91',
    hazard: '#ce1645', hazardSide: '#951230', hazardDetail: '#fff5f7', ball: '#ffe489',
    ballShadow: '#122357', particle: '#f8faff', finish: '#244e9e', accent: '#153372', uiBackground: '#f2f5ff',
    confetti: ['#ce1645', '#ffffff', '#165ac5'], flagColours: { navy: '#17378d', white: '#ffffff', red: '#ce1645' },
  }),
});

/** Mixed uses a separate visual seed. Preferences never enter the geometry seed. */
export function getBritishPalette(number, style = 'soft') {
  const requested = normalizePaletteStyle(style);
  const family = requested === 'mixed' ? ((britishThemeSeed(number) >>> 8) & 1 ? 'vivid' : 'soft') : requested;
  return BRITISH_PALETTES[family];
}

export const BRITISH_FLAG_LIMITS = Object.freeze({ width: 256, height: 128, maximumTextures: 4 });

/** Original analytic cross geometry on a 2:1 field. The narrow red diagonals
 * are offset within white diagonal bands, making the motif more than a tricolour.
 * Returns a colour role so geometry can be checked without a browser/canvas. */
export function unionJackColourRole(u, v) {
  const x = (u - .5) * 2, y = (v - .5);
  const first = y - x * .5, second = y + x * .5;
  let role = 'navy';
  if (Math.abs(first) < .080 || Math.abs(second) < .080) role = 'white';
  const offset = x < 0 ? -.023 : .023;
  if (Math.abs(first - offset) < .025 || Math.abs(second + offset) < .025) role = 'red';
  if (Math.abs(x) < .18 || Math.abs(y) < .16) role = 'white';
  if (Math.abs(x) < .105 || Math.abs(y) < .095) role = 'red';
  return role;
}

const pixels = new Map(), textures = new Map();
function pixelData(family) {
  if (pixels.has(family)) return pixels.get(family);
  const { width, height } = BRITISH_FLAG_LIMITS;
  const bytes = new Uint8Array(width * height * 4);
  const colours = Object.fromEntries(Object.entries(BRITISH_PALETTES[family].flagColours).map(([role, hex]) =>
    [role, [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16))]));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = colours[unionJackColourRole((x + .5) / width, (y + .5) / height)], offset = (y * width + x) * 4;
    bytes[offset] = color[0]; bytes[offset + 1] = color[1]; bytes[offset + 2] = color[2]; bytes[offset + 3] = 255;
  }
  pixels.set(family, bytes);
  return bytes;
}

/** Shared immutable texture resources; individual platform disposal must not
 * dispose these. Repeating the column motif keeps both crosses visible around it. */
export function getBritishFlagTexture(family = 'soft', usage = 'column') {
  family = family === 'vivid' ? 'vivid' : 'soft';
  usage = usage === 'finish' ? 'finish' : 'column';
  const key = `${family}:${usage}`;
  if (textures.has(key)) return textures.get(key);
  const texture = new THREE.DataTexture(pixelData(family), BRITISH_FLAG_LIMITS.width, BRITISH_FLAG_LIMITS.height, THREE.RGBAFormat);
  texture.name = `Original Union Jack ${key}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(usage === 'column' ? 2 : 1, usage === 'column' ? 96 : 1);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  texture.userData.sharedBritishMilestone = true;
  textures.set(key, texture);
  return texture;
}

export function applyBritishColumnMaterial(material, palette) {
  material.map = getBritishFlagTexture(palette.family, 'column');
  material.color.set('#ffffff'); material.roughness = .70; material.metalness = 0;
  material.needsUpdate = true;
  return material;
}

export function disposeBritishMilestoneTextures() {
  for (const texture of textures.values()) texture.dispose();
  textures.clear(); pixels.clear();
}

export function britishThemeCacheStats() { return { textures: textures.size, pixelBuffers: pixels.size, pixelBytes: pixels.size * 256 * 128 * 4 }; }
