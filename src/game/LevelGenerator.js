import { CONFIG } from './config.js';
import { GENERATION, breathingBudgetSurcharge } from './GenerationConfig.js';
import { cadenceForLevel } from './LevelCadence.js';
import { generateFlowLevel } from './FlowLevelGenerator.js';
import { finishLevel, makePlatform, ringSegments } from './LevelGeometry.js';
import { validateLevel } from './LevelValidator.js';
import { deriveSeed, SeededRandom } from './SeededRandom.js';
import { normalizeAngle, TAU } from './math.js';
import { analyzeGapAlignment, analyzeRoute, signedRouteDelta } from './RouteAnalysis.js';
import { applyPlatformSilhouette, SILHOUETTE_CONFIG, validatePlatformSilhouette } from './PlatformSilhouettes.js';
import { createBreathingSegments } from './PincerGeometry.js';
import { BRITISH_MILESTONE_KIND, BRITISH_MILESTONE_GENERATOR_VERSION, britishGeometrySeed, britishMilestoneMetadata } from './BritishMilestone.js';

export const NORMAL_GENERATOR_VERSION = GENERATION.normalVersion;
export const FLOW_GENERATOR_VERSION = GENERATION.flowVersion;
export { BRITISH_MILESTONE_GENERATOR_VERSION } from './BritishMilestone.js';
// Legacy import denotes the current normal generator; Flow selects its own version.
export const GENERATOR_VERSION = NORMAL_GENERATOR_VERSION;

function routeForNormal(count, random, cadence) {
  const profile = GENERATION.profiles[cadence.difficulty];
  const starts = [GENERATION.route.dropStarts[0]];
  if ((cadence.difficulty === 'challenge' && !cadence.wallFocused && cadence.requestedWalls < 4 && random.next() < GENERATION.route.secondaryDropChance.challenge) || (cadence.difficulty === 'standard'
    && (cadence.archetype === 'Long-Drop Opportunities' || random.next() < GENERATION.route.secondaryDropChance.standard))) starts.push(GENERATION.route.dropStarts[1]);
  const opportunities = starts.map((start, index) => {
    const passes = index === 0 ? 3 : random.integer(3, 5);
    return { id: `drop-${index + 1}`, start, passes, catchIndex: start + passes, recoveryIndex: start + passes + 1 };
  });
  const route = [{ angle: 0, role: 'opening' }];
  let direction = random.next() < 0.5 ? -1 : 1;
  let run = 0;
  let targetRun = 2;
  for (let index = 1; index < count; index += 1) {
    const drop = opportunities.find(item => index >= item.start && index <= item.recoveryIndex);
    let delta;
    let role = index < GENERATION.openingCount ? 'opening' : index >= count - GENERATION.finalCount ? 'final' : 'turn';
    if (drop && index > drop.start && index < drop.catchIndex) {
      delta = 0;
      role = 'longDrop';
    } else if (drop && index === drop.catchIndex) {
      direction *= -1;
      run = 1;
      delta = direction * GENERATION.route.dropCatchTurn;
      role = 'smash';
    } else if (drop && index === drop.recoveryIndex) {
      delta = direction * GENERATION.route.dropRecoveryTurn;
      run += 1;
      targetRun = run;
      role = 'recovery';
    } else {
      if (run >= targetRun) {
        direction *= -1;
        run = 0;
        // A paired rhythm with occasional three-step phrases avoids random
        // per-platform zigzags while keeping genuine decisions every 1–3 turns.
        targetRun = random.next() < GENERATION.route.threeTurnPhraseChance ? 3 : 2;
      }
      delta = direction * random.range(...profile.routeStep);
      run += 1;
      if (drop) role = 'longDrop';
    }
    route.push({ angle: route.at(-1).angle + delta, role,
      ...(drop && index < drop.catchIndex ? { plannedDropId: drop.id } : {}) });
    if (drop && index === drop.start) drop.angle = route.at(-1).angle;
  }
  return { route, opportunities };
}

function addMotion(platform, type, profile, random, descriptor = {}) {
  platform.type = type;
  if (type === 'breathing' || type === 'orbiting') {
    const width = platform.segments.filter(segment => segment.kind === 'hazard').reduce((sum, segment) => sum + segment.end - segment.start, 0);
    platform.segments = ringSegments(platform.gapWidth, Math.min(width, GENERATION.movingHazardMaximum));
  }
  if (type === 'breathing') {
    const tuning = GENERATION.breathing;
    const oldMinimum = Math.max(tuning.sourceMinWidth, platform.gapWidth - tuning.narrowOffset);
    const oldMaximum = Math.min(tuning.sourceMaxWidth, platform.gapWidth + tuning.wideOffset);
    const span = (oldMaximum - oldMinimum) * tuning.amplitudeMultiplier;
    const expansion = span - (oldMaximum - oldMinimum);
    const minWidth = Math.max(tuning.minWidth, Math.min(oldMinimum - expansion * tuning.lowerExpansionShare, tuning.maxWidth - span));
    const maxWidth = minWidth + span;
    const variant = descriptor.variant || 'breathing-safe';
    let period = random.range(...profile.breathingPeriod);
    // A narrow double opening keeps the slower part of its profile cycle.
    if (variant === 'breathing-double-pincer' && minWidth < tuning.narrowThreshold) period = Math.max(period, tuning.fastThreshold);
    platform.motion = { type, variant, tipSide: descriptor.tipSide || 'left', tipWidth: 18 * Math.PI / 180, minWidth, maxWidth, period, phase: random.range(0, TAU) };
    platform.segments = createBreathingSegments(platform.gapWidth, variant, platform.motion.tipSide, platform.motion.tipWidth);
    platform.motion.budgetCost = SILHOUETTE_CONFIG.costs.breathing + breathingBudgetSurcharge(platform.motion);
    platform.route.halfWidth = minWidth / 2;
  } else if (type === 'orbiting' || type === 'stinger') {
    const speedRange = type === 'stinger' ? profile.stingerSpeed : profile.speed;
    // The fastest orbit needs a wider opening; narrow Challenge gaps keep
    // their deliberate timing while movement remains easy to perceive.
    const maximumSpeed = type === 'orbiting' && platform.gapWidth < 74 * Math.PI / 180
      ? Math.min(speedRange[1], 0.50) : speedRange[1];
    platform.motion = { type, speed: random.range(speedRange[0], maximumSpeed) * (random.next() < 0.5 ? -1 : 1), phase: 0 };
    if (type === 'orbiting' && !descriptor.hazardous) platform.segments = ringSegments(platform.gapWidth);
    if (type === 'stinger') {
      const safeWidth = random.range(...GENERATION.stinger.safeWidth);
      if (safeWidth < 34 * Math.PI / 180) platform.motion.speed = Math.sign(platform.motion.speed) * Math.min(Math.abs(platform.motion.speed), 0.46);
      const flankWidth = random.range(...GENERATION.stinger.flankWidth);
      platform.segments = [
        { kind: 'hazard', start: Math.PI - safeWidth / 2 - flankWidth, end: Math.PI - safeWidth / 2 },
        { kind: 'safe', start: Math.PI - safeWidth / 2, end: Math.PI + safeWidth / 2 },
        { kind: 'hazard', start: Math.PI + safeWidth / 2, end: Math.PI + safeWidth / 2 + flankWidth },
      ];
      platform.gapWidth = TAU - safeWidth - 2 * flankWidth;
      platform.route.halfWidth = platform.gapWidth / 2;
    }
  } else {
    platform.walls = [{ type: type === 'lowWall' ? 'low' : 'divider', angle: 1.95,
      height: type === 'lowWall' ? GENERATION.wall.lowHeight : GENERATION.wall.dividerHeight,
      width: GENERATION.wall.width, innerRadius: CONFIG.world.innerRadius + 0.04, outerRadius: CONFIG.world.outerRadius - 0.04 }];
  }
}

/** Each proposed hazard keeps an ordinary catch and a protected arrival.
 * A safe animation can share that arrival; a new moving hazard cannot. */
function obstacleSlots(platforms, wallCount, descriptors, random, diagnostics) {
  const end = platforms.length - GENERATION.finalCount;
  const priorities = platforms.map(() => random.next());
  const failed = new Set();
  const solve = (index, walls, animation, protectedArrival = false) => {
    if (!walls && animation === descriptors.length) return [];
    if (index >= end || end - index < walls * 3 + (descriptors.length - animation) * 2) return null;
    const key = `${index}:${walls}:${animation}:${Number(protectedArrival)}`;
    if (failed.has(key)) return null;
    const ordinary = offset => platforms[index + offset]?.route.role === 'turn';
    const choices = priorities[index] < .40 ? ['skip', 'wall', 'motion'] : ['wall', 'motion', 'skip'];
    if (priorities[index] > .72) choices.splice(0, 2, 'motion', 'wall');
    for (const choice of choices) {
      if (choice === 'skip') {
        const rest = solve(index + 1, walls, animation, false);
        if (rest) return rest;
      } else {
        const wall = choice === 'wall';
        const descriptor = descriptors[animation];
        if (!(wall ? walls : descriptor) || !ordinary(0) || !ordinary(1) || (wall && !ordinary(2))) continue;
        if (!wall && protectedArrival && descriptor.hazardous) continue;
        if (!wall && descriptor.variant === 'breathing-double-pincer' && index < GENERATION.openingCount + 2) continue;
        const rest = solve(index + (wall ? 3 : 2), walls - Number(wall), animation + Number(!wall), !wall);
        if (rest) return [{ index, wall, ...(!wall ? { descriptor } : {}) }, ...rest];
      }
    }
    failed.add(key);
    return null;
  };
  diagnostics.planAttempts += 1;
  return solve(GENERATION.openingCount, wallCount, 0);
}

function proposeWallCount(cadence, profile, random) {
  const themed = cadence.wallFocused || cadence.permittedTypes.some(type => ['lowWall', 'divider'].includes(type));
  if (!themed && random.next() >= profile.wallChance) return 0;
  return random.integer(...(cadence.wallFocused ? profile.wallFocusedCount : profile.wallCount));
}

function motionDescriptors(cadence, profile, count, random) {
  const preferred = cadence.permittedTypes.filter(type => ['breathing', 'orbiting', 'stinger'].includes(type));
  let families = preferred.length ? preferred : [random.next() < .5 ? 'breathing' : 'orbiting'];
  if (families.includes('stinger')) families = ['stinger', random.next() < .5 ? 'breathing' : 'orbiting'];
  else if (!cadence.wallFocused && cadence.difficulty !== 'gentle' && families.length === 1 && random.next() < .16) families = ['stinger', ...families];
  if (cadence.wallFocused || cadence.difficulty === 'gentle') families = [families.find(type => type !== 'stinger') || 'orbiting'];
  const variants = ['breathing-safe', 'breathing-single-tip', 'breathing-double-pincer'];
  const result = [];
  let stingers = 0;
  let tipSide = random.next() < .5 ? 'left' : 'right';
  for (let index = 0; index < count; index++) {
    let type = families[index % families.length];
    const maximum = cadence.difficulty === 'challenge' ? GENERATION.stinger.maxPerChallenge : GENERATION.stinger.maxPerStandard;
    if (type === 'stinger' && stingers >= maximum) type = families.find(family => family !== 'stinger') || 'orbiting';
    if (type === 'stinger') stingers++;
    if (type === 'breathing') {
      const sample = random.next(), weights = profile.breathingVariants;
      const variant = variants[sample < weights[0] ? 0 : sample < weights[0] + weights[1] ? 1 : 2];
      result.push({ type, variant, tipSide, hazardous: variant !== 'breathing-safe' });
      if (variant === 'breathing-single-tip') tipSide = tipSide === 'left' ? 'right' : 'left';
    } else result.push({ type, hazardous: type === 'stinger' || random.next() < profile.hazardousOrbitChance });
  }
  return { descriptors: result, families };
}

function placeObstacles(platforms, cadence, profile, random, requestedWalls) {
  const intentionallyStatic = cadence.difficulty === 'gentle'
    && (['Wide Static', 'Long-Drop Opportunities'].includes(cadence.archetype) || random.next() < .45);
  const requestedAnimated = intentionallyStatic ? 0 : random.integer(...profile.animatedCount);
  const { descriptors, families } = motionDescriptors(cadence, profile, requestedAnimated, random);
  const diagnostics = { proposedWalls: requestedWalls, placedWalls: 0, rejectedWalls: 0, wallRejectionReasons: {},
    requestedAnimated, placedAnimated: 0, rejectedAnimated: 0, animationRejectionReasons: {}, planAttempts: 0 };
  let plan;
  const minimumWalls = requestedWalls ? (cadence.wallFocused ? profile.wallFocusedCount[0] : profile.wallCount[0]) : 0;
  for (let walls = requestedWalls; walls >= minimumWalls && !plan; walls--) {
    for (let animated = requestedAnimated; animated >= profile.animatedCount[0] && !plan; animated--) {
      plan = obstacleSlots(platforms, walls, descriptors.slice(0, animated), random, diagnostics);
    }
  }
  if (!plan) plan = [];
  let dividers = 0;
  const permitted = new Set(families);
  if (requestedWalls) { permitted.add('lowWall'); permitted.add('divider'); }
  for (const { index, wall, descriptor } of plan) {
    const platform = platforms[index];
    let type = descriptor?.type;
    if (wall) {
      const chance = cadence.difficulty === 'gentle' ? .05 : GENERATION.wall.dividerChance;
      const divider = dividers < profile.maxDividers
        && ((cadence.archetype === 'Divider Navigation' && !dividers) || random.next() < chance);
      type = divider ? 'divider' : 'lowWall';
      if (divider) dividers++;
    }
    addMotion(platform, type, profile, random, descriptor);
    if (wall) {
      const incoming = signedRouteDelta(platforms[index - 1].route.angle - platform.route.angle);
      platform.walls[0].angle = normalizeAngle(-Math.sign(incoming || 1) * 1.95);
      platform.segments = ringSegments(platform.gapWidth);
      for (let offset = 1; offset <= GENERATION.wall.staticRecoveryCount; offset++) {
        const recovery = platforms[index + offset];
        recovery.route.role = 'recovery';
        recovery.segments = ringSegments(recovery.gapWidth);
        recovery.wallRecoveryFor = platform.id;
      }
    } else {
      const recovery = platforms[index + 1];
      recovery.route.role = 'recovery';
      recovery.segments = ringSegments(recovery.gapWidth);
      recovery.recoveryFor = platform.id;
      const after = platforms[index + 2];
      after.segments = ringSegments(after.gapWidth);
      after.protectedArrival = true;
    }
  }
  diagnostics.placedWalls = plan.filter(slot => slot.wall).length;
  diagnostics.placedAnimated = plan.length - diagnostics.placedWalls;
  diagnostics.rejectedWalls = requestedWalls - diagnostics.placedWalls;
  diagnostics.rejectedAnimated = requestedAnimated - diagnostics.placedAnimated;
  if (diagnostics.rejectedWalls) diagnostics.wallRejectionReasons.capacity = diagnostics.rejectedWalls;
  if (diagnostics.rejectedAnimated) diagnostics.animationRejectionReasons.capacity = diagnostics.rejectedAnimated;
  return { permittedTypes: [...permitted], wallFocused: cadence.wallFocused, specialDensity: plan.length / platforms.length,
    obstaclePlacement: diagnostics,
    obstacleTargets: { walls: diagnostics.placedWalls, animated: diagnostics.placedAnimated, requestedWalls, requestedAnimated } };
}

function annotateRoute(level) {
  level.routeMetrics = analyzeRoute(level);
  for (const transition of level.routeMetrics.transitions) {
    const { delta, direction, directionRun } = transition;
    Object.assign(level.platforms[transition.index].route, { delta, direction, directionRun });
    Object.assign(level.route[transition.index], { delta, direction, directionRun });
  }
  Object.assign(level.platforms[0].route, { delta: 0, direction: 0, directionRun: 0 });
  Object.assign(level.route[0], { delta: 0, direction: 0, directionRun: 0 });
}

function routeFeatureCost(level, index) {
  const transition = level.routeMetrics.transitions[index - 1];
  const priorTransition = level.routeMetrics.transitions[index - 2];
  const reversal = transition?.direction && priorTransition?.direction && transition.direction !== priorTransition.direction
    && Math.abs(transition.delta) >= Math.PI / 2 ? GENERATION.complexity.costs.largeReversal : 0;
  return reversal + breathingBudgetSurcharge(level.platforms[index].motion)
    + (level.platforms[index].walls.length && level.platforms.slice(0, index).some(platform => platform.walls.length) ? GENERATION.complexity.costs.additionalWall : 0)
    + (level.plannedDrops.some(drop => drop.start === index) ? GENERATION.complexity.costs.plannedDrop : 0)
    + (level.wallFocused && level.platforms[index].walls.length ? GENERATION.complexity.costs.wallFocused : 0)
    + (level.platforms[index].motion && level.platforms[index - 1]?.motion ? GENERATION.complexity.costs.adjacentAnimation : 0);
}

function applySilhouettes(level, random, profile, conservative) {
  const platforms = level.platforms.slice(0, -1);
  const caps = SILHOUETTE_CONFIG.profiles[level.difficulty];
  const baselineCosts = platforms.map((platform, index) => (SILHOUETTE_CONFIG.costs[platform.type] || 0) + routeFeatureCost(level, index));
  let tinyCount = 0;
  let islandCount = 0;
  let smallRun = 0;
  let spent = 0;
  const sections = [];
  for (let index = 0; index < platforms.length; index += 1) {
    const original = platforms[index];
    const previous = platforms[index - 1];
    const previousAngle = previous?.route.angle ?? CONFIG.world.ballWorldAngle;
    const forceBroad = conservative || previous?.silhouetteMetrics?.tiny
      || smallRun >= GENERATION.complexity.maxConsecutiveSmall;
    const section = Math.floor(index / GENERATION.complexity.sectionLength);
    const sectionEnd = Math.min(platforms.length, (section + 1) * GENERATION.complexity.sectionLength);
    const reservedSection = baselineCosts.slice(index + 1, sectionEnd).reduce((sum, cost) => sum + cost, 0);
    const reservedLevel = baselineCosts.slice(index + 1).reduce((sum, cost) => sum + cost, 0);
    const routeCost = routeFeatureCost(level, index);
    let candidate;
    let accepted = false;
    // Geometry candidates are bounded. A rejected sparse silhouette restores
    // the already-safe broad route, never relaxes the no-input validator.
    for (let attempt = 0; attempt < GENERATION.maxSilhouetteAttempts; attempt += 1) {
      candidate = structuredClone(original);
      applyPlatformSilhouette(candidate, random, { difficulty: level.difficulty, previousAngle,
        recovery: forceBroad,
        protectedIntervals: original.protectedArrival && previous ? [{ start: previousAngle - previous.gapWidth / 2, end: previousAngle + previous.gapWidth / 2 }] : [],
        allowReadableVariation: level.difficulty !== 'gentle' && index > 0 && index < platforms.length - 1,
        allowPlannedVariation: level.plannedDrops.some(drop => index === drop.start + 1),
        allowOrbitVariation: original.type === 'orbiting',
        allowRecoveryVariation: Boolean(original.wallRecoveryFor && previous?.wallRecoveryFor === original.wallRecoveryFor),
        requestedSilhouette: attempt === GENERATION.maxSilhouetteAttempts - 1 || forceBroad ? 'broadRing' : undefined,
        shoulderType: attempt === GENERATION.maxSilhouetteAttempts - 1 ? 'none' : undefined });
      candidate.difficultyCost += routeCost;
      if (candidate.silhouetteMetrics.tiny && tinyCount >= caps.maxTiny) continue;
      if (candidate.silhouetteMetrics.hazardIslands && islandCount >= caps.maxHazardIslands) continue;
      if (spent + candidate.difficultyCost + reservedLevel > profile.levelBudget
        || (sections[section] || 0) + candidate.difficultyCost + reservedSection > profile.sectionBudget) continue;
      if (!validatePlatformSilhouette(candidate).valid) continue;
      level.platforms[index] = candidate;
      // Repainting a continuous ring has exactly the same empty-space topology.
      // Only disconnected candidates need another circular-window intersection.
      if (candidate.silhouetteMetrics.pieceCount > 1 || Math.abs(candidate.totalGapCoverage - original.gapWidth) > 1e-7) {
        const alignment = analyzeGapAlignment(level);
        if (alignment.hardViolationCount || alignment.repeatedThreeWindows
          || alignment.accidentalThreeCount > Math.floor(platforms.length * GENERATION.route.maxAccidentalThreeRatio)) continue;
      }
      accepted = true;
      break;
    }
    if (!accepted) {
      candidate = structuredClone(original);
      applyPlatformSilhouette(candidate, random, { difficulty: level.difficulty, previousAngle, recovery: true });
      candidate.difficultyCost += routeCost;
      level.platforms[index] = candidate;
    }
    platforms[index] = candidate;
    tinyCount += candidate.silhouetteMetrics.tiny ? 1 : 0;
    islandCount += candidate.silhouetteMetrics.hazardIslands;
    smallRun = candidate.silhouetteMetrics.small ? smallRun + 1 : 0;
    spent += candidate.difficultyCost;
    sections[section] = (sections[section] || 0) + candidate.difficultyCost;
  }
  level.difficultyBudget = { used: spent, limit: profile.levelBudget, sectionLength: GENERATION.complexity.sectionLength,
    sectionLimit: profile.sectionBudget, sections };
  level.gapAlignment = analyzeGapAlignment(level);
}

function generateNormalLevel(metadata, random, cadence, allowObstacles = true) {
  const profile = GENERATION.profiles[cadence.difficulty];
  const requestedWalls = allowObstacles ? proposeWallCount(cadence, profile, random) : 0;
  // More hazards need real recovery room; the established 42–49 bound stays fixed.
  const countRange = cadence.kind === BRITISH_MILESTONE_KIND ? GENERATION.britishMilestone.platformCount : GENERATION.normalCount;
  const count = cadence.difficulty === 'gentle' ? random.integer(...countRange)
    : random.integer(requestedWalls >= 4 || cadence.wallFocused ? 48 : 46, countRange[1]);
  const { route, opportunities } = routeForNormal(count, random, { ...cadence, requestedWalls });
  const platforms = route.map((point, index) => {
    const readable = point.role === 'opening' || point.role === 'final' || point.role === 'recovery';
    const width = Math.min(random.range(...profile.gapWidth),
      point.role === 'longDrop' || point.role === 'smash' ? 100 * Math.PI / 180 : Infinity);
    const hazard = point.role === 'recovery' ? 0 : random.range(...profile.hazardWidth) * (readable ? GENERATION.readableHazardMultiplier : 1);
    const previousAngle = route[index - 1]?.angle ?? CONFIG.world.ballWorldAngle;
    const incoming = signedRouteDelta(previousAngle - point.angle);
    const hazardCenter = normalizeAngle(Math.PI + incoming / 2);
    const platform = makePlatform(index, point.angle, width, hazard, point.role, hazardCenter);
    Object.assign(platform.route, point);
    return platform;
  });
  const obstacleMetadata = allowObstacles ? placeObstacles(platforms, cadence, profile, random, requestedWalls)
    : { permittedTypes: [], wallFocused: false, specialDensity: 0,
      obstacleTargets: { walls: 0, animated: 0, requestedWalls: 0, requestedAnimated: 0 },
      obstaclePlacement: { proposedWalls: 0, placedWalls: 0, rejectedWalls: 0, wallRejectionReasons: {}, requestedAnimated: 0, placedAnimated: 0, rejectedAnimated: 0, animationRejectionReasons: {}, planAttempts: 0 } };
  const level = finishLevel({ ...metadata, ...obstacleMetadata }, platforms, opportunities);
  level.plannedDrops = opportunities.map(drop => ({ ...drop }));
  annotateRoute(level);
  applySilhouettes(level, random, profile, !allowObstacles);
  return level;
}

function metadataFor(number, version, seed, cadence, random) {
  return { levelNumber: number, generatorVersion: version, seed, cadenceSlot: cadence.cadenceSlot,
    kind: cadence.kind, difficulty: cadence.difficulty, difficultyRating: random.integer(...cadence.ratingRange),
    archetype: cadence.archetype, permittedTypes: [...cadence.permittedTypes], specialDensity: cadence.specialDensity,
    ...(cadence.kind === BRITISH_MILESTONE_KIND ? { milestone: { ...britishMilestoneMetadata(number), generatorVersion: version } } : {}) };
}

/** Geometry is deliberately independent of palette preferences and all browser state. */
export function generateLevel(levelNumber = 1, { version, validator = validateLevel, maxAttempts = GENERATION.maxAttempts } = {}) {
  const number = Number.isSafeInteger(levelNumber) && levelNumber > 0 ? levelNumber : 1;
  const cadence = cadenceForLevel(number);
  const generatorVersion = Number.isSafeInteger(version) && version > 0 ? version
    : cadence.kind === 'flow' ? FLOW_GENERATOR_VERSION : cadence.kind === BRITISH_MILESTONE_KIND ? BRITISH_MILESTONE_GENERATOR_VERSION : NORMAL_GENERATOR_VERSION;
  const seedFor = cadence.kind === BRITISH_MILESTONE_KIND ? britishGeometrySeed : deriveSeed;
  let lastErrors = [];
  const attempts = Math.max(1, Math.min(GENERATION.maxAttempts, Number.isFinite(maxAttempts) ? Math.floor(maxAttempts) : GENERATION.maxAttempts));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const seed = seedFor(number, generatorVersion, attempt);
    const random = new SeededRandom(seed);
    const metadata = metadataFor(number, generatorVersion, seed, cadence, random);
    const level = cadence.kind === 'flow' ? generateFlowLevel(metadata, random) : generateNormalLevel(metadata, random, cadence);
    let result;
    try {
      result = validator(level);
    } catch (error) {
      // A broken candidate must not strand the player. Preserve the exception
      // diagnostic and count this attempt, then use the bounded safe fallback.
      lastErrors = [`Level validator threw: ${error instanceof Error ? error.message : String(error)}`];
      continue;
    }
    if (!result || typeof result.valid !== 'boolean' || !Array.isArray(result.errors)) {
      lastErrors = ['Level validator returned a malformed result'];
      continue;
    }
    if (result.valid) return { ...level, generationAttempt: attempt + 1, fallback: false };
    lastErrors = result.errors.length ? result.errors.map(String) : ['Level validator rejected the candidate without a diagnostic'];
  }

  // Bounded recovery: build a conservative static route rather than retrying
  // forever or ever returning rejected geometry to the renderer.
  const seed = seedFor(number, generatorVersion, GENERATION.maxAttempts);
  const random = new SeededRandom(seed);
  const fallbackCadence = cadence.kind === 'flow' ? cadence : { ...cadence, difficulty: 'gentle', ratingRange: [3, 3], archetype: 'Wide Static', permittedTypes: [], specialDensity: 0 };
  const metadata = metadataFor(number, generatorVersion, seed, fallbackCadence, random);
  const fallback = cadence.kind === 'flow' ? generateFlowLevel(metadata, random, { conservative: true }) : generateNormalLevel(metadata, random, fallbackCadence, false);
  const result = validateLevel(fallback);
  if (!result.valid) throw new Error(`Safe level fallback failed: ${result.errors.join('; ')}`);
  return { ...fallback, generationAttempt: attempts, fallback: true, generationErrors: lastErrors };
}
