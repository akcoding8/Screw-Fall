import { createPrototypeLevel as createLevel } from '../src/game/PrototypeLevels.js';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { classifyLocalAngle, classifyPlatform } from '../src/game/LevelManager.js';
import { arcContains, dragRotation, normalizeAngle, TAU } from '../src/game/math.js';
import { normalizeSensitivity } from '../src/game/sensitivity.js';

describe('polar angle mathematics', () => {
  it('normalizes negative angles and multiple revolutions', () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5);
    expect(normalizeAngle(TAU * 4 + 0.3)).toBeCloseTo(0.3);
    expect(normalizeAngle(-TAU * 3 - 0.3)).toBeCloseTo(TAU - 0.3);
    expect(normalizeAngle(TAU)).toBe(0);
  });

  it('uses half-open normal arcs', () => {
    expect(arcContains(1, 1, 2)).toBe(true);
    expect(arcContains(1.5, 1, 2)).toBe(true);
    expect(arcContains(2, 1, 2)).toBe(false);
    expect(arcContains(0.5, 1, 2)).toBe(false);
  });

  it('handles arcs crossing zero and wrapped query angles', () => {
    expect(arcContains(0, 5.5, 0.5)).toBe(true);
    expect(arcContains(-0.2, 5.5, 0.5)).toBe(true);
    expect(arcContains(TAU + 0.2, 5.5, 0.5)).toBe(true);
    expect(arcContains(3, 5.5, 0.5)).toBe(false);
    expect(arcContains(0.5, 5.5, 0.5)).toBe(false);
  });

  it('distinguishes explicit full rings from empty arcs', () => {
    expect(arcContains(0, 0, TAU)).toBe(true);
    expect(arcContains(3, 0, TAU)).toBe(true);
    expect(arcContains(1, 1, 1)).toBe(false);
  });

  it('assigns shared safe/hazard seams to exactly one arc without a false gap', () => {
    for (let number = 1; number <= 3; number++) {
      for (const platform of createLevel(number).platforms.filter(platform => !platform.finish)) {
        for (const segment of platform.segments.slice(1)) {
          const matches = platform.segments.filter(arc => arcContains(segment.start, arc.start, arc.end));
          expect(matches).toHaveLength(1);
          expect(matches[0]).toBe(segment);
        }
      }
    }
    // Previously both neighbouring arcs rejected this transformed contact.
    expect(classifyPlatform(createLevel(1).platforms[9], 118 * Math.PI / 180)).not.toBe('gap');
  });
});

describe('platform classification', () => {
  const platform = {
    baseRotation: 0.4,
    segments: [
      { kind: 'safe', start: 0.5, end: 2 },
      { kind: 'hazard', start: 5.5, end: 0.2 },
    ],
  };

  it('classifies safe, hazard, and truly empty gap angles', () => {
    expect(classifyLocalAngle(platform, 1)).toBe('safe');
    expect(classifyLocalAngle(platform, 0)).toBe('hazard');
    expect(classifyLocalAngle(platform, 4)).toBe('gap');
  });

  it('inverts both tower and platform rotations', () => {
    // local = world + tower - base = .7 + .7 - .4 = 1.
    expect(classifyPlatform(platform, 0.7, 0.7)).toBe('safe');
    expect(classifyPlatform(platform, TAU + 0.7, 0.7)).toBe('safe');
    expect(classifyPlatform(platform, -0.3, 0.7)).toBe('hazard');
  });

  it('starts every prototype on a safe top, with three overlapping gaps', () => {
    for (let number = 1; number <= 3; number += 1) {
      const { platforms } = createLevel(number);
      expect(classifyPlatform(platforms[0], 0)).toBe('safe');
      const rotation = platforms[0].baseRotation - CONFIG.world.ballWorldAngle;
      for (const platform of platforms.slice(0, 3)) expect(classifyPlatform(platform, rotation)).toBe('gap');
      expect(classifyPlatform(platforms[3], rotation)).toBe('hazard');
      expect(platforms.length - 1).toBeGreaterThanOrEqual(40);
      expect(platforms.length - 1).toBeLessThanOrEqual(50);
      expect(platforms.at(-1).finish).toBe(true);
    }
  });

  it('cycles the three families and gives retries fresh mutable data', () => {
    const original = createLevel(1);
    const cycled = createLevel(4);
    expect(cycled).toEqual(original);
    original.platforms[0].active = false;
    original.platforms[0].segments[0].kind = 'hazard';
    expect(createLevel(1)).toEqual(cycled);
  });
});

describe('drag direction', () => {
  it.each([0.5, 1, 1.2, 2, 3])('preserves the original baseline times %s with both drag directions', (multiplier) => {
    for (const deltaX of [-100, 0, 100]) {
      const baseline = (deltaX / 400) * 5.2;
      expect(dragRotation(deltaX, 400, CONFIG.input, multiplier)).toBe(baseline * multiplier);
    }
  });

  it('maps left to negative Three rotation and right to positive rotation', () => {
    expect(CONFIG.input.directionSign).toBe(1);
    expect(dragRotation(-100, 400)).toBeLessThan(0);
    expect(dragRotation(100, 400)).toBeGreaterThan(0);
    expect(dragRotation(0, 400)).toBe(0);
    // At the right edge (a = 0), negative rotation moves a piece toward +Z,
    // where the ball and camera sit. That is the required clockwise top view.
    const rotation = dragRotation(-20, 400);
    expect(-Math.sin(rotation)).toBeGreaterThan(0);
  });

  it('uses viewport fractions and a configurable direction sign', () => {
    expect(dragRotation(40, 400)).toBe(dragRotation(80, 800));
    expect(dragRotation(40, 400, { sensitivity: 2, directionSign: -1 })).toBe(-0.2);
    expect(dragRotation(40, 0)).toBe(0);
  });
});

describe('sensitivity validation', () => {
  it.each([
    [-5, 0.5], [0.49, 0.5], [0.5, 0.5], [1, 1], [1.24, 1.2],
    [1.26, 1.3], [2, 2], [3, 3], [9, 3],
    [NaN, 1.2], [Infinity, 1.2], [-Infinity, 1.2], ['2', 1.2],
    [null, 1.2], [undefined, 1.2], [{}, 1.2],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSensitivity(input)).toBe(expected);
  });
});
