const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const dimension = (value, fallback = 1) => Math.max(1, Number.isFinite(value) && value > 0 ? value : fallback);
const inset = (value, maximum) => Math.min(Math.max(0, finite(value)), maximum);

/** Physical screen insets bound composition. The measured header is an
 * exclusion zone inside that rectangle, not a new origin for its percentage. */
export function createGameplayRect(width, height, { top = 0, right = 0, bottom = 0, left = 0, headerBottom = 0 } = {}) {
  width = dimension(width); height = dimension(height);
  left = inset(left, width - 1); right = inset(right, width - left - 1);
  top = inset(top, height - 1); bottom = inset(bottom, height - top - 1);
  return {
    x: left, y: top, width: width - left - right, height: height - top - bottom,
    top, right: width - right, bottom: height - bottom, left,
    headerBottom: Math.min(height - bottom, Math.max(top, finite(headerBottom))),
  };
}

/** visualViewport sizes are CSS pixels. Do not subtract an assumed Safari bar. */
export function readVisualViewport(windowObject) {
  const visual = windowObject.visualViewport;
  return {
    width: dimension(visual?.width, dimension(windowObject.innerWidth)),
    height: dimension(visual?.height, dimension(windowObject.innerHeight)),
    left: Math.max(0, finite(visual?.offsetLeft)),
    top: Math.max(0, finite(visual?.offsetTop)),
  };
}

/** Coalesce Safari resize/scroll and layout events into one measurement per
 * animation frame. All DOM reads stay out of the ordinary gameplay loop. */
export class ViewportObserver {
  constructor(element, onChange, {
    windowObject = window, documentObject = document,
    ResizeObserverClass = ResizeObserver,
  } = {}) {
    this.element = element;
    this.window = windowObject;
    this.document = documentObject;
    this.onChange = onChange;
    this.header = element.querySelector('.progress-track');
    this.safeAreaProbe = documentObject.createElement('div');
    this.safeAreaProbe.className = 'viewport-safe-area';
    this.safeAreaProbe.setAttribute('aria-hidden', 'true');
    element.append(this.safeAreaProbe);
    this.onViewportEvent = () => this.schedule();
    windowObject.addEventListener('resize', this.onViewportEvent);
    windowObject.visualViewport?.addEventListener('resize', this.onViewportEvent);
    windowObject.visualViewport?.addEventListener('scroll', this.onViewportEvent);
    this.observer = new ResizeObserverClass(this.onViewportEvent);
    this.observer.observe(element);
    if (this.header) this.observer.observe(this.header);
    this.refresh(false);
  }

  schedule() {
    if (this.frameId !== undefined || this.disposed) return;
    this.frameId = this.window.requestAnimationFrame(() => {
      this.frameId = undefined;
      this.refresh();
    });
  }

  refresh(notify = true) {
    const viewport = readVisualViewport(this.window);
    for (const key of ['width', 'height', 'left', 'top']) {
      if (this.visualViewport?.[key] !== viewport[key]) {
        this.element.style.setProperty(`--visual-${key}`, `${viewport[key]}px`);
      }
    }
    this.visualViewport = viewport;
    if (notify && !this.disposed) this.onChange();
  }

  measure() {
    const canvas = this.element.querySelector('canvas');
    const width = dimension(canvas?.clientWidth, dimension(this.element.clientWidth));
    const height = dimension(canvas?.clientHeight, dimension(this.element.clientHeight));
    // Reading a custom property containing env(...) does not reliably resolve
    // it to pixels. Padding on a non-rendering probe does, including in Safari.
    const style = this.window.getComputedStyle(this.safeAreaProbe);
    const elementTop = this.element.getBoundingClientRect().top;
    const insets = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
      headerBottom: this.header ? this.header.getBoundingClientRect().bottom - elementTop : 0,
    };
    return { width, height, ...insets, gameplayRect: createGameplayRect(width, height, insets) };
  }

  dispose() {
    this.disposed = true;
    if (this.frameId !== undefined) this.window.cancelAnimationFrame(this.frameId);
    this.observer.disconnect();
    this.window.removeEventListener('resize', this.onViewportEvent);
    this.window.visualViewport?.removeEventListener('resize', this.onViewportEvent);
    this.window.visualViewport?.removeEventListener('scroll', this.onViewportEvent);
    this.safeAreaProbe.remove();
  }
}
