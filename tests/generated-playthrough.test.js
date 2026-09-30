import { describe, expect, it } from 'vitest';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { CONFIG } from '../src/game/config.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { cadenceForLevel } from '../src/game/LevelCadence.js';
import { evaluatePlatformMotion, getPlatformRotation } from '../src/game/PlatformMotion.js';
import { arcContains, clamp, normalizeAngle } from '../src/game/math.js';

const dt = CONFIG.physics.fixedStep;
const turnSpeed = GENERATION.routeTurnSpeed;
const angularError = angle => normalizeAngle(angle + Math.PI) - Math.PI;

// A test controller knows the authored motion and predicts the next contact. It
// still uses ordinary bounded rotation, lethal wall contact, bounce, smash and death.
function timeToPlane(sim, platform) {
  let y = sim.ball.y;
  let velocity = sim.ball.velocity;
  for (let tick = 1; tick <= 360; tick++) {
    const gravity = y - CONFIG.physics.ballRadius >= sim.ball.bouncePlaneY - 1e-9
      ? CONFIG.physics.bounceGravity : CONFIG.physics.freeFallGravity;
    velocity = Math.max(-CONFIG.physics.maxDownwardSpeed, velocity - gravity * dt);
    y += velocity * dt;
    if (velocity < 0 && y - CONFIG.physics.ballRadius <= platform.y) return tick * dt;
  }
  throw new Error(`No reachable next contact for ${platform.id}`);
}

function classify(state, angle) {
  for (const segment of state.segments) {
    if (arcContains(angle, segment.start, segment.end)) return segment.kind;
  }
  return 'gap';
}

function steer(sim, recoveryExit) {
  const next = sim.platforms.find(platform => platform.active
    && platform.y <= sim.ball.y - CONFIG.physics.ballRadius + 1e-8);
  if (!next || next.finish) return;
  const flight = timeToPlane(sim, next);
  const state = evaluatePlatformMotion(next, sim.animationTime + flight);
  const local = CONFIG.world.ballWorldAngle + sim.rotation - getPlatformRotation(next);
  const exitOffset = next.index === recoveryExit?.index ? recoveryExit.offset : 0;
  let error = angularError(exitOffset - local);
  const possibleContact = local + clamp(error, -turnSpeed * flight, turnSpeed * flight);
  // Moving patterns may release through any physical opening: their immediate
  // static catch is safe around its entire circumference. Static routing still
  // targets the primary opening to exercise the authored anti-screw route.
  const intendedGap = angle => classify(state, angle) === 'gap'
    && (next.motion || Math.abs(angularError(angle)) < next.route.halfWidth - .06);
  if (classify(state, possibleContact) === 'hazard' || (classify(state, possibleContact) === 'gap' && !intendedGap(possibleContact))) {
    // Trying to reach a distant gap through a flank is avoidable. Take a
    // reachable safe edge, bounce, and use that additional time to steer onward.
    let bestCost = Infinity;
    let safeError = 0;
    for (const segment of state.segments) {
      for (const candidate of [segment.start - .18, segment.start + .18,
        segment.end - .18, segment.end + .18, (segment.start + segment.end) / 2]) {
        const candidateError = angularError(candidate - local);
        const contact = local + clamp(candidateError, -turnSpeed * flight, turnSpeed * flight);
        if (classify(state, contact) === 'hazard' || (classify(state, contact) === 'gap' && !intendedGap(contact))) continue;
        const cost = Math.abs(candidateError) + (classify(state, candidate) === 'gap' ? 0 : .1);
        if (cost < bestCost) { bestCost = cost; safeError = candidateError; }
      }
    }
    error = safeError;
  }
  // Prediction must not leave future state in the live rendering/collision data.
  evaluatePlatformMotion(next, sim.animationTime);
  sim.rotate(clamp(error, -turnSpeed * dt, turnSpeed * dt));
}

const numberedSamples = [];
for (let number = 1; number <= 50; number++) if (number % 10) numberedSamples.push(number);
for (let number = 100001; number <= 100050; number++) if (number % 10) numberedSamples.push(number);
let extraChallenges = 0;
for (let number = 51; extraChallenges < 10; number++) {
  if (cadenceForLevel(number).difficulty === 'challenge') { numberedSamples.push(number); extraChallenges++; }
}
for (const milestone of [100, 200, 300, 400, 500, 1000000]) {
  if (!numberedSamples.includes(milestone)) numberedSamples.push(milestone);
}

describe('bounded ordinary play through generated normal and milestone towers', () => {
  it.each(numberedSamples)('has a successful legal route through level %s at 3.2 radians/sec', levelNumber => {
    const events = [];
    const sim = new Simulation({ levelNumber, onEvent: event => events.push(event) });
    const count = sim.level.platformCount;
    sim.rotate(.00001);
    let steps = 0;
    while (steps < 80 / dt && sim.state === STATES.ACTIVE) {
      steer(sim);
      sim.step(dt);
      steps++;
    }
    const death = events.find(event => event.type === 'playerDied');
    expect(death, `death at ${death?.platform.id} (${death?.platform.type})`).toBeUndefined();
    expect(sim.state).toBe(STATES.COMPLETING);
    expect(events.filter(event => event.type === 'gameLevelCompleted')).toHaveLength(1);
    const passed = events.filter(event => event.type === 'platformPassed').length;
    const smashed = events.filter(event => event.type === 'platformSmashed').length;
    expect(passed + smashed).toBe(count);
    expect(smashed).toBeGreaterThan(0);
    expect(sim.progress).toBe(1);
  });

  it.each([65, 116])('supports a legal off-centre recovery exit before the moving hazard in level %s', levelNumber => {
    const events = [];
    let exitAngle;
    const sim = new Simulation({ levelNumber, onEvent: event => {
      events.push(event);
      if (event.type === 'platformPassed' && event.platform.index === 31) {
        exitAngle = angularError(CONFIG.world.ballWorldAngle + sim.rotation - event.platform.baseRotation);
      }
    } });
    const recovery = sim.platforms[31];
    expect(recovery.type).toBe('static');
    expect(recovery.route.role).toBe('recovery');
    expect(recovery.segments.every(segment => segment.kind === 'safe')).toBe(true);
    expect(sim.platforms[32].type).toBe('orbiting');
    expect(sim.platforms[32].segments.some(segment => segment.kind === 'hazard')).toBe(true);

    // The one-platform controller above aims every static exit at its centre.
    // Here the player sees the orbiting hazard during the preceding smash arc
    // and chooses a point 6.9 degrees to one side, inside the same recovery gap.
    // This supplies a legal route example, not a gameplay assist or a new rule.
    const recoveryExit = { index: 31, offset: -.12 };
    const requiredHalfWidth = Math.asin((CONFIG.physics.ballRadius + GENERATION.route.alignmentPhysicalMargin)
      / CONFIG.world.ballOrbitRadius);
    expect(recovery.gapWidth / 2 - Math.abs(recoveryExit.offset)).toBeGreaterThan(requiredHalfWidth);
    sim.rotate(.00001);
    for (let steps = 0; steps < 80 / dt && sim.state === STATES.ACTIVE; steps++) {
      const previousRotation = sim.rotation;
      steer(sim, recoveryExit);
      expect(Math.abs(angularError(sim.rotation - previousRotation))).toBeLessThanOrEqual(turnSpeed * dt + 1e-12);
      sim.step(dt);
    }
    expect(exitAngle).toBeCloseTo(recoveryExit.offset, 10);
    expect(recovery.gapWidth / 2 - Math.abs(exitAngle)).toBeGreaterThan(requiredHalfWidth);
    expect(events.some(event => event.type === 'playerDied')).toBe(false);
    expect(events.filter(event => event.type === 'gameLevelCompleted')).toHaveLength(1);
    expect(sim.state).toBe(STATES.COMPLETING);
    expect(events.filter(event => event.type === 'platformPassed' || event.type === 'platformSmashed')).toHaveLength(sim.level.platformCount);
  });
});
