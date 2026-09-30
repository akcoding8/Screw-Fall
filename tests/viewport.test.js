import { describe, expect, it, vi } from 'vitest';
import { createGameplayRect, readVisualViewport, ViewportObserver } from '../src/game/Viewport.js';

describe('visual viewport and safe gameplay bounds', () => {
  it('uses the actual visual viewport independently of browser chrome assumptions', () => {
    expect(readVisualViewport({ innerWidth: 430, innerHeight: 932,
      visualViewport: { width: 430, height: 742, offsetTop: 15, offsetLeft: 0 } }))
      .toEqual({ width: 430, height: 742, top: 15, left: 0 });
    expect(readVisualViewport({ innerWidth: 430, innerHeight: 932 }))
      .toEqual({ width: 430, height: 932, top: 0, left: 0 });
  });

  it('falls back cleanly when a viewport event reports transient invalid sizes', () => {
    expect(readVisualViewport({ innerWidth: 390, innerHeight: 844,
      visualViewport: { width: NaN, height: 0, offsetTop: Infinity, offsetLeft: -1 } }))
      .toEqual({ width: 390, height: 844, top: 0, left: 0 });
    expect(readVisualViewport({ innerWidth: NaN, innerHeight: -1 }))
      .toEqual({ width: 1, height: 1, top: 0, left: 0 });
  });

  it('reserves all physical insets and separately exposes the measured upper UI exclusion', () => {
    expect(createGameplayRect(430, 932, { top: 59, right: 8, bottom: 34, left: 8, headerBottom: 233 }))
      .toEqual({ x: 8, y: 59, width: 414, height: 839,
        top: 59, right: 422, bottom: 898, left: 8, headerBottom: 233 });
  });

  it('clamps impossible insets without producing empty or infinite rectangles', () => {
    const rect = createGameplayRect(320, 568, { top: 1000, bottom: 1000, left: NaN, right: Infinity });
    expect(rect.height).toBe(1);
    expect(rect.width).toBe(320);
    expect(Object.values(rect).every(Number.isFinite)).toBe(true);
  });
});

function observerHarness() {
  const callbacks = new Map();
  let nextId = 0;
  const visualViewport = new EventTarget();
  Object.assign(visualViewport, { width: 390, height: 744, offsetLeft: 0, offsetTop: 20 });
  const windowObject = new EventTarget();
  Object.assign(windowObject, {
    innerWidth: 390, innerHeight: 844, visualViewport,
    requestAnimationFrame: callback => { callbacks.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => callbacks.delete(id),
    getComputedStyle: () => ({ paddingTop: '47px', paddingRight: '0px', paddingBottom: '34px', paddingLeft: '0px' }),
  });
  const probe = { setAttribute: vi.fn(), remove: vi.fn() };
  const canvas = { clientWidth: 390, clientHeight: 744 };
  const header = { getBoundingClientRect: () => ({ bottom: 241 }) };
  const element = {
    querySelector: selector => selector === 'canvas' ? canvas : header,
    getBoundingClientRect: () => ({ top: 20 }),
    style: { setProperty: vi.fn() }, append: vi.fn(),
  };
  const disconnect = vi.fn();
  let resizeCallback;
  class FakeResizeObserver {
    constructor(callback) { resizeCallback = callback; }
    observe() {}
    disconnect() { disconnect(); }
  }
  const onChange = vi.fn();
  const observer = new ViewportObserver(element, onChange, {
    windowObject, documentObject: { createElement: () => probe }, ResizeObserverClass: FakeResizeObserver,
  });
  return { observer, windowObject, visualViewport, element, canvas, probe, onChange, disconnect,
    callbacks, resize: () => resizeCallback(),
    flush: () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(fn => fn()); },
  };
}

describe('viewport event lifecycle', () => {
  it('coalesces window resize, visual resize/scroll and element resize to one update', () => {
    const h = observerHarness();
    h.windowObject.dispatchEvent(new Event('resize'));
    h.visualViewport.dispatchEvent(new Event('resize'));
    h.visualViewport.dispatchEvent(new Event('scroll'));
    h.resize();
    expect(h.callbacks.size).toBe(1);
    expect(h.onChange).not.toHaveBeenCalled();
    h.flush();
    expect(h.onChange).toHaveBeenCalledTimes(1);
    const layout = h.observer.measure();
    expect(layout.height).toBe(744);
    expect(layout.gameplayRect).toMatchObject({ y: 47, height: 663, headerBottom: 221 });
  });

  it('moves the canvas with visual scrolling without needless CSS writes for unchanged fields', () => {
    const h = observerHarness();
    expect(h.element.style.setProperty).toHaveBeenCalledTimes(4);
    h.visualViewport.offsetTop = 35;
    h.visualViewport.dispatchEvent(new Event('scroll'));
    h.flush();
    expect(h.element.style.setProperty).toHaveBeenCalledTimes(5);
    expect(h.element.style.setProperty).toHaveBeenLastCalledWith('--visual-top', '35px');
  });

  it('disconnects every listener and cancels pending work when the game is disposed', () => {
    const h = observerHarness();
    h.visualViewport.dispatchEvent(new Event('resize'));
    h.observer.dispose();
    expect(h.callbacks.size).toBe(0);
    expect(h.disconnect).toHaveBeenCalledOnce();
    expect(h.probe.remove).toHaveBeenCalledOnce();
    h.windowObject.dispatchEvent(new Event('resize'));
    h.visualViewport.dispatchEvent(new Event('resize'));
    h.visualViewport.dispatchEvent(new Event('scroll'));
    expect(h.callbacks.size).toBe(0);
    expect(h.onChange).not.toHaveBeenCalled();
  });
});
