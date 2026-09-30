import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync } from 'node:fs';
import { generateLevel, NORMAL_GENERATOR_VERSION, FLOW_GENERATOR_VERSION } from '../src/game/LevelGenerator.js';
import { validateLevel } from '../src/game/LevelValidator.js';
import { analyzeRoute, analyzeGapAlignment } from '../src/game/RouteAnalysis.js';
import { getPlatformSilhouetteMetrics } from '../src/game/PlatformSilhouettes.js';
import { TAU } from '../src/game/math.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { CONFIG } from '../src/game/config.js';
import { BRITISH_MILESTONE_KIND, BRITISH_MILESTONE_GENERATOR_VERSION } from '../src/game/BritishMilestone.js';
import { createHash } from 'node:crypto';

const numbers = [...Array.from({ length: 5000 }, (_, i) => i + 1),
  ...Array.from({ length: 1000 }, (_, i) => i + 100001),
  1000000001, 9999999999, 2 ** 32, 2 ** 40, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER];
const groups = {};
const failures = [];
const attempts = {};
const flowAttempts = {};
let flowGenerationTimeMs = 0;
let generationTimeMs = 0;
let validationTimeMs = 0;
let fallbackCount = 0;
const counter = (object, key, count = 1) => { object[key] = (object[key] || 0) + count; };
const makeGroup = () => ({ levels: 0, platforms: 0, runs: [], reversals: [], balances: [], netRatios: [],
  wallLevels: 0, lowWalls: 0, tallDividers: 0, wallsPerLevel: [], wallsWhenPresent: [], lowWallsPerLevel: [], tallDividersPerLevel: [], wallCountDistribution: {}, wallFocusedLevels: 0,
  proposedWalls: 0, rejectedWalls: 0, wallRejectionReasons: {}, placementPlanAttempts: [],
  animatedLevels: 0, animatedPerLevel: [], animatedCountDistribution: {}, dynamicTypes: { breathing: 0, orbiting: 0, stinger: 0 },
  breathingSpans: [], breathingMinimums: [], breathingMaximums: [], breathingPeriods: [], orbitingSpeeds: [], stingerSpeeds: [],
  maximumConsecutiveAnimations: 0, staticPlatforms: 0, safeAnimated: 0, hazardousAnimated: 0, animatedHazardsByType: {},
  breathingVariants: { 'breathing-safe': 0, 'breathing-single-tip': 0, 'breathing-double-pincer': 0 }, tipSides: {}, minimumOpeningWorld: [], minimumOpeningBallDiameters: [], pincerCosts: [],
  flowCounts: [], flowRotations: [], flowMaxRates: [], flowCurvatures: [], flowJerks: [], flowSuccessRates: [], flowModerateSuccessRates: [], flowWorstSectionFailures: [], flowIdealSuccesses: 0, flowTrialSuccesses: 0, flowTrialCount: 0,
  accidentalThreeWindows: 0, accidentalFourFiveWindows: 0, repeatedThreeWindows: 0,
  totalSafeAngle: 0, totalHazardAngle: 0, plannedDropCounts: {}, plannedDropLengths: {}, silhouettes: {}, shoulderTypes: {}, tinyLedges: 0,
  smallLedges: 0, hazardIslands: 0, hazardCoverage: [], solidHazardFraction: [], budgetUsage: [], fallbackCount: 0 });
function record(group, level, route, gaps) {
  group.levels++;
  group.platforms += level.platformCount;
  group.fallbackCount += level.fallback ? 1 : 0;
  let wallCount = 0, lowCount = 0, tallCount = 0, animatedCount = 0, animatedRun = 0;
  const placement = level.obstaclePlacement;
  if (placement) {
    group.proposedWalls += placement.proposedWalls; group.rejectedWalls += placement.rejectedWalls;
    group.placementPlanAttempts.push(placement.planAttempts);
    for (const [reason, count] of Object.entries(placement.wallRejectionReasons)) counter(group.wallRejectionReasons, reason, count);
  }
  for (const platform of level.platforms) {
    if (platform.finish) continue;
    group.staticPlatforms += platform.type === 'static' ? 1 : 0;
    for (const wall of platform.walls) {
      wallCount++;
      if (wall.type === 'low') lowCount++; else tallCount++;
      group[wall.type === 'low' ? 'lowWalls' : 'tallDividers']++;
    }
    animatedRun = platform.motion ? animatedRun + 1 : 0;
    group.maximumConsecutiveAnimations = Math.max(group.maximumConsecutiveAnimations, animatedRun);
    if (platform.motion) {
      const motion = platform.motion;
      animatedCount++;
      group.dynamicTypes[motion.type]++;
      const hazardous = platform.segments.some(segment => segment.kind === 'hazard');
      group[hazardous ? 'hazardousAnimated' : 'safeAnimated']++;
      const typeHazards = group.animatedHazardsByType[motion.type] ||= { safe: 0, hazardous: 0 };
      typeHazards[hazardous ? 'hazardous' : 'safe']++;
      if (motion.type === 'breathing') {
        counter(group.breathingVariants, motion.variant || 'legacy-breathing');
        if (motion.variant === 'breathing-single-tip') counter(group.tipSides, motion.tipSide);
        const worldOpening = 2 * CONFIG.world.ballOrbitRadius * Math.sin(motion.minWidth / 2);
        group.minimumOpeningWorld.push(worldOpening);
        group.minimumOpeningBallDiameters.push(worldOpening / (2 * CONFIG.physics.ballRadius));
        group.pincerCosts.push(platform.pincerCost ?? motion.budgetCost ?? 0);
        group.breathingSpans.push(motion.maxWidth - motion.minWidth);
        group.breathingMinimums.push(motion.minWidth);
        group.breathingMaximums.push(motion.maxWidth);
        group.breathingPeriods.push(motion.period);
      } else group[motion.type === 'orbiting' ? 'orbitingSpeeds' : 'stingerSpeeds'].push(Math.abs(motion.speed));
    }
  }
  group.wallLevels += wallCount ? 1 : 0;
  group.animatedLevels += animatedCount ? 1 : 0;
  group.wallFocusedLevels += level.wallFocused ? 1 : 0;
  group.wallsPerLevel.push(wallCount);
  if (wallCount) group.wallsWhenPresent.push(wallCount);
  group.lowWallsPerLevel.push(lowCount); group.tallDividersPerLevel.push(tallCount);
  group.animatedPerLevel.push(animatedCount);
  counter(group.wallCountDistribution, wallCount);
  counter(group.animatedCountDistribution, animatedCount);
  if (level.kind === 'flow') {
    recordFlow(group, level);
    return;
  }
  group.runs.push(route.longestSameDirectionRun);
  group.reversals.push(route.reversalRate);
  group.balances.push(route.directionBalance);
  group.netRatios.push(route.netRotationRatio);
  group.accidentalThreeWindows += gaps.accidentalThreeCount;
  group.accidentalFourFiveWindows += gaps.hardViolationCount;
  group.repeatedThreeWindows += gaps.repeatedThreeWindows;
  counter(group.plannedDropCounts, level.plannedDrops.length);
  for (const drop of level.plannedDrops) counter(group.plannedDropLengths, drop.passes);
  group.budgetUsage.push(level.difficultyBudget.used);
  for (const platform of level.platforms) {
    if (platform.finish) continue;
    const metrics = getPlatformSilhouetteMetrics(platform);
    counter(group.silhouettes, platform.silhouette);
    counter(group.shoulderTypes, platform.hazardShoulder);
    group.tinyLedges += metrics.tiny ? 1 : 0;
    group.smallLedges += metrics.small ? 1 : 0;
    group.hazardIslands += metrics.hazardIslands;
    group.hazardCoverage.push(metrics.hazardCoverage / TAU);
    group.solidHazardFraction.push(metrics.hazardCoverage / (metrics.safeCoverage + metrics.hazardCoverage));
    group.totalSafeAngle += metrics.safeCoverage;
    group.totalHazardAngle += metrics.hazardCoverage;
  }
}
// Flow certificates are produced and independently checked during generation/validation.
function recordFlow(group, level) {
  group.flowCounts.push(level.platformCount);
  group.flowRotations.push(level.flow.rotations);
  const sectionTime = CONFIG.world.platformSpacing / CONFIG.physics.maxDownwardSpeed;
  const steps = level.route.slice(1).map((point, index) => point.angle - level.route[index].angle);
  const curves = steps.slice(1).map((step, index) => step - steps[index]);
  const jerks = curves.slice(1).map((curve, index) => curve - curves[index]);
  group.flowMaxRates.push(Math.max(...steps.map(Math.abs)) / sectionTime);
  group.flowCurvatures.push(Math.max(...curves.map(Math.abs)));
  group.flowJerks.push(Math.max(...jerks.map(Math.abs)));
  // Filled by the shared feasibility report below once its certificate is present.
  const feasibility = level.flow.feasibility;
  if (feasibility) recordFlowFeasibility(group, feasibility);
}
function recordFlowFeasibility(group, feasibility) {
  const skilled = feasibility.skilled;
  if (skilled) {
    group.flowSuccessRates.push(skilled.successRate);
    group.flowTrialSuccesses += skilled.successes; group.flowTrialCount += skilled.trials;
    group.flowWorstSectionFailures.push(skilled.worstSectionFailures);
  }
  if (feasibility.moderate) group.flowModerateSuccessRates.push(feasibility.moderate.successRate);
  group.flowIdealSuccesses += Number(feasibility.ideal?.success);
}
const started = performance.now();
for (const number of numbers) {
  try {
    const generatedAt = performance.now();
    const level = generateLevel(number);
    const generatedMs = performance.now() - generatedAt;
    generationTimeMs += generatedMs;
    if (level.kind === 'flow') { flowGenerationTimeMs += generatedMs; counter(flowAttempts, level.generationAttempt); }
    fallbackCount += level.fallback ? 1 : 0;
    counter(attempts, level.generationAttempt);
    const checkedAt = performance.now();
    const validation = validateLevel(level);
    const route = level.kind !== 'flow' ? analyzeRoute(level) : null;
    const gaps = level.kind !== 'flow' ? analyzeGapAlignment(level) : null;
    validationTimeMs += performance.now() - checkedAt;
    if (!validation.valid) failures.push({ levelNumber: number, errors: validation.errors });
    // Milestones get their own group so the unchanged ordinary Challenge
    // population remains directly comparable with earlier analysis reports.
    for (const key of ['all', `kind:${level.kind}`, `difficulty:${level.kind === BRITISH_MILESTONE_KIND ? BRITISH_MILESTONE_KIND : level.difficulty}`, `archetype:${level.archetype}`]) {
      groups[key] ||= makeGroup();
      record(groups[key], level, route, gaps);
    }
  } catch (error) { failures.push({ levelNumber: number, errors: [error.message] }); }
}
function distribution(values) {
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  const quantile = proportion => values[Math.round((values.length - 1) * proportion)];
  return { min: values[0], p10: quantile(.1), median: quantile(.5), p90: quantile(.9), max: values.at(-1),
    average: values.reduce((sum, value) => sum + value, 0) / values.length };
}
for (const group of Object.values(groups)) {
  for (const key of ['runs', 'reversals', 'balances', 'netRatios', 'hazardCoverage', 'solidHazardFraction', 'budgetUsage',
    'wallsPerLevel', 'wallsWhenPresent', 'lowWallsPerLevel', 'tallDividersPerLevel', 'placementPlanAttempts', 'minimumOpeningWorld', 'minimumOpeningBallDiameters', 'pincerCosts',
    'flowCounts', 'flowRotations', 'flowMaxRates', 'flowCurvatures', 'flowJerks', 'flowSuccessRates', 'flowModerateSuccessRates', 'flowWorstSectionFailures', 'animatedPerLevel', 'breathingSpans', 'breathingMinimums', 'breathingMaximums', 'breathingPeriods', 'orbitingSpeeds', 'stingerSpeeds']) group[key] = distribution(group[key]);
  group.wallLevelPercent = 100 * group.wallLevels / group.levels;
  group.hazardousAnimatedPercent = 100 * group.hazardousAnimated / (group.safeAnimated + group.hazardousAnimated) || 0;
  const breathers = group.dynamicTypes.breathing;
  group.breathingVariantPercentages = Object.fromEntries(Object.entries(group.breathingVariants).map(([variant, count]) => [variant, 100 * count / breathers || 0]));
  group.animatedLevelPercent = 100 * group.animatedLevels / group.levels;
  group.lowWallPercent = 100 * group.lowWalls / (group.lowWalls + group.tallDividers) || 0;
  group.staticPlatformPercent = 100 * group.staticPlatforms / group.platforms;
  group.aggregateSolidHazardFraction = group.totalHazardAngle / (group.totalSafeAngle + group.totalHazardAngle) || 0;
  group.silhouettePercentages = Object.fromEntries(Object.entries(group.silhouettes).map(([key, count]) => [key, 100 * count / Object.values(group.silhouettes).reduce((sum, value) => sum + value, 0)]));
  group.shoulderPercentages = Object.fromEntries(Object.entries(group.shoulderTypes).map(([key, count]) => [key, 100 * count / Object.values(group.shoulderTypes).reduce((sum, value) => sum + value, 0)]));
}
const baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/phase2-baseline.json', import.meta.url), 'utf8'));
const baselineComparisons = baseline.samples.filter(sample => [64, 69, 71].includes(sample.level.levelNumber)).map(({ level: before }) => {
  const after = generateLevel(before.levelNumber);
  const summary = level => ({ platformCount: level.platformCount, generatorVersion: level.generatorVersion,
    route: analyzeRoute(level), alignment: analyzeGapAlignment(level), plannedDrops: level.plannedDrops || level.smashOpportunities,
    silhouettes: level.platforms.filter(platform => !platform.finish).reduce((counts, platform) => {
      counter(counts, platform.silhouette || 'broadRing'); return counts;
    }, {}) });
  return { levelNumber: before.levelNumber, before: summary(before), after: summary(after) };
});
const phase21ObstacleBaseline = JSON.parse(readFileSync(new URL('../artifacts/phase21-obstacle-baseline.json', import.meta.url), 'utf8'));
const validationCategories = { antiScrew: /direction|rotation|reversal|screw/i, longAlignment: /common-gap|three-platform|planned-drop/i,
  wallConfiguration: /wall|divider/i, pincerGeometry: /pincer|tip|breathing/i, flowFeasibility: /flow|controller|curvature|jerk/i, difficultyBudget: /complexity|budget/i, nonFinite: /finite|NaN/i };
const violations = Object.fromEntries(Object.entries(validationCategories).map(([name, pattern]) =>
  [name, failures.filter(failure => failure.errors.some(error => pattern.test(error))).length]));
violations.flowWithWalls = groups['difficulty:flow']?.wallLevels || 0;
violations.flowWithAnimation = groups['difficulty:flow']?.animatedLevels || 0;
const phase22Baseline = JSON.parse(readFileSync(new URL('../artifacts/phase22-before-23-baseline.json', import.meta.url), 'utf8'));
const distributionFailures = [];
const bounds = GENERATION.distributionBounds;
if (bounds) {
  const check = (name, value, range) => { if (!Number.isFinite(value) || value < range[0] || value > range[1]) distributionFailures.push({ name, value, range }); };
  for (const difficulty of ['gentle', 'standard', 'challenge']) {
    const group = groups[`difficulty:${difficulty}`];
    check(`${difficulty} wall-containing fraction`, group.wallLevelPercent / 100, bounds.wallLevelFraction[difficulty]);
    check(`${difficulty} hazardous animated fraction`, group.hazardousAnimatedPercent / 100, bounds.hazardousAnimatedFraction[difficulty]);
    const variants = bounds.breathingVariants[difficulty];
    for (const [i, key] of ['breathing-safe', 'breathing-single-tip', 'breathing-double-pincer'].entries()) {
      const range = Array.isArray(variants) ? variants[i] : variants[key] || variants[['safe', 'single', 'double'][i]];
      if (range) check(`${difficulty} ${key} fraction`, group.breathingVariantPercentages[key] / 100, range);
    }
  }
  check('all normal low wall fraction', groups['kind:normal'].lowWallPercent / 100, bounds.lowWallFraction);
}
const phase22PlacementBaseline = JSON.parse(readFileSync(new URL('../artifacts/phase22-before-23-placement.json', import.meta.url), 'utf8'));
const phase4Baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/phase4-baseline.json', import.meta.url), 'utf8'));
const unchangedRepresentativeLevels = phase4Baseline.levels.filter(level => level.number % 100 !== 0).map(sample => ({
  levelNumber: sample.number, kind: sample.kind, matches: createHash('sha256').update(JSON.stringify(generateLevel(sample.number))).digest('hex') === sample.hash,
}));
for (const sample of unchangedRepresentativeLevels) if (!sample.matches) failures.push({ levelNumber: sample.levelNumber, errors: ['Non-milestone geometry changed from Phase 4 baseline'] });
const result = { phase22PlacementBaseline, phase22Baseline, distributionFailures, phase21ObstacleBaseline, baselineComparisons, unchangedRepresentativeLevels,
  versions: { normal: NORMAL_GENERATOR_VERSION, flow: FLOW_GENERATOR_VERSION, britishMilestone: BRITISH_MILESTONE_GENERATOR_VERSION },
  sample: { levels: numbers.length, ranges: [[1, 5000], [100001, 101000]], veryLarge: numbers.slice(-6) },
  flowGenerationTimeMs, flowAttempts, generationTimeMs, validationTimeMs, totalTimeMs: performance.now() - started,
  fallbackCount, attempts, validationFailures: failures.length, failures, violations, groups };
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0 && process.argv[outputIndex + 1]) writeFileSync(process.argv[outputIndex + 1], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (distributionFailures.length || failures.length || groups.all.accidentalFourFiveWindows || groups.all.repeatedThreeWindows
  || groups.all.runs.max > 3 || Object.values(violations).some(Boolean)) process.exitCode = 1;
