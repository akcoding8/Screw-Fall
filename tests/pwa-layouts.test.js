import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { CameraRig } from '../src/game/CameraRig.js';
import { createGameplayRect, readVisualViewport } from '../src/game/Viewport.js';
import { levelLabel } from '../src/game/LevelLabel.js';
import { detectInstalled } from '../src/pwa/InstallManager.js';

// Synthetic CSS-pixel layouts. These exercise the real camera math, not an
// emulation of iOS installation, device safe-area reporting or GPU performance.
const layouts = [
  { name: 'small phone', width: 375, height: 812, top: 44, bottom: 34 },
  { name: 'standard phone', width: 390, height: 844, top: 47, bottom: 34 },
  { name: 'large phone', width: 430, height: 932, top: 59, bottom: 34 },
  { name: 'iPad mini', width: 744, height: 1133, top: 24, bottom: 20 },
  { name: '11-inch iPad', width: 834, height: 1194, top: 24, bottom: 20 },
  { name: '13-inch iPad', width: 1024, height: 1366, top: 24, bottom: 20 },
  { name: 'desktop portrait area', width: 1440, gameWidth: 500, height: 900, top: 0, bottom: 0 },
];

function makeCamera(layout, { browserChrome = 0, standalone = true, anchor = -45 } = {}) {
  const windowObject = { innerWidth: layout.width, innerHeight: layout.height,
    visualViewport: { width: layout.width, height: layout.height - browserChrome, offsetLeft: 0, offsetTop: 0 },
    matchMedia: query => ({ matches: standalone && query === '(display-mode: standalone)' }) };
  const visual = readVisualViewport(windowObject);
  const width = layout.gameWidth ?? visual.width;
  const insets = { top: layout.top, bottom: layout.bottom, headerBottom: layout.top + 174 };
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fieldOfView, 1, .1, 140);
  const rig = new CameraRig(camera);
  rig.resize(width, visual.height, insets);
  rig.update(anchor, 0, true);
  return { camera, rig, visual, width, insets, anchor, installed: detectInstalled(windowObject, {}) };
}

function point(camera, x, y, z) {
  const projected = new THREE.Vector3(x, y, z).project(camera);
  return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
}

function contactFraction(view) {
  const contact = point(view.camera, 0, view.anchor, CONFIG.world.ballOrbitRadius);
  const rect = createGameplayRect(view.width, view.visual.height, view.insets);
  return { x: contact.x, y: (contact.y * view.visual.height - rect.y) / rect.height };
}

describe('PWA browser and standalone composition', () => {
  it.each(layouts)('$name retains the approved contact anchor with browser chrome and standalone dimensions', layout => {
    for (const browserChrome of [0, 72, 144]) {
      const view = makeCamera(layout, { browserChrome, standalone: browserChrome === 0 });
      expect(view.visual.height).toBe(layout.height - browserChrome);
      expect(view.width).toBe(layout.gameWidth ?? layout.width);
      expect(contactFraction(view).x).toBeCloseTo(.5, 10);
      expect(contactFraction(view).y).toBeCloseTo(.43, 10);
      expect(view.rig.anchorY).toBe(-45);
      expect(view.camera.fov).toBe(40);
    }
  });

  it.each(layouts)('$name changes install status without adding a camera offset at identical measured dimensions', layout => {
    const browser = makeCamera(layout, { standalone: false });
    const installed = makeCamera(layout, { standalone: true });
    expect(browser.installed).toBe(false);
    expect(installed.installed).toBe(true);
    expect(installed.camera.projectionMatrix.elements).toEqual(browser.camera.projectionMatrix.elements);
    expect(installed.camera.matrixWorld.elements).toEqual(browser.camera.matrixWorld.elements);
    expect(contactFraction(installed)).toEqual(contactFraction(browser));
  });

  it.each(layouts)('$name keeps the complete ring visible and the bounce below the header', layout => {
    const view = makeCamera(layout);
    const { camera, anchor } = view;
    const projectedRing = Array.from({ length: 120 }, (_, index) => {
      const angle = index * Math.PI / 60;
      return point(camera, Math.cos(angle) * CONFIG.world.outerRadius, anchor, Math.sin(angle) * CONFIG.world.outerRadius);
    });
    expect(Math.min(...projectedRing.map(p => p.x))).toBeGreaterThan(.1);
    expect(Math.max(...projectedRing.map(p => p.x))).toBeLessThan(.9);
    expect(Math.min(...projectedRing.map(p => p.y))).toBeGreaterThan(0);
    expect(Math.max(...projectedRing.map(p => p.y))).toBeLessThan(1);
    const rise = CONFIG.physics.bounceVelocity ** 2 / (2 * CONFIG.physics.bounceGravity);
    const apexTop = point(camera, 0, anchor + rise + 2 * CONFIG.physics.ballRadius, CONFIG.world.ballOrbitRadius);
    expect(apexTop.y * view.visual.height).toBeGreaterThan(view.insets.headerBottom + 8);
    const top = point(camera, 0, anchor + 2 * CONFIG.physics.ballRadius, CONFIG.world.ballOrbitRadius);
    const contact = point(camera, 0, anchor, CONFIG.world.ballOrbitRadius);
    // A tablet must retain a compact ball relative to the gameplay viewport.
    expect(contact.y - top.y).toBeGreaterThan(0);
    expect(contact.y - top.y).toBeLessThan(.055);
  });

  it.each(layouts)('$name settles browser-bar/keyboard return without moving the simulation anchor', layout => {
    const view = makeCamera(layout, { browserChrome: 144, standalone: false });
    const previousPixels = view.rig.projectContactY() * view.visual.height;
    view.rig.resize(view.width, layout.height, { ...view.insets, smooth: true });
    const firstPixels = view.rig.projectContactY() * layout.height;
    // An expanding viewport may reserve extra header clearance immediately;
    // remaining movement still settles gradually without moving world state.
    expect(firstPixels).toBeGreaterThanOrEqual(previousPixels - 1e-9);
    expect(firstPixels).toBeLessThan(view.rig.contactTargetY);
    const rise = CONFIG.physics.bounceVelocity ** 2 / (2 * CONFIG.physics.bounceGravity);
    const apex = point(view.camera, 0, view.anchor + rise + 2 * CONFIG.physics.ballRadius, CONFIG.world.ballOrbitRadius);
    expect(apex.y * layout.height).toBeGreaterThan(view.insets.headerBottom + 8);
    for (let frame = 0; frame < 240; frame++) view.rig.updateViewport(1 / 120);
    const rect = createGameplayRect(view.width, layout.height, view.insets);
    expect((view.rig.projectContactY() * layout.height - rect.y) / rect.height).toBeCloseTo(.43, 9);
    expect(view.rig.anchorY).toBe(-45);
    expect(view.rig.simulationAnchorY).toBe(-45);
  });
});

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// This is a narrow stylesheet contract check, not a computed browser layout.
// Merge repeated direct selectors so later overrides are represented.
function declarations(selector) {
  const result = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].trim().split(',').map(s => s.trim()).includes(selector)) continue;
    for (const item of match[2].split(';')) {
      const colon = item.indexOf(':');
      if (colon > -1) result[item.slice(0, colon).trim()] = item.slice(colon + 1).trim();
    }
  }
  return result;
}

describe('PWA modal and large-level layout contracts', () => {
  it.each([
    ['#settings-panel', '.settings-scroll'], ['#skins-panel', '.skins-scroll'],
    ['.progress-panel', '.progress-scroll'], ['#evidence-viewer', '.evidence-image-scroll'],
  ])('%s reserves safe-area height and retains a reachable internal scroller', (panel, scroller) => {
    const outer = declarations(panel), inner = declarations(scroller);
    const height = outer['max-height'] === 'none' ? outer.height : outer['max-height'];
    expect(height).toContain('100dvh');
    expect(height).toContain('safe-area-inset-top');
    expect(height).toContain('safe-area-inset-bottom');
    expect(inner.overflow).toBe('auto');
    expect(inner['min-height']).toBe('0');
    expect(inner['overscroll-behavior']).toBe('contain');
    expect(html).toContain(`class="${scroller.slice(1)}"`);
  });

  it('keeps the update prompt scrollable and the offline toast clear of pointer input', () => {
    expect(declarations('#pwa-update-dialog').overflow).toBe('auto');
    expect(declarations('#pwa-update-dialog')['max-height']).toContain('safe-area-inset-bottom');
    expect(declarations('#pwa-toast')['pointer-events']).toBe('none');
    expect(css).toContain('width:min(500px,var(--visual-width,100vw))');
    expect(html).toContain('viewport-fit=cover');
    expect(html).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  });

  it.each([9, 99, 100, 1757, 99999, 1000000, 999000000, Number.MAX_SAFE_INTEGER])('preserves every digit in level %s', number => {
    const label = levelLabel(number);
    expect(label.text).toBe(number.toLocaleString('en-GB'));
    expect(label.text.replaceAll(',', '')).toBe(String(number));
    expect(label.text).not.toMatch(/[eE+…]/);
    expect(label.fontSize).toBeGreaterThanOrEqual(16);
    expect(label.fontSize).toBeLessThanOrEqual(31);
  });

  it('fits the longest level using smaller type and wrapping in full Stats', () => {
    expect(levelLabel(Number.MAX_SAFE_INTEGER).fontSize).toBeLessThan(levelLabel(1757).fontSize);
    expect(declarations('.level-heading h1')['font-size']).toBe('var(--level-font-size,31px)');
    expect(declarations('#level')['white-space']).toBe('nowrap');
    expect(declarations('.settings-stats dd')['overflow-wrap']).toBe('anywhere');
    expect(declarations('#level')['text-overflow']).toBeUndefined();
  });
});
