import * as THREE from 'three';
import { PaintMarkPool, PAINT_LIMITS, cosmeticMaterial, splatGeometry } from './PaintMarkPool.js';

export const COSMETIC_LIMITS = Object.freeze({
  trailParticles: 36, impactParticles: 44, ringPulses: 4,
  smashPaintLobes: 6, smashPaintLifetime: .26,
  trailInterval: .028, passInterval: .12, trailDiscontinuityDistance: 3,
});

const BASIC = Object.freeze({ palette: ['#f4f2df'], bounce: 'basic', bounceCount: 0, pass: 'none', passCount: 0, trail: 'none', paint: false });
const finitePosition = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

function createPool(scene, capacity, geometry, name) {
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  opacity.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('cosmeticOpacity', opacity);
  const mesh = new THREE.InstancedMesh(geometry, cosmeticMaterial(), capacity);
  mesh.name = name;
  mesh.userData.cosmeticOnly = true;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const blank = new THREE.Matrix4().makeScale(0, 0, 0), color = new THREE.Color('#ffffff');
  for (let i = 0; i < capacity; i++) { mesh.setMatrixAt(i, blank); mesh.setColorAt(i, color); }
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  return {
    mesh, opacity, capacity, count: 0, cursor: 0,
    records: Array.from({ length: capacity }, () => ({
      active: false, age: 0, life: 0, x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0, size: 0, stretch: 1, spin: 0, opacity: 0, ring: false, flat: false,
    })),
  };
}

/**
 * Pure rendering adapter: no simulation, score, storage, or gameplay random
 * source is accepted. Trails consume only the already-interpolated ball pose.
 * Existing shatter/death/confetti particles retain their independent budget.
 */
export class CosmeticEffectManager {
  constructor(scene) {
    this.paint = new PaintMarkPool(scene);
    this.trails = createPool(scene, COSMETIC_LIMITS.trailParticles, new THREE.OctahedronGeometry(1), 'Pooled skin trails');
    this.impacts = createPool(scene, COSMETIC_LIMITS.impactParticles, new THREE.OctahedronGeometry(1), 'Pooled skin impact accents');
    const ring = new THREE.RingGeometry(.79, 1, 24);
    ring.rotateX(-Math.PI / 2);
    this.rings = createPool(scene, COSMETIC_LIMITS.ringPulses, ring, 'Pooled skin ring pulses');
    this.smashPaint = createPool(scene, COSMETIC_LIMITS.smashPaintLobes, splatGeometry(), 'Pooled transient smash paint');
    this.profile = BASIC;
    this.skinId = 'classic';
    this.safeColor = '#d5e8dc';
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.lastPosition = new THREE.Vector3();
    this.emitPosition = new THREE.Vector3();
    this.havePosition = false;
    this.trailElapsed = 0;
    this.elapsed = 0;
    this.lastPass = -Infinity;
    this.serial = 0;
    this.landings = 0;
    this.alive = true;
    this.disposed = false;
  }

  get paintCount() { return this.paint.count; }
  get trailCount() { return this.trails.count; }
  get impactCount() { return this.impacts.count + this.rings.count + this.smashPaint.count; }
  get profileName() { return `${this.profile.bounce}/${this.profile.trail}/${this.profile.paint || 'no-paint'}`; }

  setSkin(skin, palette) {
    this.skinId = skin?.id || 'classic';
    this.profile = skin?.effects || BASIC;
    if (palette?.safe) this.safeColor = palette.safe;
    this.clearTransient();
    this.landings = 0;
  }

  setPalette(palette) { if (palette?.safe) this.safeColor = palette.safe; }

  next(pool) {
    const slot = pool.cursor;
    pool.cursor = (slot + 1) % pool.capacity;
    const record = pool.records[slot];
    if (!record.active) pool.count++;
    record.active = true;
    record.age = 0;
    pool.mesh.visible = true;
    return slot;
  }

  setColor(pool, slot, offset) {
    const palette = this.profile.palette?.length ? this.profile.palette : BASIC.palette;
    pool.mesh.setColorAt(slot, this.color.set(palette[offset % palette.length]));
    pool.mesh.instanceColor.needsUpdate = true;
  }

  burst(position, count, kind = this.profile.bounce, scale = 1) {
    if (!finitePosition(position) || this.disposed || !this.alive) return;
    if (kind === 'ring' || kind === 'ripple') {
      const slot = this.next(this.rings), record = this.rings.records[slot];
      record.x = position.x; record.y = position.y + .019; record.z = position.z;
      record.life = .31; record.size = .30; record.opacity = .46;
      record.ring = true; record.vx = record.vy = record.vz = record.spin = 0;
      this.setColor(this.rings, slot, this.serial++);
    }
    const total = Math.min(this.impacts.capacity, Math.max(0, Math.floor(count || 0)));
    const painted = Boolean(this.profile.paint);
    for (let i = 0; i < total; i++) {
      const slot = this.next(this.impacts), record = this.impacts.records[slot];
      const serial = this.serial++, angle = serial * 2.3999632297;
      // Painted impacts reach just beyond the persistent lobes, then quickly
      // disappear. This only changes render accents, never bounce velocity.
      const speed = (kind === 'dust' ? .32 : painted ? 1.65 : .65) * scale;
      record.x = position.x; record.y = position.y + .025; record.z = position.z;
      record.vx = Math.cos(angle) * speed;
      record.vz = Math.sin(angle) * speed;
      record.vy = .30 + (serial % 5) * .075;
      record.life = kind === 'sparkle' || kind === 'shimmer' ? .26 : .34;
      record.size = (kind === 'dust' ? .025 : kind === 'shards' ? (painted ? .045 : .040) : painted ? .044 : .032) * scale;
      record.stretch = kind === 'shards' ? 1.7 : 1;
      record.opacity = kind === 'dust' ? .36 : painted ? .78 : .62;
      record.spin = angle;
      record.ring = false;
      this.setColor(this.impacts, slot, serial);
    }
  }

  /** contactWorld is the platform top contact, not the ball centre. */
  onLanding(platform, view, localContactAngle, contactWorld) {
    if (!this.alive || this.disposed || !platform?.active || platform.finish || !finitePosition(contactWorld)) return false;
    this.landings++;
    this.burst(contactWorld, this.profile.bounceCount, this.profile.bounce);
    if (!this.profile.paint || (this.landings - 1) % Math.max(1, this.profile.paintEvery || 1)) return false;
    // Geometry-changing pincers use only this brief impact splash. Rigid
    // orbiters/stingers can keep a true piece-local persistent mark.
    return this.paint.add(platform, view, localContactAngle, this.profile, this.safeColor);
  }

  onPass(position) {
    if (!this.alive || this.elapsed - this.lastPass < COSMETIC_LIMITS.passInterval) return false;
    this.lastPass = this.elapsed;
    this.burst(position, this.profile.passCount, this.profile.pass);
    return true;
  }

  onSmash(position) {
    if (!this.profile.paint) {
      this.burst(position, Math.min(8, this.profile.bounceCount || 0), this.profile.smash);
      return null;
    }
    if (!finitePosition(position) || this.disposed || !this.alive) return null;
    const scale = Math.min(1.8, Math.max(1.4, this.profile.smashPaintScale || 1.55));
    const radius = Math.max(PAINT_LIMITS.minimumSize,
      (Number.isFinite(this.profile.paintSize) ? this.profile.paintSize : .54) - PAINT_LIMITS.edgeClearance) * scale;
    const palette = this.profile.palette?.length ? this.profile.palette : BASIC.palette;
    const lobes = Math.min(PAINT_LIMITS.blobsPerMark, palette.length);
    const serial = this.serial++;
    // These short-lived lobes are airborne impact particles, never decals on
    // destroyed geometry. Their full initial scale makes the contact visible
    // immediately; separate colours spread out and disappear in 260ms.
    for (let lobe = 0; lobe < lobes; lobe++) {
      const slot = this.next(this.smashPaint), record = this.smashPaint.records[slot];
      const angle = serial * 2.3999632297 + lobe * Math.PI * 2 / lobes;
      const offset = lobes > 1 ? radius * PAINT_LIMITS.lobeOffset : 0;
      record.x = position.x + Math.cos(angle) * offset;
      record.y = position.y + .018 + lobe * .001;
      record.z = position.z + Math.sin(angle) * offset;
      record.vx = Math.cos(angle) * .55;
      record.vz = Math.sin(angle) * .55;
      record.vy = .48;
      record.life = COSMETIC_LIMITS.smashPaintLifetime;
      record.size = radius * (lobes > 1 ? PAINT_LIMITS.lobeRadius : 1);
      record.opacity = .84;
      record.stretch = 1;
      record.spin = angle;
      record.ring = false;
      record.flat = true;
      this.setColor(this.smashPaint, slot, serial + lobe);
    }
    this.updatePool(this.smashPaint, 0);
    this.burst(position, Math.min(16, Math.ceil((this.profile.bounceCount || 5) * scale)), 'paint', scale);
    return { paint: true, scale, radius, lobes };
  }

  clearPlatform(platformId) { this.paint.clearPlatform(platformId); }
  setAttachmentDebug(enabled) { this.paint.setAttachmentDebug(enabled); }
  onDeath() { this.alive = false; this.clearTransient(); }

  spawnTrail(position) {
    const dual = this.profile.trail === 'dual';
    for (let i = 0; i < (dual ? 2 : 1); i++) {
      const slot = this.next(this.trails), record = this.trails.records[slot];
      const serial = this.serial++;
      record.x = position.x + (dual ? (i ? .025 : -.025) : 0);
      record.y = position.y;
      record.z = position.z;
      record.vx = record.vy = record.vz = 0;
      record.life = Math.min(.36, Math.max(.12, this.profile.trailLifetime || .25));
      record.size = this.profile.trail === 'dust' ? .023 : this.profile.trail === 'neon' ? .040
        : this.profile.trail === 'gold' ? .038 : .033;
      record.stretch = this.profile.trail === 'ribbon' ? 2.8 : 1;
      record.opacity = this.profile.trail === 'neon' ? .45 : this.profile.trail === 'gold' ? .42 : .35;
      record.spin = serial * .8;
      record.ring = false;
      this.setColor(this.trails, slot, serial);
    }
  }

  updatePool(pool, dt, isTrail = false) {
    if (!pool.count) return;
    for (let i = 0; i < pool.capacity; i++) {
      const record = pool.records[i];
      if (!record.active) continue;
      record.age += dt;
      if (record.age >= record.life) {
        record.active = false;
        pool.count--;
        pool.opacity.setX(i, 0);
        continue;
      }
      const life = record.age / record.life;
      // This acceleration belongs only to tiny render accents.
      if (!record.ring && !isTrail) record.vy -= 2.8 * dt;
      record.x += record.vx * dt;
      record.y += record.vy * dt;
      record.z += record.vz * dt;
      this.dummy.position.set(record.x, record.y, record.z);
      if (record.flat) {
        this.dummy.rotation.set(0, record.spin, 0);
        this.dummy.scale.set(record.size * (1 + life * .12), 1, record.size * (1 + life * .12));
      } else if (record.ring) {
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(record.size * (.4 + life));
      } else {
        this.dummy.rotation.set(record.spin, record.spin * .4, record.spin * .2);
        const size = record.size * (1 - life * .6);
        this.dummy.scale.set(size, size * record.stretch, size);
      }
      this.dummy.updateMatrix();
      pool.mesh.setMatrixAt(i, this.dummy.matrix);
      pool.opacity.setX(i, record.opacity * (1 - life));
    }
    pool.opacity.needsUpdate = true;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.visible = pool.count > 0;
  }

  /** Call after platform display transforms and the interpolated ball pose. */
  update(dt, displayedPosition, displayedVelocity, active) {
    if (this.disposed) return;
    if (!Number.isFinite(dt) || dt < 0 || dt > .15 || !finitePosition(displayedPosition)) {
      this.clearTransient();
      this.paint.update();
      return;
    }
    this.elapsed += dt;
    this.updatePool(this.trails, dt, true);
    this.updatePool(this.impacts, dt);
    this.updatePool(this.rings, dt);
    this.updatePool(this.smashPaint, dt);
    const continuous = this.havePosition && this.lastPosition.distanceToSquared(displayedPosition)
      <= COSMETIC_LIMITS.trailDiscontinuityDistance ** 2;
    if (!continuous) { this.clearPool(this.trails); this.trailElapsed = 0; }
    if (this.alive && active && continuous && displayedVelocity < -1 && this.profile.trail !== 'none') {
      this.trailElapsed += dt;
      let emitted = 0;
      while (this.trailElapsed >= COSMETIC_LIMITS.trailInterval && emitted < 6) {
        this.trailElapsed -= COSMETIC_LIMITS.trailInterval;
        // All samples stay between the previous and current displayed pose.
        // Never sample the next authoritative fixed-step snapshot.
        const fraction = dt > 0 ? Math.max(0, Math.min(1, 1 - this.trailElapsed / dt)) : 1;
        this.emitPosition.lerpVectors(this.lastPosition, displayedPosition, fraction);
        this.spawnTrail(this.emitPosition);
        emitted++;
      }
      if (emitted) this.updatePool(this.trails, 0, true);
    } else if (!active || !this.alive) {
      this.clearPool(this.trails);
      this.trailElapsed = 0;
    }
    this.lastPosition.copy(displayedPosition);
    this.havePosition = true;
    this.paint.update();
  }

  clearPool(pool) {
    if (!pool.count) return;
    for (let i = 0; i < pool.capacity; i++) { pool.records[i].active = false; pool.opacity.setX(i, 0); }
    pool.count = 0;
    pool.cursor = 0;
    pool.opacity.needsUpdate = true;
    pool.mesh.visible = false;
  }

  clearTransient() {
    this.clearPool(this.trails);
    this.clearPool(this.impacts);
    this.clearPool(this.rings);
    this.clearPool(this.smashPaint);
    this.havePosition = false;
    this.trailElapsed = 0;
    this.lastPass = -Infinity;
  }

  clear() {
    this.clearTransient();
    this.paint.clear();
    this.elapsed = this.serial = this.landings = 0;
    this.alive = true;
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.paint.dispose();
    for (const pool of [this.trails, this.impacts, this.rings, this.smashPaint]) {
      pool.mesh.removeFromParent();
      pool.mesh.geometry.dispose();
      pool.mesh.material.dispose();
      pool.mesh.dispose();
    }
    this.disposed = true;
  }
}
