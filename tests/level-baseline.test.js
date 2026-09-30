import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import baseline from './fixtures/phase4-baseline.json';
import derivedWidths from './fixtures/phase4-derived-widths.json';
import { compareLevelBaseline, DERIVED_WIDTH_MAX_ULPS } from '../scripts/level-baseline.mjs';
import { generateLevel } from '../src/game/LevelGenerator.js';

const sample = baseline.levels.find(level => level.number === 11);
const widths = derivedWidths.levels[11];
const hash = level => createHash('sha256').update(JSON.stringify(level)).digest('hex');
const compare = level => compareLevelBaseline(level, sample, widths);
function shiftPositive(value, ulps) {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value);
  bits.setBigUint64(0, bits.getBigUint64(0) + ulps);
  return bits.getFloat64(0);
}

describe('portable verification of the unchanged approved level baseline', () => {
  it('covers every historical ordinary sample, including Flow levels', () => {
    expect(Object.keys(derivedWidths.levels)).toEqual(baseline.levels
      .filter(level => level.number % 100 !== 0).map(level => String(level.number)));
    for (const entry of baseline.levels.filter(level => level.number % 100 !== 0)) {
      const level = generateLevel(entry.number);
      expect(Object.keys(derivedWidths.levels[entry.number])).toEqual(level.platforms
        .filter(platform => platform.silhouetteMetrics).map(platform => platform.id));
      expect(compareLevelBaseline(level, entry, derivedWidths.levels[entry.number]).differences).toEqual([]);
    }
  });

  it('reproduces both architecture hashes and accepts only their one-ULP diagnostic difference', () => {
    const arm = generateLevel(11);
    expect(compare(arm).matches).toBe(true);
    // Reconstruct the historical record from independently checked metrics,
    // so this proof does not assume every host varies at only one platform.
    for (const platform of arm.platforms) {
      if (Object.hasOwn(widths, platform.id)) platform.silhouetteMetrics.safeWidthBallDiameters = widths[platform.id];
    }
    const x64 = structuredClone(arm);
    arm.platforms[32].silhouetteMetrics.safeWidthBallDiameters = 2.797341058311959;
    x64.platforms[32].silhouetteMetrics.safeWidthBallDiameters = 2.7973410583119587;
    expect(hash(arm)).toBe(sample.hash);
    expect(hash(x64)).toBe('748d86114e1c78e3886f4f86089dc5c3c1ac638d36f13ffb798836f9a0a109e8');
    expect(shiftPositive(arm.platforms[32].silhouetteMetrics.safeWidthBallDiameters, -1n))
      .toBe(x64.platforms[32].silhouetteMetrics.safeWidthBallDiameters);
    expect(compare(arm)).toMatchObject({ matches: true, hash: sample.hash, differences: [] });
    expect(compare(x64)).toMatchObject({ matches: true, hash: sample.hash, differences: [] });
  });

  it.each([-1n, 1n])('enforces the exact ULP boundary in direction %s', direction => {
    const level = generateLevel(11), expected = widths['platform-32'];
    level.platforms[32].silhouetteMetrics.safeWidthBallDiameters = shiftPositive(expected, direction * DERIVED_WIDTH_MAX_ULPS);
    expect(compare(level).matches).toBe(true);
    level.platforms[32].silhouetteMetrics.safeWidthBallDiameters = shiftPositive(expected, direction * (DERIVED_WIDTH_MAX_ULPS + 1n));
    const result = compare(level);
    expect(result.matches).toBe(false);
    expect(result.differences[0].path).toBe('platforms[32].silhouetteMetrics.safeWidthBallDiameters');
  });

  it.each([NaN, Infinity, -Infinity, undefined, null, '2.797341058311959', -1])('rejects invalid derived widths: %s', value => {
    const level = generateLevel(11);
    level.platforms[32].silhouetteMetrics.safeWidthBallDiameters = value;
    expect(compare(level).matches).toBe(false);
  });

  it.each([
    ['one-ULP arc change', level => { level.platforms[32].segments[0].start = shiftPositive(level.platforms[32].segments[0].start, 1n); }],
    ['one-ULP change in an unlisted metric', level => { level.gapAlignment.threshold = shiftPositive(level.gapAlignment.threshold, 1n); }],
    ['seed change', level => { level.seed++; }],
    ['obstacle change', level => { level.platforms[32].type = 'lowWall'; }],
    ['topology change', level => { level.platforms[32].segments.pop(); }],
    ['platform reordering', level => { [level.platforms[1], level.platforms[2]] = [level.platforms[2], level.platforms[1]]; }],
    ['missing platform', level => { level.platforms.splice(32, 1); }],
    ['missing derived field', level => { delete level.platforms[32].silhouetteMetrics.safeWidthBallDiameters; }],
    ['extra derived field', level => { level.platforms[32].silhouetteMetrics.extraWidth = 2; }],
    ['boolean metadata change', level => { level.platforms[32].active = false; }],
  ])('still rejects %s', (_description, mutate) => {
    const level = generateLevel(11); mutate(level);
    expect(compare(level).matches).toBe(false);
  });

  it('does not mutate the generated level or approved fixtures', () => {
    const level = generateLevel(11);
    level.platforms[32].silhouetteMetrics.safeWidthBallDiameters = 2.7973410583119587;
    const before = structuredClone({ level, sample, widths });
    expect(compare(level).matches).toBe(true);
    expect({ level, sample, widths }).toEqual(before);
  });

  it('does not accept missing or silently rebased companion values', () => {
    const level = generateLevel(11);
    expect(() => compareLevelBaseline(level, sample, undefined)).toThrow('Missing approved');
    const changed = { ...widths, 'platform-32': shiftPositive(widths['platform-32'], -1n) };
    expect(compareLevelBaseline(level, sample, changed).matches).toBe(false);
  });
});
