import { GENERATION } from './GenerationConfig.js';
import { isBritishMilestone, BRITISH_MILESTONE_CADENCE } from './BritishMilestone.js';

const ARCHETYPES = {
  'Wide Static': { types: [], density: 0 },
  'Counterturn Static': { types: [], density: 0 },
  'Alternating Gaps': { types: [], density: 0 },
  'Breathing Gaps': { types: ['breathing'], density: 0.14 },
  'Orbiting Patterns': { types: ['orbiting'], density: 0.14 },
  'Low-Wall Timing': { types: ['lowWall'], density: 0.1 },
  'Divider Navigation': { types: ['divider'], density: 0.045 },
  'Wall-Focused Counterturns': { types: ['lowWall', 'divider'], density: 0.2 },
  'Stinger Timing': { types: ['stinger'], density: 0.045 },
  'Mixed Motion': { types: ['breathing', 'orbiting'], density: 0.17 },
  'Long-Drop Opportunities': { types: [], density: 0 },
  'Flow Spiral': { types: [], density: 0 },
};

const slot = (difficulty, archetype) => {
  const profile = GENERATION.profiles[difficulty];
  const mechanic = ARCHETYPES[archetype];
  return Object.freeze({ difficulty, archetype, kind: difficulty === 'flow' ? 'flow' : 'normal',
    wallFocused: archetype === 'Wall-Focused Counterturns',
    permittedTypes: mechanic.types, specialDensity: difficulty === 'gentle' ? Math.min(mechanic.density, 0.07) : mechanic.density,
    targetHazardCoverage: profile ? profile.hazardWidth.map(width => width / (Math.PI * 2)) : [0, 0],
    gapWidth: profile?.gapWidth || GENERATION.flow.gapWidth,
    ratingRange: profile?.rating || [1, 1],
  });
};

// A readable fifty-level rhythm. Each challenge is followed by a gentle recovery.
// Roles repeat; seeds do not. Absolute progress never increases these limits.
export const LEVEL_CADENCE = Object.freeze([
  slot('gentle', 'Wide Static'), slot('standard', 'Counterturn Static'), slot('standard', 'Breathing Gaps'),
  slot('gentle', 'Alternating Gaps'), slot('standard', 'Orbiting Patterns'), slot('challenge', 'Low-Wall Timing'),
  slot('gentle', 'Wide Static'), slot('standard', 'Stinger Timing'), slot('gentle', 'Long-Drop Opportunities'), slot('flow', 'Flow Spiral'),
  slot('standard', 'Alternating Gaps'), slot('standard', 'Wall-Focused Counterturns'), slot('challenge', 'Breathing Gaps'),
  slot('gentle', 'Wide Static'), slot('standard', 'Orbiting Patterns'), slot('standard', 'Divider Navigation'),
  slot('challenge', 'Mixed Motion'), slot('gentle', 'Counterturn Static'), slot('standard', 'Long-Drop Opportunities'), slot('flow', 'Flow Spiral'),
  slot('gentle', 'Wide Static'), slot('standard', 'Breathing Gaps'), slot('standard', 'Orbiting Patterns'),
  slot('gentle', 'Low-Wall Timing'), slot('standard', 'Stinger Timing'), slot('challenge', 'Wall-Focused Counterturns'),
  slot('gentle', 'Counterturn Static'), slot('standard', 'Mixed Motion'), slot('standard', 'Long-Drop Opportunities'), slot('flow', 'Flow Spiral'),
  slot('gentle', 'Wide Static'), slot('standard', 'Orbiting Patterns'), slot('challenge', 'Stinger Timing'),
  slot('gentle', 'Counterturn Static'), slot('standard', 'Low-Wall Timing'), slot('standard', 'Breathing Gaps'),
  slot('challenge', 'Mixed Motion'), slot('gentle', 'Wide Static'), slot('standard', 'Long-Drop Opportunities'), slot('flow', 'Flow Spiral'),
  slot('gentle', 'Wide Static'), slot('standard', 'Divider Navigation'), slot('standard', 'Breathing Gaps'),
  slot('gentle', 'Low-Wall Timing'), slot('standard', 'Stinger Timing'), slot('challenge', 'Orbiting Patterns'),
  slot('gentle', 'Counterturn Static'), slot('standard', 'Mixed Motion'), slot('standard', 'Long-Drop Opportunities'), slot('flow', 'Flow Spiral'),
]);

export function cadenceForLevel(levelNumber) {
  const number = Number.isSafeInteger(levelNumber) && levelNumber > 0 ? levelNumber : 1;
  const cadenceSlot = (number - 1) % LEVEL_CADENCE.length + 1;
  if (isBritishMilestone(number)) return { ...BRITISH_MILESTONE_CADENCE, cadenceSlot };
  return { ...LEVEL_CADENCE[cadenceSlot - 1], cadenceSlot };
}
