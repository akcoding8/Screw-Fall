import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/game/InputController.js';
import { CONFIG } from '../src/game/config.js';
import { dragRotation } from '../src/game/math.js';

class Surface extends EventTarget {
  clientWidth = 400;
  captures = new Set();
  ownerDocument = { defaultView: new EventTarget() };
  setPointerCapture(id) { this.captures.add(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}

const controllers = [];
afterEach(() => {
  for (const controller of controllers) controller.dispose();
  controllers.length = 0;
});

function setup(options = {}) {
  const surface = new Surface();
  const callbacks = { onRotate: vi.fn(), onTap: vi.fn(), onInteract: vi.fn() };
  const state = { value: 'HOLDING' };
  const input = new InputController(surface, {
    ...callbacks,
    canRotate: () => state.value === 'HOLDING' || state.value === 'ACTIVE',
    canRetry: () => state.value === 'DEAD_WAITING',
    ...options,
  });
  controllers.push(input);
  function pointer(type, { id = 1, x = 100, y = 100, time = 0, pointerType = 'touch' } = {}) {
    const event = new Event(`pointer${type}`, { cancelable: true });
    for (const [key, value] of Object.entries({
      pointerId: id, clientX: x, clientY: y, timeStamp: time, button: 0, pointerType,
    })) Object.defineProperty(event, key, { value });
    surface.dispatchEvent(event);
    return event;
  }
  return { surface, input, state, pointer, ...callbacks };
}

describe('direct horizontal control', () => {
  it('does not rotate on pointer down, a stationary tap, or tiny touch jitter', () => {
    const { pointer, onRotate, onTap, onInteract, surface } = setup();
    expect(pointer('down').defaultPrevented).toBe(true);
    expect(surface.captures.has(1)).toBe(true);
    pointer('move', { x: 102 });
    pointer('up', { x: 102, time: 70 });
    expect(onRotate).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
    expect(onInteract).toHaveBeenCalledOnce();
    expect(surface.captures.size).toBe(0);
  });

  it('applies the full first drag immediately and every later delta directly', () => {
    const { pointer, onRotate } = setup();
    pointer('down');
    pointer('move', { x: 99 });
    pointer('move', { x: 80 });
    pointer('move', { x: 79 });
    pointer('move', { x: 85 });
    expect(onRotate.mock.calls.map(([delta]) => delta)).toEqual([
      dragRotation(-20, 400, CONFIG.input),
      dragRotation(-1, 400, CONFIG.input),
      dragRotation(6, 400, CONFIG.input),
    ]);
  });

  it('maps left to negative Three rotation.y and right to positive, scaled by width', () => {
    expect(dragRotation(-40, 400, CONFIG.input)).toBeLessThan(0);
    expect(dragRotation(40, 400, CONFIG.input)).toBeGreaterThan(0);
    expect(dragRotation(-40, 400, CONFIG.input)).toBeCloseTo(dragRotation(-80, 800, CONFIG.input));
    expect(dragRotation(0, 400, CONFIG.input)).toBe(0);
  });

  it.each(['touch', 'mouse', 'pen'])('applies live sensitivity linearly to %s dragging without inertia', (pointerType) => {
    let multiplier = 1;
    const { pointer, onRotate } = setup({ getSensitivityMultiplier: () => multiplier });
    pointer('down', { x: 0, pointerType });
    for (const [index, selected] of [1, 1.2, 2, 3].entries()) {
      multiplier = selected;
      pointer('move', { x: (index + 1) * 100, pointerType });
      expect(onRotate.mock.calls[index][0]).toBe(dragRotation(100, 400) * selected);
    }
    pointer('up', { x: 400, pointerType });
    pointer('move', { x: 900, pointerType });
    expect(onRotate).toHaveBeenCalledTimes(4);
  });

  it('allows a large 3.0× drag spanning multiple revolutions', () => {
    const { pointer, onRotate } = setup({ getSensitivityMultiplier: () => 3 });
    pointer('down', { x: 0 });
    pointer('move', { x: 400 });
    expect(onRotate).toHaveBeenCalledExactlyOnceWith(5.2 * 3);
    expect(onRotate.mock.calls[0][0]).toBeGreaterThan(2 * Math.PI * 2);
  });
});

describe('fresh gestures through state changes', () => {
  it('never uses a held death-causing pointer as retry; a fresh short tap retries once', () => {
    const { pointer, input, state, onTap, onRotate } = setup();
    pointer('down');
    pointer('move', { x: 120 });
    state.value = 'DEAD_ANIMATION';
    input.invalidateGesture();
    state.value = 'DEAD_WAITING';
    pointer('move', { x: 140 });
    pointer('up', { x: 140, time: 80 });
    expect(onRotate).toHaveBeenCalledOnce();
    expect(onTap).not.toHaveBeenCalled();
    pointer('down', { time: 100 });
    pointer('up', { time: 170 });
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('requires every pointer, including fingers added during the block, to lift', () => {
    const { pointer, input, state, onRotate } = setup();
    pointer('down');
    state.value = 'COMPLETING';
    input.invalidateGesture();
    pointer('down', { id: 2 });
    state.value = 'HOLDING';
    input.reset();
    pointer('move', { x: 170 });
    pointer('up');
    pointer('down', { id: 3 });
    pointer('up', { id: 2 });
    pointer('move', { id: 3, x: 170 });
    expect(onRotate).not.toHaveBeenCalled();
    pointer('up', { id: 3 });
    pointer('down', { id: 4 });
    pointer('move', { id: 4, x: 120 });
    expect(onRotate).toHaveBeenCalledExactlyOnceWith(dragRotation(20, 400, CONFIG.input));
  });

  it('does not inherit a pointer begun while the game cannot rotate or retry', () => {
    const { pointer, state, onRotate, onTap } = setup();
    state.value = 'TRANSITIONING';
    pointer('down');
    state.value = 'HOLDING';
    pointer('move', { x: 190 });
    pointer('up', { x: 190 });
    expect(onRotate).not.toHaveBeenCalled();
    state.value = 'DEAD_ANIMATION';
    pointer('down');
    state.value = 'DEAD_WAITING';
    pointer('up', { time: 100 });
    expect(onTap).not.toHaveBeenCalled();
    pointer('down', { time: 200 });
    pointer('up', { time: 250 });
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('does not treat a drag or long hold as a deliberate retry tap', () => {
    const { pointer, state, onTap } = setup();
    state.value = 'DEAD_WAITING';
    pointer('down');
    pointer('move', { x: 140 });
    pointer('move');
    pointer('up', { time: 70 });
    pointer('down', { time: 100 });
    pointer('up', { time: 100 + CONFIG.input.tapMaxDuration + 1 });
    expect(onTap).not.toHaveBeenCalled();
  });

  it('cancels multitouch and cancelled pointers without promoting another finger', () => {
    const { pointer, onRotate, onTap } = setup();
    pointer('down');
    pointer('down', { id: 2 });
    pointer('move', { x: 150 });
    pointer('cancel');
    pointer('move', { id: 2, x: 150 });
    pointer('up', { id: 2 });
    expect(onRotate).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
    pointer('down');
    pointer('move', { x: 120 });
    expect(onRotate).toHaveBeenCalledOnce();
  });

  it('blocks a held pointer across pause and unpause and removes listeners on dispose', () => {
    const { pointer, input, onRotate } = setup();
    pointer('down');
    input.setPaused(true);
    input.setPaused(false);
    pointer('move', { x: 160 });
    expect(onRotate).not.toHaveBeenCalled();
    pointer('up');
    pointer('down');
    pointer('move', { x: 110 });
    expect(onRotate).toHaveBeenCalledOnce();
    input.dispose();
    pointer('up');
    pointer('down');
    pointer('move', { x: 160 });
    expect(onRotate).toHaveBeenCalledOnce();
  });

  it('recovers a missed release after blur only on a fresh down, never a held-pointer move', () => {
    const { pointer, surface, input, onRotate, onTap } = setup();
    pointer('down', { pointerType: 'mouse' });
    surface.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
    input.setPaused(true);
    // The old pointer was released outside the browser, so no up arrives.
    input.setPaused(false);
    pointer('move', { x: 150, pointerType: 'mouse' });
    expect(onRotate).not.toHaveBeenCalled();
    pointer('down', { x: 150, time: 500, pointerType: 'mouse' });
    pointer('move', { x: 170, time: 520, pointerType: 'mouse' });
    expect(onRotate).toHaveBeenCalledExactlyOnceWith(dragRotation(20, 400, CONFIG.input));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('does not clear other held fingers when reconciling a reused pointer ID', () => {
    const { pointer, surface, onRotate } = setup();
    pointer('down');
    pointer('down', { id: 2 });
    surface.ownerDocument.defaultView.dispatchEvent(new Event('blur'));
    pointer('down', { time: 500 });
    pointer('move', { x: 150 });
    pointer('up', { id: 2 });
    pointer('move', { x: 170 });
    expect(onRotate).not.toHaveBeenCalled();
    pointer('up', { x: 170 });
    pointer('down', { x: 170 });
    pointer('move', { x: 190 });
    expect(onRotate).toHaveBeenCalledExactlyOnceWith(dragRotation(20, 400, CONFIG.input));
  });
});
