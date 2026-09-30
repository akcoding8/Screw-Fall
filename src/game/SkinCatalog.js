import { CONFIG } from './config.js';

export const DEFAULT_SKIN_ID = 'classic';
export const PREMIUM_UNLOCK_POINTS = 100_000;
// Classic already expands by 24% on impact. This preserves that appearance,
// while bounding every other shape, its ornament, and its animated deformation.
export const SKIN_VISUAL_ENVELOPE = CONFIG.physics.ballRadius * 1.24;
export const SKIN_COLLIDER_RADIUS = CONFIG.physics.ballRadius;

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function skin(id, name, price, category, geometry, colors, summary, options = {}) {
  const effects = {
    palette: colors, bounce: 'particles', bounceCount: 5, pass: 'none', passCount: 0,
    trail: 'none', trailLifetime: .24, smash: 'particles', paint: false,
    paintEvery: 1, paintOpacity: .36, paintSize: .18, smashPaintScale: 1.55, ...options.effects,
  };
  return freeze({
    id, name, price, category, tier: 'standard', geometry: { type: geometry },
    material: { colors, roughness: .32, metalness: .05, ...options.material },
    visualScale: 1, visualEnvelopeRadius: SKIN_VISUAL_ENVELOPE,
    colliderRadius: SKIN_COLLIDER_RADIUS,
    previewOrientation: geometry === 'sphere' ? [0, 0, 0] : [.18, .35, -.1],
    previewSpinRate: .48, spinRate: geometry === 'sphere' ? .10 : .52,
    paletteAdaptive: false, performanceCost: 'low', summary,
    ...options, effects,
  });
}

/** Original procedural designs. Prices are direct purchases, never random draws. */
export const STANDARD_SKINS = Object.freeze([
  skin('classic', 'Classic', 0, 'Core', 'sphere', ['#f5dfa7'], 'The original smooth ball.', {
    paletteAdaptive: true, spinRate: 0,
    material: { colors: ['#f5dfa7'], roughness: .23, metalness: .08 },
    effects: { bounce: 'basic', bounceCount: 0, smash: 'basic' },
  }),
  skin('rubber', 'Rubber', 750, 'Core', 'sphere', ['#efa961'], 'Matte finish · soft impact rings', {
    material: { colors: ['#efa961'], roughness: .94, metalness: 0 }, effects: { bounce: 'ring', bounceCount: 1 },
  }),
  skin('marble', 'Marble', 1250, 'Materials', 'sphere', ['#f1eee5', '#6b8d9a'], 'Original flowing veins · stone dust', {
    texture: 'marble', effects: { bounce: 'dust', bounceCount: 5 },
  }),
  skin('panel-ball', 'Panel Ball', 1500, 'Core', 'sphere', ['#edcf7c', '#365b76'], 'Curved diagonal panels · matching particles', { texture: 'panels' }),
  skin('split-tone', 'Split Tone', 2000, 'Core', 'sphere', ['#91d6ce', '#f1d381'], 'Two colours · light paint splashes', {
    texture: 'split', effects: { bounce: 'paint', paint: 'dual', paintOpacity: .70, paintSize: .54, bounceCount: 5 },
  }),
  skin('facet', 'Facet', 2500, 'Shapes', 'facet', ['#a9d8e6', '#608ebd'], 'Sculpted faces · tiny coloured shards', { effects: { bounce: 'shards', bounceCount: 5 } }),
  skin('rounded-cube', 'Rounded Cube', 3000, 'Shapes', 'rounded-cube', ['#edb5d3'], 'Soft corners · gentle airborne rotation'),
  skin('capsule', 'Capsule', 3500, 'Shapes', 'capsule', ['#afdfb9', '#4f989a'], 'Compact oval · a short ribbon', {
    texture: 'split', effects: { trail: 'ribbon', trailLifetime: .21 },
  }),
  skin('halo', 'Halo', 4000, 'Shapes', 'halo', ['#edc67c', '#8cbdb8'], 'Compact ring and core · soft ring pulses', { effects: { bounce: 'ring', bounceCount: 1 } }),
  skin('chrome', 'Chrome', 5000, 'Materials', 'sphere', ['#dce7ef', '#6d8495'], 'Satin reflections · silver shimmer', {
    texture: 'chrome', material: { colors: ['#dce7ef', '#6d8495'], roughness: .16, metalness: .72 }, effects: { bounce: 'shimmer', bounceCount: 5 },
  }),
  skin('glass', 'Glass', 6000, 'Materials', 'glass', ['#b4e0e5', '#f2edc8'], 'Visible glass shell · a gentle ripple', {
    material: { colors: ['#b4e0e5', '#f2edc8'], roughness: .15, metalness: .1, opacity: .72 }, effects: { bounce: 'ripple', bounceCount: 1 },
  }),
  skin('jelly', 'Jelly', 6500, 'Materials', 'jelly', ['#c1b4e8'], 'Soft translucent form · cosmetic wobble', {
    material: { colors: ['#c1b4e8'], roughness: .2, metalness: 0, opacity: .88 }, effects: { bounce: 'ring', bounceCount: 1 },
  }),
  skin('crystal', 'Crystal', 7500, 'Materials', 'crystal', ['#b5c5ef', '#daebed'], 'Cut crystal · small coloured sparkles', { effects: { bounce: 'sparkle', bounceCount: 6, pass: 'sparkle', passCount: 2 } }),
  skin('disco', 'Disco', 8000, 'Materials', 'disco', ['#d1dfe5', '#b6a5d4', '#e5c58b'], 'Small mirrored facets · restrained sparkle', {
    texture: 'disco', material: { colors: ['#d1dfe5', '#b6a5d4', '#e5c58b'], roughness: .2, metalness: .55 }, effects: { bounce: 'sparkle', bounceCount: 6, pass: 'sparkle', passCount: 2 },
  }),
  skin('orbit', 'Orbit', 9000, 'Shapes', 'orbit', ['#b4cdec', '#e7bd80'], 'A compact decorative orbit · fine dust trail', { effects: { bounce: 'dust', trail: 'dust', trailLifetime: .2 } }),
  skin('neon-core', 'Neon Core', 10000, 'Effects', 'neon', ['#6ee0d1', '#344b63'], 'Luminous core · a fading neon trace', { effects: { bounce: 'ring', bounceCount: 1, trail: 'neon', trailLifetime: .23 } }),
  skin('duo-splash', 'Duo Splash', 11000, 'Effects', 'duo', ['#f3d260', '#75a8eb'], 'Two-colour paint · paired trail colours', {
    texture: 'split', effects: { palette: ['#ffd52a', '#2478ed'], bounce: 'paint', bounceCount: 7, paint: 'dual', paintSize: .56, paintOpacity: .74, trail: 'dual' },
  }),
  skin('spectrum', 'Spectrum', 12500, 'Effects', 'sphere', ['#edd76b', '#80d3ba', '#83b7e8', '#c3a3dd'], 'Colour bands · cycling trails and occasional paint', {
    texture: 'spectrum', effects: { bounce: 'paint', paint: 'multi', paintEvery: 2, paintSize: .56, paintOpacity: .72, trail: 'spectrum', pass: 'particles', passCount: 2 },
  }),
  skin('twist', 'Twist', 13500, 'Shapes', 'twist', ['#d1bcdf', '#8fcee0'], 'An original twisted solid · a fine ribbon', {
    spinRate: .7, effects: { trail: 'ribbon', trailLifetime: .26 },
  }),
  skin('paint-burst', 'Paint Burst', 15000, 'Effects', 'paint', ['#f2d46c', '#79b8e5', '#b6a0d8', '#85c9a2'], 'Patchwork facets · multicolour paint on every safe bounce', {
    texture: 'patchwork', effects: { bounce: 'paint', bounceCount: 8, paint: 'multi', paintOpacity: .76, paintSize: .58, trail: 'spectrum', pass: 'particles', passCount: 3, smashPaintScale: 1.8 },
  }),
]);

// Every premium surface is original procedural art. The lifetime milestone is
// checked by SkinManager; these prices always use the existing points balance.
const premium = (id, name, price, geometry, colors, summary, options = {}) => skin(id, name, price, 'Premium', geometry, colors, summary, {
  tier: 'premium', surface: id, spinRate: .13, previewSpinRate: .32,
  performanceCost: id === 'plasma-core' ? 'four-draws' : 'two-draws',
  ...options,
  effects: { bounce: 'paint', bounceCount: 7, paint: 'multi', paintSize: .60, paintOpacity: .78, smashPaintScale: 1.8,
    trail: 'spectrum', trailLifetime: .23, pass: 'sparkle', passCount: 2, ...options.effects },
});

export const PREMIUM_SKINS = Object.freeze([
  premium('auric-gold', 'Auric Gold', 1_000_000, 'sphere', ['#ffc029', '#fff1ac', '#ba650d'], 'Polished liquid gold · moving reflections', {
    effects: { bounce: 'sparkle', bounceCount: 8, trail: 'gold', paintOpacity: .80, paintSize: .62 },
  }),
  premium('plasma-core', 'Plasma Core', 500_000, 'plasma', ['#28e7ff', '#a239ff', '#365dff'], 'Contained energy · branching electric filaments', {
    spinRate: .08, effects: { bounce: 'shards', bounceCount: 9, trail: 'neon', passCount: 1 },
  }),
  premium('pearl-shift', 'Pearl Shift', 100_000, 'sphere', ['#f0e2ff', '#eb3dbd', '#24d8e5'], 'Pearlescent finish · shifting rainbow sheen'),
  premium('prism', 'Prism', 150_000, 'prism', ['#16dfff', '#fa2dba', '#ffc735'], 'Cut chromatic faces · separated spectrum colours', {
    spinRate: .25, effects: { bounce: 'shards', bounceCount: 8 },
  }),
  premium('obsidian-vein', 'Obsidian Vein', 350_000, 'sphere', ['#171b30', '#ffc53d', '#ff731d'], 'Polished obsidian · molten gold veins', { texture: 'obsidian' }),
  premium('nebula', 'Nebula', 250_000, 'sphere', ['#24218c', '#b830ec', '#f943b0', '#daeaff'], 'Deep cosmic clouds · quiet star glints', {
    texture: 'nebula', effects: { palette: ['#5924db', '#be38ef', '#fa48b3'] },
  }),
  premium('aurora', 'Aurora', 200_000, 'sphere', ['#21ed9e', '#12d6ed', '#953efa'], 'Flowing emerald, cyan and violet light', { texture: 'aurora' }),
]);

export const SKIN_CATALOG = Object.freeze([...STANDARD_SKINS, ...PREMIUM_SKINS]);

const byId = new Map(SKIN_CATALOG.map(definition => [definition.id, definition]));
export function getSkinDefinition(id) { return byId.get(id) || SKIN_CATALOG[0]; }
export function isKnownSkinId(id) { return byId.has(id); }

export function validateSkinCatalog(catalog = SKIN_CATALOG) {
  const errors = [], ids = new Set(), names = new Set();
  for (const entry of catalog) {
    if (!entry.id || ids.has(entry.id)) errors.push('Duplicate or missing skin ID');
    if (!entry.name || names.has(entry.name)) errors.push('Duplicate or missing skin name');
    ids.add(entry.id); names.add(entry.name);
    if (!Number.isSafeInteger(entry.price) || entry.price < 0) errors.push(`${entry.id}: invalid price`);
    if (!['standard', 'premium'].includes(entry.tier)) errors.push(`${entry.id}: invalid tier`);
    if (entry.colliderRadius !== CONFIG.physics.ballRadius) errors.push(`${entry.id}: collider changed`);
    if (entry.visualEnvelopeRadius !== SKIN_VISUAL_ENVELOPE) errors.push(`${entry.id}: envelope changed`);
    if (!entry.geometry?.type || !entry.material || entry.visualScale !== 1) errors.push(`${entry.id}: invalid visual descriptor`);
    if (!entry.effects?.palette?.length || entry.effects.palette.some(color => !/^#[0-9a-f]{6}$/i.test(color))) errors.push(`${entry.id}: invalid effect colours`);
    if (entry.effects?.paint && entry.effects.palette.length < 2) errors.push(`${entry.id}: paint needs multiple colours`);
    if (/https?:\/\//i.test(JSON.stringify(entry))) errors.push(`${entry.id}: external asset`);
  }
  if (catalog.find(entry => entry.id === DEFAULT_SKIN_ID)?.price !== 0) errors.push('Classic must be free');
  return { valid: errors.length === 0, errors };
}
