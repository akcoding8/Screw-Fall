import { PwaUpdateManager } from './PwaUpdateManager.js';
import { InstallManager } from './InstallManager.js';
import { publicAppUrl } from './PwaPaths.js';
import { shareApp } from './ShareApp.js';

const statuses = { disabled: 'Offline caching is off in development/debug mode', unsupported: 'Offline installation is unavailable in this browser',
  starting: 'Preparing offline play…', 'up-to-date': 'Up to date', 'update-ready': 'Update ready', checking: 'Checking…',
  offline: 'Offline', 'check-failed': 'Could not check', updating: 'Restarting…', 'update-failed': 'Could not restart', error: 'Offline setup unavailable' };

/** PWA controls respond to lifecycle events, never to rendering frames. */
export class PwaUI {
  constructor({ game, registerSW, production, devEnabled = false, base, version, build,
    windowObject = window, navigatorObject = navigator, documentObject = document }) {
    Object.assign(this, { game, windowObject, navigatorObject, documentObject, version, build });
    this.listeners = []; this.disposed = false;
    this.nodes = Object.fromEntries(['version','display-status','offline','update-status','check','update-now','install-status','install-help','install',
      'share','share-status','toast','update-dialog','restart','later','update-detail'].map(id => [id, game.element.querySelector(`#pwa-${id}`)]));
    this.dialog = this.nodes['update-dialog'];
    this.url = publicAppUrl({ origin: windowObject.location.origin, base, production });
    this.nodes.version.textContent = `Version ${version}${build === 'local' ? ' · local build' : ` · ${build}`}`;
    this.nodes.share.disabled = !this.url;
    if (!this.url) this.nodes['share-status'].textContent = 'A public link will be available after deployment.';
    this.installManager = new InstallManager({ windowObject, navigatorObject, onChange: state => this.renderInstall(state) });
    this.renderInstall(this.installManager.snapshot);
    this.manager = new PwaUpdateManager({ registerSW, enabled: (production || devEnabled) && !game.debugEnabled,
      supported: Boolean(navigatorObject.serviceWorker) && windowObject.isSecureContext,
      getSafety: () => ({ state: game.simulation.state, hidden: documentObject.hidden, contextLost: game.contextLost,
        busy: game.progressPanel.busy || game.progressPanel.pendingOperations > 0 || game.evidenceStore.pendingWrites > 0 || game.sessionEvidence.pendingWrites > 0,
        editing: game.progressPanel.isOpen || game.evidenceViewer.isOpen || game.skinShop.isOpen }),
      flushSave: () => game.save.flushForUpdate(),
      awaitEvidenceWrites: async () => { await game.progressPanel.whenIdle(); await game.evidenceStore.whenIdle(); await game.sessionEvidence.whenIdle(); },
      setUpdating: updating => this.setUpdating(updating), onChange: state => this.render(state),
      onOfflineReady: () => this.offlineToast(base), reload: () => windowObject.location.reload(),
      isOnline: () => navigatorObject.onLine !== false,
      onError: error => { if (game.debugEnabled) console.warn('Screw Fall PWA:', error); } });
    this.listen(this.nodes.check, 'click', () => this.manager.checkForUpdates());
    this.listen(this.nodes['update-now'], 'click', () => this.manager.restartNow());
    this.listen(this.nodes.restart, 'click', () => this.manager.restartNow());
    this.listen(this.nodes.later, 'click', () => this.manager.later());
    this.listen(this.dialog, 'cancel', event => { event.preventDefault(); this.manager.later(); });
    this.listen(this.dialog, 'pointerdown', event => { game.input.blockPointer(event.pointerId); event.stopPropagation(); });
    for (const type of ['click', 'pointermove', 'pointerup', 'pointercancel']) this.listen(this.dialog, type, event => event.stopPropagation());
    this.listen(this.nodes.install, 'click', event => { game.input.invalidateGesture(); void this.installManager.installFromGesture(event); });
    this.listen(this.nodes.share, 'click', () => this.share());
    this.listen(documentObject, 'visibilitychange', () => {
      this.refreshSafety(); if (!documentObject.hidden) void this.manager.foreground();
    });
    this.listen(windowObject, 'online', () => this.refreshSafety());
    this.manager.start();
  }
  listen(target, type, listener) { target.addEventListener(type, listener); this.listeners.push({ target, type, listener }); }
  get promptOpen() { return this.dialog.open; }
  refreshSafety() { this.manager?.refreshSafety(); }
  renderInstall(state) {
    if (this.disposed) return;
    this.nodes['install-status'].textContent = state.status;
    this.nodes['display-status'].textContent = state.status === 'Installed' ? 'Installed · standalone' : 'Running in browser';
    this.nodes['install-help'].textContent = state.guidance;
    this.nodes.install.hidden = !state.canInstall;
    this.game.element.dataset.standalone = String(state.status === 'Installed');
  }
  render(state) {
    if (this.disposed) return;
    this.nodes.offline.textContent = state.offlineReady ? 'Ready to play offline' : state.enabled && state.supported ? 'Offline play is being prepared' : 'Online play available';
    this.nodes['update-status'].textContent = state.error || statuses[state.status] || '';
    this.nodes.check.hidden = !state.enabled || !state.supported;
    this.nodes.check.disabled = !state.registered || state.checking || state.updating;
    this.nodes.check.textContent = state.checking ? 'Checking…' : 'Check for updates';
    this.nodes['update-now'].hidden = !state.updateAvailable;
    this.nodes['update-now'].disabled = !state.canRestart;
    this.nodes.restart.disabled = !state.canRestart;
    this.nodes.later.disabled = state.updating;
    this.nodes['update-detail'].textContent = state.updating ? 'Saving your progress and restarting…' : 'A new version of Screw Fall is available.';
    const show = state.promptVisible || state.updating;
    if (show && !this.dialog.open) {
      this.returnFocus = this.documentObject.activeElement;
      this.game.input.invalidateGesture(); this.dialog.showModal(); this.nodes.restart.focus(); this.game.updatePause();
    } else if (!show && this.dialog.open) {
      this.dialog.close(); this.game.input.invalidateGesture(); this.returnFocus?.focus(); this.game.updatePause();
    }
  }
  setUpdating(value) {
    this.game.pwaUpdating = value; this.game.input.invalidateGesture();
    for (const element of this.game.element.querySelectorAll('#settings-panel, #skins-panel, #progress-panel, #evidence-viewer, .toolbar-controls, #debug')) element.inert = value;
    this.game.updatePause();
  }
  offlineToast(base) {
    if (this.disposed) return;
    const key = `screw-fall:pwa-offline:${base}`;
    const revision = `${this.version}:${this.build}`;
    try { if (this.windowObject.localStorage.getItem(key) === revision) return; this.windowObject.localStorage.setItem(key, revision); } catch { /* Nonpersistent feedback is fine. */ }
    this.nodes.toast.textContent = 'Ready to play offline'; this.nodes.toast.hidden = false;
    this.toastTimer = this.windowObject.setTimeout(() => { this.nodes.toast.hidden = true; }, 4500);
  }
  copyFallback(url) {
    if (this.disposed) return false;
    const input = this.documentObject.createElement('textarea'); input.value = url;
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    // Native dialogs make the rest of the document inert, so copy within About.
    this.nodes.share.parentElement.append(input); input.select();
    let copied = false;
    try { copied = this.documentObject.execCommand('copy'); } catch { /* Show the selectable URL instead. */ }
    input.remove(); this.nodes.share.focus(); return copied;
  }
  async share() {
    if (this.disposed || this.nodes.share.disabled) return;
    this.game.input.invalidateGesture(); this.nodes.share.disabled = true;
    try {
      const status = await shareApp({ url: this.url, navigatorObject: this.navigatorObject, copyFallback: url => this.copyFallback(url) });
      if (!this.disposed) this.nodes['share-status'].textContent = status;
    } catch {
      if (!this.disposed) this.nodes['share-status'].textContent = 'Could not share. Try again.';
    } finally { if (!this.disposed) this.nodes.share.disabled = !this.url; }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.manager.dispose(); this.installManager.dispose();
    this.windowObject.clearTimeout(this.toastTimer);
    for (const { target, type, listener } of this.listeners) target.removeEventListener(type, listener);
    this.listeners.length = 0;
    if (this.dialog.open) this.dialog.close();
    this.game.input.invalidateGesture(); this.game.updatePause();
  }
}
