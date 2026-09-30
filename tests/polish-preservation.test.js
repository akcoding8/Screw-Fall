import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import baseline from './fixtures/phase3-polish-baseline.json';
import { STANDARD_SKINS } from '../src/game/SkinCatalog.js';
import { CONFIG } from '../src/game/config.js';

const hash = source => createHash('sha256').update(source).digest('hex');
const source = file => readFileSync(new URL(`../src/game/${file}`, import.meta.url), 'utf8');
const authorised = new Set(['Game.js', 'SkinCatalog.js', 'SkinMeshFactory.js', 'SkinVisual.js',
  'SkinPreviewRenderer.js', 'SkinShopPanel.js', 'SkinManager.js', 'ProgressionDebug.js',
  'EconomyAnalyzer.js', 'PaletteManager.js', 'PaintMarkPool.js', 'CosmeticEffectManager.js', 'SoundManager.js',
  // Later Phase 4 changes have separate strict preservation coverage.
  'SaveManager.js', 'config.js', 'Simulation.js', 'ParticleSystem.js', 'GenerationConfig.js',
  'LevelCadence.js', 'LevelGenerator.js', 'LevelManager.js', 'LevelValidator.js']);

describe('presentation polish preserves Phase 3 gameplay and economy', () => {
  it.each(Object.entries(baseline.sourceHashes).filter(([file]) => !authorised.has(file)))(
    'preserves %s byte-for-byte', (file, expected) => { expect(hash(source(file))).toBe(expected); });

  it('adds Phase 4 provenance in schema 5 while retaining every standard price', () => {
    expect(baseline.saveVersion).toBe(4);
    expect(CONFIG.save.version).toBe(5);
    expect(STANDARD_SKINS.map(({ id, price }) => ({ id, price }))).toEqual(baseline.standardPrices);
  });

  it('only adds purchase cues, preserving every byte of the original audio engine and gameplay cues', () => {
    const withoutNewCues = source('SoundManager.js')
      .replace(/  purchase(?:Premium|Gold)?: \[\n[\s\S]*?\n  \],\n/g, '')
      .replace(/  purchase(?:Premium|Gold)?: \['purchaseVolume', \.18\],\n/g, '');
    expect(hash(withoutNewCues)).toBe(baseline.sourceHashes['SoundManager.js']);
  });
});
