import { describe, expect, it } from 'vitest';
import { generateLevel } from '../src/game/LevelGenerator.js';
import { validateLevel } from '../src/game/LevelValidator.js';
import { analyzeGapAlignment, validateNormalRoute } from '../src/game/RouteAnalysis.js';
import { makePlatform } from '../src/game/LevelGeometry.js';
import { applyPlatformSilhouette, getPlatformSilhouetteMetrics, validatePlatformSilhouette } from '../src/game/PlatformSilhouettes.js';
import { SeededRandom } from '../src/game/SeededRandom.js';

function levelWith(predicate) {
  for (let number = 1; number <= 500; number++) {
    const level = generateLevel(number);
    if (predicate(level)) return level;
  }
  throw new Error('Required generated validation fixture missing from bounded sample');
}

function islandWithShoulder() {
  return applyPlatformSilhouette(makePlatform(13, 0, 1.3, .8), new SeededRandom(0), {
    difficulty: 'standard', previousAngle: 1.65, requestedSilhouette: 'safeHazardIslands', shoulderType: 'left',
  });
}

function setRoute(level, index, change) {
  Object.assign(level.route[index], change);
  Object.assign(level.platforms[index].route, change);
}

describe('route roles and metadata cannot bypass geometry validation', () => {
  it.each(['smash', 'longDrop', 'flow'])('rejects an ordinary platform relabelled as %s', role => {
    const level = generateLevel(17);
    const index = level.route.findIndex(point => point.role === 'turn');
    setRoute(level, index, { role });
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors.some(error => error.includes('route role'))).toBe(true);
  });

  it('rejects mismatched mirrored roles and fabricated direction counters', () => {
    const level = generateLevel(17);
    const index = level.route.findIndex(point => point.role === 'turn');
    level.platforms[index].route.role = 'smash';
    expect(validateLevel(level).errors).toContain(`platform-${index}: route metadata mismatch`);
    setRoute(level, index, { role: 'turn', delta: 0, direction: 0, directionRun: 0 });
    expect(validateLevel(level).errors).toContain(`platform-${index}: route direction metadata disagrees with angles`);
  });

  it('rejects a missing route angle rather than normalising it into a false zero', () => {
    const level = generateLevel(17);
    delete level.route[20].angle;
    delete level.platforms[20].route.angle;
    expect(() => validateLevel(level)).not.toThrow();
    expect(validateLevel(level).valid).toBe(false);
  });

  it('does not mistake total empty coverage for the width of the intended corridor', () => {
    const level = levelWith(level => level.platforms.some(platform => platform.silhouette === 'tinyLedge'));
    const platform = level.platforms.find(platform => platform.silhouette === 'tinyLedge');
    setRoute(level, platform.index, { halfWidth: platform.totalGapCoverage / 2 - .01 });
    expect(validateLevel(level).errors).toContain(`${platform.id}: invalid intended gap corridor`);
    expect(validateLevel(level).errors).toContain(`${platform.id}: intended corridor overlaps actual geometry`);
  });

  it('recomputes real four/five-platform intersections despite forged cached diagnostics', () => {
    const level = generateLevel(17);
    for (let index = 34; index < 39; index++) {
      const original = level.platforms[index];
      const ring = makePlatform(index, 0, original.gapWidth);
      Object.assign(original, { baseRotation: 0, segments: ring.segments,
        totalGapCoverage: ring.gapWidth, silhouette: 'broadRing', hazardShoulder: 'none', landingAngle: Math.PI, type: 'static', walls: [] });
      delete original.motion;
      original.silhouetteMetrics = getPlatformSilhouetteMetrics(original);
    }
    level.gapAlignment = { hardViolationCount: 0, accidental: [], windows: [] };
    expect(analyzeGapAlignment(level).hardViolationCount).toBeGreaterThan(0);
    expect(validateLevel(level).errors).toContain('Accidental unmarked four/five-platform common-gap corridor');
    // Fabricated membership on the platforms alone cannot authorise that gap.
    for (let index = 34; index < 39; index++) setRoute(level, index, { plannedDropId: 'invented' });
    expect(validateLevel(level).errors).toContain('Unmarked route claims planned-drop membership');
  });
});

describe('planned drops and mandatory recovery stay bounded', () => {
  it.each([null, {}, [null], [undefined], [{ start: -100, passes: 4 }]])('rejects malformed planned metadata without throwing: %s', plannedDrops => {
    const level = generateLevel(2);
    level.plannedDrops = plannedDrops;
    expect(() => validateLevel(level)).not.toThrow();
    expect(validateLevel(level).valid).toBe(false);
  });

  it('rejects six-platform drops even when both metadata copies agree', () => {
    const level = generateLevel(2);
    for (const drop of [level.plannedDrops[0], level.smashOpportunities[0]]) {
      drop.passes = 6;
      drop.catchIndex = drop.start + 6;
      drop.recoveryIndex = drop.catchIndex + 1;
    }
    expect(validateLevel(level).errors).toContain('Invalid or inconsistent planned-drop metadata');
  });

  it('rejects adjacent set pieces and missing smash recovery', () => {
    const level = levelWith(level => level.plannedDrops?.length === 2);
    const first = level.plannedDrops[0];
    const second = level.plannedDrops[1];
    second.start = first.recoveryIndex + 2;
    second.catchIndex = second.start + second.passes;
    second.recoveryIndex = second.catchIndex + 1;
    expect(validateNormalRoute(level).errors).toContain('Adjacent planned-drop sequences');
    const missingRecovery = generateLevel(2);
    setRoute(missingRecovery, missingRecovery.plannedDrops[0].recoveryIndex, { role: 'turn' });
    expect(validateLevel(missingRecovery).errors).toContain('Missing smash recovery');
  });

  it.each(['orbiting', 'breathing', 'stinger', 'divider'])('rejects tiny targets directly after %s', type => {
    const level = levelWith(level => level.platforms.some(platform => platform.silhouette === 'tinyLedge'));
    const tiny = level.platforms.find(platform => platform.silhouette === 'tinyLedge');
    level.platforms[tiny.index - 1].type = type;
    expect(validateLevel(level).errors).toContain(`${tiny.id}: tiny target lacks safe neighbours/recovery`);
  });

  it('requires a broad labelled recovery after an existing obstacle', () => {
    const level = generateLevel(17);
    const obstacle = level.platforms.find(platform => !platform.finish && platform.type !== 'static');
    setRoute(level, obstacle.index + 1, { role: 'turn' });
    expect(validateLevel(level).errors).toContain(`${obstacle.id}: missing broad recovery after obstacle`);
  });
});

describe('physical danger and budget reports match their actual contents', () => {
  it('paints the complete disconnected island even when a shoulder already split its arc', () => {
    const platform = islandWithShoulder();
    expect(platform.silhouette).toBe('safeHazardIslands');
    expect(platform.hazardShoulder).toBe('left');
    expect(platform.silhouetteMetrics.hazardIslands).toBe(1);
    expect(platform.segments).toHaveLength(2);
    expect(platform.segments[1].kind).toBe('hazard');
    expect(validatePlatformSilhouette(platform).errors).toEqual([]);
    platform.hazardShoulder = 'none';
    expect(validatePlatformSilhouette(platform).errors).toContain('Hazard shoulder metadata disagrees with actual opening edges');
  });

  it('rejects an island name whose isolated component is only partially hazardous', () => {
    const platform = islandWithShoulder();
    const island = platform.segments.pop();
    const middle = (island.start + island.end) / 2;
    platform.segments.push({ kind: 'safe', start: island.start, end: middle }, { kind: 'hazard', start: middle, end: island.end });
    platform.silhouetteMetrics = getPlatformSilhouetteMetrics(platform);
    expect(validatePlatformSilhouette(platform).errors).toContain('Island silhouette is missing its complete hazard-only piece');
  });

  it.each(['sections', 'limit', 'sectionLimit', 'sectionLength', 'used'])('rejects forged %s budget metadata', field => {
    const level = generateLevel(17);
    level.difficultyBudget[field] = field === 'sections' ? [] : 1000000;
    expect(validateLevel(level).errors).toContain('Difficulty-budget metadata mismatch');
  });
});
