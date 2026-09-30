/** The full safe-integer range preserves every level supported by earlier saves. */
export const MAX_LEVEL = Number.MAX_SAFE_INTEGER;
export const STARTING_LEVEL_RECORD_ID = 'starting-level';
export const PROGRESS_TEXT_LIMITS = Object.freeze({ source: 120, note: 500, id: 96 });
export const ADJUSTMENT_REASONS = Object.freeze({
  elsewhere: 'Progress completed elsewhere', correction: 'Correct a previous entry', other: 'Other',
});
const max = BigInt(MAX_LEVEL);
const formatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const validPositive = value => Number.isSafeInteger(value) && value >= 1 && value <= MAX_LEVEL;
const validCount = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_LEVEL;
export const formatLevel = value => formatter.format(validPositive(value) ? value : 1);
export const formatSignedAdjustment = value => `${value >= 0 ? '+' : '−'}${formatter.format(Math.abs(value))}`;

export function progressText(value, limit) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
}
export function evidenceId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(value) ? value : null;
}
export function progressTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function adjustmentTotal(records = []) {
  // BigInt is used only when data changes, never during the render loop. It
  // prevents large positive and negative entries losing their exact meaning.
  return Number(records.reduce((total, record) => total + BigInt(record.amount), 0n));
}

export function deriveCurrentLevel(startingLevel, levelsCompletedHere, records = []) {
  if (!validPositive(startingLevel) || !validCount(levelsCompletedHere)) return null;
  let total = 0n;
  for (const record of records) {
    if (!Number.isSafeInteger(record?.amount)) return null;
    total += BigInt(record.amount);
  }
  const result = BigInt(startingLevel) + BigInt(levelsCompletedHere) + total;
  return total >= -max && total <= max && result >= 1n && result <= max ? Number(result) : null;
}

export function parseProgressInteger(value, { signed = false } = {}) {
  const pattern = signed ? /^[+-]?\d+$/ : /^\d+$/;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!pattern.test(trimmed)) return { ok: false, error: signed
      ? 'Enter a positive or negative whole number, such as +32 or −10.'
      : 'Enter a whole starting level using digits only.' };
    value = Number(trimmed);
  }
  if (!Number.isSafeInteger(value) || (signed ? value === 0 || Math.abs(value) > MAX_LEVEL : !validPositive(value))) {
    return { ok: false, error: signed
      ? `Enter a non-zero whole number between −${formatLevel(MAX_LEVEL)} and +${formatLevel(MAX_LEVEL)}.`
      : `Enter a starting level from 1 to ${formatLevel(MAX_LEVEL)}.` };
  }
  return { ok: true, value };
}

export function emptyProgress() {
  return { startingLevel: 1, startingLevelConfirmedAt: null, startingLevelSource: '',
    startingLevelEvidenceId: null, levelsCompletedHere: 0, laterImportedAdjustments: Object.freeze([]),
    currentLevel: 1, levelNumber: 1 };
}

/** Only explicit, validated fields enter the save; disk aliases are never authoritative. */
export function sanitizeProgress(value, legacy = false) {
  if (legacy) {
    const level = validPositive(value.levelNumber) ? value.levelNumber : 1;
    return { ...emptyProgress(), levelsCompletedHere: level - 1, currentLevel: level, levelNumber: level };
  }
  const startingLevel = validPositive(value.startingLevel) ? value.startingLevel : 1;
  // A corrupted count is clamped only when the count itself would exceed the
  // representable range; valid histories may offset a large starting level.
  let levelsCompletedHere = validCount(value.levelsCompletedHere) ? value.levelsCompletedHere : 0;
  const seen = new Set();
  let records = [];
  for (const record of Array.isArray(value.laterImportedAdjustments) ? value.laterImportedAdjustments : []) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    const id = evidenceId(record.id);
    const createdAt = progressTimestamp(record.createdAt);
    if (!id || id === STARTING_LEVEL_RECORD_ID || seen.has(id) || !createdAt
      || !Number.isSafeInteger(record.amount) || record.amount === 0
      || !Object.hasOwn(ADJUSTMENT_REASONS, record.reason)) continue;
    seen.add(id);
    records.push({ id, amount: record.amount, createdAt, reason: record.reason,
      note: progressText(record.note, PROGRESS_TEXT_LIMITS.note),
      source: progressText(record.source, PROGRESS_TEXT_LIMITS.source), evidenceId: evidenceId(record.evidenceId) });
  }
  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  // Retain every well-formed entry when its complete signed total is valid.
  // For damaged histories, keep the deterministic valid prefix rather than
  // letting an invalid disk total silently turn into a different large level.
  let currentLevel = deriveCurrentLevel(startingLevel, levelsCompletedHere, records);
  if (currentLevel === null) {
    levelsCompletedHere = Math.min(levelsCompletedHere, MAX_LEVEL - startingLevel);
    const recovered = [];
    for (const record of records) {
      if (deriveCurrentLevel(startingLevel, levelsCompletedHere, [...recovered, record]) !== null) recovered.push(record);
    }
    records = recovered;
    currentLevel = deriveCurrentLevel(startingLevel, levelsCompletedHere, records);
  }
  return { startingLevel, startingLevelConfirmedAt: progressTimestamp(value.startingLevelConfirmedAt),
    startingLevelSource: progressText(value.startingLevelSource, PROGRESS_TEXT_LIMITS.source),
    startingLevelEvidenceId: evidenceId(value.startingLevelEvidenceId), levelsCompletedHere,
    laterImportedAdjustments: Object.freeze(records.map(record => Object.freeze(record))),
    currentLevel, levelNumber: currentLevel };
}
