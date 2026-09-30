/** Scores remain integer Numbers so both storage and UI stay inexpensive. */
export const MAX_POINTS = Number.MAX_SAFE_INTEGER;
const integerFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export function normalizePoints(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_POINTS, Math.max(0, Math.floor(value))) : 0;
}

export function saturatingAdd(left, right, onSaturation = () => {}) {
  const a = normalizePoints(left);
  const b = normalizePoints(right);
  if (b > MAX_POINTS - a) {
    onSaturation('Points reached Number.MAX_SAFE_INTEGER; further additions are safely saturated.');
    return MAX_POINTS;
  }
  return a + b;
}

export function formatPoints(value) { return integerFormatter.format(normalizePoints(value)); }
export const formatScore = formatPoints;
export function formatMultiplier(value) { return `×${Math.max(1, normalizePoints(value))}`; }
