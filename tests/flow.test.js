import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { generateLevel, NORMAL_GENERATOR_VERSION, FLOW_GENERATOR_VERSION } from '../src/game/LevelGenerator.js';
import baseline from './fixtures/phase2-baseline.json';
import { classifyLocalAngle } from '../src/game/LevelManager.js';
import { validateFlowPath, validateLevel } from '../src/game/LevelValidator.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { clamp, TAU } from '../src/game/math.js';

describe('deliberately constructed Flow towers', () => {
  it.each([10, 20, 30, 40, 50, 100010, 100050])('builds safe, winding, deterministic Flow level %s', number => {
    const level = generateLevel(number);
    expect(level.kind).toBe('flow');
    expect(level.difficultyRating).toBe(1);
    expect(level.platformCount).toBeGreaterThanOrEqual(45);
    expect(level.platformCount).toBeLessThanOrEqual(50);
    expect(generateLevel(number)).toEqual(level);
    for (const platform of level.platforms.slice(0, -1)) {
      expect(platform.type).toBe('static');
      expect(platform.walls).toEqual([]);
      expect(platform.motion).toBeUndefined();
      expect(platform.segments.every(segment => segment.kind === 'safe')).toBe(true);
      expect(classifyLocalAngle(platform, 0)).toBe('gap');
      expect(classifyLocalAngle(platform, Math.PI)).toBe('safe');
    }
    expect(validateFlowPath(level).errors).toEqual([]);
    const turns = Math.abs(level.route.at(-1).angle - level.route[0].angle) / TAU;
    expect(turns).toBeGreaterThanOrEqual(GENERATION.flow.rotations[0]);
    expect(turns).toBeLessThanOrEqual(GENERATION.flow.rotations[1]);
  });

  it('crosses the zero seam without reversing or discontinuously changing its intended path', () => {
    const level = generateLevel(20);
    let seamCount = 0;
    for (let index = 1; index < level.platformCount; index += 1) {
      const current = level.platforms[index];
      const previous = level.platforms[index - 1];
      if (Math.abs(current.baseRotation - previous.baseRotation) > Math.PI) seamCount += 1;
      expect(Math.abs(current.route.angle - previous.route.angle)).toBeLessThan(GENERATION.flow.maxStep);
    }
    expect(seamCount).toBeGreaterThan(0);
  });

  it.each([10, 20, 30, 40, 50, 100010])('an ideal bounded controller passes every platform without landing in level %s', number => {
    const events = [];
    const sim = new Simulation({ levelNumber: number, onEvent: event => events.push(event) });
    const platformCount = sim.level.platformCount;
    const palette = sim.level.palette.id;
    sim.rotate(0.0001);
    for (let step = 0; step < 4000 && sim.state === STATES.ACTIVE; step += 1) {
      const route = sim.level.route;
      const progress = clamp(-(sim.ball.y - CONFIG.physics.ballRadius) / CONFIG.world.platformSpacing, 0, route.length - 1);
      const low = Math.floor(progress);
      const high = Math.min(low + 1, route.length - 1);
      const target = route[low].angle + (route[high].angle - route[low].angle) * (progress - low) - CONFIG.world.ballWorldAngle;
      const error = ((target - sim.rotation + Math.PI) % TAU + TAU) % TAU - Math.PI;
      sim.rotate(clamp(error, -GENERATION.flow.maxTurnSpeed / 120, GENERATION.flow.maxTurnSpeed / 120));
      sim.step(CONFIG.physics.fixedStep);
    }
    expect(sim.state).toBe(STATES.COMPLETING);
    expect(events.filter(event => event.type === 'platformLanded')).toHaveLength(0);
    expect(events.filter(event => event.type === 'playerDied')).toHaveLength(0);
    expect(events.filter(event => event.type === 'platformPassed')).toHaveLength(platformCount);
    expect(events.filter(event => event.type === 'flowLevelCompleted')).toHaveLength(1);
    expect(events.filter(event => event.type === 'gameLevelCompleted')).toHaveLength(1);
    for (let index = 0; index < 120; index += 1) sim.step(CONFIG.physics.fixedStep);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(sim.levelNumber).toBe(number + 1);
    expect(sim.level.kind).toBe('normal');
    expect(sim.level.palette.id).not.toBe(palette);
  });

  it('a stationary tower cannot complete Flow and a missed gap is a recoverable safe bounce', () => {
    const events = [];
    const sim = new Simulation({ levelNumber: 10, onEvent: event => events.push(event) });
    sim.rotate(-CONFIG.world.ballWorldAngle);
    for (let index = 0; index < 2400; index += 1) sim.step(CONFIG.physics.fixedStep);
    expect(sim.state).toBe(STATES.ACTIVE);
    expect(sim.levelNumber).toBe(10);
    expect(events.some(event => event.type === 'platformLanded' || event.type === 'platformSmashed')).toBe(true);
    expect(events.some(event => event.type === 'playerDied')).toBe(false);
    const platform = generateLevel(10).platforms[0];
    expect(classifyLocalAngle(platform, platform.gapWidth / 2 + 0.01)).toBe('safe');
  });

  it('rejects a discontinuous route, excessive speed, and hazards or walls in Flow', () => {
    const level = generateLevel(10);
    level.platforms[12].route.angle += 2;
    expect(validateFlowPath(level).valid).toBe(false);
    const unsafe = generateLevel(10);
    unsafe.platforms[5].segments[0].kind = 'hazard';
    expect(validateLevel(unsafe).valid).toBe(false);
    const wall = generateLevel(10);
    wall.platforms[5].walls.push({ type: 'low', height: 0.9, angle: 2, width: 0.12, innerRadius: 0.77, outerRadius: 2.81 });
    expect(validateLevel(wall).valid).toBe(false);
  });

  it('rejects missing or non-finite Flow route points without throwing', () => {
    const missing = generateLevel(10);
    delete missing.platforms[4].route;
    expect(validateFlowPath(missing).valid).toBe(false);
    expect(validateLevel(missing).valid).toBe(false);
    const invalid = generateLevel(10);
    invalid.platforms[4].route.angle = Infinity;
    expect(validateFlowPath(invalid).valid).toBe(false);
    expect(validateLevel(invalid).valid).toBe(false);
  });
});


describe('Phase 2.3 explicitly versions the changed Flow route', () => {
  it('separates normal version 4 from Flow version 2', () => {
    expect(NORMAL_GENERATOR_VERSION).toBe(4);
    expect(FLOW_GENERATOR_VERSION).toBe(2);
  });
  it.each(baseline.samples.filter(sample => sample.level.kind === 'flow' && sample.level.levelNumber % 100 !== 0))('retains locked width/count bounds while replacing the v1 route for $level.levelNumber', ({ level }) => {
    const current = generateLevel(level.levelNumber);
    expect(current.route).not.toEqual(level.route);
    expect(GENERATION.flow.gapWidth).toEqual(baseline.generation.flow.gapWidth);
    expect(GENERATION.flowCount).toEqual(baseline.generation.flowCount);
    expect(current.generatorVersion).toBe(2);
    expect(current.flow.feasibility.skilled.successRate).toBeGreaterThanOrEqual(GENERATION.flow.human.minimumSuccessRate);
  });
});
