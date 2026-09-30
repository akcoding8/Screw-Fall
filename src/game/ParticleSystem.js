import * as THREE from 'three';
import { CONFIG } from './config.js';
import { disposeFragment } from './Platform.js';

const randomBetween = (low, high) => low + Math.random() * (high - low);

/**
 * Visual-only debris and a fixed-capacity instanced particle pool.
 * Randomness here never feeds into the deterministic gameplay simulation.
 */
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.tuning = CONFIG.particles;
    this.capacity = this.tuning.maxParticles;
    this.particles = Array.from({ length: this.capacity }, () => ({
      active: false, age: 0, life: 0, x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0,
      spin: 0, size: 0, flat: false,
    }));
    this.cursor = 0;
    this.liveParticles = 0;
    this.fragments = [];
    this.fragmentPool = [];
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.worldPosition = new THREE.Vector3();
    this.towerPosition = new THREE.Vector3();
    this.frustum = new THREE.Frustum();
    this.viewProjection = new THREE.Matrix4();
    this.fragmentBounds = new THREE.Sphere();
    this.hasView = false;
    this.confettiColors = ['#f6e8b0', '#9bd9bf', '#f4f2df', '#f3977c'];
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.65 }),
      this.capacity,
    );
    this.mesh.name = 'Pooled impact particles and confetti';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.capacity; i += 1) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set('#ffffff'));
    }
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.mesh);
  }

  get activeCount() {
    return this.liveParticles + this.fragments.length;
  }

  get activeDebrisCount() {
    return this.fragments.length;
  }

  /** Release geometry exactly once, retaining only a reusable motion record. */
  recycleFragment(index) {
    const fragment = this.fragments[index];
    disposeFragment(fragment.piece);
    fragment.piece = null;
    this.fragmentPool.push(fragment);
    this.fragments[index] = this.fragments[this.fragments.length - 1];
    this.fragments.pop();
  }

  outsideUsefulView(fragment) {
    if (!this.hasView || fragment.age < this.tuning.fragmentOffscreenGrace) return false;
    const piece = fragment.piece;
    this.fragmentBounds.center.copy(piece.position);
    this.fragmentBounds.radius = piece.userData.fragmentRadius * piece.scale.x + this.tuning.fragmentOffscreenPadding;
    return !this.frustum.intersectsSphere(this.fragmentBounds);
  }

  /** Preserve visible older chunks under pressure; suppress only new cosmetics. */
  makeFragmentRoom() {
    if (this.fragments.length < this.tuning.maxFragments) return true;
    let oldest = -1;
    let oldestAge = -1;
    for (let i = 0; i < this.fragments.length; i += 1) {
      const fragment = this.fragments[i];
      if (fragment.age > oldestAge && this.outsideUsefulView(fragment)) {
        oldest = i;
        oldestAge = fragment.age;
      }
    }
    if (oldest < 0) return false;
    this.recycleFragment(oldest);
    return true;
  }

  /** Preserve the current tower/base rotations before giving debris world velocity. */
  shatter(platformGroup, strong = false, paintPalette = null) {
    if (platformGroup.userData.finish || platformGroup.userData.shattered) return;
    platformGroup.userData.shattered = true;
    platformGroup.updateWorldMatrix(true, true);
    platformGroup.getWorldPosition(this.towerPosition);
    const limit = strong ? this.tuning.smashFragmentCount : this.tuning.passFragmentCount;
    let spawned = 0;
    // Attaching removes children from the group, so iterate backward in place.
    for (let i = platformGroup.children.length - 1; i >= 0; i -= 1) {
      const piece = platformGroup.children[i];
      if (!piece.userData.fragment) continue;
      if (spawned >= limit || !this.makeFragmentRoom()) {
        // The platform disappears immediately even if its cosmetic pool is full.
        disposeFragment(piece);
        continue;
      }
      this.scene.attach(piece);
      piece.getWorldPosition(this.worldPosition);
      const dx = this.worldPosition.x - this.towerPosition.x;
      const dz = this.worldPosition.z - this.towerPosition.z;
      const radius = Math.hypot(dx, dz);
      const radialX = radius > 1e-6 ? dx / radius : 1;
      const radialZ = radius > 1e-6 ? dz / radius : 0;
      const impulse = strong
        ? randomBetween(this.tuning.smashOutwardMin, this.tuning.smashOutwardMax)
        : randomBetween(this.tuning.fragmentOutwardMin, this.tuning.fragmentOutwardMax);
      const tangent = randomBetween(-this.tuning.fragmentTangentialSpeed, this.tuning.fragmentTangentialSpeed);
      piece.position.x += radialX * this.tuning.fragmentSpawnOffset;
      piece.position.z += radialZ * this.tuning.fragmentSpawnOffset;
      const record = this.fragmentPool.pop() || {};
      record.piece = piece;
      record.age = 0;
      record.life = this.tuning.fragmentLifetime * randomBetween(0.9, 1);
      // Tangent is orthogonal to the world radial vector: the outward component
      // always remains at least the configured positive minimum, at any rotation.
      record.vx = radialX * impulse - radialZ * tangent;
      record.vz = radialZ * impulse + radialX * tangent;
      record.vy = strong
        ? randomBetween(this.tuning.smashVerticalMin, this.tuning.smashVerticalMax)
        : randomBetween(this.tuning.fragmentVerticalMin, this.tuning.fragmentVerticalMax);
      const spin = this.tuning.fragmentSpin * (strong ? this.tuning.smashSpinMultiplier : 1);
      record.ax = randomBetween(-spin, spin);
      record.ay = randomBetween(-this.tuning.fragmentYawSpin, this.tuning.fragmentYawSpin);
      record.az = randomBetween(-spin, spin);
      // Surface geometries belong to their existing fragments. A restrained
      // tint changes only a few top faces, never shared materials or motion.
      // No random call is added, so the approved debris trajectories match.
      if (strong && paintPalette?.length && spawned % 3 === 0) {
        this.color.set(paintPalette[Math.floor(spawned / 3) % paintPalette.length]);
        piece.traverse(child => {
          if (!child.userData.surfaceKind) return;
          const colors = child.geometry?.attributes.color, normals = child.geometry?.attributes.normal;
          if (!colors || !normals) return;
          for (let vertex = 0; vertex < colors.count; vertex++) {
            if (normals.getY(vertex) < .7) continue;
            colors.setXYZ(vertex, colors.getX(vertex) * .6 + this.color.r * .4,
              colors.getY(vertex) * .6 + this.color.g * .4, colors.getZ(vertex) * .6 + this.color.b * .4);
          }
          colors.needsUpdate = true;
        });
        piece.userData.paintAccent = this.color.getHexString();
      }
      this.fragments.push(record);
      spawned += 1;
    }
  }

  /** @param {'impact'|'death'|'complete'|'trail'} kind */
  burst(position, color = '#f4f2df', count, kind = 'impact') {
    const complete = kind === 'complete';
    const death = kind === 'death';
    const trail = kind === 'trail';
    const ballScale = complete ? 1 : CONFIG.physics.ballRadius / 0.25;
    const total = count ?? (complete
      ? this.tuning.confettiCount
      : death ? this.tuning.deathCount : this.tuning.passCount);
    for (let index = 0; index < total; index += 1) {
      const slot = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const particle = this.particles[slot];
      if (!particle.active) this.liveParticles += 1;
      particle.active = true;
      particle.age = 0;
      particle.life = complete
        ? this.tuning.confettiLifetime * randomBetween(0.75, 1.1)
        : (kind === 'impact' ? this.tuning.impactLifetime : this.tuning.lifetime)
          * randomBetween(0.65, 1.2) * (trail ? 0.5 : 1);
      const angle = Math.random() * Math.PI * 2;
      const radialOffset = complete ? randomBetween(0.55, 1.3) : 0.035 * ballScale;
      particle.x = position.x + Math.cos(angle) * radialOffset;
      particle.y = position.y + (complete ? 0.08 : 0.015);
      particle.z = position.z + Math.sin(angle) * radialOffset;
      const speed = complete ? randomBetween(0.5, 2) : death ? randomBetween(1.2, 3.5) : randomBetween(0.35, 1.3);
      particle.vx = Math.cos(angle) * speed * (trail ? 0.1 : 1);
      particle.vz = Math.sin(angle) * speed * (trail ? 0.1 : 1);
      particle.vy = complete ? randomBetween(3.3, 5.2) : death ? randomBetween(0.6, 3.5) : randomBetween(0.4, 1.5);
      if (trail) particle.vy = 0.2;
      particle.rx = Math.random() * Math.PI;
      particle.ry = Math.random() * Math.PI;
      particle.rz = Math.random() * Math.PI;
      particle.spin = randomBetween(-7, 7);
      particle.size = complete ? randomBetween(0.07, 0.13) : randomBetween(0.035, 0.09) * ballScale;
      particle.flat = complete;
      this.mesh.setColorAt(slot, this.color.set(complete && index % 3 ? this.confettiColors[index % this.confettiColors.length] : color));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt, camera) {
    if (camera) {
      camera.updateWorldMatrix(true, false);
      this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.viewProjection);
      this.hasView = true;
    }
    const fragmentGravity = this.tuning.gravity;
    for (let i = this.fragments.length - 1; i >= 0; i -= 1) {
      const fragment = this.fragments[i];
      fragment.age += dt;
      if (fragment.age >= fragment.life) {
        this.recycleFragment(i);
        continue;
      }
      fragment.vy -= fragmentGravity * dt;
      const piece = fragment.piece;
      piece.position.x += fragment.vx * dt;
      piece.position.y += fragment.vy * dt;
      piece.position.z += fragment.vz * dt;
      piece.rotation.x += fragment.ax * dt;
      piece.rotation.y += fragment.ay * dt;
      piece.rotation.z += fragment.az * dt;
      piece.scale.setScalar(Math.min(1, (fragment.life - fragment.age) / this.tuning.fragmentFadeDuration));
      if (this.outsideUsefulView(fragment)) this.recycleFragment(i);
    }

    if (!this.liveParticles) return;
    const gravity = this.tuning.gravity;
    for (let i = 0; i < this.capacity; i += 1) {
      const particle = this.particles[i];
      if (!particle.active) continue;
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.active = false;
        this.liveParticles -= 1;
        this.dummy.scale.setScalar(0);
      } else {
        particle.vy -= gravity * dt * (particle.flat ? 0.65 : 1);
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.z += particle.vz * dt;
        particle.rx += particle.spin * dt;
        particle.rz += particle.spin * dt * 0.65;
        this.dummy.position.set(particle.x, particle.y, particle.z);
        this.dummy.rotation.set(particle.rx, particle.ry, particle.rz);
        const scale = particle.size * Math.min(1, (particle.life - particle.age) / 0.2);
        this.dummy.scale.set(scale, particle.flat ? scale * 0.18 : scale, particle.flat ? scale * 1.5 : scale);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const fragment of this.fragments) {
      disposeFragment(fragment.piece);
      fragment.piece = null;
      this.fragmentPool.push(fragment);
    }
    this.fragments.length = 0;
    this.hasView = false;
    this.liveParticles = 0;
    this.cursor = 0;
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.capacity; i += 1) {
      this.particles[i].active = false;
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.clear();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    this.fragmentPool.length = 0;
  }
}
