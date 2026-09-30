import * as THREE from 'three';
import { CONFIG } from './config.js';
import { TAU, normalizeAngle } from './math.js';

export const PAINT_LIMITS = Object.freeze({
  marks: 64, blobsPerMark: 3, surfaceOffset: .012, edgeClearance: .035, minimumSize: .025,
  lobeOffset: .35, lobeRadius: .65, minimumOpacity: .60, maximumOpacity: .80,
  replacementDistance: .18,
  clippingWalls: 4,
});

/** CPU equivalent of the paint fragment shader, also used by geometry tests. */
export function paintPointVisible(record, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const radius = Math.hypot(x, z), clearance = PAINT_LIMITS.edgeClearance;
  if (radius < CONFIG.world.innerRadius + clearance || radius > CONFIG.world.outerRadius - clearance) return false;
  if (record.segmentSpan < TAU - 1e-6) {
    const delta = normalizeAngle(Math.atan2(z, x) - record.segmentStart);
    if (delta > record.segmentSpan
      || radius * Math.sin(Math.min(Math.PI / 2, delta, record.segmentSpan - delta)) < clearance) return false;
  }
  for (let index = 0; index < record.wallCount; index++) {
    const wall = record.clipWalls[index];
    const along = x * Math.cos(wall.angle) + z * Math.sin(wall.angle);
    const across = -x * Math.sin(wall.angle) + z * Math.cos(wall.angle);
    const dx = Math.max(wall.innerRadius - along, along - wall.outerRadius, 0);
    const dz = Math.max(Math.abs(across) - wall.halfWidth, 0);
    if (Math.hypot(dx, dz) < clearance) return false;
  }
  return true;
}

/** Full-size splats are clipped per pixel, without generating impact geometry. */
export function paintMaterial() {
  const material = cosmeticMaterial();
  const opacityCompile = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    opacityCompile(shader);
    const wallAttributes = Array.from({ length: PAINT_LIMITS.clippingWalls }, (_, i) =>
      `attribute vec4 paintWall${i}; varying vec4 vPaintWall${i};`).join('\n');
    const wallVaryings = Array.from({ length: PAINT_LIMITS.clippingWalls }, (_, i) => `varying vec4 vPaintWall${i};`).join('\n');
    const wallAssignments = Array.from({ length: PAINT_LIMITS.clippingWalls }, (_, i) => `vPaintWall${i} = paintWall${i};`).join('\n');
    const wallDiscards = Array.from({ length: PAINT_LIMITS.clippingWalls }, (_, i) =>
      `if (!insidePaintWall(vPaintPosition, vPaintWall${i})) discard;`).join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 paintPose;
        attribute vec2 paintRegion;
        varying vec2 vPaintPosition;
        varying vec2 vPaintRegion;
        ${wallAttributes}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPaintPosition = vec2(paintPose.z * position.x + paintPose.w * position.z,
          -paintPose.w * position.x + paintPose.z * position.z) + paintPose.xy;
        vPaintRegion = paintRegion;
        ${wallAssignments}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPaintPosition;
        varying vec2 vPaintRegion;
        ${wallVaryings}
        bool insidePaintWall(vec2 point, vec4 wall) {
          if (wall.w < 0.0) return true;
          float c = cos(wall.x), s = sin(wall.x);
          float along = point.x * c + point.y * s;
          float across = -point.x * s + point.y * c;
          float dx = max(max(wall.y - along, along - wall.z), 0.0);
          float dz = max(abs(across) - wall.w, 0.0);
          return length(vec2(dx, dz)) >= ${PAINT_LIMITS.edgeClearance};
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float paintRadius = length(vPaintPosition);
        if (paintRadius < ${CONFIG.world.innerRadius + PAINT_LIMITS.edgeClearance}
          || paintRadius > ${CONFIG.world.outerRadius - PAINT_LIMITS.edgeClearance}) discard;
        if (vPaintRegion.y < ${TAU - 1e-6}) {
          float delta = mod(atan(vPaintPosition.y, vPaintPosition.x) - vPaintRegion.x + ${TAU}, ${TAU});
          if (delta > vPaintRegion.y || paintRadius * sin(min(${Math.PI / 2}, min(delta, vPaintRegion.y - delta)))
            < ${PAINT_LIMITS.edgeClearance}) discard;
        }
        ${wallDiscards}`);
  };
  material.customProgramCacheKey = () => 'screw-fall-paint-surface-clip-v1';
  return material;
}

/** Per-instance opacity keeps one transparent draw for an entire fixed pool. */
export function cosmeticMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float cosmeticOpacity;\nvarying float vCosmeticOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCosmeticOpacity = cosmeticOpacity;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCosmeticOpacity;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vCosmeticOpacity;');
  };
  material.customProgramCacheKey = () => 'screw-fall-cosmetic-opacity-v1';
  return material;
}

/** A project-original lobed silhouette, generated once; no image or texture. */
export function splatGeometry() {
  const vertices = [0, 0, 0], indices = [], count = 32;
  let maximumRadius = 0;
  for (let i = 0; i < count; i++) {
    const angle = i / count * TAU;
    const radius = .87 + .08 * Math.sin(angle * 5 + .4) + .05 * Math.sin(angle * 3 + 1.1);
    maximumRadius = Math.max(maximumRadius, radius);
    vertices.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    indices.push(0, (i + 1) % count + 1, i + 1);
  }
  // The authored radius is an actual outer bound. Fuller lobes make the mark
  // read at ball scale; normalization keeps every vertex inside clipping.
  for (let i = 3; i < vertices.length; i += 3) {
    vertices[i] /= maximumRadius;
    vertices[i + 2] /= maximumRadius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Marks remember an actual fragment and coordinates in that fragment's space.
 * A single instanced mesh receives those local matrices through the displayed
 * fragment transforms. No paint mesh becomes a child of collision or debris.
 */
export class PaintMarkPool {
  constructor(scene) {
    this.capacity = PAINT_LIMITS.marks;
    this.records = Array.from({ length: this.capacity }, () => ({
      active: false, serial: 0, platformId: null, platform: null, parent: null, piece: null,
      localX: 0, localZ: 0, platformX: 0, platformZ: 0, segmentIndex: -1, size: 0, blobs: 0,
      segmentStart: 0, segmentSpan: TAU, wallCount: 0,
      clipWalls: Array.from({ length: PAINT_LIMITS.clippingWalls }, () => ({ angle: 0, innerRadius: 0, outerRadius: 0, halfWidth: -1 })),
      matrices: Array.from({ length: PAINT_LIMITS.blobsPerMark }, () => new THREE.Matrix4()),
    }));
    this.count = 0;
    this.serial = 0;
    this.disposed = false;
    this.dummy = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
    this.inverse = new THREE.Matrix4();
    this.color = new THREE.Color();
    this.safeColor = new THREE.Color();
    this.debugPoint = new THREE.Vector3();
    const instances = this.capacity * PAINT_LIMITS.blobsPerMark;
    const geometry = splatGeometry();
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(instances), 1);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('cosmeticOpacity', this.opacity);
    this.pose = new THREE.InstancedBufferAttribute(new Float32Array(instances * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.region = new THREE.InstancedBufferAttribute(new Float32Array(instances * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.walls = Array.from({ length: PAINT_LIMITS.clippingWalls }, () =>
      new THREE.InstancedBufferAttribute(new Float32Array(instances * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('paintPose', this.pose);
    geometry.setAttribute('paintRegion', this.region);
    this.walls.forEach((attribute, index) => geometry.setAttribute(`paintWall${index}`, attribute));
    const material = paintMaterial();
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -1;
    this.mesh = new THREE.InstancedMesh(geometry, material, instances);
    this.mesh.name = 'Pooled local platform paint';
    this.mesh.userData.cosmeticOnly = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < instances; i++) {
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.set('#ffffff'));
    }
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.debugLines = null;
    this.debugPositions = null;
  }

  /**
   * angle is the authoritative contact angle in platform-local polar space.
   * The caller samples the platform view at impact first. Breathing geometry
   * deliberately receives transient splashes instead of persistent attachment.
   */
  add(platform, view, angle, profile, safeColor = '#d5e8dc') {
    if (this.disposed || !profile?.paint || !platform?.active || platform.finish
      || platform.type === 'breathing' || platform.motion?.type === 'breathing'
      || !Number.isFinite(angle) || !view?.parent || view.userData.shattered
      || view.userData.platformResources?.disposed) return false;
    const radius = CONFIG.world.ballOrbitRadius;
    // The approved central size is now the nominal size at every contact.
    // Only pixels outside the surface are removed, never the whole splat's scale.
    const size = (Number.isFinite(profile.paintSize) ? profile.paintSize : .54) - PAINT_LIMITS.edgeClearance;
    if (size < PAINT_LIMITS.minimumSize || (platform.walls?.length || 0) > PAINT_LIMITS.clippingWalls) return false;
    let piece = null;
    for (const candidate of view.userData.platformResources?.pieces || []) {
      const arc = candidate.userData.arc;
      if (candidate.parent !== view || candidate.userData.kind !== 'safe' || !arc) continue;
      const unwrapped = angle + Math.round(((arc.start + arc.end) / 2 - angle) / TAU) * TAU;
      if (unwrapped < arc.start || unwrapped >= arc.end) continue;
      // A contact actually inside a lethal wall is not a safe paint landing.
      // Near-wall splats retain full size and have only the wall pixels removed.
      for (const wall of platform.walls || []) {
        const difference = normalizeAngle(angle - wall.angle + Math.PI) - Math.PI;
        const along = radius * Math.cos(difference), across = radius * Math.sin(difference);
        const dx = Math.max(wall.innerRadius - along, along - wall.outerRadius, 0);
        const dz = Math.max(Math.abs(across) - wall.width / 2, 0);
        if (dx === 0 && dz === 0) return false;
      }
      piece = candidate;
      break;
    }
    if (!piece) return false;
    const contactX = Math.cos(angle) * radius, contactZ = Math.sin(angle) * radius;
    const segmentIndex = piece.userData.arc.segmentIndex;
    const replacementSquared = PAINT_LIMITS.replacementDistance ** 2;
    let slot = -1, firstFree = -1, oldestSlot = -1, oldest = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      const record = this.records[i];
      if (!record.active) { if (firstFree < 0) firstFree = i; continue; }
      const dx = record.platformX - contactX, dz = record.platformZ - contactZ;
      // Repeated idle bounces refresh one clean splash instead of building an
      // opaque stack. Compare in platform space across invisible chunk seams;
      // marks on other surfaces and distinct landing positions remain intact.
      if (record.platform === platform && record.parent === view && record.segmentIndex === segmentIndex
        && dx * dx + dz * dz <= replacementSquared) {
        this.remove(i);
        if (slot < 0) slot = i;
        continue;
      }
      if (record.serial < oldest) { oldestSlot = i; oldest = record.serial; }
    }
    if (slot < 0) slot = firstFree >= 0 ? firstFree : oldestSlot;
    const record = this.records[slot];
    if (!record.active) this.count++;
    record.active = true;
    record.serial = ++this.serial;
    record.platform = platform;
    record.platformId = platform.id;
    record.parent = view;
    record.piece = piece;
    record.platformX = contactX;
    record.platformZ = contactZ;
    record.segmentIndex = segmentIndex;
    record.localX = contactX - piece.position.x;
    record.localZ = contactZ - piece.position.z;
    record.size = size;
    const segment = platform.segments[segmentIndex];
    record.segmentStart = normalizeAngle(segment.start);
    record.segmentSpan = Math.abs(segment.end - segment.start) >= TAU - 1e-8 ? TAU : normalizeAngle(segment.end - segment.start);
    record.wallCount = platform.walls?.length || 0;
    for (let index = 0; index < PAINT_LIMITS.clippingWalls; index++) {
      const target = record.clipWalls[index], wall = platform.walls?.[index];
      target.angle = wall?.angle || 0;
      target.innerRadius = wall?.innerRadius || 0;
      target.outerRadius = wall?.outerRadius || 0;
      target.halfWidth = wall ? wall.width / 2 : -1;
    }
    const palette = profile.palette?.length ? profile.palette : ['#559daf'];
    record.blobs = Math.min(PAINT_LIMITS.blobsPerMark, palette.length);
    this.safeColor.set(safeColor);
    const safeLuminance = .2126 * this.safeColor.r + .7152 * this.safeColor.g + .0722 * this.safeColor.b;
    for (let blob = 0; blob < PAINT_LIMITS.blobsPerMark; blob++) {
      const index = slot * PAINT_LIMITS.blobsPerMark + blob;
      if (blob >= record.blobs) { this.opacity.setX(index, 0); continue; }
      const direction = record.serial * 2.3999632297 + blob * TAU / record.blobs;
      // Each colour has an exposed outer lobe; the fragment mask removes only
      // pixels beyond the actual safe segment, including nearby wall footprints.
      const offset = record.blobs > 1 ? size * PAINT_LIMITS.lobeOffset : 0;
      this.dummy.position.set(record.localX + Math.cos(direction) * offset,
        PAINT_LIMITS.surfaceOffset + blob * .0008, record.localZ + Math.sin(direction) * offset);
      this.dummy.rotation.set(0, direction, 0);
      this.dummy.scale.setScalar(size * (record.blobs > 1 ? PAINT_LIMITS.lobeRadius : 1));
      this.dummy.updateMatrix();
      record.matrices[blob].copy(this.dummy.matrix);
      this.pose.setXYZW(index, contactX + Math.cos(direction) * offset, contactZ + Math.sin(direction) * offset,
        Math.cos(direction) * this.dummy.scale.x, Math.sin(direction) * this.dummy.scale.x);
      this.region.setXY(index, record.segmentStart, record.segmentSpan);
      for (let wallIndex = 0; wallIndex < PAINT_LIMITS.clippingWalls; wallIndex++) {
        const wall = record.clipWalls[wallIndex];
        this.walls[wallIndex].setXYZW(index, wall.angle, wall.innerRadius, wall.outerRadius, wall.halfWidth);
      }
      this.color.set(palette[(record.serial - 1 + blob) % palette.length]);
      const luminance = .2126 * this.color.r + .7152 * this.color.g + .0722 * this.color.b;
      if (Math.abs(luminance - safeLuminance) < .10) {
        // Preserve the chosen hue instead of mixing in white or platform
        // colour, which made saturated yellow/blue splashes look washed out.
        this.color.multiplyScalar(safeLuminance > .30 ? .72 : 1.35);
      }
      this.mesh.setColorAt(index, this.color);
      this.opacity.setX(index, Math.min(PAINT_LIMITS.maximumOpacity,
        Math.max(PAINT_LIMITS.minimumOpacity, profile.paintOpacity || .72)));
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.opacity.needsUpdate = true;
    this.pose.needsUpdate = this.region.needsUpdate = true;
    for (const attribute of this.walls) attribute.needsUpdate = true;
    this.mesh.visible = true;
    return true;
  }

  remove(slot) {
    const record = this.records[slot];
    if (!record.active) return;
    record.active = false;
    record.platform = record.parent = record.piece = null;
    record.platformId = null;
    this.count--;
    for (let i = 0; i < PAINT_LIMITS.blobsPerMark; i++) this.opacity.setX(slot * PAINT_LIMITS.blobsPerMark + i, 0);
    this.opacity.needsUpdate = true;
  }

  clearPlatform(platformId) {
    for (let i = 0; i < this.capacity; i++) if (this.records[i].platformId === platformId) this.remove(i);
  }

  update() {
    this.mesh.visible = this.count > 0;
    if (!this.count) { if (this.debugLines) this.debugLines.geometry.setDrawRange(0, 0); return; }
    this.mesh.updateWorldMatrix(true, false);
    this.inverse.copy(this.mesh.matrixWorld).invert();
    let debugCount = 0;
    for (let slot = 0; slot < this.capacity; slot++) {
      const record = this.records[slot];
      if (!record.active) continue;
      if (!record.platform.active || record.parent.userData.shattered
        || record.parent.userData.platformResources?.disposed || record.piece.parent !== record.parent || !record.parent.parent) {
        this.remove(slot);
        continue;
      }
      record.piece.updateWorldMatrix(true, false);
      for (let blob = 0; blob < record.blobs; blob++) {
        this.matrix.multiplyMatrices(this.inverse, record.piece.matrixWorld).multiply(record.matrices[blob]);
        this.mesh.setMatrixAt(slot * PAINT_LIMITS.blobsPerMark + blob, this.matrix);
      }
      if (this.debugLines?.visible) {
        this.debugPoint.set(0, .025, 0).applyMatrix4(record.piece.matrixWorld);
        this.debugPositions.setXYZ(debugCount++, this.debugPoint.x, this.debugPoint.y, this.debugPoint.z);
        this.debugPoint.set(record.localX, .025, record.localZ).applyMatrix4(record.piece.matrixWorld);
        this.debugPositions.setXYZ(debugCount++, this.debugPoint.x, this.debugPoint.y, this.debugPoint.z);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.debugLines?.visible) {
      this.debugPositions.needsUpdate = true;
      this.debugLines.geometry.setDrawRange(0, debugCount);
    }
  }

  setAttachmentDebug(enabled) {
    if (enabled && !this.debugLines) {
      const geometry = new THREE.BufferGeometry();
      this.debugPositions = new THREE.BufferAttribute(new Float32Array(this.capacity * 6), 3);
      this.debugPositions.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', this.debugPositions);
      geometry.setDrawRange(0, 0);
      this.debugLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#edbe58', depthTest: false, transparent: true, opacity: .85 }));
      this.debugLines.name = 'Paint attachment: piece pivot to local contact';
      this.debugLines.frustumCulled = false;
      this.debugLines.renderOrder = 12;
      this.mesh.parent.add(this.debugLines);
    }
    if (this.debugLines) this.debugLines.visible = Boolean(enabled);
  }

  clear() {
    for (let i = 0; i < this.capacity; i++) this.remove(i);
    this.serial = 0;
    this.mesh.visible = false;
    if (this.debugLines) this.debugLines.geometry.setDrawRange(0, 0);
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    if (this.debugLines) {
      this.debugLines.removeFromParent();
      this.debugLines.geometry.dispose();
      this.debugLines.material.dispose();
    }
    this.disposed = true;
  }
}
