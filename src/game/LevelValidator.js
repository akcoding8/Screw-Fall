import { CONFIG } from './config.js';
import { GENERATION, breathingBudgetSurcharge } from './GenerationConfig.js';
import { MOTION_LIMITS, WALL_CONFIG } from './ObstacleConfig.js';
import { arcContains, normalizeAngle, TAU } from './math.js';
import { validateNormalRoute, signedRouteDelta, analyzeRoute, splitCircularInterval } from './RouteAnalysis.js';
import { validatePlatformSilhouette, SILHOUETTE_CONFIG } from './PlatformSilhouettes.js';

import { validatePincerMotion } from './PincerGeometry.js';
import { validateFlowFeasibility } from './FlowFeasibility.js';
import { BRITISH_MILESTONE_KIND, isBritishMilestone, britishThemeSeed, BRITISH_MILESTONE_THEME_VERSION } from './BritishMilestone.js';

const EPSILON = 1e-7;
const TYPES = new Set(['static', 'breathing', 'orbiting', 'stinger', 'lowWall', 'divider']);
const between = (value, low, high) => Number.isFinite(value) && value >= low - EPSILON && value <= high + EPSILON;

function localKind(platform, angle) {
  for (const segment of platform.segments) if (arcContains(angle, segment.start, segment.end)) return segment.kind;
  return 'gap';
}

function finiteData(value, ancestors = new WeakSet()) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(child => finiteData(child, ancestors));
  ancestors.delete(value);
  return valid;
}

/** Reject broken structure before any dependent dereference or index-controlled loop. */
function schemaErrors(level) {
  const errors = [];
  if (level.platforms.length < 2 || level.platforms.length > GENERATION.flowCount[1] + 1) return ['Invalid platform list length'];
  for (const platform of level.platforms) {
    if (!platform || typeof platform !== 'object' || !Array.isArray(platform.segments)
      || platform.segments.length < 1 || platform.segments.length > 64
      || platform.segments.some(segment => !segment || typeof segment !== 'object')
      || !Array.isArray(platform.walls) || platform.walls.length > 8
      || platform.walls.some(wall => !wall || typeof wall !== 'object')
      || (!platform.finish && (!platform.route || typeof platform.route !== 'object'
        || !Number.isFinite(platform.route.angle) || !Number.isFinite(platform.route.halfWidth)))
      || (platform.motion !== undefined && (!platform.motion || typeof platform.motion !== 'object'))) errors.push('Incomplete platform geometry schema');
  }
  const count = level.platforms.filter(platform => platform && !platform.finish).length;
  if (!Array.isArray(level.route) || level.route.length !== count
    || level.route.some(point => !point || typeof point !== 'object'
      || !Number.isFinite(point.angle) || !Number.isFinite(point.halfWidth))) errors.push('Missing route metadata');
  if (!Array.isArray(level.smashOpportunities) || level.smashOpportunities.length > count) errors.push('Invalid smash opportunity list');
  else for (const opportunity of level.smashOpportunities) {
    if (!opportunity || typeof opportunity !== 'object') {
      errors.push('Invalid smash opportunity');
      continue;
    }
    const { start, passes, catchIndex, recoveryIndex } = opportunity;
    if (![start, passes, catchIndex, recoveryIndex].every(Number.isSafeInteger)
      || start < 0 || passes < CONFIG.smash.threshold || passes > count
      || catchIndex !== start + passes || catchIndex >= count
      || recoveryIndex !== catchIndex + 1 || recoveryIndex >= count) errors.push('Invalid or out-of-range smash sequence');
  }
  if (level.kind === 'normal' || level.kind === BRITISH_MILESTONE_KIND) {
    if (!Array.isArray(level.plannedDrops) || level.plannedDrops.length > 2
      || level.plannedDrops.length !== level.smashOpportunities?.length) errors.push('Invalid planned-drop list');
    else {
      const ids = new Set();
      for (let index = 0; index < level.plannedDrops.length; index += 1) {
        const drop = level.plannedDrops[index];
        const smash = level.smashOpportunities[index];
        if (!drop || typeof drop !== 'object' || !smash || typeof drop.id !== 'string' || !drop.id || ids.has(drop.id)
          || ![drop.start, drop.passes, drop.catchIndex, drop.recoveryIndex].every(Number.isSafeInteger)
          || drop.start < 0 || drop.passes < 3 || drop.passes > 5 || drop.catchIndex !== drop.start + drop.passes
          || drop.recoveryIndex !== drop.catchIndex + 1 || drop.recoveryIndex >= count || !Number.isFinite(drop.angle)
          || ['id', 'start', 'passes', 'catchIndex', 'recoveryIndex', 'angle'].some(key => drop[key] !== smash[key])) {
          errors.push('Invalid or inconsistent planned-drop metadata');
          continue;
        }
        ids.add(drop.id);
        for (let platformIndex = drop.start; platformIndex < drop.catchIndex; platformIndex += 1) {
          const point = level.route?.[platformIndex];
          if (!point || point.plannedDropId !== drop.id || point.role !== 'longDrop' || point.angle !== drop.angle) errors.push('Invalid planned-drop route membership');
        }
      }
      for (let index = 0; index < (level.route?.length || 0); index += 1) {
        const point = level.route[index];
        if (point?.plannedDropId && !level.plannedDrops.some(drop => drop && point.plannedDropId === drop.id
          && index >= drop.start && index < drop.catchIndex)) errors.push('Unmarked route claims planned-drop membership');
      }
    }
  }
  return errors;
}

function validateArcs(platform, errors) {
  let previousEnd = 0;
  let safeWidth = 0;
  let hazardWidth = 0;
  for (const segment of platform.segments) {
    if (!['safe', 'hazard'].includes(segment.kind) || !between(segment.start, 0, TAU)
      || !between(segment.end, 0, TAU) || segment.end <= segment.start
      || segment.start < previousEnd - EPSILON) errors.push(`${platform.id}: invalid or overlapping arc`);
    previousEnd = segment.end;
    if (segment.kind === 'hazard') hazardWidth += segment.end - segment.start;
    else safeWidth += segment.end - segment.start;
  }
  const gapWidth = TAU - safeWidth - hazardWidth;
  if (safeWidth <= 0 || !between(gapWidth, 0.5, TAU - 0.3)) errors.push(`${platform.id}: missing usable safe arc or gap`);
  if (!between(hazardWidth, 0, GENERATION.profiles.challenge.hazardWidth[1])) errors.push(`${platform.id}: excessive hazard coverage`);
  if (Math.abs(gapWidth - (platform.totalGapCoverage ?? platform.gapWidth)) > EPSILON) errors.push(`${platform.id}: gap metadata disagrees with arcs`);
  return { safeWidth, hazardWidth, gapWidth };
}

function validateMotion(platform, errors, profile) {
  const motion = platform.motion;
  if (['breathing', 'orbiting', 'stinger'].includes(platform.type) && !motion) errors.push(`${platform.id}: missing motion`);
  if (!motion) return;
  if (motion.type !== platform.type || !Number.isFinite(motion.phase)) errors.push(`${platform.id}: invalid motion type or phase`);
  if (motion.type === 'breathing') {
    const limits = MOTION_LIMITS.breathing;
    if (!between(motion.minWidth, limits.minWidth, limits.maxWidth) || !between(motion.maxWidth, motion.minWidth, limits.maxWidth)
      || !between(motion.period, limits.minPeriod, limits.maxPeriod)) errors.push(`${platform.id}: invalid breathing limits`);
    const tuning = GENERATION.breathing;
    const originalSpan = Math.min(tuning.sourceMaxWidth, platform.gapWidth + tuning.wideOffset)
      - Math.max(tuning.sourceMinWidth, platform.gapWidth - tuning.narrowOffset);
    if (Math.abs(motion.maxWidth - motion.minWidth - originalSpan * tuning.amplitudeMultiplier) > EPSILON) errors.push(`${platform.id}: invalid breathing amplitude`);
    errors.push(...validatePincerMotion(platform).map(error => `${platform.id}: ${error}`));
    if (!profile || !between(motion.period, ...profile.breathingPeriod)) errors.push(`${platform.id}: invalid profile breathing period`);
    if (motion.variant === 'breathing-double-pincer' && motion.minWidth < tuning.narrowThreshold && motion.period < tuning.fastThreshold) errors.push(`${platform.id}: narrow double pincer has fastest cycle`);
    if (motion.budgetCost !== SILHOUETTE_CONFIG.costs.breathing + breathingBudgetSurcharge(motion)) errors.push(`${platform.id}: pincer budget metadata mismatch`);
    const minimumPassable = 2 * Math.asin((CONFIG.physics.ballRadius + GENERATION.route.alignmentPhysicalMargin) / CONFIG.world.ballOrbitRadius);
    if (motion.minWidth < minimumPassable) errors.push(`${platform.id}: breathing minimum is not passable`);
    if (Math.abs(platform.route.halfWidth - motion.minWidth / 2) > EPSILON) errors.push(`${platform.id}: intended pincer corridor exceeds the minimum opening`);
    if (platform.segments[0].start !== platform.gapWidth / 2 || platform.segments.at(-1).end !== TAU - platform.gapWidth / 2) errors.push(`${platform.id}: breathing gap must be centred at zero`);
  } else if (motion.type === 'orbiting' || motion.type === 'stinger') {
    const limits = MOTION_LIMITS[motion.type];
    if (!between(Math.abs(motion.speed), limits.minSpeed, limits.maxSpeed)) errors.push(`${platform.id}: invalid angular speed`);
    const range = motion.type === 'stinger' ? profile?.stingerSpeed : profile?.speed;
    if (!range || !between(Math.abs(motion.speed), ...range)) errors.push(`${platform.id}: invalid profile animation speed`);
    if (motion.type === 'orbiting' && platform.gapWidth < 74 * Math.PI / 180 && Math.abs(motion.speed) > .50 + EPSILON) errors.push(`${platform.id}: fast orbit combined with narrow opening`);
  } else errors.push(`${platform.id}: unknown motion`);

  if (platform.type === 'stinger') {
    const [left, safe, right] = platform.segments;
    const limits = MOTION_LIMITS.stinger;
    if (platform.segments.length !== 3 || left?.kind !== 'hazard' || safe?.kind !== 'safe' || right?.kind !== 'hazard'
      || left.end !== safe.start || safe.end !== right.start
      || !between(safe.end - safe.start, limits.minSafeWidth, limits.maxSafeWidth)
      || !between(left.end - left.start, limits.minFlankWidth, limits.maxFlankWidth)
      || !between(right.end - right.start, limits.minFlankWidth, limits.maxFlankWidth)) errors.push(`${platform.id}: invalid adjacent stinger cluster`);
    if (safe && safe.end - safe.start < 34 * Math.PI / 180 && Math.abs(motion.speed) > .46 + EPSILON) errors.push(`${platform.id}: fast stinger combined with narrow target`);
  }
}

function validateWalls(platform, previous, errors) {
  if (platform.walls.length > 1) errors.push(`${platform.id}: opposing wall trap`);
  for (const wall of platform.walls) {
    const expectedHeight = wall.type === 'low' ? WALL_CONFIG.lowHeight : WALL_CONFIG.dividerHeight;
    if (!['low', 'divider'].includes(wall.type) || !between(wall.height, expectedHeight, expectedHeight)
      || !between(wall.width, 0.06, 0.2) || !between(wall.innerRadius, CONFIG.world.innerRadius, CONFIG.world.ballOrbitRadius)
      || !between(wall.outerRadius, CONFIG.world.ballOrbitRadius, CONFIG.world.outerRadius)
      || !between(wall.angle, 0, TAU)) errors.push(`${platform.id}: invalid wall dimensions`);
    if (wall.height > CONFIG.world.platformSpacing - CONFIG.world.platformThickness - GENERATION.wall.clearance + EPSILON) errors.push(`${platform.id}: wall intersects platform above`);
    if (wall.innerRadius + WALL_CONFIG.colliderInset > CONFIG.world.ballOrbitRadius - CONFIG.physics.ballRadius
      || wall.outerRadius - WALL_CONFIG.colliderInset < CONFIG.world.ballOrbitRadius + CONFIG.physics.ballRadius) errors.push(`${platform.id}: wall does not span complete sphere orbit`);
    const bounceHeight = CONFIG.physics.bounceVelocity ** 2 / (2 * CONFIG.physics.bounceGravity);
    const effectiveTop = wall.height - WALL_CONFIG.colliderInset + WALL_CONFIG.clearanceEpsilon;
    if (wall.type === 'low' && effectiveTop >= bounceHeight - GENERATION.wall.clearance) errors.push(`${platform.id}: low wall is not jumpable`);
    if (wall.type === 'divider' && effectiveTop <= bounceHeight + GENERATION.wall.clearance) errors.push(`${platform.id}: divider can be jumped in its active band`);
    const angularRadius = Math.asin(CONFIG.physics.ballRadius / CONFIG.world.ballOrbitRadius) + wall.width / (2 * CONFIG.world.ballOrbitRadius);
    if (localKind(platform, wall.angle) !== 'safe'
      || localKind(platform, wall.angle - angularRadius) !== 'safe'
      || localKind(platform, wall.angle + angularRadius) !== 'safe') errors.push(`${platform.id}: wall is not supported by safe geometry`);
    // Required navigation goes from the preceding gap to this gap. One fin on
    // the other side leaves that whole short arc open; there is no angular cage.
    if (previous) {
      const arrival = normalizeAngle(previous.route.angle - platform.baseRotation);
      const target = arrival + signedRouteDelta(platform.route.angle - previous.route.angle);
      const low = Math.min(arrival, target) - angularRadius;
      const high = Math.max(arrival, target) + angularRadius;
      for (let turn = -1; turn <= 2; turn += 1) {
        const wallAngle = wall.angle + turn * TAU;
        if (wallAngle >= low && wallAngle <= high) errors.push(`${platform.id}: wall obstructs intended recovery route`);
      }
    }
  }
}

/** Recompute physical route metrics and check independent controller trials. */
export function validateFlowPath(level) {
  return validateFlowFeasibility(level);
}

export function validateLevel(level) {
  const errors = [];
  if (!level || !Array.isArray(level.platforms)) return { valid: false, errors: ['Missing platform list'] };
  const structuralErrors = schemaErrors(level);
  if (structuralErrors.length) return { valid: false, errors: structuralErrors };
  if (!finiteData(level)) return { valid: false, errors: ['Non-finite or cyclic geometry or metadata'] };
  if (!['normal', 'flow', BRITISH_MILESTONE_KIND].includes(level.kind) || !['gentle', 'standard', 'challenge', 'flow'].includes(level.difficulty)
    || (level.kind === 'flow') !== (level.difficulty === 'flow')
    || !Number.isSafeInteger(level.levelNumber) || level.levelNumber < 1
    || !Number.isSafeInteger(level.generatorVersion) || level.generatorVersion < 1
    || !between(level.seed, 0, 4294967295) || !Number.isInteger(level.seed)
    || !between(level.cadenceSlot, 1, 50) || !Number.isInteger(level.cadenceSlot)
    || level.cadenceSlot !== (level.levelNumber - 1) % 50 + 1
    || (level.kind === BRITISH_MILESTONE_KIND) !== isBritishMilestone(level.levelNumber)
    || (level.kind === 'flow') !== (level.levelNumber % 10 === 0 && !isBritishMilestone(level.levelNumber))
    || typeof level.archetype !== 'string' || !level.archetype
    || !Array.isArray(level.permittedTypes) || level.permittedTypes.some(type => !TYPES.has(type) || type === 'static')
    || !level.obstacleCounts || typeof level.obstacleCounts !== 'object') return { valid: false, errors: [...errors, 'Invalid level metadata'] };
  const ratingRange = level.kind === 'flow' ? [1, 1] : GENERATION.profiles[level.difficulty]?.rating;
  if (!ratingRange || !between(level.difficultyRating, ...ratingRange)) errors.push('Unbounded difficulty rating');
  if (level.platforms.some(platform => !platform || !Array.isArray(platform.segments))) return { valid: false, errors: [...errors, 'Missing platform geometry'] };
  const regular = level.platforms.filter(platform => !platform.finish);
  const flow = level.kind === 'flow';
  const milestone = level.kind === BRITISH_MILESTONE_KIND;
  if (milestone && (!level.milestone || level.milestone.index !== level.levelNumber / 100
    || level.milestone.generatorVersion !== level.generatorVersion
    || level.milestone.themeVersion !== BRITISH_MILESTONE_THEME_VERSION || level.milestone.themeSeed !== britishThemeSeed(level.levelNumber)
    || level.flow || level.isFlow)) errors.push('Invalid British milestone metadata');
  const range = flow ? GENERATION.flowCount : milestone ? GENERATION.britishMilestone.platformCount : GENERATION.normalCount;
  if (!between(regular.length, ...range) || regular.length !== level.platformCount) errors.push('Invalid platform count');
  if (!Array.isArray(level.route) || level.route.length !== regular.length) errors.push('Missing route metadata');
  const finish = level.platforms.at(-1);
  if (!finish?.finish || level.platforms.filter(platform => platform.finish).length !== 1
    || finish.segments.length !== 1 || finish.segments[0].kind !== 'safe'
    || finish.segments[0].start !== 0 || finish.segments[0].end !== TAU) errors.push('Missing reachable finish floor');
  if (finish?.type !== 'finish' || finish.index !== regular.length || typeof finish.active !== 'boolean'
    || finish.walls.length || finish.motion) errors.push('Finish floor contains invalid state or obstacles');
  if (new Set(level.platforms.map(platform => platform.id)).size !== level.platforms.length) errors.push('Duplicate platform IDs');
  const counts = { static: 0, breathing: 0, orbiting: 0, stinger: 0, lowWall: 0, divider: 0 };
  const routeAnalysis = flow ? null : analyzeRoute(level);
  let consecutiveSpecial = 0;
  for (let index = 0; index < level.platforms.length; index += 1) {
    const platform = level.platforms[index];
    const previous = level.platforms[index - 1];
    if (!Number.isFinite(platform.y) || Math.abs(platform.y + index * CONFIG.world.platformSpacing) > EPSILON) errors.push(`${platform.id}: invalid spacing/order`);
    if (!between(platform.baseRotation, 0, TAU - EPSILON)) errors.push(`${platform.id}: invalid base rotation`);
    if (platform.finish) continue;
    if (!Array.isArray(platform.segments) || !Array.isArray(platform.walls) || !platform.route) {
      errors.push(`${platform.id}: incomplete geometry schema`);
      continue;
    }
    const point = level.route?.[index];
    if (!point || platform.index !== index || point.index !== platform.index || point.y !== platform.y
      || ['angle', 'halfWidth', 'role', 'plannedDropId', 'delta', 'direction', 'directionRun']
        .some(key => point[key] !== platform.route[key])) errors.push(`${platform.id}: route metadata mismatch`);
    if (flow) {
      if (platform.route.role !== 'flow') errors.push(`${platform.id}: invalid Flow route role`);
    } else {
      const role = platform.route.role;
      const declaredDrop = level.plannedDrops.find(drop => index >= drop.start && index < drop.catchIndex);
      if (!['opening', 'turn', 'longDrop', 'smash', 'recovery', 'final'].includes(role)) errors.push(`${platform.id}: invalid normal route role`);
      if ((role === 'longDrop') !== Boolean(declaredDrop)
        || (role === 'smash') !== level.plannedDrops.some(drop => drop.catchIndex === index)) errors.push(`${platform.id}: unmarked special route role`);
      const readableRole = index < GENERATION.openingCount ? 'opening' : index >= regular.length - GENERATION.finalCount ? 'final' : null;
      if ((readableRole && role !== readableRole) || (!readableRole && ['opening', 'final'].includes(role))) errors.push(`${platform.id}: invalid opening/final route role`);
      if (readableRole && (!['broadRing', 'offsetRing', 'mediumCrescent', 'twoCrescents'].includes(platform.silhouette)
        || platform.hazardShoulder !== 'none')) errors.push(`${platform.id}: excessive opening/final precision`);
      const actual = routeAnalysis.transitions[index - 1] || { delta: 0, direction: 0, directionRun: 0 };
      if (['delta', 'direction', 'directionRun'].some(key => !Number.isFinite(platform.route[key])
        || Math.abs(platform.route[key] - actual[key]) > EPSILON)) errors.push(`${platform.id}: route direction metadata disagrees with angles`);
    }
    if (typeof platform.active !== 'boolean') errors.push(`${platform.id}: invalid destruction state`);
    if (!TYPES.has(platform.type)) errors.push(`${platform.id}: unknown platform type`);
    else counts[platform.type] += 1;
    const { hazardWidth, gapWidth } = validateArcs(platform, errors);
    validateMotion(platform, errors, GENERATION.profiles[level.difficulty]);
    if (!flow && platform.silhouette) errors.push(...validatePlatformSilhouette(platform).errors.map(error => `${platform.id}: ${error}`));
    validateWalls(platform, previous, errors);
    if (['lowWall', 'divider'].includes(platform.type) && platform.walls.length !== 1) errors.push(`${platform.id}: missing wall`);
    if (platform.walls.length && !['lowWall', 'divider'].includes(platform.type)) errors.push(`${platform.id}: wall geometry has wrong platform type`);
    if (platform.walls.some(wall => (wall.type === 'low') !== (platform.type === 'lowWall'))) errors.push(`${platform.id}: wall type metadata mismatch`);
    const isSpecial = platform.type !== 'static';
    consecutiveSpecial = isSpecial ? consecutiveSpecial + 1 : 0;
    if (consecutiveSpecial > GENERATION.maxConsecutiveSpecial) errors.push(`${platform.id}: consecutive special platforms`);
    if ((index < GENERATION.openingCount || index >= regular.length - GENERATION.finalCount) && isSpecial) errors.push(`${platform.id}: unreadable opening/final section`);
    if (isSpecial && !level.permittedTypes.includes(platform.type)) errors.push(`${platform.id}: mechanic not permitted by archetype`);
    if (isSpecial && regular[index + 1]?.type !== 'static') errors.push(`${platform.id}: missing static recovery`);
    if (isSpecial && (regular[index + 1]?.route.role !== 'recovery' || regular[index + 1]?.silhouette !== 'broadRing')) {
      errors.push(`${platform.id}: missing broad recovery after obstacle`);
    }
    if (platform.motion) {
      const recovery = regular[index + 1];
      const after = regular[index + 2];
      if (!recovery || recovery.segments.some(segment => segment.kind === 'hazard')) errors.push(`${platform.id}: unsafe moving-platform recovery`);
      if (recovery && after) {
        if (after.motion && after.segments.some(segment => segment.kind === 'hazard')) errors.push(`${platform.id}: unsafe animated arrival after moving recovery`);
        for (let sample = 0; sample <= 24; sample += 1) {
          const arrival = recovery.route.angle - recovery.gapWidth / 2 + recovery.gapWidth * sample / 24;
          if (localKind(after, arrival - after.baseRotation) === 'hazard') errors.push(`${platform.id}: unsafe route after moving-platform recovery`);
        }
      }
    }
    if (platform.walls.length) {
      if (platform.motion || platform.silhouette !== 'broadRing' || platform.hazardShoulder !== 'none'
        || platform.segments.some(segment => segment.kind === 'hazard')) errors.push(`${platform.id}: wall stacks precision, motion or hazard pressure`);
      for (let offset = 1; offset <= GENERATION.wall.staticRecoveryCount; offset++) {
        const recovery = regular[index + offset];
        if (!recovery || recovery.type !== 'static' || recovery.route.role !== 'recovery'
          || !(offset === 1 ? ['broadRing'] : ['broadRing', 'offsetRing', 'mediumCrescent', 'twoCrescents']).includes(recovery.silhouette)
          || recovery.segments.some(segment => segment.kind === 'hazard')) errors.push(`${platform.id}: missing ordinary wall recovery spacing`);
      }
      if (regular.slice(Math.max(0, index - GENERATION.wall.staticRecoveryCount), index).some(item => item.walls.length)) errors.push(`${platform.id}: consecutive demanding wall sequence`);
    }
    if (platform.motion?.variant === 'breathing-double-pincer') {
      if (index < GENERATION.openingCount + 2) errors.push(`${platform.id}: demanding pincer in opening decision`);
      if (previous?.motion?.variant === 'breathing-double-pincer' || ['divider', 'stinger'].includes(previous?.type)
        || regular[index + 1]?.type === 'stinger' || regular[index + 1]?.silhouette === 'tinyLedge') errors.push(`${platform.id}: unsafe demanding pincer adjacency`);
    }
    if (platform.type === 'stinger' && (previous?.type === 'stinger' || previous?.type === 'divider')) errors.push(`${platform.id}: stinger adjacency`);
    if (flow && (hazardWidth > EPSILON || isSpecial || platform.walls.length > 0 || platform.motion)) errors.push(`${platform.id}: unsafe Flow obstacle`);
    if (flow && !between(gapWidth, ...GENERATION.flow.gapWidth)) errors.push(`${platform.id}: invalid Flow gap width`);
    if (!flow && platform.type !== 'stinger' && (!GENERATION.profiles[level.difficulty]
      || !between(platform.gapWidth, ...GENERATION.profiles[level.difficulty].gapWidth))) errors.push(`${platform.id}: invalid profile gap width`);
    const routeLocal = normalizeAngle(platform.route.angle - platform.baseRotation);
    if (localKind(platform, routeLocal) !== 'gap'
      || !between(platform.route.halfWidth, GENERATION.routeMargin, platform.gapWidth / 2)) errors.push(`${platform.id}: invalid intended gap corridor`);
    const corridor = splitCircularInterval(routeLocal - platform.route.halfWidth, routeLocal + platform.route.halfWidth);
    if (corridor.some(opening => platform.segments.some(segment =>
      opening.start < segment.end - EPSILON && segment.start < opening.end - EPSILON))) errors.push(`${platform.id}: intended corridor overlaps actual geometry`);
    if (previous?.route && !flow) {
      const turn = Math.abs(signedRouteDelta(platform.route.angle - previous.route.angle));
      if (turn > GENERATION.maxRouteStep + EPSILON) errors.push(`${platform.id}: unreachable route step`);
      // At each planned arrival the old corridor centre is either still open,
      // or provides a safe catch with enough bounce time to reach the next gap.
      if (!isSpecial && platform.route.role !== 'smash'
        && localKind(platform, previous.route.angle - platform.baseRotation) === 'hazard') errors.push(`${platform.id}: unsafe route arrival`);
      if (turn / GENERATION.routeTurnSpeed > 2 * CONFIG.physics.bounceVelocity / CONFIG.physics.bounceGravity) errors.push(`${platform.id}: insufficient bounce steering time`);
    }
  }
  if (regular[0] && localKind(regular[0], CONFIG.world.ballWorldAngle - regular[0].baseRotation) !== 'safe') errors.push('First holding bounce is not safe');
  const specialCount = regular.length - counts.static;
  if (specialCount > Math.floor(regular.length * GENERATION.maxSpecialDensity)) errors.push('Excessive special-platform density');
  if (counts.stinger > (level.difficulty === 'challenge' ? 2 : 1) || counts.divider > (GENERATION.profiles[level.difficulty]?.maxDividers || 0)) errors.push('Excessive demanding obstacle count');
  if (level.obstacleCounts && Object.keys(counts).some(type => counts[type] !== level.obstacleCounts[type])) errors.push('Obstacle count metadata mismatch');
  if (flow) errors.push(...validateFlowPath(level).errors);
  else {
    const profile = GENERATION.profiles[level.difficulty];
    const walls = counts.lowWall + counts.divider;
    const animated = counts.breathing + counts.orbiting + counts.stinger;
    if (walls && !between(walls, ...(level.wallFocused ? profile.wallFocusedCount : profile.wallCount))) errors.push('Wall count outside difficulty range');
    if (!between(animated, ...profile.animatedCount)) errors.push('Animated count outside difficulty range');
    if (counts.static <= regular.length / 2) errors.push('Static platforms must remain the majority');
    if (!level.obstacleTargets || level.obstacleTargets.walls !== walls || level.obstacleTargets.animated !== animated) errors.push('Obstacle target metadata mismatch');
    const placement = level.obstaclePlacement;
    const reasonTotal = reasons => reasons && typeof reasons === 'object' && !Array.isArray(reasons)
      && Object.values(reasons).every(value => Number.isSafeInteger(value) && value >= 0)
      ? Object.values(reasons).reduce((sum, value) => sum + value, 0) : -1;
    if (!placement || placement.placedWalls !== walls || placement.placedAnimated !== animated
      || placement.proposedWalls !== level.obstacleTargets?.requestedWalls
      || placement.requestedAnimated !== level.obstacleTargets?.requestedAnimated
      || !Number.isSafeInteger(placement.proposedWalls) || placement.proposedWalls < walls
      || !Number.isSafeInteger(placement.requestedAnimated) || placement.requestedAnimated < animated
      || placement.rejectedWalls !== placement.proposedWalls - walls
      || placement.rejectedAnimated !== placement.requestedAnimated - animated
      || reasonTotal(placement.wallRejectionReasons) !== placement.rejectedWalls
      || reasonTotal(placement.animationRejectionReasons) !== placement.rejectedAnimated
      || !Number.isSafeInteger(placement.planAttempts) || placement.planAttempts < 0) errors.push('Obstacle proposal/rejection metadata mismatch');
    if (!Number.isFinite(level.specialDensity) || Math.abs(level.specialDensity - (walls + animated) / regular.length) > EPSILON) errors.push('Special-density metadata mismatch');
    if (Boolean(level.wallFocused) !== (level.archetype === 'Wall-Focused Counterturns')) errors.push('Wall-focused archetype metadata mismatch');
    if (level.wallFocused && (walls < profile.wallFocusedCount[0] || walls < 2
      || new Set(regular.filter(platform => platform.motion).map(platform => platform.motion.type)).size > 1)) errors.push('Unreadable wall-focused archetype');
    let animatedRun = 0;
    for (const platform of regular) {
      animatedRun = platform.motion ? animatedRun + 1 : 0;
      if (animatedRun > GENERATION.maxAnimatedConsecutive) errors.push(`${platform.id}: excessive consecutive animations`);
    }
    errors.push(...validateNormalRoute(level).errors);
    errors.push(...validateDifficulty(level));
    if (!level.smashOpportunities?.length) errors.push('Missing planned smash opportunity');
    for (const opportunity of level.smashOpportunities || []) {
      const { start, passes, catchIndex, recoveryIndex, angle } = opportunity;
      if (passes < CONFIG.smash.threshold || catchIndex !== start + passes || recoveryIndex !== catchIndex + 1) errors.push('Invalid smash sequence');
      for (let index = start; index < catchIndex; index += 1) {
        const platform = regular[index];
        if (!platform || platform.type !== 'static' || localKind(platform, angle - platform.baseRotation) !== 'gap') errors.push('Blocked planned long drop');
      }
      const catcher = regular[catchIndex];
      const recovery = regular[recoveryIndex];
      if (!catcher || catcher.type !== 'static' || localKind(catcher, angle - catcher.baseRotation) === 'gap') errors.push('Missing solid smash catch');
      if (!recovery || recovery.type !== 'static' || recovery.route.role !== 'recovery') errors.push('Missing smash recovery');
      else {
        const sharedHalfWidth = Math.min(...regular.slice(start, catchIndex).map(platform => platform.gapWidth / 2));
        for (let sample = 0; sample <= 24; sample += 1) {
          const arrival = angle - sharedHalfWidth + sharedHalfWidth * 2 * sample / 24;
          if (catcher && localKind(catcher, arrival - catcher.baseRotation) === 'gap') errors.push('Gap beneath planned smash corridor');
          if (localKind(recovery, arrival - recovery.baseRotation) === 'hazard') errors.push('Hazard beneath planned smash corridor');
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}


function validateDifficulty(level) {
  const errors = [];
  const platforms = level.platforms.filter(platform => !platform.finish);
  const profile = GENERATION.profiles[level.difficulty];
  const caps = SILHOUETTE_CONFIG.profiles[level.difficulty];
  let tiny = 0, islands = 0, smallRun = 0, used = 0;
  const route = analyzeRoute(level);
  const sections = [];
  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    if (!platform.silhouette) { errors.push(`${platform.id}: missing silhouette metadata`); continue; }
    const { metrics } = validatePlatformSilhouette(platform);
    tiny += metrics.tiny ? 1 : 0;
    islands += metrics.hazardIslands || 0;
    smallRun = metrics.small ? smallRun + 1 : 0;
    if (smallRun > GENERATION.complexity.maxConsecutiveSmall) errors.push(`${platform.id}: consecutive small-platform pressure`);
    if (metrics.tiny && (platforms[index - 1]?.type !== 'static'
      || platforms[index + 1]?.silhouette !== 'broadRing')) errors.push(`${platform.id}: tiny target lacks safe neighbours/recovery`);
    if (platforms[index - 1]?.type === 'divider' && platform.hazardShoulder === 'double') errors.push(`${platform.id}: double shoulder after divider`);
    const transition = route.transitions[index - 1];
    const prior = route.transitions[index - 2];
    const reversal = transition?.direction && prior?.direction && transition.direction !== prior.direction
      && Math.abs(transition.delta) >= Math.PI / 2 ? GENERATION.complexity.costs.largeReversal : 0;
    const planned = level.smashOpportunities.some(drop => drop.start === index) ? GENERATION.complexity.costs.plannedDrop : 0;
    const expectedCost = (SILHOUETTE_CONFIG.costs[platform.silhouette] || 0)
      + (platform.hazardShoulder === 'double' ? SILHOUETTE_CONFIG.costs.doubleShoulder : platform.hazardShoulder === 'none' ? 0 : SILHOUETTE_CONFIG.costs.shoulder)
      + (metrics.hazardIslands || 0) * SILHOUETTE_CONFIG.costs.hazardIsland
      + (SILHOUETTE_CONFIG.costs[platform.type] || 0) + reversal + planned
      + breathingBudgetSurcharge(platform.motion)
      + (platform.walls.length && platforms.slice(0, index).some(item => item.walls.length) ? GENERATION.complexity.costs.additionalWall : 0)
      + (level.wallFocused && platform.walls.length ? GENERATION.complexity.costs.wallFocused : 0)
      + (platform.motion && platforms[index - 1]?.motion ? GENERATION.complexity.costs.adjacentAnimation : 0);
    // Stinger names describe their obstacle, not an additional silhouette cost.
    const actualCost = expectedCost - (platform.silhouette === 'stinger' ? SILHOUETTE_CONFIG.costs.stinger : 0);
    if (!Number.isFinite(platform.difficultyCost) || Math.abs(platform.difficultyCost - actualCost) > EPSILON) errors.push(`${platform.id}: invalid complexity cost`);
    used += actualCost;
    const section = Math.floor(index / GENERATION.complexity.sectionLength);
    sections[section] = (sections[section] || 0) + actualCost;
  }
  if (tiny > caps.maxTiny || islands > caps.maxHazardIslands) errors.push('Excessive tiny targets or isolated hazard pieces');
  if (used > profile.levelBudget + EPSILON || sections.some(section => section > profile.sectionBudget + EPSILON)) errors.push('Difficulty complexity budget exceeded');
  const budget = level.difficultyBudget;
  if (!budget || !Number.isFinite(budget.used) || Math.abs(budget.used - used) > EPSILON
    || budget.limit !== profile.levelBudget || budget.sectionLimit !== profile.sectionBudget
    || budget.sectionLength !== GENERATION.complexity.sectionLength
    || !Array.isArray(budget.sections) || budget.sections.length !== sections.length
    || sections.some((cost, index) => !Number.isFinite(budget.sections[index]) || Math.abs(cost - budget.sections[index]) > EPSILON)) {
    errors.push('Difficulty-budget metadata mismatch');
  }
  return errors;
}
