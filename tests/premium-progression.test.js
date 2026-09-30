import { describe, expect, it, vi } from 'vitest';
import { SaveManager } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { SkinManager } from '../src/game/SkinManager.js';
import { ProgressionDebug } from '../src/game/ProgressionDebug.js';
import { PREMIUM_SKINS, PREMIUM_UNLOCK_POINTS } from '../src/game/SkinCatalog.js';

function setup(partial = {}, onChange = vi.fn()) {
  let serialized = JSON.stringify({ version: 5, levelsCompletedHere: (partial.levelNumber ?? 1) - 1, ...partial });
  const storage = { getItem: () => serialized, setItem: vi.fn((key, value) => { serialized = value; }) };
  const save = new SaveManager(storage, { lifecycle: false });
  const scoring = new ScoringManager({ save });
  const skins = new SkinManager({ scoring, onChange });
  return { save, scoring, skins, storage, onChange };
}

describe('lifetime Premium milestone and spendable purchases', () => {
  it('locks at 99,999 lifetime points and rejects purchases at the model boundary', () => {
    const { skins, save, storage } = setup({ lifetimePoints: 99999, pointsBalance: 99999 });
    const before = save.load();
    expect(skins.premiumUnlocked).toBe(false);
    for (const skin of PREMIUM_SKINS) {
      expect(skins.getStatus(skin.id)).toMatchObject({ premiumLocked: true, canBuy: false, tier: 'premium', unlockPoints: 100000 });
      expect(skins.purchase(skin.id)).toMatchObject({ ok: false, reason: 'premium-locked', requiredLifetimePoints: 100000, lifetimePoints: 99999 });
    }
    expect(save.data).toEqual(before);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(skins.getStatus('rubber')).toMatchObject({ premiumLocked: false, canBuy: true });
  });

  it('unlocks at exactly 100,000 lifetime points even with no spendable balance', () => {
    const { skins } = setup({ lifetimePoints: PREMIUM_UNLOCK_POINTS, pointsBalance: 0 });
    expect(skins.premiumUnlocked).toBe(true);
    expect(skins.getStatus('pearl-shift')).toMatchObject({ premiumLocked: false, canBuy: false, shortfall: 100000 });
    expect(skins.purchase('pearl-shift')).toMatchObject({ reason: 'insufficient-points', shortfall: 100000 });
  });

  it('crosses the milestone through real scoring, keeps it after purchase, death and reload', () => {
    const { scoring, skins, storage } = setup({ lifetimePoints: 99999, pointsBalance: 99999 });
    const platform = { id: 'milestone', active: true };
    scoring.beginAttempt({ levelNumber: 10, kind: 'flow', platforms: [platform] }, 'ACTIVE');
    scoring.handleEvent({ type: 'platformPassed', platform });
    expect(skins.premiumUnlocked).toBe(true);
    expect(skins.purchase('pearl-shift').ok).toBe(true);
    expect(scoring.data).toMatchObject({ pointsBalance: 0, lifetimePoints: 100000,
      currentNoDeathScore: 1, bestNoDeathScore: 1, selectedSkinId: 'pearl-shift' });
    scoring.endRun();
    const reloaded = new SaveManager(storage, { lifecycle: false });
    const next = new SkinManager({ scoring: new ScoringManager({ save: reloaded }) });
    expect(next.premiumUnlocked).toBe(true);
    expect(reloaded.data).toMatchObject({ pointsBalance: 0, lifetimePoints: 100000, currentNoDeathScore: 0, bestNoDeathScore: 1 });
    expect(next.equip('classic').ok).toBe(true);
    expect(next.equip('pearl-shift').ok).toBe(true);
    expect(reloaded.data.pointsBalance).toBe(0);
  });

  it.each(PREMIUM_SKINS)('buys and persists $name for its exact current-points price', skin => {
    const { scoring, skins, storage, onChange } = setup({ pointsBalance: skin.price, lifetimePoints: skin.price + 5000,
      currentNoDeathScore: 100, bestNoDeathScore: 800, hintSeen: true, levelNumber: 225 });
    expect(skins.purchase(skin.id)).toMatchObject({ ok: true, price: skin.price, skinId: skin.id });
    expect(scoring.data).toMatchObject({ pointsBalance: 0, lifetimePoints: skin.price + 5000,
      currentNoDeathScore: 100, bestNoDeathScore: 800, selectedSkinId: skin.id, hintSeen: true, levelNumber: 225 });
    expect(skins.isOwned(skin.id)).toBe(true);
    expect(skins.purchase(skin.id).reason).toBe('already-owned');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const reloaded = new SaveManager(storage, { lifecycle: false });
    expect(reloaded.data).toEqual(scoring.data);
  });

  it('commits ownership before callbacks, preventing a second charge during a celebration callback', () => {
    let skins;
    const onChange = vi.fn(result => { expect(skins.purchase(result.skinId).reason).toBe('already-owned'); });
    ({ skins } = setup({ pointsBalance: 200000, lifetimePoints: 200000 }, onChange));
    expect(skins.purchase('pearl-shift').ok).toBe(true);
    expect(skins.getStatus('pearl-shift')).toMatchObject({ equipped: true, owned: true, balance: 100000, canBuy: false });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('Premium debug remains session-only', () => {
  function gameFixture(context) {
    return { ...context, scoreHUD: { refresh: vi.fn() }, ui: { 'debug-info': { textContent: '' } },
      debugText: () => 'test session', cosmetics: { profileName: 'paint/dual/dual', paintCount: 2, trailCount: 3,
        profile: { paint: 'dual', paintSize: .55 } } };
  }

  it.each(['premium-milestone', 'premium-points', 'unlock-skins'])('%s cannot modify persisted points, lifetime or ownership', action => {
    const context = setup({ lifetimePoints: 300, pointsBalance: 250, currentNoDeathScore: 50, bestNoDeathScore: 100 });
    const before = context.save.load();
    const game = gameFixture(context);
    expect(ProgressionDebug.prototype.handle.call({ game }, action)).toBe(true);
    expect(context.scoring.eligible).toBe(false);
    expect(context.skins.premiumUnlocked).toBe(true);
    if (action === 'premium-milestone') expect(context.scoring.data.pointsBalance).toBe(250);
    if (action === 'premium-points') {
      expect(context.skins.purchase('auric-gold').ok).toBe(true);
      expect(context.scoring.data.pointsBalance).toBe(250);
    }
    if (action === 'unlock-skins') expect(context.skins.equip('plasma-core').ok).toBe(true);
    expect(context.save.load()).toEqual(before);
    expect(context.storage.setItem).not.toHaveBeenCalled();
    expect(new SaveManager(context.storage, { lifecycle: false }).data).toEqual(before);
  });

  it('reports tutorial, lifetime gate, owned Premium skins and bounded paint inspection', () => {
    const context = setup({ lifetimePoints: 100000, pointsBalance: 0, hintSeen: true,
      ownedSkinIds: ['classic', 'pearl-shift'], selectedSkinId: 'pearl-shift' });
    const text = ProgressionDebug.prototype.text.call({ game: gameFixture(context), events: [] });
    expect(text).toContain('Tutorial learned');
    expect(text).toContain('Points 0 · lifetime 100000');
    expect(text).toContain('Premium unlocked · milestone 100000');
    expect(text).toContain('Owned Premium 1/7: Pearl Shift');
    expect(text).toContain('Paint 2/64 · trail 3/36');
    expect(text).toContain('Splash authored radius 0.55');
  });
});
