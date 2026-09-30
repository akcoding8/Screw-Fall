import { ADJUSTMENT_REASONS, MAX_LEVEL, STARTING_LEVEL_RECORD_ID, PROGRESS_TEXT_LIMITS,
  adjustmentTotal, deriveCurrentLevel, evidenceId, formatLevel, parseProgressInteger,
  progressText, progressTimestamp } from './ProgressModel.js';

let fallbackSerial = 0;
function createRecordId() {
  return globalThis.crypto?.randomUUID?.() ?? `progress-${Date.now().toString(36)}-${(++fallbackSerial).toString(36)}`;
}

/** Imports change provenance only; all earned state remains in ScoringManager. */
export class ProgressManager {
  constructor({ scoring, now = () => new Date().toISOString(), createId = createRecordId, onChange = () => {} }) {
    this.scoring = scoring;
    this.now = now;
    this.createId = createId;
    this.onChange = onChange;
    this.attempt = null;
  }
  get data() { return this.scoring.data; }
  get currentLevel() { return this.data.currentLevel; }
  get adjustmentTotal() { return adjustmentTotal(this.data.laterImportedAdjustments); }
  get startingLevelConfirmed() { return this.data.startingLevelConfirmedAt !== null || this.data.startingLevel !== 1; }
  get history() {
    return [{ id: STARTING_LEVEL_RECORD_ID, startingLevel: this.data.startingLevel,
      createdAt: this.data.startingLevelConfirmedAt, source: this.data.startingLevelSource,
      evidenceId: this.data.startingLevelEvidenceId }, ...this.data.laterImportedAdjustments.map(record => ({ ...record }))];
  }

  rangePreview(startingLevel, records) {
    const after = deriveCurrentLevel(startingLevel, this.data.levelsCompletedHere, records);
    return after === null ? { ok: false, before: this.currentLevel,
      error: `The resulting current level must stay between 1 and ${formatLevel(MAX_LEVEL)}.` }
      : { ok: true, before: this.currentLevel, after, currentLevel: after,
        startingLevel, levelsCompletedHere: this.data.levelsCompletedHere, adjustmentTotal: adjustmentTotal(records) };
  }
  previewStartingLevel({ startingLevel, source = '', evidenceId: imageId = null } = {}, { temporaryOverwrite = false } = {}) {
    if (this.startingLevelConfirmed && !(temporaryOverwrite && !this.scoring.eligible)) {
      return { ok: false, error: 'Your starting level is already recorded. Add a correction to change your progress.' };
    }
    const parsed = parseProgressInteger(startingLevel);
    if (!parsed.ok) return parsed;
    return { ...this.rangePreview(parsed.value, this.data.laterImportedAdjustments),
      startingLevel: parsed.value, source: progressText(source, PROGRESS_TEXT_LIMITS.source), evidenceId: evidenceId(imageId) };
  }
  confirmStartingLevel(input, options) {
    const preview = this.previewStartingLevel(input, options);
    if (!preview.ok) return preview;
    this.scoring.updateProgression({ startingLevel: preview.startingLevel,
      startingLevelConfirmedAt: progressTimestamp(this.now()) ?? new Date().toISOString(),
      startingLevelSource: preview.source, startingLevelEvidenceId: preview.evidenceId }, { immediate: true });
    this.attempt = null;
    const result = { ...preview, recordId: STARTING_LEVEL_RECORD_ID, type: 'starting-level' };
    this.onChange(result);
    return result;
  }
  previewAdjustment({ amount, reason = 'elsewhere', note = '', source = '', evidenceId: imageId = null } = {}) {
    const parsed = parseProgressInteger(amount, { signed: true });
    if (!parsed.ok) return parsed;
    if (!Object.hasOwn(ADJUSTMENT_REASONS, reason)) return { ok: false, error: 'Choose a reason for this progress adjustment.' };
    return { ...this.rangePreview(this.data.startingLevel, [...this.data.laterImportedAdjustments, { amount: parsed.value }]),
      amount: parsed.value, reason, note: progressText(note, PROGRESS_TEXT_LIMITS.note),
      source: progressText(source, PROGRESS_TEXT_LIMITS.source), evidenceId: evidenceId(imageId) };
  }
  addAdjustment(input) {
    const preview = this.previewAdjustment(input);
    if (!preview.ok) return preview;
    const used = new Set(this.data.laterImportedAdjustments.map(record => record.id));
    let id = evidenceId(this.createId());
    if (!id || id === STARTING_LEVEL_RECORD_ID || used.has(id)) {
      do { id = createRecordId(); } while (used.has(id));
    }
    const record = { id, amount: preview.amount, createdAt: progressTimestamp(this.now()) ?? new Date().toISOString(),
      reason: preview.reason, note: preview.note, source: preview.source, evidenceId: preview.evidenceId };
    this.scoring.updateProgression({ laterImportedAdjustments: [...this.data.laterImportedAdjustments, record] }, { immediate: true });
    this.attempt = null;
    const result = { ...preview, recordId: id, record: { ...record }, type: 'adjustment' };
    this.onChange(result);
    return result;
  }
  setEvidence(recordId, imageId) {
    const normalized = evidenceId(imageId);
    if (imageId !== null && imageId !== undefined && !normalized) return { ok: false, error: 'The screenshot reference is invalid.' };
    if (recordId === STARTING_LEVEL_RECORD_ID) {
      this.scoring.updateProgression({ startingLevelEvidenceId: normalized }, { immediate: true });
    } else {
      if (!this.data.laterImportedAdjustments.some(record => record.id === recordId)) return { ok: false, error: 'This progress record could not be found.' };
      this.scoring.updateProgression({ laterImportedAdjustments: this.data.laterImportedAdjustments.map(record =>
        record.id === recordId ? { ...record, evidenceId: normalized } : record) }, { immediate: true });
    }
    return { ok: true, recordId, evidenceId: normalized };
  }

  beginAttempt(level, state = 'HOLDING') {
    this.attempt = { levelNumber: level?.levelNumber, finish: level?.platforms?.find(platform => platform.finish),
      activated: state === 'ACTIVE', finished: false, consumed: false, invalidated: false };
  }
  handleEvent(event) {
    const attempt = this.attempt;
    if (!attempt || !event) return false;
    if (event.type === 'stateChanged' && event.state === 'ACTIVE') attempt.activated = true;
    if (['playerDied', 'retry', 'manualReset'].includes(event.type)) attempt.invalidated = true;
    if (event.type !== 'gameLevelCompleted' || !attempt.activated || attempt.invalidated
      || attempt.consumed || attempt.finished || !this.scoring.eligible
      || this.currentLevel !== attempt.levelNumber || event.levelNumber !== attempt.levelNumber
      || !attempt.finish || event.platform !== attempt.finish || !event.platform.finish) return false;
    attempt.finished = true;
    return true;
  }
  completeAttempt() {
    const attempt = this.attempt;
    if (!attempt?.finished || attempt.consumed || attempt.invalidated || !this.scoring.eligible
      || attempt.levelNumber !== this.currentLevel) return { ok: false, reason: 'ineligible-completion', currentLevel: this.currentLevel };
    attempt.consumed = true;
    if (this.data.levelsCompletedHere >= MAX_LEVEL || this.currentLevel >= MAX_LEVEL) {
      return { ok: false, reason: 'level-limit', currentLevel: this.currentLevel,
        error: 'You have reached the highest supported level. This tower can be replayed.' };
    }
    this.scoring.updateProgression({ levelsCompletedHere: this.data.levelsCompletedHere + 1 }, { immediate: true });
    const result = { ok: true, type: 'completion', currentLevel: this.currentLevel };
    this.onChange(result);
    return result;
  }
}
