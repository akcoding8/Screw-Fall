import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeBase, cacheIdForBase, MAX_PRECACHE_FILE_BYTES, MAX_PRECACHE_TOTAL_BYTES } from './pwa-config.mjs';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const AUDIT_ORIGIN = 'https://screw-fall.example';
const OPTIONAL_ARTWORK = new Set(['icons/screw-fall-icon-source.svg', 'icons/screw-fall-1024.png']);
const RUNTIME_EXTENSION = /\.(?:js|css|html|png|svg|ico|webmanifest|woff2?|mp3|wav|ogg|webp)$/i;
const TEXT_EXTENSION = /\.(?:js|css|html|svg|webmanifest|json|txt)$/i;
const FORBIDDEN_OUTPUT = /(?:^|\/)(?:references?|recordings?|screenshots?|uploads?|captures?|debug-captures|test-results|tests?|fixtures?|backups?|\.tools|\.env)(?:\/|\.|$)|\.(?:map|mov|mp4|webm|screw-fall-save\.json)$/i;

/** Walk only actual files under the selected build. Never follow a symlink. */
export async function listFiles(directory, { skip = () => false } = {}) {
  const files = [];
  async function walk(folder) {
    const entries = await readdir(folder, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const absolute = resolve(folder, entry.name);
      const path = relative(directory, absolute).split(sep).join('/');
      if (skip(path, entry.isDirectory())) continue;
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not accepted in release input: ${path}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files.push({ path, absolute, bytes: (await lstat(absolute)).size });
    }
  }
  await walk(resolve(directory));
  return files;
}

/** Parse Workbox's literal precache table as JSON data; never execute its code. */
export function parsePrecache(source) {
  const match = source.match(/\bprecacheAndRoute\s*\(\s*(\[[\s\S]*?\])\s*[,)]/);
  if (!match) throw new Error('Generated worker has no readable precacheAndRoute table.');
  const entries = JSON.parse(match[1].replace(/([{,]\s*)(url|revision)(\s*:)/g, '$1"$2"$3'));
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.url !== 'string'
    || !(entry.revision === null || typeof entry.revision === 'string')
    || Object.keys(entry).some(key => !['url', 'revision'].includes(key)))) {
    throw new Error('Generated precache table is not a list of URL/revision records.');
  }
  return entries;
}

function localAssetPath(raw, base, from = 'index.html') {
  if (typeof raw !== 'string' || !raw || /[\\\u0000-\u001f]/.test(raw)) throw new Error('Invalid asset URL.');
  const url = new URL(raw, `${AUDIT_ORIGIN}${base}${from}`);
  if (url.origin !== AUDIT_ORIGIN) throw new Error('Asset URL points outside the app origin.');
  if (!url.pathname.startsWith(base)) throw new Error('Asset URL escapes the configured app base.');
  if (url.search || url.hash) throw new Error('Build assets must not depend on query strings or fragments.');
  const path = decodeURIComponent(url.pathname.slice(base.length));
  if (!path || path.split('/').some(part => part === '.' || part === '..') || path.includes('\\')) throw new Error('Unsafe asset path.');
  return path;
}

function literalValue(source) {
  const quote = source[0];
  if (!['"', "'", '`'].includes(quote) || source.at(-1) !== quote || source.includes('${')) return null;
  if (quote === '"') return JSON.parse(source);
  return source.slice(1, -1).replace(/\\([\\/'`])/g, '$1');
}

function navigationAllowlist(source) {
  const match = source.match(/\ballowlist\s*:\s*\[\s*(\/(?:\\.|[^/\n])+\/[gimsuy]*)\s*\]/);
  if (!match) throw new Error('Worker navigation fallback has no single explicit allowlist.');
  const boundary = match[1].lastIndexOf('/');
  const pattern = match[1].slice(1, boundary);
  if (!pattern.startsWith('^') || pattern.length > 300) throw new Error('Navigation allowlist must begin at the pathname boundary.');
  return new RegExp(pattern, match[1].slice(boundary + 1));
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(([, name, , value]) => [name.toLowerCase(), value]));
}

export async function verifyPwa({ directory = resolve(PROJECT_ROOT, 'dist'), base: requestedBase } = {}) {
  const report = { ok: false, base: null, totalBuildBytes: 0, largestAsset: null, precacheCount: 0,
    precacheBytes: 0, fileLimitBytes: MAX_PRECACHE_FILE_BYTES, totalLimitBytes: MAX_PRECACHE_TOTAL_BYTES,
    errors: [], warnings: [] };
  const check = (condition, message) => { if (!condition) report.errors.push(message); };
  let files;
  try { files = await listFiles(directory); } catch (error) {
    report.errors.push(`Cannot read production build: ${error.code || error.message}`); return report;
  }
  const byPath = new Map(files.map(file => [file.path, file]));
  report.totalBuildBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes)[0];
  if (largest) report.largestAsset = { path: largest.path, bytes: largest.bytes };
  for (const file of files) check(!FORBIDDEN_OUTPUT.test(file.path), `Forbidden development/private output: ${file.path}`);
  const text = async path => {
    const file = byPath.get(path);
    if (!file) throw new Error(`Required build file is missing: ${path}`);
    return readFile(file.absolute, 'utf8');
  };
  let manifest, html, worker, base;
  try {
    manifest = JSON.parse(await text('manifest.webmanifest'));
    html = await text('index.html');
    worker = await text('sw.js');
    base = normalizeBase(requestedBase ?? process.env.SCREW_FALL_BASE ?? manifest.scope);
    report.base = base;
  } catch (error) { report.errors.push(error.message); return report; }
  const asset = (url, context, from) => {
    try {
      const path = localAssetPath(url, base, from);
      check(byPath.has(path), `${context} references a missing file: ${path}`);
      return path;
    } catch (error) { report.errors.push(`${context}: ${error.message}`); return null; }
  };

  check(manifest.name === 'Screw Fall' && manifest.short_name === 'Screw Fall', 'Manifest app names must be Screw Fall.');
  check(manifest.display === 'standalone', 'Manifest display must be standalone.');
  check(manifest.orientation === 'portrait-primary', 'Manifest orientation must be portrait-primary.');
  check(manifest.lang === 'en-GB' && manifest.dir === 'ltr', 'Manifest language/direction must be en-GB/ltr.');
  check(typeof manifest.description === 'string' && manifest.description.length > 10, 'Manifest description is missing.');
  for (const key of ['start_url', 'scope', 'id']) check(manifest[key] === base, `Manifest ${key} must equal the stable app base ${base}.`);
  for (const key of ['background_color', 'theme_color']) check(/^#[\da-f]{6}$/i.test(manifest[key] || ''), `Manifest ${key} must be a six-digit colour.`);
  check(manifest.prefer_related_applications === false, 'Manifest must not prefer a related native app.');
  check(['games', 'entertainment'].every(category => manifest.categories?.includes(category)), 'Manifest categories must include games and entertainment.');
  const manifestIcons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const iconPaths = [];
  for (const icon of manifestIcons) {
    const path = asset(icon.src, 'Manifest icon', 'manifest.webmanifest');
    if (path) iconPaths.push(path);
    const dimensions = /^(\d+)x(\d+)$/.exec(icon.sizes || '');
    check(icon.type === 'image/png' && dimensions && dimensions[1] === dimensions[2], 'Manifest icons must specify square PNG dimensions.');
    if (path && byPath.has(path) && dimensions) {
      const bytes = await readFile(byPath.get(path).absolute);
      check(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && bytes.readUInt32BE(16) === +dimensions[1] && bytes.readUInt32BE(20) === +dimensions[2], `Icon dimensions/content disagree with manifest: ${path}`);
    }
  }
  for (const size of ['192x192', '512x512']) check(manifestIcons.some(icon => icon.sizes === size && icon.purpose === 'any'), `Missing standard ${size} manifest icon.`);
  check(manifestIcons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'), 'Missing 512x512 maskable manifest icon.');

  const htmlReferences = [];
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => attributes(tag));
  const manifestLink = links.find(link => link.rel === 'manifest');
  check(Boolean(manifestLink), 'index.html has no manifest link.');
  if (manifestLink) check(asset(manifestLink.href, 'HTML manifest') === 'manifest.webmanifest', 'HTML manifest link does not reference the built manifest.');
  const apple = links.find(link => link.rel === 'apple-touch-icon');
  check(Boolean(apple), 'index.html has no Apple touch icon link.');
  if (apple) {
    const path = asset(apple.href, 'Apple touch icon');
    if (path && byPath.has(path)) {
      const bytes = await readFile(byPath.get(path).absolute);
      check(bytes.length >= 24 && bytes.readUInt32BE(16) === 180 && bytes.readUInt32BE(20) === 180, 'Apple touch icon must be a real 180x180 PNG.');
    }
  }
  for (const link of links) {
    if (link.href && ['stylesheet', 'icon', 'apple-touch-icon', 'manifest', 'modulepreload', 'preload'].includes(link.rel)) {
      const path = asset(link.href, `HTML ${link.rel}`);
      if (path) htmlReferences.push(path);
    }
  }
  for (const [tag] of html.matchAll(/<(?:script|img|audio|source)\b[^>]*>/gi)) {
    const { src } = attributes(tag);
    if (src) { const path = asset(src, 'HTML asset'); if (path) htmlReferences.push(path); }
  }
  check(htmlReferences.some(path => path.endsWith('.js')), 'HTML does not reference a production JavaScript bundle.');
  check(htmlReferences.some(path => path.endsWith('.css')), 'HTML does not reference a production CSS bundle.');

  let entries = [];
  try { entries = parsePrecache(worker); } catch (error) { report.errors.push(error.message); }
  const cached = new Set();
  for (const entry of entries) {
    const path = asset(entry.url, 'Precache', 'sw.js');
    if (!path) continue;
    if (cached.has(path)) { check(false, `Duplicate precache URL: ${path}`); continue; }
    cached.add(path);
    const file = byPath.get(path);
    if (file) {
      check(file.bytes <= MAX_PRECACHE_FILE_BYTES, `Precache file exceeds ${MAX_PRECACHE_FILE_BYTES} bytes: ${path}`);
      report.precacheBytes += file.bytes;
      if (entry.revision !== null) {
        const digest = createHash('md5').update(await readFile(file.absolute)).digest('hex');
        check(entry.revision === digest, `Precache revision does not match built content: ${path}`);
      }
    }
  }
  report.precacheCount = cached.size;
  check(report.precacheBytes <= MAX_PRECACHE_TOTAL_BYTES, `Precache exceeds ${MAX_PRECACHE_TOTAL_BYTES} bytes.`);
  for (const path of new Set(['index.html', 'manifest.webmanifest', ...iconPaths, ...htmlReferences])) check(cached.has(path), `Required asset is absent from precache: ${path}`);
  for (const file of files) {
    if (RUNTIME_EXTENSION.test(file.path) && file.path !== 'sw.js' && !/^workbox-[\w-]+\.js$/.test(file.path) && !OPTIONAL_ARTWORK.has(file.path)) {
      check(cached.has(file.path), `Runtime file is absent from precache: ${file.path}`);
    }
  }
  if (byPath.has('third-party-notices.txt')) check(cached.has('third-party-notices.txt'), 'Third-party notices are absent from precache.');
  check(!/\bcleanupOutdatedCaches\s*\(/.test(worker), 'Generated worker must not invoke the broad legacy-cache sweep.');
  const cachePrefix = worker.match(/\bsetCacheNameDetails\s*\(\s*\{\s*prefix\s*:\s*(["'`][^"'`]+["'`])/);
  check(cachePrefix && literalValue(cachePrefix[1]) === cacheIdForBase(base), 'Generated worker cache prefix is not namespaced to this app base.');
  const skipCalls = [...worker.matchAll(/\bskipWaiting\s*\(/g)];
  check(skipCalls.length === 1 && /addEventListener\(["']message["'],[^;]*["']SKIP_WAITING["'][^;]*\bskipWaiting\(/.test(worker), 'Worker activation must occur only through its SKIP_WAITING message handler.');
  const fallback = worker.match(/\bcreateHandlerBoundToURL\s*\(\s*(["'`][^"'`]+["'`])\s*\)/);
  check(fallback && literalValue(fallback[1]) === `${base}index.html`, 'Worker navigation fallback must be the index inside the app base.');
  try {
    const allowlist = navigationAllowlist(worker);
    check([base, `${base}index.html`, `${base}?debug`, `${base}index.html?debug=1`].every(path => allowlist.test(path)), 'Worker navigation allowlist excludes its own app.');
    const unrelated = [`${base}play`, `${base}nested/`, `${base.slice(0, -1)}-sibling/`, '/another-app/'];
    if (base !== '/') unrelated.push('/');
    check(unrelated.every(path => !allowlist.test(path)), 'Worker navigation fallback must serve only the app entry documents.');
  } catch (error) { report.errors.push(error.message); }
  // Workbox's own helper is loaded as a worker script, not by the page. It is
  // stored by the browser during worker installation and must exist in dist.
  const workerImports = worker.match(/\bdefine\s*\(\s*\[([^\]]*)\]/)?.[1] || '';
  let workerRuntime = worker;
  for (const [, value] of workerImports.matchAll(/["']([^"']+)["']/g)) {
    const path = asset(`${value}.js`, 'Worker helper', 'sw.js');
    if (path && byPath.has(path)) workerRuntime += await text(path);
  }
  // Inspect the generated controller method as well as testing the actual
  // installed Workbox controller behavior. No generated worker code executes.
  const activation = workerRuntime.match(/\bactivate\([^)]*\)\s*\{([\s\S]*?)\}\s*getURLsToCacheKeys\s*\(/)?.[1] || '';
  const ownCache = activation.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*await\s+self\.caches\.open\(this\.strategy\.cacheName\)/)?.[1];
  check(Boolean(ownCache) && activation.includes(`${ownCache}.keys()`)
    && activation.includes(`${ownCache}.delete(`) && activation.includes('new Set(')
    && activation.includes('.has(') && activation.includes('deletedURLs'), 'Generated worker lacks automatic cleanup within its own precache.');
  check(!/self\.caches\.(?:keys|delete)\s*\(/.test(workerRuntime), 'Generated worker must not enumerate or delete unrelated cache containers.');
  report.cleanupStrategy = 'obsolete entries in the app-namespaced precache';

  let pageScripts = '';
  for (const file of files.filter(file => TEXT_EXTENSION.test(file.path))) {
    const contents = await readFile(file.absolute, 'utf8');
    check(!/\/(?:Users|home)\/[A-Za-z0-9._-]+\/|file:\/\/|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})|\bAKIA[A-Z0-9]{16}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contents), `Private path or credential-like text in build: ${file.path}`);
    check(!/https?:\/\/(?:localhost(?=[:/"'`\s]|$)|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])/i.test(contents), `Private network URL in build: ${file.path}`);
    if (file.path.startsWith('assets/') && file.path.endsWith('.js')) pageScripts += contents;
    if (!/\.(?:js|css)$/.test(file.path)) continue;
    const patterns = file.path.endsWith('.css')
      ? [/url\(\s*["']?([^"')\s]+)["']?\s*\)/g, /@import\s+["']([^"']+)["']/g]
      : [/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g, /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g];
    for (const pattern of patterns) for (const [, url] of contents.matchAll(pattern)) {
      if (url.startsWith('data:') || url.startsWith('#')) continue;
      asset(url, `Runtime dependency in ${file.path}`, file.path);
    }
  }
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  check(new RegExp('["\'`]' + escapedBase + 'sw\\.js["\'`]').test(pageScripts), 'Page bundles do not contain a base-aware service-worker registration URL.');
  check(new RegExp('scope\\s*:\\s*["\'`]' + escapedBase + '["\'`]').test(pageScripts), 'Page bundles do not specify the correct service-worker scope.');
  check(/serviceWorker/.test(pageScripts) && /\.register\s*\(/.test(pageScripts), 'Service-worker registration code is absent from the page bundles.');
  report.ok = report.errors.length === 0;
  return report;
}

export function parseVerificationArguments(args, { allowRoot = false } = {}) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--json') result.json = true;
    else if (['--dir', '--base', ...(allowRoot ? ['--root'] : [])].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      result[argument === '--dir' ? 'directory' : argument.slice(2)] = value;
    } else throw new Error(`Unknown verification argument: ${argument}`);
  }
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseVerificationArguments(process.argv.slice(2));
    const report = await verifyPwa(options);
    if (!options.json) console.log(`PWA verification ${report.ok ? 'passed' : 'failed'}: ${report.precacheCount} precached files, ${report.precacheBytes} bytes, base ${report.base || 'unknown'}.`);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
