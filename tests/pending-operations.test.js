import { describe, expect, it, vi } from 'vitest';
import { PendingOperations } from '../src/game/PendingOperations.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

describe('restart drain for local asynchronous work', () => {
  it('waits for concurrent work and subsequent cleanup without losing failures at the caller', async () => {
    const onChange = vi.fn(), pending = new PendingOperations(onChange), first = deferred(), second = deferred(), cleanup = deferred();
    const work = pending.track(first.promise);
    const failed = pending.track(second.promise).catch(error => error.message);
    work.then(() => pending.track(cleanup.promise));
    let drained = false; const drain = pending.whenIdle().then(() => { drained = true; });
    expect(pending.count).toBe(2); first.resolve(); second.reject(new Error('failure'));
    await work; expect(await failed).toBe('failure'); expect(drained).toBe(false);
    cleanup.resolve(); await drain; expect(pending.count).toBe(0); expect(drained).toBe(true);
    expect(onChange.mock.calls.at(-1)).toEqual([0]);
  });
  it('tracks synchronous throws as rejected operations without stranding the drain', async () => {
    const pending = new PendingOperations();
    await expect(pending.track(() => { throw new Error('failure'); })).rejects.toThrow('failure');
    await pending.whenIdle(); expect(pending.count).toBe(0);
  });
});
