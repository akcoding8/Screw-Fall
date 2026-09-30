import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import baseline from './fixtures/phase23-baseline.json';
import { CONFIG } from '../src/game/config.js';
import { VISUAL_CONFIG } from '../src/game/VisualConfig.js';
import { GENERATION } from '../src/game/GenerationConfig.js';

describe('Phase 3 preserves the captured Phase 2.3 gameplay', () => {
  it('changes only the authorised save version among every gameplay and effect constant', () => {
    expect(CONFIG).toEqual({ ...baseline.config, save: { ...baseline.config.save, version: 5 } });
    expect(VISUAL_CONFIG).toEqual(baseline.visual);
    const { britishMilestone, ...ordinaryGeneration } = GENERATION;
    expect(ordinaryGeneration).toEqual(baseline.generation);
    expect(britishMilestone).toEqual({ version: 1, themeVersion: 1, platformCount: [45, 50] });
  });

  // The adapter and persistence are this phase's authorised integration points.
  // Everything else, including complete generation/physics/motion/camera/input/
  // debris code, is compared against the before-edit snapshot. The subsequent
  // polish explicitly retunes Vivid and adds purchase cues; separate focused
  // tests preserve Soft and every original gameplay audio cue.
  // Phase 4 adds only every-hundredth milestone generation, provenance at the
  // existing transition, and paint tint. Its own suite locks ordinary output.
  it.each(Object.entries(baseline.sourceHashes).filter(([file]) => !['Game.js', 'SaveManager.js', 'config.js', 'PaletteManager.js', 'SoundManager.js',
    'GenerationConfig.js', 'LevelCadence.js', 'LevelGenerator.js', 'LevelManager.js', 'LevelValidator.js', 'Simulation.js', 'ParticleSystem.js'].includes(file)))(
    'keeps approved %s byte-for-byte unchanged', (file, expected) => {
      const source = readFileSync(new URL(`../src/game/${file}`, import.meta.url));
      expect(createHash('sha256').update(source).digest('hex')).toBe(expected);
    },
  );
});
