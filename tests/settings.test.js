import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/game/InputController.js';
import { SettingsController } from '../src/game/SettingsController.js';
import { dragRotation } from '../src/game/math.js';

class Element extends EventTarget {
  attributes = new Map();
  value = '';
  textContent = '';
  open = false;
  focus = vi.fn();
  setAttribute(name, value) { this.attributes.set(name, value); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}

const disposables = [];
afterEach(() => { for (const controller of disposables.splice(0)) controller.dispose(); });

function setup() {
  const view = new EventTarget();
  const surface = new Element();
  surface.ownerDocument = { defaultView: view };
  surface.clientWidth = 400;
  const onRotate = vi.fn();
  const onTap = vi.fn();
  const input = new InputController(surface, { onRotate, onTap });
  const [dialog, trigger, slider, value, done, paletteSelect] = Array.from({ length: 6 }, () => new Element());
  let multiplier = 1.2;
  let paletteStyle = 'soft';
  let allowed = true;
  const onMultiplierChange = vi.fn((next) => { multiplier = next; });
  const onPaletteStyleChange = vi.fn((next) => { paletteStyle = next; });
  const onOpenChange = vi.fn((open) => input.setPaused(open));
  const settings = new SettingsController({
    dialog, trigger, slider, value, done, input, paletteSelect,
    getMultiplier: () => multiplier,
    onMultiplierChange,
    getPaletteStyle: () => paletteStyle,
    onPaletteStyleChange,
    onOpenChange,
    canOpen: () => allowed,
  });
  disposables.push(settings, input);
  function pointer(target, type, id = 1, x = 100) {
    const event = new Event(`pointer${type}`, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries({ pointerId: id, clientX: x, clientY: 100, button: 0, pointerType: 'touch' })) {
      Object.defineProperty(event, key, { value });
    }
    // Native window capture runs before the panel's bubbling handlers.
    if (type === 'up' || type === 'cancel') view.dispatchEvent(event);
    target.dispatchEvent(event);
    return event;
  }
  const click = (target) => target.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
  return {
    input, settings, dialog, trigger, slider, value, done, paletteSelect, surface, view, pointer, click,
    onRotate, onTap, onMultiplierChange, onPaletteStyleChange, onOpenChange,
    setAllowed: (next) => { allowed = next; },
  };
}

describe('minimal settings panel', () => {
  it('opens a paused native modal without rotating, tapping, or starting a gesture', () => {
    const { settings, trigger, dialog, slider, input, pointer, click, onRotate, onTap, onOpenChange } = setup();
    pointer(trigger, 'down');
    pointer(trigger, 'up');
    click(trigger);
    expect(settings.isOpen).toBe(true);
    expect(dialog.open).toBe(true);
    expect(input.paused).toBe(true);
    expect(input.gesture).toBe(null);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(slider.focus).toHaveBeenCalledOnce();
    expect(onRotate).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('sets an accessible range and reports and saves each change immediately', () => {
    const { settings, slider, value, onMultiplierChange } = setup();
    settings.open();
    expect([slider.min, slider.max, slider.step]).toEqual(['0.5', '3', '0.1']);
    expect(value.textContent).toBe('1.2×');
    slider.value = '2.0';
    slider.dispatchEvent(new Event('input'));
    expect(onMultiplierChange).toHaveBeenCalledExactlyOnceWith(2);
    expect(value.textContent).toBe('2.0×');
    expect(slider.attributes.get('aria-valuetext')).toBe('2.0 times');
  });

  it('keeps native slider defaults while consuming panel input and never rotating underneath', () => {
    const { settings, dialog, surface, pointer, input, onRotate, onTap } = setup();
    settings.open();
    expect(pointer(dialog, 'down', 7).defaultPrevented).toBe(false);
    pointer(dialog, 'move', 7, 250);
    pointer(surface, 'move', 7, 300);
    expect(input.blockedUntilRelease).toBe(true);
    expect(pointer(dialog, 'up', 7, 300).defaultPrevented).toBe(false);
    expect(input.pointers.size).toBe(0);
    expect(onRotate).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
  });

  it('changes palette style immediately and restores the chosen native select value on reopen', () => {
    const { settings, paletteSelect, onPaletteStyleChange, onRotate } = setup();
    settings.open();
    expect(paletteSelect.value).toBe('soft');
    paletteSelect.value = 'vivid';
    paletteSelect.dispatchEvent(new Event('change'));
    expect(onPaletteStyleChange).toHaveBeenCalledExactlyOnceWith('vivid');
    settings.close();
    paletteSelect.value = 'soft';
    settings.open();
    expect(paletteSelect.value).toBe('vivid');
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('consumes a palette control pointer and requires a new gesture after closing', () => {
    const { settings, paletteSelect, dialog, pointer, surface, input, onRotate, onTap } = setup();
    settings.open();
    // The select's pointerdown bubbles to its containing native dialog.
    const event = pointer(dialog, 'down', 22);
    expect(event.defaultPrevented).toBe(false);
    paletteSelect.value = 'mixed';
    paletteSelect.dispatchEvent(new Event('change'));
    settings.close();
    pointer(surface, 'move', 22, 260);
    expect(input.blockedUntilRelease).toBe(true);
    expect(onRotate).not.toHaveBeenCalled();
    expect(onTap).not.toHaveBeenCalled();
    pointer(surface, 'up', 22, 260);
    pointer(surface, 'down', 23, 120);
    pointer(surface, 'move', 23, 160);
    expect(onRotate).toHaveBeenCalledExactlyOnceWith(dragRotation(40, 400));
  });

  it('recovers invalid select values to Soft and removes palette listeners on dispose', () => {
    const { settings, paletteSelect, onPaletteStyleChange } = setup();
    paletteSelect.value = 'invalid';
    paletteSelect.dispatchEvent(new Event('change'));
    expect(onPaletteStyleChange).toHaveBeenCalledExactlyOnceWith('soft');
    expect(paletteSelect.value).toBe('soft');
    settings.dispose();
    paletteSelect.value = 'vivid';
    paletteSelect.dispatchEvent(new Event('change'));
    expect(onPaletteStyleChange).toHaveBeenCalledOnce();
  });

  it('requires all held panel and gameplay pointers to lift and then a fresh gameplay drag', () => {
    const { settings, dialog, surface, done, input, pointer, click, onRotate } = setup();
    pointer(surface, 'down', 1);
    settings.open();
    pointer(dialog, 'down', 2);
    pointer(dialog, 'down', 3);
    pointer(dialog, 'up', 3);
    click(done);
    expect(settings.isOpen).toBe(false);
    expect(input.paused).toBe(false);
    pointer(surface, 'move', 1, 180);
    pointer(surface, 'move', 2, 180);
    pointer(surface, 'up', 1);
    // Another finger cannot become eligible while the slider finger is held.
    pointer(surface, 'down', 4);
    pointer(surface, 'up', 2);
    pointer(surface, 'move', 4, 190);
    expect(onRotate).not.toHaveBeenCalled();
    pointer(surface, 'up', 4);
    pointer(surface, 'down', 5);
    pointer(surface, 'move', 5, 120);
    expect(onRotate).toHaveBeenCalledExactlyOnceWith(dragRotation(20, 400));
  });

  it('closes on Escape, returns focus, and keeps a held panel finger blocked', () => {
    const { settings, dialog, trigger, pointer, input, onOpenChange } = setup();
    settings.open();
    pointer(dialog, 'down', 8);
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(settings.isOpen).toBe(false);
    expect(input.blockedUntilRelease).toBe(true);
    expect(trigger.focus).toHaveBeenCalledOnce();
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
    pointer(dialog, 'cancel', 8);
    expect(input.blockedUntilRelease).toBe(false);
  });

  it('reads native open state immediately and ignores an older queued close after reopening', () => {
    const { settings, dialog, input, onOpenChange } = setup();
    // Browser close() changes .open now and queues its close event separately.
    dialog.close = () => { dialog.open = false; };
    settings.open();
    dialog.close();
    expect(settings.isOpen).toBe(false);
    dialog.dispatchEvent(new Event('close'));
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);

    settings.open();
    settings.close();
    expect(input.paused).toBe(false);
    settings.open();
    dialog.dispatchEvent(new Event('close'));
    expect(settings.isOpen).toBe(true);
    expect(input.paused).toBe(true);
    expect(onOpenChange.mock.calls).toEqual([[true], [false], [true], [false], [true]]);
  });

  it('finishes a pending native close once when disposed before the queued event', () => {
    const { settings, dialog, onOpenChange } = setup();
    dialog.close = () => { dialog.open = false; };
    settings.open();
    dialog.close();
    settings.dispose();
    dialog.dispatchEvent(new Event('close'));
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });

  it('obeys game-state availability and removes listeners on disposal', () => {
    const { settings, setAllowed, dialog, trigger, click, onOpenChange } = setup();
    setAllowed(false);
    click(trigger);
    expect(dialog.open).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
    setAllowed(true);
    click(trigger);
    expect(dialog.open).toBe(true);
    settings.dispose();
    click(trigger);
    expect(dialog.open).toBe(false);
    expect(onOpenChange.mock.calls).toEqual([[true], [false]]);
  });
});
