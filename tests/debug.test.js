import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DebugGeometry } from '../src/game/DebugGeometry.js';
import { Game } from '../src/game/Game.js';
import { effectiveHazardArc } from '../src/game/HazardCollision.js';
import { evaluatePlatformMotion } from '../src/game/PlatformMotion.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { Simulation } from '../src/game/Simulation.js';
import { createPrototypeLevel } from '../src/game/PrototypeLevels.js';
import { CONFIG } from '../src/game/config.js';

afterEach(() => vi.unstubAllGlobals());

function geometryFixture(segments, motion = undefined) {
  const platform = { id: 'platform', index: 0, y: 0, active: true, baseRotation: .6,
    type: motion?.type || 'static', segments, motion, landingAngle: 1,
    route: { angle: .6, halfWidth: .4 } };
  const finish = { id: 'finish', index: 1, y: -2.25, active: true, finish: true,
    route: { angle: .6, halfWidth: .4 }, segments: [] };
  const level = { platforms: [platform, finish] };
  const view = new THREE.Group();
  const tower = new THREE.Group();
  tower.add(view);
  const overlay = new DebugGeometry(level, new Map([[platform.id, view]]), tower);
  return { overlay, platform, level, view, tower };
}

describe('debug geometry matches real collision and releases its resources', () => {
  it.each([
    { kind: 'hazard', start: 1, end: 2 },
    { kind: 'hazard', start: 6, end: .3 },
    { kind: 'hazard', start: 0, end: Math.PI * 2 },
  ])('draws effective boundaries for hazard $start → $end', segment => {
    const { overlay } = geometryFixture([segment]);
    const positions = overlay.platformRecords[0].edge.geometry.attributes.position.array;
    const effective = effectiveHazardArc(segment);
    const angles = [segment.start, segment.end, effective.start, effective.end];
    angles.forEach((angle, index) => {
      expect(positions[index * 6]).toBeCloseTo(Math.cos(angle) * CONFIG.world.innerRadius, 6);
      expect(positions[index * 6 + 2]).toBeCloseTo(Math.sin(angle) * CONFIG.world.innerRadius, 6);
    });
    overlay.dispose();
  });

  it('keeps motion edges in the existing position buffer and hides destroyed hosts', () => {
    const fixture = geometryFixture([{ kind: 'hazard', start: .7, end: 5.6 }],
      { type: 'breathing', minWidth: 1.4, maxWidth: 2.2, period: 3, phase: 0 });
    const { overlay, platform } = fixture;
    const edge = overlay.platformRecords[0].edge;
    const buffer = edge.geometry.attributes.position;
    const array = buffer.array;
    const original = Array.from(array);
    expect(overlay.toggle('hazards')).toBe(true);
    evaluatePlatformMotion(platform, 1.5);
    overlay.update();
    expect(edge.geometry.attributes.position).toBe(buffer);
    expect(buffer.array).toBe(array);
    expect(Array.from(array)).not.toEqual(original);
    platform.active = false;
    overlay.update();
    expect(edge.visible).toBe(false);
    overlay.dispose();
  });

  it('keeps drop guides inside the narrowest platform corridor', () => {
    const platforms = [.5, .3, .4, .6].map((halfWidth, index) => ({
      id: String(index), index, y: -index * 2.25, active: true, finish: index === 3,
      segments: [], route: { angle: 1, halfWidth },
    }));
    const tower = new THREE.Group();
    const views = new Map(platforms.map(platform => [platform.id, new THREE.Group()]));
    const overlay = new DebugGeometry({ platforms, plannedDrops: [{ start: 0, passes: 3, catchIndex: 3, angle: 1 }] }, views, tower);
    const positions = overlay.groups.drops.children[0].geometry.attributes.position.array;
    expect(Math.atan2(positions[2], positions[0])).toBeCloseTo(.7, 6);
    expect(Math.atan2(positions[8], positions[6])).toBeCloseTo(1.3, 6);
    overlay.dispose();
  });

  it('disposes each owned geometry and material exactly once without touching host data', () => {
    const { overlay, platform, view, tower } = geometryFixture([{ kind: 'safe', start: 0, end: 2 }]);
    const before = structuredClone(platform);
    const resources = overlay.owned.map(mesh => ({
      mesh, geometry: vi.spyOn(mesh.geometry, 'dispose'), material: vi.spyOn(mesh.material, 'dispose'),
    }));
    expect(overlay.toggle('footprint')).toBe(true);
    expect(overlay.toggle('missing')).toBe(false);
    overlay.dispose();
    overlay.dispose();
    for (const resource of resources) {
      expect(resource.geometry).toHaveBeenCalledOnce();
      expect(resource.material).toHaveBeenCalledOnce();
      expect(resource.mesh.parent).toBeNull();
    }
    expect(platform).toEqual(before);
    expect(view.children).toHaveLength(0);
    expect(tower.children).toEqual([view]);
  });
});

function controlsFixture(debugEnabled = true) {
  const controls = { addEventListener: vi.fn() };
  const guide = { setAttribute: vi.fn(), hidden: true };
  vi.stubGlobal('document', { createElement: () => guide });
  const game = {
    debugEnabled,
    element: { append: vi.fn(), querySelector: () => ({ value: '70' }) },
    ui: { debug: { addEventListener: vi.fn() }, 'debug-controls': controls, 'debug-info': {} },
    input: { invalidateGesture: vi.fn(), blockPointer: vi.fn() },
    simulation: new Simulation({ debugEnabled, levelFactory: createPrototypeLevel }),
    debugText: () => 'updated',
  };
  Game.prototype.setupDebug.call(game);
  return game;
}

describe('debug controls cannot leak comparison settings into normal play', () => {
  it('creates no controls, guide or handlers for a non-debug game', () => {
    const game = controlsFixture(false);
    expect(game.element.append).not.toHaveBeenCalled();
    expect(game.ui['debug-controls'].addEventListener).not.toHaveBeenCalled();
    expect(game.onDebugChange).toBeUndefined();
    expect(game.simulation.maxDownwardSpeed).toBe(18.4);
  });

  it('invalidates the current gesture before switching terminal speed and never writes a save', () => {
    const game = controlsFixture();
    const save = new SaveManager(null);
    const before = save.save({ levelNumber: 71, muted: true, paletteStyle: 'mixed', sensitivityMultiplier: 2 });
    game.settings = { ...before };
    game.save = save;
    const saveSpy = vi.spyOn(save, 'save');
    game.onDebugChange({ target: { id: 'debug-speed', value: '100' } });
    expect(game.input.invalidateGesture).toHaveBeenCalledOnce();
    expect(game.simulation.maxDownwardSpeed).toBe(23);
    expect(game.ui['debug-info'].textContent).toBe('updated');
    expect(game.settings).toEqual(before);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(save.load()).toEqual(before);
    expect(save.save({ terminalSpeedPercent: 100, debugTerminalSpeed: 23 })).toEqual(before);
    expect(new Simulation({ levelFactory: createPrototypeLevel }).maxDownwardSpeed).toBe(18.4);
  });

  it('previews a level only in debug mode and consumes debug pointers', () => {
    const game = controlsFixture();
    const event = { pointerId: 8, stopPropagation: vi.fn() };
    game.onDebugPointer(event);
    expect(game.input.blockPointer).toHaveBeenCalledWith(8);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(Game.prototype.loadDebugLevel.call(game, 70)).toBe(true);
    expect(game.debugBrowsing).toBe(true);
    expect(game.simulation.levelNumber).toBe(70);
    game.debugEnabled = false;
    expect(Game.prototype.loadDebugLevel.call(game, 80)).toBe(false);
    expect(game.simulation.levelNumber).toBe(70);
  });
});
