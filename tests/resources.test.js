import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { createPrototypeLevel as createLevel } from '../src/game/PrototypeLevels.js';
import { createPlatform, disposePlatform } from '../src/game/Platform.js';
import { ParticleSystem } from '../src/game/ParticleSystem.js';

function trackDisposals(resources) {
  const counts = new Map();
  for (const resource of resources) {
    counts.set(resource, 0);
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  }
  return counts;
}

function platformMaterials(view) {
  return Object.values(view.userData.platformResources.lease.entry).filter(value => value?.isMaterial);
}

describe('platform and particle resource lifetimes', () => {
  it('keeps shared materials alive until the last platform releases them, including detached smash debris', () => {
    const scene = new THREE.Scene();
    const particles = new ParticleSystem(scene);
    const level = createLevel(1);
    const first = createPlatform(level.platforms[0], level.palette);
    const last = createPlatform(level.platforms[1], level.palette);
    scene.add(first, last);
    const materials = platformMaterials(first);
    const materialDisposals = trackDisposals(materials);
    const geometries = [...first.userData.platformResources.geometries, ...last.userData.platformResources.geometries];
    const geometryDisposals = trackDisposals(geometries);
    try {
      expect(platformMaterials(last)).toEqual(materials);
      particles.shatter(first, true);
      const fragments = particles.fragments.length;
      particles.shatter(first, true);
      expect(particles.fragments).toHaveLength(fragments);
      expect(first.children).toHaveLength(0);
      particles.update(CONFIG.particles.fragmentLifetime * 2);
      expect(particles.activeCount).toBe(0);
      expect([...materialDisposals.values()]).toEqual(materials.map(() => 0));

      disposePlatform(first);
      disposePlatform(first);
      expect([...materialDisposals.values()]).toEqual(materials.map(() => 0));
      expect(last.children.length).toBeGreaterThan(0);
      disposePlatform(last);
      disposePlatform(last);
      expect([...geometryDisposals.values()]).toEqual(geometries.map(() => 1));
      expect([...materialDisposals.values()]).toEqual(materials.map(() => 1));
      expect(scene.children).toEqual([particles.mesh]);
    } finally {
      particles.dispose();
      disposePlatform(first);
      disposePlatform(last);
    }
  });

  it('bounds debris and particle pools and releases every tower resource across repeated rebuilds', () => {
    const scene = new THREE.Scene();
    const particles = new ParticleSystem(scene);
    const previousMaterials = new Map();
    const particleResources = trackDisposals([particles.mesh, particles.mesh.geometry, particles.mesh.material]);
    try {
      // Repeat a palette after cycling the complete authored set, as later
      // numbered levels do. Each cycle exercises both expiry and early retry.
      for (const levelNumber of [1, 2, 3, 4]) {
        const level = createLevel(levelNumber);
        const tower = new THREE.Group();
        scene.add(tower);
        const views = level.platforms.map(platform => createPlatform(platform, level.palette));
        tower.add(...views);
        const materials = platformMaterials(views[0]);
        for (const material of materials) {
          expect(previousMaterials.get(level.layoutIndex)?.has(material) ?? false).toBe(false);
        }
        previousMaterials.set(level.layoutIndex, new Set(materials));
        const materialDisposals = trackDisposals(materials);
        const geometries = views.flatMap(view => view.userData.platformResources.geometries);
        const geometryDisposals = trackDisposals(geometries);
        try {
          for (let index = 0; index < views.length; index += 1) {
            particles.shatter(views[index], index % 2 === 0);
            expect(particles.fragments.length).toBeLessThanOrEqual(CONFIG.particles.maxFragments);
          }
          expect(views.at(-1).children.length).toBeGreaterThan(0);
          expect(views.at(-1).userData.shattered).toBeUndefined();
          particles.burst(new THREE.Vector3(0, level.platforms.at(-1).y, 0), '#ffffff', particles.capacity * 3, 'complete');
          expect(particles.liveParticles).toBe(particles.capacity);
          expect(particles.activeCount).toBeLessThanOrEqual(particles.capacity + CONFIG.particles.maxFragments);

          if (levelNumber % 2 === 0) particles.update(10);
          particles.clear();
          particles.clear();
          expect(particles.activeCount).toBe(0);
          expect(particles.particles.every(particle => !particle.active)).toBe(true);
          expect(particles.fragmentPool.length).toBeLessThanOrEqual(CONFIG.particles.maxFragments);
          expect(particles.fragmentPool.every(fragment => fragment.piece === null)).toBe(true);
          for (const view of views) disposePlatform(view);
          expect([...geometryDisposals.values()]).toEqual(geometries.map(() => 1));
          expect([...materialDisposals.values()]).toEqual(materials.map(() => 1));
          expect(tower.children).toHaveLength(0);
        } finally {
          particles.clear();
          for (const view of views) disposePlatform(view);
          tower.removeFromParent();
        }
        expect(scene.children).toEqual([particles.mesh]);
      }
    } finally {
      particles.dispose();
    }
    expect(scene.children).toHaveLength(0);
    expect(particles.fragmentPool).toHaveLength(0);
    expect([...particleResources.values()]).toEqual([1, 1, 1]);
  });
});
