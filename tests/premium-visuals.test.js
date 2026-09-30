import { describe, expect, it, vi } from 'vitest';
import { SKIN_CATALOG, STANDARD_SKINS, PREMIUM_SKINS, PREMIUM_UNLOCK_POINTS, SKIN_COLLIDER_RADIUS, SKIN_VISUAL_ENVELOPE } from '../src/game/SkinCatalog.js';
import { SkinMeshFactory, PREMIUM_VISUAL_LIMITS } from '../src/game/SkinMeshFactory.js';
import { SkinVisual } from '../src/game/SkinVisual.js';

const expected = [
  ['auric-gold', 'Auric Gold', 1_000_000], ['plasma-core', 'Plasma Core', 500_000],
  ['pearl-shift', 'Pearl Shift', 100_000], ['prism', 'Prism', 150_000],
  ['obsidian-vein', 'Obsidian Vein', 350_000], ['nebula', 'Nebula', 250_000], ['aurora', 'Aurora', 200_000],
];

function resources(factory) {
  const geometry = new Set(), material = new Set(), texture = new Set();
  for (const entry of factory.entries.values()) {
    for (const item of entry.geometries) geometry.add(item);
    for (const item of entry.materials) material.add(item);
    for (const item of entry.textures) texture.add(item);
  }
  return { geometry, material, texture };
}

describe('curated premium visuals', () => {
  it('keeps the requested seven unique premium identities and exact price ladder', () => {
    expect(PREMIUM_UNLOCK_POINTS).toBe(100_000);
    expect(PREMIUM_SKINS.map(skin => [skin.id, skin.name, skin.price])).toEqual(expected);
    expect(STANDARD_SKINS).toHaveLength(20);
    expect(SKIN_CATALOG).toHaveLength(27);
    expect(new Set(SKIN_CATALOG.map(skin => skin.id)).size).toBe(27);
    expect(new Set(SKIN_CATALOG.map(skin => skin.name)).size).toBe(27);
    expect(PREMIUM_SKINS.every(skin => skin.tier === 'premium' && Number.isSafeInteger(skin.price))).toBe(true);
    expect(STANDARD_SKINS.every(skin => skin.tier === 'standard')).toBe(true);
    for (const skin of PREMIUM_SKINS) {
      expect(skin.colliderRadius).toBe(SKIN_COLLIDER_RADIUS);
      expect(skin.visualEnvelopeRadius).toBe(SKIN_VISUAL_ENVELOPE);
      expect(skin.effects.paintSize).toBeGreaterThanOrEqual(.60);
      expect(skin.effects.paintOpacity).toBeGreaterThanOrEqual(.78);
      expect(skin.effects.bounceCount).toBeLessThanOrEqual(9);
    }
  });

  it('uses seven distinct bounded surface programs and a perfect sphere for Gold and Pearl', () => {
    const factory = new SkinMeshFactory();
    try {
      const programs = new Set();
      for (const skin of PREMIUM_SKINS) {
        const entry = factory.getEntry(skin.id);
        expect(entry.primary.isShaderMaterial).toBe(true);
        programs.add(entry.primary.fragmentShader);
        expect(entry.primary.uniforms.skinTime.value).toBe(0);
        expect(entry.primary.uniforms.skinCharge.value).toBe(0);
        expect(entry.radius).toBeLessThanOrEqual(SKIN_VISUAL_ENVELOPE);
        let draws = 0;
        entry.prototype.traverse(object => { if (object.isMesh || object.isLineSegments) draws++; });
        expect(draws).toBeLessThanOrEqual(PREMIUM_VISUAL_LIMITS.maximumDraws);
        expect(entry.prototype.children.some(object => object.isLight)).toBe(false);
      }
      expect(programs.size).toBe(7);
      for (const id of ['auric-gold', 'pearl-shift']) {
        expect(factory.getEntry(id).prototype.children[0].geometry.parameters).toMatchObject({ radius: SKIN_COLLIDER_RADIUS, widthSegments: 24, heightSegments: 18 });
      }
      expect(factory.getEntry('auric-gold').textures.size).toBe(0);
      expect(factory.getEntry('prism').prototype.children[0].geometry.type).toBe('IcosahedronGeometry');
    } finally { factory.dispose(); }
  });

  it('contains twelve branching electric hairs in one shared, animated line buffer', () => {
    const factory = new SkinMeshFactory(), visual = new SkinVisual(factory, { skinId: 'plasma-core' });
    try {
      const entry = factory.getEntry('plasma-core');
      const filaments = visual.mesh.getObjectByName('plasma-branching-filaments');
      const core = visual.mesh.getObjectByName('plasma-inner-core');
      expect(filaments.isLineSegments).toBe(true);
      expect(filaments.geometry.attributes.position.count).toBe(PREMIUM_VISUAL_LIMITS.plasmaBranches * PREMIUM_VISUAL_LIMITS.plasmaSegmentsPerBranch * 2);
      expect(filaments.geometry.attributes.skinPhase.count).toBe(192);
      const positions = filaments.geometry.attributes.position;
      for (let index = 0; index < positions.count; index++) {
        const radius = Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index));
        expect(radius).toBeLessThan(SKIN_COLLIDER_RADIUS);
        expect(radius).toBeGreaterThan(0);
      }
      expect(core.geometry.parameters.radius).toBe(.075);
      expect(entry.primary.transparent).toBe(true);
      const buffer = positions.array, uniforms = filaments.material.uniforms;
      for (let index = 0; index < 120; index++) visual.update({ dt: 1 / 120, time: index / 120, smashReady: true });
      expect(filaments.geometry.attributes.position.array).toBe(buffer);
      expect(filaments.material.uniforms).toBe(uniforms);
      expect(uniforms.skinTime.value).toBeCloseTo(119 / 120);
      expect(uniforms.skinCharge.value).toBe(1);
      expect(factory.entries.size).toBe(1);
      expect(factory.instances.size).toBe(1);
    } finally { visual.dispose(); factory.dispose(); }
  });

  it('caches a small fixed resource set through repeated premium equipment changes and disposes it once', () => {
    const factory = new SkinMeshFactory(), visual = new SkinVisual(factory);
    for (let cycle = 0; cycle < 5; cycle++) for (const skin of PREMIUM_SKINS) {
      visual.equip(skin.id); visual.update({ dt: 1 / 60, time: cycle });
    }
    const cached = resources(factory);
    expect(factory.entries.size).toBe(8);
    expect(factory.instances.size).toBe(1);
    expect(cached.texture.size).toBe(3);
    expect(cached.material.size).toBeLessThanOrEqual(17);
    for (const texture of cached.texture) {
      expect(texture.image.width).toBe(PREMIUM_VISUAL_LIMITS.textureWidth);
      expect(texture.image.height).toBe(PREMIUM_VISUAL_LIMITS.textureHeight);
      expect(texture.image.data.byteLength).toBe(32_768);
    }
    const all = [...cached.geometry, ...cached.material, ...cached.texture];
    const callbacks = all.map(resource => { const callback = vi.fn(); resource.addEventListener('dispose', callback); return callback; });
    visual.dispose(); factory.dispose(); factory.dispose();
    expect(callbacks.every(callback => callback.mock.calls.length === 1)).toBe(true);
  });
});
