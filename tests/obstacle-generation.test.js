import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/game/LevelGenerator.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { MOTION_LIMITS, WALL_CONFIG } from '../src/game/ObstacleConfig.js';
import { validateLevel } from '../src/game/LevelValidator.js';
import { analyzeGapAlignment, analyzeRoute } from '../src/game/RouteAnalysis.js';
import { evaluatePlatformMotion } from '../src/game/PlatformMotion.js';
import { CONFIG } from '../src/game/config.js';
import { normalizeAngle } from '../src/game/math.js';

let levels;
beforeAll(() => { levels = Array.from({ length: 600 }, (_, index) => generateLevel(index + 1)); });
const normal = difficulty => levels.filter(level => level.difficulty === difficulty);
const walls = level => level.platforms.flatMap(platform => platform.walls);
const moving = level => level.platforms.filter(platform => platform.motion);
function fixture(predicate) {
  const level = levels.find(predicate);
  if (!level) throw new Error('Required obstacle fixture missing from bounded sample');
  return structuredClone(level);
}

describe('bounded normal wall and animation distributions', () => {
  it.each([
    ['gentle', .15, .30, 1], ['standard', .70, .85, 5], ['challenge', .90, 1, 6],
  ])('%s walls occur at the intended frequency and stay within the count envelope', (difficulty, minimum, maximum, cap) => {
    const sample = normal(difficulty);
    const withWalls = sample.filter(level => walls(level).length);
    expect(withWalls.length / sample.length).toBeGreaterThanOrEqual(minimum);
    expect(withWalls.length / sample.length).toBeLessThanOrEqual(maximum);
    for (const level of withWalls) {
      expect(walls(level).length).toBeGreaterThanOrEqual((level.wallFocused ? GENERATION.profiles[difficulty].wallFocusedCount : GENERATION.profiles[difficulty].wallCount)[0]);
      expect(walls(level).length).toBeLessThanOrEqual(cap);
    }
  });

  it('keeps jumpable low walls at 65–75% of all generated walls', () => {
    const all = levels.flatMap(walls);
    const low = all.filter(wall => wall.type === 'low').length;
    expect(low / all.length).toBeGreaterThanOrEqual(.65);
    expect(low / all.length).toBeLessThanOrEqual(.75);
    expect(normal('gentle').flatMap(walls).filter(wall => wall.type === 'divider').length / normal('gentle').length).toBeLessThan(.05);
  });

  it.each(['gentle', 'standard', 'challenge'])('%s animated counts are bounded with static platforms in the majority', difficulty => {
    for (const level of normal(difficulty)) {
      const count = moving(level).length;
      expect(count).toBeGreaterThanOrEqual(GENERATION.profiles[difficulty].animatedCount[0]);
      expect(count).toBeLessThanOrEqual(GENERATION.profiles[difficulty].animatedCount[1]);
      expect(level.obstacleCounts.static).toBeGreaterThan(level.platformCount / 2);
      expect(new Set(moving(level).map(platform => platform.type)).size).toBeLessThanOrEqual(difficulty === 'gentle' ? 1 : 2);
      let run = 0;
      for (const platform of level.platforms) {
        run = platform.motion ? run + 1 : 0;
        expect(run).toBeLessThanOrEqual(2);
      }
    }
    if (difficulty === 'gentle') expect(normal(difficulty).filter(level => !moving(level).length).length).toBeGreaterThan(normal(difficulty).length / 2);
  });

  it('moderately increases moving stingers while bounding their count and recovery', () => {
    const standard = normal('standard');
    const challenge = normal('challenge');
    expect(standard.reduce((sum, level) => sum + level.obstacleCounts.stinger, 0) / standard.length).toBeGreaterThan(360 / 2761);
    expect(challenge.reduce((sum, level) => sum + level.obstacleCounts.stinger, 0) / challenge.length).toBeGreaterThan(185 / 842);
    for (const level of [...standard, ...challenge]) for (const platform of moving(level).filter(platform => platform.type === 'stinger')) {
      expect(level.platforms[platform.index + 1].type).toBe('static');
      expect(level.platforms[platform.index - 1].type).not.toBe('stinger');
      expect(level.obstacleCounts.stinger).toBeLessThanOrEqual(level.difficulty === 'challenge' ? 2 : 1);
    }
  });

  it('keeps two readable static recoveries after every wall and never creates an opposing cage', () => {
    for (const level of levels) for (const platform of level.platforms.filter(platform => platform.walls.length)) {
      expect(platform.walls).toHaveLength(1);
      expect(platform.motion).toBeUndefined();
      expect(platform.silhouette).toBe('broadRing');
      expect(platform.hazardShoulder).toBe('none');
      for (let offset = 1; offset <= 2; offset++) {
        const recovery = level.platforms[platform.index + offset];
        expect(recovery.type).toBe('static');
        expect(recovery.route.role).toBe('recovery');
        expect(recovery.segments.every(segment => segment.kind === 'safe')).toBe(true);
        if (offset === 1) expect(recovery.silhouette).toBe('broadRing');
      }
    }
  });

  it('adds occasional wall-focused counterturn towers with one animation family and a separate planned drop', () => {
    const focused = levels.filter(level => level.wallFocused);
    expect(focused).toHaveLength(24);
    for (const level of focused) {
      expect(level.archetype).toBe('Wall-Focused Counterturns');
      expect(walls(level).length).toBeGreaterThanOrEqual(level.difficulty === 'challenge' ? 5 : 4);
      expect(new Set(moving(level).map(platform => platform.type)).size).toBe(1);
      expect(level.plannedDrops.length).toBeGreaterThanOrEqual(1);
      expect(analyzeRoute(level).longestSameDirectionRun).toBeLessThanOrEqual(3);
    }
  });

  it('retains all fifteen shapes, disconnected orbit patterns, shoulders and hazard islands', () => {
    const platforms = levels.filter(level => level.kind === 'normal').flatMap(level => level.platforms.filter(platform => !platform.finish));
    expect(new Set(platforms.filter(platform => platform.silhouette !== 'stinger').map(platform => platform.silhouette)).size).toBe(15);
    expect(platforms.some(platform => platform.type === 'orbiting' && platform.silhouetteMetrics.pieceCount > 1)).toBe(true);
    expect(platforms.some(platform => platform.hazardShoulder === 'double')).toBe(true);
    expect(platforms.some(platform => platform.silhouetteMetrics.hazardIslands)).toBe(true);
    expect(platforms.some(platform => platform.silhouetteMetrics.tiny)).toBe(true);
  });

  it('retains route, alignment, budget and Flow invariants across twelve full cadence cycles', () => {
    for (const level of levels) {
      expect(level.fallback, `Level ${level.levelNumber}`).toBe(false);
      expect(validateLevel(level).errors).toEqual([]);
      if (level.kind === 'flow') {
        expect(walls(level)).toHaveLength(0);
        expect(moving(level)).toHaveLength(0);
      } else {
        const route = analyzeRoute(level), gaps = analyzeGapAlignment(level);
        expect(route.longestSameDirectionRun).toBeLessThanOrEqual(3);
        expect(route.reversalRate).toBeGreaterThanOrEqual(.35);
        expect(route.directionBalance).toBeGreaterThanOrEqual(.60);
        expect(gaps.hardViolationCount).toBe(0);
        expect(gaps.repeatedThreeWindows).toBe(0);
        expect(level.difficultyBudget.used).toBeLessThanOrEqual(GENERATION.profiles[level.difficulty].levelBudget);
      }
    }
  });
});

describe('legible predictable dynamic tuning', () => {
  it('increases the Phase 2.2 breathing span by 50% without narrowing below the approved fair opening', () => {
    for (const level of levels) for (const platform of moving(level).filter(platform => platform.type === 'breathing')) {
      const motion = platform.motion;
      const priorMinimum = Math.max(66 * Math.PI / 180, platform.gapWidth - .25);
      const priorMaximum = Math.min(112 * Math.PI / 180, platform.gapWidth + .17);
      expect(motion.maxWidth - motion.minWidth).toBeCloseTo((priorMaximum - priorMinimum) * 1.25 * 1.5, 12);
      expect(motion.minWidth).toBeGreaterThanOrEqual(MOTION_LIMITS.breathing.minWidth);
      expect(motion.maxWidth).toBeLessThanOrEqual(MOTION_LIMITS.breathing.maxWidth);
      expect(motion.period).toBeGreaterThanOrEqual(GENERATION.profiles[level.difficulty].breathingPeriod[0]);
      expect(motion.period).toBeLessThanOrEqual(GENERATION.profiles[level.difficulty].breathingPeriod[1]);
      let previous = evaluatePlatformMotion(platform, 0).gapWidth;
      for (let tick = 1; tick <= 120; tick++) {
        const current = evaluatePlatformMotion(platform, tick / 120).gapWidth;
        expect(Math.abs(current - previous)).toBeLessThan(.012);
        previous = current;
      }
      delete platform.motionState;
    }
  });

  it('increases orbit and stinger travel while avoiding fastest speed on narrow targets', () => {
    for (const level of levels) for (const platform of moving(level).filter(platform => platform.motion.speed)) {
      const speed = Math.abs(platform.motion.speed);
      const profile = GENERATION.profiles[level.difficulty];
      const range = platform.type === 'stinger' ? profile.stingerSpeed : profile.speed;
      expect(speed).toBeGreaterThanOrEqual(range[0]);
      expect(speed).toBeLessThanOrEqual(range[1]);
      if (platform.type === 'orbiting' && platform.gapWidth < 74 * Math.PI / 180) expect(speed).toBeLessThanOrEqual(.50);
      if (platform.type === 'stinger' && platform.segments[1].end - platform.segments[1].start < 34 * Math.PI / 180) expect(speed).toBeLessThanOrEqual(.46);
      const initial = evaluatePlatformMotion(platform, .5).rotation;
      expect(evaluatePlatformMotion(platform, 1.5).rotation - initial).toBeCloseTo(platform.motion.speed, 12);
      delete platform.motionState;
    }
  });

  it('keeps wall dimensions tied to the unchanged physical bounce', () => {
    const apex = CONFIG.physics.bounceVelocity ** 2 / (2 * CONFIG.physics.bounceGravity);
    expect(WALL_CONFIG.lowHeight).toBe(.9);
    expect(WALL_CONFIG.dividerHeight).toBe(1.87);
    expect(WALL_CONFIG.lowHeight).toBeLessThan(apex);
    expect(WALL_CONFIG.dividerHeight).toBeGreaterThan(apex);
  });
});

describe('independent obstacle validation rejects forged or unsafe content', () => {
  it.each([5, 10])('rejects hidden wall and motion geometry on the finish floor of level %s', number => {
    const level = generateLevel(number);
    const finish = level.platforms.at(-1);
    finish.walls = [{ type: 'divider', angle: 1, height: 1.87, width: .12, innerRadius: .77, outerRadius: 2.81 }];
    finish.motion = { type: 'orbiting', phase: 0, speed: .4 };
    expect(validateLevel(level).errors).toContain('Finish floor contains invalid state or obstacles');
  });

  it('checks route clearance in the actual wall-local frame rather than assuming a zero-centred intended corridor', () => {
    const level = fixture(level => level.platforms.some(platform => platform.walls.length));
    const platform = level.platforms.find(platform => platform.walls.length);
    const incoming = level.platforms[platform.index - 1].route.angle - platform.route.angle;
    platform.baseRotation = normalizeAngle(platform.baseRotation - .4);
    platform.route.halfWidth = level.route[platform.index].halfWidth = .15;
    platform.walls[0].angle = normalizeAngle(incoming + .2);
    expect(validateLevel(level).errors).toContain(`${platform.id}: wall obstructs intended recovery route`);
  });

  it.each([
    ['impossible radial tip', (level, platform) => { platform.walls[0].innerRadius = CONFIG.world.ballOrbitRadius; }, 'wall does not span complete sphere orbit'],
    ['unsupported wall', (level, platform) => { platform.walls[0].angle = 0; }, 'wall is not supported by safe geometry'],
    ['opposing cage', (level, platform) => { platform.walls.push({ ...platform.walls[0], angle: normalizeAngle(platform.walls[0].angle + Math.PI) }); }, 'opposing wall trap'],
    ['second recovery removed', (level, platform) => { const recovery = level.platforms[platform.index + 2]; recovery.route.role = level.route[recovery.index].role = 'turn'; }, 'missing ordinary wall recovery spacing'],
  ])('rejects %s from geometry rather than trusting reported counts', (_name, mutate, message) => {
    const level = fixture(level => level.platforms.some(platform => platform.walls.length));
    const platform = level.platforms.find(platform => platform.walls.length);
    mutate(level, platform);
    expect(validateLevel(level).errors).toContain(`${platform.id}: ${message}`);
  });

  it('rejects forged wall targets, reported count and budget metadata independently', () => {
    const level = fixture(level => level.platforms.some(platform => platform.walls.length));
    level.obstacleTargets.walls = 0;
    level.obstacleCounts.lowWall = -1;
    level.difficultyBudget.used = 0;
    const errors = validateLevel(level).errors;
    expect(errors).toContain('Obstacle target metadata mismatch');
    expect(errors).toContain('Obstacle count metadata mismatch');
    expect(errors).toContain('Difficulty-budget metadata mismatch');
  });

  it.each(['amplitude', 'period', 'speed'])('rejects excessive animation %s', property => {
    const level = fixture(level => moving(level).some(platform => property === 'speed' ? platform.motion.speed : platform.type === 'breathing'));
    const platform = moving(level).find(platform => property === 'speed' ? platform.motion.speed : platform.type === 'breathing');
    if (property === 'amplitude') platform.motion.maxWidth += .1;
    if (property === 'period') platform.motion.period = .3;
    if (property === 'speed') platform.motion.speed = 20;
    expect(validateLevel(level).valid).toBe(false);
  });
});

describe('Phase 2.3 measured hazard-pincer mix and placement', () => {
  const variants = ['breathing-safe', 'breathing-single-tip', 'breathing-double-pincer'];

  it.each(['gentle', 'standard', 'challenge'])('%s achieves the three breathing variant targets in twelve full cadence cycles', difficulty => {
    const platforms = normal(difficulty).flatMap(moving).filter(platform => platform.type === 'breathing');
    const bounds = GENERATION.distributionBounds.breathingVariants[difficulty];
    for (let index = 0; index < variants.length; index++) {
      const count = platforms.filter(platform => platform.motion.variant === variants[index]).length;
      expect(count / platforms.length).toBeGreaterThanOrEqual(bounds[index][0]);
      expect(count / platforms.length).toBeLessThanOrEqual(bounds[index][1]);
    }
  });

  it.each(['gentle', 'standard', 'challenge'])('%s animated encounters contain the intended hazard share while retaining safe recoveries', difficulty => {
    const platforms = normal(difficulty).flatMap(moving);
    const hazards = platforms.filter(platform => platform.segments.some(segment => segment.kind === 'hazard'));
    const range = GENERATION.distributionBounds.hazardousAnimatedFraction[difficulty];
    expect(hazards.length / platforms.length).toBeGreaterThanOrEqual(range[0]);
    expect(hazards.length / platforms.length).toBeLessThanOrEqual(range[1]);
    expect(hazards.length).toBeLessThan(platforms.length);
    expect(platforms.some(platform => platform.type === 'breathing' && platform.segments.some(segment => segment.kind === 'hazard'))).toBe(true);
    if (difficulty !== 'gentle') expect(platforms.filter(platform => platform.type === 'orbiting').some(platform => platform.segments.some(segment => segment.kind === 'hazard'))).toBe(true);
  });

  it('keeps selected tips through silhouette generation and alternates left/right single tips within each tower', () => {
    const observed = new Set();
    for (const level of levels) {
      let previousSide;
      for (const platform of moving(level).filter(platform => platform.type === 'breathing')) {
        const motion = platform.motion;
        const tips = platform.segments.filter(segment => segment.kind === 'hazard');
        expect(tips).toHaveLength(variants.indexOf(motion.variant));
        expect(tips.every(tip => tip.tipSide === 'left' || tip.tipSide === 'right')).toBe(true);
        if (motion.variant === 'breathing-single-tip') {
          if (previousSide) expect(motion.tipSide).not.toBe(previousSide);
          previousSide = motion.tipSide;
          observed.add(motion.tipSide);
        }
      }
    }
    expect([...observed].sort()).toEqual(['left', 'right']);
  });

  it('keeps double pincers out of opening decisions and supplies a safe catch without stacked demanding features', () => {
    for (const level of levels) for (const platform of moving(level).filter(platform => platform.motion.variant === 'breathing-double-pincer')) {
      const prior = level.platforms[platform.index - 1], next = level.platforms[platform.index + 1];
      expect(platform.index).toBeGreaterThanOrEqual(GENERATION.openingCount + 2);
      expect(prior.motion?.variant).not.toBe('breathing-double-pincer');
      expect(['divider', 'stinger']).not.toContain(prior.type);
      expect(next.type).toBe('static');
      expect(next.silhouette).toBe('broadRing');
      expect(next.segments.every(segment => segment.kind === 'safe')).toBe(true);
      expect(platform.walls).toHaveLength(0);
      if (platform.motion.minWidth < GENERATION.breathing.narrowThreshold) expect(platform.motion.period).toBeGreaterThanOrEqual(GENERATION.breathing.fastThreshold);
    }
  });

  it('protects arbitrary moving releases by keeping hazardous animations out of the second arrival', () => {
    for (const level of levels) for (const platform of moving(level)) {
      const after = level.platforms[platform.index + 2];
      if (after.motion) expect(after.segments.every(segment => segment.kind === 'safe')).toBe(true);
    }
  });

  it.each(['standard', 'challenge'])('%s wall-containing towers commonly reach the requested multiple-wall range', difficulty => {
    const sample = normal(difficulty).filter(level => walls(level).length);
    const counts = sample.map(level => walls(level).length).sort((a, b) => a - b);
    const range = difficulty === 'standard' ? [2, 4] : [3, 5];
    expect(counts.filter(count => count >= range[0] && count <= range[1]).length / counts.length).toBeGreaterThan(.70);
    expect(counts[Math.floor(counts.length / 2)]).toBeGreaterThanOrEqual(difficulty === 'standard' ? 3 : 4);
    expect(counts[Math.floor(counts.length * .9)]).toBeGreaterThanOrEqual(range[1]);
  });

  it('reports proposed counts and explains every omitted wall or animation rather than silently rewriting the target', () => {
    for (const level of levels.filter(level => level.kind === 'normal')) {
      const report = level.obstaclePlacement;
      expect(report.proposedWalls).toBe(level.obstacleTargets.requestedWalls);
      expect(report.placedWalls).toBe(walls(level).length);
      expect(report.proposedWalls - report.placedWalls).toBe(report.rejectedWalls);
      expect(Object.values(report.wallRejectionReasons).reduce((sum, count) => sum + count, 0)).toBe(report.rejectedWalls);
      expect(report.requestedAnimated - report.placedAnimated).toBe(report.rejectedAnimated);
      expect(Object.values(report.animationRejectionReasons).reduce((sum, count) => sum + count, 0)).toBe(report.rejectedAnimated);
      expect(report.planAttempts).toBeGreaterThan(0);
    }
  });

  it.each([100001, 100003, 100006, 100012, 100026, 1_000_000_003, 2 ** 40, Number.MAX_SAFE_INTEGER])('large level %s keeps bounded deterministic walls and pincers', number => {
    const first = generateLevel(number), retry = generateLevel(number);
    expect(first).toEqual(retry);
    expect(first.fallback).toBe(false);
    expect(validateLevel(first).errors).toEqual([]);
    if (first.kind === 'normal') {
      const profile = GENERATION.profiles[first.difficulty];
      expect(walls(first).length).toBeLessThanOrEqual((first.wallFocused ? profile.wallFocusedCount : profile.wallCount)[1]);
      expect(moving(first).length).toBeLessThanOrEqual(profile.animatedCount[1]);
    }
  });

  it('validates the declared pincer corridor against the closed opening rather than only the authored shape', () => {
    const level = fixture(level => moving(level).some(platform => platform.type === 'breathing' && platform.motion.minWidth < platform.gapWidth));
    const platform = moving(level).find(platform => platform.type === 'breathing' && platform.motion.minWidth < platform.gapWidth);
    const forgedHalfWidth = (platform.gapWidth + platform.motion.minWidth) / 4;
    platform.route.halfWidth = level.route[platform.index].halfWidth = forgedHalfWidth;
    expect(validateLevel(level).errors).toContain(`${platform.id}: intended pincer corridor exceeds the minimum opening`);
  });

  it('rejects forged pincer costs, unknown variants and inconsistent proposal diagnostics', () => {
    const level = fixture(level => moving(level).some(platform => platform.type === 'breathing'));
    const platform = moving(level).find(platform => platform.type === 'breathing');
    platform.motion.budgetCost = 0;
    expect(validateLevel(level).errors).toContain(`${platform.id}: pincer budget metadata mismatch`);
    platform.motion.variant = 'breathing-unknown';
    expect(validateLevel(level).errors).toContain(`${platform.id}: unknown breathing variant`);
    level.obstaclePlacement.rejectedWalls = 1;
    expect(validateLevel(level).errors).toContain('Obstacle proposal/rejection metadata mismatch');
  });
});
