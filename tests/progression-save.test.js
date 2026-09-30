import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { SaveManager, SCORE_SAVE_DEBOUNCE_MS } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { SkinManager } from '../src/game/SkinManager.js';
import { SKIN_CATALOG } from '../src/game/SkinCatalog.js';

function storage(value) {
  let serialized = value === undefined ? null : JSON.stringify(value);
  return { getItem: () => serialized, setItem: vi.fn((key, value) => { serialized = value; }), read: () => JSON.parse(serialized) };
}
function setup(initial) {
  const local = storage(initial);
  const save = new SaveManager(local, { lifecycle: false });
  const scoring = new ScoringManager({ save });
  const changes = [];
  const skins = new SkinManager({ scoring, onChange: value => changes.push(value) });
  return { local, save, scoring, skins, changes };
}
const record = { version: 5, levelNumber: 1299, currentLevel: 1299, startingLevel: 1, levelsCompletedHere: 1298, startingLevelConfirmedAt: null, startingLevelSource: '', startingLevelEvidenceId: null, laterImportedAdjustments: [], muted: true, hintSeen: true, sensitivityMultiplier: 2.4, paletteStyle: 'mixed',
  pointsBalance: 16000, lifetimePoints: 24000, currentNoDeathScore: 1200, bestNoDeathScore: 4800,
  selectedSkinId: 'classic', ownedSkinIds: ['classic'] };
afterEach(() => { vi.useRealTimers(); });

describe('Phase 3 supported migrations and robust progression', () => {
  it.each([1, 2, 3])('migrates schema %s, preserves every existing preference, defaults new progression', version => {
    const { local, save } = setup({ ...record, version });
    expect(save.data).toMatchObject({ version: 5, levelNumber: 1299, muted: true, hintSeen: true,
      sensitivityMultiplier: 2.4, paletteStyle: 'mixed', pointsBalance: 0, lifetimePoints: 0,
      currentNoDeathScore: 0, bestNoDeathScore: 0, selectedSkinId: 'classic', ownedSkinIds: ['classic'] });
    expect(local.setItem).toHaveBeenCalledTimes(1);
    expect(local.read()).toEqual(save.data);
  });
  it('deduplicates ownership, drops unknown IDs and repairs unknown/unowned selection', () => {
    const { save } = setup({ ...record, ownedSkinIds: ['rubber', 'rubber', 'unknown', null], selectedSkinId: 'marble' });
    expect(save.data.ownedSkinIds).toEqual(['classic', 'rubber']);
    expect(save.data.selectedSkinId).toBe('classic');
    expect(save.save({ selectedSkinId: 'unknown' }).selectedSkinId).toBe('classic');
    expect(save.save({ ownedSkinIds: [], selectedSkinId: 'classic' }).ownedSkinIds).toEqual(['classic']);
  });
  it('returns defensive arrays from snapshots', () => {
    const { save } = setup(record);
    const snapshot = save.load();
    snapshot.ownedSkinIds.push('paint-burst');
    expect(save.data.ownedSkinIds).toEqual(['classic']);
  });
  it('keeps schema 5 and every existing field without rewriting a current save', () => {
    const existing = { ...record, selectedSkinId: 'duo-splash', ownedSkinIds: ['classic', 'rubber', 'duo-splash'], currentRunIsRecord: true };
    const { save, local } = setup(existing);
    expect(CONFIG.save.version).toBe(5);
    expect(save.data).toEqual(existing);
    expect(local.setItem).not.toHaveBeenCalled();
  });
  it('retains premium ownership and a selected premium skin across schema 5 reloads', () => {
    const existing = { ...record, lifetimePoints: 1500000, selectedSkinId: 'auric-gold',
      ownedSkinIds: ['classic', 'rubber', 'auric-gold', 'plasma-core'], currentRunIsRecord: false };
    const { save, local } = setup(existing);
    expect(save.data).toEqual(existing);
    save.save({ muted: false });
    const reloaded = new SaveManager(local, { lifecycle: false });
    expect(reloaded.data).toEqual({ ...existing, muted: false });
    expect(new SkinManager({ scoring: new ScoringManager({ save: reloaded }) }).premiumUnlocked).toBe(true);
  });
  it('sanitizes invalid/non-finite/unsafe amounts and repairs score invariants', () => {
    const { save } = setup({ ...record, pointsBalance: -5, lifetimePoints: '900',
      currentNoDeathScore: 27.9, bestNoDeathScore: null });
    expect(save.data).toMatchObject({ pointsBalance: 0, lifetimePoints: 27, currentNoDeathScore: 27, bestNoDeathScore: 27 });
    expect(save.save({ currentNoDeathScore: Infinity, pointsBalance: NaN }).currentNoDeathScore).toBe(0);
    expect(save.save({ pointsBalance: 1e30 }).pointsBalance).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('persists current/best score and record indication across save/reload', () => {
    const { local, save } = setup(record);
    save.save({ currentNoDeathScore: 9000, bestNoDeathScore: 9000, currentRunIsRecord: true });
    expect(new SaveManager(local, { lifecycle: false }).data).toMatchObject({ currentNoDeathScore: 9000,
      bestNoDeathScore: 9000, currentRunIsRecord: true });
  });
  it('keeps memory authoritative even when an old readable save cannot be overwritten', () => {
    const save = new SaveManager({ getItem: () => JSON.stringify({ version: 3, levelNumber: 40 }),
      setItem() { throw new Error('quota'); } }, { lifecycle: false });
    save.save({ currentNoDeathScore: 500, pointsBalance: 500 });
    expect(save.load()).toMatchObject({ levelNumber: 40, currentNoDeathScore: 500, pointsBalance: 500 });
  });
});

describe('bounded 350ms score coalescing and lifecycle flushes', () => {
  it('has one timer and bounded writes throughout a six-second rapid Flow descent', () => {
    vi.useFakeTimers();
    const { save, local } = setup();
    for (let pass = 1; pass <= 50; pass++) {
      save.updateDeferred({ pointsBalance: pass * (pass + 1) / 2 });
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(120);
    }
    expect(save.data.pointsBalance).toBe(1275);
    expect(local.setItem.mock.calls.length).toBeGreaterThan(1);
    expect(local.setItem.mock.calls.length).toBeLessThanOrEqual(Math.ceil(6000 / SCORE_SAVE_DEBOUNCE_MS));
    save.flush();
    expect(local.read().pointsBalance).toBe(1275);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('flushes immediately on death, retaining the final best and balance', () => {
    vi.useFakeTimers();
    const { scoring, save, local } = setup();
    const platform = { id: 'one', active: true };
    scoring.beginAttempt({ levelNumber: 1, difficultyRating: 6, platforms: [platform] }, 'ACTIVE');
    scoring.handleEvent({ type: 'platformPassed', platform });
    expect(local.setItem).not.toHaveBeenCalled();
    scoring.endRun();
    expect(local.setItem).toHaveBeenCalledTimes(1);
    expect(local.read()).toMatchObject({ currentNoDeathScore: 0, bestNoDeathScore: 6, pointsBalance: 6 });
    expect(save.pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['visibilitychange', 'pagehide', 'beforeunload'])('flushes on %s and removes listeners on disposal', type => {
    vi.useFakeTimers();
    const documentTarget = new EventTarget();
    documentTarget.hidden = false;
    const windowTarget = new EventTarget();
    const local = storage();
    const save = new SaveManager(local, { documentTarget, windowTarget });
    save.bindLifecycle(documentTarget, windowTarget); // Idempotent integration.
    save.updateDeferred({ pointsBalance: 45 });
    if (type === 'visibilitychange') {
      documentTarget.dispatchEvent(new Event(type));
      expect(local.setItem).not.toHaveBeenCalled();
      documentTarget.hidden = true;
      documentTarget.dispatchEvent(new Event(type));
    } else windowTarget.dispatchEvent(new Event(type));
    expect(local.setItem).toHaveBeenCalledTimes(1);
    expect(save.pending).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    save.dispose();
    expect(save.listeners).toHaveLength(0);
  });
  it('flushes pending points with immediate settings saves without a second stale timer write', () => {
    vi.useFakeTimers();
    const { save, local } = setup();
    save.updateDeferred({ pointsBalance: 70 });
    save.save({ muted: true });
    vi.advanceTimersByTime(1000);
    expect(local.setItem).toHaveBeenCalledTimes(1);
    expect(local.read()).toMatchObject({ muted: true, pointsBalance: 70 });
  });
  it('pending reads do not reload stale disk values', () => {
    const { save } = setup(record);
    save.updateDeferred({ pointsBalance: 16070 });
    expect(save.load().pointsBalance).toBe(16070);
    save.dispose();
  });
});

describe('direct skin ownership, purchase and equip', () => {
  it('insufficient balance cannot buy and reports the exact shortfall', () => {
    const { skins, local } = setup();
    expect(skins.getStatus('rubber')).toMatchObject({ canBuy: false, shortfall: 750, price: 750 });
    expect(skins.purchase('rubber')).toMatchObject({ ok: false, reason: 'insufficient-points', shortfall: 750 });
    expect(skins.ownedSkinIds).toEqual(['classic']);
    expect(local.setItem).not.toHaveBeenCalled();
  });
  it('purchases exactly once, deducts the exact price, owns and auto-equips immediately', () => {
    const { skins, scoring, local, changes } = setup(record);
    expect(skins.purchase('rubber')).toMatchObject({ ok: true, skinId: 'rubber', price: 750 });
    expect(scoring.data).toMatchObject({ pointsBalance: 15250, lifetimePoints: 24000, currentNoDeathScore: 1200, bestNoDeathScore: 4800 });
    expect(skins.ownedSkinIds).toEqual(['classic', 'rubber']);
    expect(skins.selectedSkinId).toBe('rubber');
    expect(skins.purchase('rubber').reason).toBe('already-owned');
    expect(local.setItem).toHaveBeenCalledTimes(1);
    expect(changes).toHaveLength(1);
    expect(skins.getStatus('rubber')).toMatchObject({ owned: true, equipped: true, canBuy: false });
    expect(new SaveManager(local, { lifecycle: false }).data).toMatchObject({ pointsBalance: 15250, selectedSkinId: 'rubber', ownedSkinIds: ['classic', 'rubber'] });
  });
  it('an exact balance can buy with no negative currency', () => {
    const { skins, scoring } = setup({ ...record, pointsBalance: 750 });
    expect(skins.purchase('rubber').ok).toBe(true);
    expect(scoring.data.pointsBalance).toBe(0);
    expect(skins.purchase('marble').ok).toBe(false);
  });
  it('equipping is free, owned-only, persists immediately and Classic cannot be removed', () => {
    const { skins, scoring, local } = setup(record);
    expect(skins.equip('paint-burst').reason).toBe('not-owned');
    skins.purchase('rubber');
    expect(skins.equip('classic').ok).toBe(true);
    expect(skins.equip('classic').reason).toBe('already-equipped');
    expect(scoring.data.pointsBalance).toBe(15250);
    expect(local.setItem).toHaveBeenCalledTimes(2);
    expect(new SaveManager(local, { lifecycle: false }).data.selectedSkinId).toBe('classic');
    expect(skins.purchase('classic').reason).toBe('already-owned');
  });
  it('unknown IDs cannot be bought or equipped', () => {
    const { skins } = setup(record);
    expect(skins.getStatus('unknown').valid).toBe(false);
    expect(skins.purchase('unknown').reason).toBe('unknown-skin');
    expect(skins.equip('unknown').reason).toBe('unknown-skin');
  });
  it('debug purchases/equips/unlocks are isolated from the normal save', () => {
    const { skins, scoring, save, local } = setup(record);
    const before = save.load();
    scoring.grantTemporaryPoints(50000);
    expect(skins.purchase('paint-burst').ok).toBe(true);
    expect(skins.selectedSkinId).toBe('paint-burst');
    skins.unlockAllTemporary();
    expect(skins.ownedSkinIds).toHaveLength(SKIN_CATALOG.length);
    expect(skins.equip('orbit').ok).toBe(true);
    expect(save.data).toEqual(before);
    expect(local.setItem).not.toHaveBeenCalled();
    expect(new SaveManager(local, { lifecycle: false }).data).toEqual(before);
  });
  it('debug purchases cannot flush over pending legitimate earnings', () => {
    const { skins, scoring, save, local } = setup(record);
    save.updateDeferred({ pointsBalance: 16080, currentNoDeathScore: 1280 });
    scoring.grantTemporaryPoints(50000);
    expect(local.read()).toMatchObject({ pointsBalance: 16080, currentNoDeathScore: 1280 });
    skins.purchase('paint-burst');
    expect(local.read()).toMatchObject({ pointsBalance: 16080, currentNoDeathScore: 1280, selectedSkinId: 'classic' });
  });
});
