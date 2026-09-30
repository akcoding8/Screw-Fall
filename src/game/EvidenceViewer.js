export const EVIDENCE_CAPTION = 'Player-provided screenshot. Screw Fall does not verify its contents.';

/** Read-only modal. This controller has no access to level/progress mutations. */
export class EvidenceViewer {
  constructor({ dialog, input, store, onOpenChange = () => {}, canOpen = () => true, urlAPI = globalThis.URL }) {
    Object.assign(this, { dialog, input, store, onOpenChange, canOpen, urlAPI });
    this.image = dialog.querySelector('#evidence-image');
    this.closeButton = dialog.querySelector('#evidence-close');
    this.caption = dialog.querySelector('#evidence-caption');
    this.zoomButton = dialog.querySelector('#evidence-zoom');
    this.scroller = dialog.querySelector('.evidence-image-scroll');
    this.listeners = []; this.request = 0; this.openNotified = false; this.disposed = false;
    this.listen(dialog, 'pointerdown', event => { input.blockPointer(event.pointerId); event.stopPropagation(); });
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'click', 'wheel', 'keydown']) {
      this.listen(dialog, type, event => event.stopPropagation());
    }
    this.listen(this.closeButton, 'click', () => this.close());
    this.listen(this.zoomButton, 'click', () => this.setZoom(!this.zoomed));
    this.listen(dialog, 'cancel', event => { event.preventDefault(); this.close(); });
    this.listen(dialog, 'close', () => this.finishClose());
    this.listen(this.image, 'error', () => {
      if (!this.isOpen || !this.url) return;
      this.clearImage(); this.caption.textContent = 'This screenshot is no longer available. You can attach it again from Progress.';
    });
  }

  listen(target, type, listener) { target.addEventListener(type, listener); this.listeners.push({ target, type, listener }); }
  get isOpen() { return this.dialog.open; }

  async open(id, { returnFocus = null, label = 'Screenshot attached' } = {}) {
    if (this.disposed || !this.canOpen()) return false;
    this.input.invalidateGesture();
    this.clearImage();
    const request = ++this.request;
    this.returnFocus = returnFocus;
    this.caption.textContent = 'Opening screenshot…';
    if (!this.isOpen) {
      this.dialog.showModal(); this.openNotified = true; this.onOpenChange(true);
    }
    this.closeButton.focus();
    try {
      const record = await this.store.get(id);
      if (request !== this.request || !this.isOpen || this.disposed) return false;
      if (!record) {
        this.caption.textContent = 'This screenshot is no longer available. You can attach it again from Progress.'; return false;
      }
      this.record = record;
      this.url = this.urlAPI.createObjectURL(record.blob);
      this.image.alt = label;
      this.image.src = this.url; this.image.hidden = false; this.zoomButton.disabled = false;
      this.caption.textContent = EVIDENCE_CAPTION;
      this.setZoom(false);
      return true;
    } catch {
      if (request !== this.request || !this.isOpen || this.disposed) return false;
      this.clearImage(); this.caption.textContent = 'Screenshot storage is unavailable. Your progress is unchanged.';
      return false;
    }
  }

  setZoom(zoomed) {
    this.zoomed = Boolean(zoomed && this.record);
    this.dialog.dataset.zoomed = String(this.zoomed);
    this.image.style.width = this.zoomed ? `${this.record.width}px` : '';
    this.image.style.maxWidth = this.zoomed ? 'none' : '';
    this.image.style.maxHeight = this.zoomed ? 'none' : '';
    this.zoomButton.textContent = this.zoomed ? 'Fit image' : 'Actual size';
    this.zoomButton.setAttribute('aria-pressed', String(this.zoomed));
    this.scroller.scrollTop = 0; this.scroller.scrollLeft = 0;
  }

  clearImage() {
    this.image.hidden = true; this.image.removeAttribute('src');
    if (this.url) this.urlAPI.revokeObjectURL(this.url);
    this.url = null; this.record = null; this.zoomButton.disabled = true; this.setZoom(false);
  }

  close() { if (this.isOpen) this.dialog.close(); this.finishClose(); }
  finishClose() {
    if (!this.openNotified || this.isOpen) return;
    this.openNotified = false; this.request++;
    this.clearImage(); this.input.invalidateGesture(); this.onOpenChange(false);
    this.returnFocus?.focus(); this.returnFocus = null;
  }

  dispose() {
    this.close(); this.disposed = true; this.request++; this.clearImage();
    for (const { target, type, listener } of this.listeners) target.removeEventListener(type, listener);
    this.listeners.length = 0;
  }
}
