import { GENERATION } from './GenerationConfig.js';
import { deriveSeed } from './SeededRandom.js';

export const BRITISH_MILESTONE_KIND = 'british-milestone';
export const BRITISH_MILESTONE_GENERATOR_VERSION = GENERATION.britishMilestone.version;
export const BRITISH_MILESTONE_THEME_VERSION = GENERATION.britishMilestone.themeVersion;

export function isBritishMilestone(number) {
  return Number.isSafeInteger(number) && number > 0 && number % 100 === 0;
}

// Namespaced seeds do not consume ordinary geometry or palette randomness.
export const britishGeometrySeed = (number, version = BRITISH_MILESTONE_GENERATOR_VERSION, attempt = 0) =>
  deriveSeed(number, `british-geometry-${version}`, attempt);
export const britishThemeSeed = number => deriveSeed(number, `british-theme-${BRITISH_MILESTONE_THEME_VERSION}`);

export function britishMilestoneMetadata(number) {
  return { index: number / 100, generatorVersion: BRITISH_MILESTONE_GENERATOR_VERSION,
    themeVersion: BRITISH_MILESTONE_THEME_VERSION, themeSeed: britishThemeSeed(number) };
}

export const BRITISH_MILESTONE_CADENCE = Object.freeze({
  kind: BRITISH_MILESTONE_KIND, difficulty: 'challenge', archetype: 'British Milestone',
  wallFocused: false, permittedTypes: Object.freeze(['breathing', 'orbiting', 'lowWall', 'divider']),
  specialDensity: .20, targetHazardCoverage: Object.freeze(GENERATION.profiles.challenge.hazardWidth.map(width => width / (Math.PI * 2))),
  gapWidth: GENERATION.profiles.challenge.gapWidth, ratingRange: GENERATION.profiles.challenge.rating,
});
