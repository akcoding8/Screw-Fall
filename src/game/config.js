import { PRODUCTION_TERMINAL_SPEED } from './TerminalSpeed.js';

/** Gameplay tuning lives here. Distances are world units; time is in seconds. */
export const CONFIG = {
  title: 'Screw Fall',
  physics: {
    // Phase 2: +1.5% launch impulse; a larger increase would touch the upper
    // platform at the fixed-step apex. Gravity and all other core values stay locked.
    // The free-fall below the last contact plane uses lighter acceleration.
    bounceGravity: 28,
    freeFallGravity: 24.5,
    bounceVelocity: 9.058875,
    // Positive magnitude of the downward cap; never limits the upward impulse.
    maxDownwardSpeed: PRODUCTION_TERMINAL_SPEED,
    // Both visual radius and vertical contact radius. Horizontal classification
    // still uses the ball's centre angle, so increasing size never narrows gaps.
    ballRadius: 0.275,
    fixedStep: 1 / 120,
    maxFrameDelta: 0.1,
    maxSubsteps: 12,
  },
  world: {
    platformSpacing: 2.25,
    ballOrbitRadius: 2.05,
    ballWorldAngle: Math.PI / 2,
    innerRadius: 0.73,
    outerRadius: 2.85,
    platformThickness: 0.27,
  },
  input: {
    sensitivity: 5.2,
    // The radians-per-viewport baseline above remains exactly the old 1.0×.
    multiplier: { min: 0.5, max: 3, step: 0.1, default: 1.2 },
    // Three's positive rotation.y decreases atan2(z, x). Negative horizontal
    // movement therefore needs negative rotation.y to push the right edge forward.
    directionSign: 1,
    dragThreshold: 3,
    tapMaxDistance: 12,
    tapMaxDuration: 500,
  },
  smash: { threshold: 3 },
  timing: { deathDuration: 0.48, completionHold: 1 },
  camera: {
    followResponse: 6,
    fieldOfView: 40,
    distance: 13.8,
    height: 7.8,
    targetOffset: -1,
    pitchDegrees: 35.5,
    // True sphere/platform contact point, measured down the current visual
    // viewport after physical safe insets. The header is a separate exclusion
    // zone: subtracting it from this denominator would push the ball lower.
    contactScreenAnchor: 0.43,
    // Downward follow may trail by at most two usable-screen percentage points.
    // Upward bounce never drives this anchor; the existing response remains 6.
    maxContactScreenLag: 0.02,
    portraitWidth: 8.1,
    impactStrength: 0.09,
    smashStrength: 0.18,
  },
  particles: {
    maxParticles: 160,
    maxFragments: 120,
    passCount: 5,
    smashCount: 12,
    deathCount: 24,
    confettiCount: 64,
    lifetime: 0.65,
    impactLifetime: 0.42,
    fragmentLifetime: 1.2,
    fragmentChunkAngle: Math.PI / 4,
    passFragmentCount: 10,
    smashFragmentCount: 12,
    fragmentOutwardMin: 5.2,
    fragmentOutwardMax: 6.3,
    smashOutwardMin: 9.5,
    smashOutwardMax: 12.2,
    fragmentTangentialSpeed: 0.15,
    fragmentVerticalMin: -0.6,
    fragmentVerticalMax: 0.7,
    smashVerticalMin: 0.3,
    smashVerticalMax: 2.1,
    fragmentSpin: 2.4,
    fragmentYawSpin: 1.5,
    smashSpinMultiplier: 1.6,
    fragmentSpawnOffset: 0.08,
    fragmentFadeDuration: 0.22,
    fragmentOffscreenPadding: 0.3,
    fragmentOffscreenGrace: 0.15,
    confettiLifetime: 1.8,
    gravity: 13,
  },
  audio: {
    masterVolume: 0.32,
    bounceVolume: 0.18,
    passVolume: 0.17,
    activationVolume: 0.26,
    smashVolume: 0.36,
    deathVolume: 0.3,
    completionVolume: 0.27,
  },
  renderer: { pixelRatioLimit: 2, antialias: true },
  save: { key: 'screw-fall:save', version: 5 },
};
