import { CONFIG } from './config.js';
import { GENERATION } from './GenerationConfig.js';
import { SeededRandom } from './SeededRandom.js';
import { arcContains, clamp, TAU } from './math.js';

const EPSILON = 1e-7;
const MODEL_VERSION = 1;
const flightCache = new Map();
const certificateCache = new Map();
const MAX_CACHED_ROUTES = 16;
const signedAngle = value => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
const between = (value, low, high) => Number.isFinite(value) && value >= low - EPSILON && value <= high + EPSILON;

/** At terminal speed a section lasts spacing/speed seconds. First, second and
 * third differences measure turn, change in turn, and change in that change.
 * Dividing by section time gives their time-based rad/s, rad/s², rad/s³ units. */
export function analyzeFlowRoute(level) {
  const platforms = level.platforms.filter(platform => !platform.finish);
  const sectionTime = CONFIG.world.platformSpacing / CONFIG.physics.maxDownwardSpeed;
  const sections = [];
  let lastStep = 0, lastCurvature = 0;
  let maxRate = 0, maxStep = 0, maxCurvature = 0, maxJerk = 0, openingMaxRate = 0;
  for (let index = 1; index < platforms.length; index++) {
    const step = platforms[index].route.angle - platforms[index - 1].route.angle;
    const curvature = index > 1 ? step - lastStep : 0;
    const jerk = index > 2 ? curvature - lastCurvature : 0;
    const rate = step / sectionTime;
    maxRate = Math.max(maxRate, Math.abs(rate));
    maxStep = Math.max(maxStep, Math.abs(step));
    maxCurvature = Math.max(maxCurvature, Math.abs(curvature));
    maxJerk = Math.max(maxJerk, Math.abs(jerk));
    if (index < level.flow?.openingCount) openingMaxRate = Math.max(openingMaxRate, Math.abs(rate));
    sections.push({ index, delta: step, rate, curvature, jerk, time: sectionTime,
      acceleration: curvature / sectionTime ** 2, angularJerk: jerk / sectionTime ** 3 });
    lastStep = step;
    lastCurvature = curvature;
  }
  return { sectionTime, rotations: Math.abs(platforms.at(-1).route.angle - platforms[0].route.angle) / TAU,
    maxStep, maxRate, maxCurvature, maxJerk, openingMaxRate,
    maxAcceleration: maxCurvature / sectionTime ** 2, maxAngularJerk: maxJerk / sectionTime ** 3, sections };
}

/** Stricter than the unchanged centre-angle collision: the full ball footprint
 * plus 0.035 world units of steering clearance on either side must fit the
 * existing visible gap. Flow has no lethal edge, so no hazard inset is borrowed. */
export function flowBallHalfWidth() {
  return Math.asin((CONFIG.physics.ballRadius + GENERATION.flow.human.steeringMargin) / CONFIG.world.ballOrbitRadius);
}

function routeAt(level, y, output) {
  const platforms = level.platforms;
  const progress = clamp(-(y - CONFIG.physics.ballRadius) / CONFIG.world.platformSpacing, 0, level.platformCount - 1);
  const low = Math.floor(progress), high = Math.min(low + 1, level.platformCount - 1), fraction = progress - low;
  output.angle = platforms[low].route.angle + (platforms[high].route.angle - platforms[low].route.angle) * fraction;
  output.halfWidth = platforms[low].gapWidth / 2 + (platforms[high].gapWidth - platforms[low].gapWidth) * fraction / 2;
  output.index = low;
  return output;
}

/** Causal controller shared by generation and debug replay. Observe only the
 * corridor at the current height, then queue it for the reaction delay. Rate
 * feed-forward uses two already-perceived observations, never a future route
 * derivative or future ball position. 5.2 rad/viewport × default 1.2 × 0.75
 * viewport/s gives 4.68 rad/s; × 5 viewport/s² gives 31.2 rad/s². These are model
 * assumptions, not new limits imposed on manual controls. */
export function createFlowController(level, { mode = 'skilled', trial = 0 } = {}) {
  if (!['ideal', 'skilled', 'moderate'].includes(mode)) throw new Error('Unknown Flow controller mode');
  const human = GENERATION.flow.human;
  const ordinal = clamp(Number.isInteger(trial) ? trial : 0, 0, human.trials - 1);
  const random = new SeededRandom((level.seed ^ Math.imul(ordinal + 1, 83492791)) >>> 0);
  const moderate = mode === 'moderate';
  const delays = moderate ? human.moderateReactionDelay : human.reactionDelay;
  const reactionDelay = mode === 'ideal' ? 0 : delays[0] + (delays[1] - delays[0]) * ordinal / (human.trials - 1);
  const radiansPerViewport = CONFIG.input.sensitivity * CONFIG.input.multiplier.default;
  const maximumRate = radiansPerViewport * (moderate ? human.moderateViewportSpeed : human.viewportSpeed);
  const maximumAcceleration = radiansPerViewport * (moderate ? human.moderateViewportAcceleration : human.viewportAcceleration);
  const amplitude = moderate ? human.moderateAimError : human.aimError;
  const bias = random.range(-1, 1) * (moderate ? human.moderateAimBias : human.aimBias);
  const phase = random.range(0, TAU);
  // Fixed capacity covers >0.5s at 120Hz. step() never allocates geometry or data.
  const capacity = 64, times = new Float64Array(capacity), angles = new Float64Array(capacity), sample = {};
  let written = 0, consumed = 0, priorPerceivedTime = 0, priorPerceivedAngle = 0, measuredRate = 0;
  return {
    mode, trial: ordinal, elapsed: 0, angularRate: 0, reactionDelay, maximumRate, maximumAcceleration,
    angle: CONFIG.world.ballWorldAngle, targetAngle: 0, perceivedAngle: 0, observationTime: -1,
    step(dt, ballY, rotation) {
      if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(ballY)) return 0;
      if (Number.isFinite(rotation)) this.angle += signedAngle(rotation + CONFIG.world.ballWorldAngle - this.angle);
      const before = this.angle;
      routeAt(level, ballY, sample);
      this.targetAngle = sample.angle;
      if (mode === 'ideal') {
        const delta = clamp(sample.angle - this.angle, -maximumRate * dt, maximumRate * dt);
        this.angle += delta;
        this.angularRate = delta / dt;
        this.perceivedAngle = sample.angle;
        this.observationTime = this.elapsed;
      } else {
        const slot = written % capacity;
        times[slot] = this.elapsed;
        angles[slot] = sample.angle;
        written++;
        consumed = Math.max(consumed, written - capacity);
        while (consumed < written && times[consumed % capacity] <= this.elapsed - reactionDelay + 1e-10) {
          const nextTime = times[consumed % capacity], nextAngle = angles[consumed % capacity];
          measuredRate = this.observationTime >= 0 && nextTime > priorPerceivedTime
            ? (nextAngle - priorPerceivedAngle) / (nextTime - priorPerceivedTime) : 0;
          priorPerceivedAngle = nextAngle;
          priorPerceivedTime = nextTime;
          this.observationTime = nextTime;
          consumed++;
        }
        if (this.observationTime >= 0) {
          // Smooth bounded uncertainty is repeatable, unlike random tick noise.
          this.perceivedAngle = priorPerceivedAngle + bias + amplitude * Math.sin(this.elapsed * 2.1 + phase);
          const requestedRate = clamp(measuredRate + human.trackingGain * (this.perceivedAngle - this.angle), -maximumRate, maximumRate);
          this.angularRate += clamp(requestedRate - this.angularRate, -maximumAcceleration * dt, maximumAcceleration * dt);
          this.angle += this.angularRate * dt;
        }
      }
      this.elapsed += dt;
      return this.angle - before;
    },
  };
}

/** Same semi-implicit fixed-step flight as Simulation, starting with the normal
 * bounce, gravity switch and terminal cap. Only six count-specific schedules
 * exist. An uninterrupted path has no contacts before finish, avoiding recursive
 * level generation here. Actual Simulation equivalence is tested separately. */
function flightSchedule(count) {
  if (flightCache.has(count)) return flightCache.get(count);
  const frames = [], h = CONFIG.physics.fixedStep;
  let y = CONFIG.physics.ballRadius, velocity = CONFIG.physics.bounceVelocity, nextPlane = 0;
  for (let step = 0; step < 1600 && nextPlane <= count; step++) {
    const beforeY = y;
    const gravity = y - CONFIG.physics.ballRadius >= -1e-9 ? CONFIG.physics.bounceGravity : CONFIG.physics.freeFallGravity;
    velocity = Math.max(-CONFIG.physics.maxDownwardSpeed, velocity - gravity * h);
    y += velocity * h;
    let contactIndex = -1, fraction = 0;
    const plane = -nextPlane * CONFIG.world.platformSpacing;
    if (velocity < 0 && beforeY - CONFIG.physics.ballRadius >= plane - 1e-9 && y - CONFIG.physics.ballRadius <= plane + 1e-9) {
      contactIndex = nextPlane++;
      fraction = clamp((beforeY - CONFIG.physics.ballRadius - plane) / (beforeY - y), 0, 1);
    }
    frames.push({ time: step * h, y: beforeY, nextY: y, contactIndex, fraction });
  }
  flightCache.set(count, frames);
  return frames;
}

/** Record plane misses and the continuous piecewise-linear corridor margin.
 * After a miss we continue the hypothetical no-bounce flight to locate hard
 * sections. This is not a bounce simulator; debug replays use real Simulation. */
export function simulateFlowController(level, { mode = 'skilled', trial = 0, trace = false } = {}) {
  const controller = createFlowController(level, { mode, trial }), footprint = flowBallHalfWidth();
  const failures = [], contacts = [], trajectory = trace ? [] : undefined, sample = {};
  let minimumMargin = Infinity, continuousMargin = Infinity, entered = false;
  for (const frame of flightSchedule(level.platformCount)) {
    controller.step(CONFIG.physics.fixedStep, frame.y);
    routeAt(level, frame.nextY, sample);
    const corridorMargin = sample.halfWidth - footprint - Math.abs(controller.angle - sample.angle);
    if (entered) continuousMargin = Math.min(continuousMargin, corridorMargin);
    if (frame.contactIndex >= 0 && frame.contactIndex < level.platformCount) {
      entered = true;
      const platform = level.platforms[frame.contactIndex];
      const margin = platform.gapWidth / 2 - footprint - Math.abs(controller.angle - platform.route.angle);
      const localAngle = controller.angle - platform.baseRotation;
      const physicallyOpen = !platform.segments.some(segment => arcContains(localAngle, segment.start, segment.end));
      minimumMargin = Math.min(minimumMargin, margin);
      if (margin < -EPSILON || !physicallyOpen) failures.push(frame.contactIndex);
      contacts.push({ index: frame.contactIndex, time: frame.time + frame.fraction * CONFIG.physics.fixedStep,
        angle: controller.angle, margin, physicallyOpen });
    }
    if (trace) trajectory.push({ time: frame.time + CONFIG.physics.fixedStep, y: frame.nextY,
      angle: controller.angle, targetAngle: sample.angle, perceivedAngle: controller.perceivedAngle,
      angularRate: controller.angularRate, margin: corridorMargin, platformIndex: sample.index,
      observationTime: controller.observationTime });
  }
  return { mode, trial: controller.trial, reactionDelay: controller.reactionDelay,
    success: failures.length === 0 && continuousMargin >= -EPSILON,
    minimumMargin, continuousMargin, failures, contacts, ...(trace ? { trajectory } : {}) };
}

function fingerprint(level) {
  // Exact strings avoid hash collisions; actual arcs/base rotations stop a
  // mutated geometry from reusing its former certificate.
  return `${MODEL_VERSION}:${level.seed}:${level.platformCount}:${level.flow?.openingCount}:${JSON.stringify(GENERATION.flow)}:`
    + level.platforms.filter(platform => !platform.finish).map(platform =>
      `${platform.y},${platform.baseRotation},${platform.gapWidth},${platform.route.angle},${platform.route.halfWidth};`
      + platform.segments.map(segment => `${segment.kind},${segment.start},${segment.end}`).join('|')).join('/');
}

function summarizeTrials(trials, count) {
  const failureCounts = new Array(count).fill(0);
  for (const trial of trials) for (const index of trial.failures) failureCounts[index]++;
  const successes = trials.filter(trial => trial.success).length;
  return { successes, trials: trials.length, successRate: successes / trials.length,
    minimumMargin: Math.min(...trials.map(trial => trial.minimumMargin)),
    minimumContinuousMargin: Math.min(...trials.map(trial => trial.continuousMargin)),
    worstSectionFailures: Math.max(...failureCounts), failureCounts,
    difficultSections: failureCounts.map((failures, index) => ({ index, failures })).filter(section => section.failures),
    trialResults: trials.map(({ trial, reactionDelay, success, minimumMargin, continuousMargin, failures }) =>
      ({ trial, reactionDelay, success, minimumMargin, continuousMargin, failures })) };
}

export function getFlowFeasibility(level) {
  const key = fingerprint(level);
  if (certificateCache.has(key)) return certificateCache.get(key);
  const ideal = simulateFlowController(level, { mode: 'ideal' }), skilled = [], moderate = [];
  for (let trial = 0; trial < GENERATION.flow.human.trials; trial++) {
    skilled.push(simulateFlowController(level, { mode: 'skilled', trial }));
    moderate.push(simulateFlowController(level, { mode: 'moderate', trial }));
  }
  const result = { modelVersion: MODEL_VERSION, metrics: analyzeFlowRoute(level),
    ballHalfWidth: flowBallHalfWidth(), steeringMarginWorld: GENERATION.flow.human.steeringMargin,
    ideal: { success: ideal.success, minimumMargin: ideal.minimumMargin, minimumContinuousMargin: ideal.continuousMargin, failures: ideal.failures },
    skilled: summarizeTrials(skilled, level.platformCount), moderate: summarizeTrials(moderate, level.platformCount) };
  // Validation trusts this private cache, never the public metadata copy.
  const freeze = object => { for (const value of Object.values(object)) if (value && typeof value === 'object') freeze(value); return Object.freeze(object); };
  freeze(result);
  if (certificateCache.size >= MAX_CACHED_ROUTES) certificateCache.delete(certificateCache.keys().next().value);
  certificateCache.set(key, result);
  return result;
}

export function validateFlowFeasibility(level) {
  const errors = [], tuning = GENERATION.flow;
  if (!Array.isArray(level?.platforms) || !between(level.platformCount, ...GENERATION.flowCount)
    || level.platforms.length !== level.platformCount + 1
    || level.platforms.some(platform => !platform || !Number.isFinite(platform.y) || !Array.isArray(platform.segments)
      || platform.segments.length < 1 || platform.segments.length > 64
      || platform.segments.some(segment => !segment || !['safe', 'hazard'].includes(segment.kind)
        || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start)
      || (!platform.finish && (!platform.route || !Number.isFinite(platform.route.angle) || !Number.isFinite(platform.route.halfWidth)
        || !Number.isFinite(platform.gapWidth) || !Number.isFinite(platform.baseRotation))))) {
    return { valid: false, errors: ['Invalid Flow route geometry'], maximumSpeed: 0 };
  }
  const platforms = level.platforms.filter(platform => !platform.finish);
  if (platforms.length !== level.platformCount) return { valid: false, errors: ['Invalid Flow platform count'], maximumSpeed: 0 };
  const finish = level.platforms.at(-1);
  if (!finish.finish || finish.type !== 'finish' || finish.motion || finish.walls?.length
    || finish.segments.length !== 1 || finish.segments[0].kind !== 'safe'
    || finish.segments[0].start !== 0 || finish.segments[0].end !== TAU) errors.push('Invalid or unsafe Flow finish floor');
  const openingCount = level.flow?.openingCount;
  if (!Number.isInteger(openingCount) || !between(openingCount, ...tuning.openingCount)) errors.push('Flow lacks a readable opening section');
  const metrics = analyzeFlowRoute(level);
  let direction = 0;
  for (let index = 0; index < platforms.length; index++) {
    const platform = platforms[index];
    if (!between(platform.gapWidth, ...tuning.gapWidth) || Math.abs(platform.route.halfWidth - platform.gapWidth / 2) > EPSILON) errors.push(`${platform.id}: Flow gap width changed`);
    if (Math.abs(signedAngle(platform.baseRotation - platform.route.angle)) > EPSILON
      || platform.segments.length !== 1 || Math.abs(platform.segments[0].start - platform.gapWidth / 2) > EPSILON
      || Math.abs(platform.segments[0].end - (TAU - platform.gapWidth / 2)) > EPSILON) errors.push(`${platform.id}: Flow corridor disagrees with visible opening`);
    if (platform.type !== 'static' || platform.motion || platform.walls?.length || platform.segments.some(segment => segment.kind !== 'safe')) errors.push(`${platform.id}: Flow contains hazards, walls or motion`);
    if (Math.abs(platform.y + index * CONFIG.world.platformSpacing) > EPSILON) errors.push(`${platform.id}: Flow spacing changed`);
    if (index === 0) continue;
    const section = metrics.sections[index - 1];
    const overlap = platforms[index - 1].gapWidth / 2 + platform.gapWidth / 2 - Math.abs(section.delta) - 2 * flowBallHalfWidth();
    if (Math.abs(section.delta) > tuning.maxStep + EPSILON || overlap < GENERATION.routeMargin) errors.push(`${platform.id}: discontinuous Flow corridor`);
    if (Math.abs(section.curvature) > tuning.maxCurvature + EPSILON) errors.push(`${platform.id}: excessive Flow curvature`);
    if (Math.abs(section.jerk) > tuning.maxJerk + EPSILON) errors.push(`${platform.id}: excessive Flow jerk`);
    if (Math.abs(section.rate) > tuning.maxTurnSpeed + EPSILON) errors.push(`${platform.id}: Flow requires excessive steering speed`);
    if (direction && Math.sign(section.delta) !== direction) errors.push(`${platform.id}: abrupt Flow reversal`);
    direction = Math.sign(section.delta);
  }
  if (!between(metrics.rotations, ...tuning.rotations)) errors.push('Flow must wind around the tower');
  if (metrics.openingMaxRate > tuning.openingMaxTurnSpeed + EPSILON) errors.push('Flow opening requires excessive steering speed');
  const firstRate = Math.abs(metrics.sections[0].rate);
  if (firstRate < 0.5 || firstRate > metrics.maxRate * 0.7) errors.push('Flow opening must introduce steering gradually');
  if (errors.length) return { valid: false, errors, maximumSpeed: metrics.maxRate, metrics };
  const feasibility = getFlowFeasibility(level);
  if (!feasibility.ideal.success) errors.push('Ideal Flow controller cannot complete the continuous corridor');
  if (feasibility.skilled.successRate + EPSILON < tuning.human.minimumSuccessRate) errors.push('Skilled Flow controller success is below the required threshold');
  if (feasibility.skilled.worstSectionFailures > tuning.human.trials * tuning.human.maxFailureSectionRatio) errors.push('Flow contains a repeatedly difficult section');
  if (feasibility.skilled.failureCounts.slice(0, openingCount).some(count => count > 1)) errors.push('Flow opening is disproportionately difficult');
  return { valid: errors.length === 0, errors, maximumSpeed: metrics.maxRate, metrics, feasibility };
}
