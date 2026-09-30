import { describe, expect, it, vi } from 'vitest';
import { EvidenceViewer, EVIDENCE_CAPTION } from '../src/game/EvidenceViewer.js';
import { InputController } from '../src/game/InputController.js';

class Element extends EventTarget {
  constructor(doc) { super(); this.ownerDocument = doc; this.dataset = {}; this.style = {}; this.attributes = {}; this.open = false; this.textContent = ''; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  focus = vi.fn();
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}
function fixture() {
  const doc = { defaultView: new EventTarget() }, nodes = new Map();
  const dialog = new Element(doc);
  dialog.querySelector = id => { if (!nodes.has(id)) nodes.set(id, new Element(doc)); return nodes.get(id); };
  const surface = new Element(doc); surface.clientWidth = 390;
  const rotate = vi.fn(), tap = vi.fn();
  const input = new InputController(surface, { onRotate: rotate, onTap: tap });
  const store = { get: vi.fn(async id => id === 'missing' ? null : { id, width: 1920, height: 2560, blob: new Blob(['image'], { type: 'image/png' }) }) };
  const urls = { createObjectURL: vi.fn(() => 'blob:viewer-image'), revokeObjectURL: vi.fn() };
  const onOpenChange = vi.fn(open => input.setPaused(open));
  const viewer = new EvidenceViewer({ dialog, input, store, urlAPI: urls, onOpenChange });
  const pointer = (target, type, id = 1, x = 100) => {
    const event = new Event(`pointer${type}`, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: id, clientX: x, clientY: 100, button: 0, pointerType: 'touch' })) Object.defineProperty(event, key, { value });
    if (type === 'up' || type === 'cancel') doc.defaultView.dispatchEvent(event);
    target.dispatchEvent(event);
  };
  return { viewer, dialog, nodes, input, surface, rotate, tap, store, urls, onOpenChange, pointer,
    dispose: () => { viewer.dispose(); input.dispose(); } };
}

describe('read-only screenshot viewer and fresh gesture boundary', () => {
  it('shows the player-provided label with fit/actual-size controls, without progress mutation access', async () => {
    const f = fixture();
    try {
      expect(await f.viewer.open('evidence-1')).toBe(true); expect(f.viewer.isOpen).toBe(true);
      expect(f.viewer.caption.textContent).toBe(EVIDENCE_CAPTION);
      expect(f.viewer.image.src).toBe('blob:viewer-image'); expect(f.viewer.image.hidden).toBe(false);
      f.viewer.zoomButton.dispatchEvent(new Event('click'));
      expect(f.viewer.image.style.width).toBe('1920px'); expect(f.viewer.zoomButton.textContent).toBe('Fit image');
      f.viewer.zoomButton.dispatchEvent(new Event('click'));
      expect(f.viewer.image.style.width).toBe(''); expect(f.viewer.zoomButton.textContent).toBe('Actual size');
      expect(Object.keys(f.store)).toEqual(['get']); expect(f.viewer).not.toHaveProperty('progress');
    } finally { f.dispose(); }
  });
  it('isolates modal pointers and requires a fresh drag after close', async () => {
    const f = fixture();
    try {
      await f.viewer.open('evidence-1'); f.pointer(f.dialog, 'down');
      f.pointer(f.dialog, 'move', 1, 240); f.viewer.close();
      f.pointer(f.surface, 'move', 1, 270); f.pointer(f.surface, 'up', 1, 270);
      expect(f.rotate).not.toHaveBeenCalled(); expect(f.tap).not.toHaveBeenCalled();
      f.pointer(f.surface, 'down', 2, 100); f.pointer(f.surface, 'move', 2, 150);
      expect(f.rotate).toHaveBeenCalledOnce(); expect(f.input.paused).toBe(false);
      expect(f.urls.revokeObjectURL).toHaveBeenCalledWith('blob:viewer-image');
    } finally { f.dispose(); }
  });
  it('handles a missing blob in a closable viewer', async () => {
    const f = fixture();
    try {
      expect(await f.viewer.open('missing')).toBe(false);
      expect(f.viewer.caption.textContent).toContain('no longer available');
      expect(f.viewer.image.hidden).toBe(true); expect(f.viewer.zoomButton.disabled).toBe(true);
      f.viewer.closeButton.dispatchEvent(new Event('click')); expect(f.viewer.isOpen).toBe(false);
    } finally { f.dispose(); }
  });
  it('handles unavailable storage without throwing or modifying anything else', async () => {
    const f = fixture();
    try {
      f.store.get.mockRejectedValue(new Error('Private storage unavailable'));
      expect(await f.viewer.open('evidence-1')).toBe(false); expect(f.viewer.caption.textContent).toContain('Your progress is unchanged');
      expect(f.urls.createObjectURL).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('discards an old asynchronous image result after close', async () => {
    const f = fixture(); let resolve;
    try {
      f.store.get.mockImplementation(() => new Promise(done => { resolve = done; }));
      const pending = f.viewer.open('old'); f.viewer.close();
      resolve({ id: 'old', blob: new Blob(['image']), width: 400 });
      expect(await pending).toBe(false); expect(f.urls.createObjectURL).not.toHaveBeenCalled();
    } finally { f.dispose(); }
  });
  it('ignores an old native close event after reopening and restores focus once', async () => {
    const f = fixture(), returnFocus = new Element();
    try {
      f.dialog.close = () => { f.dialog.open = false; };
      await f.viewer.open('first', { returnFocus }); f.viewer.close();
      expect(returnFocus.focus).toHaveBeenCalledOnce();
      await f.viewer.open('second', { returnFocus }); f.dialog.dispatchEvent(new Event('close'));
      expect(f.viewer.isOpen).toBe(true); expect(f.input.paused).toBe(true);
      expect(f.onOpenChange.mock.calls.map(call => call[0])).toEqual([true, false, true]);
    } finally { f.dispose(); }
  });
  it('cancels native Escape and revokes object URLs on dismissal or disposal', async () => {
    const f = fixture(); await f.viewer.open('evidence-1');
    const event = new Event('cancel', { cancelable: true }); f.dialog.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(f.viewer.isOpen).toBe(false);
    expect(f.urls.revokeObjectURL).toHaveBeenCalledOnce(); f.dispose();
    expect(f.urls.revokeObjectURL).toHaveBeenCalledOnce();
    expect(f.viewer.listeners).toHaveLength(0);
  });
});
