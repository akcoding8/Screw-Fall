import { describe, expect, it, vi } from 'vitest';
import { SaveManager } from '../src/game/SaveManager.js';
import { CONFIG } from '../src/game/config.js';

function fixture() {
  const records = new Map([['another-app:save', 'untouched']]);
  const storage = { getItem: vi.fn(key => records.get(key) ?? null), setItem: vi.fn((key, value) => records.set(key, value)) };
  const save = new SaveManager(storage, { lifecycle: false });
  return { save, storage, records };
}

describe('verified save gate for an explicit PWA restart', () => {
  it('persists and reads back the complete latest snapshot without changing schema or unrelated storage', () => {
    const f = fixture();
    f.save.updateDeferred({ levelsCompletedHere: 1756, pointsBalance: 2000, lifetimePoints: 150000, currentNoDeathScore: 90,
      bestNoDeathScore: 3000, ownedSkinIds: ['classic', 'rubber'], selectedSkinId: 'rubber', startingLevelEvidenceId: 'evidence-kept' });
    const before = structuredClone(f.save.data);
    expect(f.save.flushForUpdate()).toBe(true); expect(f.save.timer).toBeNull(); expect(f.save.pending).toBe(false);
    expect(JSON.parse(f.records.get(CONFIG.save.key))).toEqual(before); expect(before.version).toBe(5);
    expect(f.records.get('another-app:save')).toBe('untouched'); expect(f.save.data).toEqual(before); f.save.dispose();
  });
  it('does not rewrite a snapshot that already matches the verified stored value', () => {
    const f = fixture(); f.save.save({ pointsBalance: 20 }); f.storage.setItem.mockClear();
    expect(f.save.flushForUpdate()).toBe(true); expect(f.storage.setItem).not.toHaveBeenCalled(); f.save.dispose();
  });
  it('rejects quota failures and keeps both recent earnings in memory and older durable progress intact', () => {
    const f = fixture(); f.save.save({ pointsBalance: 20 }); const older = f.records.get(CONFIG.save.key);
    f.storage.setItem.mockImplementation(() => { throw Object.assign(new Error('Full'), { name: 'QuotaExceededError' }); });
    f.save.updateDeferred({ pointsBalance: 2000 });
    expect(() => f.save.flushForUpdate()).toThrow(expect.objectContaining({ code: 'save-update-failed' }));
    expect(f.save.pending).toBe(true); expect(f.save.data.pointsBalance).toBe(2000); expect(f.records.get(CONFIG.save.key)).toBe(older); f.save.dispose();
  });
  it('rechecks even after an earlier normal fallback cleared the pending flag', () => {
    const f = fixture(); f.save.save({ pointsBalance: 20 });
    f.storage.setItem.mockImplementation(() => { throw new Error('Blocked'); });
    expect(() => f.save.save({ pointsBalance: 2000 })).not.toThrow(); expect(f.save.pending).toBe(false);
    expect(() => f.save.flushForUpdate()).toThrow(expect.objectContaining({ code: 'save-update-failed' }));
    expect(f.save.data.pointsBalance).toBe(2000); expect(f.save.pending).toBe(true); f.save.dispose();
  });
  it('detects silent no-op writes and permits retry when storage recovers', () => {
    const f = fixture(); f.save.save({ pointsBalance: 20 }); f.save.updateDeferred({ pointsBalance: 2000 });
    f.storage.setItem.mockImplementation(() => {});
    expect(() => f.save.flushForUpdate()).toThrow(expect.objectContaining({ code: 'save-update-failed' }));
    f.storage.setItem.mockImplementation((key, value) => f.records.set(key, value));
    expect(f.save.flushForUpdate()).toBe(true); expect(JSON.parse(f.records.get(CONFIG.save.key)).pointsBalance).toBe(2000); f.save.dispose();
  });
  it.each([null, {}, { getItem: () => { throw new Error('Blocked'); }, setItem() {} }])('rejects unavailable or unreadable storage without discarding memory', storage => {
    const save = new SaveManager(storage, { lifecycle: false }); save.save({ pointsBalance: 2000 });
    expect(() => save.flushForUpdate()).toThrow(expect.objectContaining({ code: 'save-update-failed' }));
    expect(save.data.pointsBalance).toBe(2000); expect(save.pending).toBe(true); save.dispose();
  });
});
