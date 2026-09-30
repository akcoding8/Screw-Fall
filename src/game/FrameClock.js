import { CONFIG } from './config.js';

export function interpolationAlpha(accumulator, fixedStep = CONFIG.physics.fixedStep) {
  if (!Number.isFinite(accumulator) || !Number.isFinite(fixedStep) || fixedStep <= 0) return 0;
  return Math.max(0, Math.min(1, accumulator / fixedStep));
}

/** The clock owns elapsed time, never authoritative physics or input. */
export class FrameClock {
  constructor(config = CONFIG.physics) {
    this.fixedStep = config.fixedStep;
    this.maxSubsteps = config.maxSubsteps;
    this.maxFrameDelta = config.maxFrameDelta;
    this.accumulator = 0;
    this.substeps = 0;
    this.delta = 0;
    this.discarded = 0;
    this.totalDiscarded = 0;
    this.revision = 0;
  }

  reset() {
    this.accumulator = 0;
    this.revision++;
  }

  advance(rawDelta, step) {
    const raw = Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : 0;
    this.delta = Math.min(raw, this.maxFrameDelta);
    this.discarded = raw - this.delta;
    this.substeps = 0;
    this.accumulator += this.delta;
    const revision = this.revision;
    // A tiny arithmetic allowance prevents exact 90/120 Hz schedules losing a
    // tick merely because repeated subtraction leaves 0.008333333333333332.
    while (this.accumulator + 1e-12 >= this.fixedStep && this.substeps < this.maxSubsteps) {
      this.accumulator = Math.max(0, this.accumulator - this.fixedStep);
      this.substeps++;
      step(this.fixedStep);
      // A level/visibility reset inside the callback invalidates old elapsed time.
      if (revision !== this.revision) break;
    }
    if (this.accumulator >= this.fixedStep) {
      const excess = Math.floor(this.accumulator / this.fixedStep) * this.fixedStep;
      this.accumulator -= excess;
      this.discarded += excess;
    }
    this.totalDiscarded += this.discarded;
    return this.alpha;
  }

  get alpha() { return interpolationAlpha(this.accumulator, this.fixedStep); }
}
