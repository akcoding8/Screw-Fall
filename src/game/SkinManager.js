import { SKIN_CATALOG, DEFAULT_SKIN_ID, PREMIUM_UNLOCK_POINTS } from './SkinCatalog.js';

const definitions = new Map(SKIN_CATALOG.map(skin => [skin.id, skin]));

/** Atomic local purchases; the scoring store supplies normal or debug data. */
export class SkinManager {
  constructor({ scoring, onChange = () => {} }) {
    this.scoring = scoring;
    this.onChange = onChange;
  }

  get selectedSkinId() { return this.scoring.data.selectedSkinId; }
  get ownedSkinIds() { return [...this.scoring.data.ownedSkinIds]; }
  // Lifetime points never decrease on purchase or death, so the milestone is
  // permanent without a second persisted flag or a second currency.
  get premiumUnlocked() { return this.scoring.data.lifetimePoints >= PREMIUM_UNLOCK_POINTS; }
  isOwned(id) { return this.scoring.data.ownedSkinIds.includes(id); }

  getStatus(id) {
    const skin = definitions.get(id);
    if (!skin) return { valid: false, owned: false, equipped: false, canBuy: false, price: 0, shortfall: 0 };
    const balance = this.scoring.data.pointsBalance;
    const owned = this.isOwned(id);
    const premiumLocked = skin.tier === 'premium' && !this.premiumUnlocked;
    return { valid: true, skinId: id, owned, equipped: this.selectedSkinId === id,
      tier: skin.tier, premiumLocked, lifetimePoints: this.scoring.data.lifetimePoints,
      unlockPoints: PREMIUM_UNLOCK_POINTS,
      balance, price: skin.price, shortfall: Math.max(0, skin.price - balance),
      canBuy: !owned && !premiumLocked && balance >= skin.price };
  }

  purchase(id) {
    const skin = definitions.get(id);
    if (!skin) return { ok: false, reason: 'unknown-skin', skinId: id };
    if (this.isOwned(id)) return { ok: false, reason: 'already-owned', skinId: id, price: skin.price };
    const data = this.scoring.data;
    if (skin.tier === 'premium' && !this.premiumUnlocked) return { ok: false, reason: 'premium-locked',
      skinId: id, price: skin.price, requiredLifetimePoints: PREMIUM_UNLOCK_POINTS, lifetimePoints: data.lifetimePoints };
    if (data.pointsBalance < skin.price) return { ok: false, reason: 'insufficient-points',
      skinId: id, price: skin.price, shortfall: skin.price - data.pointsBalance };
    // The synchronous check and single update cannot interleave with a second
    // tap. Ownership is committed before callbacks or another input event run.
    this.scoring.updateProgression({ pointsBalance: data.pointsBalance - skin.price,
      ownedSkinIds: [...data.ownedSkinIds, id], selectedSkinId: id }, { immediate: true });
    const result = { ok: true, reason: 'purchased', skinId: id, price: skin.price };
    this.onChange(result);
    return result;
  }

  equip(id) {
    if (!definitions.has(id)) return { ok: false, reason: 'unknown-skin', skinId: id };
    if (!this.isOwned(id)) return { ok: false, reason: 'not-owned', skinId: id };
    if (this.selectedSkinId === id) return { ok: false, reason: 'already-equipped', skinId: id };
    this.scoring.updateProgression({ selectedSkinId: id }, { immediate: true });
    const result = { ok: true, reason: 'equipped', skinId: id };
    this.onChange(result);
    return result;
  }

  unlockAllTemporary() {
    this.scoring.markIneligible('Temporary skin unlock');
    this.scoring.updateProgression({ ownedSkinIds: SKIN_CATALOG.map(skin => skin.id),
      lifetimePoints: Math.max(this.scoring.data.lifetimePoints, PREMIUM_UNLOCK_POINTS) });
    return this.ownedSkinIds;
  }

  // Keep the free skin available even if a future caller asks for a fallback.
  get fallbackSkinId() { return DEFAULT_SKIN_ID; }
}
