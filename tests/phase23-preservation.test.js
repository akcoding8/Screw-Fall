import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import baseline from './fixtures/phase22-baseline.json';
import { CONFIG } from '../src/game/config.js';
import { WALL_CONFIG } from '../src/game/ObstacleConfig.js';
import { HAZARD_EDGE_INSET, HAZARD_COLLISION } from '../src/game/HazardCollision.js';

describe('Phase 2.3 preserves the approved Phase 2.2 foundation', () => {
  it('keeps every physics, camera, contact, input, audio, debris and rendering constant', () => {
    // Phase 4 adds provenance in schema 5; every gameplay value stays locked.
    expect(CONFIG).toEqual({ ...baseline.config, save: { ...baseline.config.save, version: 5 } });
    expect(WALL_CONFIG).toEqual(baseline.wall);
    expect(HAZARD_EDGE_INSET).toBe(baseline.hazard.angularInset);
    for (const [key, value] of Object.entries(HAZARD_COLLISION)) expect(value).toBe(baseline.hazard[key]);
  });

  // These modules are intentionally outside this content-generation phase.
  // Exact source fingerprints catch a silent retune as well as a changed rule.
  // Persistence is intentionally extended in Phase 3. CONFIG values remain
  // checked above; all other approved module fingerprints stay unchanged.
  // Premium polish authorises Vivid retuning and new purchase-only sound cues.
  // Phase 4's next-level resolver and paint-only fragment tint are checked by
  // narrow source comparisons and seeded motion tests in the Phase 4 suite.
  it.each(Object.entries(baseline.lockedFileHashes).filter(([file]) => !['config.js', 'SaveManager.js', 'PaletteManager.js', 'SoundManager.js', 'Simulation.js', 'ParticleSystem.js'].includes(file)))('keeps approved %s unchanged', (file, expected) => {
    const source = readFileSync(new URL(`../src/game/${file}`, import.meta.url));
    expect(createHash('sha256').update(source).digest('hex')).toBe(expected);
  });
});
