import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { createLevel } from '../src/game/LevelManager.js';
import { createPlatform, updatePlatformView, setPlatformPalette, disposePlatform } from '../src/game/Platform.js';
import { evaluatePlatformMotion } from '../src/game/PlatformMotion.js';
import { ParticleSystem } from '../src/game/ParticleSystem.js';
import { selectPalette } from '../src/game/PaletteManager.js';

describe('generated level resource cleanup', () => {
  it('releases motion buffers, shared detail, recoloured debris, walls and complete Flow towers across rebuilds', () => {
    const scene = new THREE.Scene();
    const particles = new ParticleSystem(scene);
    for (const number of [3, 5, 6, 8, 10, 16, 17, 26, 33, 37]) {
      const level = createLevel(number);
      const views = level.platforms.map(platform => {
        if (platform.motion) evaluatePlatformMotion(platform, 0);
        const view = createPlatform(platform, level.palette);
        scene.add(view);
        return view;
      });
      const disposals = new Map();
      function track(resource) {
        if (!resource || disposals.has(resource)) return;
        disposals.set(resource, 0);
        resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
      }
      function trackViews() {
        for (const view of views) {
          const resources = view.userData.platformResources;
          resources.geometries.forEach(track);
          for (const value of Object.values(resources.lease.entry)) if (value?.isMaterial || value?.isBufferGeometry) track(value);
          for (const mesh of resources.meshes) if (mesh.isInstancedMesh) track(mesh);
        }
      }
      trackViews();
      const geometryCounts = views.map(view => view.userData.platformResources.geometries.length);
      try {
        for (let step = 1; step <= 30; step++) {
          for (let i = 0; i < level.platforms.length; i++) {
            if (!level.platforms[i].motion) continue;
            evaluatePlatformMotion(level.platforms[i], step / 120);
            updatePlatformView(views[i], level.platforms[i]);
          }
        }
        expect(views.map(view => view.userData.platformResources.geometries.length)).toEqual(geometryCounts);
        for (let i = 0; i < views.length - 1; i++) {
          level.platforms[i].active = false;
          particles.shatter(views[i], i % 3 === 0);
          expect(particles.activeDebrisCount).toBeLessThanOrEqual(CONFIG.particles.maxFragments);
        }
        // Recolour while detached chunks still exist, then retry immediately.
        for (const view of views) setPlatformPalette(view, selectPalette(number, 'vivid'));
        trackViews();
        particles.clear();
        for (const view of views) disposePlatform(view);
        expect([...disposals.values()].every(count => count === 1)).toBe(true);
        expect(particles.activeCount).toBe(0);
        expect(particles.fragmentPool.length).toBeLessThanOrEqual(CONFIG.particles.maxFragments);
        expect(scene.children).toEqual([particles.mesh]);
      } finally {
        particles.clear();
        views.forEach(disposePlatform);
      }
    }
    particles.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
