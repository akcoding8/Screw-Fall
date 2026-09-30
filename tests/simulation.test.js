import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { Simulation as RuntimeSimulation, STATES } from '../src/game/Simulation.js';
import { createPrototypeLevel as createLevel } from '../src/game/PrototypeLevels.js';
// Keep the complete Phase 1.6 authored fixtures as regressions while runtime uses generated towers.
class Simulation extends RuntimeSimulation {
  constructor(options = {}) { super({ levelFactory: createLevel, ...options }); }
}
import { classifyPlatform } from '../src/game/LevelManager.js';
import { normalizeAngle, TAU } from '../src/game/math.js';

/** Small collision fixtures make event order and fast swept contacts explicit. */
function setup(kinds, levelNumber = 7) {
  const events = [];
  const sim = new Simulation({ levelNumber, onEvent: (event) => events.push(event) });
  sim.platforms = kinds.map((kind, index) => ({
    id: `test-${index}`, y: -index * CONFIG.world.platformSpacing,
    active: true, baseRotation: 0, finish: kind === 'finish',
    segments: kind === 'gap' ? [] : [{ kind, start: 0, end: TAU }],
  }));
  // All fixtures retain a distant finish so progress has a defined tower depth.
  if (!sim.platforms.at(-1).finish) sim.platforms.push({
    id: 'finish', y: -100, active: true, baseRotation: 0, finish: true, segments: [],
  });
  sim.level.platforms = sim.platforms;
  sim.ball.y = CONFIG.physics.ballRadius + 0.1;
  sim.ball.previousY = sim.ball.y;
  sim.ball.velocity = -CONFIG.physics.maxDownwardSpeed;
  sim.rotate(0.01);
  events.length = 0;
  return { sim, events };
}

// Explicitly oversized test steps exercise tunnelling and old-sweep invalidation
// independently of the tuned fall speed. Gameplay still uses 1/120 s steps.
const sweepTime = (lastIndex) => (lastIndex * CONFIG.world.platformSpacing + 0.11) / CONFIG.physics.maxDownwardSpeed;

describe('Phase 2 microscopic bounce with unchanged Phase 1.6 core', () => {
  it('raises only the Phase 1.6 impulse by 1.5% and preserves the visible/contact radius', () => {
    expect(CONFIG.physics.bounceVelocity).toBeCloseTo(8.925 * 1.015, 12);
    expect(CONFIG.physics.ballRadius).toBeCloseTo(.25 * 1.1, 12);
    expect(CONFIG.physics.bounceGravity).toBe(28);
    expect(CONFIG.physics.freeFallGravity).toBe(24.5);
    expect(CONFIG.physics.maxDownwardSpeed).toBe(18.4);
    expect(CONFIG.physics.fixedStep).toBe(1 / 120);
    expect(CONFIG.world.platformSpacing).toBe(2.25);
  });

  it('keeps the larger ball below an upper platform throughout the higher bounce', () => {
    const sim = new Simulation();
    const upperUnderside = CONFIG.world.platformSpacing - CONFIG.world.platformThickness;
    let maximumTop = 0;
    for (let step = 0; step < 80; step++) {
      sim.step(CONFIG.physics.fixedStep);
      maximumTop = Math.max(maximumTop, sim.ball.y + CONFIG.physics.ballRadius);
    }
    expect(maximumTop).toBeGreaterThan(1.93);
    expect(maximumTop).toBeLessThan(upperUnderside);
    // The approved fixed-step semi-implicit trajectory is the actual game path.
    // +1.8% would reach 1.986289 and clip this 1.98 underside; +1.5% clears.
    // Rendering interpolates these samples and cannot overshoot their maximum.
    expect(maximumTop).toBeCloseTo(1.9778104166666677, 7);
  });

  it('keeps angular gap and hazard boundaries identical at both ball sizes', () => {
    const savedRadius = CONFIG.physics.ballRadius;
    try {
      for (let level = 1; level <= 3; level++) {
        for (const platform of createLevel(level).platforms) {
          const angles = platform.segments.flatMap(segment => [segment.start - .001, segment.start + .001, segment.end - .001, segment.end + .001]);
          for (const angle of angles) {
            const rotation = angle - CONFIG.world.ballWorldAngle + platform.baseRotation;
            CONFIG.physics.ballRadius = .25;
            const previous = classifyPlatform(platform, rotation);
            CONFIG.physics.ballRadius = .275;
            expect(classifyPlatform(platform, rotation)).toBe(previous);
          }
        }
      }
    } finally {
      CONFIG.physics.ballRadius = savedRadius;
    }
  });

  it('caps downward speed, including long free-falls', () => {
    const { sim } = setup(['gap']);
    sim.platforms.at(-1).y = -1000;
    sim.ball.y = -10;
    sim.ball.velocity = -1;
    for (let step = 0; step < 360; step++) {
      sim.step(CONFIG.physics.fixedStep);
      expect(sim.ball.velocity).toBeGreaterThanOrEqual(-CONFIG.physics.maxDownwardSpeed);
    }
    expect(sim.ball.velocity).toBe(-18.4);
  });

  it('uses the lighter acceleration below the last contact plane', () => {
    const { sim } = setup(['gap']);
    sim.ball.y = -1;
    sim.ball.velocity = -5;
    sim.step(CONFIG.physics.fixedStep);
    expect(sim.ball.velocity).toBeCloseTo(-5 - CONFIG.physics.freeFallGravity * CONFIG.physics.fixedStep);
    expect(CONFIG.physics.freeFallGravity).toBe(24.5);
  });

  it('never applies the downward cap to an upward bounce', () => {
    const oldCap = CONFIG.physics.maxDownwardSpeed;
    try {
      CONFIG.physics.maxDownwardSpeed = 4;
      const { sim } = setup(['safe']);
      sim.step(.1);
      expect(sim.ball.velocity).toBe(9.058875);
      sim.step(CONFIG.physics.fixedStep);
      expect(sim.ball.velocity).toBeGreaterThan(CONFIG.physics.maxDownwardSpeed);
    } finally {
      CONFIG.physics.maxDownwardSpeed = oldCap;
    }
  });

  it('keeps the fixed-step bounce deterministic without duplicate landings', () => {
    const sim = new Simulation();
    let originalY = CONFIG.physics.ballRadius;
    let originalVelocity = 9.058875;
    const dt = CONFIG.physics.fixedStep;
    for (let step = 0; step < 1200; step++) {
      originalVelocity -= 28 * dt;
      originalY += originalVelocity * dt;
      if (originalVelocity < 0 && originalY <= CONFIG.physics.ballRadius) {
        originalY = CONFIG.physics.ballRadius;
        originalVelocity = 9.058875;
      }
      sim.step(dt);
      expect(sim.ball.y).toBeCloseTo(originalY, 12);
      expect(sim.ball.velocity).toBeCloseTo(originalVelocity, 12);
    }
  });
});

describe('automatic bouncing and state boundaries', () => {
  it('bounces indefinitely while holding without input', () => {
    const events = [];
    const sim = new Simulation({ onEvent: (event) => events.push(event) });
    for (let frame = 0; frame < 1200; frame += 1) sim.step(CONFIG.physics.fixedStep);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(sim.ball.y).toBeGreaterThanOrEqual(CONFIG.physics.ballRadius);
    expect(sim.passCount).toBe(0);
    expect(events.filter((event) => event.type === 'platformLanded').length).toBeGreaterThan(10);
  });

  it('starts on a real rotation and applies it immediately', () => {
    const sim = new Simulation();
    expect(sim.rotate(0)).toBe(false);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(sim.rotate(-0.25)).toBe(true);
    expect(sim.rotation).toBeCloseTo(TAU - 0.25);
    expect(sim.state).toBe(STATES.ACTIVE);
  });

  it('only resolves platforms on downward movement', () => {
    const { sim, events } = setup(['hazard']);
    sim.ball.y = -0.1;
    sim.ball.velocity = 10;
    sim.step(0.05);
    expect(sim.state).toBe(STATES.ACTIVE);
    expect(events).toHaveLength(0);
  });

  it('keeps the progress anchor steady during the upward part of a bounce', () => {
    const { sim } = setup(['safe']);
    sim.step(0.02);
    const anchor = sim.anchorY;
    sim.step(0.1);
    expect(sim.ball.y).toBeGreaterThan(CONFIG.physics.ballRadius);
    expect(sim.anchorY).toBe(anchor);
  });
});

describe('swept collisions, uninterrupted passes, and smash', () => {
  it('counts every gap crossed during one fast update, in vertical order', () => {
    const { sim, events } = setup(['gap', 'gap', 'gap']);
    sim.step(sweepTime(2));
    expect(sim.passCount).toBe(3);
    expect(events.filter((event) => event.type === 'platformPassed').map((event) => event.platform.id))
      .toEqual(['test-0', 'test-1', 'test-2']);
    expect(sim.platforms.slice(0, 3).every((platform) => !platform.active)).toBe(true);
  });

  it('activates at the configured threshold, not before', () => {
    const { sim, events } = setup(['gap', 'gap', 'gap']);
    sim.step(sweepTime(1));
    expect(sim.passCount).toBe(2);
    expect(sim.smashReady).toBe(false);
    sim.step(CONFIG.world.platformSpacing / sim.maxDownwardSpeed);
    expect(sim.passCount).toBe(CONFIG.smash.threshold);
    expect(sim.smashReady).toBe(true);
    expect(events.filter((event) => event.type === 'smashActivated')).toHaveLength(1);
  });

  it.each(['safe', 'hazard'])('smashes a contacted %s arc and consumes readiness with a normal upward rebound', (kind) => {
    const { sim, events } = setup(['gap', 'gap', 'gap', kind]);
    sim.step(sweepTime(4));
    expect(sim.state).toBe(STATES.ACTIVE);
    expect(sim.platforms[3].active).toBe(false);
    expect(sim.ball.y).toBe(sim.platforms[3].y + CONFIG.physics.ballRadius);
    expect(sim.ball.velocity).toBe(CONFIG.physics.bounceVelocity);
    expect(sim.ball.bouncePlaneY).toBe(sim.platforms[3].y);
    expect(sim.smashReady).toBe(false);
    expect(sim.passCount).toBe(0);
    expect(events.filter((event) => event.type === 'platformSmashed')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'platformSmashed', kind, bounceVelocity: 9.058875 });
    expect(events.some((event) => event.type === 'playerDied' || event.type === 'platformLanded')).toBe(false);
  });

  it('retains readiness through further gaps and activates only once', () => {
    const { sim, events } = setup(['gap', 'gap', 'gap', 'gap', 'gap']);
    sim.step(sweepTime(4));
    expect(sim.passCount).toBe(5);
    expect(sim.smashReady).toBe(true);
    expect(events.filter((event) => event.type === 'smashActivated')).toHaveLength(1);
  });

  it('safe landing resets passes and stops a sweep before lower hazards', () => {
    const { sim, events } = setup(['gap', 'gap', 'safe', 'hazard']);
    sim.step(sweepTime(3));
    expect(sim.passCount).toBe(0);
    expect(sim.smashReady).toBe(false);
    expect(sim.ball.y).toBe(sim.platforms[2].y + CONFIG.physics.ballRadius);
    expect(sim.ball.velocity).toBe(CONFIG.physics.bounceVelocity);
    expect(sim.platforms[3].active).toBe(true);
    expect(sim.state).toBe(STATES.ACTIVE);
    expect(events.at(-1).type).toBe('platformLanded');
  });

  it.each(['hazard', 'finish'])('stops the pre-impact sweep before a lower %s after smash reverses velocity', (lowerKind) => {
    const { sim, events } = setup(['safe', lowerKind]);
    sim.smashReady = true;
    sim.passCount = CONFIG.smash.threshold;
    sim.step(sweepTime(2));
    expect(sim.state).toBe(STATES.ACTIVE);
    expect(sim.platforms[0].active).toBe(false);
    expect(sim.platforms[1].active).toBe(true);
    expect(sim.ball.y).toBe(CONFIG.physics.ballRadius);
    expect(sim.ball.velocity).toBe(9.058875);
    expect(events.map(event => event.type)).toEqual(['dropStreakChanged', 'platformSmashed']);

    let steps = 0;
    let maximumY = sim.ball.y;
    while (sim.state === STATES.ACTIVE && steps < 240) {
      sim.step(CONFIG.physics.fixedStep);
      maximumY = Math.max(maximumY, sim.ball.y);
      steps++;
    }
    // The lower contact is real only after the whole rebound and another drop.
    expect(maximumY).toBeGreaterThan(CONFIG.physics.ballRadius + 1.2);
    expect(steps * CONFIG.physics.fixedStep).toBeGreaterThan(.7);
    expect(sim.state).toBe(lowerKind === 'hazard' ? STATES.DEAD_ANIMATION : STATES.COMPLETING);
    expect(events.filter(event => event.type === 'platformSmashed')).toHaveLength(1);
    expect(events.filter(event => event.type === 'platformPassed')).toHaveLength(0);
  });

  it('falls back through a destroyed plane without bouncing or counting it again', () => {
    const { sim, events } = setup(['hazard']);
    sim.smashReady = true;
    sim.passCount = 4;
    sim.step(.1);
    const contactY = sim.ball.y;
    sim.step(CONFIG.physics.fixedStep);
    expect(sim.ball.y).toBeGreaterThan(contactY);
    for (let step = 0; step < 110; step++) sim.step(CONFIG.physics.fixedStep);
    expect(sim.ball.y).toBeLessThan(sim.platforms[0].y - CONFIG.physics.ballRadius);
    expect(sim.ball.velocity).toBeLessThan(0);
    expect(sim.state).toBe(STATES.ACTIVE);
    expect(sim.passCount).toBe(0);
    expect(sim.smashReady).toBe(false);
    expect(events.map(event => event.type)).toEqual(['dropStreakChanged', 'platformSmashed']);
  });
});

describe('death, retry, and completion', () => {
  it.each([1, 2, 3])('maps progress to the whole extended tower and resets it on retry in layout %i', (levelNumber) => {
    const sim = new Simulation({ levelNumber });
    const formerFinish = sim.platforms[16];
    const safeArc = formerFinish.segments.find(segment => segment.kind === 'safe');
    const safeAngle = (safeArc.start + safeArc.end) / 2;
    sim.rotate(safeAngle - CONFIG.world.ballWorldAngle + formerFinish.baseRotation);
    sim.ball.y = formerFinish.y + CONFIG.physics.ballRadius;
    sim.ball.velocity = -1;
    sim.step(CONFIG.physics.fixedStep);
    expect(sim.state).toBe(STATES.ACTIVE);
    expect(sim.progress).toBeCloseTo(16 / (sim.platforms.length - 1));
    expect(sim.progress).toBeLessThan(.4);
    const count = sim.platforms.length;
    sim.state = STATES.DEAD_WAITING;
    sim.retry();
    expect(sim.levelNumber).toBe(levelNumber);
    expect(sim.platforms).toHaveLength(count);
    expect(sim.progress).toBe(0);
    expect(sim.anchorY).toBe(0);
  });

  it('death holds its reaction, waits for retry, and never increments the level number', () => {
    const { sim, events } = setup(['hazard'], 1757);
    sim.passCount = 2;
    sim.step(0.1);
    expect(sim.state).toBe(STATES.DEAD_ANIMATION);
    expect(sim.passCount).toBe(0);
    expect(sim.retry()).toBe(false);
    expect(sim.rotate(1)).toBe(false);
    sim.step(CONFIG.timing.deathDuration - 0.01);
    expect(sim.state).toBe(STATES.DEAD_ANIMATION);
    sim.step(0.01);
    expect(sim.state).toBe(STATES.DEAD_WAITING);
    sim.step(10);
    expect(sim.state).toBe(STATES.DEAD_WAITING);
    expect(sim.levelNumber).toBe(1757);
    expect(sim.retry()).toBe(true);
    expect(sim.levelNumber).toBe(1757);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(sim.rotation).toBe(0);
    expect(sim.progress).toBe(0);
    expect(sim.platforms.every((platform) => platform.active)).toBe(true);
    expect(events.filter((event) => event.type === 'playerDied')).toHaveLength(1);
  });

  it('lands on the finish even while smash-ready, holds, then increments exactly once', () => {
    const { sim, events } = setup(['gap', 'gap', 'gap', 'finish'], 1757);
    sim.step(sweepTime(3));
    expect(sim.state).toBe(STATES.COMPLETING);
    expect(sim.ball.y).toBe(sim.platforms[3].y + CONFIG.physics.ballRadius);
    expect(sim.ball.velocity).toBe(0);
    expect(sim.platforms[3].active).toBe(true);
    expect(sim.levelNumber).toBe(1757);
    expect(sim.progress).toBe(1);
    expect(sim.rotate(1)).toBe(false);
    expect(sim.retry()).toBe(false);
    sim.step(CONFIG.timing.completionHold - 0.01);
    expect(sim.state).toBe(STATES.COMPLETING);
    sim.step(0.01);
    expect(sim.levelNumber).toBe(1758);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(sim.progress).toBe(0);
    expect(sim.smashReady).toBe(false);
    expect(events.filter((event) => event.type === 'gameLevelCompleted')).toHaveLength(1);
    expect(events.some((event) => event.type === 'stateChanged' && event.state === STATES.TRANSITIONING)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'levelLoaded', levelNumber: 1758 });
    sim.step(1 / 120);
    expect(sim.levelNumber).toBe(1758);
  });

  it('retains the final representable level and completes exactly once at the numeric boundary', () => {
    const { sim, events } = setup(['finish'], Number.MAX_SAFE_INTEGER);
    sim.step(.1);
    expect(sim.state).toBe(STATES.COMPLETING);
    expect(events.filter(event => event.type === 'gameLevelCompleted')).toHaveLength(1);
    sim.step(CONFIG.timing.completionHold);
    expect(sim.levelNumber).toBe(Number.MAX_SAFE_INTEGER);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(events.filter(event => event.type === 'levelLoaded')).toHaveLength(1);
    for (let step = 0; step < 240; step++) sim.step(CONFIG.physics.fixedStep);
    expect(sim.levelNumber).toBe(Number.MAX_SAFE_INTEGER);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(events.filter(event => event.type === 'gameLevelCompleted')).toHaveLength(1);
    expect(events.filter(event => event.type === 'levelLoaded')).toHaveLength(1);
  });

  it('resets the exact same handcrafted layout after retry', () => {
    const sim = new Simulation({ levelNumber: 5 });
    const original = JSON.parse(JSON.stringify(sim.platforms));
    sim.platforms[0].active = false;
    sim.rotation = 2;
    sim.state = STATES.DEAD_WAITING;
    sim.retry();
    expect(sim.platforms).toEqual(original);
  });
});

describe('complete handcrafted towers across display refresh rates', () => {
  it.each([1, 2, 3])('provides a safe arrival across the full two-gap chute in layout %i', (levelNumber) => {
    const { platforms } = createLevel(levelNumber);
    for (const start of [4, 10]) {
      let sharedGapSamples = 0;
      for (let degree = 0; degree < 360; degree += 0.5) {
        const rotation = degree * Math.PI / 180;
        if (classifyPlatform(platforms[start], rotation) === 'gap'
          && classifyPlatform(platforms[start + 1], rotation) === 'gap') {
          sharedGapSamples += 1;
          expect(classifyPlatform(platforms[start + 2], rotation), `arrival ${start + 2} at rotation ${degree}°`).toBe('safe');
        }
      }
      expect(sharedGapSamples).toBeGreaterThan(100);
    }
  });

  it.each([1, 2, 3])('has a reachable ordinary play route through every platform of layout %i', (levelNumber) => {
    const completionTimes = [];
    for (const refreshRate of [30, 60, 90, 120, 144]) {
      const events = [];
      const sim = new Simulation({ levelNumber, onEvent: (event) => events.push(event) });
      const platformCount = sim.platforms.length - 1;
      let lastProgress = 0;
      let accumulator = 0;
      let frames = 0;
      // Replay identical 120 Hz input samples through different display-frame
      // schedules. Sampling steering at the display rate would change the input
      // itself, so differing landings would not indicate a physics-rate defect.
      while (sim.levelNumber === levelNumber && frames < refreshRate * 90 && !sim.state.startsWith('DEAD')) {
        accumulator += 1 / refreshRate;
        while (accumulator >= CONFIG.physics.fixedStep) {
          const nextPlatform = sim.platforms.find((platform) => platform.active
            && platform.y <= sim.ball.y - CONFIG.physics.ballRadius + 1e-8);
          if (sim.levelNumber === levelNumber && nextPlatform && !nextPlatform.finish) {
            const targetRotation = nextPlatform.baseRotation - CONFIG.world.ballWorldAngle;
            const shortestTurn = normalizeAngle(targetRotation - sim.rotation + Math.PI) - Math.PI;
            const maxTurn = CONFIG.input.sensitivity * CONFIG.physics.fixedStep;
            sim.rotate(Math.max(-maxTurn, Math.min(maxTurn, shortestTurn)));
          }
          sim.step(CONFIG.physics.fixedStep);
          if (sim.levelNumber === levelNumber) {
            expect(sim.progress).toBeGreaterThanOrEqual(lastProgress);
            lastProgress = sim.progress;
            if (sim.state === STATES.COMPLETING) expect(sim.progress).toBe(1);
          }
          accumulator -= CONFIG.physics.fixedStep;
        }
        frames += 1;
      }

      expect(sim.levelNumber, `layout ${levelNumber} at ${refreshRate} Hz`).toBe(levelNumber + 1);
      expect(sim.state).toBe(STATES.HOLDING);
      const passed = events.filter((event) => event.type === 'platformPassed');
      const smashed = events.filter((event) => event.type === 'platformSmashed');
      expect(passed.length + smashed.length).toBe(platformCount);
      expect(smashed.length).toBeGreaterThan(0);
      expect(events.some((event) => event.type === 'platformLanded')).toBe(true);
      expect(events.some((event) => event.type === 'playerDied')).toBe(false);
      completionTimes.push(frames / refreshRate);
    }
    // Any remaining difference is the final display-frame boundary, not faster
    // physics on a high-refresh display.
    expect(Math.max(...completionTimes) - Math.min(...completionTimes)).toBeLessThan(1 / 30);
  });
});
