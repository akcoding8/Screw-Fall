import { CONFIG } from './config.js';
import { normalizeAngle, TAU } from './math.js';
import { getPlatformRotation } from './PlatformMotion.js';
import { WALL_CONFIG } from './ObstacleConfig.js';

/**
 * Sweep an unwrapped angle against a repeating solid interval. A huge movement
 * still meets the nearest copy of the wall; normalising the requested delta
 * would lose whole turns and allow tunnelling. Starting contact can move away.
 */
export function sweepAngularInterval(start, delta, center, halfWidth, epsilon = WALL_CONFIG.angularEpsilon) {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const relative = normalizeAngle(start - center + Math.PI) - Math.PI;
  if (Math.abs(relative) < halfWidth + epsilon) {
    // A top landing or roundoff may start inside the expanded interval. Permit
    // escape toward the nearest edge, while consuming movement into the wall.
    if (Math.abs(relative) <= epsilon || Math.sign(delta) === Math.sign(relative)) {
      const distance = TAU - halfWidth - Math.sign(delta) * relative - epsilon;
      return Math.sign(delta) * Math.min(Math.abs(delta), distance);
    }
    return 0;
  }
  if (delta > 0) {
    const distance = normalizeAngle(-halfWidth - relative);
    return Math.min(delta, Math.max(0, distance - epsilon));
  }
  const distance = normalizeAngle(relative - halfWidth);
  return Math.max(delta, -Math.max(0, distance - epsilon));
}

export function wallTopY(platform, wall) {
  return platform.y + wall.height;
}

/** Shared collision/debug bounds. No change to the visible wall dimensions. */
export function getWallBounds(platform, wall, result = {}) {
  const inset = Math.min(WALL_CONFIG.colliderInset, wall.width * .2);
  result.minRadius = wall.innerRadius + inset;
  result.maxRadius = wall.outerRadius - inset;
  result.halfWidth = Math.max(0, wall.width / 2 - inset);
  result.minY = platform.y + inset;
  result.maxY = wallTopY(platform, wall) - inset + WALL_CONFIG.clearanceEpsilon;
  return result;
}

const bounds = {};
const CONTACT_EPSILON = 1e-12;

function distanceSquared(angle, y, minRadius, maxRadius, halfWidth, minY, maxY) {
  const orbit = CONFIG.world.ballOrbitRadius;
  const along = orbit * Math.cos(angle);
  const across = orbit * Math.sin(angle);
  const radial = Math.max(minRadius - along, along - maxRadius, 0);
  const tangent = Math.max(Math.abs(across) - halfWidth, 0);
  const vertical = Math.max(minY - y, y - maxY, 0);
  return radial * radial + tangent * tangent + vertical * vertical;
}

function sweepDistance(fraction, angle, speed, startY, dy, minRadius, maxRadius, halfWidth, minY, maxY) {
  return distanceSquared(angle + speed * fraction, startY + dy * fraction,
    minRadius, maxRadius, halfWidth, minY, maxY);
}

/** Sphere/radial-fin broad phase, including the rounded top and bottom. */
export function wallAngularHalfWidth(platform, wall, ballY, radius = CONFIG.physics.ballRadius) {
  const orbit = CONFIG.world.ballOrbitRadius;
  getWallBounds(platform, wall, bounds);
  if (orbit + radius < bounds.minRadius || orbit - radius > bounds.maxRadius) return 0;
  const verticalDistance = Math.max(bounds.minY - ballY, ballY - bounds.maxY, 0);
  if (verticalDistance >= radius - WALL_CONFIG.verticalEpsilon) return 0;
  const horizontalRadius = Math.sqrt(Math.max(0, radius * radius - verticalDistance * verticalDistance));
  return Math.asin(Math.min(1, (horizontalRadius + bounds.halfWidth) / orbit));
}

/**
 * Height of first contact with the fin's flat top or rounded sphere/edge contact.
 * Using only the ball centre angle here would let an off-centre sphere clip it.
 */
export function wallTopContactY(platform, wall, rotation, radius = CONFIG.physics.ballRadius) {
  const orbit = CONFIG.world.ballOrbitRadius;
  const local = CONFIG.world.ballWorldAngle + rotation - getPlatformRotation(platform);
  const difference = normalizeAngle(local - wall.angle + Math.PI) - Math.PI;
  const alongFin = orbit * Math.cos(difference);
  const acrossFin = orbit * Math.sin(difference);
  getWallBounds(platform, wall, bounds);
  const radialDistance = Math.max(bounds.minRadius - alongFin, alongFin - bounds.maxRadius, 0);
  const tangentialDistance = Math.max(Math.abs(acrossFin) - bounds.halfWidth, 0);
  const distanceSquared = radialDistance * radialDistance + tangentialDistance * tangentialDistance;
  if (distanceSquared >= radius * radius) return -Infinity;
  return bounds.maxY + Math.sqrt(radius * radius - distanceSquared);
}

export function isOverWallTop(platform, wall, rotation) {
  return Number.isFinite(wallTopContactY(platform, wall, rotation));
}

/**
 * Exact sphere/box narrow phase during a linear vertical and angular interval.
 * Vertical overlap first restricts time, and the unwrapped angular interval
 * selects the first wall copy even for many complete revolutions. Within its
 * small front-facing interval, squared distance to the radial box is convex.
 * A bounded minimum search followed by bisection finds the first rounded-corner
 * contact without treating a sphere as an inflated square box.
 *
 * A generated fin straddles the orbit. Its centre line therefore contacts during
 * any complete angular window within the vertical overlap interval. Only an
 * initial partial window can miss before the next window: at most two are needed.
 * Runtime does not grow with the number of revolutions in a pointer delta.
 */
export function wallSweepFraction(platform, wall, rotation, delta, startY, endY) {
  if (!Number.isFinite(rotation + delta + startY + endY)) return Infinity;
  getWallBounds(platform, wall, bounds);
  const { minRadius, maxRadius, halfWidth, minY, maxY } = bounds;
  const orbit = CONFIG.world.ballOrbitRadius;
  const radius = CONFIG.physics.ballRadius;
  const radiusSquared = radius * radius;
  const startAngle = normalizeAngle(CONFIG.world.ballWorldAngle + rotation
    - getPlatformRotation(platform) - wall.angle + Math.PI) - Math.PI;
  const dy = endY - startY;
  if (delta === 0) {
    const horizontalSquared = distanceSquared(startAngle, minY, minRadius, maxRadius, halfWidth, minY, maxY);
    if (horizontalSquared >= radiusSquared - CONTACT_EPSILON) return Infinity;
    const reach = Math.sqrt(radiusSquared - horizontalSquared);
    const bottom = minY - reach;
    const top = maxY + reach;
    if (startY > bottom + WALL_CONFIG.verticalEpsilon && startY < top - WALL_CONFIG.verticalEpsilon) return 0;
    if (dy < 0 && startY >= top - WALL_CONFIG.verticalEpsilon && endY < top - WALL_CONFIG.verticalEpsilon) {
      return Math.max(0, (top - startY) / dy);
    }
    if (dy > 0 && startY <= bottom + WALL_CONFIG.verticalEpsilon && endY > bottom + WALL_CONFIG.verticalEpsilon) {
      return Math.max(0, (bottom - startY) / dy);
    }
    return Infinity;
  }

  // Generated/validated walls cross the orbit with generous radial support.
  // Reject geometry wholly outside the sphere's reach before angular work.
  if (minRadius > orbit + radius || maxRadius < orbit - radius) return Infinity;
  const radialMiss = Math.max(minRadius - orbit, orbit - Math.hypot(maxRadius, halfWidth), 0);
  if (radialMiss >= radius) return Infinity;
  const verticalReach = Math.sqrt(radiusSquared - radialMiss * radialMiss);
  let from = 0;
  let to = 1;
  if (dy === 0) {
    if (startY <= minY - verticalReach || startY >= maxY + verticalReach) return Infinity;
  } else {
    const a = (minY - verticalReach - startY) / dy;
    const b = (maxY + verticalReach - startY) / dy;
    from = Math.max(0, Math.min(a, b));
    to = Math.min(1, Math.max(a, b));
    if (from >= to) return Infinity;
  }
  const envelope = Math.asin(Math.min(1, (radius + halfWidth) / orbit));
  // Reverse angles for a negative sweep: the box is symmetric about its fin.
  const direction = Math.sign(delta);
  const angle = startAngle * direction;
  const speed = Math.abs(delta);
  const atFrom = angle + speed * from;
  let turn = Math.ceil((atFrom - envelope) / TAU);
  for (let candidate = 0; candidate < 2; candidate++, turn++) {
    const entry = Math.max(from, (turn * TAU - envelope - angle) / speed);
    const exit = Math.min(to, (turn * TAU + envelope - angle) / speed);
    if (entry > exit || entry > to) continue;
    const localStart = angle - turn * TAU;
    if (sweepDistance(entry, localStart, speed, startY, dy, minRadius, maxRadius, halfWidth, minY, maxY)
      < radiusSquared - CONTACT_EPSILON) return entry;
    let low = entry;
    let high = exit;
    for (let iteration = 0; iteration < 40; iteration++) {
      const left = low + (high - low) / 3;
      const right = high - (high - low) / 3;
      if (sweepDistance(left, localStart, speed, startY, dy, minRadius, maxRadius, halfWidth, minY, maxY)
        <= sweepDistance(right, localStart, speed, startY, dy, minRadius, maxRadius, halfWidth, minY, maxY)) high = right;
      else low = left;
    }
    const minimum = (low + high) / 2;
    if (sweepDistance(minimum, localStart, speed, startY, dy, minRadius, maxRadius, halfWidth, minY, maxY)
      >= radiusSquared - CONTACT_EPSILON) continue;
    low = entry;
    high = minimum;
    for (let iteration = 0; iteration < 44; iteration++) {
      const middle = (low + high) / 2;
      if (sweepDistance(middle, localStart, speed, startY, dy, minRadius, maxRadius, halfWidth, minY, maxY)
        < radiusSquared) high = middle;
      else low = middle;
    }
    return high;
  }
  return Infinity;
}

/** Earliest contact across all live walls; result is reusable in the hot path. */
export function resolveWallSweep(platforms, rotation, requestedDelta, startY, endY, result = {}) {
  let fraction = Infinity;
  let hitWall = null;
  let hitPlatform = null;
  for (const platform of platforms) {
    if (!platform.active || !platform.walls?.length) continue;
    for (const wall of platform.walls) {
      if (wall.active === false) continue;
      const hit = wallSweepFraction(platform, wall, rotation, requestedDelta, startY, endY);
      if (hit < fraction) {
        fraction = hit;
        hitWall = wall;
        hitPlatform = platform;
      }
    }
  }
  result.fraction = hitWall ? fraction : 1;
  result.delta = requestedDelta * result.fraction;
  result.y = startY + (endY - startY) * result.fraction;
  result.wall = hitWall;
  result.platform = hitPlatform;
  return result;
}

/** Direct pointer movement is resolved now, without adding a physics-tick delay. */
export function resolveWallRotation(platforms, rotation, requestedDelta, ballY, result = {}) {
  return resolveWallSweep(platforms, rotation, requestedDelta, ballY, ballY, result);
}
