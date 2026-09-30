/** Debug-only, bounded frame statistics. No allocation occurs while recording. */
export class FrameDiagnostics {
  constructor(capacity = 240, maxSubsteps = 12) {
    this.frames = new Float64Array(capacity);
    this.sorted = new Float64Array(capacity);
    this.steps = new Uint8Array(capacity);
    this.substepDistribution = new Uint32Array(maxSubsteps + 1);
    this.count = 0;
    this.cursor = 0;
    this.totalMs = 0;
    this.framesSeen = 0;
    this.zeroFrames = 0;
    this.multiFrames = 0;
    this.longFrames = 0;
    this.discardedSeconds = 0;
    this.instantMs = 0;
    this.averageMs = 0;
    this.p50 = 0;
    this.p95 = 0;
    this.p99 = 0;
    this.estimatedFrameMs = 1000 / 60;
    this.statsElapsed = 0;
  }

  record(seconds, substeps, discardedSeconds = 0) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const ms = seconds * 1000;
    const steps = Math.max(0, Math.min(this.substepDistribution.length - 1, Math.trunc(substeps) || 0));
    if (this.count === this.frames.length) {
      this.totalMs -= this.frames[this.cursor];
      this.substepDistribution[this.steps[this.cursor]]--;
    } else this.count++;
    this.frames[this.cursor] = ms;
    this.steps[this.cursor] = steps;
    this.substepDistribution[steps]++;
    this.cursor = (this.cursor + 1) % this.frames.length;
    this.totalMs += ms;
    this.instantMs = ms;
    this.averageMs = this.totalMs / this.count;
    this.framesSeen++;
    if (steps === 0) this.zeroFrames++;
    if (steps > 1) this.multiFrames++;
    if (this.framesSeen === 1) this.estimatedFrameMs = ms;
    if (ms > Math.max(this.estimatedFrameMs * 1.65, this.estimatedFrameMs + 4)) this.longFrames++;
    if (Number.isFinite(discardedSeconds) && discardedSeconds > 0) this.discardedSeconds += discardedSeconds;
    this.statsElapsed += seconds;
    if (this.statsElapsed >= .25 || this.framesSeen === 1) {
      this.statsElapsed = 0;
      this.refresh();
    }
  }

  refresh() {
    if (!this.count) return;
    this.sorted.fill(Infinity);
    for (let i = 0; i < this.count; i++) this.sorted[i] = this.frames[i];
    this.sorted.sort();
    this.p50 = this.percentile(.5);
    this.p95 = this.percentile(.95);
    this.p99 = this.percentile(.99);
    // Median cadence resists isolated stalls; this estimates delivered rAF,
    // never claims to discover a panel's hardware maximum refresh rate.
    this.estimatedFrameMs = this.p50;
  }

  percentile(fraction) {
    const index = (this.count - 1) * fraction;
    const lower = Math.floor(index);
    return this.sorted[lower] + (this.sorted[Math.ceil(index)] - this.sorted[lower]) * (index - lower);
  }

  get estimatedHz() { return 1000 / this.estimatedFrameMs; }
  get fps() { return this.averageMs > 0 ? 1000 / this.averageMs : 0; }
}
