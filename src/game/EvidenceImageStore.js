import { EVIDENCE_IMAGE_LIMITS } from './EvidenceImageProcessor.js';
import { PendingOperations } from './PendingOperations.js';

export const EVIDENCE_DATABASE = Object.freeze({ name: 'screw-fall-evidence', version: 1, images: 'images', metadata: 'metadata' });
export const EVIDENCE_STORAGE_LIMITS = Object.freeze({ images: 256, totalBytes: 128 * 1024 * 1024 });
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
let fallbackId = 0;

export class EvidenceStoreError extends Error {
  constructor(message, code = 'storage-unavailable') { super(message); this.name = 'EvidenceStoreError'; this.code = code; }
}

function browserIndexedDB() { try { return globalThis.indexedDB; } catch { return null; } }
function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // add() still enforces uniqueness in the database if this fallback collides.
  return `evidence-${Date.now().toString(36)}-${(++fallbackId).toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id); }
function storageError(error) {
  if (error instanceof EvidenceStoreError) return error;
  if (error?.name === 'QuotaExceededError') return new EvidenceStoreError('Screenshot storage is full. Remove an older screenshot or continue without one.', 'storage-quota');
  return new EvidenceStoreError('Screenshot storage is unavailable. You can continue without a screenshot.');
}

function prepareRecord(processed, id, createdAt) {
  const { blob, thumbnail, width, height, thumbnailWidth, thumbnailHeight } = processed || {};
  if (!validId(id) || !(blob instanceof Blob) || !(thumbnail instanceof Blob)
    || !TYPES.has(blob.type) || !TYPES.has(thumbnail.type) || !blob.size || !thumbnail.size
    || ![width, height, thumbnailWidth, thumbnailHeight].every(value => Number.isSafeInteger(value) && value > 0)
    || Math.max(width, height) > EVIDENCE_IMAGE_LIMITS.longEdge
    || Math.max(thumbnailWidth, thumbnailHeight) > EVIDENCE_IMAGE_LIMITS.thumbnailEdge
    || blob.size + thumbnail.size > EVIDENCE_IMAGE_LIMITS.inputBytes) {
    throw new EvidenceStoreError('This screenshot has not been prepared correctly. Please choose it again.', 'invalid-evidence');
  }
  const metadata = { id, version: 1, createdAt, width, height, thumbnailWidth, thumbnailHeight,
    mimeType: blob.type, thumbnailMimeType: thumbnail.type, bytes: blob.size + thumbnail.size };
  return { metadata, image: { id, blob, thumbnail } };
}

/** Local binary storage. Save JSON contains only the resulting id, never blobs. */
export class EvidenceImageStore {
  constructor({ indexedDB = browserIndexedDB(), idFactory = createId, now = () => new Date().toISOString(), onActivityChange = () => {} } = {}) {
    Object.assign(this, { indexedDB, idFactory, now });
    this.database = null; this.opening = null; this.disposed = false; this.metadataCount = 0;
    this.writes = new PendingOperations(onActivityChange);
  }

  get available() { return !this.disposed && typeof this.indexedDB?.open === 'function'; }
  get pendingWrites() { return this.writes.count; }
  whenIdle() { return this.writes.whenIdle(); }

  async open() {
    if (!this.available) throw storageError();
    if (this.database) return this.database;
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve, reject) => {
      let settled = false, request;
      const fail = error => { if (!settled) { settled = true; clearTimeout(timer); reject(storageError(error)); } };
      const timer = setTimeout(() => fail(), 5000);
      try { request = this.indexedDB.open(EVIDENCE_DATABASE.name, EVIDENCE_DATABASE.version); }
      catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(EVIDENCE_DATABASE.images)) db.createObjectStore(EVIDENCE_DATABASE.images, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(EVIDENCE_DATABASE.metadata)) db.createObjectStore(EVIDENCE_DATABASE.metadata, { keyPath: 'id' });
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new EvidenceStoreError('Close other Screw Fall tabs to use screenshot storage, or continue without one.', 'storage-blocked'));
      request.onsuccess = () => {
        if (settled || this.disposed) { request.result.close(); fail(); return; }
        settled = true; clearTimeout(timer);
        this.database = request.result;
        this.database.onversionchange = () => { this.database?.close(); this.database = null; this.opening = null; };
        resolve(this.database);
      };
    });
    try { return await this.opening; }
    catch (error) { this.opening = null; throw error; }
  }

  transaction(stores, mode, operation) {
    const promise = this.runTransaction(stores, mode, operation);
    return mode === 'readwrite' ? this.writes.track(promise) : promise;
  }

  async runTransaction(stores, mode, operation) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      let transaction, result;
      try {
        transaction = db.transaction(stores, mode);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(storageError(transaction.error));
        transaction.onabort = () => reject(storageError(transaction.error));
        operation(transaction, value => { result = value; }, error => {
          reject(storageError(error));
          try { transaction.abort(); } catch { /* Already ended. */ }
        });
      } catch (error) {
        reject(storageError(error));
        try { transaction?.abort(); } catch { /* Already ended. */ }
      }
    });
  }

  async put(processed) {
    const record = prepareRecord(processed, this.idFactory(), this.now());
    const metadata = await this.transaction([EVIDENCE_DATABASE.images, EVIDENCE_DATABASE.metadata], 'readwrite', (tx, done, fail) => {
      const store = tx.objectStore(EVIDENCE_DATABASE.metadata);
      const request = store.getAll();
      request.onsuccess = () => {
        // Read/write transactions serialize this check across tabs as well as
        // callers, so concurrent uploads cannot overrun the shared budget.
        const rows = request.result;
        const bytes = rows.reduce((sum, item) => sum + (Number.isFinite(item.bytes) ? Math.max(0, item.bytes) : 0), 0);
        if (rows.length >= EVIDENCE_STORAGE_LIMITS.images || bytes + record.metadata.bytes > EVIDENCE_STORAGE_LIMITS.totalBytes) {
          fail(new EvidenceStoreError('Screenshot storage is full. Remove an older screenshot or continue without one.', 'storage-quota')); return;
        }
        tx.objectStore(EVIDENCE_DATABASE.images).add(record.image);
        store.add(record.metadata);
        done({ metadata: record.metadata, count: rows.length + 1 });
      };
    });
    this.metadataCount = metadata.count;
    return metadata.metadata;
  }

  async get(id) {
    if (!validId(id)) return null;
    return this.transaction([EVIDENCE_DATABASE.images, EVIDENCE_DATABASE.metadata], 'readonly', (tx, done) => {
      let metadata = null, image = null;
      const finish = () => done(metadata && image?.blob instanceof Blob && image?.thumbnail instanceof Blob ? { ...metadata, blob: image.blob, thumbnail: image.thumbnail } : null);
      const first = tx.objectStore(EVIDENCE_DATABASE.metadata).get(id);
      first.onsuccess = () => { metadata = first.result; finish(); };
      const second = tx.objectStore(EVIDENCE_DATABASE.images).get(id);
      second.onsuccess = () => { image = second.result; finish(); };
    });
  }

  async getMetadata(id) {
    if (!validId(id)) return null;
    return this.transaction([EVIDENCE_DATABASE.metadata], 'readonly', (tx, done) => {
      const request = tx.objectStore(EVIDENCE_DATABASE.metadata).get(id);
      request.onsuccess = () => done(request.result || null);
    });
  }

  async listMetadata() {
    const rows = await this.transaction([EVIDENCE_DATABASE.metadata], 'readonly', (tx, done) => {
      const request = tx.objectStore(EVIDENCE_DATABASE.metadata).getAll();
      request.onsuccess = () => done(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
    });
    this.metadataCount = rows.length;
    return rows;
  }

  async count() {
    this.metadataCount = await this.transaction([EVIDENCE_DATABASE.metadata], 'readonly', (tx, done) => {
      const request = tx.objectStore(EVIDENCE_DATABASE.metadata).count();
      request.onsuccess = () => done(request.result);
    });
    return this.metadataCount;
  }

  async delete(id) {
    if (!validId(id)) return false;
    const result = await this.transaction([EVIDENCE_DATABASE.images, EVIDENCE_DATABASE.metadata], 'readwrite', (tx, done) => {
      tx.objectStore(EVIDENCE_DATABASE.images).delete(id);
      const store = tx.objectStore(EVIDENCE_DATABASE.metadata);
      store.delete(id);
      const request = store.count();
      request.onsuccess = () => done(request.result);
    });
    this.metadataCount = result;
    return true;
  }

  async clear() {
    await this.transaction([EVIDENCE_DATABASE.images, EVIDENCE_DATABASE.metadata], 'readwrite', tx => {
      tx.objectStore(EVIDENCE_DATABASE.images).clear(); tx.objectStore(EVIDENCE_DATABASE.metadata).clear();
    });
    this.metadataCount = 0;
  }

  dispose() { this.disposed = true; this.database?.close(); this.database = null; this.opening = null; }
}

/** Debug imports can inspect normal evidence but can never write/delete it. */
export class SessionEvidenceStore {
  constructor({ fallback = null, idFactory = createId, now = () => new Date().toISOString(), onActivityChange = () => {} } = {}) {
    Object.assign(this, { fallback, idFactory, now }); this.records = new Map(); this.disposed = false;
    this.writes = new PendingOperations(onActivityChange);
  }
  get available() { return !this.disposed; }
  get metadataCount() { return this.records.size; }
  get pendingWrites() { return this.writes.count; }
  whenIdle() { return this.writes.whenIdle(); }
  put(processed) { return this.writes.track(() => this.putRecord(processed)); }
  async putRecord(processed) {
    if (this.disposed) throw storageError();
    const record = prepareRecord(processed, `session-${this.idFactory()}`, this.now());
    const bytes = [...this.records.values()].reduce((sum, item) => sum + item.metadata.bytes, 0);
    if (this.records.size >= EVIDENCE_STORAGE_LIMITS.images || bytes + record.metadata.bytes > EVIDENCE_STORAGE_LIMITS.totalBytes) {
      throw new EvidenceStoreError('Temporary screenshot storage is full. Reload to clear debug screenshots.', 'storage-quota');
    }
    if (this.records.has(record.metadata.id)) throw new EvidenceStoreError('Screenshot ID already exists. Please try again.', 'duplicate-evidence');
    this.records.set(record.metadata.id, record);
    return { ...record.metadata };
  }
  async get(id) {
    const record = this.records.get(id);
    if (record) return { ...record.metadata, blob: record.image.blob, thumbnail: record.image.thumbnail };
    try { return await this.fallback?.get(id) || null; } catch { return null; }
  }
  async getMetadata(id) {
    const record = this.records.get(id);
    if (record) return { ...record.metadata };
    try { return await this.fallback?.getMetadata(id) || null; } catch { return null; }
  }
  async listMetadata() {
    return [...this.records.values()].map(record => ({ ...record.metadata }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  async count() { return this.records.size; }
  delete(id) { return this.writes.track(() => this.records.delete(id)); }
  clear() { return this.writes.track(() => this.records.clear()); }
  dispose() { this.records.clear(); this.disposed = true; }
}
