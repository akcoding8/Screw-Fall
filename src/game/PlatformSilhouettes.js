import { CONFIG } from './config.js';
import { arcContains, clamp, normalizeAngle, TAU } from './math.js';

const rad = degrees => degrees * Math.PI / 180;
const EPSILON = 1e-7;

/** Angular pieces are the sole geometry source for drawing, contact and debris. */
export const SILHOUETTE_CONFIG = Object.freeze({
  landingMargin: 0.055,
  tinyUsableDiameters: [1.5, 2.5],
  pieceSeparation: rad(18),
  maximumPieces: 4,
  maximumConsecutiveSmall: 2,
  shoulderWidth: { gentle: [rad(12), rad(17)], standard: [rad(17), rad(24)], challenge: [rad(22), rad(30)] },
  profiles: {
    gentle: {
      weights: { broadRing: 30, offsetRing: 12, mediumCrescent: 20, compactCrescent: 8, third: 3, quarter: 2,
        twoCrescents: 10, pairedLedges: 3, threePiece: 5, fourPiece: 2, smallIsland: 2, tinyLedge: 0.5,
        safeHazardIslands: 1, sparseObstacles: 0.5, mixedPieces: 1 },
      shoulderChance: 0.18, doubleShoulderChance: 0.03, maxTiny: 1, maxHazardIslands: 1,
    },
    standard: {
      weights: { broadRing: 15, offsetRing: 10, mediumCrescent: 12, compactCrescent: 10, third: 5, quarter: 4,
        twoCrescents: 12, pairedLedges: 6, threePiece: 8, fourPiece: 5, smallIsland: 4, tinyLedge: 2,
        safeHazardIslands: 3, sparseObstacles: 1, mixedPieces: 3 },
      shoulderChance: 0.43, doubleShoulderChance: 0.2, maxTiny: 2, maxHazardIslands: 3,
    },
    challenge: {
      weights: { broadRing: 2, offsetRing: 6, mediumCrescent: 8, compactCrescent: 8, third: 6, quarter: 6,
        twoCrescents: 12, pairedLedges: 12, threePiece: 12, fourPiece: 8, smallIsland: 5, tinyLedge: 3,
        safeHazardIslands: 4, sparseObstacles: 2, mixedPieces: 6 },
      shoulderChance: 0.65, doubleShoulderChance: 0.32, maxTiny: 3, maxHazardIslands: 4,
    },
  },
  costs: { broadRing: 0, offsetRing: 0.5, mediumCrescent: 0.5, compactCrescent: 0.75, third: 1, quarter: 1.25,
    twoCrescents: 1, pairedLedges: 1.5, threePiece: 1.25, fourPiece: 1.5, smallIsland: 2, tinyLedge: 3,
    safeHazardIslands: 1.5, sparseObstacles: 1.5, mixedPieces: 1.5,
    shoulder: 1, doubleShoulder: 2.5, hazardIsland: 1.5,
    breathing: 2.5, orbiting: 2.5, stinger: 4, lowWall: 3, divider: 4, largeReversal: 1, plannedDrop: 2 },
});

export const SILHOUETTE_NAMES = Object.freeze(Object.keys(SILHOUETTE_CONFIG.profiles.standard.weights));

const SHAPE_TOPOLOGY = {
  broadRing: [1], offsetRing: [2], mediumCrescent: [1, 168, 194], compactCrescent: [1, 132, 154],
  third: [1, 112, 124], quarter: [1, 84, 96], twoCrescents: [2, 172, 198],
  pairedLedges: [2, 90, 112], threePiece: [3, 178, 178], fourPiece: [4, 176, 176],
  smallIsland: [1, 51, 65], tinyLedge: [1], safeHazardIslands: [2, 91, 118],
  sparseObstacles: [2, 70, 91], mixedPieces: [3, 122, 151],
};

export function minimumSafeAngularWidth(usableDiameters = SILHOUETTE_CONFIG.tinyUsableDiameters[0],
  ballRadius = CONFIG.physics.ballRadius, contactRadius = CONFIG.world.ballOrbitRadius,
  landingMargin = SILHOUETTE_CONFIG.landingMargin) {
  if (![usableDiameters, ballRadius, contactRadius, landingMargin].every(Number.isFinite)
    || usableDiameters <= 0 || ballRadius <= 0 || contactRadius <= 0 || landingMargin < 0) return NaN;
  const requiredChord = usableDiameters * ballRadius * 2 + landingMargin * 2;
  return requiredChord > contactRadius * 2 ? NaN : 2 * Math.asin(requiredChord / (contactRadius * 2));
}

export function usableWidthInBallDiameters(angularWidth, ballRadius = CONFIG.physics.ballRadius,
  contactRadius = CONFIG.world.ballOrbitRadius, landingMargin = SILHOUETTE_CONFIG.landingMargin) {
  if (![angularWidth, ballRadius, contactRadius, landingMargin].every(Number.isFinite)
    || angularWidth < 0 || ballRadius <= 0 || contactRadius <= 0 || landingMargin < 0) return NaN;
  // Above half a circle the diameter remains a conservative contiguous target.
  const chord = 2 * contactRadius * Math.sin(Math.min(Math.PI, angularWidth) / 2);
  return Math.max(0, chord - landingMargin * 2) / (ballRadius * 2);
}

export function chooseSilhouette(random, difficulty = 'standard') {
  const weights = SILHOUETTE_CONFIG.profiles[difficulty]?.weights || SILHOUETTE_CONFIG.profiles.standard.weights;
  let value = random.next() * Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  for (const [name, weight] of Object.entries(weights)) {
    value -= weight;
    if (value < 0) return name;
  }
  return 'broadRing';
}

function splitInterval(start, end) {
  const width = end - start;
  if (width >= TAU) return [{ start: 0, end: TAU }];
  if (!(width > 0)) return [];
  const from = normalizeAngle(start), to = from + width;
  return to <= TAU ? [{ start: from, end: to }]
    : [{ start: from, end: TAU }, { start: 0, end: to - TAU }];
}

function subtractIntervals(intervals, cuts) {
  let result = intervals;
  for (const cut of cuts) {
    const next = [];
    for (const interval of result) {
      if (cut.end <= interval.start || cut.start >= interval.end) next.push(interval);
      else {
        if (cut.start > interval.start) next.push({ start: interval.start, end: cut.start });
        if (cut.end < interval.end) next.push({ start: cut.end, end: interval.end });
      }
    }
    result = next;
  }
  return result;
}

function sortedSegments(segments) {
  const sorted = segments.filter(segment => segment.end - segment.start > EPSILON).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const segment of sorted) {
    const previous = merged.at(-1);
    if (previous?.kind === segment.kind && Math.abs(previous.end - segment.start) <= EPSILON) previous.end = segment.end;
    else merged.push({ ...segment });
  }
  return merged;
}

function paintHazard(segments, interval) {
  const result = [];
  for (const segment of segments) {
    const start = Math.max(segment.start, interval.start), end = Math.min(segment.end, interval.end);
    if (end - start < EPSILON || segment.kind === 'hazard') { result.push(segment); continue; }
    if (segment.start < start) result.push({ kind: 'safe', start: segment.start, end: start });
    result.push({ kind: 'hazard', start, end });
    if (end < segment.end) result.push({ kind: 'safe', start: end, end: segment.end });
  }
  return sortedSegments(result);
}

function makePieces(widths, arrival, domain) {
  const pieces = [];
  for (let index = 0; index < widths.length; index++) {
    const width = widths[index];
    const occupied = pieces.map(piece => ({ start: piece.start - SILHOUETTE_CONFIG.pieceSeparation,
      end: piece.end + SILHOUETTE_CONFIG.pieceSeparation }));
    const slots = subtractIntervals([domain], occupied).filter(slot => slot.end - slot.start >= width - EPSILON);
    if (!slots.length) return null;
    // Anchor the first piece at the expected landing; distribute the remainder
    // across the available ring without clipping widths or overlapping arcs.
    const wanted = index === 0 ? arrival : normalizeAngle(arrival + index * TAU / widths.length);
    const choices = slots.flatMap(slot => {
      const centers = index === 0 ? [clamp(wanted, slot.start + width / 2, slot.end - width / 2)]
        : [slot.start + width / 2, slot.end - width / 2];
      return centers.map(center => ({ center, distance: Math.abs(center - wanted) }));
    }).sort((a, b) => a.distance - b.distance);
    const center = choices[0].center;
    pieces.push({ kind: 'safe', start: center - width / 2, end: center + width / 2 });
  }
  return sortedSegments(pieces);
}

function widthsFor(name, random) {
  switch (name) {
    case 'mediumCrescent': return [rad(random.range(168, 194))];
    case 'compactCrescent': return [rad(random.range(132, 154))];
    case 'third': return [rad(random.range(112, 124))];
    case 'quarter': return [rad(random.range(84, 96))];
    case 'twoCrescents': return [rad(random.range(92, 104)), rad(random.range(80, 94))];
    case 'pairedLedges': return [rad(random.range(46, 58)), rad(random.range(44, 54))];
    case 'threePiece': return [rad(59), rad(63), rad(56)];
    case 'fourPiece': return [rad(43), rad(47), rad(41), rad(45)];
    case 'smallIsland': return [rad(random.range(51, 65))];
    case 'tinyLedge': return [minimumSafeAngularWidth(random.range(...SILHOUETTE_CONFIG.tinyUsableDiameters))];
    case 'safeHazardIslands': return [rad(random.range(62, 78)), rad(random.range(29, 40))];
    case 'sparseObstacles': return [rad(random.range(47, 60)), rad(random.range(23, 31))];
    case 'mixedPieces': return [rad(random.range(54, 64)), rad(random.range(43, 53)), rad(random.range(25, 34))];
    default: return null;
  }
}

function intersect(a, b) { return a.start < b.end - EPSILON && b.start < a.end - EPSILON; }

function protectedLocalIntervals(platform, previousAngle, protectedIntervals) {
  const margin = minimumSafeAngularWidth() / 2;
  const intervals = [...protectedIntervals];
  if (Number.isFinite(previousAngle)) intervals.push({ start: previousAngle - margin, end: previousAngle + margin });
  return intervals.flatMap(interval => splitInterval(interval.start - platform.baseRotation, interval.end - platform.baseRotation));
}

/**
 * Keep the chosen route gap at zero. Context intervals use unwrapped world-route
 * angles. Their safe catch footprints cannot be consumed by any hazard paint.
 * The tower generator enforces level budgets, neighbours and shared-gap windows.
 */
export function applyPlatformSilhouette(platform, random, {
  difficulty = 'standard', previousAngle, protectedIntervals = [], recovery = false,
  requestedSilhouette, shoulderType, hazardIsland, allowReadableVariation = false, allowPlannedVariation = false,
  allowOrbitVariation = false, allowRecoveryVariation = false,
} = {}) {
  const profile = SILHOUETTE_CONFIG.profiles[difficulty] || SILHOUETTE_CONFIG.profiles.standard;
  const readableVariation = allowReadableVariation && ['opening', 'final'].includes(platform.route?.role);
  const plannedVariation = allowPlannedVariation && platform.route?.role === 'longDrop';
  const orbitVariation = allowOrbitVariation && platform.type === 'orbiting';
  const recoveryVariation = allowRecoveryVariation && platform.route?.role === 'recovery';
  const quietVariation = readableVariation || plannedVariation || orbitVariation || recoveryVariation;
  const locked = (platform.type !== 'static' && !orbitVariation) || recovery
    || (['recovery', 'smash'].includes(platform.route?.role) && !recoveryVariation)
    || (!plannedVariation && platform.route?.role === 'longDrop')
    || (!readableVariation && ['opening', 'final'].includes(platform.route?.role));
  let name = locked ? 'broadRing' : requestedSilhouette || chooseSilhouette(random, difficulty);
  if (readableVariation && !['broadRing', 'offsetRing', 'mediumCrescent', 'twoCrescents'].includes(name)) {
    name = random.pick(['broadRing', 'offsetRing', 'mediumCrescent', 'twoCrescents']);
  }
  if (plannedVariation && !['broadRing', 'offsetRing', 'mediumCrescent'].includes(name)) {
    name = random.pick(['offsetRing', 'mediumCrescent']);
  }
  if ((orbitVariation || recoveryVariation) && !['broadRing', 'offsetRing', 'twoCrescents', 'mediumCrescent'].includes(name)) {
    name = random.pick(orbitVariation ? ['offsetRing', 'twoCrescents'] : ['offsetRing', 'mediumCrescent', 'twoCrescents']);
  }
  if (!SILHOUETTE_NAMES.includes(name)) name = 'broadRing';
  const halfGap = platform.gapWidth / 2;
  const domain = { start: halfGap, end: TAU - halfGap };
  const protectedArcs = protectedLocalIntervals(platform, previousAngle, protectedIntervals);
  const incoming = Number.isFinite(previousAngle) ? normalizeAngle(previousAngle - platform.baseRotation) : Math.PI;
  const arrival = incoming > domain.start && incoming < domain.end ? incoming : Math.PI;
  const baseHazardWidth = platform.segments.filter(segment => segment.kind === 'hazard')
    .reduce((sum, segment) => sum + segment.end - segment.start, 0);
  let segments;
  if (locked || name === 'broadRing') {
    // Existing obstacles keep their exact authoritative topology and phase.
    segments = platform.segments.map(segment => ({ ...segment }));
  } else if (name === 'offsetRing') {
    const offsetWidth = rad(random.range(24, 38));
    const candidateCenters = [Math.PI, domain.start + .65, domain.end - .65];
    const center = candidateCenters.find(center => !protectedArcs.some(arc => intersect(arc,
      { start: center - offsetWidth / 2, end: center + offsetWidth / 2 })));
    if (center === undefined) { name = 'broadRing'; segments = platform.segments.map(segment => ({ ...segment })); }
    else segments = subtractIntervals([domain], [{ start: center - offsetWidth / 2, end: center + offsetWidth / 2 }])
      .map(arc => ({ kind: 'safe', ...arc }));
  } else {
    segments = makePieces(widthsFor(name, random), arrival, domain);
    if (!segments || !segments.some(segment => arcContains(arrival, segment.start, segment.end))) {
      name = 'broadRing'; segments = platform.segments.map(segment => ({ ...segment }));
    }
  }

  let shoulder = 'none';
  const tiny = name === 'tinyLedge';
  const islandShape = ['safeHazardIslands', 'sparseObstacles', 'mixedPieces'].includes(name);
  if (!locked) {
    // Repaint from physical pieces so all hazard placement obeys the same
    // incoming safe corridor. Tiny targets retain their entire measured width.
    segments = sortedSegments(segments.map(segment => ({ ...segment, kind: 'safe' })));
    const solidPieces = segments.map(segment => ({ ...segment }));
    if (!tiny) {
      let requested = quietVariation ? 'none' : shoulderType;
      if (!requested) requested = random.next() < profile.shoulderChance
        ? random.next() < profile.doubleShoulderChance ? 'double' : random.next() < .5 ? 'left' : 'right' : 'none';
      if (!['none', 'left', 'right', 'double'].includes(requested)) requested = 'none';
      const width = random.range(...(SILHOUETTE_CONFIG.shoulderWidth[difficulty] || SILHOUETTE_CONFIG.shoulderWidth.standard));
      const edge = {
        left: { start: domain.end - width, end: domain.end },
        right: { start: domain.start, end: domain.start + width },
      };
      const supported = side => segments.some(segment => segment.start <= edge[side].start + EPSILON && segment.end >= edge[side].end - EPSILON)
        && !protectedArcs.some(arc => intersect(arc, edge[side]));
      const left = (requested === 'left' || requested === 'double') && supported('left');
      const right = (requested === 'right' || requested === 'double') && supported('right');
      // Sparse pieces never receive two-sided precision pressure.
      if (left && right && !['broadRing', 'offsetRing'].includes(name)) requested = 'none';
      if (requested !== 'none') {
        if (left) segments = paintHazard(segments, edge.left);
        if (right) segments = paintHazard(segments, edge.right);
        shoulder = left && right ? 'double' : left ? 'left' : right ? 'right' : 'none';
      }
      if (islandShape || (hazardIsland && !quietVariation)) {
        // Select just one complete disconnected piece away from the intended
        // landing. It remains avoidable through the unchanged primary opening.
        const island = solidPieces.filter(segment => !protectedArcs.some(arc => intersect(arc, segment))
          && !arcContains(arrival, segment.start, segment.end))
          .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
        if (island) segments = paintHazard(segments, island);
      } else {
        const paintedWidth = segments.filter(segment => segment.kind === 'hazard').reduce((sum, segment) => sum + segment.end - segment.start, 0);
        const remaining = Math.max(0, baseHazardWidth - paintedWidth);
        const slots = subtractIntervals(segments.filter(segment => segment.kind === 'safe'), protectedArcs)
          .filter(slot => slot.end - slot.start >= Math.min(remaining, rad(12)) + EPSILON)
          .sort((a, b) => (b.end - b.start) - (a.end - a.start));
        const slot = slots[0];
        if (slot && remaining > rad(6)) {
          // Reserve safe ends, avoiding accidental entire-hazard islands and
          // leaving at least the physical tiny minimum on the landing piece.
          const width = Math.min(remaining, (slot.end - slot.start) * .6);
          const center = (slot.start + slot.end) / 2;
          segments = paintHazard(segments, { start: center - width / 2, end: center + width / 2 });
        }
      }
    }
  }
  platform.segments = sortedSegments(segments);
  platform.silhouette = platform.type === 'stinger' ? 'stinger' : name;
  // A complete island may itself meet an opening edge. Report that physical
  // shoulder too, including its cost, rather than trusting the proposal label.
  if (platform.type === 'static') shoulder = actualHazardShoulder(platform);
  platform.hazardShoulder = shoulder;
  platform.totalGapCoverage = TAU - platform.segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  platform.landingAngle = arrival;
  if ((locked || plannedVariation || !Number.isFinite(previousAngle))
    && !platform.segments.some(segment => segment.kind === 'safe' && arcContains(arrival, segment.start, segment.end))) {
    // Planned passes need no landing at their incoming angle. Their debug
    // footprint identifies an actual available safe catch instead of a hazard
    // or a gap masquerading as a measured landing target.
    const catchArc = platform.segments.filter(segment => segment.kind === 'safe')
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
    if (catchArc) platform.landingAngle = (catchArc.start + catchArc.end) / 2;
  }
  platform.silhouetteMetrics = getPlatformSilhouetteMetrics(platform);
  platform.difficultyCost = (SILHOUETTE_CONFIG.costs[name] || 0)
    + (shoulder === 'double' ? SILHOUETTE_CONFIG.costs.doubleShoulder : shoulder === 'none' ? 0 : SILHOUETTE_CONFIG.costs.shoulder)
    + platform.silhouetteMetrics.hazardIslands * SILHOUETTE_CONFIG.costs.hazardIsland
    + (SILHOUETTE_CONFIG.costs[platform.type] || 0);
  return platform;
}

function actualHazardShoulder(platform) {
  const half = platform.gapWidth / 2;
  const left = platform.segments.some(segment => segment.kind === 'hazard' && Math.abs(segment.end - (TAU - half)) < EPSILON);
  const right = platform.segments.some(segment => segment.kind === 'hazard' && Math.abs(segment.start - half) < EPSILON);
  return left && right ? 'double' : left ? 'left' : right ? 'right' : 'none';
}

export function getPlatformSilhouetteMetrics(platform) {
  const segments = platform.segments || [];
  let pieces = 0, hazardIslands = 0, componentHazard = true, previousEnd = -1;
  for (const segment of segments) {
    if (segment.start > previousEnd + EPSILON) {
      if (pieces && componentHazard) hazardIslands++;
      pieces++; componentHazard = true;
    }
    if (segment.kind === 'safe') componentHazard = false;
    previousEnd = segment.end;
  }
  if (pieces && componentHazard) hazardIslands++;
  const safe = segments.filter(segment => segment.kind === 'safe');
  const landing = safe.find(segment => arcContains(platform.landingAngle, segment.start, segment.end));
  const width = landing ? landing.end - landing.start : Number.isFinite(platform.landingAngle)
    ? 0 : Math.max(0, ...safe.map(segment => segment.end - segment.start));
  return {
    pieceCount: pieces, hazardIslands,
    safeCoverage: safe.reduce((sum, segment) => sum + segment.end - segment.start, 0),
    hazardCoverage: segments.filter(segment => segment.kind === 'hazard').reduce((sum, segment) => sum + segment.end - segment.start, 0),
    safeWidthBallDiameters: usableWidthInBallDiameters(width),
    validLandingTarget: Boolean(landing),
    tiny: platform.silhouette === 'tinyLedge',
    small: ['tinyLedge', 'smallIsland', 'pairedLedges', 'sparseObstacles'].includes(platform.silhouette),
  };
}

export function validatePlatformSilhouette(platform) {
  const errors = [];
  if (!Array.isArray(platform?.segments) || !platform.segments.length || platform.segments.length > 32) {
    return { valid: false, errors: ['Missing or excessive silhouette arcs'], metrics: {} };
  }
  let previousEnd = 0;
  for (const segment of platform.segments) {
    if (!segment || !['safe', 'hazard'].includes(segment.kind) || !Number.isFinite(segment.start + segment.end)
      || segment.start < -EPSILON || segment.end > TAU + EPSILON || segment.start >= segment.end
      || segment.start < previousEnd - EPSILON) errors.push('Invalid or overlapping silhouette arcs');
    previousEnd = segment?.end;
  }
  if (errors.length) return { valid: false, errors, metrics: {} };
  const metrics = getPlatformSilhouetteMetrics(platform);
  const topology = SHAPE_TOPOLOGY[platform.silhouette];
  if (platform.silhouette && !topology && platform.silhouette !== 'stinger') errors.push('Unknown platform silhouette');
  if (topology) {
    const [pieces, minDegrees, maxDegrees] = topology;
    const coverage = metrics.safeCoverage + metrics.hazardCoverage;
    if (metrics.pieceCount !== pieces) errors.push('Silhouette name disagrees with disconnected topology');
    if (minDegrees !== undefined && (coverage < rad(minDegrees) - EPSILON || coverage > rad(maxDegrees) + EPSILON)) {
      errors.push('Silhouette coverage lies outside its declared shape range');
    }
    if (platform.silhouette === 'broadRing' && Math.abs(coverage + platform.gapWidth - TAU) > EPSILON) {
      errors.push('Broad ring metadata conceals additional empty coverage');
    }
    if (platform.silhouette === 'tinyLedge' && metrics.safeWidthBallDiameters > SILHOUETTE_CONFIG.tinyUsableDiameters[1] + EPSILON) {
      errors.push('Tiny ledge exceeds its declared physical width range');
    }
  }
  if (metrics.pieceCount > SILHOUETTE_CONFIG.maximumPieces) errors.push('Too many disconnected pieces');
  if (metrics.safeCoverage <= 0 || metrics.safeCoverage + metrics.hazardCoverage >= TAU - EPSILON) errors.push('Missing safe target or avoidable opening');
  if (metrics.tiny && metrics.safeWidthBallDiameters < SILHOUETTE_CONFIG.tinyUsableDiameters[0] - EPSILON) errors.push('Tiny ledge is narrower than the physical landing minimum');
  if (Number.isFinite(platform.landingAngle) && !metrics.validLandingTarget) errors.push('Landing target is outside actual safe geometry');
  if (platform.type === 'static' && Number.isFinite(platform.landingAngle)
    && metrics.safeWidthBallDiameters < SILHOUETTE_CONFIG.tinyUsableDiameters[0] - EPSILON) errors.push('Safe landing target is narrower than the physical landing minimum');
  if (metrics.tiny && (platform.motion || platform.walls?.length || platform.hazardShoulder !== 'none' || metrics.hazardCoverage > EPSILON)) errors.push('Tiny ledge stacks excessive obstacle pressure');
  if (metrics.hazardIslands > 1) errors.push('Confusing cluster of hazard-only islands');
  if (['safeHazardIslands', 'sparseObstacles', 'mixedPieces'].includes(platform.silhouette)
    && metrics.hazardIslands !== 1) errors.push('Island silhouette is missing its complete hazard-only piece');
  if (platform.silhouette && platform.type === 'static' && platform.hazardShoulder !== actualHazardShoulder(platform)) {
    errors.push('Hazard shoulder metadata disagrees with actual opening edges');
  }
  if (platform.hazardShoulder && platform.hazardShoulder !== 'none') {
    if (!['left', 'right', 'double'].includes(platform.hazardShoulder)) errors.push('Unknown hazard shoulder type');
    const half = platform.gapWidth / 2;
    const left = platform.segments.some(segment => segment.kind === 'hazard' && Math.abs(segment.end - (TAU - half)) < EPSILON);
    const right = platform.segments.some(segment => segment.kind === 'hazard' && Math.abs(segment.start - half) < EPSILON);
    if ((platform.hazardShoulder === 'left' || platform.hazardShoulder === 'double') && !left) errors.push('Missing left shoulder beside actual gap');
    if ((platform.hazardShoulder === 'right' || platform.hazardShoulder === 'double') && !right) errors.push('Missing right shoulder beside actual gap');
    if (platform.gapWidth < minimumSafeAngularWidth() - EPSILON) errors.push('Shouldered opening is not physically passable');
    if (platform.hazardShoulder === 'double' && (metrics.small || !['broadRing', 'offsetRing'].includes(platform.silhouette))) errors.push('Double shoulder stacks with a demanding silhouette');
  }
  if (platform.silhouetteMetrics && ['pieceCount', 'hazardIslands', 'safeWidthBallDiameters'].some(key =>
    !Number.isFinite(platform.silhouetteMetrics[key]) || Math.abs(platform.silhouetteMetrics[key] - metrics[key]) > EPSILON)) errors.push('Silhouette metrics disagree with geometry');
  return { valid: errors.length === 0, errors, metrics };
}
