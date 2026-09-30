import { CONFIG } from './config.js';
import { GENERATION } from './GenerationConfig.js';
import { normalizeAngle, TAU } from './math.js';

const EPSILON = 1e-8;
export const signedRouteDelta = angle => normalizeAngle(angle + Math.PI) - Math.PI;

/** Split an increasing circular interval into ordinary [0, 2π] intervals. */
export function splitCircularInterval(start, end) {
  const width = end - start;
  if (width >= TAU - EPSILON) return [{ start: 0, end: TAU }];
  if (width <= EPSILON) return [];
  const from = normalizeAngle(start);
  return from + width <= TAU + EPSILON
    ? [{ start: from, end: Math.min(TAU, from + width) }]
    : [{ start: from, end: TAU }, { start: 0, end: from + width - TAU }];
}

/** Genuine empty space, derived from the exact arcs used for draw and contact. */
export function platformGapIntervals(platform) {
  if (platform.motion || platform.finish) return [];
  const occupied = platform.segments.flatMap(segment => splitCircularInterval(
    segment.start + platform.baseRotation, segment.end + platform.baseRotation)).sort((a, b) => a.start - b.start);
  const gaps = [];
  let end = 0;
  for (const interval of occupied) {
    if (interval.start > end + EPSILON) gaps.push({ start: end, end: interval.start });
    end = Math.max(end, interval.end);
  }
  if (end < TAU - EPSILON) gaps.push({ start: end, end: TAU });
  return gaps;
}

export function intersectIntervals(first, second) {
  const intersections = [];
  let i = 0;
  let j = 0;
  while (i < first.length && j < second.length) {
    const start = Math.max(first[i].start, second[j].start);
    const end = Math.min(first[i].end, second[j].end);
    if (end > start + EPSILON) intersections.push({ start, end });
    if (first[i].end < second[j].end) i += 1;
    else j += 1;
  }
  return intersections;
}

export function widestCircularInterval(intervals) {
  if (!intervals.length) return 0;
  let maximum = Math.max(...intervals.map(interval => interval.end - interval.start));
  if (intervals.length > 1 && intervals[0].start < EPSILON && intervals.at(-1).end > TAU - EPSILON) {
    maximum = Math.max(maximum, intervals[0].end + TAU - intervals.at(-1).start);
  }
  return maximum;
}

/** Sphere chord footprint plus a physical clearance at both opening edges. */
export function passableGapWidth() {
  return 2 * Math.asin((CONFIG.physics.ballRadius + GENERATION.route.alignmentPhysicalMargin) / CONFIG.world.ballOrbitRadius);
}

export function analyzeGapAlignment(level) {
  const platforms = level.platforms.filter(platform => !platform.finish);
  const gaps = platforms.map(platformGapIntervals);
  const suppliedDrops = level.plannedDrops || level.smashOpportunities || [];
  const plannedDrops = Array.isArray(suppliedDrops) ? suppliedDrops.filter(drop => drop && typeof drop === 'object') : [];
  const threshold = passableGapWidth();
  const windows = [];
  for (let start = 0; start < platforms.length - 2; start += 1) {
    let shared = gaps[start];
    for (let length = 2; length <= 5 && start + length <= platforms.length; length += 1) {
      shared = intersectIntervals(shared, gaps[start + length - 1]);
      if (length < 3) continue;
      const width = widestCircularInterval(shared);
      if (width < threshold - EPSILON) continue;
      const planned = plannedDrops.find(drop => start >= drop.start && start + length <= drop.start + drop.passes);
      windows.push({ start, length, width, intervals: shared, plannedDropId: planned?.id || (planned ? `drop-${planned.start}` : null) });
    }
  }
  const accidental = windows.filter(window => !window.plannedDropId);
  const threes = accidental.filter(window => window.length === 3);
  const repeated = threes.filter((window, index) => index && window.start <= threes[index - 1].start + 2);
  return { threshold, windows, accidental, repeatedThreeWindows: repeated.length,
    accidentalThreeCount: threes.length, hardViolationCount: accidental.filter(window => window.length >= 4).length,
    maximumSharedWidth: Math.max(0, ...windows.map(window => window.width)),
    maximumUnmarkedLength: Math.max(0, ...accidental.map(window => window.length)) };
}

export function analyzeRoute(level) {
  const points = level.route || [];
  const transitions = [];
  let previousDirection = 0;
  let currentRun = 0;
  let longestSameDirectionRun = 0;
  let reversals = 0;
  let significantTransitions = 0;
  let clockwiseMovement = 0;
  let anticlockwiseMovement = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta = signedRouteDelta(points[index].angle - points[index - 1].angle);
    const direction = Math.abs(delta) <= GENERATION.route.directionDeadband ? 0 : Math.sign(delta);
    if (direction) {
      significantTransitions += 1;
      if (previousDirection && direction !== previousDirection) reversals += 1;
      currentRun = direction === previousDirection ? currentRun + 1 : 1;
      longestSameDirectionRun = Math.max(longestSameDirectionRun, currentRun);
      previousDirection = direction;
      if (direction > 0) clockwiseMovement += delta;
      else anticlockwiseMovement -= delta;
    }
    transitions.push({ index, delta, direction, directionRun: direction ? currentRun : 0,
      plannedDropId: points[index].plannedDropId || null, recovery: points[index].role === 'recovery' });
  }
  const total = clockwiseMovement + anticlockwiseMovement;
  return { transitions, longestSameDirectionRun, reversals, significantTransitions,
    reversalRate: significantTransitions > 1 ? reversals / (significantTransitions - 1) : 0,
    clockwiseMovement, anticlockwiseMovement,
    directionBalance: Math.max(clockwiseMovement, anticlockwiseMovement) ? Math.min(clockwiseMovement, anticlockwiseMovement) / Math.max(clockwiseMovement, anticlockwiseMovement) : 0,
    netRotationRatio: total ? Math.abs(clockwiseMovement - anticlockwiseMovement) / total : 0 };
}

export function validateNormalRoute(level) {
  const metrics = analyzeRoute(level);
  const alignment = analyzeGapAlignment(level);
  const limits = GENERATION.route;
  const errors = [];
  if (metrics.longestSameDirectionRun > limits.maxSameDirectionRun) errors.push('Normal route exceeds three same-direction transitions');
  if (metrics.reversalRate < limits.minReversalRate || metrics.reversalRate > limits.maxReversalRate) errors.push('Normal route reversal rate outside readable rhythm');
  if (metrics.directionBalance < limits.minDirectionBalance) errors.push('Normal route lacks balanced clockwise/anticlockwise movement');
  if (metrics.netRotationRatio > limits.maxNetRotationRatio) errors.push('Normal route has excessive net rotation');
  if (alignment.hardViolationCount) errors.push('Accidental unmarked four/five-platform common-gap corridor');
  if (alignment.repeatedThreeWindows) errors.push('Repeated accidental three-platform common-gap corridors');
  if (alignment.accidentalThreeCount > Math.floor(level.platformCount * limits.maxAccidentalThreeRatio)) errors.push('Too many accidental three-platform common-gap corridors');
  const drops = level.plannedDrops;
  if (!Array.isArray(drops) || drops.length !== level.smashOpportunities.length) errors.push('Missing explicit planned-drop metadata');
  else {
    const profile = GENERATION.profiles[level.difficulty];
    if (drops.length > profile.maxPlannedDrops) errors.push('Excessive planned-drop count');
    if (drops.reduce((sum, drop) => sum + drop.passes, 0) > level.platformCount * limits.maxPlannedDropRatio) errors.push('Normal tower contains too much planned Flow-like descent');
    for (let index = 0; index < drops.length; index += 1) {
      const drop = drops[index];
      if (drop.passes < 3 || drop.passes > 5) errors.push('Planned drop must contain three to five platforms');
      if (index && drop.start <= drops[index - 1].recoveryIndex + 2) errors.push('Adjacent planned-drop sequences');
      const entry = metrics.transitions[drop.start - 1]?.direction;
      const exit = metrics.transitions[drop.catchIndex - 1]?.direction;
      if (!entry || exit !== -entry) errors.push('Planned drop does not reverse into its catch');
      if (!drop.id || level.route.slice(drop.start, drop.catchIndex).some(point => point.plannedDropId !== drop.id)) errors.push('Inconsistent planned-drop membership');
    }
  }
  return { valid: !errors.length, errors, metrics, alignment };
}
