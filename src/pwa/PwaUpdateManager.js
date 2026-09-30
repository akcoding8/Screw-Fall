export const UPDATE_CHECK_INTERVAL_MS = 60_000;
export const FOREGROUND_CHECK_INTERVAL_MS = 60 * 60_000;
export const UPDATE_ACTIVATION_TIMEOUT_MS = 20_000;

/** UI state is supplied at event boundaries, never from the animation loop. */
export function isSafeUpdateState({ state, hidden = false, busy = false, editing = false, contextLost = false } = {}) {
  return ['HOLDING', 'DEAD_WAITING'].includes(state) && !hidden && !busy && !editing && !contextLost;
}

/** Prompt-mode adapter for vite-plugin-pwa's registerSW/updateSW integration.
 * onNeedReload is deliberately owned here: another tab may activate the same
 * worker, but it must never reload this tab in the middle of a fall or edit. */
export class PwaUpdateManager {
  constructor({ registerSW, enabled = false, supported = Boolean(globalThis.navigator?.serviceWorker),
    getSafety = () => ({}), flushSave = () => {}, awaitEvidenceWrites = async () => {},
    settleTransientOperations = async () => {}, setUpdating = () => {}, onChange = () => {},
    onOfflineReady = () => {}, onError = () => {}, reload = () => globalThis.location?.reload(),
    now = () => Date.now(), isOnline = () => globalThis.navigator?.onLine !== false,
    checkIntervalMs = UPDATE_CHECK_INTERVAL_MS, foregroundIntervalMs = FOREGROUND_CHECK_INTERVAL_MS,
    activationTimeoutMs = UPDATE_ACTIVATION_TIMEOUT_MS,
    // Window timer methods require their native global receiver. Capturing
    // them directly and calling this.setTimer() fails in a real browser.
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer) } = {}) {
    Object.assign(this, { registerSW, enabled, supported, getSafety, flushSave, awaitEvidenceWrites,
      settleTransientOperations, setUpdating, onChange, onOfflineReady, onError, reload, now, isOnline,
      checkIntervalMs, foregroundIntervalMs, activationTimeoutMs, setTimer, clearTimer });
    this.started = false; this.disposed = false; this.registration = null; this.updateSW = null;
    this.offlineReady = false; this.updateAvailable = false; this.dismissed = false;
    this.updating = false; this.checking = false; this.error = '';
    this.controllerChanged = false; this.reloadIssued = false; this.activationIssued = false;
    this.activationReady = false; this.restartPromise = null; this.checkPromise = null;
    this.lastCheckAt = -Infinity; this.lastForegroundCheckAt = -Infinity;
    this.status = !enabled ? 'disabled' : !supported ? 'unsupported' : 'starting';
    this.installListeners = new Map(); this.checkWaiters = new Set();
    this.readinessRegistration = null; this.readinessWorkers = new Map();
    this.onReadinessUpdateFound = () => this.observeReadinessWorkers();
  }

  get safe() { return isSafeUpdateState(this.getSafety()); }
  get snapshot() {
    const safe = !this.disposed && this.safe;
    return Object.freeze({ enabled: this.enabled, supported: this.supported,
      registered: Boolean(this.registration), offlineReady: this.offlineReady,
      updateAvailable: this.updateAvailable, dismissed: this.dismissed,
      promptVisible: this.updateAvailable && safe && !this.dismissed && !this.updating,
      canRestart: this.updateAvailable && safe && !this.updating,
      deferred: this.updateAvailable && !safe, updating: this.updating,
      checking: this.checking, status: this.status, error: this.error,
      controllerChanged: this.controllerChanged, reloadIssued: this.reloadIssued });
  }
  get debugStatus() {
    const state = this.snapshot;
    return `${state.status} · ${state.offlineReady ? 'offline ready' : 'offline not ready'} · ${state.deferred ? 'deferred' : state.promptVisible ? 'prompt' : 'quiet'}`;
  }
  emit() { if (!this.disposed) this.onChange(this.snapshot); }
  refreshSafety() { this.emit(); return this.snapshot; }

  start() {
    if (this.started || this.disposed) return false;
    this.started = true;
    if (!this.enabled || !this.supported || typeof this.registerSW !== 'function') {
      this.status = !this.enabled ? 'disabled' : 'unsupported'; this.emit(); return false;
    }
    try {
      this.updateSW = this.registerSW({ immediate: true,
        onNeedRefresh: () => this.handleUpdateAvailable(),
        onOfflineReady: () => this.handleOfflineReady(),
        onNeedReload: () => this.handleControllerChange(),
        onRegisteredSW: (_url, registration) => this.handleRegistered(registration),
        onRegisterError: error => this.handleError(error, 'Could not prepare offline play.') });
      this.emit(); return true;
    } catch (error) { this.handleError(error, 'Could not prepare offline play.'); return false; }
  }

  handleRegistered(registration) {
    if (this.disposed || !registration) return;
    this.registration = registration;
    // register() already performs the launch update check; no second fetch.
    this.lastForegroundCheckAt = this.now();
    this.observeReadinessRegistration(registration);
    if (registration.waiting) this.handleUpdateAvailable();
    else if (!this.updateAvailable) { this.status = 'up-to-date'; this.emit(); }
  }
  observeReadinessRegistration(registration) {
    if (this.readinessRegistration !== registration) {
      this.clearReadinessListeners(); this.readinessRegistration = registration;
      registration.addEventListener?.('updatefound', this.onReadinessUpdateFound);
    }
    this.observeReadinessWorkers();
  }
  observeReadinessWorkers() {
    if (this.disposed || !this.readinessRegistration) return;
    const registration = this.readinessRegistration;
    // Another app's/root worker may initially control a project-subpath page.
    // Workbox can classify that first project install as an update and omit
    // onOfflineReady. Observe only workers belonging to our own registration;
    // activation proves that their generated app-shell precache succeeded.
    for (const worker of [registration.active, registration.installing, registration.waiting]) {
      if (!worker || this.readinessWorkers.has(worker)) continue;
      if (worker.state === 'activated') { this.handleOfflineReady(); continue; }
      if (worker.state === 'redundant' || !worker.addEventListener) continue;
      const changed = () => {
        if (!['activated', 'redundant'].includes(worker.state)) return;
        worker.removeEventListener('statechange', changed); this.readinessWorkers.delete(worker);
        if (worker.state === 'activated') this.handleOfflineReady();
      };
      this.readinessWorkers.set(worker, changed); worker.addEventListener('statechange', changed); changed();
    }
  }
  clearReadinessListeners() {
    this.readinessRegistration?.removeEventListener?.('updatefound', this.onReadinessUpdateFound);
    for (const [worker, changed] of this.readinessWorkers) worker.removeEventListener('statechange', changed);
    this.readinessWorkers.clear(); this.readinessRegistration = null;
  }
  handleOfflineReady() {
    if (this.disposed) return;
    const first = !this.offlineReady;
    this.offlineReady = true;
    if (!this.updateAvailable) this.status = 'up-to-date';
    this.emit();
    if (first) this.onOfflineReady();
  }
  handleUpdateAvailable() {
    if (this.disposed || this.reloadIssued) return;
    this.updateAvailable = true; this.error = '';
    if (!this.updating) this.status = 'update-ready';
    this.emit();
  }
  handleControllerChange() {
    if (this.disposed || this.reloadIssued) return;
    this.controllerChanged = true; this.updateAvailable = true;
    if (this.updating && this.activationReady) this.reloadOnce();
    else { this.status = 'update-ready'; this.emit(); }
  }
  handleError(error, message) {
    if (this.disposed) return;
    this.error = message; this.status = 'error'; this.onError(error); this.emit();
  }
  later() {
    if (this.updating || this.disposed) return false;
    this.dismissed = true; this.emit(); return true;
  }

  async foreground() {
    if (this.disposed || this.getSafety().hidden || this.now() - this.lastForegroundCheckAt < this.foregroundIntervalMs) return this.snapshot;
    this.lastForegroundCheckAt = this.now();
    return this.checkForUpdates();
  }
  checkForUpdates() {
    if (this.checkPromise) return this.checkPromise;
    if (this.disposed || !this.enabled || !this.supported || !this.registration?.update || this.updating) return Promise.resolve(this.snapshot);
    if (!this.isOnline()) { this.status = 'offline'; this.error = ''; this.emit(); return Promise.resolve(this.snapshot); }
    if (this.now() - this.lastCheckAt < this.checkIntervalMs) return Promise.resolve(this.snapshot);
    this.lastCheckAt = this.now(); this.checking = true; this.status = 'checking'; this.error = ''; this.emit();
    this.checkPromise = this.performCheck().finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }
  async performCheck() {
    try {
      await this.registration.update();
      if (this.registration.installing) await this.waitForInstallation(this.registration.installing);
      if (this.disposed) return this.snapshot;
      if (this.registration.waiting) this.updateAvailable = true;
      this.status = this.updateAvailable ? 'update-ready' : 'up-to-date';
    } catch (error) {
      if (!this.disposed) {
        this.status = this.isOnline() ? 'check-failed' : 'offline';
        this.error = this.status === 'offline' ? '' : 'Could not check for updates.'; this.onError(error);
      }
    } finally { this.checking = false; this.emit(); }
    return this.snapshot;
  }
  waitForInstallation(worker) {
    if (!worker?.addEventListener || ['installed', 'activated'].includes(worker.state)) return Promise.resolve();
    if (worker.state === 'redundant') return Promise.reject(new Error('The update could not be installed.'));
    return new Promise((resolve, reject) => {
      const finish = error => {
        worker.removeEventListener('statechange', changed); this.clearTimer(timer);
        this.installListeners.delete(worker); this.checkWaiters.delete(cancel);
        if (error) reject(error); else resolve();
      };
      const changed = () => {
        if (['installed', 'activated'].includes(worker.state)) finish();
        else if (worker.state === 'redundant') finish(new Error('The update could not be installed.'));
      };
      const cancel = () => finish();
      const timer = this.setTimer(() => finish(new Error('The update check took too long.')), this.activationTimeoutMs);
      this.installListeners.set(worker, changed); this.checkWaiters.add(cancel);
      worker.addEventListener('statechange', changed); changed();
    });
  }

  restartNow() {
    if (this.restartPromise) return this.restartPromise;
    if (this.disposed || !this.snapshot.canRestart || (!this.controllerChanged && typeof this.updateSW !== 'function')) return Promise.resolve(false);
    this.updating = true; this.activationReady = false; this.activationIssued = false;
    this.error = ''; this.status = 'updating';
    this.setUpdating(true); this.emit();
    this.restartPromise = this.performRestart().finally(() => { this.restartPromise = null; });
    return this.restartPromise;
  }
  async performRestart() {
    try {
      await this.flushSave();
      await this.awaitEvidenceWrites();
      await this.settleTransientOperations();
      await this.flushSave();
      if (this.disposed) return false;
      this.activationReady = true;
      if (this.controllerChanged) {
        if (!this.reloadOnce()) throw this.lastReloadError || new Error('Could not reload.');
        return true;
      }
      const activation = new Promise((resolve, reject) => { this.activationResolve = resolve; this.activationReject = reject; });
      this.activationTimer = this.setTimer(() => this.activationReject?.(new Error('The update did not activate in time.')), this.activationTimeoutMs);
      // The plugin posts Workbox's standard SKIP_WAITING message. Our
      // onNeedReload callback, rather than the plugin default, owns reloading.
      const request = Promise.resolve().then(() => {
        if (!this.controllerChanged) { this.activationIssued = true; return this.updateSW(true); }
      });
      await Promise.all([request, activation]);
      return true;
    } catch (error) {
      if (!this.disposed) {
        this.updating = false; this.activationReady = false; this.dismissed = true;
        this.status = 'update-failed'; this.error = error?.code === 'save-update-failed'
          ? 'Could not save your latest progress. Keep this game open and try again when browser storage is available.'
          : 'Could not restart. This version is still open. Try again in Settings.';
        this.setUpdating(false); this.onError(error); this.emit();
      }
      return false;
    } finally {
      if (this.activationTimer !== undefined) this.clearTimer(this.activationTimer);
      this.activationTimer = undefined; this.activationResolve = null; this.activationReject = null;
    }
  }
  reloadOnce() {
    if (this.disposed || this.reloadIssued || !this.updating || !this.activationReady) return false;
    this.reloadIssued = true;
    try { this.reload(); this.activationResolve?.(); return true; }
    catch (error) { this.reloadIssued = false; this.lastReloadError = error; this.activationReject?.(error); return false; }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearReadinessListeners();
    for (const cancel of [...this.checkWaiters]) cancel();
    if (this.activationTimer !== undefined) this.clearTimer(this.activationTimer);
    this.activationReject?.(new Error('Update manager disposed.'));
    if (this.updating && !this.reloadIssued) this.setUpdating(false);
  }
}
