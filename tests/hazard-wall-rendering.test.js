import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createPlatform, disposePlatform, setPlatformPalette, updateHazardMaterials } from '../src/game/Platform.js';
import { DebugGeometry } from '../src/game/DebugGeometry.js';
import { getWallBounds } from '../src/game/WallCollisionResolver.js';
import { CONFIG } from '../src/game/config.js';
import { VISUAL_CONFIG } from '../src/game/VisualConfig.js';

const palette = { safe: '#43b4a5', safeSide: '#329684', hazard: '#e76a4c', hazardSide: '#a34339', hazardDetail: '#522b30' };
function fixture(type = 'low') {
  return { id: type, index: 0, y: -4.5, active: true, type: type === 'low' ? 'lowWall' : 'divider',
    baseRotation: .3, landingAngle: 2, segments: [{ kind: 'safe', start: 1, end: 4 }, { kind: 'hazard', start: 4, end: 5 }],
    walls: [{ type, angle: 2.4, height: type === 'low' ? .9 : 1.87, width: .12, innerRadius: .77, outerRadius: 2.81 }] };
}

describe('one restrained danger treatment for flat hazards and every wall', () => {
  it.each(['low', 'divider'])('uses shared hazard material and bevelled hazard-coloured geometry for %s', type => {
    const platform = fixture(type), view = createPlatform(platform, palette);
    const resources = view.userData.platformResources;
    try {
      const wall = resources.meshes.find(mesh => mesh.userData.wall);
      expect(wall.material).toBe(resources.lease.entry.hazard);
      expect(wall.material).toBe(resources.meshes.find(mesh => mesh.userData.surfaceKind === 'hazard').material);
      expect(wall.geometry).toBe(resources.lease.entry.wallGeometry);
      expect(wall.geometry.attributes.color).toBeDefined();
      wall.geometry.computeBoundingBox();
      const dimensions = wall.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(wall.scale);
      expect(dimensions.x).toBeCloseTo(platform.walls[0].width, 6);
      expect(dimensions.y).toBeCloseTo(platform.walls[0].height, 6);
      expect(dimensions.z).toBeCloseTo(platform.walls[0].outerRadius - platform.walls[0].innerRadius, 6);
      expect(new Set(wall.geometry.attributes.color.array).size).toBeGreaterThan(3);
      const cap = resources.meshes.find(mesh => mesh.name === 'Hazard wall top accent');
      expect(cap.material).toBe(resources.lease.entry.mark);
      const originalGeometry = wall.geometry;
      setPlatformPalette(view, { ...palette, hazard: '#ce5085' });
      expect(wall.material).toBe(resources.lease.entry.hazard);
      expect(wall.geometry).toBe(resources.lease.entry.wallGeometry);
      expect(wall.geometry).not.toBe(originalGeometry);
    } finally { disposePlatform(view); }
  });

  it('pulses shared walls and arcs together at .8 Hz with only .035–.100 emissive intensity', () => {
    const a = createPlatform(fixture(), palette), b = createPlatform(fixture('divider'), palette);
    try {
      const material = a.userData.platformResources.lease.entry.hazard;
      expect(b.userData.platformResources.lease.entry.hazard).toBe(material);
      expect(VISUAL_CONFIG.hazardPulseHz).toBe(.8);
      updateHazardMaterials(1 / (4 * VISUAL_CONFIG.hazardPulseHz));
      expect(material.emissiveIntensity).toBeCloseTo(.1, 12);
      updateHazardMaterials(3 / (4 * VISUAL_CONFIG.hazardPulseHz));
      expect(material.emissiveIntensity).toBeCloseTo(.035, 12);
    } finally { disposePlatform(a); disposePlatform(b); }
  });
});

describe('debug wall bounds and sphere are presentation only', () => {
  it('draws actual visible/effective boxes and the low-wall clearance plane from resolver bounds', () => {
    const platform = fixture(), tower = new THREE.Group(), view = createPlatform(platform, palette);
    tower.add(view);
    const overlay = new DebugGeometry({ platforms: [platform] }, new Map([[platform.id, view]]), tower);
    try {
      const record = overlay.wallRecords[0], bounds = getWallBounds(platform, platform.walls[0]);
      expect(record.bounds).toEqual(bounds);
      const effective = record.effective.geometry.attributes.position.array;
      const ys = Array.from(effective).filter((value, index) => index % 3 === 1);
      expect(Math.min(...ys)).toBeCloseTo(bounds.minY - platform.y, 6);
      expect(Math.max(...ys)).toBeCloseTo(bounds.maxY - platform.y, 6);
      const plane = record.clearance.geometry.attributes.position.array;
      Array.from(plane).filter((value, index) => index % 3 === 1)
        .forEach(y => expect(y).toBeCloseTo(bounds.maxY - platform.y, 6));
      expect(overlay.toggle('walls')).toBe(true);
      tower.rotation.y = 1.2;
      overlay.update(.5, .42);
      tower.updateMatrixWorld(true);
      const world = overlay.ballSphere.getWorldPosition(new THREE.Vector3());
      expect(world.x).toBeCloseTo(Math.cos(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius, 12);
      expect(world.y).toBe(.42);
      expect(world.z).toBeCloseTo(Math.sin(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius, 12);
      expect(record.visible.visible).toBe(true);
      platform.active = false;
      overlay.update(.6, .42);
      for (const mesh of record.meshes) expect(mesh.visible).toBe(false);
    } finally { overlay.dispose(); disposePlatform(view); }
  });

  it('disposes all optional guide resources once and leaves host data untouched', () => {
    const platform = fixture('divider'), before = structuredClone(platform);
    const tower = new THREE.Group(), view = createPlatform(platform, palette);
    tower.add(view);
    const overlay = new DebugGeometry({ platforms: [platform] }, new Map([[platform.id, view]]), tower);
    const spies = overlay.owned.map(mesh => [vi.spyOn(mesh.geometry, 'dispose'), vi.spyOn(mesh.material, 'dispose')]);
    overlay.toggle('walls');
    overlay.update(1, 2);
    overlay.dispose();
    overlay.dispose();
    for (const pair of spies) for (const spy of pair) expect(spy).toHaveBeenCalledOnce();
    expect(platform).toEqual(before);
    expect(overlay.wallRecords).toHaveLength(0);
    disposePlatform(view);
  });
});
