import { describe, expect, it, vi } from 'vitest';
import { ProgressManager } from '../src/game/ProgressManager.js';
import { MAX_LEVEL, STARTING_LEVEL_RECORD_ID, deriveCurrentLevel, formatLevel,
  parseProgressInteger, sanitizeProgress } from '../src/game/ProgressModel.js';
import { SaveManager, sanitizeSave } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { SkinManager } from '../src/game/SkinManager.js';

const time = '2026-09-25T12:00:00.000Z';
const earned = { pointsBalance: 20000, lifetimePoints: 150000, currentNoDeathScore: 850,
  bestNoDeathScore: 1200, currentRunIsRecord: true, selectedSkinId: 'pearl-shift', ownedSkinIds: ['classic', 'pearl-shift'] };
function setup(initial = { version: 5 }) {
  let json = JSON.stringify(initial);
  const storage = { getItem: () => json, setItem: vi.fn((key, value) => { json = value; }) };
  const save = new SaveManager(storage, { lifecycle: false });
  const scoring = new ScoringManager({ save });
  let serial = 0;
  const progress = new ProgressManager({ scoring, now: () => time, createId: () => `adjustment-${++serial}` });
  return { save, scoring, progress, storage };
}
function finish(progress, { number = progress.currentLevel, platform = { id: 'finish', finish: true } } = {}) {
  progress.beginAttempt({ levelNumber: number, platforms: [platform] });
  progress.handleEvent({ type: 'stateChanged', state: 'ACTIVE' });
  progress.handleEvent({ type: 'stateChanged', state: 'COMPLETING' });
  progress.handleEvent({ type: 'gameLevelCompleted', levelNumber: number, platform });
  return platform;
}
const adjustment = (id, amount, extra = {}) => ({ id, amount, createdAt: time, reason: 'correction', note: '', source: '', evidenceId: null, ...extra });

describe('authoritative progress and immutable import records', () => {
  it('starts at Level 1 and uses exactly starting + completed + signed adjustments', () => {
    expect(setup().progress.currentLevel).toBe(1);
    expect(deriveCurrentLevel(1757, 100, [])).toBe(1857);
    expect(deriveCurrentLevel(1757, 100, [adjustment('one', 50)])).toBe(1907);
  });
  it('previews without writing, preserves existing completions, then records the starting level once', () => {
    const { progress, save, storage } = setup({ version: 5, startingLevel: 1, levelsCompletedHere: 181, ...earned });
    expect(progress.previewStartingLevel({ startingLevel: '1757' })).toMatchObject({ ok: true, before: 182, after: 1938, levelsCompletedHere: 181 });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(progress.confirmStartingLevel({ startingLevel: '1757', source: 'Previous game', evidenceId: 'evidence-one' })).toMatchObject({ ok: true, recordId: STARTING_LEVEL_RECORD_ID });
    expect(save.data).toMatchObject({ startingLevel: 1757, levelsCompletedHere: 181, currentLevel: 1938,
      levelNumber: 1938, startingLevelConfirmedAt: time, startingLevelSource: 'Previous game', startingLevelEvidenceId: 'evidence-one', ...earned });
    expect(progress.confirmStartingLevel({ startingLevel: 1 }).ok).toBe(false);
    expect(progress.confirmStartingLevel({ startingLevel: 1 }, { temporaryOverwrite: true }).ok).toBe(false);
    expect(save.data.startingLevel).toBe(1757);
    expect(new SkinManager({ scoring: new ScoringManager({ save }) }).premiumUnlocked).toBe(true);
  });
  it('records even an explicit starting Level 1 immutably', () => {
    const { progress } = setup();
    expect(progress.confirmStartingLevel({ startingLevel: 1 }).ok).toBe(true);
    expect(progress.startingLevelConfirmed).toBe(true);
    expect(progress.previewStartingLevel({ startingLevel: 20 }).ok).toBe(false);
  });
  it('appends positive and negative history and never changes earned state', () => {
    const { progress, save } = setup({ version: 5, startingLevel: 1757, levelsCompletedHere: 100, startingLevelConfirmedAt: time, ...earned });
    expect(progress.addAdjustment({ amount: '+32', reason: 'elsewhere', source: 'Other game' })).toMatchObject({ ok: true, before: 1857, after: 1889 });
    const first = { ...save.data.laterImportedAdjustments[0] };
    expect(progress.previewAdjustment({ amount: '-10', reason: 'correction' })).toMatchObject({ ok: true, before: 1889, after: 1879 });
    expect(progress.addAdjustment({ amount: -10, reason: 'correction', note: 'Correct the previous number' }).ok).toBe(true);
    expect(progress.adjustmentTotal).toBe(22);
    expect(progress.currentLevel).toBe(1879);
    expect(save.data.laterImportedAdjustments[0]).toEqual(first);
    expect(save.data.laterImportedAdjustments).toHaveLength(2);
    expect(save.data).toMatchObject({ startingLevel: 1757, levelsCompletedHere: 100, ...earned });
    expect(() => save.data.laterImportedAdjustments[0].amount = 10000).toThrow();
    expect(progress.editAdjustment).toBeUndefined();
    expect(progress.deleteAdjustment).toBeUndefined();
  });
  it('allows only screenshot references to change on confirmed records', () => {
    const { progress, save } = setup();
    progress.confirmStartingLevel({ startingLevel: 100, source: 'A source' });
    const imported = save.load();
    const { recordId } = progress.addAdjustment({ amount: 5, reason: 'other', note: 'A note' });
    const original = { ...save.data.laterImportedAdjustments[0] };
    expect(progress.setEvidence(STARTING_LEVEL_RECORD_ID, 'image-first').ok).toBe(true);
    expect(progress.setEvidence(recordId, 'image-second').ok).toBe(true);
    expect(save.data.startingLevel).toBe(imported.startingLevel);
    expect(save.data.startingLevelConfirmedAt).toBe(imported.startingLevelConfirmedAt);
    expect(save.data.laterImportedAdjustments[0]).toEqual({ ...original, evidenceId: 'image-second' });
    expect(progress.setEvidence(recordId, null).ok).toBe(true);
    expect(progress.setEvidence('missing', 'image').ok).toBe(false);
    expect(progress.setEvidence(recordId, 'data:image/png;base64,not-a-reference').ok).toBe(false);
    expect(progress.currentLevel).toBe(105);
    const snapshot = save.load();
    snapshot.laterImportedAdjustments[0].amount = 99;
    expect(save.data.laterImportedAdjustments[0].amount).toBe(5);
  });
  it('keeps debug imports and adjustments isolated from persistence', () => {
    const { save, scoring, progress, storage } = setup({ version: 5, levelsCompletedHere: 20, ...earned });
    const before = save.load();
    scoring.markIneligible('Simulated import');
    progress.confirmStartingLevel({ startingLevel: 1757 });
    progress.addAdjustment({ amount: 32, reason: 'elsewhere' });
    progress.setEvidence(STARTING_LEVEL_RECORD_ID, 'debug-image');
    expect(progress.currentLevel).toBe(1809);
    expect(save.data).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('resolves ID collisions without overwriting previous records', () => {
    const { progress } = setup();
    progress.createId = () => 'same-id';
    progress.addAdjustment({ amount: 3 });
    progress.addAdjustment({ amount: 2 });
    expect(new Set(progress.data.laterImportedAdjustments.map(record => record.id)).size).toBe(2);
  });
});

describe('only a genuine finish followed by the existing hold counts a completion', () => {
  it('counts exactly once after hold, preserving no-death score and currency', () => {
    const { progress, save, storage } = setup({ version: 5, ...earned });
    finish(progress);
    expect(progress.data.levelsCompletedHere).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
    progress.handleEvent({ type: 'stateChanged', state: 'TRANSITIONING' });
    expect(progress.completeAttempt()).toMatchObject({ ok: true, currentLevel: 2 });
    expect(progress.completeAttempt().ok).toBe(false);
    expect(save.data).toMatchObject({ levelsCompletedHere: 1, currentLevel: 2, ...earned });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it.each(['playerDied', 'retry', 'manualReset'])('%s cannot count a completion', type => {
    const { progress } = setup();
    const platform = finish(progress);
    progress.handleEvent({ type });
    progress.handleEvent({ type: 'gameLevelCompleted', platform, levelNumber: 1 });
    expect(progress.completeAttempt().ok).toBe(false);
    expect(progress.data.levelsCompletedHere).toBe(0);
  });
  it('rejects forged/wrong-platform, wrong-level and unactivated finish events', () => {
    const { progress } = setup();
    const finishPlatform = { id: 'finish', finish: true };
    progress.beginAttempt({ levelNumber: 1, platforms: [finishPlatform] });
    expect(progress.handleEvent({ type: 'gameLevelCompleted', levelNumber: 1, platform: finishPlatform })).toBe(false);
    progress.handleEvent({ type: 'stateChanged', state: 'ACTIVE' });
    expect(progress.handleEvent({ type: 'gameLevelCompleted', levelNumber: 1, platform: { ...finishPlatform } })).toBe(false);
    expect(progress.handleEvent({ type: 'gameLevelCompleted', levelNumber: 2, platform: finishPlatform })).toBe(false);
    expect(progress.completeAttempt().ok).toBe(false);
  });
  it('rejects debug jumps, auto-controller sessions and late debug manipulation', () => {
    const { progress, scoring } = setup();
    finish(progress, { number: 100 });
    expect(progress.completeAttempt().ok).toBe(false);
    finish(progress);
    scoring.markIneligible('Auto-controller');
    expect(progress.completeAttempt().ok).toBe(false);
    finish(progress);
    expect(progress.completeAttempt().ok).toBe(false);
    expect(progress.data.levelsCompletedHere).toBe(0);
  });
  it('replays the highest supported level without overflow or progress reset', () => {
    const { progress } = setup({ version: 4, levelNumber: MAX_LEVEL });
    finish(progress);
    expect(progress.completeAttempt()).toMatchObject({ ok: false, reason: 'level-limit', currentLevel: MAX_LEVEL });
    expect(progress.data.levelsCompletedHere).toBe(MAX_LEVEL - 1);
  });
});

describe('safe exact range validation', () => {
  it.each([0, -1, 1.5, NaN, Infinity, MAX_LEVEL + 1, '', '1e6', '1e100', '1.2', 'abc', null, {}, true])('rejects invalid starting input %s', startingLevel => {
    expect(setup().progress.previewStartingLevel({ startingLevel }).ok).toBe(false);
  });
  it('supports the full historic safe range and full thousands-separated display', () => {
    expect(parseProgressInteger(String(MAX_LEVEL))).toEqual({ ok: true, value: MAX_LEVEL });
    expect(formatLevel(MAX_LEVEL)).toBe('9,007,199,254,740,991');
    const { progress } = setup({ version: 5, levelsCompletedHere: 5 });
    expect(progress.previewStartingLevel({ startingLevel: MAX_LEVEL }).ok).toBe(false);
    expect(progress.confirmStartingLevel({ startingLevel: MAX_LEVEL - 5 }).ok).toBe(true);
    expect(progress.currentLevel).toBe(MAX_LEVEL);
    expect(progress.addAdjustment({ amount: 1 }).ok).toBe(false);
    expect(progress.addAdjustment({ amount: -MAX_LEVEL }).ok).toBe(false);
    expect(progress.addAdjustment({ amount: -(MAX_LEVEL - 1) }).ok).toBe(true);
    expect(progress.currentLevel).toBe(1);
    expect(progress.addAdjustment({ amount: -1 }).ok).toBe(false);
  });
  it('cancels large signed values exactly without unsafe intermediate Numbers', () => {
    expect(deriveCurrentLevel(MAX_LEVEL, MAX_LEVEL - 1, [adjustment('offset', -(MAX_LEVEL - 1))])).toBe(MAX_LEVEL);
    expect(deriveCurrentLevel(1, 0, [adjustment('a', MAX_LEVEL), adjustment('b', -MAX_LEVEL)])).toBe(1);
    expect(deriveCurrentLevel(1, 0, [adjustment('a', MAX_LEVEL), adjustment('b', MAX_LEVEL)])).toBeNull();
  });
});

describe('all supported migrations and hostile save repair', () => {
  it.each([1, 2, 3, 4])('migrates schema %s without changing any previously supported data', version => {
    const original = { version, levelNumber: 182, muted: true, hintSeen: true, sensitivityMultiplier: 2.4, paletteStyle: 'mixed', ...earned };
    const { save, storage } = setup(original);
    expect(save.data).toMatchObject({ version: 5, startingLevel: 1, levelsCompletedHere: 181,
      currentLevel: 182, levelNumber: 182, startingLevelConfirmedAt: null, startingLevelSource: '', startingLevelEvidenceId: null,
      laterImportedAdjustments: [], muted: true, hintSeen: true, sensitivityMultiplier: 2.4, paletteStyle: 'mixed' });
    if (version === 4) expect(save.data).toMatchObject(earned);
    else expect(save.data).toMatchObject({ pointsBalance: 0, lifetimePoints: 0, selectedSkinId: 'classic' });
    expect(new SaveManager(storage, { lifecycle: false }).data).toEqual(save.data);
  });
  it.each([1, 2, 3, 4])('preserves even the largest legacy schema %s level', version => {
    expect(sanitizeSave({ version, levelNumber: MAX_LEVEL })).toMatchObject({ currentLevel: MAX_LEVEL, levelsCompletedHere: MAX_LEVEL - 1 });
  });
  it('ignores disk aliases, unknown fields, duplicate IDs and malformed records', () => {
    const saved = sanitizeSave({ version: 5, startingLevel: 1757, levelsCompletedHere: 100,
      currentLevel: 99999999, levelNumber: 2, unexpected: 'ignored', laterImportedAdjustments: [
        adjustment('b', -10), adjustment('a', 32), adjustment('a', 999), null, [],
        adjustment('unsafe', Infinity), adjustment('invalid', 1, { reason: '__proto__' }),
        adjustment('bad-date', 1, { createdAt: 'nonsense' }), adjustment('zero', 0),
      ] });
    expect(saved.currentLevel).toBe(1879);
    expect(saved.levelNumber).toBe(1879);
    expect(saved.laterImportedAdjustments.map(record => record.id)).toEqual(['a', 'b']);
    expect(saved.unexpected).toBeUndefined();
  });
  it('repairs corrupt provenance safely without throwing or trusting an opaque level', () => {
    expect(sanitizeSave({ version: 5, startingLevel: -99, levelsCompletedHere: 5.4, levelNumber: 100,
      laterImportedAdjustments: [{ amount: 10 }] })).toMatchObject({ startingLevel: 1, levelsCompletedHere: 0, currentLevel: 1 });
    expect(sanitizeProgress({ startingLevel: MAX_LEVEL, levelsCompletedHere: MAX_LEVEL,
      laterImportedAdjustments: [adjustment('overflow', MAX_LEVEL)] }).currentLevel).toBe(MAX_LEVEL);
    expect(sanitizeProgress({ startingLevel: 1, levelsCompletedHere: 0,
      laterImportedAdjustments: [adjustment('underflow', -MAX_LEVEL)] }).currentLevel).toBe(1);
  });
  it('round-trips all signed history fields and trims bounded source/note text', () => {
    const { progress, storage, save } = setup();
    progress.confirmStartingLevel({ startingLevel: 100, source: 's'.repeat(200) });
    progress.addAdjustment({ amount: 32, note: 'n'.repeat(600), source: 'A source', evidenceId: 'image-one' });
    progress.addAdjustment({ amount: -10, reason: 'correction', note: 'A correction' });
    const reloaded = new SaveManager(storage, { lifecycle: false });
    expect(reloaded.data).toEqual(save.data);
    expect(reloaded.data.startingLevelSource).toHaveLength(120);
    expect(reloaded.data.laterImportedAdjustments[0].note).toHaveLength(500);
    expect(reloaded.data.laterImportedAdjustments.map(record => record.amount)).toEqual([32, -10]);
    expect(JSON.stringify(reloaded.data)).not.toContain('data:image');
  });
});
