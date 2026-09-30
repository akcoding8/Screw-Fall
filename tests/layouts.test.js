import { createPrototypeLevel as createLevel } from '../src/game/PrototypeLevels.js';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { classifyLocalAngle, classifyPlatform } from '../src/game/LevelManager.js';
import { TAU } from '../src/game/math.js';

// Authored chute contracts use zero-based platform indices. These tests sample
// the whole shared opening, not just the easy route through each gap's centre.
const FAMILIES = [
  { number: 1, count: 44, pairs: [4, 10, 18, 29, 33], triples: [0, 6, 12, 22, 37] },
  { number: 2, count: 46, pairs: [4, 10, 18, 29, 34], triples: [0, 6, 12, 24, 40] },
  { number: 3, count: 48, pairs: [4, 10, 18, 29, 34, 45], triples: [0, 6, 12, 24, 40] },
];

describe.each(FAMILIES)('extended prototype $number', ({ number, count, pairs, triples }) => {
  it(`contains ${count} regular platforms and one reachable full finish floor`, () => {
    const { platforms } = createLevel(number);
    expect(platforms.filter((platform) => !platform.finish)).toHaveLength(count);
    expect(platforms).toHaveLength(count + 1);
    expect(platforms.at(-1)).toMatchObject({
      id: 'finish', finish: true, active: true, y: -count * CONFIG.world.platformSpacing,
    });
    for (let degree = 0; degree < 360; degree += 1) {
      expect(classifyLocalAngle(platforms.at(-1), degree * Math.PI / 180)).toBe('finish');
    }
  });

  it('keeps unique ordered planes at the unchanged spacing', () => {
    const { platforms } = createLevel(number);
    expect(CONFIG.world.platformSpacing).toBe(2.25);
    expect(platforms[0].y).toBe(0);
    expect(new Set(platforms.map((platform) => platform.id)).size).toBe(platforms.length);
    for (let index = 1; index < platforms.length; index += 1) {
      expect(platforms[index - 1].y - platforms[index].y).toBe(CONFIG.world.platformSpacing);
    }
  });

  it('has valid static arcs, generous gaps, and moderate hazards throughout', () => {
    const { platforms } = createLevel(number);
    for (const platform of platforms.slice(0, -1)) {
      expect(Number.isFinite(platform.baseRotation)).toBe(true);
      expect(platform.active).toBe(true);
      let safeWidth = 0;
      let hazardWidth = 0;
      let previousEnd = 0;
      for (const segment of platform.segments) {
        expect(segment.start).toBeGreaterThanOrEqual(previousEnd);
        expect(segment.end).toBeGreaterThan(segment.start);
        expect(segment.end).toBeLessThanOrEqual(TAU);
        const width = segment.end - segment.start;
        if (segment.kind === 'safe') safeWidth += width;
        else {
          expect(segment.kind).toBe('hazard');
          hazardWidth += width;
        }
        expect(classifyLocalAngle(platform, (segment.start + segment.end) / 2)).toBe(segment.kind);
        previousEnd = segment.end;
      }
      expect(safeWidth).toBeGreaterThan(Math.PI);
      expect(hazardWidth).toBeGreaterThan(0);
      expect(hazardWidth).toBeLessThanOrEqual(50 * Math.PI / 180);
      const gapWidth = TAU - safeWidth - hazardWidth;
      expect(gapWidth).toBeGreaterThanOrEqual(87.99 * Math.PI / 180);
      expect(gapWidth).toBeLessThanOrEqual(112.01 * Math.PI / 180);
      expect(classifyLocalAngle(platform, 0)).toBe('gap');
      const kinds = new Set();
      for (let degree = 0; degree < 360; degree += 1) {
        kinds.add(classifyPlatform(platform, degree * Math.PI / 180));
      }
      expect(kinds).toEqual(new Set(['safe', 'hazard', 'gap']));
    }
  });

  it('provides safe catches across every authored two-gap chute', () => {
    const { platforms } = createLevel(number);
    for (const start of pairs) {
      let sharedGapSamples = 0;
      for (let degree = 0; degree < 360; degree += 0.25) {
        const rotation = degree * Math.PI / 180;
        if (classifyPlatform(platforms[start], rotation) !== 'gap'
          || classifyPlatform(platforms[start + 1], rotation) !== 'gap') continue;
        sharedGapSamples += 1;
        expect(classifyPlatform(platforms[start + 2], rotation),
          `pair ${start}, catch ${start + 2}, rotation ${degree}°`).toBe('safe');
      }
      expect(sharedGapSamples).toBeGreaterThan(200);
    }
  });

  it('provides three-gap smash opportunities with a solid exit across each opening', () => {
    const { platforms } = createLevel(number);
    expect(CONFIG.smash.threshold).toBe(3);
    for (const start of triples) {
      let sharedGapSamples = 0;
      for (let degree = 0; degree < 360; degree += 0.25) {
        const rotation = degree * Math.PI / 180;
        if (platforms.slice(start, start + 3).some((platform) => classifyPlatform(platform, rotation) !== 'gap')) continue;
        sharedGapSamples += 1;
        expect(['safe', 'hazard'], `triple ${start}, exit ${start + 3}, rotation ${degree}°`)
          .toContain(classifyPlatform(platforms[start + 3], rotation));
      }
      expect(sharedGapSamples).toBeGreaterThan(200);
    }
  });

  it('reconstructs fresh deterministic data when the prototype is retried or cycled', () => {
    const baseline = createLevel(number);
    const changed = createLevel(number);
    changed.platforms[0].active = false;
    changed.platforms.at(-2).segments[0].start += 0.25;
    changed.palette.safe = '#000000';
    expect(createLevel(number)).toEqual(baseline);
    expect(createLevel(number + 3)).toEqual(baseline);
    expect(createLevel(number + 3000)).toEqual(baseline);
    expect(createLevel(number).platforms.at(-2)).not.toBe(baseline.platforms.at(-2));
  });
});
