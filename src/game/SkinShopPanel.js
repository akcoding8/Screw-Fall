import { SKIN_CATALOG, PREMIUM_UNLOCK_POINTS, getSkinDefinition } from './SkinCatalog.js';
import { formatScore } from './ScoreFormatter.js';
import { SkinPreviewRenderer } from './SkinPreviewRenderer.js';
import { PurchaseCelebration } from './PurchaseCelebration.js';

/** Native modal owns pointer isolation; progression owns every transaction. */
export class SkinShopPanel {
  constructor({ element, input, skins, scoring, getPalette, canOpen, onOpenChange = () => {}, onPurchase = () => {}, preview = null, celebration = null }) {
    Object.assign(this, { element, input, skins, scoring, getPalette, canOpen, onOpenChange, onPurchase });
    this.dialog = element.querySelector('#skins-panel');
    this.trigger = element.querySelector('#skins-toggle');
    this.done = element.querySelector('#skins-done');
    this.grid = element.querySelector('#skins-grid');
    this.scrollPane = element.querySelector('.skins-scroll');
    this.action = element.querySelector('#skin-action');
    this.status = element.querySelector('#skin-status');
    this.tabs = { standard: element.querySelector('#skins-standard'), premium: element.querySelector('#skins-premium') };
    this.collection = element.querySelector('#skins-collection');
    this.unlock = element.querySelector('#premium-unlock');
    this.progress = element.querySelector('#premium-progress');
    this.progressBar = element.querySelector('#premium-progress-bar');
    this.lockLabel = element.querySelector('#premium-lock-label');
    this.celebration = celebration || new PurchaseCelebration(element.querySelector('#purchase-celebration'));
    this.nodes = Object.fromEntries(['skins-balance', 'skin-name', 'skin-summary', 'skin-category', 'skin-price',
      'stat-points', 'stat-lifetime', 'stat-current', 'stat-best', 'stat-owned'].map(id => [id, element.querySelector(`#${id}`)]));
    this.listeners = [];
    this.cards = new Map();
    this.preview = preview || new SkinPreviewRenderer({ canvas: element.querySelector('#skin-preview'),
      palette: getPalette(), onThumbnail: (id, url) => { const card = this.cards.get(id); if (card) card.image.src = url; } });
    this.selectedId = skins.selectedSkinId;
    this.tier = getSkinDefinition(this.selectedId).tier;
    this.selections = { standard: 'classic', premium: 'pearl-shift', [this.tier]: this.selectedId };
    this.buildCards();
    this.listen(this.trigger, 'pointerdown', event => this.consumePointer(event));
    this.listen(this.trigger, 'click', event => { event.stopPropagation(); this.open(); });
    this.listen(this.dialog, 'pointerdown', event => this.consumePointer(event));
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'click']) this.listen(this.dialog, type, event => event.stopPropagation());
    this.listen(this.grid, 'click', event => {
      const card = event.target.closest('[data-skin]');
      if (card) this.select(card.dataset.skin);
    });
    this.listen(this.action, 'click', () => this.transact());
    for (const [tier, tab] of Object.entries(this.tabs)) {
      this.listen(tab, 'click', () => this.setTier(tier));
      this.listen(tab, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'standard' : event.key === 'End' ? 'premium' : tier === 'standard' ? 'premium' : 'standard';
        this.setTier(next); this.tabs[next].focus();
      });
    }
    this.listen(this.done, 'click', () => this.close());
    this.listen(this.dialog, 'cancel', event => { event.preventDefault(); this.close(); });
    this.listen(this.dialog, 'close', () => this.finishClose());
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  listen(target, type, callback) { target.addEventListener(type, callback); this.listeners.push({ target, type, callback }); }
  get isOpen() { return this.dialog.open; }
  consumePointer(event) { this.input.blockPointer(event.pointerId); event.stopPropagation(); }

  buildCards() {
    const doc = this.grid.ownerDocument;
    for (const skin of SKIN_CATALOG) {
      const button = doc.createElement('button');
      button.type = 'button'; button.className = 'skin-card'; button.dataset.skin = skin.id;
      button.dataset.tier = skin.tier;
      const image = doc.createElement('img'); image.alt = ''; image.width = 96; image.height = 96;
      const name = doc.createElement('span'); name.className = 'skin-card-name'; name.textContent = skin.name;
      const price = doc.createElement('span'); price.className = 'skin-card-price';
      button.append(image, name, price); this.grid.append(button);
      this.cards.set(skin.id, { button, image, price });
    }
  }

  open() {
    if (this.isOpen || !this.canOpen()) return false;
    this.input.invalidateGesture();
    this.selectedId = this.skins.selectedSkinId;
    this.tier = getSkinDefinition(this.selectedId).tier;
    this.selections[this.tier] = this.selectedId;
    this.scrollPane.scrollTop = 0;
    this.status.textContent = '';
    this.dialog.showModal(); this.openNotified = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.onOpenChange(true);
    this.preview.open(this.selectedId, this.getPalette());
    for (const [id, card] of this.cards) card.image.src = this.preview.thumbnail(id);
    this.refresh(); this.done.focus();
    return true;
  }

  select(id) {
    const skin = getSkinDefinition(id);
    if (skin.tier !== this.tier || (skin.tier === 'premium' && !this.skins.premiumUnlocked)) return false;
    this.selectedId = skin.id;
    this.selections[this.tier] = this.selectedId;
    this.celebration.clear();
    this.status.textContent = '';
    this.preview.select(this.selectedId); this.refresh();
    // A choice near the end of the collection brings its preview and deliberate
    // Buy/Equip action back into view, including on a small phone.
    this.scrollPane.scrollTop = 0;
    return true;
  }

  setTier(tier) {
    if (!this.tabs[tier]) return false;
    this.tier = tier; this.selectedId = this.selections[tier];
    this.status.textContent = ''; this.celebration.clear();
    this.preview.select(this.selectedId); this.refresh(); this.scrollPane.scrollTop = 0;
    return true;
  }

  refresh() {
    const skin = getSkinDefinition(this.selectedId), data = this.scoring.data;
    const owned = this.skins.isOwned(skin.id), equipped = this.skins.selectedSkinId === skin.id;
    const locked = this.tier === 'premium' && !this.skins.premiumUnlocked;
    this.dialog.dataset.tier = this.tier;
    this.collection.hidden = locked; this.unlock.hidden = !locked;
    this.lockLabel.hidden = this.skins.premiumUnlocked;
    this.tabs.premium.setAttribute('aria-controls', this.skins.premiumUnlocked ? 'skins-collection' : 'premium-unlock');
    this.progress.textContent = `${formatScore(data.lifetimePoints)} / ${formatScore(PREMIUM_UNLOCK_POINTS)}`;
    this.progressBar.value = Math.min(PREMIUM_UNLOCK_POINTS, data.lifetimePoints);
    this.collection.setAttribute('aria-labelledby', `skins-${this.tier}`);
    this.grid.setAttribute('aria-label', `${this.tier === 'premium' ? 'Premium' : 'Standard'} skins`);
    for (const [tier, tab] of Object.entries(this.tabs)) {
      tab.setAttribute('aria-selected', String(tier === this.tier));
      tab.tabIndex = tier === this.tier ? 0 : -1;
    }
    this.nodes['skins-balance'].textContent = `${formatScore(data.pointsBalance)} Points`;
    this.nodes['skin-name'].textContent = skin.name;
    this.nodes['skin-category'].textContent = skin.category;
    this.nodes['skin-summary'].textContent = skin.summary || skin.description || '';
    this.nodes['skin-price'].textContent = equipped ? 'Equipped' : owned ? 'Owned' : `${formatScore(skin.price)} Points`;
    const missing = Math.max(0, skin.price - data.pointsBalance);
    this.action.disabled = locked || equipped || (!owned && missing > 0);
    this.action.textContent = equipped ? 'Equipped' : owned ? 'Equip' : `Buy for ${formatScore(skin.price)} Points`;
    if (missing && !owned) this.status.textContent = `${formatScore(missing)} more Points needed`;
    for (const [id, card] of this.cards) {
      const item = getSkinDefinition(id), selected = id === skin.id;
      card.button.hidden = item.tier !== this.tier;
      card.button.setAttribute('aria-pressed', String(selected));
      card.button.dataset.equipped = String(id === this.skins.selectedSkinId);
      card.button.setAttribute('aria-label', `${item.name}, ${id === this.skins.selectedSkinId ? 'equipped' : this.skins.isOwned(id) ? 'owned' : `${formatScore(item.price)} Points`}`);
      card.price.textContent = id === this.skins.selectedSkinId ? 'Equipped' : this.skins.isOwned(id) ? 'Owned' : `${formatScore(item.price)} Points`;
    }
    for (const [id, value] of Object.entries({ 'stat-points': data.pointsBalance, 'stat-lifetime': data.lifetimePoints,
      'stat-current': data.currentNoDeathScore, 'stat-best': data.bestNoDeathScore })) this.nodes[id].textContent = formatScore(value);
    this.nodes['stat-owned'].textContent = `${this.skins.ownedSkinIds.length} / ${SKIN_CATALOG.length}`;
  }

  transact() {
    if (!this.isOpen || this.action.disabled) return false;
    const owned = this.skins.isOwned(this.selectedId);
    const result = owned ? this.skins.equip(this.selectedId) : this.skins.purchase(this.selectedId);
    this.refresh();
    this.status.textContent = result.ok ? `${getSkinDefinition(this.selectedId).name} equipped` : 'Purchase unavailable';
    if (result.ok && result.reason === 'purchased') {
      const skin = getSkinDefinition(result.skinId);
      this.celebration.start(skin); this.onPurchase(skin);
    }
    return result.ok;
  }

  close() { if (this.isOpen) this.dialog.close(); this.finishClose(); }
  finishClose() {
    if (!this.openNotified || this.isOpen) return;
    this.openNotified = false; this.preview.close(); this.celebration.clear(); this.input.invalidateGesture();
    this.trigger.setAttribute('aria-expanded', 'false'); this.onOpenChange(false); this.trigger.focus();
  }
  update(dt) { if (this.isOpen) { if (!this.collection.hidden) this.preview.update(dt); this.celebration.update(dt); } }
  setPalette(palette) { this.preview.setPalette(palette); }
  dispose() {
    this.close();
    for (const { target, type, callback } of this.listeners) target.removeEventListener(type, callback);
    this.listeners.length = 0; this.preview.dispose(); this.celebration.dispose(); this.grid.replaceChildren(); this.cards.clear();
  }
}
