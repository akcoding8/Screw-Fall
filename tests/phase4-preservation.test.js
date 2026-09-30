import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import baseline from './fixtures/phase4-baseline.json';
import { CONFIG } from '../src/game/config.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { SKIN_CATALOG, PREMIUM_UNLOCK_POINTS } from '../src/game/SkinCatalog.js';

const hash = source => createHash('sha256').update(source).digest('hex');
const source = file => readFileSync(new URL(`../src/game/${file}`, import.meta.url), 'utf8');
// The request explicitly changes these adapters/models. Everything outside
// this list, including scoring, both ordinary palette families and the shop,
// must remain identical to the snapshot taken before Phase 4 began.
const authorised = new Set(['Game.js', 'SaveManager.js', 'config.js', 'Simulation.js', 'GenerationConfig.js',
  'LevelCadence.js', 'LevelGenerator.js', 'LevelManager.js', 'LevelValidator.js', 'ProgressionDebug.js',
  'PaintMarkPool.js', 'CosmeticEffectManager.js', 'ParticleSystem.js', 'SkinCatalog.js']);

describe('Phase 4 preserves the approved physics, scoring, skins and ordinary generation', () => {
  it.each(Object.entries(baseline.sourceHashes).filter(([file]) => !authorised.has(file)))(
    'preserves %s byte-for-byte', (file, expected) => { expect(hash(source(file))).toBe(expected); });

  it('changes only save schema 4 → 5 among all physics, camera, input, audio and rendering constants', () => {
    expect(baseline.saveVersion).toBe(4);
    expect(CONFIG).toEqual({ ...baseline.config, save: { ...baseline.config.save, version: 5 } });
  });

  it('keeps all normal v4 / Flow v2 generation settings and adds only milestone v1', () => {
    const { britishMilestone, ...ordinary } = GENERATION;
    expect(ordinary).toEqual(baseline.generation);
    expect(britishMilestone).toEqual({ version: 1, themeVersion: 1, platformCount: [45, 50] });
  });

  it('keeps every catalogue field and price except the explicitly requested smash-paint scale', () => {
    const stripped = SKIN_CATALOG.map(skin => {
      const { smashPaintScale, ...effects } = skin.effects;
      expect(smashPaintScale).toBe(skin.tier === 'premium' || skin.id === 'paint-burst' ? 1.8 : 1.55);
      return { ...skin, effects };
    });
    expect(stripped).toEqual(baseline.skinCatalog);
    expect(PREMIUM_UNLOCK_POINTS).toBe(100000);
  });

  it('changes only the next-level resolver in the entire authoritative simulation', () => {
    const previousSimulation = source('Simulation.js')
      .replace('debugEnabled = false,\n    resolveNextLevel = number => Math.min(Number.MAX_SAFE_INTEGER, number + 1) }', 'debugEnabled = false }')
      .replace('    this.resolveNextLevel = resolveNextLevel;\n', '')
      .replace('this.loadLevel(this.resolveNextLevel(this.levelNumber));', 'this.loadLevel(Math.min(Number.MAX_SAFE_INTEGER, this.levelNumber + 1));');
    expect(hash(previousSimulation)).toBe(baseline.sourceHashes['Simulation.js']);
  });

  it('changes only selected top-face colours in the entire existing debris engine', () => {
    const previousParticles = source('ParticleSystem.js')
      .replace('shatter(platformGroup, strong = false, paintPalette = null)', 'shatter(platformGroup, strong = false)')
      .replace(/      \/\/ Surface geometries belong to their existing fragments\.[\s\S]*?        piece\.userData\.paintAccent = this\.color\.getHexString\(\);\n      }\n/, '');
    // The unchanged source includes all random calls, counts, velocities,
    // gravity, spin, pool handling and fragment lifetime, not just constants.
    expect(hash(previousParticles)).toBe(baseline.sourceHashes['ParticleSystem.js']);
  });
});
