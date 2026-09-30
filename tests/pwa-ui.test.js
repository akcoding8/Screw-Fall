import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUI } from '../src/pwa/PwaUI.js';
import { InputController } from '../src/game/InputController.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { PendingOperations } from '../src/game/PendingOperations.js';
import { SessionEvidenceStore } from '../src/game/EvidenceImageStore.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const microtasks = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const fixtures = [];
class Element extends EventTarget {
  constructor(doc) { super(); Object.assign(this, { ownerDocument: doc, dataset: {}, hidden: true, disabled: false, inert: false, open: false,
    textContent: '', value: '', style: {}, children: [], clientWidth: 390 }); }
  focus() { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled && !this.inert) this.dispatchEvent(new Event('click')); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  append(node) { this.children.push(node); node.parentElement = this; }
  remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  select() { this.ownerDocument.selection = this.value; }
}
function fixture({ state = 'HOLDING', production = true, debugEnabled = false, storage, navigatorOverrides = {}, build = 'build-a', active = null } = {}) {
  const records = storage || new Map(), localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const windowObject = new EventTarget(), documentObject = new EventTarget();
  Object.assign(windowObject, { location: { origin: 'https://example.github.io', reload: vi.fn() }, isSecureContext: true,
    setTimeout, clearTimeout, localStorage, matchMedia: () => Object.assign(new EventTarget(), { matches: false }) });
  Object.assign(documentObject, { hidden: false, defaultView: windowObject, createElement: () => new Element(documentObject), execCommand: vi.fn(() => true) });
  const nodes = new Map(), gameElement = new Element(documentObject), surface = new Element(documentObject);
  gameElement.querySelector = selector => {
    if (!nodes.has(selector)) { const node = new Element(documentObject); node.parentElement = new Element(documentObject); nodes.set(selector, node); }
    return nodes.get(selector);
  };
  const gatedNodes = ['#settings-panel', '#skins-panel', '#progress-panel', '#evidence-viewer', '.toolbar-controls', '#debug'].map(selector => gameElement.querySelector(selector));
  gameElement.querySelectorAll = () => gatedNodes;
  const originalFocus = new Element(documentObject); originalFocus.focus();
  const rotate = vi.fn(), tap = vi.fn(), input = new InputController(surface, { onRotate: rotate, onTap: tap });
  const save = new SaveManager(localStorage, { lifecycle: false });
  const activity = new PendingOperations();
  const panel = { isOpen: false, busy: false, whenIdle: () => activity.whenIdle(), get pendingOperations() { return activity.count; } };
  const evidenceStore = new SessionEvidenceStore(), sessionEvidence = new SessionEvidenceStore();
  const game = { element: gameElement, input, save, progressPanel: panel, evidenceStore, sessionEvidence,
    evidenceViewer: { isOpen: false }, skinShop: { isOpen: false }, settingsController: { isOpen: false }, simulation: { state }, debugEnabled,
    updatePause: vi.fn(() => { game.paused = documentObject.hidden || game.pwaUpdating || game.pwa?.promptOpen
      || panel.isOpen || game.evidenceViewer.isOpen || game.skinShop.isOpen || game.settingsController.isOpen; input.setPaused(Boolean(game.paused)); }) };
  const navigatorObject = { serviceWorker: {}, onLine: true, ...navigatorOverrides };
  const registration = { active, waiting: null, update: vi.fn(async () => registration) };
  let callbacks;
  const updateSW = vi.fn(async () => callbacks.onNeedReload());
  const registerSW = vi.fn(options => { callbacks = options; options.onRegisteredSW('/screw-fall/sw.js', registration); return updateSW; });
  const ui = new PwaUI({ game, registerSW, production, base: '/screw-fall/', version: '1.0.0', build, windowObject, navigatorObject, documentObject });
  game.pwa = ui;
  const pointer = (target, type, id = 1, x = 100) => {
    const event = new Event(`pointer${type}`, { bubbles: true, cancelable: true });
    for (const [name, value] of Object.entries({ pointerId: id, clientX: x, clientY: 100, button: 0, pointerType: 'touch' })) Object.defineProperty(event, name, { value });
    if (['up', 'cancel'].includes(type)) windowObject.dispatchEvent(event);
    target.dispatchEvent(event);
  };
  const result = { ui, game, nodes: ui.nodes, windowObject, documentObject, navigatorObject, records, localStorage, originalFocus,
    registerSW, updateSW, registration, get callbacks() { return callbacks; }, input, rotate, tap, surface, pointer, activity, gatedNodes,
    dispose() { ui.dispose(); input.dispose(); save.dispose(); evidenceStore.dispose(); sessionEvidence.dispose(); } };
  fixtures.push(result); return result;
}
afterEach(() => { for (const f of fixtures.splice(0)) f.dispose(); vi.useRealTimers(); });

describe('PWA controls integrated with save, pointer input and native dialogs', () => {
  it('does not cover ACTIVE gameplay, then pauses at HOLDING and requires a fresh gesture after Later', () => {
    const f = fixture({ state: 'ACTIVE' });
    f.pointer(f.surface, 'down'); f.callbacks.onNeedRefresh(); f.pointer(f.surface, 'move', 1, 145);
    expect(f.ui.promptOpen).toBe(false); expect(f.rotate).toHaveBeenCalledOnce(); expect(f.game.paused).toBeFalsy();
    f.game.simulation.state = 'HOLDING'; f.ui.refreshSafety();
    expect(f.ui.promptOpen).toBe(true); expect(f.input.paused).toBe(true);
    f.pointer(f.surface, 'move', 1, 200); expect(f.rotate).toHaveBeenCalledTimes(1);
    f.nodes.later.click(); expect(f.ui.promptOpen).toBe(false); expect(f.input.paused).toBe(false);
    expect(f.documentObject.activeElement).toBe(f.originalFocus);
    f.pointer(f.surface, 'move', 1, 250); expect(f.rotate).toHaveBeenCalledTimes(1);
    f.pointer(f.surface, 'up'); f.pointer(f.surface, 'down', 2); f.pointer(f.surface, 'move', 2, 180);
    expect(f.rotate).toHaveBeenCalledTimes(2); expect(f.tap).not.toHaveBeenCalled();
  });
  it('consumes update-dialog pointers and keeps the waiting update available in Settings after Later', () => {
    const f = fixture(); f.callbacks.onNeedRefresh(); f.pointer(f.ui.dialog, 'down', 9);
    f.nodes.later.click(); f.pointer(f.surface, 'move', 9, 240); expect(f.rotate).not.toHaveBeenCalled();
    expect(f.nodes['update-now'].hidden).toBe(false); expect(f.nodes['update-now'].disabled).toBe(false);
    expect(f.nodes['update-status'].textContent).toBe('Update ready');
    f.game.simulation.state = 'ACTIVE'; f.ui.refreshSafety(); f.game.simulation.state = 'HOLDING'; f.ui.refreshSafety();
    expect(f.ui.promptOpen).toBe(false); expect(f.nodes['update-now'].hidden).toBe(false);
    f.pointer(f.surface, 'up', 9); expect(f.tap).not.toHaveBeenCalled();
  });
  it.each(['progressPanel', 'evidenceViewer', 'skinShop'])('defers until the existing %s closes', key => {
    const f = fixture(); f.game[key].isOpen = true; f.game.updatePause(); f.callbacks.onNeedRefresh();
    expect(f.ui.promptOpen).toBe(false); expect(f.ui.manager.snapshot.deferred).toBe(true);
    f.game[key].isOpen = false; f.game.updatePause(); f.ui.refreshSafety();
    expect(f.ui.promptOpen).toBe(true); expect(f.input.paused).toBe(true);
  });
  it('defers a prompt during cancelled screenshot cleanup even after its dialog closes', async () => {
    const f = fixture(), pending = deferred(); f.activity.track(pending.promise);
    f.callbacks.onNeedRefresh(); expect(f.ui.promptOpen).toBe(false);
    pending.resolve(); await f.activity.whenIdle(); f.ui.refreshSafety(); expect(f.ui.promptOpen).toBe(true);
  });
  it('keeps Settings available beneath a deliberate update prompt and exposes one manual check', async () => {
    const f = fixture(); f.game.settingsController.isOpen = true; f.game.updatePause(); f.callbacks.onNeedRefresh();
    expect(f.ui.promptOpen).toBe(true); f.nodes.later.click(); expect(f.input.paused).toBe(true);
    f.nodes.check.click(); await microtasks(); expect(f.registration.update).toHaveBeenCalledOnce();
    expect(f.nodes.check.textContent).toBe('Check for updates'); expect(f.nodes.check.disabled).toBe(false);
    f.nodes.check.click(); await microtasks(); expect(f.registration.update).toHaveBeenCalledOnce();
  });
  it('gates all editable UI, drains a just-started evidence reference commit, and reloads once with saved data', async () => {
    const f = fixture(), pending = deferred();
    f.game.save.updateDeferred({ pointsBalance: 3000, lifetimePoints: 5000, ownedSkinIds: ['classic', 'rubber'], selectedSkinId: 'rubber' });
    const flush = vi.spyOn(f.game.save, 'flushForUpdate');
    f.callbacks.onNeedRefresh(); const restart = f.ui.manager.restartNow();
    // This operation begins after acceptance, before the async drain runs. Its
    // complete reference commit must be included by the restart's final flush.
    f.activity.track(async () => { await pending.promise; f.game.save.updateDeferred({ startingLevelEvidenceId: 'retained-evidence' }); });
    expect(f.input.paused).toBe(true); expect(f.game.pwaUpdating).toBe(true);
    expect(f.gatedNodes.every(node => node.inert)).toBe(true); expect(f.nodes.later.disabled).toBe(true);
    await microtasks(); expect(f.updateSW).not.toHaveBeenCalled(); expect(flush).toHaveBeenCalledOnce();
    f.pointer(f.surface, 'down'); f.pointer(f.surface, 'move', 1, 250); expect(f.rotate).not.toHaveBeenCalled();
    pending.resolve(); expect(await restart).toBe(true); f.callbacks.onNeedReload();
    expect(flush).toHaveBeenCalledTimes(2); expect(f.updateSW).toHaveBeenCalledOnce(); expect(f.windowObject.location.reload).toHaveBeenCalledOnce();
    const restored = new SaveManager(f.localStorage, { lifecycle: false });
    expect(restored.data).toMatchObject({ pointsBalance: 3000, lifetimePoints: 5000, selectedSkinId: 'rubber', startingLevelEvidenceId: 'retained-evidence' });
    restored.dispose();
  });
  it('restores UI after an activation timeout and leaves the saved current level and scores intact', async () => {
    vi.useFakeTimers(); const f = fixture(); f.ui.manager.activationTimeoutMs = 100;
    f.game.save.updateDeferred({ levelsCompletedHere: 199, currentNoDeathScore: 800, bestNoDeathScore: 900 });
    f.updateSW.mockResolvedValue(undefined); f.callbacks.onNeedRefresh(); const restart = f.ui.manager.restartNow();
    await microtasks(); await vi.advanceTimersByTimeAsync(100); expect(await restart).toBe(false);
    expect(f.ui.promptOpen).toBe(false); expect(f.game.pwaUpdating).toBe(false); expect(f.input.paused).toBe(false);
    expect(f.gatedNodes.every(node => !node.inert)).toBe(true); expect(f.nodes['update-status'].textContent).toContain('This version is still open');
    expect(f.nodes['update-now'].hidden).toBe(false); expect(f.nodes['update-now'].disabled).toBe(false);
    expect(f.game.save.data).toMatchObject({ currentLevel: 200, currentNoDeathScore: 800, bestNoDeathScore: 900 });
    f.game.simulation.state = 'ACTIVE'; f.ui.refreshSafety(); f.callbacks.onNeedReload(); expect(f.windowObject.location.reload).not.toHaveBeenCalled();
  });
  it('refuses activation before evidence drain when the latest save cannot be persisted', async () => {
    const f = fixture(); f.game.save.save({ pointsBalance: 100, levelsCompletedHere: 99 });
    const previous = new Map(f.records), drain = vi.spyOn(f.game.progressPanel, 'whenIdle');
    f.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
    // Reproduce the older best-effort flush clearing pending after a failure.
    f.game.save.save({ pointsBalance: 250, currentNoDeathScore: 150 }); expect(f.game.save.pending).toBe(false);
    f.callbacks.onNeedRefresh(); expect(await f.ui.manager.restartNow()).toBe(false);
    expect(drain).not.toHaveBeenCalled(); expect(f.updateSW).not.toHaveBeenCalled(); expect(f.windowObject.location.reload).not.toHaveBeenCalled();
    expect(f.records).toEqual(previous); expect(f.game.save.data).toMatchObject({ pointsBalance: 250, currentNoDeathScore: 150, currentLevel: 100 });
    expect(f.nodes['update-status'].textContent).toContain('Could not save your latest progress');
    expect(f.nodes['update-status'].textContent).not.toContain('is still saved');
    expect(f.ui.promptOpen).toBe(false); expect(f.game.pwaUpdating).toBe(false); expect(f.gatedNodes.every(node => !node.inert)).toBe(true);
  });
  it('refuses activation after an evidence commit if the final save fails, retaining the new image and allowing a safe retry', async () => {
    const f = fixture(), pending = deferred(), originalSet = f.localStorage.setItem;
    f.game.save.save({ pointsBalance: 900, levelsCompletedHere: 199 });
    const flush = vi.spyOn(f.game.save, 'flushForUpdate');
    f.callbacks.onNeedRefresh(); const restart = f.ui.manager.restartNow(); let evidenceId;
    f.activity.track(async () => {
      await pending.promise;
      const record = await f.game.evidenceStore.put({ blob: new Blob(['image'], { type: 'image/webp' }),
        thumbnail: new Blob(['thumb'], { type: 'image/webp' }), width: 100, height: 100, thumbnailWidth: 100, thumbnailHeight: 100 });
      evidenceId = record.id;
      f.game.save.updateDeferred({ startingLevelEvidenceId: evidenceId, pointsBalance: 950 });
      f.localStorage.setItem = () => { throw new Error('Storage blocked during image commit'); };
    });
    await microtasks(); expect(flush).toHaveBeenCalledOnce(); pending.resolve(); expect(await restart).toBe(false);
    expect(flush).toHaveBeenCalledTimes(2); expect(f.updateSW).not.toHaveBeenCalled(); expect(f.windowObject.location.reload).not.toHaveBeenCalled();
    expect(f.game.save.data).toMatchObject({ startingLevelEvidenceId: evidenceId, pointsBalance: 950 });
    expect(await f.game.evidenceStore.get(evidenceId)).not.toBeNull(); expect(f.nodes['update-status'].textContent).toContain('Keep this game open');
    expect(f.game.pwaUpdating).toBe(false); expect(f.input.paused).toBe(false);
    f.localStorage.setItem = originalSet; expect(await f.ui.manager.restartNow()).toBe(true);
    expect(f.updateSW).toHaveBeenCalledOnce(); expect(f.windowObject.location.reload).toHaveBeenCalledOnce();
    const restored = new SaveManager(f.localStorage, { lifecycle: false });
    expect(restored.data).toMatchObject({ currentLevel: 200, startingLevelEvidenceId: evidenceId, pointsBalance: 950 }); restored.dispose();
  });
  it('turns Escape into Later without starting or retrying gameplay', () => {
    const f = fixture({ state: 'DEAD_WAITING' }); f.callbacks.onNeedRefresh();
    const cancel = new Event('cancel', { cancelable: true }); f.ui.dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true); expect(f.ui.promptOpen).toBe(false); expect(f.tap).not.toHaveBeenCalled(); expect(f.rotate).not.toHaveBeenCalled();
  });
  it('does not register workers or expose misleading offline controls in ordinary dev/debug sessions', () => {
    for (const settings of [{ production: false }, { debugEnabled: true }]) {
      const f = fixture(settings); expect(f.registerSW).not.toHaveBeenCalled(); expect(f.nodes.check.hidden).toBe(true);
      expect(f.nodes.offline.textContent).toBe('Online play available');
    }
  });
  it('disposes an open prompt without leaving pointer input paused or callbacks alive', () => {
    const f = fixture(); f.callbacks.onNeedRefresh(); expect(f.input.paused).toBe(true);
    f.ui.dispose(); expect(f.ui.promptOpen).toBe(false); expect(f.input.paused).toBe(false);
    f.callbacks.onNeedRefresh(); expect(f.ui.promptOpen).toBe(false); f.nodes.check.click(); expect(f.registration.update).not.toHaveBeenCalled();
  });
});

describe('nonblocking readiness and asynchronous native controls', () => {
  it('shows one timed toast per app build and restores readiness without repeating it on a later launch', async () => {
    vi.useFakeTimers(); const records = new Map(), first = fixture({ storage: records, state: 'ACTIVE' });
    first.callbacks.onOfflineReady(); expect(first.nodes.toast.hidden).toBe(false); expect(first.ui.promptOpen).toBe(false);
    expect(first.input.paused).toBe(false); expect(first.nodes.offline.textContent).toBe('Ready to play offline');
    await vi.advanceTimersByTimeAsync(4500); expect(first.nodes.toast.hidden).toBe(true);
    const second = fixture({ storage: records, active: { state: 'activated' } });
    expect(second.nodes.toast.hidden).toBe(true); expect(second.nodes.offline.textContent).toBe('Ready to play offline');
    const third = fixture({ storage: records, active: { state: 'activated' }, build: 'build-b' });
    expect(third.nodes.toast.hidden).toBe(false); expect([...records.keys()].filter(key => key.startsWith('screw-fall:pwa-offline:'))).toHaveLength(1);
  });
  it('copies a public base URL from Settings and never resumes a held gesture', async () => {
    const f = fixture(); f.game.settingsController.isOpen = true; f.game.updatePause();
    await f.ui.share(); expect(f.nodes['share-status'].textContent).toBe('Link copied.');
    expect(f.documentObject.selection).toBe('https://example.github.io/screw-fall/'); expect(f.input.paused).toBe(true);
    expect(f.nodes.share.disabled).toBe(false); expect(f.tap).not.toHaveBeenCalled();
  });
  it('reenables Share after an unexpected platform exception and reports a concise failure', async () => {
    const f = fixture({ navigatorOverrides: { share: vi.fn(), canShare: () => { throw new Error('platform failure'); } } });
    await f.ui.share(); expect(f.nodes.share.disabled).toBe(false); expect(f.nodes['share-status'].textContent).toBe('Could not share. Try again.');
  });
  it('ignores a native share result after disposal', async () => {
    const pending = deferred(), f = fixture({ navigatorOverrides: { share: vi.fn(() => pending.promise) } });
    const share = f.ui.share(); const status = f.nodes['share-status'].textContent; f.ui.dispose(); pending.resolve(); await share;
    expect(f.nodes['share-status'].textContent).toBe(status); expect(f.windowObject.location.reload).not.toHaveBeenCalled();
  });
  it('ignores a native install result after disposal and never starts gameplay', async () => {
    const pending = deferred(), f = fixture();
    const prompt = new Event('beforeinstallprompt', { cancelable: true });
    prompt.prompt = vi.fn(async () => {}); prompt.userChoice = pending.promise;
    f.windowObject.dispatchEvent(prompt); expect(f.nodes.install.hidden).toBe(false);
    const install = f.ui.installManager.installFromGesture({ isTrusted: true }); await microtasks();
    f.ui.dispose(); const status = f.nodes['install-status'].textContent;
    pending.resolve({ outcome: 'accepted' }); expect(await install).toBe(true);
    expect(f.nodes['install-status'].textContent).toBe(status); expect(f.rotate).not.toHaveBeenCalled(); expect(f.tap).not.toHaveBeenCalled();
  });
});
