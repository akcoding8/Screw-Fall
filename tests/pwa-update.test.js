import { afterEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdateManager, isSafeUpdateState, UPDATE_CHECK_INTERVAL_MS, FOREGROUND_CHECK_INTERVAL_MS } from '../src/pwa/PwaUpdateManager.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { CONFIG } from '../src/game/config.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const managers = [];
function fixture(options = {}) {
  let safety = { state: 'HOLDING' }, callbacks, time = 0, online = true;
  const registration = { waiting: null, installing: null, update: vi.fn(async () => registration) };
  const reload = vi.fn(), flushSave = vi.fn(), setUpdating = vi.fn(), onChange = vi.fn(), onOfflineReady = vi.fn(), onError = vi.fn();
  const updateSW = vi.fn(async () => { callbacks.onNeedReload(); });
  const registerSW = vi.fn(callbacksValue => { callbacks = callbacksValue; callbacks.onRegisteredSW('/sw.js', registration); return updateSW; });
  const manager = new PwaUpdateManager({ registerSW, enabled: true, supported: true, getSafety: () => safety,
    reload, flushSave, setUpdating, onChange, onOfflineReady, onError, now: () => time, isOnline: () => online, ...options });
  managers.push(manager); manager.start();
  return { manager, registration, updateSW, registerSW, reload, flushSave, setUpdating, onChange, onOfflineReady, onError,
    get callbacks() { return callbacks; }, setSafety(value) { safety = value; manager.refreshSafety(); },
    setTime(value) { time = value; }, setOnline(value) { online = value; } };
}
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); vi.useRealTimers(); });

describe('prompt-based safe update lifecycle', () => {
  it('registers once through the supported plugin callbacks and handles offline readiness once', () => {
    const f = fixture(); expect(f.manager.start()).toBe(false); expect(f.registerSW).toHaveBeenCalledTimes(1);
    expect(f.callbacks.immediate).toBe(true); expect(f.callbacks.onNeedReload).toBeTypeOf('function');
    f.callbacks.onOfflineReady(); f.callbacks.onOfflineReady();
    expect(f.onOfflineReady).toHaveBeenCalledTimes(1); expect(f.manager.snapshot.offlineReady).toBe(true);
    expect(f.manager.snapshot.promptVisible).toBe(false); expect(f.registration.update).not.toHaveBeenCalled();
  });
  it('restores offline-ready status on a later launch with an existing activated worker', () => {
    const f = fixture(); f.registration.active = { state: 'activated' };
    f.callbacks.onRegisteredSW('/sw.js', f.registration);
    expect(f.manager.snapshot.offlineReady).toBe(true); expect(f.onOfflineReady).toHaveBeenCalledTimes(1);
    f.callbacks.onOfflineReady(); expect(f.onOfflineReady).toHaveBeenCalledTimes(1);
  });
  it('does not claim offline readiness while the first worker is still activating', () => {
    const f = fixture(); f.registration.active = { state: 'activating' };
    f.callbacks.onRegisteredSW('/sw.js', f.registration);
    expect(f.manager.snapshot.offlineReady).toBe(false); expect(f.onOfflineReady).not.toHaveBeenCalled();
  });
  it('preserves both offline readiness and a waiting update when registering an existing installation', () => {
    const f = fixture(); f.registration.active = { state: 'activated' }; f.registration.waiting = {};
    f.callbacks.onRegisteredSW('/sw.js', f.registration);
    expect(f.manager.snapshot).toMatchObject({ offlineReady: true, updateAvailable: true, status: 'update-ready' });
    expect(f.reload).not.toHaveBeenCalled(); expect(f.updateSW).not.toHaveBeenCalled();
  });
  it.each(['active', 'installing', 'waiting'])('observes its own %s worker becoming activated when the plugin omits onOfflineReady', position => {
    const f = fixture(), worker = new EventTarget(); worker.state = position === 'active' ? 'activating' : 'installing';
    const registration = Object.assign(new EventTarget(), { active: null, installing: null, waiting: null, [position]: worker });
    f.callbacks.onRegisteredSW('/screw-fall/sw.js', registration);
    expect(f.manager.snapshot.offlineReady).toBe(false); expect(f.onOfflineReady).not.toHaveBeenCalled();
    worker.state = 'installed'; worker.dispatchEvent(new Event('statechange')); expect(f.manager.snapshot.offlineReady).toBe(false);
    worker.state = 'activating'; worker.dispatchEvent(new Event('statechange')); expect(f.manager.snapshot.offlineReady).toBe(false);
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange'));
    expect(f.manager.snapshot.offlineReady).toBe(true); expect(f.onOfflineReady).toHaveBeenCalledOnce();
    expect(f.manager.readinessWorkers.size).toBe(0); expect(f.updateSW).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled();
  });
  it('observes an installing worker discovered after registration without polling or premature readiness', () => {
    const f = fixture(), registration = Object.assign(new EventTarget(), { active: null, installing: null, waiting: null });
    f.callbacks.onRegisteredSW('/screw-fall/sw.js', registration);
    const worker = new EventTarget(); worker.state = 'installing'; registration.installing = worker;
    registration.dispatchEvent(new Event('updatefound'));
    expect(f.manager.snapshot.offlineReady).toBe(false); expect(f.manager.readinessWorkers.size).toBe(1);
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange'));
    expect(f.manager.snapshot.offlineReady).toBe(true); expect(f.updateSW).not.toHaveBeenCalled();
  });
  it('does not report a failed first installation as ready', () => {
    const f = fixture(), worker = new EventTarget(); worker.state = 'installing';
    f.registration.installing = worker; f.callbacks.onRegisteredSW('/screw-fall/sw.js', f.registration);
    worker.state = 'redundant'; worker.dispatchEvent(new Event('statechange'));
    expect(f.manager.snapshot.offlineReady).toBe(false); expect(f.onOfflineReady).not.toHaveBeenCalled();
    expect(f.manager.readinessWorkers.size).toBe(0);
  });
  it('deduplicates readiness listeners and removes both registration and worker listeners on disposal', () => {
    const f = fixture(), worker = new EventTarget(); worker.state = 'installing';
    const registration = Object.assign(new EventTarget(), { active: null, installing: worker, waiting: null });
    const addWorker = vi.spyOn(worker, 'addEventListener'), removeWorker = vi.spyOn(worker, 'removeEventListener');
    const addRegistration = vi.spyOn(registration, 'addEventListener'), removeRegistration = vi.spyOn(registration, 'removeEventListener');
    f.callbacks.onRegisteredSW('/screw-fall/sw.js', registration); f.callbacks.onRegisteredSW('/screw-fall/sw.js', registration);
    expect(addWorker).toHaveBeenCalledOnce(); expect(addRegistration).toHaveBeenCalledOnce(); f.manager.dispose();
    expect(removeWorker).toHaveBeenCalledOnce(); expect(removeRegistration).toHaveBeenCalledOnce();
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange')); registration.dispatchEvent(new Event('updatefound'));
    expect(f.onOfflineReady).not.toHaveBeenCalled(); expect(f.manager.readinessWorkers.size).toBe(0);
  });
  it.each(['ACTIVE', 'DEAD_ANIMATION', 'COMPLETING', 'TRANSITIONING'])('defers a waiting update during %s', state => {
    const f = fixture(); f.setSafety({ state }); f.callbacks.onNeedRefresh();
    expect(f.manager.snapshot).toMatchObject({ updateAvailable: true, promptVisible: false, deferred: true });
    expect(f.reload).not.toHaveBeenCalled(); expect(f.updateSW).not.toHaveBeenCalled();
    f.setSafety({ state: 'HOLDING' }); expect(f.manager.snapshot.promptVisible).toBe(true);
  });
  it.each(['HOLDING', 'DEAD_WAITING'])('allows a prompt in %s without activating automatically', state => {
    const f = fixture(); f.setSafety({ state }); f.callbacks.onNeedRefresh();
    expect(f.manager.snapshot.promptVisible).toBe(true); expect(f.updateSW).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'busy', 'editing', 'contextLost'])('defers during %s and refuses unsafe restart', async flag => {
    const f = fixture(); f.setSafety({ state: 'HOLDING', [flag]: true }); f.callbacks.onNeedRefresh();
    expect(f.manager.snapshot.promptVisible).toBe(false); expect(await f.manager.restartNow()).toBe(false);
    expect(f.flushSave).not.toHaveBeenCalled(); expect(f.updateSW).not.toHaveBeenCalled();
  });
  it('keeps Later dismissed through state changes and repeated plugin notices, with Settings restart available', async () => {
    const f = fixture(); f.callbacks.onNeedRefresh(); f.manager.later();
    f.setSafety({ state: 'ACTIVE' }); f.setSafety({ state: 'HOLDING' }); f.callbacks.onNeedRefresh();
    expect(f.manager.snapshot).toMatchObject({ promptVisible: false, updateAvailable: true, canRestart: true, dismissed: true });
    expect(await f.manager.restartNow()).toBe(true); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it('locks input, flushes, waits for complete evidence operations, settles shop work, flushes again, activates and reloads once', async () => {
    const pending = deferred(), order = [];
    const f = fixture({ flushSave: () => order.push('save'), awaitEvidenceWrites: () => { order.push('evidence'); return pending.promise; },
      settleTransientOperations: () => order.push('shop'), setUpdating: value => order.push(`locked:${value}`), reload: () => order.push('reload') });
    f.updateSW.mockImplementation(async () => { order.push('activate'); f.callbacks.onNeedReload(); f.callbacks.onNeedReload(); });
    f.callbacks.onNeedRefresh();
    const first = f.manager.restartNow(), second = f.manager.restartNow();
    expect(first).toBe(second); await microtasks();
    expect(order).toEqual(['locked:true', 'save', 'evidence']); expect(f.updateSW).not.toHaveBeenCalled();
    pending.resolve(); expect(await first).toBe(true);
    expect(order).toEqual(['locked:true', 'save', 'evidence', 'shop', 'save', 'activate', 'reload']);
    expect(f.updateSW).toHaveBeenCalledTimes(1); f.callbacks.onNeedReload();
    expect(order.filter(item => item === 'reload')).toHaveLength(1);
  });
  it('does not interrupt ACTIVE gameplay when another tab has activated the worker', async () => {
    const f = fixture(); f.setSafety({ state: 'ACTIVE' }); f.callbacks.onNeedRefresh(); f.callbacks.onNeedReload();
    expect(f.reload).not.toHaveBeenCalled(); expect(await f.manager.restartNow()).toBe(false);
    f.setSafety({ state: 'HOLDING' }); expect(f.manager.snapshot.promptVisible).toBe(true);
    expect(await f.manager.restartNow()).toBe(true);
    expect(f.flushSave).toHaveBeenCalledTimes(2); expect(f.updateSW).not.toHaveBeenCalled(); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it('does not reload before pending evidence commits if the controller changes while draining', async () => {
    const pending = deferred(), f = fixture({ awaitEvidenceWrites: () => pending.promise });
    f.callbacks.onNeedRefresh(); const restart = f.manager.restartNow(); await microtasks();
    f.callbacks.onNeedReload(); expect(f.reload).not.toHaveBeenCalled();
    pending.resolve(); expect(await restart).toBe(true); expect(f.reload).toHaveBeenCalledTimes(1); expect(f.updateSW).not.toHaveBeenCalled();
  });
  it('recovers from failed activation with saved progression intact', async () => {
    const records = new Map(), storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
    const save = new SaveManager(storage, { lifecycle: false });
    save.updateDeferred({ levelsCompletedHere: 199, pointsBalance: 3000, lifetimePoints: 7000, currentNoDeathScore: 400,
      bestNoDeathScore: 800, ownedSkinIds: ['classic', 'rubber'], selectedSkinId: 'rubber', startingLevelEvidenceId: 'evidence-kept' });
    const f = fixture({ flushSave: () => save.flush() }); f.updateSW.mockRejectedValue(new Error('activation failed'));
    f.callbacks.onNeedRefresh(); expect(await f.manager.restartNow()).toBe(false);
    const loaded = new SaveManager(storage, { lifecycle: false });
    expect(loaded.data).toEqual(save.data); expect(loaded.data).toMatchObject({ currentLevel: 200, pointsBalance: 3000,
      currentNoDeathScore: 400, selectedSkinId: 'rubber', startingLevelEvidenceId: 'evidence-kept' });
    expect(records.has(CONFIG.save.key)).toBe(true); expect(f.reload).not.toHaveBeenCalled();
    expect(f.setUpdating.mock.calls).toEqual([[true], [false]]);
    expect(f.manager.snapshot).toMatchObject({ status: 'update-failed', updating: false, updateAvailable: true });
    loaded.dispose(); save.dispose();
  });
  it('recovers after activation timeout and defers a late controller change until a new explicit restart', async () => {
    vi.useFakeTimers(); const f = fixture({ activationTimeoutMs: 100 }); f.updateSW.mockResolvedValue(undefined);
    f.callbacks.onNeedRefresh(); const restart = f.manager.restartNow(); await microtasks();
    await vi.advanceTimersByTimeAsync(100); expect(await restart).toBe(false);
    f.setSafety({ state: 'ACTIVE' }); f.callbacks.onNeedReload(); expect(f.reload).not.toHaveBeenCalled();
    f.setSafety({ state: 'HOLDING' }); expect(await f.manager.restartNow()).toBe(true);
    expect(f.updateSW).toHaveBeenCalledTimes(1); expect(f.reload).toHaveBeenCalledTimes(1);
  });
  it('handles a hanging updateSW promise with the same bounded timeout', async () => {
    vi.useFakeTimers(); const f = fixture({ activationTimeoutMs: 100 }); f.updateSW.mockReturnValue(new Promise(() => {}));
    f.callbacks.onNeedRefresh(); const restart = f.manager.restartNow(); await microtasks();
    await vi.advanceTimersByTimeAsync(100); expect(await restart).toBe(false); expect(f.manager.snapshot.updating).toBe(false);
  });
  it('invokes native browser timers with their global receiver rather than the manager instance', async () => {
    const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout, receivers = [];
    // Window timers enforce their receiver in browsers. Node's timers do not,
    // which otherwise hides an immediate Illegal invocation before activation.
    vi.stubGlobal('setTimeout', function (...args) {
      receivers.push(this);
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Reflect.apply(nativeSet, globalThis, args);
    });
    vi.stubGlobal('clearTimeout', function (...args) {
      receivers.push(this);
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Reflect.apply(nativeClear, globalThis, args);
    });
    try {
      const f = fixture(); f.callbacks.onNeedRefresh(); expect(await f.manager.restartNow()).toBe(true);
      expect(f.updateSW).toHaveBeenCalledOnce(); expect(f.reload).toHaveBeenCalledOnce(); expect(f.onError).not.toHaveBeenCalled();
      expect(receivers.length).toBeGreaterThanOrEqual(2); expect(receivers.every(receiver => receiver === globalThis)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it('returns safely if persistence cannot be drained and never activates', async () => {
    const f = fixture({ awaitEvidenceWrites: async () => { throw new Error('storage failed'); } });
    f.callbacks.onNeedRefresh(); expect(await f.manager.restartNow()).toBe(false);
    expect(f.updateSW).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled(); expect(f.onError).toHaveBeenCalledOnce();
  });
  it('handles reload failure without crashing the service-worker event callback', async () => {
    const f = fixture({ reload: () => { throw new Error('reload blocked'); } }); f.callbacks.onNeedRefresh();
    expect(await f.manager.restartNow()).toBe(false); expect(f.manager.snapshot.updating).toBe(false);
  });
  it('stays inert in normal development and unsupported browsers', () => {
    for (const options of [{ enabled: false }, { supported: false }]) {
      const f = fixture(options); expect(f.registerSW).not.toHaveBeenCalled();
      expect(f.manager.snapshot.status).toBe(options.enabled === false ? 'disabled' : 'unsupported');
    }
  });
  it('reports registration errors only through UI/debug callbacks and leaves the game unlocked', () => {
    const f = fixture(); f.callbacks.onRegisterError(new Error('network'));
    expect(f.manager.snapshot.error).toBe('Could not prepare offline play.'); expect(f.setUpdating).not.toHaveBeenCalled();
  });
  it('stops a drain and ignores subsequent registration callbacks after dispose', async () => {
    const pending = deferred(), f = fixture({ awaitEvidenceWrites: () => pending.promise });
    f.callbacks.onNeedRefresh(); const restart = f.manager.restartNow(); await microtasks(); f.manager.dispose();
    pending.resolve(); expect(await restart).toBe(false); f.callbacks.onNeedReload(); f.callbacks.onOfflineReady();
    expect(f.updateSW).not.toHaveBeenCalled(); expect(f.reload).not.toHaveBeenCalled(); expect(f.onOfflineReady).not.toHaveBeenCalled();
  });
  it('defines safe states without changing the simulation state machine', () => {
    expect(isSafeUpdateState()).toBe(false); expect(isSafeUpdateState({ state: 'HOLDING' })).toBe(true);
    expect(isSafeUpdateState({ state: 'UPDATING' })).toBe(false);
  });
});

describe('manual and foreground update checks', () => {
  it('throttles repeated checks, deduplicates a pending check and reports Up to date', async () => {
    const pending = deferred(), f = fixture(); f.registration.update.mockReturnValue(pending.promise);
    const first = f.manager.checkForUpdates(); expect(f.manager.snapshot.status).toBe('checking');
    expect(f.manager.checkForUpdates()).toBe(first); expect(f.registration.update).toHaveBeenCalledTimes(1);
    pending.resolve(); await first; expect(f.manager.snapshot.status).toBe('up-to-date');
    await f.manager.checkForUpdates(); expect(f.registration.update).toHaveBeenCalledTimes(1);
    f.setTime(UPDATE_CHECK_INTERVAL_MS); await f.manager.checkForUpdates(); expect(f.registration.update).toHaveBeenCalledTimes(2);
  });
  it('keeps the available update accessible after a check and after Later', async () => {
    const f = fixture(); f.registration.waiting = {}; f.manager.later();
    await f.manager.checkForUpdates(); expect(f.manager.snapshot).toMatchObject({ status: 'update-ready', promptVisible: false, canRestart: true });
  });
  it('reports Offline without network work and allows a check after reconnect', async () => {
    const f = fixture(); f.setOnline(false); await f.manager.checkForUpdates();
    expect(f.manager.snapshot.status).toBe('offline'); expect(f.registration.update).not.toHaveBeenCalled();
    f.setOnline(true); await f.manager.checkForUpdates(); expect(f.registration.update).toHaveBeenCalledTimes(1);
  });
  it('reports a failed check concisely without dropping an already waiting update', async () => {
    const f = fixture(); f.callbacks.onNeedRefresh(); f.registration.update.mockRejectedValue(new Error('network'));
    await f.manager.checkForUpdates(); expect(f.manager.snapshot).toMatchObject({ status: 'check-failed', updateAvailable: true, updating: false });
  });
  it('waits for installation before concluding a manual check', async () => {
    const f = fixture(), worker = new EventTarget(); worker.state = 'installing'; f.registration.installing = worker;
    const check = f.manager.checkForUpdates(); await microtasks(); expect(f.manager.snapshot.checking).toBe(true);
    worker.state = 'installed'; f.registration.waiting = worker; worker.dispatchEvent(new Event('statechange'));
    await check; expect(f.manager.snapshot).toMatchObject({ checking: false, status: 'update-ready' });
  });
  it('reports a redundant failed installation and removes the event listener', async () => {
    const f = fixture(), worker = new EventTarget(); worker.state = 'installing'; f.registration.installing = worker;
    const check = f.manager.checkForUpdates(); await microtasks(); worker.state = 'redundant'; worker.dispatchEvent(new Event('statechange'));
    await check; expect(f.manager.snapshot.status).toBe('check-failed'); expect(f.manager.installListeners.size).toBe(0);
  });
  it('only checks on foreground after a substantial interval, with no polling timer', async () => {
    const timers = vi.fn(setTimeout), f = fixture({ setTimer: timers });
    await f.manager.foreground(); expect(f.registration.update).not.toHaveBeenCalled();
    f.setTime(FOREGROUND_CHECK_INTERVAL_MS); await f.manager.foreground(); expect(f.registration.update).toHaveBeenCalledTimes(1);
    f.setTime(FOREGROUND_CHECK_INTERVAL_MS * 2); f.setSafety({ state: 'HOLDING', hidden: true });
    await f.manager.foreground(); expect(f.registration.update).toHaveBeenCalledTimes(1); expect(timers).not.toHaveBeenCalled();
  });
});
