import { MOTION_LIMITS, WALL_CONFIG } from './ObstacleConfig.js';

const radians = degrees => degrees * Math.PI / 180;

/** Geometry and content tuning only; approved ball, camera and debris tuning stays in CONFIG. */
export const GENERATION = Object.freeze({
  version: 4,
  normalVersion: 4,
  flowVersion: 2,
  britishMilestone: { version: 1, themeVersion: 1, platformCount: [45, 50] },
  maxAttempts: 4,
  maxSilhouetteAttempts: 8,
  normalCount: [42, 49],
  flowCount: [45, 50],
  openingCount: 5,
  finalCount: 4,
  maxConsecutiveSpecial: 2,
  maxSpecialDensity: 0.34,
  maxAnimatedConsecutive: 2,
  movingHazardMaximum: radians(60),
  readableHazardMultiplier: 0.65,
  maxRouteStep: radians(108),
  routeTurnSpeed: 3.2,
  routeMargin: radians(8),
  route: {
    directionDeadband: radians(6), maxSameDirectionRun: 3,
    minReversalRate: 0.35, maxReversalRate: 0.65,
    minDirectionBalance: 0.6, maxNetRotationRatio: 0.25,
    alignmentPhysicalMargin: 0.04, maxAccidentalThreeRatio: 0.03,
    maxPlannedDropRatio: 0.23,
    dropStarts: [8, 26], secondaryDropChance: { standard: 0.2, challenge: 0.55 },
    threeTurnPhraseChance: 0.18, dropCatchTurn: 1.8, dropRecoveryTurn: 0.3,
  },
  complexity: {
    sectionLength: 6, maxConsecutiveSmall: 2,
    costs: { largeReversal: 1, plannedDrop: 2, wallFocused: 1, adjacentAnimation: 1.5, additionalWall: 0.5, singleTip: 1.25, doublePincer: 2.5, increasedAmplitude: 0.5, narrowPincer: 0.5, fastPincer: 0.5 },
  },
  profiles: {
    gentle: { rating: [3, 4], gapWidth: [radians(88), radians(98)], hazardWidth: [radians(34), radians(52)], speed: [0.24, 0.336], stingerSpeed: [0.24, 0.336], routeStep: [radians(83), radians(95)], maxPlannedDrops: 1, levelBudget: 42, sectionBudget: 10, wallChance: 0.11, wallCount: [1, 1], wallFocusedCount: [1, 1], maxDividers: 1, animatedCount: [0, 2], breathingVariants: [.80, .19, .01], hazardousOrbitChance: .15, breathingPeriod: [2.7, 3.8] },
    standard: { rating: [5, 6], gapWidth: [radians(76), radians(88)], hazardWidth: [radians(56), radians(84)], speed: [0.30, 0.48], stingerSpeed: [0.30, 0.46], routeStep: [radians(86), radians(99)], maxPlannedDrops: 2, levelBudget: 85, sectionBudget: 16, wallChance: 0.74, wallCount: [2, 4], wallFocusedCount: [4, 5], maxDividers: 2, animatedCount: [3, 6], breathingVariants: [.32, .43, .25], hazardousOrbitChance: .72, breathingPeriod: [2.2, 3.3] },
    challenge: { rating: [7, 8], gapWidth: [radians(68), radians(80)], hazardWidth: [radians(76), radians(108)], speed: [0.42, 0.60], stingerSpeed: [0.42, 0.54], routeStep: [radians(91), radians(104)], maxPlannedDrops: 2, levelBudget: 116, sectionBudget: 20, wallChance: 0.96, wallCount: [3, 5], wallFocusedCount: [5, 6], maxDividers: 3, animatedCount: [5, 9], breathingVariants: [.17, .38, .45], hazardousOrbitChance: .84, breathingPeriod: [1.9, 2.9] },
  },
  breathing: { minWidth: MOTION_LIMITS.breathing.minWidth, maxWidth: MOTION_LIMITS.breathing.maxWidth,
    sourceMinWidth: radians(66), sourceMaxWidth: radians(112),
    narrowOffset: 0.25, wideOffset: 0.17, amplitudeMultiplier: 1.875, lowerExpansionShare: 0.6,
    narrowThreshold: radians(70), fastThreshold: 2.3,
    period: [MOTION_LIMITS.breathing.minPeriod, MOTION_LIMITS.breathing.maxPeriod] },
  distributionBounds: {
    wallLevelFraction: { gentle: [.15, .30], standard: [.70, .85], challenge: [.90, 1] },
    lowWallFraction: [.65, .75],
    breathingVariants: { gentle: [[.70, .85], [.15, .25], [0, .05]], standard: [[.25, .40], [.35, .50], [.20, .35]], challenge: [[.10, .25], [.30, .45], [.35, .50]] },
    hazardousAnimatedFraction: { gentle: [0, .40], standard: [.55, .85], challenge: [.65, .95] },
  },
  stinger: { safeWidth: [radians(28), radians(42)], flankWidth: [radians(18), radians(28)], maxPerStandard: 1, maxPerChallenge: 2 },
  wall: { ...WALL_CONFIG, clearance: 0.11, maxDividers: 2, dividerChance: 0.32, staticRecoveryCount: 2 },
  flow: { rotations: [1.65, 2.10], gapWidth: [radians(64), radians(82)], maxStep: radians(20), maxCurvature: radians(1.5), maxJerk: .01, maxTurnSpeed: 2.75,
    openingCount: [5, 7], openingRateRatio: .52, openingMaxTurnSpeed: 2.15, routeWaveAmplitude: .06,
    human: { trials: 10, minimumSuccessRate: .8, maxFailureSectionRatio: .4, reactionDelay: [.10, .16], viewportSpeed: .75, viewportAcceleration: 5, trackingGain: 10, aimError: radians(3), aimBias: radians(1.5), steeringMargin: .035, moderateReactionDelay: [.18, .24], moderateViewportSpeed: .55, moderateViewportAcceleration: 3, moderateAimError: radians(5), moderateAimBias: radians(2.5) } },
});

/** Extra costs above the existing 2.5-point breathing mechanic. */
export function breathingBudgetSurcharge(motion) {
  if (motion?.type !== 'breathing') return 0;
  const costs = GENERATION.complexity.costs;
  const hazardous = motion.variant !== 'breathing-safe';
  return costs.increasedAmplitude
    + (motion.variant === 'breathing-double-pincer' ? costs.doublePincer : motion.variant === 'breathing-single-tip' ? costs.singleTip : 0)
    + (hazardous && motion.minWidth < GENERATION.breathing.narrowThreshold ? costs.narrowPincer : 0)
    + (hazardous && motion.period < GENERATION.breathing.fastThreshold ? costs.fastPincer : 0);
}
