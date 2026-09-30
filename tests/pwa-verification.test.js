import { afterEach, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createManifest, cacheIdForBase, workboxOptions, MAX_PRECACHE_FILE_BYTES } from '../scripts/pwa-config.mjs';
import { parsePrecache, parseVerificationArguments, verifyPwa } from '../scripts/verify-pwa.mjs';
import { createIgnoreMatcher, scanReleaseText, verifyRelease } from '../scripts/verify-release.mjs';

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function write(directory, path, content) {
  await mkdir(dirname(join(directory, path)), { recursive: true });
  await writeFile(join(directory, path), content);
}

async function buildFixture(base = '/') {
  const root = await mkdtemp(join(tmpdir(), 'screw-fall-pwa-verify-'));
  directories.push(root);
  const directory = join(root, 'dist');
  const iconFiles = ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon-180.png', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png'];
  await mkdir(join(directory, 'icons'), { recursive: true });
  for (const file of iconFiles) await copyFile(new URL(`../public/icons/${file}`, import.meta.url), join(directory, 'icons', file));
  await write(directory, 'manifest.webmanifest', JSON.stringify(createManifest(base)));
  await write(directory, 'index.html', `<html lang="en-GB"><head><link rel="manifest" href="${base}manifest.webmanifest"><link rel="apple-touch-icon" href="${base}icons/apple-touch-icon-180.png"><link rel="icon" href="${base}icons/favicon.svg"><link rel="stylesheet" href="${base}assets/index.css"></head><script src="${base}assets/index.js"></script></html>`);
  await write(directory, 'assets/index.js', `navigator.serviceWorker.register("${base}sw.js",{scope:"${base}"});import("./secondary.js");`);
  await write(directory, 'assets/secondary.js', 'export const installed = true;');
  await write(directory, 'assets/index.css', 'body{background:#e9efeb}');
  await write(directory, 'workbox-demo.js', 'class PrecacheFixture { activate(event){return waitUntil(event,async()=>{const cache=await self.caches.open(this.strategy.cacheName);const requests=await cache.keys();const expected=new Set(this.entries.values());const deletedURLs=[];for(const request of requests)if(!expected.has(request.url)){await cache.delete(request);deletedURLs.push(request.url);}return {deletedURLs};});}getURLsToCacheKeys(){return this.entries;}}');
  await write(directory, 'third-party-notices.txt', 'Third-party notices fixture.');
  const entries = await Promise.all(['index.html', 'manifest.webmanifest', 'third-party-notices.txt', 'assets/index.js', 'assets/secondary.js', 'assets/index.css', ...iconFiles.map(file => `icons/${file}`)].map(async url => ({ url, revision: createHash('md5').update(await readFile(join(directory, url))).digest('hex') })));
  const worker = `define(["./workbox-demo"],function(e){e.setCacheNameDetails({prefix:"${cacheIdForBase(base)}"});self.addEventListener("message",e=>{e.data&&"SKIP_WAITING"===e.data.type&&self.skipWaiting()});e.precacheAndRoute(${JSON.stringify(entries)},{});e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("${base}index.html"),{allowlist:[${workboxOptions(base).navigateFallbackAllowlist[0].toString()}]}));});`;
  await write(directory, 'sw.js', worker);
  return { root, directory, base, worker, entries };
}

async function releaseFixture() {
  const fixture = await buildFixture();
  const { root } = fixture;
  const files = ['.gitignore', '.nvmrc', 'package.json', 'package-lock.json', '.github/workflows/deploy-pages.yml'];
  for (const path of files) await write(root, path, await readFile(new URL(`../${path}`, import.meta.url)));
  for (const name of ['README.md', 'IMPLEMENTATION_NOTES.md', 'DEPLOYMENT.md', 'PWA_INSTALL.md', 'PWA_TESTING.md', 'RELEASE_CHECKLIST.md', 'CHANGELOG.md']) await write(root, name, '# Screw Fall\nRelease documentation fixture.\n');
  await write(root, 'node_modules/three/package.json', JSON.stringify({ name: 'three', version: '0.186.0', license: 'MIT' }));
  return fixture;
}

describe('generated PWA output verification', () => {
  it.each(['/', '/screw-fall/', '/another-personal-game/'])('accepts a complete build scoped to %s', async base => {
    const fixture = await buildFixture(base);
    const report = await verifyPwa(fixture);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.base).toBe(base);
    expect(report.precacheCount).toBe(fixture.entries.length);
    expect(report.precacheBytes).toBeLessThan(report.totalBuildBytes);
    expect(report.largestAsset.bytes).toBeGreaterThan(100_000);
  });

  it('fails when an asset declared by HTML is not cached', async () => {
    const fixture = await buildFixture();
    const removed = fixture.worker.replace(JSON.stringify(fixture.entries), JSON.stringify(fixture.entries.filter(entry => !entry.url.endsWith('.css'))));
    await write(fixture.directory, 'sw.js', removed);
    expect((await verifyPwa(fixture)).errors).toContain('Required asset is absent from precache: assets/index.css');
  });

  it('checks the dynamically imported local chunk exists', async () => {
    const fixture = await buildFixture();
    await rm(join(fixture.directory, 'assets/secondary.js'));
    expect((await verifyPwa(fixture)).errors.some(error => error.includes('Runtime dependency') && error.includes('secondary.js'))).toBe(true);
  });

  it.each(['https://cdn.example/required.css', 'http://' + '127.0.0.1:5173/assets/required.css', '/assets/index.css'])('rejects an external or base-escaping required URL', async url => {
    const fixture = await buildFixture('/screw-fall/');
    const path = join(fixture.directory, 'index.html');
    await writeFile(path, (await readFile(path, 'utf8')).replace('/screw-fall/assets/index.css', url));
    expect((await verifyPwa(fixture)).ok).toBe(false);
  });

  it('rejects an out-of-scope navigation fallback and automatic activation', async () => {
    const fixture = await buildFixture('/screw-fall/');
    await write(fixture.directory, 'sw.js', fixture.worker.replace('createHandlerBoundToURL("/screw-fall/index.html")', 'createHandlerBoundToURL("/index.html")') + 'self.skipWaiting();');
    const report = await verifyPwa(fixture);
    expect(report.errors).toContain('Worker navigation fallback must be the index inside the app base.');
    expect(report.errors).toContain('Worker activation must occur only through its SKIP_WAITING message handler.');
  });

  it.each(['/', '/screw-fall/'])('rejects a broad navigation allowlist under %s', async base => {
    const fixture = await buildFixture(base);
    await write(fixture.directory, 'sw.js', fixture.worker.replace(String(workboxOptions(base).navigateFallbackAllowlist[0]), String(new RegExp(`^${base}`))));
    expect((await verifyPwa(fixture)).errors).toContain('Worker navigation fallback must serve only the app entry documents.');
  });

  it('rejects broad legacy cleanup and a cache namespace shared with another app', async () => {
    const fixture = await buildFixture();
    await write(fixture.directory, 'sw.js', fixture.worker.replace(cacheIdForBase('/'), 'generic') + 'e.cleanupOutdatedCaches();');
    const report = await verifyPwa(fixture);
    expect(report.errors).toContain('Generated worker must not invoke the broad legacy-cache sweep.');
    expect(report.errors).toContain('Generated worker cache prefix is not namespaced to this app base.');
  });

  it('checks own-cache cleanup exists without enumerating or deleting sibling caches', async () => {
    const fixture = await buildFixture();
    await write(fixture.directory, 'workbox-demo.js', 'self.caches.keys().then(names=>names.map(name=>self.caches.delete(name)));');
    const report = await verifyPwa(fixture);
    expect(report.errors).toContain('Generated worker lacks automatic cleanup within its own precache.');
    expect(report.errors).toContain('Generated worker must not enumerate or delete unrelated cache containers.');
  });

  it('rejects absent registration, missing service workers and inaccurate icon dimensions', async () => {
    const fixture = await buildFixture();
    await write(fixture.directory, 'assets/index.js', 'console.log("fixture");');
    await copyFile(join(fixture.directory, 'icons/favicon-16.png'), join(fixture.directory, 'icons/pwa-192.png'));
    let report = await verifyPwa(fixture);
    expect(report.errors).toContain('Service-worker registration code is absent from the page bundles.');
    expect(report.errors).toContain('Icon dimensions/content disagree with manifest: icons/pwa-192.png');
    await rm(join(fixture.directory, 'sw.js'));
    report = await verifyPwa(fixture);
    expect(report.errors).toContain('Required build file is missing: sw.js');
  });

  it('rejects large precache files, source maps and reference videos', async () => {
    const fixture = await buildFixture();
    await write(fixture.directory, 'assets/index.js', Buffer.alloc(MAX_PRECACHE_FILE_BYTES + 1, 32));
    await write(fixture.directory, 'assets/index.js.map', '{}');
    await write(fixture.directory, 'references/recording.mp4', Buffer.from([0]));
    const report = await verifyPwa(fixture);
    expect(report.errors.some(error => error.includes('Precache file exceeds'))).toBe(true);
    expect(report.errors).toContain('Forbidden development/private output: assets/index.js.map');
    expect(report.errors).toContain('Forbidden development/private output: references/recording.mp4');
  });

  it('requires all static audio to be precached when audio files exist', async () => {
    const fixture = await buildFixture();
    await write(fixture.directory, 'assets/bounce.ogg', 'audio fixture');
    expect((await verifyPwa(fixture)).errors).toContain('Runtime file is absent from precache: assets/bounce.ogg');
  });

  it('keeps shipped third-party notices available offline', async () => {
    const fixture = await buildFixture();
    await write(fixture.directory, 'sw.js', fixture.worker.replace(JSON.stringify(fixture.entries), JSON.stringify(fixture.entries.filter(entry => entry.url !== 'third-party-notices.txt'))));
    expect((await verifyPwa(fixture)).errors).toContain('Third-party notices are absent from precache.');
  });

  it('rejects stale precache revisions and remote CSS imports', async () => {
    const fixture = await buildFixture();
    await write(fixture.directory, 'assets/index.css', '@import "https://fonts.example/font.css";');
    const report = await verifyPwa(fixture);
    expect(report.errors).toContain('Precache revision does not match built content: assets/index.css');
    expect(report.errors.some(error => error.includes('Runtime dependency') && error.includes('outside the app origin'))).toBe(true);
  });

  it('scans built HTML and SVG content for personal paths and credential-like text', async () => {
    const fixture = await buildFixture();
    const key = 'sk-' + 'q'.repeat(26);
    const personalPath = '/' + ['Users', 'ExamplePerson', 'capture.png'].join('/');
    await write(fixture.directory, 'icons/favicon.svg', `<svg><!-- ${key} ${personalPath} --></svg>`);
    expect((await verifyPwa(fixture)).errors).toContain('Private path or credential-like text in build: icons/favicon.svg');
  });

  it('does not execute malformed data while parsing the worker', () => {
    expect(parsePrecache('e.precacheAndRoute([{url:"index.html",revision:null}],{})')).toEqual([{ url: 'index.html', revision: null }]);
    expect(() => parsePrecache('e.precacheAndRoute([{url:(globalThis.__unexpected=true),revision:null}],{})')).toThrow();
    expect(globalThis.__unexpected).toBeUndefined();
  });

  it('rejects duplicate precache URLs without inflating unique-byte totals', async () => {
    const fixture = await buildFixture();
    const before = await verifyPwa(fixture);
    await write(fixture.directory, 'sw.js', fixture.worker.replace(JSON.stringify(fixture.entries), JSON.stringify([...fixture.entries, fixture.entries[0]])));
    const after = await verifyPwa(fixture);
    expect(after.errors).toContain('Duplicate precache URL: index.html');
    expect(after.precacheBytes).toBe(before.precacheBytes);
  });

  it('parses only documented command-line arguments', () => {
    expect(parseVerificationArguments(['--dir', 'dist-other', '--base', '/other/', '--json'])).toEqual({ directory: 'dist-other', base: '/other/', json: true });
    expect(() => parseVerificationArguments(['--dir'])).toThrow('Missing value');
    expect(() => parseVerificationArguments(['--execute-worker'])).toThrow('Unknown');
  });
});

describe('public release hygiene verification', () => {
  it('uses ordered ignore rules without hiding the example environment template', () => {
    const ignore = createIgnoreMatcher('node_modules/\n.env*\n!.env.example\n*.log\nartifacts/\n');
    expect(ignore('node_modules/module/index.js')).toBe(true);
    expect(ignore('.env.production')).toBe(true);
    expect(ignore('.env.example')).toBe(false);
    expect(ignore('nested/file.log')).toBe(true);
    expect(ignore('artifacts/capture.png')).toBe(true);
    expect(ignore('src/game/Game.js')).toBe(false);
  });

  it('reports potential credentials and personal paths without exposing their contents', () => {
    const key = 'sk-' + 'z'.repeat(26);
    const privatePath = '/' + ['Users', 'ExamplePerson', 'private.png'].join('/');
    const findings = scanReleaseText(`const key = "${key}";\nconst source = "${privatePath}";`, 'src/example.js');
    expect(findings.map(finding => finding.kind)).toEqual(['absolute-user-path', 'OpenAI-style-key']);
    expect(JSON.stringify(findings)).not.toContain(key);
    expect(JSON.stringify(findings)).not.toContain(privatePath);
  });

  it('allows deliberate private-host test data and local-preview documentation but rejects runtime dependencies', () => {
    const url = 'http://' + '192.168.1.20:5173/';
    expect(scanReleaseText(url, 'tests/private-host.test.js')).toEqual([]);
    expect(scanReleaseText(url, 'PWA_TESTING.md')).toEqual([]);
    expect(scanReleaseText(url, 'src/runtime.js')[0].kind).toBe('private-runtime-url');
  });

  it('accepts a complete release fixture, preserving ignored private material', async () => {
    const fixture = await releaseFixture();
    const value = 'sk-' + 'p'.repeat(26);
    await write(fixture.root, '.tools/private-local-test.txt', value);
    const report = await verifyRelease(fixture);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.productionDependencies[0].licence).toBe('MIT');
    expect(await readFile(join(fixture.root, '.tools/private-local-test.txt'), 'utf8')).toBe(value);
  });

  it('fails if package-lock, ignored materials or action pinning no longer match the release contract', async () => {
    const fixture = await releaseFixture();
    const lock = JSON.parse(await readFile(join(fixture.root, 'package-lock.json'), 'utf8'));
    lock.version = '0.1.0';
    await write(fixture.root, 'package-lock.json', JSON.stringify(lock));
    const ignores = await readFile(join(fixture.root, '.gitignore'), 'utf8');
    await write(fixture.root, '.gitignore', ignores.replace('screenshots/\n', ''));
    const workflow = await readFile(join(fixture.root, '.github/workflows/deploy-pages.yml'), 'utf8');
    await write(fixture.root, '.github/workflows/deploy-pages.yml', workflow.replace(/actions\/checkout@[a-f0-9]{40}/, 'actions/checkout@main'));
    const report = await verifyRelease(fixture);
    expect(report.errors).toContain('Package and lockfile root versions disagree.');
    expect(report.errors).toContain('.gitignore does not exclude screenshots/private.png.');
    expect(report.errors).toContain('Pages workflow needs official SHA-pinned actions/checkout.');
  });
});
