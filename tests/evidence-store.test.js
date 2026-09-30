import { describe, expect, it, vi } from 'vitest';
import { EvidenceImageStore, SessionEvidenceStore, EVIDENCE_DATABASE, EVIDENCE_STORAGE_LIMITS } from '../src/game/EvidenceImageStore.js';

// A deliberately small transaction fake: writes clone/commit atomically and
// all transactions serialize. Actual browser IndexedDB is also manually checked.
function indexedDBFixture() {
  const data = new Map(), calls = [];
  let opened = false, queue = Promise.resolve();
  const factory = { failWrites: false, open: vi.fn(() => {
    const request = {};
    queueMicrotask(() => {
      request.result = database;
      if (!opened) { opened = true; request.onupgradeneeded?.(); }
      request.onsuccess?.();
    });
    return request;
  }) };
  const database = {
    objectStoreNames: { contains: name => data.has(name) }, close: vi.fn(),
    createObjectStore: name => data.set(name, new Map()),
    transaction(names, mode) {
      let stores, dead = false, tasks = [], finish;
      const tx = {
        objectStore(name) {
          const request = (action, argument) => {
            calls.push([name, action]);
            const req = {};
            tasks.push(() => {
              try {
                const store = stores.get(name);
                if (factory.failWrites && action === 'add') throw Object.assign(new Error('Full'), { name: 'QuotaExceededError' });
                if (action === 'get') req.result = store.get(argument);
                if (action === 'getAll') req.result = [...store.values()];
                if (action === 'count') req.result = store.size;
                if (action === 'clear') store.clear();
                if (action === 'delete') store.delete(argument);
                if (action === 'add') {
                  if (store.has(argument.id)) throw Object.assign(new Error('Duplicate'), { name: 'ConstraintError' });
                  store.set(argument.id, argument); req.result = argument.id;
                }
                req.onsuccess?.();
              } catch (error) { tx.error = error; tx.abort(); }
            });
            return req;
          };
          return Object.fromEntries(['get', 'getAll', 'count', 'clear', 'delete', 'add'].map(action => [action, argument => request(action, argument)]));
        },
        abort() { if (dead) return; dead = true; tasks = []; queueMicrotask(() => { tx.onabort?.(); finish?.(); }); },
      };
      const run = () => {
        if (dead) return;
        const task = tasks.shift();
        if (task) { task(); queueMicrotask(run); return; }
        dead = true;
        if (mode === 'readwrite') for (const name of names) data.set(name, stores.get(name));
        tx.oncomplete?.(); finish();
      };
      queue = queue.then(() => new Promise(resolve => {
        finish = resolve; stores = new Map([...data].map(([name, store]) => [name, new Map(store)]));
        queueMicrotask(run);
      }));
      return tx;
    },
  };
  return { factory, database, data, calls };
}
function processed() {
  return { blob: new Blob(['image'], { type: 'image/webp' }), thumbnail: new Blob(['thumb'], { type: 'image/webp' }),
    width: 1920, height: 2560, thumbnailWidth: 240, thumbnailHeight: 320, mimeType: 'image/webp' };
}
function fixture(options = {}) {
  const fake = indexedDBFixture(); let serial = 0;
  const store = new EvidenceImageStore({ indexedDB: fake.factory, idFactory: () => `evidence-${++serial}`, now: () => '2026-09-25T12:00:00.000Z', ...options });
  return { ...fake, store };
}

describe('versioned local evidence binary store', () => {
  it('exposes pending writes and drains commits before a safe PWA restart', async () => {
    const onActivityChange = vi.fn(), f = fixture({ onActivityChange });
    const first = f.store.put(processed()), second = f.store.put(processed());
    expect(f.store.pendingWrites).toBe(2);
    await f.store.whenIdle(); const rows = await Promise.all([first, second]);
    expect(f.store.pendingWrites).toBe(0); expect(await f.store.count()).toBe(2);
    expect(await f.store.get(rows[0].id)).not.toBeNull(); expect(onActivityChange).toHaveBeenCalledWith(0);
    const removal = f.store.delete(rows[0].id); expect(f.store.pendingWrites).toBe(1);
    await f.store.whenIdle(); await removal; expect(await f.store.count()).toBe(1); f.store.dispose();
  });
  it('settles failed evidence writes for a restart without clearing existing screenshots', async () => {
    const f = fixture(), previous = await f.store.put(processed()); f.factory.failWrites = true;
    const write = f.store.put(processed()).catch(error => error);
    await f.store.whenIdle(); expect(await write).toBeInstanceOf(Error);
    expect(f.store.pendingWrites).toBe(0); expect(await f.store.get(previous.id)).not.toBeNull(); f.store.dispose();
  });
  it('provides the same drain contract for temporary debug screenshots', async () => {
    const onActivityChange = vi.fn(), store = new SessionEvidenceStore({ onActivityChange });
    const write = store.put(processed()); expect(store.pendingWrites).toBe(1);
    await store.whenIdle(); const image = await write; expect(await store.get(image.id)).not.toBeNull();
    expect(store.pendingWrites).toBe(0); expect(onActivityChange).toHaveBeenCalledWith(0); store.dispose();
  });
  it('writes stable metadata and binary records atomically, with no localStorage access', async () => {
    const localStorage = { getItem: vi.fn(), setItem: vi.fn() }; vi.stubGlobal('localStorage', localStorage);
    const f = fixture();
    try {
      const metadata = await f.store.put(processed());
      expect(metadata).toMatchObject({ id: 'evidence-1', version: 1, width: 1920, height: 2560, createdAt: '2026-09-25T12:00:00.000Z' });
      expect(metadata).not.toHaveProperty('blob'); expect(metadata).not.toHaveProperty('thumbnail');
      expect((await f.store.get(metadata.id)).blob).toBeInstanceOf(Blob);
      expect(await f.store.getMetadata(metadata.id)).toEqual(metadata);
      expect(f.factory.open).toHaveBeenCalledWith('screw-fall-evidence', 1);
      expect(f.data.has(EVIDENCE_DATABASE.images)).toBe(true); expect(f.data.has(EVIDENCE_DATABASE.metadata)).toBe(true);
      expect(localStorage.setItem).not.toHaveBeenCalled(); expect(localStorage.getItem).not.toHaveBeenCalled();
    } finally { f.store.dispose(); vi.unstubAllGlobals(); }
  });
  it('uses a new unique ID for each image, and lists metadata without reading blobs', async () => {
    const f = fixture();
    const rows = await Promise.all([f.store.put(processed()), f.store.put(processed()), f.store.put(processed())]);
    expect(new Set(rows.map(row => row.id)).size).toBe(3);
    f.calls.length = 0;
    expect(await f.store.listMetadata()).toEqual(rows); expect(f.store.metadataCount).toBe(3);
    expect(f.calls).toEqual([[EVIDENCE_DATABASE.metadata, 'getAll']]);
    expect(await f.store.count()).toBe(3); f.store.dispose();
  });
  it('replaces evidence safely by saving the new reference before removing the old binary record', async () => {
    const f = fixture(), old = await f.store.put(processed());
    const replacement = await f.store.put(processed());
    let savedId = old.id; savedId = replacement.id;
    await f.store.delete(old.id);
    expect(await f.store.get(old.id)).toBeNull(); expect(await f.store.get(savedId)).not.toBeNull();
    expect(await f.store.count()).toBe(1); f.store.dispose();
  });
  it('removes both the metadata and image, including repeated removals', async () => {
    const f = fixture(), row = await f.store.put(processed());
    await f.store.delete(row.id); await f.store.delete(row.id);
    expect(await f.store.get(row.id)).toBeNull(); expect(await f.store.getMetadata(row.id)).toBeNull();
    expect(f.data.get(EVIDENCE_DATABASE.images).size).toBe(0); expect(await f.store.count()).toBe(0);
    f.store.dispose();
  });
  it('keeps existing images when a replacement hits quota', async () => {
    const f = fixture(), row = await f.store.put(processed()); f.factory.failWrites = true;
    await expect(f.store.put(processed())).rejects.toMatchObject({ code: 'storage-quota' });
    expect(await f.store.get(row.id)).not.toBeNull(); expect(await f.store.count()).toBe(1);
    expect(f.data.get(EVIDENCE_DATABASE.images).size).toBe(1); f.store.dispose();
  });
  it('enforces its count budget even for concurrent uploads', async () => {
    const f = fixture(); await f.store.open();
    for (let i = 0; i < EVIDENCE_STORAGE_LIMITS.images - 1; i++) {
      f.data.get(EVIDENCE_DATABASE.metadata).set(`seed-${i}`, { id: `seed-${i}`, bytes: 10, createdAt: '2026-01-01T00:00:00.000Z' });
    }
    const results = await Promise.allSettled([f.store.put(processed()), f.store.put(processed())]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason.code).toBe('storage-quota');
    expect(await f.store.count()).toBe(EVIDENCE_STORAGE_LIMITS.images); f.store.dispose();
  });
  it('enforces the binary byte budget and reports an actionable error', async () => {
    const f = fixture(); await f.store.open();
    f.data.get(EVIDENCE_DATABASE.metadata).set('large', { id: 'large', bytes: EVIDENCE_STORAGE_LIMITS.totalBytes - 1 });
    await expect(f.store.put(processed())).rejects.toThrow('Remove an older screenshot or continue without one'); f.store.dispose();
  });
  it('rejects unprocessed blobs and invalid dimensions', async () => {
    const f = fixture();
    await expect(f.store.put({ ...processed(), blob: 'base64-data' })).rejects.toMatchObject({ code: 'invalid-evidence' });
    await expect(f.store.put({ ...processed(), width: 99999 })).rejects.toMatchObject({ code: 'invalid-evidence' });
    expect(f.factory.open).not.toHaveBeenCalled(); f.store.dispose();
  });
  it('fails gracefully without IndexedDB while callers can keep progress independent', async () => {
    const store = new EvidenceImageStore({ indexedDB: null });
    expect(store.available).toBe(false);
    await expect(store.put(processed())).rejects.toThrow('continue without a screenshot');
    expect(await store.get(null)).toBeNull(); store.dispose();
  });
  it('handles missing images or their missing binary records', async () => {
    const f = fixture();
    expect(await f.store.get('missing')).toBeNull(); const row = await f.store.put(processed());
    f.data.get(EVIDENCE_DATABASE.images).delete(row.id);
    expect(await f.store.get(row.id)).toBeNull(); f.store.dispose();
  });
  it('clears its two stores only through an explicit full-reset action', async () => {
    const f = fixture(); await f.store.put(processed()); await f.store.put(processed());
    await f.store.clear(); expect(await f.store.count()).toBe(0);
    expect(f.data.get(EVIDENCE_DATABASE.images).size).toBe(0); f.store.dispose();
    expect(f.database.close).toHaveBeenCalledOnce();
  });
  it('keeps a duplicate ID from partially replacing existing evidence', async () => {
    const f = fixture({ idFactory: () => 'constant' }); await f.store.put(processed());
    await expect(f.store.put(processed())).rejects.toMatchObject({ code: 'storage-unavailable' });
    expect(await f.store.count()).toBe(1); expect(await f.store.get('constant')).not.toBeNull(); f.store.dispose();
  });
  it('keeps debug evidence in memory and never deletes normal referenced images', async () => {
    const f = fixture(), normal = await f.store.put(processed());
    const session = new SessionEvidenceStore({ fallback: f.store, idFactory: () => 'temporary' });
    try {
      f.calls.length = 0;
      const temporary = await session.put(processed());
      expect(temporary.id).toBe('session-temporary'); expect(f.calls).toEqual([]);
      expect(await session.get(normal.id)).not.toBeNull();
      expect(await session.delete(normal.id)).toBe(false); expect(await f.store.get(normal.id)).not.toBeNull();
      expect(await session.get(temporary.id)).not.toBeNull(); expect(await f.store.get(temporary.id)).toBeNull();
      expect(await session.count()).toBe(1); expect(await f.store.count()).toBe(1);
      await session.clear(); expect(await session.count()).toBe(0); expect(await f.store.count()).toBe(1);
    } finally { session.dispose(); f.store.dispose(); }
  });
  it('allows session-only screenshots even when normal IndexedDB is missing', async () => {
    const normal = new EvidenceImageStore({ indexedDB: null }), session = new SessionEvidenceStore({ fallback: normal });
    const metadata = await session.put(processed());
    expect(await session.get(metadata.id)).not.toBeNull(); expect(await session.get('missing')).toBeNull();
    session.dispose(); expect(await session.count()).toBe(0); normal.dispose();
  });
});
