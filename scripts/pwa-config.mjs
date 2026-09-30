import { normalizeBase, resolveBase, appPath } from '../src/pwa/PwaPaths.js';
export { normalizeBase, resolveBase, appPath };
export const MAX_PRECACHE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PRECACHE_TOTAL_BYTES = 5 * 1024 * 1024;
export const PWA_COLOURS = Object.freeze({ background: '#e9efeb', theme: '#233c37' });

export function cacheIdForBase(base) {
  // Encode each path character so sibling project paths cannot collide.
  return `screw-fall-${Array.from(normalizeBase(base), char => char.charCodeAt(0).toString(16)).join('-')}`;
}

export function createManifest(base = '/') {
  base = normalizeBase(base);
  return {
    name: 'Screw Fall', short_name: 'Screw Fall', description: 'A smooth endless falling-tower arcade game.',
    lang: 'en-GB', dir: 'ltr', id: base, start_url: base, scope: base,
    display: 'standalone', orientation: 'portrait-primary',
    background_color: PWA_COLOURS.background, theme_color: PWA_COLOURS.theme,
    categories: ['games', 'entertainment'], prefer_related_applications: false,
    icons: [
      { src: appPath(base, 'icons/pwa-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: appPath(base, 'icons/pwa-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: appPath(base, 'icons/pwa-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export function buildInformation({ version, commit = '' }) {
  return { version, build: /^[a-f\d]{7,40}$/i.test(commit) ? commit.slice(0, 8) : 'local' };
}

export function workboxOptions(base = '/') {
  base = normalizeBase(base);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    // PrecacheController automatically removes obsolete entries inside this
    // app's named cache. Workbox's optional legacy-cache sweep does not filter
    // by cacheId and a root scope could match other same-origin applications.
    cacheId: cacheIdForBase(base), cleanupOutdatedCaches: false,
    skipWaiting: false, clientsClaim: true,
    // The plugin adds the generated manifest itself. Icons are discovered once
    // here rather than duplicated through includeAssets/includeManifestIcons.
    globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,mp3,wav,ogg,webp}'],
    globIgnores: ['**/*.map', 'icons/screw-fall-icon-source.svg', 'icons/screw-fall-1024.png'],
    maximumFileSizeToCacheInBytes: MAX_PRECACHE_FILE_BYTES,
    navigateFallback: appPath(base, 'index.html'),
    // The game has no client-side routes. Match its entry documents only so a
    // root deployment cannot return the game for another project's URL.
    navigateFallbackAllowlist: [new RegExp(`^${escaped}(?:index\\.html)?(?:\\?.*)?$`)], runtimeCaching: [],
  };
}
