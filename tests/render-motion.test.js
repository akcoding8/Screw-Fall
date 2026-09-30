import { describe, expect, it } from 'vitest';
import { evaluatePlatformMotion, evaluatePlatformRenderMotion, classifyPlatformAtTime } from '../src/game/PlatformMotion.js';
import { createPlatform, updatePlatformView, disposePlatform } from '../src/game/Platform.js';
import { CONFIG } from '../src/game/config.js';
import { TAU } from '../src/game/math.js';

function fixture(type) {
  return {
    id: type, y: 0, active: true, baseRotation: .2, type,
    motion: type === 'breathing'
      ? { type, minWidth: 1.2, maxWidth: 1.9, period: 2.7, phase: .4 }
      : { type, speed: -.45, phase: .7 },
    segments: [{ kind: 'safe', start: .6, end: 2.8 }, { kind: 'hazard', start: 2.8, end: 3.4 },
      { kind: 'safe', start: 3.4, end: TAU - .6 }],
  };
}

describe('dynamic display phase has separate reusable state', () => {
  it.each(['breathing', 'orbiting', 'stinger'])('samples %s at fractional display time without changing authoritative data', type => {
    const platform = fixture(type);
    const current = evaluatePlatformMotion(platform, 1.5);
    const before = structuredClone(platform);
    const previous = evaluatePlatformRenderMotion(platform, 1.5 - CONFIG.physics.fixedStep);
    const previousWidth = previous.gapWidth, previousRotation = previous.rotation;
    const display = evaluatePlatformRenderMotion(platform, 1.5 - CONFIG.physics.fixedStep / 2);
    expect(platform).toEqual(before);
    expect(display).not.toBe(current);
    expect(display.segments).not.toBe(current.segments);
    expect(display.time).toBe(1.5 - CONFIG.physics.fixedStep / 2);
    if (type === 'breathing') {
      expect(display.gapWidth).toBeGreaterThanOrEqual(Math.min(previousWidth, current.gapWidth));
      expect(display.gapWidth).toBeLessThanOrEqual(Math.max(previousWidth, current.gapWidth));
    } else expect(display.rotation).toBeCloseTo((previousRotation + current.rotation) / 2, 14);
    const sameTimeCollision = evaluatePlatformMotion(structuredClone(before), display.time);
    expect(display).toEqual(sameTimeCollision);
  });

  it.each(['breathing', 'orbiting', 'stinger'])('reuses %s arcs and geometry through 600 display frames', type => {
    const platform = fixture(type);
    evaluatePlatformMotion(platform, 5);
    const view = createPlatform(platform);
    const display = evaluatePlatformRenderMotion(platform, 0);
    const arcs = display.segments, firstArc = arcs[0];
    const geometries = [...view.userData.platformResources.geometries];
    const buffers = geometries.map(geometry => geometry.attributes.position.array);
    try {
      for (let frame = 0; frame < 600; frame++) {
        const state = evaluatePlatformRenderMotion(platform, frame / 120);
        expect(state).toBe(display);
        expect(state.segments).toBe(arcs);
        expect(state.segments[0]).toBe(firstArc);
        updatePlatformView(view, platform, state);
        expect(view.rotation.y).toBe(-state.rotation);
      }
      expect(platform.motionState.time).toBe(5);
      expect(view.userData.platformResources.geometries).toEqual(geometries);
      geometries.forEach((geometry, index) => expect(geometry.attributes.position.array).toBe(buffers[index]));
    } finally { disposePlatform(view); }
  });

  it('uses exactly the collision phase on destruction, despite an older displayed phase', () => {
    const platform = fixture('breathing');
    evaluatePlatformMotion(platform, 1.3);
    const frozen = structuredClone(platform.motionState);
    const displayed = evaluatePlatformRenderMotion(platform, 1.29);
    expect(displayed.gapWidth).not.toBe(frozen.gapWidth);
    platform.active = false;
    expect(evaluatePlatformRenderMotion(platform, 20)).toBe(platform.motionState);
    expect(platform.motionState).toEqual(frozen);
    expect(classifyPlatformAtTime(platform, 0, 20)).toBe('gap');
  });

  it('resets a rebuilt view to the deterministic zero phase without retaining old render time', () => {
    const old = fixture('orbiting'), replacement = fixture('orbiting');
    evaluatePlatformRenderMotion(old, 50);
    const state = evaluatePlatformMotion(replacement, 0);
    expect(evaluatePlatformRenderMotion(replacement, 0)).toEqual(state);
    expect(evaluatePlatformRenderMotion(replacement, NaN)).toEqual(state);
    expect(evaluatePlatformRenderMotion(replacement, -1)).toEqual(state);
  });

  it('does not add any runtime state or work to static platforms', () => {
    const platform = { active: true, baseRotation: 1, segments: [] };
    const before = structuredClone(platform);
    expect(evaluatePlatformRenderMotion(platform, 200)).toBe(platform);
    expect(platform).toEqual(before);
  });
});
