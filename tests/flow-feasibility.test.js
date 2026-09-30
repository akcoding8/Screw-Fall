import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { generateLevel } from '../src/game/LevelGenerator.js';
import { analyzeFlowRoute, createFlowController, flowBallHalfWidth, getFlowFeasibility,
  simulateFlowController, validateFlowFeasibility } from '../src/game/FlowFeasibility.js';
import { validateFlowPath } from '../src/game/LevelValidator.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { normalizeAngle, TAU } from '../src/game/math.js';
import baseline from './fixtures/phase2-baseline.json';

const h = CONFIG.physics.fixedStep;
const regular = level => level.platforms.slice(0, -1);

function replay(level, mode, trial = 0, trace = false) {
  const events = [];
  const sim = new Simulation({ levelNumber: level.levelNumber, levelFactory: () => structuredClone(level), onEvent: event => events.push(event) });
  const controller = createFlowController(level, { mode, trial });
  const frames = [];
  for (let step = 0; step < 2400 && [STATES.ACTIVE, STATES.HOLDING].includes(sim.state); step++) {
    sim.rotate(controller.step(h, sim.ball.y, sim.rotation));
    sim.step(h);
    if (trace) frames.push({ y: sim.ball.y, angle: controller.angle });
  }
  return { sim, events, frames };
}

describe('Flow route demand and conservative reachability', () => {
  it('keeps approved global flight and opening geometry constants', () => {
    expect(CONFIG.physics).toMatchObject({ bounceGravity: 28, freeFallGravity: 24.5,
      bounceVelocity: 9.058875, maxDownwardSpeed: 18.4, fixedStep: 1 / 120, ballRadius: .275 });
    expect(CONFIG.world.platformSpacing).toBe(2.25);
    expect(GENERATION.flowCount).toEqual([45, 50]);
    expect(GENERATION.flow.gapWidth).toEqual(baseline.generation.flow.gapWidth);
    expect(2 * CONFIG.world.ballOrbitRadius * Math.sin(flowBallHalfWidth())).toBeCloseTo(.62, 12);
    expect(flowBallHalfWidth()).toBeGreaterThan(Math.asin(CONFIG.physics.ballRadius / CONFIG.world.ballOrbitRadius));
  });

  it.each([10, 70, 100010, 100110, Number.MAX_SAFE_INTEGER - 1])('certifies bounded continuous winding and a gentler opening for %s', number => {
    const level = generateLevel(number), metrics = analyzeFlowRoute(level), result = validateFlowFeasibility(level);
    expect(result.errors).toEqual([]);
    expect(metrics.rotations).toBeGreaterThanOrEqual(GENERATION.flow.rotations[0] - 1e-10);
    expect(metrics.rotations).toBeLessThanOrEqual(GENERATION.flow.rotations[1] + 1e-10);
    expect(metrics.maxRate).toBeLessThanOrEqual(GENERATION.flow.maxTurnSpeed);
    expect(metrics.maxCurvature).toBeLessThanOrEqual(GENERATION.flow.maxCurvature);
    expect(metrics.maxJerk).toBeLessThanOrEqual(GENERATION.flow.maxJerk);
    expect(level.flow.openingCount).toBeGreaterThanOrEqual(5);
    expect(level.flow.openingCount).toBeLessThanOrEqual(7);
    expect(metrics.openingMaxRate).toBeLessThanOrEqual(GENERATION.flow.openingMaxTurnSpeed);
    expect(Math.abs(metrics.sections[0].rate)).toBeLessThan(metrics.maxRate * .7);
    expect(Math.abs(metrics.sections[0].rate)).toBeGreaterThan(.5);
    expect(metrics.sections.every(section => Math.sign(section.rate) === level.flow.direction)).toBe(true);
    expect(metrics.sections[0].rate).toBeCloseTo(metrics.sections[0].delta * 18.4 / 2.25, 12);
    expect(result.feasibility.ideal.success).toBe(true);
    expect(result.feasibility.skilled.successRate).toBeGreaterThanOrEqual(.8);
    expect(result.feasibility.skilled.worstSectionFailures).toBeLessThanOrEqual(4);
    expect(regular(level).every(platform => platform.type === 'static' && !platform.motion && !platform.walls.length)).toBe(true);
    expect(generateLevel(number)).toEqual(level);
  });

  it('measures all three derivatives independently and catches an abrupt corner', () => {
    const level = generateLevel(10);
    level.platforms[20].route.angle += .12;
    const metrics = analyzeFlowRoute(level);
    expect(metrics.maxCurvature).toBeGreaterThan(GENERATION.flow.maxCurvature);
    expect(metrics.maxJerk).toBeGreaterThan(GENERATION.flow.maxJerk);
    expect(validateFlowFeasibility(level).errors.some(error => /curvature|jerk/.test(error))).toBe(true);
  });

  // Each candidate runs 21 controller simulations, with up to four attempts per
  // level. Give this exhaustive sweep headroom on shared CI runners.
  it('checks all 541 remaining required-range Flow levels, with bounded attempts and no fallback', () => {
    const numbers = [...Array.from({ length: 500 }, (_, index) => (index + 1) * 10),
      ...Array.from({ length: 100 }, (_, index) => 100010 + index * 10), Number.MAX_SAFE_INTEGER - 1].filter(number => number % 100 !== 0);
    expect(numbers).toHaveLength(541);
    let variedTrials = 0, moderateSuccess = 0, moderateTrials = 0;
    for (const number of numbers) {
      const level = generateLevel(number), certificate = level.flow.feasibility;
      expect(level.fallback, `fallback at ${number}`).toBe(false);
      expect(level.generationAttempt).toBeLessThanOrEqual(4);
      expect(certificate.ideal.success).toBe(true);
      expect(certificate.skilled.successRate).toBeGreaterThanOrEqual(.8);
      expect(certificate.skilled.failureCounts.slice(0, level.flow.openingCount).every(count => count <= 1)).toBe(true);
      variedTrials += certificate.skilled.successRate < 1 ? 1 : 0;
      moderateSuccess += certificate.moderate.successes;
      moderateTrials += certificate.moderate.trials;
    }
    expect(variedTrials).toBeGreaterThan(100);
    expect(moderateSuccess).toBeGreaterThan(0);
    expect(moderateSuccess).toBeLessThan(moderateTrials * .5);
  }, 30_000);

  it.each([10, 20, Number.MAX_SAFE_INTEGER - 1])('uses a valid bounded conservative fallback for %s', number => {
    const level = generateLevel(number, { validator: () => ({ valid: false, errors: ['forced test failure'] }) });
    expect(level.fallback).toBe(true);
    expect(level.generationAttempt).toBe(4);
    expect(level.flow.rotations).toBe(GENERATION.flow.rotations[0]);
    expect(validateFlowFeasibility(level).valid).toBe(true);
  });
});

describe('causal human controller and actual Simulation replay', () => {
  it('really waits for perception delay and only consumes sufficiently old observations', () => {
    const level = generateLevel(20), controller = createFlowController(level, { trial: 9 });
    expect(controller.reactionDelay).toBe(.16);
    for (let index = 0; index < 19; index++) {
      expect(controller.step(h, CONFIG.physics.ballRadius, 0)).toBe(0);
      expect(controller.observationTime).toBe(-1);
    }
    controller.step(h, CONFIG.physics.ballRadius, 0);
    expect(controller.observationTime).toBe(-1);
    controller.step(h, CONFIG.physics.ballRadius, 0);
    expect(controller.observationTime).toBe(0);
    for (let index = 0; index < 100; index++) {
      const before = controller.elapsed;
      controller.step(h, -10 - index / 10);
      expect(controller.observationTime).toBeLessThanOrEqual(before - controller.reactionDelay + 1e-10);
    }
  });

  it('does not learn a changed future route before it becomes visible and its delay expires', () => {
    const level = generateLevel(10), changed = structuredClone(level);
    for (let index = 20; index < level.platformCount; index++) changed.platforms[index].route.angle += .2;
    const first = createFlowController(level, { trial: 9 }), second = createFlowController(changed, { trial: 9 });
    for (let index = 0; index < 200; index++) expect(first.step(h, -10)).toBe(second.step(h, -10));
    const exposedY = -20 * CONFIG.world.platformSpacing + CONFIG.physics.ballRadius;
    for (let index = 0; index < 19; index++) expect(first.step(h, exposedY)).toBe(second.step(h, exposedY));
    for (let index = 0; index < 200; index++) { first.step(h, exposedY); second.step(h, exposedY); }
    expect(first.perceivedAngle).not.toBe(second.perceivedAngle);
    expect(first.angle).not.toBe(second.angle);
  });

  it('applies finite input-derived speed and acceleration with deterministic trial uncertainty', () => {
    const level = generateLevel(10), controller = createFlowController(level, { trial: 3 });
    expect(controller.maximumRate).toBeCloseTo(5.2 * 1.2 * .75, 12);
    expect(controller.maximumAcceleration).toBeCloseTo(5.2 * 1.2 * 5, 12);
    let priorRate = 0;
    for (let index = 0; index < 1000; index++) {
      controller.step(h, -.1 * index);
      expect(Math.abs(controller.angularRate)).toBeLessThanOrEqual(controller.maximumRate + 1e-10);
      expect(Math.abs(controller.angularRate - priorRate)).toBeLessThanOrEqual(controller.maximumAcceleration * h + 1e-10);
      priorRate = controller.angularRate;
    }
    expect(simulateFlowController(level, { trial: 3, trace: true })).toEqual(simulateFlowController(level, { trial: 3, trace: true }));
    expect(simulateFlowController(level, { trial: 0 }).contacts).not.toEqual(simulateFlowController(level, { trial: 9 }).contacts);
  });

  it.each([10, 20, 70, 100010])('matches the real fixed-step physics exactly for ideal and accepted skilled replays of %s', number => {
    const level = generateLevel(number);
    for (const mode of ['ideal', 'skilled']) {
      const trial = mode === 'ideal' ? 0 : level.flow.feasibility.skilled.trialResults.find(result => result.success).trial;
      const predicted = simulateFlowController(level, { mode, trial, trace: true });
      const actual = replay(level, mode, trial, true);
      expect(actual.sim.state).toBe(STATES.COMPLETING);
      expect(actual.events.filter(event => ['platformLanded', 'platformSmashed', 'playerDied'].includes(event.type))).toEqual([]);
      expect(actual.frames).toHaveLength(predicted.trajectory.length);
      for (let index = 0; index < actual.frames.length; index++) {
        expect(actual.frames[index].angle).toBeCloseTo(predicted.trajectory[index].angle, 9);
        if (index < actual.frames.length - 1) expect(actual.frames[index].y).toBe(predicted.trajectory[index].y);
      }
      const passed = actual.events.filter(event => event.type === 'platformPassed');
      expect(passed).toHaveLength(level.platformCount);
      for (let index = 0; index < passed.length; index++) expect(passed[index].impactTime).toBeCloseTo(predicted.contacts[index].time, 9);
    }
  });

  it('keeps all certified skilled trajectories physically uninterrupted across a representative batch', () => {
    for (let number = 10; number <= 200; number += 10) {
      if (number % 100 === 0) continue; // Milestones use normal Challenge geometry.
      const level = generateLevel(number);
      for (const trial of level.flow.feasibility.skilled.trialResults.filter(trial => trial.success)) {
        const actual = replay(level, 'skilled', trial.trial);
        expect(actual.sim.state).toBe(STATES.COMPLETING);
        expect(actual.events.some(event => ['platformLanded', 'platformSmashed', 'playerDied'].includes(event.type))).toBe(false);
      }
    }
  });

  it('allows moderate controllers to recover by ordinary safe bounce or smash and finish', () => {
    let recovered = 0;
    for (let number = 10; number <= 200; number += 10) for (const trial of [6, 9]) {
      if (number % 100 === 0) continue;
      const actual = replay(generateLevel(number), 'moderate', trial);
      expect(actual.sim.state).toBe(STATES.COMPLETING);
      expect(actual.events.some(event => event.type === 'playerDied')).toBe(false);
      recovered += actual.events.some(event => ['platformLanded', 'platformSmashed'].includes(event.type)) ? 1 : 0;
    }
    expect(recovered).toBeGreaterThan(0);
  });
});

describe('Flow validation cannot trust forged metadata or stale cached geometry', () => {
  it('caches deterministic immutable certificates, including the opening section in its key', () => {
    const level = generateLevel(10), certificate = getFlowFeasibility(level);
    expect(getFlowFeasibility(structuredClone(level))).toBe(certificate);
    expect(Object.isFrozen(certificate.skilled.trialResults)).toBe(true);
    const changed = structuredClone(level);
    changed.flow.openingCount = level.flow.openingCount === 5 ? 6 : 5;
    expect(getFlowFeasibility(changed)).not.toBe(certificate);
  });

  it('rejects visually shifted openings and an old or forged ideal/human certificate', () => {
    const level = structuredClone(generateLevel(10));
    level.flow.feasibility = { ideal: { success: true }, skilled: { successRate: 1 } };
    for (const platform of regular(level)) platform.baseRotation = normalizeAngle(platform.baseRotation - .15);
    expect(validateFlowPath(level).valid).toBe(false);
    expect(validateFlowPath(level).errors.some(error => /visible opening/.test(error))).toBe(true);
  });

  it.each(['null arc', 'oversized arcs', 'nonfinite arc', 'finish hazard', 'finish wall', 'finish motion'])('rejects %s directly without throwing', condition => {
    const level = structuredClone(generateLevel(10));
    if (condition === 'null arc') level.platforms[2].segments = [null];
    if (condition === 'oversized arcs') level.platforms[2].segments = Array.from({ length: 65 }, () => ({ kind: 'safe', start: 1, end: 2 }));
    if (condition === 'nonfinite arc') level.platforms[2].segments[0].end = Infinity;
    if (condition === 'finish hazard') level.platforms.at(-1).segments[0].kind = 'hazard';
    if (condition === 'finish wall') level.platforms.at(-1).walls.push({ type: 'low' });
    if (condition === 'finish motion') level.platforms.at(-1).motion = { type: 'orbiting', speed: .3 };
    expect(validateFlowPath(level).valid).toBe(false);
  });
});
