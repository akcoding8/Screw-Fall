import { ScoringManager } from './ScoringManager.js';
import { CONFIG } from './config.js';
import { SaveManager } from './SaveManager.js';
import { SkinManager } from './SkinManager.js';
import { SKIN_CATALOG, PREMIUM_UNLOCK_POINTS } from './SkinCatalog.js';

export const ECONOMY_PROFILES = Object.freeze([
  Object.freeze({ id: 'cautious', name: 'Cautious', normalDrops: Object.freeze([1, 1, 2, 1, 1, 2]),
    flowDrops: Object.freeze([2, 3, 2, 4]), deathEveryLevels: 3 }),
  Object.freeze({ id: 'capable', name: 'Capable', normalDrops: Object.freeze([2, 3, 4, 2, 4, 5]),
    flowDrops: Object.freeze([6, 9, 12, 8]), deathEveryLevels: 8 }),
  Object.freeze({ id: 'skilled', name: 'Skilled', normalDrops: Object.freeze([3, 4, 5, 6, 4, 7]),
    flowDrops: Object.freeze([18, 50, 30]), deathEveryLevels: 20 }),
]);

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((total, value) => total + value, 0);
  return { count: values.length, total: sum, mean: values.length ? sum / values.length : 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0, min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 };
}

/** Deterministic event patterns, not a claim to have measured human behaviour.
 * Every completed drop has a real non-scoring contact layer. This prevents the
 * common economy overestimate that awards points to both passes and landings.
 */
export function playEconomyPattern(scoring, level, profile) {
  scoring.beginAttempt(level, 'ACTIVE');
  const before = scoring.data.lifetimePoints;
  const pattern = level.kind === 'flow' ? profile.flowDrops : profile.normalDrops;
  const platforms = level.platforms.filter(platform => !platform.finish);
  let index = 0;
  let drop = Math.floor(level.levelNumber / 10) % pattern.length;
  let passes = 0;
  let contacts = 0;
  while (index < platforms.length) {
    const count = pattern[drop++ % pattern.length];
    for (let pass = 0; pass < count && index < platforms.length; pass++) {
      scoring.handleEvent({ type: 'platformPassed', platform: platforms[index++], levelNumber: level.levelNumber });
      passes++;
    }
    if (index < platforms.length) {
      // A contact ends the drop and does not itself earn a pass award.
      scoring.handleEvent({ type: scoring.dropStreak >= CONFIG.smash.threshold ? 'platformSmashed' : 'platformLanded',
        platform: platforms[index++] });
      contacts++;
    }
  }
  scoring.handleEvent({ type: 'gameLevelCompleted', platform: level.platforms.at(-1) });
  return { points: scoring.data.lifetimePoints - before, passes, contacts };
}

function purchaseAndDeathExample(catalog) {
  const firstPaid = catalog.find(skin => skin.price > 0);
  const save = new SaveManager(null, { lifecycle: false });
  const scoring = new ScoringManager({ save });
  const skins = new SkinManager({ scoring });
  const platforms = Array.from({ length: 50 }, (_, index) => ({ id: `example-${index}`, active: true }));
  const level = { levelNumber: 1, kind: 'normal', difficultyRating: 10, platforms };
  scoring.beginAttempt(level, 'ACTIVE');
  for (const platform of platforms) {
    scoring.handleEvent({ type: 'platformPassed', platform });
    if (scoring.data.pointsBalance >= firstPaid.price) break;
  }
  const before = { ...scoring.data, ownedSkinIds: [...scoring.data.ownedSkinIds] };
  const purchase = skins.purchase(firstPaid.id);
  const afterPurchase = { ...scoring.data, ownedSkinIds: [...scoring.data.ownedSkinIds] };
  scoring.endRun();
  const afterDeath = { ...scoring.data, ownedSkinIds: [...scoring.data.ownedSkinIds] };
  save.dispose();
  return { skinId: firstPaid.id, price: firstPaid.price, purchase, before, afterPurchase, afterDeath };
}

export function analyzeEconomy(levels, { profiles = ECONOMY_PROFILES, catalog = SKIN_CATALOG } = {}) {
  const gold = catalog.find(skin => skin.id === 'auric-gold');
  const standardCatalogPrice = catalog.filter(skin => skin.tier !== 'premium').reduce((sum, skin) => sum + skin.price, 0);
  const models = profiles.map(profile => {
    const save = new SaveManager(null, { lifecycle: false });
    const scoring = new ScoringManager({ save });
    const normal = [];
    const flow = [];
    const cadences = [];
    const deathScores = [];
    const basePoints = new Set();
    let cadencePoints = 0;
    let totalPasses = 0;
    let totalContacts = 0;
    for (let index = 0; index < levels.length; index++) {
      const level = levels[index];
      const result = playEconomyPattern(scoring, level, profile);
      basePoints.add(scoring.basePoints);
      (level.kind === 'flow' ? flow : normal).push(result.points);
      cadencePoints += result.points;
      totalPasses += result.passes;
      totalContacts += result.contacts;
      if ((index + 1) % 10 === 0) { cadences.push(cadencePoints); cadencePoints = 0; }
      // A zero-award failed attempt follows this many successful routes. This
      // demonstrates record resets without pretending death removes currency.
      if ((index + 1) % profile.deathEveryLevels === 0) {
        deathScores.push(scoring.data.currentNoDeathScore);
        scoring.endRun();
      }
    }
    const total = scoring.data.lifetimePoints;
    const perLevel = levels.length ? total / levels.length : 0;
    const normalPoints = summarize(normal);
    const result = {
      profile: profile.id,
      patterns: { normalDrops: profile.normalDrops, flowDrops: profile.flowDrops, deathEveryLevels: profile.deathEveryLevels },
      basePoints: [...basePoints].sort((a, b) => a - b),
      normalPoints, flowPoints: summarize(flow), pointsPerTenLevels: summarize(cadences),
      pointsPerNumberedLevel: perLevel, totalPasses, totalContacts,
      deathScores: summarize(deathScores), endingCurrentScore: scoring.data.currentNoDeathScore,
      bestScore: scoring.data.bestNoDeathScore, lifetimePoints: total, pointsBalance: scoring.data.pointsBalance,
      skins: catalog.map(skin => ({ id: skin.id, name: skin.name, tier: skin.tier, price: skin.price,
        estimatedNumberedLevels: skin.price === 0 ? 0 : Math.ceil(skin.price / perLevel),
        estimatedNormalLevelsOnly: skin.price === 0 ? 0 : Math.ceil(skin.price / normalPoints.mean) })),
      premium: {
        unlockLifetimePoints: PREMIUM_UNLOCK_POINTS,
        estimatedUnlockNumberedLevels: Math.ceil(PREMIUM_UNLOCK_POINTS / perLevel),
        estimatedUnlockNormalLevelsOnly: Math.ceil(PREMIUM_UNLOCK_POINTS / normalPoints.mean),
        goldPrice: gold?.price ?? null,
        estimatedGoldNumberedLevels: gold ? Math.ceil(gold.price / perLevel) : null,
        estimatedGoldNormalLevelsOnly: gold ? Math.ceil(gold.price / normalPoints.mean) : null,
        standardCatalogPrice,
        estimatedGoldAfterStandardCollectionLevels: gold ? Math.ceil((gold.price + standardCatalogPrice) / perLevel) : null,
      },
    };
    save.dispose();
    return result;
  });
  return { modelVersion: 2, levelCount: levels.length, firstLevel: levels[0]?.levelNumber,
    lastLevel: levels.at(-1)?.levelNumber,
    assumptions: [
      'Uses actual generated platform counts and hidden difficulty ratings with the production ScoringManager.',
      'Synthetic deterministic drop/contact patterns estimate earnings; they are not observed player performance or controller feasibility proofs.',
      'One non-scoring contact layer separates normal drop sequences; finish contact adds no points.',
      'A zero-award failed attempt after each profile-specific number of successful towers resets only the current record.',
      'Unlock estimates start at zero balance, saving for that one skin; buying earlier skins adds their cost.',
      'Premium access is a lifetime-earnings milestone, independent of spending; Premium skin prices use current spendable points only.',
      'Premium and Gold estimates extrapolate this generated-level sample at its mean earning rate; they do not model later-level play, play time or observed player retention.',
      'Gold-after-Standard estimates add the full Standard collection cost; other purchases add their prices without delaying the lifetime Premium milestone.',
      'Cadence estimates include every tenth Flow level; play time, retries and extra partial-run earnings are not estimated.',
    ], pricesAdjusted: false, models, purchaseAndDeathExample: purchaseAndDeathExample(catalog) };
}
