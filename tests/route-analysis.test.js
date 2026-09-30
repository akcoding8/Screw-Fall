import { describe, expect, it } from 'vitest';
import { generateLevel } from '../src/game/LevelGenerator.js';
import { validateLevel } from '../src/game/LevelValidator.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { analyzeRoute, analyzeGapAlignment, intersectIntervals, platformGapIntervals,
  splitCircularInterval, widestCircularInterval, passableGapWidth, validateNormalRoute } from '../src/game/RouteAnalysis.js';
import { makePlatform } from '../src/game/LevelGeometry.js';
import { TAU } from '../src/game/math.js';
import baseline from './fixtures/phase2-baseline.json';

const radians = degrees => degrees * Math.PI / 180;
const route = angles => ({ route: angles.map(angle => ({ angle })) });

describe('meaningful signed normal-route movement', () => {
  it('treats seam crossings as short turns and does not count deadband jitter as reversals', () => {
    const result = analyzeRoute(route([radians(350), radians(10), radians(14), radians(9), radians(350)]));
    expect(result.transitions.map(item => item.direction)).toEqual([1, 0, 0, -1]);
    expect(result.reversals).toBe(1);
    expect(result.clockwiseMovement).toBeCloseTo(radians(20));
    expect(result.anticlockwiseMovement).toBeCloseTo(radians(19));
  });
  it('measures movement magnitude rather than accepting token opposite turns', () => {
    const result = analyzeRoute(route([0, 1, 2, 1.88, 2.88, 3.88]));
    expect(result.directionBalance).toBeCloseTo(.03);
    expect(result.netRotationRatio).toBeGreaterThan(.9);
  });
  it.each([69, 71])('rejects the captured one-direction Phase 2 level %s', number => {
    const level = baseline.samples.find(sample => sample.level.levelNumber === number).level;
    expect(analyzeRoute(level).longestSameDirectionRun).toBeGreaterThan(30);
    expect(validateNormalRoute(level).errors).toContain('Normal route exceeds three same-direction transitions');
  });
  it.each([1, 6, 17, 64, 69, 71, 100001, 100006, Number.MAX_SAFE_INTEGER])('bounds direction and recovery rhythms at level %s', number => {
    const level = generateLevel(number);
    const result = validateNormalRoute(level);
    expect(result.errors).toEqual([]);
    expect(result.metrics.longestSameDirectionRun).toBeLessThanOrEqual(3);
    expect(result.metrics.reversalRate).toBeGreaterThanOrEqual(.35);
    expect(result.metrics.directionBalance).toBeGreaterThanOrEqual(.6);
    expect(result.metrics.netRotationRatio).toBeLessThanOrEqual(.25);
  });
});

describe('real circular no-input corridors', () => {
  it('intersects occupied complements correctly across the zero seam', () => {
    const a = makePlatform(0, 0, radians(80));
    const b = makePlatform(1, radians(10), radians(80));
    const common = intersectIntervals(platformGapIntervals(a), platformGapIntervals(b));
    expect(widestCircularInterval(common)).toBeCloseTo(radians(70));
    const split = splitCircularInterval(radians(350), radians(380));
    expect(split).toHaveLength(2);
    expect(split[0].start).toBeCloseTo(radians(350));
    expect(split[0].end).toBe(TAU);
    expect(split[1].start).toBe(0);
    expect(split[1].end).toBeCloseTo(radians(20));
  });
  it('ignores sub-footprint slivers rather than labelling any numerical overlap passable', () => {
    const width = passableGapWidth();
    const platforms = [0, .001, width - .002].map((angle, index) => makePlatform(index, angle, width));
    expect(analyzeGapAlignment({ platforms }).windows).toEqual([]);
  });
  it('rejects an unmarked four-platform alignment and recognises explicit membership', () => {
    const platforms = Array.from({ length: 5 }, (_, index) => makePlatform(index, .4, radians(80)));
    expect(analyzeGapAlignment({ platforms }).hardViolationCount).toBe(3);
    const marked = analyzeGapAlignment({ platforms, plannedDrops: [{ id: 'intentional', start: 0, passes: 5 }] });
    expect(marked.accidental).toEqual([]);
    expect(marked.windows.every(window => window.plannedDropId === 'intentional')).toBe(true);
  });
  it('does not claim moving openings are guaranteed static drops', () => {
    const platforms = Array.from({ length: 4 }, (_, index) => makePlatform(index, 0, radians(80)));
    platforms[1].motion = { type: 'orbiting', speed: .3 };
    expect(analyzeGapAlignment({ platforms }).windows).toEqual([]);
  });
  it('bounds planned drops and reverses into a solid catch with recovery', () => {
    for (let number = 1; number <= 150; number += 1) {
      if (number % 10 === 0) continue;
      const level = generateLevel(number);
      for (const drop of level.plannedDrops) {
        expect(drop.passes).toBeGreaterThanOrEqual(3);
        expect(drop.passes).toBeLessThanOrEqual(5);
        expect(level.platforms[drop.recoveryIndex].route.role).toBe('recovery');
      }
      expect(analyzeGapAlignment(level).hardViolationCount).toBe(0);
      expect(analyzeGapAlignment(level).accidentalThreeCount).toBeLessThanOrEqual(1);
      expect(level.plannedDrops.reduce((sum, drop) => sum + drop.passes, 0)).toBeLessThanOrEqual(level.platformCount * GENERATION.route.maxPlannedDropRatio);
    }
  });
});


describe('planned-drop schema cannot authorise accidental geometry', () => {
  it.each([null, undefined, 'drop', { id: 'bad', start: 4, passes: Infinity }])('rejects malformed planned drop %s without throwing', drop => {
    const level = generateLevel(1);
    level.plannedDrops = [drop];
    expect(validateLevel(level).valid).toBe(false);
  });
  it('rejects changed planned-drop scope even when a valid smash sequence remains', () => {
    const level = generateLevel(1);
    level.plannedDrops[0].start += 1;
    expect(validateLevel(level).errors).toContain('Invalid or inconsistent planned-drop metadata');
  });
  it('does not trust a lowered platform budget cost', () => {
    const level = generateLevel(17);
    const platform = level.platforms.find(platform => platform.difficultyCost > 0);
    platform.difficultyCost = 0;
    expect(validateLevel(level).errors).toContain(`${platform.id}: invalid complexity cost`);
  });
});
