import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { CameraRig } from '../src/game/CameraRig.js';
import { createGameplayRect } from '../src/game/Viewport.js';
import { Simulation, STATES } from '../src/game/Simulation.js';

const viewports = [
  { width: 320, height: 568, top: 0, bottom: 0 },
  { width: 375, height: 667, top: 20, bottom: 0 },
  { width: 390, height: 844, top: 47, bottom: 34 },
  { width: 393, height: 852, top: 59, bottom: 34 },
  { width: 768, height: 1024, top: 24, bottom: 20 },
  { width: 820, height: 1180, top: 24, bottom: 20 },
];

function cameraAt(viewport, anchorY = 0) {
  const camera = new THREE.PerspectiveCamera(CONFIG.camera.fieldOfView, 1, .1, 140);
  const rig = new CameraRig(camera);
  rig.resize(viewport.width, viewport.height, viewport);
  rig.update(anchorY, 0, true);
  camera.updateMatrixWorld(true);
  return { camera, rig };
}

function screenPoint(camera, x, y, z) {
  camera.updateMatrixWorld(true);
  const projected = new THREE.Vector3(x, y, z).project(camera);
  return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
}

function ballPoint(camera, anchorY = 0, rise = 0) {
  return screenPoint(camera,
    Math.cos(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius,
    anchorY + CONFIG.physics.ballRadius + rise,
    Math.sin(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius);
}

function contactPoint(camera, anchorY = 0) {
  return screenPoint(camera, 0, anchorY, CONFIG.world.ballOrbitRadius);
}

describe('proportional physical-contact composition', () => {
  it('retains FOV, target, framing distance and follow response with roughly three degrees more pitch', () => {
    expect(CONFIG.camera.fieldOfView).toBe(40);
    expect(CONFIG.camera.distance).toBe(13.8);
    expect(CONFIG.camera.height).toBe(7.8);
    expect(CONFIG.camera.targetOffset).toBe(-1);
    expect(CONFIG.camera.followResponse).toBe(6);
    expect(CONFIG.camera.contactScreenAnchor).toBe(.43);
    const { rig } = cameraAt(viewports[2]);
    expect(CONFIG.camera.pitchDegrees).toBe(35.5);
    expect(THREE.MathUtils.radToDeg(rig.pitch - rig.baselinePitch)).toBeGreaterThan(2.9);
    expect(THREE.MathUtils.radToDeg(rig.pitch - rig.baselinePitch)).toBeLessThan(3.1);
    expect(rig.camera.position.distanceTo(rig.target)).toBeCloseTo(Math.hypot(13.8, 8.8) * rig.frameScale, 10);
  });

  it.each(viewports)('places physical contact at 43% of the usable visual rectangle at $width × $height', viewport => {
    const { camera, rig } = cameraAt(viewport);
    const current = contactPoint(camera);
    const rect = createGameplayRect(viewport.width, viewport.height, viewport);
    expect((current.y * viewport.height - rect.y) / rect.height).toBeCloseTo(.43, 10);
    expect(rig.projectContactY()).toBeCloseTo(current.y, 10);
    expect(current.x).toBeCloseTo(.5, 10);
    expect(ballPoint(camera).y).toBeLessThan(current.y);
  });

  it.each(viewports)('keeps the full ring inside side margins and the bounce below the level UI at $width × $height', viewport => {
    const { camera } = cameraAt(viewport);
    // The tallest rendered bounce is a conservative analytic upper bound;
    // the semi-implicit fixed-step simulation rises slightly less than this.
    const rise = CONFIG.physics.bounceVelocity ** 2 / (2 * CONFIG.physics.bounceGravity);
    const apexTop = ballPoint(camera, 0, rise + CONFIG.physics.ballRadius).y * viewport.height;
    const progressBottom = (viewport.height <= 700 ? 145 : 171) + viewport.top + 3;
    expect(apexTop).toBeGreaterThan(progressBottom + 12);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 60) {
      const point = screenPoint(camera, Math.cos(angle) * CONFIG.world.outerRadius,
        0, Math.sin(angle) * CONFIG.world.outerRadius);
      expect(point.x).toBeGreaterThan(.1);
      expect(point.x).toBeLessThan(.9);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(1);
    }
  });

  it('keeps composition stable over long towers, resizing and retry or level resets', () => {
    const { camera, rig } = cameraAt(viewports[2]);
    const baseline = ballPoint(camera);
    for (const anchorY of [-2.25, -50, -108, 0]) {
      rig.update(anchorY, 0, true);
      expect(ballPoint(camera, anchorY).y).toBeCloseTo(baseline.y, 10);
      rig.resize(viewports[2].width, viewports[2].height, viewports[2]);
      expect(ballPoint(camera, anchorY).y).toBeCloseTo(baseline.y, 10);
    }
  });

  it('provides current world and inverse matrices before rendering or debris culling', () => {
    const { camera, rig } = cameraAt(viewports[2]);
    const reference = new THREE.Vector3(0, CONFIG.physics.ballRadius, CONFIG.world.ballOrbitRadius);
    const baseline = reference.clone().project(camera);
    rig.update(-27, 0, true, .04);
    // Read directly: no renderer or helper is allowed to repair stale matrices.
    const translation = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    expect(translation.toArray()).toEqual(camera.position.toArray());
    const inverse = camera.matrixWorld.clone().invert();
    expect(camera.matrixWorldInverse.elements).toEqual(inverse.elements);
    rig.update(-27, 0, true);
    const projected = reference.clone().add(new THREE.Vector3(0, -27, 0)).project(camera);
    expect(projected.x).toBeCloseTo(baseline.x, 10);
    expect(projected.y).toBeCloseTo(baseline.y, 10);
  });

  it('follows the stable floor anchor without bounce bobbing and independent of render rate', () => {
    const a = cameraAt(viewports[2]);
    const b = cameraAt(viewports[2]);
    const initial = a.camera.position.clone();
    for (let frame = 0; frame < 120; frame++) a.rig.update(0, 1 / 120);
    expect(a.camera.position.toArray()).toEqual(initial.toArray());
    for (let frame = 0; frame < 60; frame++) a.rig.update(-2.25, 1 / 60);
    for (let frame = 0; frame < 120; frame++) b.rig.update(-2.25, 1 / 120);
    expect(a.rig.anchorY).toBeCloseTo(b.rig.anchorY, 12);
    expect(a.rig.anchorY).toBeGreaterThan(-2.25);
    expect(a.rig.anchorY).toBeLessThan(-2.2);
  });

  it('keeps the same proportional anchor with browser bars shown, hidden and standalone dimensions', () => {
    const { camera, rig } = cameraAt(viewports[2], -20);
    for (const height of [664, 744, 844, 780, 844]) {
      rig.resize(390, height, { top: 47, bottom: 34 });
      expect((contactPoint(camera, -20).y * height - 47) / (height - 81)).toBeCloseTo(.43, 10);
      expect(rig.anchorY).toBe(-20);
    }
  });

  it('smooths a chrome resize from the previous pixel position without snapping the low-water follow', () => {
    const { camera, rig } = cameraAt(viewports[2]);
    rig.update(-2.25, 1 / 60);
    const anchor = rig.anchorY;
    const previousPixel = rig.projectContactY() * 844;
    rig.resize(390, 744, { top: 47, bottom: 34, smooth: true });
    expect(rig.anchorY).toBe(anchor);
    expect(rig.projectContactY() * 744).toBeCloseTo(previousPixel, 9);
    const target = 47 + .43 * (744 - 81);
    rig.updateViewport(1 / 120);
    const nextPixel = rig.projectContactY() * 744;
    expect(nextPixel).toBeLessThan(previousPixel);
    expect(nextPixel).toBeGreaterThan(target);
    expect(previousPixel - nextPixel).toBeLessThan(5);
    for (let i = 0; i < 120; i++) rig.updateViewport(1 / 120);
    expect(rig.projectContactY() * 744).toBeCloseTo(target, 6);
    expect(rig.anchorY).toBe(anchor);
    expect(contactPoint(camera, anchor).y * 744).toBeCloseTo(target, 6);
  });

  it('finishes viewport interpolation at the same anchor independently of rendering frequency', () => {
    const a = cameraAt(viewports[2]);
    const b = cameraAt(viewports[2]);
    for (const { rig } of [a, b]) rig.resize(390, 744, { top: 47, bottom: 34, smooth: true });
    for (let i = 0; i < 30; i++) a.rig.updateViewport(1 / 60);
    for (let i = 0; i < 60; i++) b.rig.updateViewport(1 / 120);
    expect(a.rig.projectContactY()).toBeCloseTo(b.rig.projectContactY(), 11);
  });

  it('ignores invalid transient dimensions and update data without corrupting camera matrices', () => {
    const { camera, rig } = cameraAt(viewports[2]);
    rig.resize(NaN, 0, { top: Infinity, bottom: NaN, smooth: true });
    rig.update(NaN, Infinity, false, NaN);
    rig.updateViewport(-1);
    expect(rig.width).toBe(390);
    expect(rig.height).toBe(844);
    for (const value of [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements]) expect(Number.isFinite(value)).toBe(true);
  });

  it.each([1, 30])('keeps real contact inside 43–45% after a %s-platform descent, then follows no upward bounce', count => {
    const factory = () => ({ platforms: Array.from({ length: count + 2 }, (_, index) => ({
      id: String(index), index, y: -index * CONFIG.world.platformSpacing, active: true,
      finish: index === count + 1, baseRotation: 0, type: 'static', walls: [],
      segments: index < count ? [] : [{ start: 0, end: Math.PI * 2, kind: 'safe' }],
    })) });
    const sim = new Simulation({ levelFactory: factory });
    sim.state = STATES.ACTIVE;
    const viewport = viewports[2];
    const { camera, rig } = cameraAt(viewport);
    const normalize = y => (contactPoint(camera, y).y * viewport.height - viewport.top)
      / (viewport.height - viewport.top - viewport.bottom);
    let landed = false;
    for (let tick = 0; tick < 1200; tick++) {
      const previousVelocity = sim.ball.velocity;
      sim.step(CONFIG.physics.fixedStep);
      rig.update(sim.anchorY, CONFIG.physics.fixedStep);
      if (previousVelocity < 0 && sim.ball.velocity > 0) { landed = true; break; }
    }
    expect(landed).toBe(true);
    expect(normalize(sim.ball.y - CONFIG.physics.ballRadius)).toBeGreaterThanOrEqual(.43);
    expect(normalize(sim.ball.y - CONFIG.physics.ballRadius)).toBeLessThanOrEqual(.45);
    const lowWater = sim.anchorY;
    let previousCameraAnchor = rig.anchorY;
    for (let tick = 0; tick < 32; tick++) {
      sim.step(CONFIG.physics.fixedStep);
      rig.update(sim.anchorY, CONFIG.physics.fixedStep);
      expect(sim.anchorY).toBe(lowWater);
      expect(rig.anchorY).toBeLessThanOrEqual(previousCameraAnchor);
      previousCameraAnchor = rig.anchorY;
    }
  });

  it.each(viewports)('solves the two-percent perspective lag bound accurately at $width × $height', viewport => {
    const { camera, rig } = cameraAt(viewport);
    const floor = -20;
    rig.update(floor, 0);
    const fraction = (contactPoint(camera, floor).y * viewport.height - viewport.top)
      / (viewport.height - viewport.top - viewport.bottom);
    expect(fraction).toBeCloseTo(CONFIG.camera.contactScreenAnchor + CONFIG.camera.maxContactScreenLag, 10);
  });

  it('keeps the apex clear while a larger viewport switches to the taller header layout', () => {
    const { camera, rig } = cameraAt({ width: 390, height: 664, top: 47, bottom: 34 });
    rig.resize(390, 844, { top: 47, bottom: 34, headerBottom: 221, smooth: true });
    const rise = CONFIG.physics.bounceVelocity ** 2 / (2 * CONFIG.physics.bounceGravity);
    expect(ballPoint(camera, 0, rise + CONFIG.physics.ballRadius).y * 844).toBeGreaterThan(229);
  });
});
