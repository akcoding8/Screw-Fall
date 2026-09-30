import { GENERATION } from './GenerationConfig.js';
import { finishLevel, makePlatform } from './LevelGeometry.js';
import { getFlowFeasibility } from './FlowFeasibility.js';
import { clamp, TAU } from './math.js';

/**
 * Construct in unwrapped angles: crossing 2π remains a small forward movement,
 * not a nearly complete backwards turn. Only the platform base is normalized.
 */
export function generateFlowLevel(metadata, random, { conservative = false } = {}) {
  const tuning = GENERATION.flow;
  const count = random.integer(...GENERATION.flowCount);
  const direction = random.next() < 0.5 ? -1 : 1;
  const turns = conservative ? tuning.rotations[0] : random.range(...tuning.rotations);
  const phase = random.range(0, TAU);
  const widthPhase = random.range(0, TAU);
  const openingCount = random.integer(...tuning.openingCount);
  const weights = [];
  for (let index = 0; index < count - 1; index++) {
    // The smooth ramp continues beyond the labelled opening, avoiding a
    // sudden switch to full demand at its final platform.
    const progress = clamp(index / (openingCount + 4), 0, 1);
    const ramp = progress * progress * (3 - 2 * progress);
    const wave = tuning.routeWaveAmplitude * Math.sin(index / (count - 1) * TAU + phase);
    weights.push((tuning.openingRateRatio + (1 - tuning.openingRateRatio) * ramp) * (1 + wave));
  }
  const scale = turns * TAU / weights.reduce((sum, value) => sum + value, 0);
  const platforms = [];
  let angle = 0;
  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    const [minWidth, maxWidth] = GENERATION.flow.gapWidth;
    const width = minWidth + (maxWidth - minWidth) * (0.5 + 0.5 * Math.sin(progress * TAU + widthPhase));
    platforms.push(makePlatform(index, angle, width, 0, 'flow'));
    if (index < count - 1) angle += direction * weights[index] * scale;
  }
  const level = finishLevel({ ...metadata, flow: { rotations: turns, direction, openingCount,
    maxTurnSpeed: tuning.maxTurnSpeed, modelVersion: 1 } }, platforms);
  level.flow.feasibility = getFlowFeasibility(level);
  return level;
}
