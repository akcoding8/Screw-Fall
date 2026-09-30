import { interpolationAlpha } from './FrameClock.js';

const snapshot = () => ({ y: 0, velocity: 0, anchor: 0, animationTime: 0, stateElapsed: 0 });
function copy(target, source) {
  target.y = source.y;
  target.velocity = source.velocity;
  target.anchor = source.anchor;
  target.animationTime = source.animationTime;
  target.stateElapsed = source.stateElapsed;
}

/** Three preallocated snapshots; displayed values never write into gameplay. */
export class RenderTimeline {
  constructor() {
    this.previous = snapshot();
    this.current = snapshot();
    this.display = snapshot();
  }

  beforeStep() { copy(this.previous, this.current); }

  capture(simulation, cameraAnchor, snap = false) {
    const current = this.current;
    current.y = simulation.ball.y;
    current.velocity = simulation.ball.velocity;
    current.anchor = cameraAnchor;
    current.animationTime = simulation.animationTime;
    current.stateElapsed = simulation.stateElapsed;
    if (snap) {
      copy(this.previous, current);
      copy(this.display, current);
    }
  }

  sample(alpha, interpolate = true) {
    const factor = interpolate ? interpolationAlpha(alpha, 1) : 1;
    const from = this.previous, to = this.current, display = this.display;
    display.y = from.y + (to.y - from.y) * factor;
    display.velocity = from.velocity + (to.velocity - from.velocity) * factor;
    display.anchor = from.anchor + (to.anchor - from.anchor) * factor;
    display.animationTime = from.animationTime + (to.animationTime - from.animationTime) * factor;
    display.stateElapsed = from.stateElapsed + (to.stateElapsed - from.stateElapsed) * factor;
    return display;
  }
}
