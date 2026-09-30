import { describe, expect, it } from 'vitest';
import { analyzeEconomy, playEconomyPattern, ECONOMY_PROFILES } from '../src/game/EconomyAnalyzer.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { SKIN_CATALOG, STANDARD_SKINS, PREMIUM_SKINS, PREMIUM_UNLOCK_POINTS } from '../src/game/SkinCatalog.js';

const fixture = (number, count = 48) => ({ levelNumber: number, kind: number % 10 === 0 ? 'flow' : 'normal', difficultyRating: 5,
  platforms: Array.from({ length: count + 1 }, (_, index) => ({ id: `${number}-${index}`, active: true, finish: index === count })) });

describe('deterministic economy estimates', () => {
  it('uses actual scoring and never grants points for contact layers', () => {
    const save = new SaveManager(null, { lifecycle: false });
    const scoring = new ScoringManager({ save });
    const result = playEconomyPattern(scoring, fixture(1, 6), { normalDrops: [2], flowDrops: [2] });
    expect(result).toEqual({ points: 30, passes: 4, contacts: 2 });
    expect(scoring.dropStreak).toBe(0);
    expect(scoring.data.currentNoDeathScore).toBe(30);
    save.dispose();
  });
  it('reports every skin, increasing skill earnings, death resets and untouched prices', () => {
    const levels = Array.from({ length: 50 }, (_, index) => fixture(index + 1));
    const first = analyzeEconomy(levels);
    expect(analyzeEconomy(levels)).toEqual(first);
    expect(first.pricesAdjusted).toBe(false);
    expect(first.models).toHaveLength(3);
    for (const model of first.models) {
      expect(model.skins).toHaveLength(SKIN_CATALOG.length);
      expect(model.skins.filter(skin => skin.tier === 'standard')).toHaveLength(20);
      expect(model.skins.filter(skin => skin.tier === 'premium')).toHaveLength(7);
      expect(model.normalPoints.count).toBe(45);
      expect(model.flowPoints.count).toBe(5);
      expect(model.pointsPerTenLevels.count).toBe(5);
      expect(model.pointsBalance).toBe(model.lifetimePoints);
      expect(model.bestScore).toBeLessThan(model.lifetimePoints);
      expect(model.skins[0].estimatedNumberedLevels).toBe(0);
      expect(model.skins.filter(skin => skin.tier === 'standard').at(-1).price).toBe(15000);
      expect(model.skins.map(skin => skin.price)).toEqual([...STANDARD_SKINS, ...PREMIUM_SKINS].map(skin => skin.price));
      expect(model.premium.unlockLifetimePoints).toBe(PREMIUM_UNLOCK_POINTS);
      expect(model.premium.goldPrice).toBe(1000000);
      expect(model.premium.estimatedUnlockNumberedLevels).toBe(Math.ceil(100000 / model.pointsPerNumberedLevel));
      expect(model.premium.estimatedGoldNumberedLevels).toBe(Math.ceil(1000000 / model.pointsPerNumberedLevel));
      expect(model.premium.estimatedGoldAfterStandardCollectionLevels).toBeGreaterThan(model.premium.estimatedGoldNumberedLevels);
    }
    expect(first.models[1].normalPoints.mean).toBeGreaterThan(first.models[0].normalPoints.mean);
    expect(first.models[2].normalPoints.mean).toBeGreaterThan(first.models[1].normalPoints.mean);
    expect(first.models[1].skins.filter(skin => skin.tier === 'standard').at(-1).estimatedNormalLevelsOnly).toBeLessThan(100);
    const example = first.purchaseAndDeathExample;
    expect(example.purchase.ok).toBe(true);
    expect(example.afterPurchase.pointsBalance).toBe(example.before.pointsBalance - 750);
    expect(example.afterPurchase.lifetimePoints).toBe(example.before.lifetimePoints);
    expect(example.afterDeath.currentNoDeathScore).toBe(0);
    expect(example.afterDeath.bestNoDeathScore).toBe(example.before.currentNoDeathScore);
    expect(example.afterDeath.pointsBalance).toBe(example.afterPurchase.pointsBalance);
    expect(ECONOMY_PROFILES.map(profile => profile.deathEveryLevels)).toEqual([3, 8, 20]);
  });
});
