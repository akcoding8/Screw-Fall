import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createGameplayRect } from './Viewport.js';

// This smooths browser-chrome composition changes only; downward follow keeps
// its approved response and continues to use the simulation's low-water mark.
const VIEWPORT_RESPONSE = 14;

/** Stable tower framing. Only the downward simulation anchor drives the camera. */
export class CameraRig {
  constructor(camera, config = CONFIG.camera) {
    this.camera = camera;
    this.config = config;
    this.anchorY = 0;
    this.simulationAnchorY = 0;
    this.frameScale = 1;
    this.target = new THREE.Vector3();
    this.reference = new THREE.Vector3();
    // Preserve the original distance to the look-at point when changing pitch.
    this.distanceToTarget = Math.hypot(config.distance, config.height - config.targetOffset);
    this.baselinePitch = Math.atan2(config.height - config.targetOffset, config.distance);
    this.pitch = THREE.MathUtils.degToRad(config.pitchDegrees);
  }

  resize(width, height, { smooth = false, ...insets } = {}) {
    width = Number.isFinite(width) && width > 0 ? width : this.width || 1;
    height = Number.isFinite(height) && height > 0 ? height : this.height || 1;
    const previousContactPixel = this.height ? this.projectContactY() * this.height : null;
    this.width = width; this.height = height;
    this.gameplayRect = createGameplayRect(width, height, insets);
    this.contactTargetY = this.gameplayRect.y + this.config.contactScreenAnchor * this.gameplayRect.height;
    const camera = this.camera;
    camera.fov = this.config.fieldOfView;
    camera.aspect = width / height;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const visibleWidth = 2 * this.distanceToTarget
      * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    this.frameScale = Math.max(.91, this.config.portraitWidth / visibleWidth);

    this.place(this.pitch);
    this.unshiftedContactY = this.projectContactY() * height;
    // Perspective projection is a ratio of two linear terms in vertical lag.
    // Solve that ratio once per resize, rather than project or iterate per frame.
    const sine = Math.sin(this.pitch), cosine = Math.cos(this.pitch);
    const distance = this.distanceToTarget * this.frameScale;
    const orbitZ = Math.sin(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius;
    const numerator = -cosine * this.config.targetOffset - sine * orbitZ;
    const depth = distance + sine * this.config.targetOffset - cosine * orbitZ;
    const focal = 1 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const ratio = numerator / depth - 2 * this.config.maxContactScreenLag * this.gameplayRect.height / (height * focal);
    this.maxFollowLag = Math.max(0, (numerator - ratio * depth) / (cosine + ratio * sine));
    const apex = CONFIG.physics.bounceVelocity ** 2 / (2 * CONFIG.physics.bounceGravity)
      + 2 * CONFIG.physics.ballRadius;
    this.reference.set(0, this.anchorY + apex, orbitZ).project(camera);
    const apexSpan = this.unshiftedContactY - (1 - this.reference.y) * height / 2;
    // A header can change height at a responsive breakpoint. Keep a growing
    // viewport's interpolation from briefly carrying the apex into that UI.
    const minimumContactY = Math.min(this.contactTargetY,
      this.gameplayRect.headerBottom + Math.max(8, this.gameplayRect.height * .015) + apexSpan);
    this.contactPixel = smooth && previousContactPixel !== null
      ? Math.max(previousContactPixel, minimumContactY) : this.contactTargetY;
    this.applyComposition();
  }

  applyComposition() {
    // A positive view offset moves the projected scene upward. This changes
    // composition without moving gameplay geometry or zooming the tower.
    this.camera.setViewOffset(this.width, this.height, 0,
      this.unshiftedContactY - this.contactPixel, this.width, this.height);
  }

  updateViewport(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || this.contactPixel === this.contactTargetY) return false;
    const difference = this.contactTargetY - this.contactPixel;
    this.contactPixel = Math.abs(difference) < .02 ? this.contactTargetY
      : this.contactPixel + difference * (1 - Math.exp(-VIEWPORT_RESPONSE * dt));
    this.applyComposition();
    return true;
  }

  /** True sphere-bottom/platform contact, not the ball centre or bounce apex. */
  projectContactY() {
    this.reference.set(
      Math.cos(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius,
      this.anchorY,
      Math.sin(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius,
    ).project(this.camera);
    return (1 - this.reference.y) / 2;
  }

  place(pitch, pulse = 0) {
    const aim = this.anchorY + this.config.targetOffset;
    const distance = this.distanceToTarget * this.frameScale;
    this.camera.position.set(pulse, aim + Math.sin(pitch) * distance, Math.cos(pitch) * distance);
    this.target.set(0, aim, 0);
    this.camera.lookAt(this.target);
    // Culling can run before renderer.render(), which normally refreshes these.
    // Commit the look-at rotation now, including the inverse used by projection.
    this.camera.updateMatrixWorld(true);
  }

  step(anchorY, dt, snap = false) {
    if (!Number.isFinite(anchorY)) anchorY = this.simulationAnchorY;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    // Retain the smooth low-water follow, but do not let a fast descent drag
    // contact below 45% of usable height. This only advances the camera downward;
    // it never follows the upward bounce and never changes simulation timing.
    if (Number.isFinite(this.maxFollowLag)) this.simulationAnchorY = Math.min(this.simulationAnchorY, anchorY + this.maxFollowLag);
    if (snap) this.simulationAnchorY = anchorY;
    else this.simulationAnchorY += (anchorY - this.simulationAnchorY) * (1 - Math.exp(-this.config.followResponse * dt));
    return this.simulationAnchorY;
  }

  /** Display the already-interpolated fixed-step anchor; no second damping. */
  render(anchorY, dt = 0, pulse = 0) {
    if (Number.isFinite(anchorY)) this.anchorY = anchorY;
    if (!Number.isFinite(pulse)) pulse = 0;
    this.updateViewport(dt);
    this.place(this.pitch, pulse);
  }

  // Convenience for resets and standalone camera checks. The game explicitly
  // separates step() from render() so the ball and camera use one alpha.
  update(anchorY, dt, snap = false, pulse = 0) {
    this.step(anchorY, dt, snap);
    this.render(this.simulationAnchorY, dt, pulse);
  }
}
