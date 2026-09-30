import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { createPlatform, updatePlatformView, disposePlatform, setPlatformPalette } from '../src/game/Platform.js';
import { evaluatePlatformMotion, classifyPlatformAtTime } from '../src/game/PlatformMotion.js';
import { ParticleSystem } from '../src/game/ParticleSystem.js';

function breathing() {
  return { id: 'breather', index: 0, y: 0, baseRotation: 0, active: true, type: 'breathing',
    motion: { type: 'breathing', minWidth: Math.PI * 66 / 180, maxWidth: Math.PI * 112 / 180, period: 3, phase: 0 },
    segments: [{ kind: 'safe', start: .6, end: 2.8 }, { kind: 'hazard', start: 2.8, end: 3.5 }, { kind: 'safe', start: 3.5, end: Math.PI * 2 - .6 }], walls: [] };
}
const palette = { safe: '#43b4a5', safeSide: '#329684', hazard: '#e76a4c', hazardSide: '#a34339', hazardDetail: '#522b30' };

describe('authoritative obstacle rendering and resource ownership', () => {
  it('changes visible gap coverage with the collision state using the same geometry objects', () => {
    const platform = breathing();
    evaluatePlatformMotion(platform, 0);
    const view = createPlatform(platform, palette);
    const resources = view.userData.platformResources;
    const originalGeometries = [...resources.geometries];
    const ray = new THREE.Raycaster(new THREE.Vector3(Math.cos(.7) * 2.05, 2, Math.sin(.7) * 2.05), new THREE.Vector3(0, -1, 0));
    try {
      view.updateMatrixWorld(true);
      expect(classifyPlatformAtTime(platform, .7 - CONFIG.world.ballWorldAngle, 0)).toBe('safe');
      expect(ray.intersectObject(view, true).length).toBeGreaterThan(0);
      evaluatePlatformMotion(platform, 1.5);
      updatePlatformView(view, platform);
      view.updateMatrixWorld(true);
      expect(classifyPlatformAtTime(platform, .7 - CONFIG.world.ballWorldAngle, 1.5)).toBe('gap');
      expect(ray.intersectObject(view, true)).toHaveLength(0);
      for (let step = 0; step < 240; step++) {
        evaluatePlatformMotion(platform, step / 120);
        updatePlatformView(view, platform);
      }
      expect(resources.geometries).toEqual(originalGeometries);
      for (const geometry of originalGeometries) expect([...geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
    } finally { disposePlatform(view); }
  });

  it('freezes current breathing chunks at destruction and retains outward launch direction', () => {
    const scene = new THREE.Scene(), system = new ParticleSystem(scene), platform = breathing();
    evaluatePlatformMotion(platform, 0);
    const view = createPlatform(platform, palette);
    scene.add(view);
    evaluatePlatformMotion(platform, .63);
    updatePlatformView(view, platform);
    const buffers = view.userData.platformResources.geometries.map(geometry => [...geometry.attributes.position.array]);
    platform.active = false;
    system.shatter(view, true);
    try {
      evaluatePlatformMotion(platform, 5);
      updatePlatformView(view, platform);
      expect(platform.motionState.time).toBe(.63);
      expect(view.children).toHaveLength(0);
      expect(view.userData.platformResources.geometries.map(geometry => [...geometry.attributes.position.array])).toEqual(buffers);
      for (const fragment of system.fragments) expect(fragment.vx * fragment.piece.position.x + fragment.vz * fragment.piece.position.z).toBeGreaterThan(0);
    } finally { system.dispose(); disposePlatform(view); }
  });

  it('shares rib and wall geometry without disposing it with the first expired chunk', () => {
    const first = breathing(), second = breathing();
    first.type = second.type = 'lowWall';
    first.motion = second.motion = null;
    first.walls = second.walls = [{ type: 'low', angle: 1.9, height: .9, width: .12, innerRadius: .77, outerRadius: 2.81 }];
    const scene = new THREE.Scene(), system = new ParticleSystem(scene);
    const a = createPlatform(first, palette), b = createPlatform(second, palette);
    scene.add(a, b);
    const shared = a.userData.platformResources.lease.entry;
    const counts = { ribs: 0, walls: 0 };
    shared.ribGeometry.addEventListener('dispose', () => counts.ribs++);
    shared.wallGeometry.addEventListener('dispose', () => counts.walls++);
    try {
      expect(b.userData.platformResources.lease.entry).toBe(shared);
      const chunks = a.children.length;
      system.shatter(a);
      expect(system.activeDebrisCount).toBe(chunks);
      system.update(2);
      expect(counts).toEqual({ ribs: 0, walls: 0 });
      disposePlatform(a);
      expect(counts).toEqual({ ribs: 0, walls: 0 });
      const geometries = b.userData.platformResources.geometries;
      setPlatformPalette(b, { ...palette, safe: '#7a63c8' });
      expect(b.userData.platformResources.geometries).toBe(geometries);
      expect(counts).toEqual({ ribs: 1, walls: 1 });
    } finally { system.dispose(); disposePlatform(a); disposePlatform(b); }
  });
});
