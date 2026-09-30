import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { PaintMarkPool, PAINT_LIMITS, paintPointVisible, paintMaterial } from '../src/game/PaintMarkPool.js';
import { CosmeticEffectManager, COSMETIC_LIMITS } from '../src/game/CosmeticEffectManager.js';
import { createPlatform, disposePlatform, updatePlatformView } from '../src/game/Platform.js';
import { evaluatePlatformRenderMotion } from '../src/game/PlatformMotion.js';
import { classifySegmentsAtAngle } from '../src/game/HazardCollision.js';
import { SKIN_CATALOG, getSkinDefinition } from '../src/game/SkinCatalog.js';
import { ALL_PALETTES, colorSeparation } from '../src/game/PaletteManager.js';

const dual = { palette: ['#ffd52a', '#2478ed'], paint: 'dual', paintEvery: 1, paintSize: .56, paintOpacity: .74,
  bounce: 'paint', bounceCount: 5, pass: 'particles', passCount: 3, smash: 'particles', trail: 'dual', trailLifetime: .32 };
const angle = Math.PI / 8;

function fixture(extra = {}) {
  const scene = new THREE.Scene(), tower = new THREE.Group();
  scene.add(tower);
  const data = { id: 4, y: -3, active: true, type: 'static', baseRotation: 0,
    segments: [{ start: 0, end: Math.PI * 2, kind: 'safe' }], ...extra };
  const view = createPlatform(data);
  tower.add(view);
  const effects = new CosmeticEffectManager(scene);
  effects.setSkin({ id: 'duo-splash', effects: dual });
  const contact = new THREE.Vector3(Math.cos(angle) * CONFIG.world.ballOrbitRadius, data.y, Math.sin(angle) * CONFIG.world.ballOrbitRadius);
  return { scene, tower, data, view, effects, contact,
    add(profile = dual, at = angle) { return effects.paint.add(data, view, at, profile); },
    dispose() { effects.dispose(); disposePlatform(view); },
  };
}

function markVertices(pool, mark) {
  const positions = pool.mesh.geometry.attributes.position;
  return Array.from({ length: mark.blobs }, (_, blob) => Array.from({ length: positions.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mark.matrices[blob])));
}

function markDiameter(pool, mark) {
  const points = markVertices(pool, mark).flat();
  let diameter = 0;
  for (const first of points) for (const second of points) diameter = Math.max(diameter, first.distanceTo(second));
  return diameter;
}

describe('piece-local persistent paint', () => {
  it('binds an actual safe fragment without adding any collision or debris objects', () => {
    const fx = fixture();
    try {
      const before = JSON.stringify(fx.data), children = fx.view.children.slice();
      expect(fx.add()).toBe(true);
      const mark = fx.effects.paint.records.find(record => record.active);
      expect(mark.piece.parent).toBe(fx.view);
      expect(mark.piece.userData.kind).toBe('safe');
      expect(mark.localX + mark.piece.position.x).toBeCloseTo(fx.contact.x, 10);
      expect(mark.localZ + mark.piece.position.z).toBeCloseTo(fx.contact.z, 10);
      fx.effects.paint.update();
      expect(fx.view.children).toEqual(children);
      expect(JSON.stringify(fx.data)).toBe(before);
      expect(classifySegmentsAtAngle(fx.data.segments, angle)).toBe('safe');
    } finally { fx.dispose(); }
  });

  it.each(['static', 'orbit', 'stinger'])('follows the exact displayed %s piece and tower transform', type => {
    const fx = fixture(type === 'static' ? {} : { type, motion: { type, phase: .25, speed: .42 } });
    try {
      expect(fx.add()).toBe(true);
      const record = fx.effects.paint.records[0], actual = new THREE.Matrix4();
      const local = record.matrices[0].clone();
      for (const time of [0, .016, .1, 1.4, 8.2]) {
        fx.tower.position.set(.2, 4, -.7);
        fx.tower.rotation.y = time * .75;
        updatePlatformView(fx.view, fx.data, evaluatePlatformRenderMotion(fx.data, time));
        fx.effects.paint.update();
        fx.effects.paint.mesh.getMatrixAt(0, actual);
        const expected = new THREE.Matrix4().multiplyMatrices(record.piece.matrixWorld, local);
        for (let i = 0; i < 16; i++) expect(actual.elements[i]).toBeCloseTo(expected.elements[i], 5);
      }
      expect(record.matrices[0].equals(local)).toBe(true);
    } finally { fx.dispose(); }
  });

  it.each(['gap', 'hazard'])('never puts paint on a %s', kind => {
    const fx = fixture({ segments: kind === 'gap'
      ? [{ start: 1, end: 5, kind: 'safe' }]
      : [{ start: 0, end: Math.PI * 2, kind: 'hazard' }] });
    try { expect(fx.add()).toBe(false); expect(fx.effects.paintCount).toBe(0); }
    finally { fx.dispose(); }
  });

  it('keeps the full nominal edge splat and discards only pixels beyond the safe surface', () => {
    const fx = fixture({ segments: [{ start: 0, end: .8, kind: 'safe' }, { start: .8, end: 2, kind: 'hazard' }] });
    try {
      expect(fx.add(dual, .06)).toBe(true);
      const record = fx.effects.paint.records[0];
      expect(record.size).toBeCloseTo(dual.paintSize - PAINT_LIMITS.edgeClearance);
      const vertices = fx.effects.paint.mesh.geometry.attributes.position;
      const point = new THREE.Vector3();
      let visible = 0, clipped = 0;
      for (let blob = 0; blob < record.blobs; blob++) {
        for (let i = 0; i < vertices.count; i++) {
          point.fromBufferAttribute(vertices, i).applyMatrix4(record.matrices[blob]).add(record.piece.position);
          if (paintPointVisible(record, point.x, point.z)) {
            visible++;
            expect(classifySegmentsAtAngle(fx.data.segments, Math.atan2(point.z, point.x))).toBe('safe');
          } else clipped++;
        }
      }
      expect(visible).toBeGreaterThan(12);
      expect(clipped).toBeGreaterThan(12);
      expect(fx.add(dual, .001)).toBe(true);
      expect(fx.effects.paint.records.find(mark => mark.active).size).toBeCloseTo(dual.paintSize - PAINT_LIMITS.edgeClearance);
    } finally { fx.dispose(); }
  });

  it('keeps paint at an invisible chunk seam while attaching to the contacted chunk', () => {
    const fx = fixture();
    try {
      expect(fx.add(dual, Math.PI / 2)).toBe(true);
      const record = fx.effects.paint.records[0];
      expect(record.size).toBeCloseTo(dual.paintSize - PAINT_LIMITS.edgeClearance);
      expect(record.localX + record.piece.position.x).toBeCloseTo(0, 10);
      expect(record.localZ + record.piece.position.z).toBeCloseTo(CONFIG.world.ballOrbitRadius, 10);
    } finally { fx.dispose(); }
  });

  it('excludes the visible lethal wall footprint', () => {
    const fx = fixture({ walls: [{ type: 'low', angle, width: .16, innerRadius: 1.2, outerRadius: 2.6, height: .3 }] });
    try { expect(fx.add()).toBe(false); }
    finally { fx.dispose(); }
  });

  it('uses transient splash only on geometry-changing breathing platforms', () => {
    const fx = fixture({ type: 'breathing', motion: { type: 'breathing', minWidth: 1.2, maxWidth: 2, period: 3, phase: 0 } });
    try {
      expect(fx.effects.onLanding(fx.data, fx.view, 2, fx.contact)).toBe(false);
      expect(fx.effects.paintCount).toBe(0);
      expect(fx.effects.impactCount).toBe(5);
      for (let tick = 0; tick < 600; tick++) {
        updatePlatformView(fx.view, fx.data, evaluatePlatformRenderMotion(fx.data, tick / 120));
        fx.effects.update(1 / 120, fx.contact, 0, true);
      }
      expect(fx.effects.paintCount).toBe(0);
      expect(fx.effects.impactCount).toBe(0);
    } finally { fx.dispose(); }
  });

  it('caps marks at 64 and replaces the oldest while preserving the newest impact', () => {
    const fx = fixture(), second = fixture({ id: 5 });
    try {
      // Distinct contacts on two platforms exercise capacity independently of
      // the same-contact replacement rule. Neighbours are .32 world units apart.
      for (let i = 0; i < PAINT_LIMITS.marks + 8; i++) {
        const target = i < 40 ? fx : second;
        expect(fx.effects.paint.add(target.data, target.view, (i % 40) * Math.PI * 2 / 40, dual)).toBe(true);
      }
      expect(fx.effects.paintCount).toBe(64);
      expect(fx.effects.paint.records).toHaveLength(64);
      const serials = fx.effects.paint.records.map(record => record.serial).sort((a, b) => a - b);
      expect(serials).toEqual(Array.from({ length: 64 }, (_, i) => i + 9));
      expect(fx.effects.paint.mesh.count).toBe(192);
    } finally { fx.dispose(); second.dispose(); }
  });

  it('refreshes one mark through 100 stationary bounces while keeping every impact burst', () => {
    const fx = fixture();
    try {
      for (let index = 0; index < 100; index++) {
        fx.effects.clearTransient();
        expect(fx.effects.onLanding(fx.data, fx.view, angle, fx.contact)).toBe(true);
        expect(fx.effects.paintCount).toBe(1);
        expect(fx.effects.impactCount).toBe(dual.bounceCount);
      }
      expect(fx.effects.paint.records.filter(record => record.active)).toHaveLength(1);
      expect(fx.effects.paint.records[0].serial).toBe(100);
    } finally { fx.dispose(); }
  });

  it('replaces all near matches without removing a separate landing or platform', () => {
    const fx = fixture(), second = fixture({ id: 5 });
    try {
      // The two outer marks are >.18 apart, but both within .18 of the middle.
      expect(fx.add(dual, angle - .06)).toBe(true);
      expect(fx.add(dual, angle + .06)).toBe(true);
      expect(fx.add(dual, angle + .5)).toBe(true);
      expect(fx.effects.paint.add(second.data, second.view, angle, dual)).toBe(true);
      expect(fx.effects.paintCount).toBe(4);
      expect(fx.add(dual, angle)).toBe(true);
      expect(fx.effects.paintCount).toBe(3);
      expect(fx.effects.paint.records.filter(record => record.active).map(record => record.serial)).toEqual([5, 3, 4]);
      expect(fx.effects.paint.opacity.getX(PAINT_LIMITS.blobsPerMark)).toBe(0);
      expect(fx.effects.paint.records[3].platform).toBe(second.data);
      fx.effects.paint.clear();
      expect(fx.effects.paintCount).toBe(0);
    } finally { fx.dispose(); second.dispose(); }
  });

  it('finds a near match beyond a free slot and keeps neighbouring safe segments separate', () => {
    const fx = fixture({ segments: [
      { start: 0, end: 1, kind: 'safe' }, { start: 1, end: 1.01, kind: 'hazard' },
      { start: 1.01, end: 2, kind: 'safe' },
    ] });
    try {
      expect(fx.add(dual, .5)).toBe(true);
      expect(fx.add(dual, .965)).toBe(true);
      fx.effects.paint.remove(0);
      expect(fx.add(dual, .965)).toBe(true);
      expect(fx.effects.paintCount).toBe(1);
      expect(fx.effects.paint.records[1].serial).toBe(3);
      expect(fx.effects.paint.records[0].active).toBe(false);
      expect(fx.add(dual, 1.045)).toBe(true);
      expect(fx.effects.paintCount).toBe(2);
      const [first, second] = fx.effects.paint.records;
      expect(Math.hypot(first.platformX - second.platformX, first.platformZ - second.platformZ))
        .toBeLessThan(PAINT_LIMITS.replacementDistance);
      expect(first.segmentIndex).not.toBe(second.segmentIndex);
    } finally { fx.dispose(); }
  });

  it.each(['static', 'orbit', 'stinger'])('refreshes across an invisible %s chunk seam in platform coordinates', type => {
    const fx = fixture(type === 'static' ? {} : { type, motion: { type, phase: .25, speed: .42 } });
    try {
      const seam = fx.view.userData.platformResources.pieces[0].userData.arc.end;
      expect(fx.add(dual, seam - .02)).toBe(true);
      const originalPiece = fx.effects.paint.records[0].piece;
      fx.tower.rotation.y = 2.7;
      updatePlatformView(fx.view, fx.data, evaluatePlatformRenderMotion(fx.data, 2.4));
      expect(fx.add(dual, seam + .02)).toBe(true);
      const mark = fx.effects.paint.records[0];
      expect(fx.effects.paintCount).toBe(1);
      expect(mark.piece).not.toBe(originalPiece);
      expect(mark.platformX).toBeCloseTo(Math.cos(seam + .02) * CONFIG.world.ballOrbitRadius, 10);
      expect(mark.platformZ).toBeCloseTo(Math.sin(seam + .02) * CONFIG.world.ballOrbitRadius, 10);
      fx.effects.paint.update();
      const actual = new THREE.Matrix4();
      fx.effects.paint.mesh.getMatrixAt(0, actual);
      const expected = new THREE.Matrix4().multiplyMatrices(mark.piece.matrixWorld, mark.matrices[0]);
      actual.elements.forEach((value, index) => expect(value).toBeCloseTo(expected.elements[index], 5));
    } finally { fx.dispose(); }
  });

  it('replaces previous Gold at a Duo landing and clears the unused third gold lobe', () => {
    const fx = fixture();
    try {
      expect(fx.add(getSkinDefinition('auric-gold').effects)).toBe(true);
      expect(fx.effects.paint.records[0].blobs).toBe(3);
      expect(fx.add(getSkinDefinition('duo-splash').effects)).toBe(true);
      expect(fx.effects.paintCount).toBe(1);
      expect(fx.effects.paint.records[0].blobs).toBe(2);
      expect(fx.effects.paint.opacity.getX(2)).toBe(0);
      const colours = [0, 1].map(index => {
        const color = new THREE.Color(); fx.effects.paint.mesh.getColorAt(index, color); return `#${color.getHexString()}`;
      });
      expect(colours).toContain('#2478ed');
      for (const color of colours) {
        expect(Math.min(...getSkinDefinition('duo-splash').effects.palette.map(source => colorSeparation(color, source).hueDistance)))
          .toBeLessThan(3);
      }
    } finally { fx.dispose(); }
  });

  it('renders two distinct colours in one yellow/blue splash and cycles a multicolour palette', () => {
    const fx = fixture();
    try {
      expect(fx.add()).toBe(true);
      const first = new THREE.Color(), second = new THREE.Color();
      fx.effects.paint.mesh.getColorAt(0, first); fx.effects.paint.mesh.getColorAt(1, second);
      expect(first.equals(second)).toBe(false);
      const multi = { ...dual, paint: 'multi', palette: ['#e3cd46', '#4d84bc', '#b767aa', '#56ba92'] };
      expect(fx.add(multi, angle + .5)).toBe(true);
      expect(fx.effects.paint.records[1].blobs).toBe(3);
      const colours = [3, 4, 5].map(index => { const color = new THREE.Color(); fx.effects.paint.mesh.getColorAt(index, color); return color.getHexString(); });
      expect(new Set(colours).size).toBe(3);
    } finally { fx.dispose(); }
  });

  it.each(SKIN_CATALOG.filter(skin => skin.effects.paint))('$name paints a measured 1.5–2 ball diameters, including the lobe geometry', skin => {
    const fx = fixture();
    try {
      // Several deterministic orientations catch bounds that a nominal radius
      // test misses, including the exposed tips of the separate coloured lobes.
      for (let index = 0; index < 8; index++) {
        expect(fx.add(skin.effects)).toBe(true);
        const mark = fx.effects.paint.records[0];
        const diameterInBalls = markDiameter(fx.effects.paint, mark) / (2 * CONFIG.physics.ballRadius);
        expect(diameterInBalls).toBeGreaterThanOrEqual(skin.tier === 'premium' ? 1.85 : 1.5);
        expect(diameterInBalls).toBeLessThanOrEqual(2);
        const opacity = fx.effects.paint.opacity.getX(0);
        expect(opacity).toBeGreaterThanOrEqual(.69);
        expect(opacity).toBeLessThanOrEqual(PAINT_LIMITS.maximumOpacity + 1e-7);
      }
    } finally { fx.dispose(); }
  });

  it('leaves exposed colour on every lobe instead of covering one with the next', () => {
    const fx = fixture();
    try {
      for (const id of ['duo-splash', 'paint-burst', 'prism']) {
        fx.effects.paint.clear();
        expect(fx.add(getSkinDefinition(id).effects)).toBe(true);
        const mark = fx.effects.paint.records[0], lobes = markVertices(fx.effects.paint, mark);
        const centres = mark.matrices.slice(0, mark.blobs).map(matrix => new THREE.Vector3().setFromMatrixPosition(matrix));
        lobes.forEach((vertices, index) => {
          const exposed = vertices.filter(vertex => centres.every((centre, other) => other === index
            || vertex.distanceTo(centre) > mark.size * PAINT_LIMITS.lobeRadius));
          expect(exposed.length).toBeGreaterThan(8);
        });
      }
    } finally { fx.dispose(); }
  });

  it('keeps yellow and blue hue separation on every Soft and Vivid surface', () => {
    const fx = fixture();
    try {
      const yellow = new THREE.Color(), blue = new THREE.Color();
      for (const palette of ALL_PALETTES) {
        fx.effects.paint.clear();
        expect(fx.effects.paint.add(fx.data, fx.view, angle, getSkinDefinition('duo-splash').effects, palette.safe)).toBe(true);
        fx.effects.paint.mesh.getColorAt(0, yellow);
        fx.effects.paint.mesh.getColorAt(1, blue);
        const separation = colorSeparation(`#${yellow.getHexString()}`, `#${blue.getHexString()}`);
        expect(separation.hueDistance).toBeGreaterThan(135);
        expect(separation.minimumSaturation).toBeGreaterThan(.70);
      }
    } finally { fx.dispose(); }
  });

  it('clips large premium lobes against actual hazard edges, radial edges and visible walls', () => {
    const wall = { type: 'low', angle: .2, width: .16, innerRadius: 1.2, outerRadius: 2.6, height: .3 };
    const fx = fixture({ segments: [{ start: 0, end: 1, kind: 'safe' }, { start: 1, end: 4, kind: 'hazard' }], walls: [wall] });
    try {
      for (const at of [.38, .55, .90, .97]) {
        fx.effects.paint.clear();
        if (!fx.add(getSkinDefinition('auric-gold').effects, at)) continue;
        const mark = fx.effects.paint.records[0];
        expect(mark.size).toBeCloseTo(getSkinDefinition('auric-gold').effects.paintSize - PAINT_LIMITS.edgeClearance);
        for (const point of markVertices(fx.effects.paint, mark).flat()) {
          point.add(mark.piece.position);
          if (!paintPointVisible(mark, point.x, point.z)) continue;
          expect(classifySegmentsAtAngle(fx.data.segments, Math.atan2(point.z, point.x))).toBe('safe');
          const radial = Math.hypot(point.x, point.z);
          expect(radial).toBeGreaterThan(CONFIG.world.innerRadius + PAINT_LIMITS.edgeClearance - 1e-6);
          expect(radial).toBeLessThan(CONFIG.world.outerRadius - PAINT_LIMITS.edgeClearance + 1e-6);
          const along = point.x * Math.cos(wall.angle) + point.z * Math.sin(wall.angle);
          const across = -point.x * Math.sin(wall.angle) + point.z * Math.cos(wall.angle);
          const dx = Math.max(wall.innerRadius - along, along - wall.outerRadius, 0);
          const dz = Math.max(Math.abs(across) - wall.width / 2, 0);
          expect(Math.hypot(dx, dz)).toBeGreaterThan(PAINT_LIMITS.edgeClearance - 1e-6);
        }
      }
    } finally { fx.dispose(); }
  });

  it.each(['explicit', 'inactive', 'shattered', 'detached'])('removes marks when their parent is destroyed (%s)', reason => {
    const fx = fixture();
    try {
      fx.add();
      if (reason === 'explicit') fx.effects.clearPlatform(fx.data.id);
      if (reason === 'inactive') fx.data.active = false;
      if (reason === 'shattered') fx.view.userData.shattered = true;
      if (reason === 'detached') fx.effects.paint.records[0].piece.removeFromParent();
      fx.effects.paint.update();
      expect(fx.effects.paintCount).toBe(0);
      expect(fx.effects.paint.records.every(record => record.piece === null)).toBe(true);
    } finally { fx.dispose(); }
  });

  it('provides bounded debug lines from the piece pivot to the local attachment', () => {
    const fx = fixture();
    try {
      fx.effects.setAttachmentDebug(true);
      const lines = fx.effects.paint.debugLines;
      fx.add(); fx.effects.paint.update();
      expect(lines.geometry.drawRange.count).toBe(2);
      fx.effects.setAttachmentDebug(false); fx.effects.setAttachmentDebug(true);
      expect(fx.effects.paint.debugLines).toBe(lines);
      fx.effects.clear(); expect(lines.geometry.drawRange.count).toBe(0);
    } finally { fx.dispose(); }
  });
});

describe('bounded cosmetic trails and impacts', () => {
  it('samples only displayed positions and never the next simulation pose', () => {
    const fx = fixture();
    try {
      const position = new THREE.Vector3(0, 2, 2.05);
      fx.effects.update(.008, position, -18.4, true);
      position.y = 1.4;
      fx.effects.update(.06, position, -18.4, true);
      expect(fx.effects.trailCount).toBe(4);
      for (const record of fx.effects.trails.records.filter(record => record.active)) {
        expect(record.y).toBeGreaterThanOrEqual(1.4);
        expect(record.y).toBeLessThanOrEqual(2);
      }
    } finally { fx.dispose(); }
  });

  it('caps all independent effect pools and rate-limits pass bursts without any scoring dependency', () => {
    const fx = fixture();
    try {
      for (let i = 0; i < 1000; i++) { fx.effects.spawnTrail(fx.contact); fx.effects.burst(fx.contact, 8, 'ring'); }
      expect(fx.effects.trailCount).toBe(COSMETIC_LIMITS.trailParticles);
      expect(fx.effects.impactCount).toBe(48);
      fx.effects.clearTransient();
      expect(fx.effects.onPass(fx.contact)).toBe(true);
      expect(fx.effects.onPass(fx.contact)).toBe(false);
      expect(fx.effects.impactCount).toBe(3);
      fx.effects.update(.125, fx.contact, 0, true);
      expect(fx.effects.onPass(fx.contact)).toBe(true);
    } finally { fx.dispose(); }
  });

  it.each(['explicit', 'teleport', 'long-frame', 'death', 'equip', 'inactive'])('clears trails across %s discontinuities', reason => {
    const fx = fixture();
    try {
      fx.effects.update(.01, fx.contact, -12, true);
      fx.effects.spawnTrail(fx.contact);
      if (reason === 'explicit') fx.effects.clearTransient();
      if (reason === 'teleport') fx.effects.update(.01, fx.contact.clone().addScalar(10), -12, true);
      if (reason === 'long-frame') fx.effects.update(2, fx.contact, -12, true);
      if (reason === 'death') fx.effects.onDeath();
      if (reason === 'equip') fx.effects.setSkin({ id: 'classic' });
      if (reason === 'inactive') fx.effects.update(.01, fx.contact, -12, false);
      expect(fx.effects.trailCount).toBe(0);
    } finally { fx.dispose(); }
  });

  it('preserves old paint when equipping but suppresses new marks after death', () => {
    const fx = fixture();
    try {
      fx.effects.onLanding(fx.data, fx.view, angle, fx.contact);
      expect(fx.effects.paintCount).toBe(1);
      fx.effects.setSkin({ id: 'new-paint', effects: dual });
      expect(fx.effects.paintCount).toBe(1);
      fx.effects.onDeath();
      expect(fx.effects.onLanding(fx.data, fx.view, angle, fx.contact)).toBe(false);
      expect(fx.effects.paintCount).toBe(1);
      fx.effects.clear();
      expect(fx.effects.onLanding(fx.data, fx.view, angle, fx.contact)).toBe(true);
    } finally { fx.dispose(); }
  });

  it('preserves all physics and score input while reusing resources through repeated retry/transition clears', () => {
    const fx = fixture();
    const beforeConfig = JSON.stringify(CONFIG), beforePlatform = JSON.stringify(fx.data);
    const score = Object.freeze({ pointsBalance: 501, currentNoDeathScore: 207 });
    try {
      const pools = [fx.effects.trails, fx.effects.impacts, fx.effects.rings, fx.effects.smashPaint];
      const records = pools.map(pool => pool.records), meshes = pools.map(pool => pool.mesh);
      const geometries = meshes.map(mesh => mesh.geometry), materials = meshes.map(mesh => mesh.material);
      for (let level = 0; level < 80; level++) {
        fx.effects.onLanding(fx.data, fx.view, angle, fx.contact);
        fx.effects.spawnTrail(fx.contact);
        fx.effects.update(1 / 120, fx.contact, -18.4, true);
        fx.effects.clear();
        expect(fx.effects.paintCount + fx.effects.trailCount + fx.effects.impactCount).toBe(0);
      }
      pools.forEach((pool, index) => {
        expect(pool.records).toBe(records[index]);
        expect(pool.mesh).toBe(meshes[index]);
        expect(pool.mesh.geometry).toBe(geometries[index]);
        expect(pool.mesh.material).toBe(materials[index]);
        expect(pool.mesh.castShadow || pool.mesh.receiveShadow).toBe(false);
      });
      expect(JSON.stringify(CONFIG)).toBe(beforeConfig);
      expect(JSON.stringify(fx.data)).toBe(beforePlatform);
      expect(score).toEqual({ pointsBalance: 501, currentNoDeathScore: 207 });
    } finally { fx.dispose(); }
  });

  it('releases every pool mesh, geometry and material exactly once', () => {
    const fx = fixture();
    fx.effects.setAttachmentDebug(true);
    const resources = [fx.effects.paint.mesh, fx.effects.trails.mesh, fx.effects.impacts.mesh, fx.effects.rings.mesh, fx.effects.smashPaint.mesh]
      .flatMap(mesh => [mesh, mesh.geometry, mesh.material]);
    resources.push(fx.effects.paint.debugLines.geometry, fx.effects.paint.debugLines.material);
    const counts = resources.map(() => 0);
    resources.forEach((resource, index) => resource.addEventListener('dispose', () => counts[index]++));
    fx.effects.dispose(); fx.effects.dispose();
    expect(counts.every(count => count === 1)).toBe(true);
    expect(fx.scene.children).toEqual([fx.tower]);
    disposePlatform(fx.view);
  });
});

describe('Phase 4 full-size clipping and smash paint', () => {
  it('keeps identical nominal geometry and pooled attributes through central, edge and near-wall contacts', () => {
    const wall = { angle: .2, width: .12, innerRadius: 1.2, outerRadius: 2.6, height: .3 };
    const fx = fixture({ segments: [{ start: 0, end: 1.2, kind: 'safe' }, { start: 1.2, end: 3, kind: 'hazard' }], walls: [wall] });
    try {
      const pool = fx.effects.paint, geometry = pool.mesh.geometry;
      const attributes = { ...geometry.attributes };
      for (const at of [.6, .001, .08, .24, 1.199]) {
        pool.clear();
        expect(fx.add(dual, at)).toBe(true);
        const mark = pool.records[0];
        expect(mark.size).toBeCloseTo(dual.paintSize - PAINT_LIMITS.edgeClearance);
        expect(markDiameter(pool, mark)).toBeGreaterThan(.9);
        expect(pool.mesh.geometry).toBe(geometry);
        for (const [key, attribute] of Object.entries(attributes)) expect(geometry.attributes[key]).toBe(attribute);
      }
    } finally { fx.dispose(); }
  });

  it('uses the same platform-space vertex coordinates for shader masks and attached piece matrices', () => {
    const fx = fixture();
    try {
      fx.add();
      const pool = fx.effects.paint, mark = pool.records[0], source = pool.mesh.geometry.attributes.position;
      const point = new THREE.Vector3();
      for (let blob = 0; blob < mark.blobs; blob++) {
        const px = pool.pose.getX(blob), pz = pool.pose.getY(blob), c = pool.pose.getZ(blob), s = pool.pose.getW(blob);
        for (let vertex = 0; vertex < source.count; vertex++) {
          point.fromBufferAttribute(source, vertex).applyMatrix4(mark.matrices[blob]).add(mark.piece.position);
          expect(c * source.getX(vertex) + s * source.getZ(vertex) + px).toBeCloseTo(point.x, 5);
          expect(-s * source.getX(vertex) + c * source.getZ(vertex) + pz).toBeCloseTo(point.z, 5);
        }
      }
      const shader = { vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
        fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n}' };
      const material = paintMaterial();
      material.onBeforeCompile(shader);
      expect(shader.vertexShader).toContain('attribute vec4 paintPose');
      expect(shader.vertexShader).toContain('vPaintPosition = vec2');
      expect(shader.fragmentShader).toContain('delta > vPaintRegion.y');
      expect(shader.fragmentShader).toContain('paintRadius <');
      expect(shader.fragmentShader.match(/insidePaintWall\(vPaintPosition/g)).toHaveLength(PAINT_LIMITS.clippingWalls);
      material.dispose();
    } finally { fx.dispose(); }
  });

  it.each([[0, .8, .001], [6, 7, .01], [.8, 5.9, .801]])('masks wrapped and wide safe sectors %s–%s without gap pixels', (start, end, at) => {
    const fx = fixture({ segments: [{ start, end, kind: 'safe' }] });
    try {
      expect(fx.add(dual, at)).toBe(true);
      const mark = fx.effects.paint.records[0];
      let visible = 0;
      for (let x = -3; x <= 3; x += .047) for (let z = -3; z <= 3; z += .047) {
        if (!paintPointVisible(mark, x, z)) continue;
        visible++;
        expect(classifySegmentsAtAngle(fx.data.segments, Math.atan2(z, x))).toBe('safe');
        expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(CONFIG.world.innerRadius + PAINT_LIMITS.edgeClearance);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(CONFIG.world.outerRadius - PAINT_LIMITS.edgeClearance);
      }
      expect(visible).toBeGreaterThan(100);
    } finally { fx.dispose(); }
  });

  it.each(SKIN_CATALOG.filter(skin => skin.effects.paint))('$name produces a separated full-size smash burst and no persistent destroyed decal', skin => {
    const fx = fixture();
    try {
      fx.effects.setSkin(skin);
      fx.add(skin.effects);
      fx.effects.clearPlatform(fx.data.id);
      fx.data.active = false;
      fx.view.userData.shattered = true;
      const result = fx.effects.onSmash(fx.contact);
      const expected = skin.tier === 'premium' || skin.id === 'paint-burst' ? 1.8 : 1.55;
      expect(result.scale).toBe(expected);
      expect(result.radius).toBeCloseTo((skin.effects.paintSize - PAINT_LIMITS.edgeClearance) * expected);
      expect(fx.effects.paintCount).toBe(0);
      expect(fx.effects.smashPaint.count).toBe(Math.min(3, skin.effects.palette.length));
      const colors = [];
      const color = new THREE.Color();
      fx.effects.smashPaint.records.forEach((record, index) => {
        if (!record.active) return;
        expect(record.y).toBeGreaterThan(fx.contact.y);
        expect(record.y).toBeLessThan(fx.contact.y + .03);
        expect(record.life).toBe(COSMETIC_LIMITS.smashPaintLifetime);
        fx.effects.smashPaint.mesh.getColorAt(index, color);
        colors.push(`#${color.getHexString()}`);
      });
      expect(new Set(colors).size).toBe(result.lobes);
      for (const color of colors) expect(skin.effects.palette).toContain(color);
      const droplets = fx.effects.impacts.records.filter(record => record.active);
      expect(droplets.length).toBeGreaterThan(skin.effects.bounceCount);
      for (const droplet of droplets) {
        expect(droplet.x).toBe(fx.contact.x);
        expect(droplet.z).toBe(fx.contact.z);
        expect(droplet.size).toBeCloseTo(.044 * expected);
        expect(Math.hypot(droplet.vx, droplet.vz)).toBeCloseTo(1.65 * expected);
      }
      for (let frame = 0; frame < 50; frame++) fx.effects.update(1 / 120, fx.contact, 0, true);
      expect(fx.effects.impactCount).toBe(0);
    } finally { fx.dispose(); }
  });

  it('preserves all existing caps and immediately clears the bounded transient smash pool', () => {
    const fx = fixture();
    try {
      for (let burst = 0; burst < 100; burst++) fx.effects.onSmash(fx.contact);
      expect(fx.effects.smashPaint.count).toBe(COSMETIC_LIMITS.smashPaintLobes);
      expect(fx.effects.impacts.count).toBe(COSMETIC_LIMITS.impactParticles);
      expect(fx.effects.paint.records).toHaveLength(64);
      expect(fx.effects.paint.mesh.count).toBe(192);
      expect(fx.effects.trails.capacity).toBe(36);
      expect(fx.effects.rings.capacity).toBe(4);
      fx.effects.clear();
      expect(fx.effects.impactCount).toBe(0);
      expect(fx.effects.smashPaint.mesh.visible).toBe(false);
    } finally { fx.dispose(); }
  });

  it.each(SKIN_CATALOG.filter(skin => !skin.effects.paint))('$name retains ordinary smash accents without paint', skin => {
    const fx = fixture();
    try {
      fx.effects.setSkin(skin);
      expect(fx.effects.onSmash(fx.contact)).toBeNull();
      expect(fx.effects.smashPaint.count).toBe(0);
      expect(fx.effects.paintCount).toBe(0);
      expect(fx.effects.impacts.count).toBe(Math.min(8, skin.effects.bounceCount));
    } finally { fx.dispose(); }
  });
});
