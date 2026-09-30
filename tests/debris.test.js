import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { CameraRig } from '../src/game/CameraRig.js';
import { createPrototypeLevel as createLevel } from '../src/game/PrototypeLevels.js';
import { createPlatform, disposePlatform } from '../src/game/Platform.js';
import { ParticleSystem } from '../src/game/ParticleSystem.js';

afterEach(() => vi.restoreAllMocks());

function fixture(rotation = 0, tuning = {}) {
  const scene = new THREE.Scene();
  const tower = new THREE.Group();
  // The axis need not be at the world origin: radial motion follows the tower.
  tower.position.set(0.3, 0, -0.4);
  tower.rotation.y = rotation;
  scene.add(tower);
  const particles = new ParticleSystem(scene);
  particles.tuning = { ...CONFIG.particles, ...tuning };
  const views = [];
  const level = createLevel(1);
  return {
    scene, tower, particles, views,
    add(data = level.platforms[0]) {
      const view = createPlatform({ ...data, y: 0 }, level.palette);
      views.push(view);
      tower.add(view);
      return view;
    },
    dispose() {
      particles.dispose();
      for (const view of views) disposePlatform(view);
    },
  };
}

function cameraAtTower() {
  const camera = new THREE.PerspectiveCamera(40, 0.5, 0.1, 140);
  camera.position.set(0, 8, 15);
  camera.lookAt(0, -1, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe('outward-clearing platform debris', () => {
  it('tints a few existing smash faces without changing a random draw, trajectory, lifetime or count', () => {
    const original = fixture(.4), painted = fixture(.4);
    const random = vi.spyOn(Math, 'random');
    const resetRandom = () => {
      let call = 0;
      random.mockReset().mockImplementation(() => ((++call * 37) % 997) / 997);
    };
    const motion = system => system.fragments.map(({ piece, ...record }) => ({ ...record,
      position: piece.position.toArray(), rotation: piece.rotation.toArray(), scale: piece.scale.toArray() }));
    try {
      const plainView = original.add(), paintView = painted.add(), untouched = painted.add();
      const untouchedColors = untouched.userData.platformResources.pieces.flatMap(piece => piece.children)
        .filter(mesh => mesh.userData.surfaceKind).map(mesh => [...mesh.geometry.attributes.color.array]);
      resetRandom();
      original.particles.shatter(plainView, true);
      const calls = random.mock.calls.length;
      resetRandom();
      painted.particles.shatter(paintView, true, ['#ffd52a', '#2478ed', '#db24e3']);
      expect(random.mock.calls).toHaveLength(calls);
      expect(motion(painted.particles)).toEqual(motion(original.particles));
      const accents = painted.particles.fragments.map(record => record.piece.userData.paintAccent).filter(Boolean);
      expect(accents.length).toBeLessThanOrEqual(4);
      expect(accents.length).toBeGreaterThan(1);
      expect(new Set(accents).size).toBeGreaterThan(1);
      expect(untouched.userData.platformResources.pieces.flatMap(piece => piece.children)
        .filter(mesh => mesh.userData.surfaceKind).map(mesh => [...mesh.geometry.attributes.color.array])).toEqual(untouchedColors);
      for (let frame = 0; frame < 120; frame++) {
        original.particles.update(1 / 120);
        painted.particles.update(1 / 120);
        expect(motion(painted.particles)).toEqual(motion(original.particles));
      }
      expect(painted.particles.liveParticles).toBe(0);
    } finally { original.dispose(); painted.dispose(); }
  });

  it.each([0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI * 0.7, Math.PI * 4.6])(
    'preserves detached world transforms and blasts outward at tower rotation %s',
    (rotation) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.37);
      const fx = fixture(rotation);
      try {
        const view = fx.add();
        view.updateWorldMatrix(true, true);
        const initial = new Map(view.children.map(piece => [piece, {
          position: piece.getWorldPosition(new THREE.Vector3()),
          quaternion: piece.getWorldQuaternion(new THREE.Quaternion()),
        }]));
        fx.particles.shatter(view);
        expect(view.children).toHaveLength(0);
        for (const fragment of fx.particles.fragments) {
          const before = initial.get(fragment.piece);
          const radial = before.position.clone().sub(fx.tower.position).setY(0).normalize();
          const outward = fragment.vx * radial.x + fragment.vz * radial.z;
          const tangent = -fragment.vx * radial.z + fragment.vz * radial.x;
          expect(outward).toBeGreaterThanOrEqual(CONFIG.particles.fragmentOutwardMin);
          expect(outward).toBeLessThanOrEqual(CONFIG.particles.fragmentOutwardMax);
          expect(Math.abs(tangent)).toBeLessThanOrEqual(CONFIG.particles.fragmentTangentialSpeed);
          expect(fragment.piece.quaternion.angleTo(before.quaternion)).toBeLessThan(1e-7);
          const expectedPosition = before.position.addScaledVector(radial, CONFIG.particles.fragmentSpawnOffset);
          expect(fragment.piece.position.distanceTo(expectedPosition)).toBeLessThan(1e-8);
          expect(fragment.life).toBeLessThanOrEqual(CONFIG.particles.fragmentLifetime);
        }
        // By 300 ms even the slowest normal fragment centre is outside the
        // platform's world radius. Camera projection is verified separately.
        fx.particles.update(0.3);
        for (const fragment of fx.particles.fragments) {
          const p = fragment.piece.position;
          expect(Math.hypot(p.x - fx.tower.position.x, p.z - fx.tower.position.z))
            .toBeGreaterThan(CONFIG.world.outerRadius);
        }
      } finally { fx.dispose(); }
    },
  );

  it('keeps the weakest smash impulse stronger than the strongest normal clear', () => {
    const fx = fixture();
    try {
      const random = vi.spyOn(Math, 'random').mockReturnValue(1 - Number.EPSILON);
      fx.particles.shatter(fx.add());
      const normalSpeed = Math.max(...fx.particles.fragments.map(f => Math.hypot(f.vx, f.vz)));
      fx.particles.clear();
      random.mockReturnValue(0);
      fx.particles.shatter(fx.add(), true);
      for (const fragment of fx.particles.fragments) {
        expect(Math.hypot(fragment.vx, fragment.vz)).toBeGreaterThan(normalSpeed);
        const p = fragment.piece.position;
        expect(fragment.vx * (p.x - fx.tower.position.x) + fragment.vz * (p.z - fx.tower.position.z))
          .toBeGreaterThan(0);
      }
    } finally { fx.dispose(); }
  });

  it('clears most complete chunks from the projected ball/column corridor in 150–300 ms', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.37);
    const camera = new THREE.PerspectiveCamera(40, 390 / 844, 0.1, 140);
    const rig = new CameraRig(camera);
    rig.resize(390, 844, { top: 47, bottom: 34 });
    rig.update(0, 0, true);
    const point = new THREE.Vector3();
    // The prototype column's maximum radius (.61) gives a screen corridor
    // wider than the ball. Full-ring clearance is intentionally a separate
    // criterion: front/back radial pieces cannot instantly escape that width.
    let corridor = 0;
    for (let degree = 0; degree < 360; degree += 1) {
      const angle = degree * Math.PI / 180;
      point.set(Math.cos(angle) * 0.61, 0, Math.sin(angle) * 0.61).project(camera);
      corridor = Math.max(corridor, Math.abs(point.x));
    }
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const matrix = new THREE.Matrix4();
    const measure = (previous) => {
      const counts = [0, 0];
      let total = 0;
      for (let rotation = 0; rotation < 12; rotation += 1) {
        const fx = fixture(rotation * Math.PI / 6, previous
          ? { fragmentOutwardMin: 1.1, fragmentOutwardMax: 2.1 }
          : {});
        fx.tower.position.set(0, 0, 0);
        try {
          fx.particles.shatter(fx.add());
          total += fx.particles.activeDebrisCount;
          for (let frame = 1; frame <= 36; frame += 1) {
            fx.particles.update(1 / 120);
            if (frame !== 18 && frame !== 36) continue;
            for (const fragment of fx.particles.fragments) {
              fragment.piece.updateWorldMatrix(true, true);
              let minX = Infinity;
              let maxX = -Infinity;
              for (const mesh of fragment.piece.children) {
                matrix.multiplyMatrices(viewProjection, mesh.matrixWorld);
                const positions = mesh.geometry.attributes.position;
                for (let vertex = 0; vertex < positions.count; vertex += 1) {
                  point.fromBufferAttribute(positions, vertex).applyMatrix4(matrix);
                  minX = Math.min(minX, point.x);
                  maxX = Math.max(maxX, point.x);
                }
              }
              // Requiring the whole projected mesh to clear is conservative;
              // it even counts back fragments hidden by the column as clutter.
              if (minX > corridor || maxX < -corridor) counts[frame === 18 ? 0 : 1] += 1;
            }
          }
        } finally { fx.dispose(); }
      }
      return counts.map(count => count / total);
    };
    const current = measure(false);
    const previous = measure(true);
    expect(current[0]).toBeGreaterThan(0.6);
    expect(current[1]).toBeGreaterThan(0.7);
    expect(current[0] - previous[0]).toBeGreaterThan(0.15);
    expect(current[1] - previous[1]).toBeGreaterThan(0.15);
  });

  it('uses six to ten coherent chunks for every authored ordinary platform', () => {
    for (const number of [1, 2, 3]) {
      const level = createLevel(number);
      for (const platform of level.platforms.filter(platform => !platform.finish)) {
        const view = createPlatform(platform, level.palette);
        try {
          expect(view.children.length).toBeGreaterThanOrEqual(6);
          expect(view.children.length).toBeLessThanOrEqual(CONFIG.particles.passFragmentCount);
          for (const piece of view.children) {
            expect(piece.userData.fragmentRadius).toBeGreaterThan(0);
            piece.traverse(child => {
              if (child.isMesh) {
                expect(child.castShadow).toBe(false);
                expect(child.receiveShadow).toBe(false);
              }
            });
          }
        } finally { disposePlatform(view); }
      }
    }
  });

  it.each([false, true])('caps each platform and immediately removes excess cosmetic chunks (smash %s)', (strong) => {
    const fx = fixture();
    try {
      const view = fx.add({ id: 900, baseRotation: 0, segments: Array.from({ length: 20 }, (_, i) => ({
        start: i * Math.PI / 10, end: (i + 1) * Math.PI / 10, kind: 'safe',
      })) });
      let disposed = 0;
      for (const geometry of view.userData.platformResources.geometries) {
        geometry.addEventListener('dispose', () => { disposed += 1; });
      }
      fx.particles.shatter(view, strong);
      const limit = strong ? CONFIG.particles.smashFragmentCount : CONFIG.particles.passFragmentCount;
      expect(fx.particles.activeDebrisCount).toBe(limit);
      expect(view.children).toHaveLength(0);
      expect(disposed).toBe(20 - limit);
      fx.particles.clear();
      disposePlatform(view);
      expect(disposed).toBe(20);
    } finally { fx.dispose(); }
  });

  it('suppresses new cosmetics when full without evicting visible debris or retaining platform meshes', () => {
    const fx = fixture(0, { maxFragments: 5 });
    try {
      fx.particles.shatter(fx.add());
      const visiblePieces = fx.particles.fragments.map(fragment => fragment.piece);
      const newest = fx.add();
      let disposed = 0;
      for (const geometry of newest.userData.platformResources.geometries) {
        geometry.addEventListener('dispose', () => { disposed += 1; });
      }
      fx.particles.shatter(newest, true);
      expect(fx.particles.activeDebrisCount).toBe(5);
      expect(fx.particles.fragments.map(fragment => fragment.piece)).toEqual(visiblePieces);
      expect(newest.children).toHaveLength(0);
      expect(disposed).toBe(newest.userData.platformResources.geometries.length);
      fx.particles.clear();
      fx.particles.shatter(fx.add());
      expect(fx.particles.fragmentPool).toHaveLength(0);
      expect(fx.particles.activeDebrisCount).toBe(5);
    } finally { fx.dispose(); }
  });

  it('recycles the oldest offscreen piece before reducing a new effect at capacity', () => {
    const fx = fixture(0, { maxFragments: 5 });
    try {
      fx.particles.shatter(fx.add());
      fx.particles.update(0, cameraAtTower());
      const oldest = fx.particles.fragments[0];
      const younger = fx.particles.fragments[1];
      const oldestPiece = oldest.piece;
      const youngerPiece = younger.piece;
      oldest.age = 0.5;
      younger.age = 0.25;
      oldest.piece.position.x = younger.piece.position.x = 100;
      fx.particles.tuning.passFragmentCount = 1;
      fx.particles.shatter(fx.add());
      expect(oldestPiece.parent).toBeNull();
      expect(youngerPiece.parent).toBe(fx.scene);
      expect(fx.particles.activeDebrisCount).toBe(5);
    } finally { fx.dispose(); }
  });

  it('removes offscreen fragments after a short grace, and expires visible ones at the hard lifetime', () => {
    const fx = fixture();
    try {
      fx.particles.shatter(fx.add());
      const offscreen = fx.particles.fragments[0];
      const piece = offscreen.piece;
      piece.position.x = 100;
      const count = fx.particles.activeDebrisCount;
      const camera = cameraAtTower();
      fx.particles.update(CONFIG.particles.fragmentOffscreenGrace / 2, camera);
      expect(fx.particles.activeDebrisCount).toBe(count);
      fx.particles.update(CONFIG.particles.fragmentOffscreenGrace / 2, camera);
      expect(fx.particles.activeDebrisCount).toBe(count - 1);
      expect(piece.parent).toBeNull();
      expect(offscreen.piece).toBeNull();
      fx.particles.update(CONFIG.particles.fragmentLifetime, camera);
      expect(fx.particles.activeDebrisCount).toBe(0);
      expect(fx.particles.fragmentPool.length).toBe(count);
    } finally { fx.dispose(); }
  });

  it('shortens only impact sparkle lifetimes while retaining death and confetti timing', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const fx = fixture();
    try {
      for (const kind of ['impact', 'death', 'complete']) {
        fx.particles.burst(new THREE.Vector3(), '#ffffff', 1, kind);
      }
      const [impact, death, complete] = fx.particles.particles;
      expect(impact.life).toBeCloseTo(CONFIG.particles.impactLifetime * 0.925);
      expect(death.life).toBeCloseTo(0.65 * 0.925);
      expect(complete.life).toBeCloseTo(1.8 * 0.925);
      expect(impact.life).toBeLessThan(death.life);
    } finally { fx.dispose(); }
  });
});
