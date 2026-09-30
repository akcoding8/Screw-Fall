import { CONFIG } from './config.js';
import { normalizeAngle } from './math.js';
import { classifySegmentsAtAngle } from './HazardCollision.js';
import { generateLevel } from './LevelGenerator.js';
import { selectPalette } from './PaletteManager.js';
import { getPlatformState, getPlatformRotation } from './PlatformMotion.js';
import { BRITISH_MILESTONE_KIND } from './BritishMilestone.js';
import { getBritishPalette } from './BritishMilestoneTheme.js';

/** Runtime endless geometry and presentation have independent deterministic seeds. */
export function createLevel(levelNumber = 1, { paletteStyle = 'soft' } = {}) {
  const level = generateLevel(levelNumber);
  const palette = level.kind === BRITISH_MILESTONE_KIND ? getBritishPalette(level.levelNumber, paletteStyle) : selectPalette(level.levelNumber, paletteStyle);
  return { ...level, palette, paletteId: palette.id };
}

export function classifyLocalAngle(platform, angle) {
  if (platform.finish) return 'finish';
  const state = getPlatformState(platform);
  return classifySegmentsAtAngle(state.segments, angle);
}

/**
 * Geometry uses x = r cos(a), z = r sin(a). Three.js positive rotation.y
 * decreases that mathematical angle; invert it using the authoritative local
 * motion rotation shared with the renderer and impact-time simulation.
 */
export function classifyPlatform(platform, towerRotation, worldAngle = CONFIG.world.ballWorldAngle) {
  const localAngle = normalizeAngle(worldAngle + towerRotation - getPlatformRotation(platform));
  return classifyLocalAngle(platform, localAngle);
}
