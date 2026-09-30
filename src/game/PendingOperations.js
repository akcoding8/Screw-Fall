/** Tracks event-driven asynchronous work without timers or frame polling.
 * Waiting includes work added while an earlier operation is completing. */
export class PendingOperations {
  constructor(onChange = () => {}) { this.onChange = onChange; this.pending = new Set(); }
  get count() { return this.pending.size; }
  track(operation) {
    let result;
    try { result = typeof operation === 'function' ? operation() : operation; }
    catch (error) { result = Promise.reject(error); }
    const promise = Promise.resolve(result);
    this.pending.add(promise); this.onChange(this.count);
    const finish = () => { this.pending.delete(promise); this.onChange(this.count); };
    // Both handlers resolve, so the tracking branch cannot create an unhandled
    // rejection. The caller still receives the original success or failure.
    promise.then(finish, finish);
    return promise;
  }
  async whenIdle() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}
