import { afterEach, describe, expect, it, vi } from 'vitest';
import { cacheIdForBase, workboxOptions } from '../scripts/pwa-config.mjs';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Workbox automatic cleanup is confined to the app cache', () => {
  it.each(['/', '/screw-fall/', '/screw-fall/nested/'])('cleans obsolete app entries and preserves other caches at %s', async base => {
    vi.stubEnv('NODE_ENV', 'production');
    const scope = `https://example.com${base}`;
    const ownName = `${cacheIdForBase(base)}-precache-v2-${scope}`;
    const currentIndex = `${scope}index.html?__WB_REVISION__=version-b`;
    const previousIndex = `${scope}index.html?__WB_REVISION__=version-a`;
    const currentBundle = `${scope}assets/current.js`;
    const previousBundle = `${scope}assets/previous.js`;
    const ownEntries = new Map([currentIndex, previousIndex, currentBundle, previousBundle].map(url => [url, new Request(url)]));
    const unrelated = new Map([
      ['another-app-precache-v2-https://example.com/', ['root-app data']],
      ['another-app-precache-v2-https://example.com/sibling/', ['sibling-app data']],
      [`another-app-precache-v2-${scope}child/`, ['nested-app data']],
      [`unrelated-app-precache-v1-${scope}`, ['same-scope different-app data']],
      [`${cacheIdForBase(base)}-precache-v1-${scope}`, ['incompatible legacy format left untouched']],
    ]);
    const before = structuredClone([...unrelated]);
    const ownCache = {
      keys: vi.fn(async () => [...ownEntries.values()]),
      delete: vi.fn(async request => ownEntries.delete(request.url)),
    };
    const caches = {
      open: vi.fn(async name => {
        if (name !== ownName) throw new Error('Opened a cache outside this app');
        return ownCache;
      }),
      keys: vi.fn(async () => [ownName, ...unrelated.keys()]),
      delete: vi.fn(async name => unrelated.delete(name)),
    };
    const worker = { registration: { scope }, caches, addEventListener: vi.fn() };
    vi.stubGlobal('self', worker);
    vi.stubGlobal('registration', worker.registration);
    vi.stubGlobal('location', new URL('sw.js', scope));
    vi.stubGlobal('localStorage', { clear: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal('indexedDB', { deleteDatabase: vi.fn() });

    // Exercise the installed production library itself, rather than a second
    // implementation of its cache cleanup algorithm.
    const { PrecacheController } = await import('workbox-precaching/PrecacheController.js');
    const controller = new PrecacheController({ cacheName: ownName });
    controller.precache([{ url: 'index.html', revision: 'version-b' }, { url: 'assets/current.js', revision: null }]);
    const activate = worker.addEventListener.mock.calls.find(([event]) => event === 'activate')[1];
    const waitUntil = vi.fn();
    const result = await activate({ waitUntil });

    expect(workboxOptions(base).cleanupOutdatedCaches).toBe(false);
    expect(result.deletedURLs).toEqual([previousIndex, previousBundle]);
    expect([...ownEntries.keys()]).toEqual([currentIndex, currentBundle]);
    expect(caches.open).toHaveBeenCalledExactlyOnceWith(ownName);
    expect(caches.keys).not.toHaveBeenCalled();
    expect(caches.delete).not.toHaveBeenCalled();
    expect([...unrelated]).toEqual(before);
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(localStorage.clear).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(indexedDB.deleteDatabase).not.toHaveBeenCalled();
  });
});
