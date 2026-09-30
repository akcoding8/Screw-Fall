import { CONFIG } from './config.js';

export const TAU = Math.PI * 2;

/** Map radians to [0, 2π), including negative angles and several revolutions. */
export function normalizeAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  return ((angle % TAU) + TAU) % TAU;
}

/**
 * Arcs run in increasing mathematical angle (atan2(z, x)). Endpoints are
 * half-open so two neighbouring arcs cannot both claim the same contact.
 * An explicit whole revolution is a full ring; equal endpoints are empty.
 */
export function arcContains(angle, start, end) {
  if (!Number.isFinite(angle) || !Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (Math.abs(end - start) >= TAU) return true;
  const point = normalizeAngle(angle);
  const from = normalizeAngle(start);
  const to = normalizeAngle(end);
  if (from === to) return false;
  // Compare normalized endpoints directly. Subtracting each arc's start before
  // normalization rounds a shared seam differently on its two sides and can
  // invent a microscopic gap between safe and hazard geometry.
  return from < to ? point >= from && point < to : point >= from || point < to;
}

/** Rotation uses viewport fractions so a phone and tablet have the same reach. */
export function dragRotation(deltaX, width, config = CONFIG.input, multiplier = 1) {
  if (!Number.isFinite(deltaX) || !Number.isFinite(width) || width <= 0) return 0;
  return (deltaX / width) * config.sensitivity * config.directionSign * multiplier;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start, end, alpha) {
  return start + (end - start) * alpha;
}

/** Frame-rate independent smoothing factor for cameras and visual adapters. */
export function dampFactor(response, dt) {
  return 1 - Math.exp(-response * dt);
}
