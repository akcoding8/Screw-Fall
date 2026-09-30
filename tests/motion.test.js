import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { evaluatePlatformMotion, classifyPlatformAtTime } from '../src/game/PlatformMotion.js';
import { TAU } from '../src/game/math.js';

function platform(motion, segments = [
  { kind: 'safe', start: .6, end: 2.8 },
  { kind: 'hazard', start: 2.8, end: 3.4 },
  { kind: 'safe', start: 3.4, end: TAU - .6 },
]) {
  return { id: 'moving', index: 0, type: motion.type, y: 0, active: true, baseRotation: .2, motion, segments };
}
function fixture(moving, extra = {}) {
  return { kind: 'normal', difficultyRating: 5, platforms: [moving, {
    id: 'finish', y: -100, active: true, finish: true, baseRotation: 0, segments: [],
  }], ...extra };
}
const breathing = { type: 'breathing', minWidth: 1.2, maxWidth: 1.9, period: 2.7, phase: .4 };

describe('shared deterministic platform motion', () => {
  it('keeps breathing widths in bounds and changes them continuously through cycle reversals', () => {
    const p = platform(breathing);
    let previous = evaluatePlatformMotion(p, 0).gapWidth;
    const state = p.motionState;
    const arcs = state.segments;
    for (let tick = 1; tick < 1200; tick++) {
      evaluatePlatformMotion(p, tick / 120);
      expect(state.gapWidth).toBeGreaterThanOrEqual(1.2);
      expect(state.gapWidth).toBeLessThanOrEqual(1.9);
      expect(Math.abs(state.gapWidth - previous)).toBeLessThan(.008);
      expect(state.segments).toBe(arcs);
      expect(state.segments[0].start).toBe(state.gapWidth / 2);
      expect(state.segments[2].end).toBe(TAU - state.gapWidth / 2);
      previous = state.gapWidth;
    }
  });

  it('classifies breathing contacts using the same arc endpoints exposed to rendering', () => {
    const p = platform(breathing);
    for (const time of [0, .3, 1.1, 2.6]) {
      const state = evaluatePlatformMotion(p, time);
      const edge = state.segments[0].start;
      const rotation = edge - CONFIG.world.ballWorldAngle + state.rotation;
      expect(classifyPlatformAtTime(p, rotation - .00001, time)).toBe('gap');
      expect(classifyPlatformAtTime(p, rotation + .00001, time)).toBe('safe');
    }
  });

  it.each([.2, -.55])('uses a deterministic constant signed orbit speed of %s radians/sec', speed => {
    const p = platform({ type: 'orbiting', speed, phase: 1.1 });
    const a = evaluatePlatformMotion(p, 2).rotation;
    const b = evaluatePlatformMotion(p, 2.5).rotation;
    expect(b - a).toBeCloseTo(speed * .5);
    expect(evaluatePlatformMotion(structuredClone({ ...p, motionState: undefined }), 2.5).rotation).toBe(b);
  });

  it('keeps stinger flanks adjacent to the safe sliver, with a genuine open remainder', () => {
    const p = platform({ type: 'stinger', speed: -.35, phase: .7 }, [
      { kind: 'hazard', start: .4, end: .75 },
      { kind: 'safe', start: .75, end: 1.3 },
      { kind: 'hazard', start: 1.3, end: 1.65 },
    ]);
    for (const time of [0, 1, 5, 10]) {
      const state = evaluatePlatformMotion(p, time);
      const kinds = [.6, 1, 1.5, 3].map(angle => classifyPlatformAtTime(p,
        angle - CONFIG.world.ballWorldAngle + state.rotation, time));
      expect(kinds).toEqual(['hazard', 'safe', 'hazard', 'gap']);
      expect(state.segments[0].end).toBe(state.segments[1].start);
      expect(state.segments[1].end).toBe(state.segments[2].start);
    }
  });

  it('samples collision at the actual crossing time even if both step endpoints are gaps', () => {
    const p = platform({ type: 'orbiting', speed: .5, phase: 0 }, [
      { kind: 'safe', start: 1.5684, end: 1.569 },
    ]);
    p.baseRotation = 0;
    const events = [];
    const sim = new Simulation({ levelFactory: () => fixture(p), onEvent: event => events.push(event) });
    sim.ball.y = CONFIG.physics.ballRadius + .05;
    sim.ball.velocity = -12;
    expect(classifyPlatformAtTime(p, 0, 0)).toBe('gap');
    expect(classifyPlatformAtTime(p, 0, CONFIG.physics.fixedStep)).toBe('gap');
    sim.step(CONFIG.physics.fixedStep);
    const landing = events.find(event => event.type === 'platformLanded');
    expect(landing).toBeDefined();
    expect(landing.impactTime).toBeGreaterThan(0);
    expect(landing.impactTime).toBeLessThan(CONFIG.physics.fixedStep);
    expect(sim.ball.velocity).toBe(CONFIG.physics.bounceVelocity);
    expect(p.motionState.time).toBe(sim.animationTime);
  });

  it('freezes destroyed geometry at impact, stops classification, and never updates its motion again', () => {
    const p = platform({ type: 'orbiting', speed: .3, phase: 0 }, []);
    const sim = new Simulation({ levelFactory: () => fixture(p) });
    sim.ball.y = CONFIG.physics.ballRadius + .05;
    sim.ball.velocity = -12;
    sim.step(CONFIG.physics.fixedStep);
    expect(p.active).toBe(false);
    const frozen = structuredClone(p.motionState);
    expect(classifyPlatformAtTime(p, 0, 100)).toBe('gap');
    sim.step(1);
    expect(evaluatePlatformMotion(p, 100)).toEqual(frozen);
  });

  it('resets animation time and phase exactly on retry', () => {
    const sim = new Simulation({ levelFactory: () => fixture(platform(breathing)) });
    const initial = structuredClone(sim.platforms[0].motionState);
    sim.step(.8);
    expect(sim.animationTime).toBe(.8);
    sim.state = STATES.DEAD_WAITING;
    sim.retry();
    expect(sim.animationTime).toBe(0);
    expect(sim.platforms[0].motionState).toEqual(initial);
  });

  it('advances only simulation time and resumes a debug freeze without a clock jump', () => {
    const sim = new Simulation({ levelFactory: () => fixture(platform(breathing)) });
    sim.step(.1);
    sim.animationPaused = true;
    for (let i = 0; i < 100; i++) sim.step(CONFIG.physics.fixedStep);
    expect(sim.animationTime).toBe(.1);
    sim.animationPaused = false;
    sim.step(CONFIG.physics.fixedStep);
    expect(sim.animationTime).toBeCloseTo(.1 + CONFIG.physics.fixedStep);
    sim.state = STATES.DEAD_WAITING;
    sim.step(500);
    expect(sim.animationTime).toBeCloseTo(.1 + CONFIG.physics.fixedStep);
  });

  it('releases references to the previous level on load and does no motion work on static platforms', () => {
    const sim = new Simulation({ levelFactory: () => fixture(platform(breathing)) });
    const previous = sim.motionPlatforms[0];
    sim.loadLevel(2);
    expect(sim.motionPlatforms).not.toContain(previous);
    const staticPlatform = { ...platform(breathing), motion: undefined };
    expect(evaluatePlatformMotion(staticPlatform, 100)).toBe(staticPlatform);
    expect(staticPlatform.motionState).toBeUndefined();
  });
});
