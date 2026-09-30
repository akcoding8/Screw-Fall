import { CONFIG } from './config.js';
import { normalizeAngle, TAU } from './math.js';

export function ringSegments(gapWidth, hazardWidth = 0, hazardCenter = Math.PI) {
  const halfGap = gapWidth / 2;
  if (hazardWidth === 0) return [{ kind: 'safe', start: halfGap, end: TAU - halfGap }];
  const hazardStart = hazardCenter - hazardWidth / 2;
  const hazardEnd = hazardCenter + hazardWidth / 2;
  return [
    { kind: 'safe', start: halfGap, end: hazardStart },
    { kind: 'hazard', start: hazardStart, end: hazardEnd },
    { kind: 'safe', start: hazardEnd, end: TAU - halfGap },
  ];
}

export function makePlatform(index, angle, gapWidth, hazardWidth = 0, role = 'turn', hazardCenter = Math.PI) {
  return {
    id: `platform-${index}`, index, y: index === 0 ? 0 : -index * CONFIG.world.platformSpacing,
    baseRotation: normalizeAngle(angle), active: true, finish: false, type: 'static',
    gapWidth, segments: ringSegments(gapWidth, hazardWidth, hazardCenter), walls: [],
    route: { angle, halfWidth: gapWidth / 2, role },
  };
}

export function finishPlatform(count) {
  return { id: 'finish', index: count, y: -count * CONFIG.world.platformSpacing, baseRotation: 0,
    active: true, finish: true, type: 'finish', walls: [], segments: [{ kind: 'safe', start: 0, end: TAU }] };
}

export function finishLevel(metadata, platforms, smashOpportunities = []) {
  const obstacleCounts = { static: 0, breathing: 0, orbiting: 0, stinger: 0, lowWall: 0, divider: 0 };
  for (const platform of platforms) obstacleCounts[platform.type] += 1;
  return { ...metadata, name: metadata.archetype, platformCount: platforms.length, obstacleCounts,
    route: platforms.map(platform => ({ index: platform.index, y: platform.y, ...platform.route })),
    smashOpportunities, platforms: [...platforms, finishPlatform(platforms.length)] };
}
