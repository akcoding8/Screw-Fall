import { CONFIG } from './config.js';
import { formatSensitivity, normalizeSensitivity } from './sensitivity.js';
import { normalizePaletteStyle } from './PaletteManager.js';

/** A small native modal: the game owns its state and pause policy. */
export class SettingsController {
  constructor({
    dialog, trigger, slider, value, done, input,
    getMultiplier,
    onMultiplierChange,
    paletteSelect,
    getPaletteStyle = () => 'soft',
    onPaletteStyleChange = () => {},
    onOpenChange = () => {},
    canOpen = () => true,
  }) {
    Object.assign(this, {
      dialog, trigger, slider, value, done, input, getMultiplier, onMultiplierChange,
      paletteSelect, getPaletteStyle, onPaletteStyleChange, onOpenChange, canOpen,
    });
    // Pair the pause callbacks once despite the native queued close event.
    // The dialog's open property remains the source of truth for UI/game pause.
    this.openNotified = false;
    this.listeners = [];
    const { min, max, step } = CONFIG.input.multiplier;
    Object.assign(slider, { min: String(min), max: String(max), step: String(step) });
    trigger.setAttribute('aria-expanded', 'false');
    this.refresh();

    this.listen(trigger, 'pointerdown', (event) => this.consumePointer(event));
    this.listen(trigger, 'click', (event) => { event.stopPropagation(); this.open(); });
    this.listen(dialog, 'pointerdown', (event) => this.consumePointer(event));
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'click']) {
      this.listen(dialog, type, (event) => event.stopPropagation());
    }
    this.listen(slider, 'input', () => {
      const multiplier = normalizeSensitivity(Number(slider.value));
      this.onMultiplierChange(multiplier);
      this.refresh(multiplier);
    });
    if (paletteSelect) {
      this.listen(paletteSelect, 'change', () => {
        const paletteStyle = normalizePaletteStyle(paletteSelect.value);
        this.onPaletteStyleChange(paletteStyle);
        this.refreshPalette(paletteStyle);
      });
    }
    this.listen(done, 'click', (event) => { event.stopPropagation(); this.close(); });
    this.listen(dialog, 'cancel', (event) => { event.preventDefault(); this.close(); });
    this.listen(dialog, 'close', () => this.finishClose());
  }

  listen(target, type, listener) {
    target.addEventListener(type, listener);
    this.listeners.push({ target, type, listener });
  }

  get isOpen() { return this.dialog.open; }

  consumePointer(event) {
    this.input.blockPointer(event.pointerId);
    // Do not preventDefault: the accessible native slider needs pointer input.
    event.stopPropagation();
  }

  refresh(multiplier = this.getMultiplier()) {
    const normalized = normalizeSensitivity(multiplier);
    this.slider.value = String(normalized);
    this.value.textContent = formatSensitivity(normalized);
    this.slider.setAttribute('aria-valuetext', `${normalized.toFixed(1)} times`);
    this.refreshPalette();
  }

  refreshPalette(style = this.getPaletteStyle()) {
    if (this.paletteSelect) this.paletteSelect.value = normalizePaletteStyle(style);
  }

  open() {
    if (this.isOpen || !this.canOpen()) return false;
    this.input.invalidateGesture();
    this.refresh();
    this.dialog.showModal();
    this.openNotified = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.onOpenChange(true);
    this.slider.focus();
    return true;
  }

  close() {
    if (this.isOpen) this.dialog.close();
    // Native close events are queued; finish immediately before another frame.
    this.finishClose();
  }

  finishClose() {
    // Ignore an older queued close event if the dialog has since reopened.
    if (!this.openNotified || this.isOpen) return;
    this.openNotified = false;
    this.input.invalidateGesture();
    this.trigger.setAttribute('aria-expanded', 'false');
    this.onOpenChange(false);
    this.trigger.focus();
  }

  dispose() {
    this.close();
    for (const { target, type, listener } of this.listeners) target.removeEventListener(type, listener);
    this.listeners.length = 0;
  }
}
