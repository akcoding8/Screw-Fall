import { CONFIG } from './config.js';
import { HAZARD_COLLISION, hazardEdgeInset } from './HazardCollision.js';
import { normalizeAngle, TAU } from './math.js';

export const BREATHING_VARIANTS = Object.freeze([
  'breathing-safe', 'breathing-single-tip', 'breathing-double-pincer',
]);

export const PINCER_CONFIG = Object.freeze({
  // Extra clearance on EACH side of the full horizontal ball diameter.
  // This is real open space; the forgiving hazard shoulder is not a substitute.
  steeringMargin: .10,
  tipWidth: 18 * Math.PI / 180,
  minTipWidth: 14 * Math.PI / 180,
  maxTipWidth: 22 * Math.PI / 180,
});

function requireDimensions(ballRadius, contactRadius, steeringMargin) {
  if (!(ballRadius > 0) || !(contactRadius > 0) || !(steeringMargin >= 0)
    || !Number.isFinite(ballRadius + contactRadius + steeringMargin)
    || ballRadius + steeringMargin >= contactRadius) {
    throw new RangeError('Pincer ball diameter and steering clearance must fit the contact circle');
  }
}

/** Exact chord conversion at the ball orbit, independent of camera perspective. */
export function minimumPincerOpening(ballRadius = CONFIG.physics.ballRadius,
  contactRadius = CONFIG.world.ballOrbitRadius, steeringMargin = PINCER_CONFIG.steeringMargin) {
  requireDimensions(ballRadius, contactRadius, steeringMargin);
  return 2 * Math.asin((ballRadius + steeringMargin) / contactRadius);
}

export function pincerTipCount(variant) {
  return variant === 'breathing-double-pincer' ? 2 : variant === 'breathing-single-tip' ? 1 : 0;
}

/**
 * Build-time/debug helper. Passing a target reuses it without allocations.
 * Fairness adds a narrow nonlethal shoulder, but that shoulder remains solid:
 * visualWorldWidth is the genuinely passable space between the moving tips.
 */
export function pincerOpeningMetrics(width, variant = 'breathing-double-pincer',
  tipWidth = PINCER_CONFIG.tipWidth, target = {}, ballRadius = CONFIG.physics.ballRadius,
  contactRadius = CONFIG.world.ballOrbitRadius, steeringMargin = PINCER_CONFIG.steeringMargin) {
  const minimumAngle = minimumPincerOpening(ballRadius, contactRadius, steeringMargin);
  const tips = pincerTipCount(variant);
  if (!Number.isFinite(width) || width <= 0 || width >= TAU
    || !Number.isFinite(tipWidth) || tipWidth <= 0) {
    throw new RangeError('Pincer opening and tip widths must be finite positive angles');
  }
  const inset = tips ? Math.min(hazardEdgeInset(ballRadius, contactRadius),
    tipWidth * HAZARD_COLLISION.maximumArcFraction) : 0;
  const effectiveAngle = width + tips * inset;
  target.visualAngle = width;
  target.effectiveAngle = effectiveAngle;
  target.visualWorldWidth = 2 * contactRadius * Math.sin(width / 2);
  target.effectiveWorldWidth = 2 * contactRadius * Math.sin(effectiveAngle / 2);
  target.visualBallDiameters = target.visualWorldWidth / (2 * ballRadius);
  target.effectiveBallDiameters = target.effectiveWorldWidth / (2 * ballRadius);
  target.minimumAngle = minimumAngle;
  target.minimumWorldWidth = 2 * ballRadius + 2 * steeringMargin;
  target.tipInset = inset;
  target.tipCount = tips;
  return target;
}

/**
 * The local opening straddles gapCenter. Looking from the axis into the opening,
 * its left shoulder is the negative-angle edge and its right is positive.
 * Tips occupy existing platform surface immediately beside that opening.
 */
export function createBreathingSegments(gapWidth, variant = 'breathing-safe',
  tipSide = 'left', tipWidth = PINCER_CONFIG.tipWidth, gapCenter = 0) {
  if (!BREATHING_VARIANTS.includes(variant)) throw new RangeError('Unknown breathing variant');
  if (variant === 'breathing-single-tip' && tipSide !== 'left' && tipSide !== 'right') {
    throw new RangeError('A single breathing tip needs a left or right side');
  }
  const left = variant === 'breathing-double-pincer' || (variant === 'breathing-single-tip' && tipSide === 'left');
  const right = variant === 'breathing-double-pincer' || (variant === 'breathing-single-tip' && tipSide === 'right');
  if (!Number.isFinite(gapWidth + tipWidth + gapCenter) || gapWidth <= 0 || tipWidth <= 0
    || gapWidth + (Number(left) + Number(right)) * tipWidth >= TAU) {
    throw new RangeError('Breathing opening and hazard tips must leave a positive safe shoulder');
  }
  const start = gapCenter + gapWidth / 2, end = gapCenter + TAU - gapWidth / 2;
  const segments = [];
  if (right) segments.push({ kind: 'hazard', start, end: start + tipWidth, tipSide: 'right' });
  segments.push({ kind: 'safe', start: start + (right ? tipWidth : 0), end: end - (left ? tipWidth : 0), breathingShoulder: true });
  if (left) segments.push({ kind: 'hazard', start: end - tipWidth, end, tipSide: 'left' });
  return segments;
}

/** Mutate the caller's existing collision OR render arc buffer, never both. */
export function sampleBreathingSegments(segments, motion, gapWidth) {
  const center = motion.gapCenter ?? 0;
  const start = center + gapWidth / 2, end = center + TAU - gapWidth / 2;
  const width = motion.tipWidth ?? PINCER_CONFIG.tipWidth;
  const left = motion.variant === 'breathing-double-pincer'
    || (motion.variant === 'breathing-single-tip' && motion.tipSide === 'left');
  const right = motion.variant === 'breathing-double-pincer'
    || (motion.variant === 'breathing-single-tip' && motion.tipSide === 'right');
  for (const segment of segments) {
    if (segment.tipSide === 'right') { segment.start = start; segment.end = start + width; }
    else if (segment.tipSide === 'left') { segment.start = end - width; segment.end = end; }
    else { segment.start = start + (right ? width : 0); segment.end = end - (left ? width : 0); }
  }
}

/** The same periodic phase drives rendering, exact contact, and validation. */
export function sampleBreathingPhase(motion, time, target) {
  target.phase = normalizeAngle(time * TAU / motion.period + motion.phase);
  const wave = (1 - Math.cos(target.phase)) / 2;
  target.gapWidth = motion.minWidth + (motion.maxWidth - motion.minWidth) * wave;
  return target;
}

function matchingSegments(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && expected.every((segment, index) => {
      const other = actual[index];
      return other && Number.isFinite(other.start + other.end)
        && other.kind === segment.kind && other.tipSide === segment.tipSide
        && other.breathingShoulder === segment.breathingShoulder
        && Math.abs(other.start - segment.start) <= 1e-9 && Math.abs(other.end - segment.end) <= 1e-9;
    });
}

/** Reject invalid authored tips before their reusable runtime buffers are built. */
export function validatePincerMotion(platform) {
  const errors = [], motion = platform.motion;
  if (motion?.type !== 'breathing') return errors;
  if (!BREATHING_VARIANTS.includes(motion.variant)) return ['unknown breathing variant'];
  if (motion.variant === 'breathing-single-tip' && !['left', 'right'].includes(motion.tipSide)) {
    errors.push('single hazard tip needs a deterministic left/right side');
  }
  const tips = pincerTipCount(motion.variant), width = motion.tipWidth ?? PINCER_CONFIG.tipWidth;
  if (!Number.isFinite(width) || width < PINCER_CONFIG.minTipWidth || width > PINCER_CONFIG.maxTipWidth) {
    errors.push('hazard tip width is outside readable limits');
  }
  if (!Number.isFinite(motion.minWidth) || motion.minWidth < minimumPincerOpening() - 1e-9) {
    errors.push('pincer opening is smaller than the ball plus steering clearance');
  }
  if (!Number.isFinite(motion.maxWidth) || motion.maxWidth <= motion.minWidth
    || motion.maxWidth + tips * width >= TAU) errors.push('pincer tips overlap or leave no safe shoulder');
  if (!Number.isFinite(platform.gapWidth) || platform.gapWidth <= 0 || platform.gapWidth + tips * width >= TAU
    || !Number.isFinite(motion.gapCenter ?? 0)) {
    errors.push('pincer geometry contains nonfinite angles');
    return errors;
  }
  if (errors.length) return errors;
  const expected = createBreathingSegments(platform.gapWidth, motion.variant, motion.tipSide, width, motion.gapCenter ?? 0);
  if (!matchingSegments(platform.segments, expected)) errors.push('pincer visual and collision tip schema disagree');
  // Runtime data is normally absent during generation. If a caller validates
  // a live/frozen platform, check its retained impact clock without mutating it.
  const state = platform.motionState;
  if (state) {
    if (!Number.isFinite(state.time) || state.time < 0 || !Number.isFinite(motion.period)
      || motion.period <= 0 || !Number.isFinite(motion.phase)) errors.push('pincer collision snapshot has an invalid clock');
    else {
      const phase = sampleBreathingPhase(motion, state.time, {});
      sampleBreathingSegments(expected, motion, phase.gapWidth);
      if (!Number.isFinite(state.phase + state.gapWidth + state.rotation)
        || Math.abs(state.phase - phase.phase) > 1e-9 || Math.abs(state.gapWidth - phase.gapWidth) > 1e-9
        || Math.abs(state.rotation - platform.baseRotation) > 1e-9 || !matchingSegments(state.segments, expected)) {
        errors.push('pincer collision snapshot is stale or disagrees with its impact phase');
      }
    }
  }
  return errors;
}
