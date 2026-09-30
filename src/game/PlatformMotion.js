import { normalizeAngle } from './math.js';
import { CONFIG } from './config.js';
import { classifySegmentsAtAngle } from './HazardCollision.js';
import { sampleBreathingPhase, sampleBreathingSegments } from './PincerGeometry.js';

// A view's sample must never overwrite collision data. Weak ownership also
// releases the old level when its simulation and platform views are removed.
const renderStates = new WeakMap();

function createMotionState(platform) {
  return {
    rotation: platform.baseRotation,
    segments: platform.segments.map(segment => ({ ...segment })),
    time: 0,
    phase: 0,
    gapWidth: 0,
  };
}

/** One formula serves collision time and display time, using separate buffers. */
function sampleMotion(platform, time, state) {
  const motion = platform.motion;
  state.time = Number.isFinite(time) ? Math.max(0, time) : 0;
  state.rotation = platform.baseRotation;
  if (motion.type === 'breathing') {
    sampleBreathingPhase(motion, state.time, state);
    if (motion.variant) sampleBreathingSegments(state.segments, motion, state.gapWidth);
    else {
      // Existing authored/test breathing data remains readable without tips.
      const center = motion.gapCenter ?? 0;
      state.segments[0].start = center + state.gapWidth / 2;
      state.segments[state.segments.length - 1].end = center + Math.PI * 2 - state.gapWidth / 2;
    }
  } else {
    state.rotation += motion.phase + motion.speed * state.time;
  }
  return state;
}

/** Authoritative arcs are reused at fixed ticks and exact impact times. */
export function evaluatePlatformMotion(platform, time) {
  if (!platform.motion) return platform;
  const state = platform.motionState ||= createMotionState(platform);
  // A destroyed platform retains its exact impact state for outgoing debris.
  return platform.active ? sampleMotion(platform, time, state) : state;
}

/**
 * Rendering samples the interpolated simulation clock, never wall-clock time.
 * createPlatform primes this buffer once; ordinary renders allocate nothing.
 * Destruction always uses the authoritative impact snapshot for debris.
 */
export function evaluatePlatformRenderMotion(platform, time) {
  if (!platform.motion) return platform;
  if (!platform.active) return platform.motionState || platform;
  let state = renderStates.get(platform);
  if (!state) {
    state = createMotionState(platform);
    renderStates.set(platform, state);
  }
  return sampleMotion(platform, time, state);
}

export function getPlatformState(platform) {
  return platform.motionState ?? platform;
}

export function getPlatformRotation(platform) {
  return platform.motionState?.rotation ?? platform.baseRotation;
}

/** Sample at the crossed plane's time, not at the previous rendered frame. */
export function classifyPlatformAtTime(platform, towerRotation, time, worldAngle = CONFIG.world.ballWorldAngle) {
  if (!platform.active) return 'gap';
  if (platform.finish) return 'finish';
  const state = evaluatePlatformMotion(platform, time);
  const angle = normalizeAngle(worldAngle + towerRotation - (state.rotation ?? platform.baseRotation));
  return classifySegmentsAtAngle(state.segments, angle);
}
