import { CONFIG } from './config.js';
import { normalizeSensitivity } from './sensitivity.js';
import { normalizePaletteStyle } from './PaletteManager.js';
import { normalizePoints } from './ScoreFormatter.js';
import { SKIN_CATALOG, DEFAULT_SKIN_ID } from './SkinCatalog.js';
import { emptyProgress, sanitizeProgress } from './ProgressModel.js';

export const SCORE_SAVE_DEBOUNCE_MS = 350;
const supportedVersions = [1, 2, 3, 4, 5];
const knownSkinIds = new Set(SKIN_CATALOG.map(skin => skin.id));
const copy = value => ({ ...value, ownedSkinIds: [...value.ownedSkinIds],
  laterImportedAdjustments: value.laterImportedAdjustments.map(record => ({ ...record })) });

const freshDefaults = () => ({
  version: CONFIG.save.version,
  ...emptyProgress(),
  muted: false,
  hintSeen: false,
  sensitivityMultiplier: CONFIG.input.multiplier.default,
  paletteStyle: 'soft',
  pointsBalance: 0,
  lifetimePoints: 0,
  currentNoDeathScore: 0,
  bestNoDeathScore: 0,
  currentRunIsRecord: false,
  selectedSkinId: DEFAULT_SKIN_ID,
  ownedSkinIds: [DEFAULT_SKIN_ID],
});

export function sanitizeSave(value) {
  const defaults = freshDefaults();
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !supportedVersions.includes(value.version)) return defaults;
  // Pre-Phase-3 saves never contained points or skins. Do not import arbitrary
  // unrelated values that happen to share the names of our new fields.
  const progression = value.version >= 4 ? value : defaults;
  const ownedSkinIds = [...new Set([DEFAULT_SKIN_ID,
    ...(Array.isArray(progression.ownedSkinIds) ? progression.ownedSkinIds.filter(id => knownSkinIds.has(id)) : []),
  ])];
  const currentNoDeathScore = normalizePoints(progression.currentNoDeathScore);
  const bestNoDeathScore = Math.max(currentNoDeathScore, normalizePoints(progression.bestNoDeathScore));
  const pointsBalance = normalizePoints(progression.pointsBalance);
  return {
    version: CONFIG.save.version,
    ...sanitizeProgress(value, value.version < 5),
    muted: typeof value.muted === 'boolean' ? value.muted : false,
    hintSeen: typeof value.hintSeen === 'boolean' ? value.hintSeen : false,
    sensitivityMultiplier: normalizeSensitivity(value.sensitivityMultiplier),
    paletteStyle: normalizePaletteStyle(value.paletteStyle),
    pointsBalance,
    lifetimePoints: Math.max(pointsBalance, bestNoDeathScore, normalizePoints(progression.lifetimePoints)),
    currentNoDeathScore,
    bestNoDeathScore,
    currentRunIsRecord: currentNoDeathScore > 0 && progression.currentRunIsRecord === true,
    selectedSkinId: ownedSkinIds.includes(progression.selectedSkinId) ? progression.selectedSkinId : DEFAULT_SKIN_ID,
    ownedSkinIds,
  };
}

/** Local-only persistence: arithmetic updates memory first, then one shared timer. */
export class SaveManager {
  constructor(storage, { debounceMs = SCORE_SAVE_DEBOUNCE_MS, lifecycle = true,
    documentTarget = globalThis.document, windowTarget = globalThis.window } = {}) {
    if (storage !== undefined) this.storage = storage;
    else {
      try { this.storage = globalThis.localStorage; } catch { this.storage = null; }
    }
    this.debounceMs = Math.max(250, Math.min(500, Number.isFinite(debounceMs) ? debounceMs : SCORE_SAVE_DEBOUNCE_MS));
    this.timer = null;
    this.pending = false;
    this.listeners = [];
    this.data = freshDefaults();
    this.loaded = false;
    this.load();
    if (lifecycle) this.bindLifecycle(documentTarget, windowTarget);
  }

  load() {
    // A read during gameplay must never replace pending earned points with an
    // older disk snapshot. Initial load remains migration-aware.
    if (this.loaded) return copy(this.data);
    this.loaded = true;
    try {
      const raw = this.storage?.getItem(CONFIG.save.key);
      if (raw !== null && raw !== undefined) {
        const parsed = JSON.parse(raw);
        this.data = sanitizeSave(parsed);
        if (supportedVersions.includes(parsed?.version) && parsed.version !== CONFIG.save.version) this.save();
      }
    } catch { /* Private browsing, blocked storage and malformed JSON retain memory. */ }
    return copy(this.data);
  }

  save(partial = {}) {
    this.data = sanitizeSave({ ...this.data, ...partial, version: CONFIG.save.version });
    this.pending = true;
    this.flush();
    return copy(this.data);
  }

  update(partial) { return this.save(partial); }

  updateDeferred(partial) {
    this.data = sanitizeSave({ ...this.data, ...partial, version: CONFIG.save.version });
    this.pending = true;
    // Coalesce changes within a bounded window; a long Flow descent cannot
    // postpone its first write indefinitely. At most one timer is outstanding.
    if (this.timer === null) {
      this.timer = setTimeout(() => { this.timer = null; this.flush(); }, this.debounceMs);
      this.timer?.unref?.();
    }
    return this.data;
  }

  flush() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending) return false;
    try { this.storage?.setItem(CONFIG.save.key, JSON.stringify(this.data)); } catch { /* In-memory fallback. */ }
    this.pending = false;
    return true;
  }

  /** A PWA restart must prove that the complete current save is durable.
   * Ordinary play keeps its existing in-memory fallback. This explicit gate
   * rechecks even when an earlier best-effort flush cleared the pending flag.
   * It changes neither the save schema nor any stored field. */
  flushForUpdate() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = true;
    try {
      if (typeof this.storage?.getItem !== 'function' || typeof this.storage?.setItem !== 'function') {
        throw new Error('Browser storage is unavailable.');
      }
      const serialized = JSON.stringify(this.data);
      if (this.storage.getItem(CONFIG.save.key) !== serialized) this.storage.setItem(CONFIG.save.key, serialized);
      if (this.storage.getItem(CONFIG.save.key) !== serialized) throw new Error('The saved progress could not be verified.');
      this.pending = false;
      return true;
    } catch (cause) {
      const error = new Error('Your latest progress could not be saved for this update.', { cause });
      error.code = 'save-update-failed';
      throw error;
    }
  }

  bindLifecycle(documentTarget, windowTarget) {
    if (this.listeners.length) return;
    const listen = (target, type, listener) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, listener);
      this.listeners.push({ target, type, listener });
    };
    listen(documentTarget, 'visibilitychange', () => { if (documentTarget.hidden) this.flush(); });
    listen(windowTarget, 'pagehide', () => this.flush());
    listen(windowTarget, 'beforeunload', () => this.flush());
  }

  reset() { this.data = freshDefaults(); return this.save(); }

  dispose() {
    this.flush();
    for (const { target, type, listener } of this.listeners) target.removeEventListener(type, listener);
    this.listeners.length = 0;
  }
}
