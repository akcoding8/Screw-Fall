import { createHash } from 'node:crypto';

// Math.sin is implementation-approximated. ARM and x64 V8 can differ by one
// final bit in this derived chord measurement despite identical input arcs.
// Keep a tiny ULP allowance here, in verification only, never in the generator.
export const DERIVED_WIDTH_MAX_ULPS = 4n;

function widthMatches(actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || actual < 0 || expected < 0) return false;
  if (expected === 0 || actual === 0) return actual === expected;
  // Positive IEEE-754 bit patterns have the same ordering as their values.
  const bits = new DataView(new ArrayBuffer(16));
  bits.setFloat64(0, actual); bits.setFloat64(8, expected);
  const distance = bits.getBigUint64(0) - bits.getBigUint64(8);
  return (distance < 0n ? -distance : distance) <= DERIVED_WIDTH_MAX_ULPS;
}

/** Retain the original complete-level SHA while checking only documented
 * transcendental-derived metrics with a tight tolerance. The companion values
 * were extracted from outputs verified against those unchanged historical SHAs.
 * Missing fields, extra fields, topology, order, geometry and other metadata
 * still fail; neither the level nor either baseline is mutated. */
export function compareLevelBaseline(level, sample, expectedWidths) {
  if (!expectedWidths || typeof expectedWidths !== 'object' || Array.isArray(expectedWidths)) {
    throw new Error(`Missing approved derived-width baseline for Level ${sample.number}`);
  }
  const canonical = structuredClone(level);
  const differences = [];
  const seen = new Set();
  for (const [index, platform] of canonical.platforms.entries()) {
    if (!Object.hasOwn(expectedWidths, platform.id)) continue;
    const path = `platforms[${index}].silhouetteMetrics.safeWidthBallDiameters`;
    const expected = expectedWidths[platform.id];
    const actual = platform.silhouetteMetrics?.safeWidthBallDiameters;
    seen.add(platform.id);
    if (!widthMatches(actual, expected)) {
      differences.push({ path, expected, actual, reason: 'Derived width differs by more than four ULPs or is missing/non-finite' });
    } else {
      // Substitution is permitted only after verifying the measured value.
      // Nothing else, including other floating-point fields, is rounded.
      platform.silhouetteMetrics.safeWidthBallDiameters = expected;
    }
  }
  for (const id of Object.keys(expectedWidths)) {
    if (!seen.has(id)) differences.push({ path: `platforms.${id}`, reason: 'Approved platform is missing' });
  }
  const hash = createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  if (hash !== sample.hash) differences.push({ path: 'level', reason: 'Geometry or metadata differs from the original complete-level SHA', expected: sample.hash, actual: hash });
  return { matches: differences.length === 0, hash, differences };
}
