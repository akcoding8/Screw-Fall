import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { ALL_PALETTES, selectPalette } from '../src/game/PaletteManager.js';
import { SKIN_CATALOG, STANDARD_SKINS, DEFAULT_SKIN_ID, SKIN_VISUAL_ENVELOPE, getSkinDefinition, validateSkinCatalog } from '../src/game/SkinCatalog.js';
import { SkinMeshFactory, skinReadability } from '../src/game/SkinMeshFactory.js';
import { SkinVisual } from '../src/game/SkinVisual.js';
import { SkinPreviewRenderer, SKIN_PREVIEW_LIMITS } from '../src/game/SkinPreviewRenderer.js';
import { Simulation } from '../src/game/Simulation.js';

const expected = [
  ['Classic', 0], ['Rubber', 750], ['Marble', 1250], ['Panel Ball', 1500], ['Split Tone', 2000],
  ['Facet', 2500], ['Rounded Cube', 3000], ['Capsule', 3500], ['Halo', 4000], ['Chrome', 5000],
  ['Glass', 6000], ['Jelly', 6500], ['Crystal', 7500], ['Disco', 8000], ['Orbit', 9000],
  ['Neon Core', 10000], ['Duo Splash', 11000], ['Spectrum', 12500], ['Twist', 13500], ['Paint Burst', 15000],
];

function maximumRadius(root) {
  root.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  let maximum = 0;
  root.traverse(object => {
    const position = object.geometry?.attributes.position;
    if (position) for (let index = 0; index < position.count; index++) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      maximum = Math.max(maximum, point.length());
    }
  });
  return maximum;
}

function previewHarness(options = {}) {
  const renderer = { setPixelRatio: vi.fn(), setSize: vi.fn(), setClearColor: vi.fn(), render: vi.fn(), dispose: vi.fn() };
  const rendererFactory = vi.fn(() => renderer);
  const canvas = { toDataURL: vi.fn(() => 'data:image/png;base64,local-procedural-preview') };
  const onThumbnail = vi.fn();
  const preview = new SkinPreviewRenderer({ canvas, rendererFactory, onThumbnail, palette: selectPalette(1), ...options });
  return { renderer, rendererFactory, canvas, onThumbnail, preview };
}

describe('original skin catalogue', () => {
  it('contains exactly the requested twenty names, prices, unique identities and a free Classic', () => {
    expect(STANDARD_SKINS.map(skin => [skin.name, skin.price])).toEqual(expected);
    expect(new Set(STANDARD_SKINS.map(skin => skin.id)).size).toBe(20);
    expect(new Set(STANDARD_SKINS.map(skin => skin.name)).size).toBe(20);
    expect(DEFAULT_SKIN_ID).toBe('classic');
    expect(validateSkinCatalog()).toEqual({ valid: true, errors: [] });
    expect(getSkinDefinition('unknown')).toBe(SKIN_CATALOG[0]);
    expect(getSkinDefinition(null)).toBe(SKIN_CATALOG[0]);
    expect(Object.isFrozen(SKIN_CATALOG[16].effects.palette)).toBe(true);
  });

  it('rejects duplicate identities, corrupt prices, collider changes and external assets', () => {
    const invalid = { ...SKIN_CATALOG[1], id: 'classic', name: 'Classic', price: Infinity, colliderRadius: .12, texture: 'https://example.com/copied.png' };
    const result = validateSkinCatalog([SKIN_CATALOG[0], invalid]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(5);
  });

  it('keeps multicolour profiles parseable and yellow/blue Duo Splash distinct', () => {
    for (const skin of SKIN_CATALOG) {
      expect(skin.effects.palette.every(color => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
      if (skin.effects.paint) expect(new Set(skin.effects.palette).size).toBeGreaterThanOrEqual(2);
      expect(skin.colliderRadius).toBe(CONFIG.physics.ballRadius);
      expect(skin.visualEnvelopeRadius).toBe(SKIN_VISUAL_ENVELOPE);
    }
    expect(getSkinDefinition('duo-splash').effects.palette).toEqual(['#ffd52a', '#2478ed']);
    expect(getSkinDefinition('spectrum').effects.paintEvery).toBe(2);
    expect(getSkinDefinition('paint-burst').effects.paintEvery).toBe(1);
  });

  it('retains readable colours or a contrasting edge in every authored palette', () => {
    for (const skin of SKIN_CATALOG) for (const palette of ALL_PALETTES) {
      for (const metric of Object.values(skinReadability(skin, palette))) {
        expect(Math.max(metric.bestColorContrast, metric.edgeContrast || 0)).toBeGreaterThanOrEqual(2.3);
      }
    }
  });
});

describe('cached procedural geometry and invariant envelope', () => {
  it.each(SKIN_CATALOG)('$name fits the common envelope at all tested rotations, squash and wobble extremes', skin => {
    const factory = new SkinMeshFactory(), visual = new SkinVisual(factory, { skinId: skin.id });
    try {
      expect(visual.mesh.userData.visualRadius).toBeGreaterThanOrEqual(CONFIG.physics.ballRadius - 1e-6);
      // Every ornamental vertex participates, including Orbit's ring, Neon ribs,
      // glass core, silhouette shell, and animated nonuniform scale.
      for (let sample = 0; sample < 28; sample++) {
        visual.update({ dt: .1, time: sample * .13, impact: sample % 3 === 0 ? 1 : .5, stretch: sample % 2 ? .2 : 0, smashReady: true });
        expect(maximumRadius(visual.root)).toBeLessThanOrEqual(SKIN_VISUAL_ENVELOPE + 1e-7);
      }
      const bounds = new THREE.Box3().setFromObject(visual.mesh);
      const size = bounds.getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(.43);
    } finally { visual.dispose(); factory.dispose(); }
  });

  it('preserves Classic geometry, material, palette adaptation and original scale response', () => {
    const factory = new SkinMeshFactory(), palette = selectPalette(1);
    const visual = new SkinVisual(factory, { palette });
    try {
      const entry = visual.mesh.userData.skinResource;
      expect(visual.mesh.children).toHaveLength(1);
      expect(entry.prototype.children[0].geometry.parameters).toMatchObject({ radius: .275, widthSegments: 24, heightSegments: 18 });
      expect(entry.primary.roughness).toBe(.23);
      expect(entry.primary.metalness).toBe(.08);
      expect(entry.primary.color.getHexString()).toBe(palette.ball.slice(1));
      visual.update({ dt: .1, time: 50, impact: .5, stretch: .09 });
      expect(visual.root.scale.toArray()).toEqual([1 + .12 - .09 * .35, 1 - .12 + .09, 1 + .12 - .09 * .35]);
      expect(visual.mesh.rotation.x).toBe(0);
      expect(visual.mesh.rotation.y).toBe(0);
      expect(entry.primary.emissiveIntensity).toBe(.025);
      visual.update({ smashReady: true });
      expect(entry.primary.emissiveIntensity).toBe(.65);
    } finally { visual.dispose(); factory.dispose(); }
  });

  it('reuses geometry, textures and materials across selections and disposes each resource once', () => {
    const factory = new SkinMeshFactory();
    const first = factory.create('marble'), second = factory.create('marble');
    expect(first.children[0].geometry).toBe(second.children[0].geometry);
    expect(first.children[0].material).toBe(second.children[0].material);
    const entry = factory.getEntry('marble');
    const resources = [...entry.geometries, ...entry.materials, ...entry.textures];
    const disposals = resources.map(resource => { const listener = vi.fn(); resource.addEventListener('dispose', listener); return listener; });
    factory.release(first); factory.release(first);
    expect(disposals.every(listener => listener.mock.calls.length === 0)).toBe(true);
    for (let index = 0; index < 100; index++) { const group = factory.create('marble'); factory.release(group); }
    expect(factory.entries.size).toBe(1);
    expect(factory.instances.size).toBe(1);
    factory.dispose(); factory.dispose();
    expect(disposals.every(listener => listener.mock.calls.length === 1)).toBe(true);
    expect(factory.entries.size).toBe(0);
    expect(factory.instances.size).toBe(0);
    expect(() => factory.create('classic')).toThrow('disposed');
  });

  it('keeps the ball centre and gameplay result unchanged while every non-spherical skin rotates', () => {
    const factory = new SkinMeshFactory(), visual = new SkinVisual(factory);
    const baseline = new Simulation({ levelNumber: 1 }), withSkins = new Simulation({ levelNumber: 1 });
    visual.root.position.set(0, 5, 2.05);
    for (const skin of SKIN_CATALOG) {
      visual.equip(skin.id);
      for (let tick = 0; tick < 10; tick++) {
        baseline.step(CONFIG.physics.fixedStep); withSkins.step(CONFIG.physics.fixedStep);
        visual.update({ dt: CONFIG.physics.fixedStep, time: tick / 120, impact: .5 });
      }
      expect(visual.root.position.toArray()).toEqual([0, 5, 2.05]);
      expect(withSkins.ball).toEqual(baseline.ball);
      expect(withSkins.state).toBe(baseline.state);
      expect(withSkins.rotation).toBe(baseline.rotation);
    }
    visual.dispose(); factory.dispose();
  });

  it('integrates visual orientation independently of render frequency and resets discontinuities', () => {
    const firstFactory = new SkinMeshFactory(), secondFactory = new SkinMeshFactory();
    const first = new SkinVisual(firstFactory, { skinId: 'rounded-cube' });
    const second = new SkinVisual(secondFactory, { skinId: 'rounded-cube' });
    for (let frame = 0; frame < 120; frame++) first.update({ dt: 1 / 120, impact: frame === 0 ? 1 : 0 });
    for (let frame = 0; frame < 60; frame++) second.update({ dt: 1 / 60, impact: frame === 0 ? 1 : 0 });
    expect(first.turn).toBeCloseTo(second.turn, 12);
    first.reset(); second.reset();
    expect(first.turn).toBe(0);
    expect(first.mesh.rotation.toArray()).toEqual(second.mesh.rotation.toArray());
    expect(first.root.scale.toArray()).toEqual([1, 1, 1]);
    first.dispose(); second.dispose(); firstFactory.dispose(); secondFactory.dispose();
  });
});

describe('one bounded shop preview renderer', () => {
  it('initializes lazily, generates twenty-seven cached real-mesh thumbnails, and reuses one context', () => {
    const { preview, renderer, rendererFactory, canvas, onThumbnail } = previewHarness();
    expect(rendererFactory).not.toHaveBeenCalled();
    preview.open('paint-burst');
    for (let frame = 0; frame < 120; frame++) preview.update(1 / 120);
    expect(preview.cache.size).toBe(27);
    expect(canvas.toDataURL).toHaveBeenCalledTimes(27);
    expect(onThumbnail).toHaveBeenCalledTimes(27);
    expect(preview.factory.entries.size).toBe(27);
    expect(preview.factory.instances.size).toBe(1);
    expect(preview.visual.skin.id).toBe('paint-burst');
    expect(preview.paint.filter(mesh => mesh.visible)).toHaveLength(3);
    preview.close(); const closedCalls = renderer.render.mock.calls.length;
    for (let frame = 0; frame < 120; frame++) preview.update(1 / 120);
    expect(renderer.render).toHaveBeenCalledTimes(closedCalls);
    for (let count = 0; count < 8; count++) { preview.open('orbit'); preview.close(); }
    expect(rendererFactory).toHaveBeenCalledTimes(1);
    expect(canvas.toDataURL).toHaveBeenCalledTimes(27);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(1);
    preview.dispose(); preview.dispose();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('limits live previews to 30 Hz without capping or operating on gameplay', () => {
    const { preview, renderer } = previewHarness();
    preview.open(); preview.pending.length = 0; renderer.render.mockClear();
    for (let frame = 0; frame < 120; frame++) preview.update(1 / 120);
    expect(renderer.render.mock.calls.length).toBeLessThanOrEqual(31);
    expect(renderer.render.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(SKIN_PREVIEW_LIMITS.width).toBe(256);
    preview.dispose();
  });

  it('invalidates only the adaptive thumbnail and bounds cache across palettes', () => {
    const { preview, canvas } = previewHarness();
    preview.open(); for (let frame = 0; frame < 30; frame++) preview.update(1 / 30);
    const fixed = preview.thumbnail('marble');
    preview.close(); preview.open('classic', selectPalette(7, 'vivid'));
    for (let frame = 0; frame < 3; frame++) preview.update(1 / 30);
    expect(canvas.toDataURL).toHaveBeenCalledTimes(28);
    expect(preview.cache.size).toBe(27);
    expect(preview.thumbnail('marble')).toBe(fixed);
    preview.dispose();
  });

  it('provides local procedural fallback without canvas export or WebGL support', () => {
    const unavailable = previewHarness({ rendererFactory: () => { throw new Error('No WebGL'); } }).preview;
    expect(() => unavailable.open('halo')).not.toThrow();
    expect(unavailable.thumbnail('halo')).toMatch(/^data:image\/svg\+xml/);
    expect(unavailable.update(.1)).toBe(false);
    unavailable.close(); unavailable.dispose();
    const { preview, canvas } = previewHarness();
    canvas.toDataURL.mockImplementation(() => { throw new Error('Unavailable export'); });
    preview.open(); preview.update(.1);
    expect(preview.thumbnail('classic')).toMatch(/^data:image\/svg\+xml/);
    preview.dispose();
  });
});
