/** Obstacle dimensions use world units and angular values use radians. */
export const MOTION_LIMITS = Object.freeze({
  breathing: { minWidth: 66 * Math.PI / 180, maxWidth: 128 * Math.PI / 180, minPeriod: 1.9, maxPeriod: 3.8 },
  orbiting: { minSpeed: .24, maxSpeed: .60 },
  stinger: {
    minSafeWidth: 24 * Math.PI / 180, maxSafeWidth: 42 * Math.PI / 180,
    minFlankWidth: 14 * Math.PI / 180, maxFlankWidth: 30 * Math.PI / 180,
    minSpeed: .24, maxSpeed: .54,
  },
});

export const WALL_CONFIG = Object.freeze({
  lowHeight: .9,
  dividerHeight: 1.87,
  width: .12,
  // World-space edge allowance; sphere/box distance keeps corners rounded.
  colliderInset: .01,
  // The sphere bottom must clear the inset top by this additional amount.
  clearanceEpsilon: .002,
  // Radians: enough to stay outside floating-point contact without a visible gap.
  angularEpsilon: 1e-5,
  verticalEpsilon: 1e-8,
});
