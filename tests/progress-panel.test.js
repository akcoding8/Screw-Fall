import { describe, expect, it, vi } from 'vitest';
import { ProgressPanel } from '../src/game/ProgressPanel.js';
import { ProgressManager } from '../src/game/ProgressManager.js';
import { STARTING_LEVEL_RECORD_ID } from '../src/game/ProgressModel.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { InputController } from '../src/game/InputController.js';

class Element extends EventTarget {
  constructor(doc, tagName = 'div') {
    super(); Object.assign(this, { ownerDocument: doc, tagName, dataset: {}, attributes: {}, children: [], open: false, textContent: '', value: '', style: {} });
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  closest() { return this.dataset.record ? this : null; }
  focus = vi.fn();
  click() { this.dispatchEvent(new Event('click')); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  set innerHTML(value) { throw new Error('Progress UI must render untrusted source/note as text'); }
}
const textTree = node => [node.textContent, ...node.children.flatMap(child => textTree(child))].filter(Boolean).join(' ');
const earned = { pointsBalance: 3000, lifetimePoints: 150000, currentNoDeathScore: 500,
  bestNoDeathScore: 600, ownedSkinIds: ['classic', 'rubber'], selectedSkinId: 'rubber' };
const image = () => ({ blob: new Blob(['image'], { type: 'image/webp' }), thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
  width: 1920, height: 2560, thumbnailWidth: 240, thumbnailHeight: 320 });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(initial = {}, options = {}) {
  const doc = { defaultView: new EventTarget(), createElement: tag => new Element(doc, tag) }, nodes = new Map();
  const element = { querySelector: id => { if (!nodes.has(id)) nodes.set(id, new Element(doc)); return nodes.get(id); } };
  element.querySelector('#progress-panel').querySelector = element.querySelector;
  const surface = new Element(doc); surface.clientWidth = 390;
  const rotate = vi.fn(), tap = vi.fn(), input = new InputController(surface, { onRotate: rotate, onTap: tap });
  let json = JSON.stringify({ version: 5, startingLevel: 1, levelsCompletedHere: 181, ...earned, ...initial });
  const storage = { getItem: () => json, setItem: vi.fn((key, value) => { json = value; }) };
  const save = new SaveManager(storage, { lifecycle: false }), scoring = new ScoringManager({ save });
  let serial = 0;
  const progress = new ProgressManager({ scoring, now: () => '2026-09-25T12:00:00.000Z', createId: () => `record-${++serial}` });
  let imageSerial = 0;
  const images = new Map();
  const store = {
    put: vi.fn(async processed => { const id = `image-${++imageSerial}`; images.set(id, processed); return { id }; }),
    delete: vi.fn(async id => images.delete(id)),
  };
  const viewer = { open: vi.fn(), close: vi.fn() };
  const urls = { createObjectURL: vi.fn(() => `blob:thumb-${++imageSerial}`), revokeObjectURL: vi.fn() };
  const processImage = vi.fn(async () => image()), onChange = vi.fn(), onOpenChange = vi.fn(open => input.setPaused(open));
  let allowed = true, activeStore = store;
  const panel = new ProgressPanel({ element, progress, input, store, getStore: () => activeStore, viewer,
    canOpen: () => allowed, onChange, onOpenChange, processImage, urlAPI: urls, ...options });
  const pointer = (target, type, id = 1, x = 100) => {
    const event = new Event(`pointer${type}`, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: id, clientX: x, clientY: 100, button: 0, pointerType: 'touch' })) Object.defineProperty(event, key, { value });
    if (type === 'up' || type === 'cancel') doc.defaultView.dispatchEvent(event);
    target.dispatchEvent(event);
  };
  const action = (actionName, id = STARTING_LEVEL_RECORD_ID) => {
    const button = new Element(doc, 'button'); button.dataset.action = actionName; button.dataset.record = id;
    panel.historyAction({ target: button }); return button;
  };
  const dispose = () => { panel.dispose(); input.dispose(); save.dispose(); };
  return { panel, progress, scoring, save, storage, input, surface, rotate, tap, store, viewer, images, processImage, urls,
    onChange, onOpenChange, pointer, action, dispose, setAllowed: value => { allowed = value; }, setStore: value => { activeStore = value; } };
}
function importForm(f, value = '1757') {
  f.panel.open(); f.panel.startImport(); f.panel.nodes.yes.click(); f.panel.nodes.yes.click(); f.panel.nodes.number.value = value;
}
function adjustmentForm(f, value = '+32') {
  f.panel.open(); f.panel.startAdjustment(); f.panel.nodes.number.value = value;
}

describe('deliberate progress wizard and review', () => {
  it('opens at the quiet overview and uses two purposeful import questions before the form', () => {
    const f = fixture();
    try {
      f.panel.open(); expect(f.panel.view).toBe('overview');
      expect(f.panel.nodes.current.textContent).toBe('182'); expect(f.panel.nodes.completed.textContent).toBe('181');
      f.panel.startImport(); expect(f.panel.view).toBe('question');
      expect(f.panel.nodes['question-text'].textContent).toBe('Have you played a similar tower game before?');
      f.panel.nodes.yes.click(); expect(f.panel.view).toBe('question');
      expect(f.panel.nodes['question-text'].textContent).toContain('level number you would like to continue from');
      f.panel.nodes.yes.click(); expect(f.panel.view).toBe('form');
      expect(f.storage.setItem).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('reviews the full calculation before confirming, preserving completions and all earned state', async () => {
    const f = fixture();
    try {
      importForm(f); f.panel.nodes.source.value = 'Previous game';
      expect(f.panel.review()).toBe(true); expect(f.progress.currentLevel).toBe(182);
      expect(textTree(f.panel.nodes['preview-values'])).toBe('Current level now 182 Imported starting level 1,757 Levels completed here 181 Resulting current level 1,938');
      expect(f.storage.setItem).not.toHaveBeenCalled();
      expect(await f.panel.confirm()).toBe(true);
      expect(f.save.data).toMatchObject({ startingLevel: 1757, levelsCompletedHere: 181, currentLevel: 1938, startingLevelSource: 'Previous game', ...earned });
      expect(f.panel.nodes.import.hidden).toBe(true); expect(f.panel.view).toBe('overview');
      expect(f.panel.startImport()).toBe(false); expect(f.onChange).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
  it.each(['0', '-2', '1.5', '2e3', 'hello', '9007199254740992'])('rejects invalid value %s before review or saving', value => {
    const f = fixture();
    try {
      importForm(f, value); expect(f.panel.review()).toBe(false);
      expect(f.panel.view).toBe('form'); expect(f.panel.nodes.error.textContent.length).toBeGreaterThan(10);
      expect(f.storage.setItem).not.toHaveBeenCalled(); expect(f.onChange).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('commits the reviewed values and ignores an unreviewed later input edit', async () => {
    const f = fixture();
    try {
      importForm(f); f.panel.nodes.source.value = 'Reviewed source'; f.panel.review();
      f.panel.nodes.number.value = '9000'; f.panel.nodes.source.value = 'Unreviewed source';
      await f.panel.confirm();
      expect(f.save.data.startingLevel).toBe(1757); expect(f.save.data.startingLevelSource).toBe('Reviewed source');
      expect(await f.panel.confirm()).toBe(false); expect(f.onChange).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
  it('requires a new review after going back to edit the form', async () => {
    const f = fixture();
    try {
      importForm(f); f.panel.review(); f.panel.back();
      expect(f.panel.view).toBe('form'); expect(f.panel.reviewValues).toBeNull();
      expect(await f.panel.confirm()).toBe(false); expect(f.storage.setItem).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('appends signed adjustments and keeps prior records and earned state', async () => {
    const f = fixture();
    try {
      adjustmentForm(f, '+32'); f.panel.nodes.source.value = 'Outside progress'; f.panel.review(); await f.panel.confirm();
      const first = { ...f.save.data.laterImportedAdjustments[0] };
      f.panel.startAdjustment(); f.panel.nodes.number.value = '-10'; f.panel.nodes.reason.value = 'correction'; f.panel.review(); await f.panel.confirm();
      expect(f.progress.currentLevel).toBe(204); expect(f.progress.adjustmentTotal).toBe(22);
      expect(f.save.data.laterImportedAdjustments[0]).toEqual(first); expect(f.save.data.laterImportedAdjustments).toHaveLength(2);
      expect(f.save.data).toMatchObject({ ...earned, startingLevel: 1, levelsCompletedHere: 181 });
      f.panel.showHistory(); expect(textTree(f.panel.nodes['history-list'])).toContain('−10 — Correct a previous entry');
      expect(f.panel.nodes['history-total'].textContent).toContain('+22'); expect(f.onChange).toHaveBeenCalledTimes(2);
    } finally { f.dispose(); }
  });
  it('renders sources and notes as text, never markup or editable history fields', async () => {
    const f = fixture();
    try {
      adjustmentForm(f); f.panel.nodes.source.value = '<img src=x onerror=alert(1)>'; f.panel.nodes.note.value = '<script>bad()</script>';
      f.panel.review(); await f.panel.confirm(); f.panel.showHistory();
      expect(textTree(f.panel.nodes['history-list'])).toContain('<img src=x onerror=alert(1)>');
      expect(textTree(f.panel.nodes['history-list'])).toContain('<script>bad()</script>');
      const tags = node => [node.tagName, ...node.children.flatMap(tags)];
      expect(tags(f.panel.nodes['history-list'])).not.toContain('input'); expect(tags(f.panel.nodes['history-list'])).not.toContain('script');
    } finally { f.dispose(); }
  });
});

describe('screenshot staging, explicit confirmation and cancellation', () => {
  it('drains a cancelled upload and its cleanup after busy becomes false', async () => {
    const pending = deferred(), cleaning = deferred(), onActivityChange = vi.fn();
    const f = fixture({}, { onActivityChange });
    try {
      importForm(f); await f.panel.prepareFile({}); f.panel.review();
      f.store.put.mockReturnValue(pending.promise); f.store.delete.mockReturnValue(cleaning.promise);
      const confirm = f.panel.confirm(); expect(f.panel.pendingOperations).toBeGreaterThan(0);
      f.panel.close(); expect(f.panel.busy).toBe(false);
      let drained = false; const drain = f.panel.whenIdle().then(() => { drained = true; });
      pending.resolve({ id: 'staged-image' }); await Promise.resolve(); await Promise.resolve();
      expect(drained).toBe(false); expect(f.progress.startingLevelConfirmed).toBe(false);
      cleaning.resolve(true); expect(await confirm).toBe(false); await drain;
      expect(f.panel.pendingOperations).toBe(0); expect(drained).toBe(true);
      expect(f.store.delete).toHaveBeenCalledWith('staged-image'); expect(onActivityChange).toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('drains a complete evidence reference commit before reporting idle', async () => {
    const pending = deferred(), f = fixture();
    try {
      importForm(f); await f.panel.prepareFile({}); f.panel.review(); f.store.put.mockReturnValue(pending.promise);
      const confirm = f.panel.confirm(), drain = f.panel.whenIdle(); pending.resolve({ id: 'committed-image' });
      await drain; expect(await confirm).toBe(true);
      expect(f.save.data.startingLevelEvidenceId).toBe('committed-image'); expect(f.panel.pendingOperations).toBe(0);
    } finally { f.dispose(); }
  });
  it('does not persist a prepared import screenshot before confirmation and cleans its preview URL on cancellation', async () => {
    const f = fixture();
    try {
      importForm(f); await f.panel.prepareFile({ name: 'screenshot.png' });
      expect(f.panel.pendingImage).not.toBeNull(); expect(f.store.put).not.toHaveBeenCalled(); expect(f.storage.setItem).not.toHaveBeenCalled();
      f.panel.close(); expect(f.panel.pendingImage).toBeNull(); expect(f.urls.revokeObjectURL).toHaveBeenCalledOnce();
      expect(f.store.delete).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('aborts a replaced or closed image decode and discards its late result', async () => {
    const f = fixture(), decoding = deferred();
    try {
      importForm(f); f.processImage.mockReturnValueOnce(decoding.promise);
      const pending = f.panel.prepareFile({ name: 'old.png' });
      const signal = f.processImage.mock.calls[0][1].signal;
      f.panel.close(); expect(signal.aborted).toBe(true);
      decoding.resolve(image()); expect(await pending).toBe(false);
      expect(f.urls.createObjectURL).not.toHaveBeenCalled(); expect(f.panel.pendingImage).toBeNull();
    } finally { f.dispose(); }
  });
  it('treats an empty replacement selection as cancellation of an older pending decode', async () => {
    const f = fixture(), decoding = deferred();
    try {
      importForm(f); f.processImage.mockReturnValueOnce(decoding.promise);
      const pending = f.panel.prepareFile({ name: 'old.png' });
      await f.panel.prepareFile(null); decoding.resolve(image()); await pending;
      expect(f.panel.pendingImage).toBeNull(); expect(f.panel.busy).toBe(false); expect(f.urls.createObjectURL).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('continues a progress import when screenshot storage is unavailable', async () => {
    const f = fixture();
    try {
      importForm(f); await f.panel.prepareFile({ name: 'screenshot.png' }); f.panel.review();
      f.store.put.mockRejectedValue(new Error('Screenshot storage unavailable.'));
      expect(await f.panel.confirm()).toBe(true); expect(f.progress.currentLevel).toBe(1938);
      expect(f.save.data.startingLevelEvidenceId).toBeNull(); expect(f.panel.nodes.status.textContent).toContain('Progress saved without a screenshot');
      expect(f.save.data).toMatchObject(earned); expect(f.onChange).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
  it('blocks a double confirm while writing the screenshot and commits exactly once', async () => {
    const f = fixture(), writing = deferred();
    try {
      importForm(f); await f.panel.prepareFile({ name: 'screenshot.png' }); f.panel.review(); f.store.put.mockReturnValue(writing.promise);
      const first = f.panel.confirm(); expect(await f.panel.confirm()).toBe(false);
      writing.resolve({ id: 'saved-image' }); expect(await first).toBe(true);
      expect(f.store.put).toHaveBeenCalledOnce(); expect(f.onChange).toHaveBeenCalledOnce();
      expect(f.save.data.startingLevelEvidenceId).toBe('saved-image');
    } finally { f.dispose(); }
  });
  it('cleans a late stored image after closure without confirming an import', async () => {
    const f = fixture(), writing = deferred();
    try {
      importForm(f); await f.panel.prepareFile({ name: 'screenshot.png' }); f.panel.review(); f.store.put.mockReturnValue(writing.promise);
      const confirming = f.panel.confirm(); f.panel.close(); writing.resolve({ id: 'late-image' });
      expect(await confirming).toBe(false); expect(f.store.delete).toHaveBeenCalledWith('late-image');
      expect(f.progress.currentLevel).toBe(182); expect(f.storage.setItem).not.toHaveBeenCalled(); expect(f.onChange).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('cleans a cancelled image using the captured store if the debug mode changes mid-write', async () => {
    const f = fixture(), writing = deferred(), temporaryStore = { put: vi.fn(), delete: vi.fn() };
    try {
      importForm(f); await f.panel.prepareFile({ name: 'screenshot.png' }); f.panel.review(); f.store.put.mockReturnValue(writing.promise);
      const confirming = f.panel.confirm(); f.scoring.markIneligible('Debug switch'); f.setStore(temporaryStore);
      writing.resolve({ id: 'normal-orphan' }); expect(await confirming).toBe(false);
      expect(f.store.delete).toHaveBeenCalledWith('normal-orphan'); expect(temporaryStore.delete).not.toHaveBeenCalled();
      expect(f.save.data.startingLevelConfirmedAt).toBeNull(); expect(f.progress.currentLevel).toBe(182);
    } finally { f.dispose(); }
  });
  it('requires explicit add/replace confirmation after file selection, and never changes level data', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' });
    try {
      const before = f.save.load(); f.panel.open(); f.panel.showHistory(); f.action('attach');
      expect(await f.panel.attachEvidence({ name: 'replacement.png' })).toBe(true);
      expect(f.panel.view).toBe('attachment'); expect(f.panel.nodes['attachment-confirm'].textContent).toBe('Replace screenshot');
      expect(f.store.put).not.toHaveBeenCalled(); expect(f.save.data.startingLevelEvidenceId).toBe('old-image');
      expect(await f.panel.confirmEvidence()).toBe(true);
      expect(f.save.data).toEqual({ ...before, startingLevelEvidenceId: expect.stringMatching(/^image-/) });
      expect(f.store.delete).toHaveBeenCalledWith('old-image'); expect(f.onChange).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('cancels replacement review without storing anything or deleting the original', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' });
    try {
      f.panel.open(); f.panel.showHistory(); f.action('attach'); await f.panel.attachEvidence({ name: 'replacement.png' });
      f.panel.nodes['attachment-cancel'].click();
      expect(f.panel.view).toBe('history'); expect(f.store.put).not.toHaveBeenCalled(); expect(f.store.delete).not.toHaveBeenCalled();
      expect(f.save.data.startingLevelEvidenceId).toBe('old-image'); expect(f.urls.revokeObjectURL).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
  it('leaves existing evidence untouched when replacement storage fails', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' });
    try {
      f.panel.open(); f.panel.showHistory(); f.action('attach'); await f.panel.attachEvidence({ name: 'replacement.png' });
      f.store.put.mockRejectedValue(new Error('No storage space'));
      expect(await f.panel.confirmEvidence()).toBe(false);
      expect(f.save.data.startingLevelEvidenceId).toBe('old-image'); expect(f.store.delete).not.toHaveBeenCalled();
      expect(f.panel.nodes.error.textContent).toBe('No storage space'); expect(f.onChange).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('discards a late replacement after close, preserving the old evidence', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' }), writing = deferred();
    try {
      f.panel.open(); f.panel.showHistory(); f.action('attach'); await f.panel.attachEvidence({ name: 'replacement.png' });
      f.store.put.mockReturnValue(writing.promise); const confirming = f.panel.confirmEvidence();
      f.panel.close(); writing.resolve({ id: 'late-replacement' }); expect(await confirming).toBe(false);
      expect(f.save.data.startingLevelEvidenceId).toBe('old-image'); expect(f.store.delete).toHaveBeenCalledWith('late-replacement');
      expect(f.store.delete).not.toHaveBeenCalledWith('old-image'); expect(f.onChange).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('cannot overwrite evidence changed while a replacement upload is in flight', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' }), writing = deferred();
    try {
      f.panel.open(); f.panel.showHistory(); f.action('attach'); await f.panel.attachEvidence({ name: 'replacement.png' });
      f.store.put.mockReturnValue(writing.promise); const confirming = f.panel.confirmEvidence();
      f.progress.setEvidence(STARTING_LEVEL_RECORD_ID, 'another-image'); writing.resolve({ id: 'obsolete-replacement' });
      expect(await confirming).toBe(false); expect(f.save.data.startingLevelEvidenceId).toBe('another-image');
      expect(f.store.delete).toHaveBeenCalledWith('obsolete-replacement'); expect(f.store.delete).not.toHaveBeenCalledWith('another-image');
    } finally { f.dispose(); }
  });
  it('requires removal confirmation and commits it before asynchronous binary cleanup', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' }), removing = deferred();
    try {
      const before = f.save.load(); f.panel.open(); f.panel.showHistory(); f.action('remove');
      expect(f.panel.view).toBe('remove'); expect(f.save.data.startingLevelEvidenceId).toBe('old-image');
      f.store.delete.mockReturnValue(removing.promise); const pending = f.panel.removeEvidence();
      expect(f.save.data.startingLevelEvidenceId).toBeNull(); expect(await f.panel.removeEvidence()).toBe(false);
      const writes = f.storage.setItem.mock.calls.length; f.panel.close(); removing.resolve(true); expect(await pending).toBe(true);
      expect(f.storage.setItem).toHaveBeenCalledTimes(writes); expect(f.save.data).toEqual({ ...before, startingLevelEvidenceId: null });
      expect(f.onChange).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('keeps the screenshot when removal is cancelled', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' });
    try {
      f.panel.open(); f.panel.showHistory(); f.action('remove'); f.panel.nodes['remove-cancel'].click();
      expect(f.panel.view).toBe('history'); expect(await f.panel.removeEvidence()).toBe(false);
      expect(f.save.data.startingLevelEvidenceId).toBe('old-image'); expect(f.store.delete).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('retries failed cleanup on the next open without another progress write', async () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' });
    try {
      f.panel.open(); f.panel.showHistory(); f.action('remove'); f.store.delete.mockRejectedValueOnce(new Error('Temporarily unavailable'));
      expect(await f.panel.removeEvidence()).toBe(true); expect(f.panel.nodes.status.textContent).toContain('cleanup will be retried');
      const writes = f.storage.setItem.mock.calls.length; f.panel.close(); f.panel.open();
      await vi.waitFor(() => expect(f.store.delete).toHaveBeenCalledTimes(2));
      expect(f.storage.setItem).toHaveBeenCalledTimes(writes); expect(f.save.data.startingLevelEvidenceId).toBeNull();
    } finally { f.dispose(); }
  });
});

describe('progress modal pointer and lifecycle isolation', () => {
  it('honours safe-state availability and requires a fresh pointer after closing', () => {
    const f = fixture();
    try {
      f.setAllowed(false); expect(f.panel.open()).toBe(false);
      f.setAllowed(true); f.pointer(f.panel.trigger, 'down'); f.panel.open(); expect(f.input.paused).toBe(true);
      f.pointer(f.panel.dialog, 'move', 1, 240); f.panel.close();
      f.pointer(f.surface, 'move', 1, 270); f.pointer(f.surface, 'up', 1, 270);
      expect(f.rotate).not.toHaveBeenCalled(); expect(f.tap).not.toHaveBeenCalled();
      f.pointer(f.surface, 'down', 2, 100); f.pointer(f.surface, 'move', 2, 150); expect(f.rotate).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
  it('opens the read-only viewer without changing a record and closes it with Progress', () => {
    const f = fixture({ startingLevelEvidenceId: 'old-image' });
    try {
      f.panel.open(); f.panel.showHistory(); const button = f.action('view');
      expect(f.viewer.open).toHaveBeenCalledWith('old-image', { returnFocus: button }); expect(f.storage.setItem).not.toHaveBeenCalled();
      f.panel.close(); expect(f.viewer.close).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
  it('ignores a queued native close event after reopening', () => {
    const f = fixture();
    try {
      f.panel.dialog.close = () => { f.panel.dialog.open = false; };
      f.panel.open(); f.panel.close(); f.panel.open(); f.panel.dialog.dispatchEvent(new Event('close'));
      expect(f.panel.isOpen).toBe(true); expect(f.input.paused).toBe(true);
      expect(f.onOpenChange.mock.calls.map(call => call[0])).toEqual([true, false, true]);
    } finally { f.dispose(); }
  });
});
