import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { emptyProgress } from '../src/game/ProgressModel.js';

const defaults = { version: 5, ...emptyProgress(), muted: false, hintSeen: false, sensitivityMultiplier: 1.2, paletteStyle: 'soft', pointsBalance: 0, lifetimePoints: 0, currentNoDeathScore: 0, bestNoDeathScore: 0, currentRunIsRecord: false, selectedSkinId: 'classic', ownedSkinIds: ['classic'] };

function storage(initial) {
  const values = new Map(initial === undefined ? [] : [[CONFIG.save.key, initial]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('versioned local persistence', () => {
  it('roundtrips level, mute, hint, sensitivity and palette preferences without unknown fields', () => {
    const local = storage();
    const save = new SaveManager(local);
    save.update({ levelsCompletedHere: 1756, muted: true, hintSeen: true, sensitivityMultiplier: 2.4, paletteStyle: 'mixed', ignored: 'private' });
    expect(new SaveManager(local).load()).toEqual({ ...defaults, levelNumber: 1757, currentLevel: 1757, levelsCompletedHere: 1756, muted: true, hintSeen: true, sensitivityMultiplier: 2.4, paletteStyle: 'mixed' });
    expect(Object.keys(JSON.parse(local.getItem(CONFIG.save.key))).sort())
      .toEqual(Object.keys(defaults).sort());
  });

  it.each(['{broken', 'null', '{"version":99,"levelNumber":50}', '{"version":1,"levelNumber":-4,"muted":"yes"}'])
    ('recovers safely from corrupt or unsupported save %s', (raw) => {
      expect(new SaveManager(storage(raw)).load()).toEqual(defaults);
    });

  it('retains progress in memory when local storage is unavailable', () => {
    const save = new SaveManager({
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    });
    expect(save.save({ levelsCompletedHere: 21 })).toMatchObject({ levelNumber: 22 });
    expect(save.load()).toMatchObject({ levelNumber: 22 });
  });

  it('migrates and immediately persists every v1 preference while defaulting sensitivity', () => {
    const local = storage(JSON.stringify({ version: 1, levelNumber: 420, muted: true, hintSeen: true }));
    const migrated = new SaveManager(local).load();
    expect(migrated).toEqual({ ...defaults, levelNumber: 420, currentLevel: 420, levelsCompletedHere: 419, muted: true, hintSeen: true });
    expect(JSON.parse(local.getItem(CONFIG.save.key))).toEqual(migrated);
  });

  it('keeps the migrated progress when localStorage allows reads but rejects writes', () => {
    const original = JSON.stringify({ version: 1, levelNumber: 71, muted: true, hintSeen: true });
    const local = { getItem: () => original, setItem() { throw new Error('full'); } };
    expect(new SaveManager(local).data).toEqual({ ...defaults, levelNumber: 71, currentLevel: 71, levelsCompletedHere: 70, muted: true, hintSeen: true });
  });

  it.each([1, 2, 3])('adds absent sensitivity in a version %s save without losing progress', (version) => {
    const local = storage(JSON.stringify({ version, levelNumber: 83, muted: true, hintSeen: true }));
    expect(new SaveManager(local).load()).toEqual({ ...defaults, levelNumber: 83, currentLevel: 83, levelsCompletedHere: 82, muted: true, hintSeen: true });
  });

  it('migrates a v2 save immediately without changing level, sound, hint or sensitivity', () => {
    const local = storage(JSON.stringify({ version: 2, levelNumber: 1757, muted: true, hintSeen: true, sensitivityMultiplier: 0.7 }));
    const migrated = new SaveManager(local).data;
    expect(migrated).toEqual({ ...defaults, levelNumber: 1757, currentLevel: 1757, levelsCompletedHere: 1756, muted: true, hintSeen: true, sensitivityMultiplier: 0.7 });
    expect(JSON.parse(local.getItem(CONFIG.save.key))).toEqual(migrated);
  });

  it.each([1, 2, 3])('defaults a missing palette preference to Soft for schema %s', (version) => {
    const local = storage(JSON.stringify({ version, levelNumber: 81, sensitivityMultiplier: 3 }));
    expect(new SaveManager(local).data).toEqual({ ...defaults, levelNumber: 81, currentLevel: 81, levelsCompletedHere: 80, sensitivityMultiplier: 3 });
  });

  it.each(['soft', 'vivid', 'mixed'])('preserves the valid %s palette style', (paletteStyle) => {
    const local = storage(JSON.stringify({ ...defaults, version: 4, levelNumber: 111, paletteStyle }));
    expect(new SaveManager(local).data).toEqual({ ...defaults, levelNumber: 111, currentLevel: 111, levelsCompletedHere: 110, paletteStyle });
  });

  it.each(['Vivid', 'neon', '', 0, true, null, {}, ['soft']])('recovers invalid palette style %j without changing progress', (paletteStyle) => {
    const local = storage(JSON.stringify({ ...defaults, version: 4, levelNumber: 79, sensitivityMultiplier: 2.6, paletteStyle }));
    const save = new SaveManager(local);
    expect(save.data).toEqual({ ...defaults, levelNumber: 79, currentLevel: 79, levelsCompletedHere: 78, sensitivityMultiplier: 2.6 });
    expect(save.update({ paletteStyle }).paletteStyle).toBe('soft');
  });

  it.each([[0, 0.5], [-100, 0.5], [3.1, 3], [50, 3], [1.26, 1.3], ['2', 1.2], [null, 1.2]])
    ('clamps or replaces invalid saved sensitivity %s with %s and preserves other preferences', (value, expected) => {
      const local = storage(JSON.stringify({ version: 2, levelNumber: 19, muted: true, hintSeen: true, sensitivityMultiplier: value }));
      const save = new SaveManager(local);
      expect(save.data).toEqual({ ...defaults, levelNumber: 19, currentLevel: 19, levelsCompletedHere: 18, muted: true, hintSeen: true, sensitivityMultiplier: expected });
      expect(save.update({ sensitivityMultiplier: value }).sensitivityMultiplier).toBe(expected);
    });

  it('resets all local progress and returns defensive copies', () => {
    const local = storage();
    const save = new SaveManager(local);
    save.save({ levelsCompletedHere: 98, muted: true, hintSeen: true });
    const snapshot = save.reset();
    snapshot.levelNumber = 20;
    expect(save.load()).toEqual(defaults);
    expect(new SaveManager(local).load()).toEqual(save.load());
  });
});
