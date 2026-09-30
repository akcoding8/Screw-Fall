import { describe, it, expect, vi } from 'vitest';
import { normalizeBase, resolveBase, appPath, publicAppUrl } from '../src/pwa/PwaPaths.js';
import { createManifest, workboxOptions, cacheIdForBase, buildInformation } from '../scripts/pwa-config.mjs';
import { detectInstalled, installPresentation, InstallManager } from '../src/pwa/InstallManager.js';
import { shareApp } from '../src/pwa/ShareApp.js';

const mediaWindow = matches => ({ matchMedia: () => ({ matches }) });
describe('PWA scope follows the deployment path', () => {
  it.each([
    [{}, '/'], [{ repository: 'person/screw-fall' }, '/screw-fall/'],
    [{ repository: 'person/another-tower' }, '/another-tower/'],
    [{ repository: 'person/person.github.io' }, '/'],
    [{ base: '/custom/path', repository: 'person/game' }, '/custom/path/'],
    [{ base: '//custom///path//' }, '/custom/path/'],
  ])('resolves %j', (environment, expected) => {
    expect(resolveBase(environment)).toBe(expected);
    const manifest = createManifest(expected);
    expect(manifest).toMatchObject({ name: 'Screw Fall', short_name: 'Screw Fall', lang: 'en-GB', dir: 'ltr',
      display: 'standalone', orientation: 'portrait-primary', id: expected, start_url: expected, scope: expected,
      prefer_related_applications: false, categories: ['games', 'entertainment'] });
    expect(manifest.theme_color).toMatch(/^#[a-f\d]{6}$/); expect(manifest.background_color).toMatch(/^#[a-f\d]{6}$/);
    expect(manifest.icons.some(icon => icon.purpose === 'maskable')).toBe(true);
    expect(manifest.icons.every(icon => icon.src.startsWith(expected + 'icons/'))).toBe(true);
    expect(appPath(expected, 'sw.js')).toBe(expected + 'sw.js');
    expect(appPath(expected, 'audio/test.wav')).toBe(expected + 'audio/test.wav');
    expect(appPath(expected, 'images/test.png')).toBe(expected + 'images/test.png');
    const options = workboxOptions(expected);
    expect(options.navigateFallback).toBe(expected + 'index.html');
    for (const path of [expected, expected + 'index.html', expected + '?debug', expected + 'index.html?debug=1']) {
      expect(options.navigateFallbackAllowlist[0].test(path)).toBe(true);
    }
    for (const path of [expected + 'play', expected + 'nested/', '/sibling/']) {
      expect(options.navigateFallbackAllowlist[0].test(path)).toBe(false);
    }
    expect(options.cleanupOutdatedCaches).toBe(false); expect(options.skipWaiting).toBe(false);
    expect(options.maximumFileSizeToCacheInBytes).toBe(2 * 1024 * 1024);
    expect(options.cacheId).toMatch(/^screw-fall-/);
  });
  it.each(['https://host/game', '/a/../b/', '/a/./', '/a?key=x', '/a#b', '/a/%2f/'])('rejects unsafe base %s', value => expect(() => normalizeBase(value)).toThrow());
  it('gives sibling paths distinct cache prefixes', () => expect(new Set(['/', '/a-b/', '/a/b/', '/ab/'].map(cacheIdForBase)).size).toBe(4));
  it('rejects escaping asset paths', () => { expect(() => appPath('/a/', '/assets/x')).toThrow(); expect(() => appPath('/a/', '../x')).toThrow(); });
  it('uses a version-independent manifest id and only validated commit metadata', () => {
    expect(buildInformation({ version: '1.0.0', commit: 'deadbeef123456' })).toEqual({ version: '1.0.0', build: 'deadbeef' });
    expect(buildInformation({ version: '1.0.0', commit: '/private/path' }).build).toBe('local');
  });
});

describe('public sharing excludes development addresses and player state', () => {
  it.each(['http://localhost:4173', 'https://localhost', 'https://127.0.0.1', 'https://192.168.1.50', 'https://10.0.0.2',
    'https://172.20.0.1', 'https://169.254.1.2', 'https://[::1]', 'https://[fd00::1]', 'https://mac.local'])('does not advertise %s as public', origin => {
    expect(publicAppUrl({ origin, base: '/game/', production: true })).toBeNull();
  });
  it('shares only the canonical HTTPS app root', () => {
    expect(publicAppUrl({ origin: 'https://person.github.io/screw-fall/?debug=1#private', base: '/screw-fall/', production: true }))
      .toBe('https://person.github.io/screw-fall/');
    expect(publicAppUrl({ origin: 'https://person.github.io', production: false })).toBeNull();
  });
  it('uses Web Share without including any progress', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareApp({ url: 'https://person.github.io/game/', navigatorObject: { share } })).toBe('Shared.');
    expect(share).toHaveBeenCalledWith({ title: 'Screw Fall', text: 'A smooth endless falling-tower arcade game.', url: 'https://person.github.io/game/' });
  });
  it('copies when share is unsupported or fails, and preserves a deliberate dismissal', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined), url = 'https://person.github.io/game/';
    expect(await shareApp({ url, navigatorObject: { clipboard: { writeText } } })).toBe('Link copied.');
    expect(writeText).toHaveBeenCalledWith(url);
    expect(await shareApp({ url, navigatorObject: { share: vi.fn().mockRejectedValue({ name: 'AbortError' }), clipboard: { writeText } } })).toBe('');
    expect(writeText).toHaveBeenCalledOnce();
    const fallback = vi.fn().mockReturnValue(true);
    expect(await shareApp({ url, navigatorObject: {}, copyFallback: fallback })).toBe('Link copied.');
    expect(fallback).toHaveBeenCalledWith(url);
    expect(await shareApp({ url, navigatorObject: {} })).toBe(`Copy this link: ${url}`);
  });
});

describe('install help is based on browser capabilities and an explicit gesture', () => {
  it('detects display mode and iOS standalone compatibility', () => {
    expect(detectInstalled(mediaWindow(true), {})).toBe(true);
    expect(detectInstalled(mediaWindow(false), { standalone: true })).toBe(true);
    expect(detectInstalled(mediaWindow(false), { standalone: false })).toBe(false);
  });
  it('presents installed, programmatic and appropriate manual states', () => {
    expect(installPresentation({ installed: true }).status).toBe('Installed');
    expect(installPresentation({ promptAvailable: true }).canInstall).toBe(true);
    expect(installPresentation({ navigatorObject: { standalone: false } }).guidance).toContain('Share menu');
    expect(installPresentation({ navigatorObject: { platform: 'MacIntel', maxTouchPoints: 5 } }).guidance).toContain('Share menu');
    expect(installPresentation({ navigatorObject: { platform: 'Linux' } }).guidance).not.toContain('Share menu');
  });
  it.each(['accepted', 'dismissed'])('waits for a trusted gesture and handles %s once', async outcome => {
    const windowObject = new EventTarget(); windowObject.matchMedia = () => new EventTarget();
    const controller = new InstallManager({ windowObject, navigatorObject: {} });
    const browserEvent = new Event('beforeinstallprompt', { cancelable: true });
    browserEvent.prompt = vi.fn().mockResolvedValue(undefined); browserEvent.userChoice = Promise.resolve({ outcome });
    windowObject.dispatchEvent(browserEvent);
    expect(browserEvent.defaultPrevented).toBe(true); expect(browserEvent.prompt).not.toHaveBeenCalled();
    expect(await controller.installFromGesture({ isTrusted: false })).toBe(false);
    expect(await controller.installFromGesture({ isTrusted: true })).toBe(outcome === 'accepted');
    expect(await controller.installFromGesture({ isTrusted: true })).toBe(false);
    expect(browserEvent.prompt).toHaveBeenCalledOnce();
    windowObject.dispatchEvent(new Event('appinstalled')); expect(controller.snapshot.status).toBe('Installed'); controller.dispose();
  });
});
