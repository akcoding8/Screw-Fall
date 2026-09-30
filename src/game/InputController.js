import { CONFIG } from './config.js';
import { dragRotation } from './math.js';

/**
 * Pointer input is an adapter: it knows whether a gesture is eligible, but never
 * changes game state itself. Every pointer remains tracked across state changes.
 */
export class InputController {
  constructor(element, {
    onRotate = () => {},
    onTap = () => {},
    onInteract = () => {},
    canRotate = () => true,
    canRetry = () => false,
    getWidth = () => element.clientWidth || element.getBoundingClientRect?.().width || 1,
    getSensitivityMultiplier = () => 1,
  } = {}) {
    this.element = element;
    this.onRotate = onRotate;
    this.onTap = onTap;
    this.onInteract = onInteract;
    this.canRotate = canRotate;
    this.canRetry = canRetry;
    this.getWidth = getWidth;
    this.getSensitivityMultiplier = getSensitivityMultiplier;
    this.pointers = new Set();
    this.externalPointers = new Set();
    this.gesture = null;
    this.blockedUntilRelease = false;
    this.paused = false;
    this.disposed = false;
    this.listeners = [];

    this.listen(element, 'pointerdown', (event) => this.pointerDown(event));
    this.listen(element, 'pointermove', (event) => this.pointerMove(event));
    this.listen(element, 'pointerup', (event) => this.pointerUp(event));
    this.listen(element, 'pointercancel', (event) => this.pointerCancel(event));
    this.listen(element, 'lostpointercapture', (event) => {
      // Unexpected capture loss must never turn a held pointer into a fresh tap.
      if (this.pointers.has(event.pointerId)) this.invalidateGesture();
    });
    this.listen(element, 'contextmenu', (event) => event.preventDefault());

    const view = element.ownerDocument?.defaultView;
    if (view) {
      // Also observe releases if capture was unavailable or unexpectedly lost.
      // Capture also sees releases consumed by the settings panel.
      this.listen(view, 'pointerup', (event) => this.pointerUp(event), true);
      this.listen(view, 'pointercancel', (event) => this.pointerCancel(event), true);
      this.listen(view, 'blur', () => this.invalidateGesture());
    }
  }

  listen(target, type, listener, capture = false) {
    target.addEventListener(type, listener, { passive: false, capture });
    this.listeners.push({ target, type, listener, capture });
  }

  pointerDown(event) {
    if (this.disposed || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    this.onInteract();
    // A release outside the browser can be missed after blur/capture loss. A
    // genuine new down with the same ID proves that pointer's old press ended.
    // Reconcile only that ID; any other held fingers still keep the guard closed.
    if (this.pointers.has(event.pointerId)) this.finishPointer(event.pointerId);
    this.pointers.add(event.pointerId);
    try { this.element.setPointerCapture(event.pointerId); } catch { /* Detached surface or unavailable capture. */ }

    // A second finger cancels the first gesture; neither finger is promoted.
    if (this.paused || this.blockedUntilRelease || this.pointers.size > 1) {
      this.invalidateGesture();
      return;
    }

    const mode = this.canRetry() ? 'retry' : this.canRotate() ? 'rotate' : null;
    if (!mode) {
      this.invalidateGesture();
      return;
    }
    this.gesture = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      startedAt: event.timeStamp,
      maxDistance: 0,
      dragging: false,
    };
  }

  updateDistance(event, gesture) {
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    gesture.maxDistance = Math.max(gesture.maxDistance, distance);
  }

  pointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId || this.paused || this.blockedUntilRelease) return;
    this.updateDistance(event, gesture);
    if (gesture.mode !== 'rotate') return;
    if (!this.canRotate()) {
      this.invalidateGesture();
      return;
    }

    const displacement = event.clientX - gesture.startX;
    if (!gesture.dragging && Math.abs(displacement) < CONFIG.input.dragThreshold) return;
    // The threshold filters touch jitter only. The first real movement applies
    // its full distance immediately, with no easing or extra start gesture.
    const deltaX = gesture.dragging ? event.clientX - gesture.lastX : displacement;
    gesture.dragging = true;
    gesture.lastX = event.clientX;
    if (deltaX !== 0) this.onRotate(dragRotation(deltaX, this.getWidth(), CONFIG.input, this.getSensitivityMultiplier()));
  }

  pointerUp(event) {
    if (!this.pointers.has(event.pointerId)) return;
    if (this.externalPointers.has(event.pointerId)) {
      // Native range dragging and button clicks keep their usual defaults.
      this.finishPointer(event.pointerId);
      return;
    }
    event.preventDefault();
    const gesture = this.gesture;
    let retry = false;
    if (gesture?.pointerId === event.pointerId) {
      this.updateDistance(event, gesture);
      retry = gesture.mode === 'retry'
        && !this.paused
        && !this.blockedUntilRelease
        && this.pointers.size === 1
        && this.canRetry()
        && gesture.maxDistance <= CONFIG.input.tapMaxDistance
        && event.timeStamp - gesture.startedAt <= CONFIG.input.tapMaxDuration;
    }
    // Remove this pointer before notifying the game: a retry may synchronously
    // load a level and reset input, which must see the released pointer as gone.
    this.finishPointer(event.pointerId);
    if (retry) this.onTap();
  }

  pointerCancel(event) {
    if (!this.pointers.has(event.pointerId)) return;
    if (!this.externalPointers.has(event.pointerId)) event.preventDefault();
    this.invalidateGesture();
    this.finishPointer(event.pointerId);
  }

  finishPointer(pointerId) {
    this.pointers.delete(pointerId);
    this.externalPointers.delete(pointerId);
    if (this.gesture?.pointerId === pointerId) this.gesture = null;
    if (this.pointers.size === 0) this.blockedUntilRelease = false;
    try { this.element.releasePointerCapture(pointerId); } catch { /* Capture may already have ended. */ }
  }

  /** Called immediately on death, completion, loading, or loss of focus. */
  invalidateGesture() {
    this.gesture = null;
    this.blockedUntilRelease = this.pointers.size > 0;
  }

  /** Track UI fingers until release so closing a panel cannot start a drag. */
  blockPointer(pointerId) {
    if (this.disposed) return;
    this.pointers.add(pointerId);
    this.externalPointers.add(pointerId);
    this.invalidateGesture();
  }

  /** Reset eligibility without forgetting fingers still touching the surface. */
  reset() {
    this.invalidateGesture();
  }

  setPaused(paused) {
    if (this.paused === Boolean(paused)) return;
    this.paused = Boolean(paused);
    this.invalidateGesture();
  }

  dispose() {
    this.disposed = true;
    for (const { target, type, listener, capture } of this.listeners) target.removeEventListener(type, listener, capture);
    this.listeners.length = 0;
    for (const pointerId of this.pointers) {
      try { this.element.releasePointerCapture(pointerId); } catch { /* Already released. */ }
    }
    this.pointers.clear();
    this.externalPointers.clear();
    this.gesture = null;
  }
}
