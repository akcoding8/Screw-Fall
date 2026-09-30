import { CONFIG } from './config.js';
import { arcContains, normalizeAngle, TAU } from './math.js';

/** A small physical edge allowance; it never changes the visible platform. */
export const HAZARD_COLLISION = Object.freeze({
  ballRadiusFraction: 0.08,
  physicalMargin: 0.012,
  maximumArcFraction: 0.2,
});

export function hazardEdgeInset(ballRadius = CONFIG.physics.ballRadius, contactRadius = CONFIG.world.ballOrbitRadius) {
  if (!(ballRadius > 0) || !(contactRadius > 0) || !Number.isFinite(ballRadius + contactRadius)) return 0;
  const width = ballRadius * HAZARD_COLLISION.ballRadiusFraction + HAZARD_COLLISION.physicalMargin;
  // The chord between the visual and effective boundary measures the allowance
  // at the ball's actual orbit, rather than at the much larger outer rim.
  return 2 * Math.asin(Math.min(1, width / (2 * contactRadius)));
}

export const HAZARD_EDGE_INSET = hazardEdgeInset();

function arcWidth(segment) {
  return Math.abs(segment.end - segment.start) >= TAU ? TAU : normalizeAngle(segment.end - segment.start);
}

/** Debug/build-time helper. The hot collision loop below allocates no objects. */
export function effectiveHazardArc(segment) {
  const width = arcWidth(segment);
  const inset = width >= TAU ? 0 : Math.min(HAZARD_EDGE_INSET, width * HAZARD_COLLISION.maximumArcFraction);
  return { start: segment.start + inset, end: segment.start + width - inset, inset };
}

/** An inset edge is still solid: a near miss bounces instead of falling through it. */
export function classifySegmentsAtAngle(segments, angle) {
  for (const segment of segments) {
    if (!arcContains(angle, segment.start, segment.end)) continue;
    if (segment.kind !== 'hazard') return segment.kind;
    const width = arcWidth(segment);
    if (width >= TAU) return 'hazard';
    const inset = Math.min(HAZARD_EDGE_INSET, width * HAZARD_COLLISION.maximumArcFraction);
    const fromStart = normalizeAngle(angle - segment.start);
    return fromStart >= inset && fromStart < width - inset ? 'hazard' : 'safe';
  }
  return 'gap';
}
