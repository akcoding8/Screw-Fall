import * as THREE from 'three';
import { CONFIG } from './config.js';
import { VISUAL_CONFIG } from './VisualConfig.js';
import { evaluatePlatformRenderMotion } from './PlatformMotion.js';

const TAU = Math.PI * 2;
const disposedGeometry = new WeakSet();
const materialCache = new Map();
const disposedInstances = new WeakSet();
const instanceTransform = new THREE.Object3D();
const topColor = new THREE.Color();
const sideColor = new THREE.Color();

const defaults = {
  safe: '#d5e8dc',
  hazard: '#f47d69',
  finish: '#91d6ba',
  mark: '#773f39',
};

/** A shared bevelled unit wall retains the exact visible collision dimensions. */
function wallGeometry(colors) {
  const bevel = .025;
  const edge = .5 - bevel;
  const shape = new THREE.Shape();
  shape.moveTo(-edge, -edge);
  shape.lineTo(edge, -edge);
  shape.lineTo(edge, edge);
  shape.lineTo(-edge, edge);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1 - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 1, steps: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -.5 + bevel);
  const normal = geometry.attributes.normal;
  const colorsAttribute = new THREE.BufferAttribute(new Float32Array(normal.count * 3), 3);
  topColor.set(colors.hazard);
  sideColor.set(colors.hazardSide || colors.hazard);
  for (let i = 0; i < normal.count; i++) {
    const top = Math.max(0, normal.getY(i));
    colorsAttribute.setXYZ(i,
      sideColor.r + (topColor.r - sideColor.r) * top,
      sideColor.g + (topColor.g - sideColor.g) * top,
      sideColor.b + (topColor.b - sideColor.b) * top);
  }
  geometry.setAttribute('color', colorsAttribute);
  return geometry;
}

function acquireMaterials(palette = {}) {
  const colors = { ...defaults, ...palette, mark: palette.mark || palette.accent || defaults.mark };
  const key = [colors.safe, colors.safeSide, colors.hazard, colors.hazardSide, colors.hazardDetail, colors.finish, colors.mark].join('|');
  let entry = materialCache.get(key);
  if (!entry) {
    entry = {
      refs: 0,
      safe: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.48, metalness: 0.02 }),
      safeSide: new THREE.MeshStandardMaterial({ color: colors.safeSide || colors.safe, roughness: .6 }),
      hazard: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, emissive: colors.hazard, emissiveIntensity: VISUAL_CONFIG.hazardEmissiveMin, roughness: 0.48 }),
      hazardSide: new THREE.MeshStandardMaterial({ color: colors.hazardSide || colors.hazard, roughness: .6 }),
      finish: new THREE.MeshStandardMaterial({ color: colors.finish, roughness: 0.4, metalness: 0.08 }),
      mark: new THREE.MeshStandardMaterial({ color: colors.hazardDetail || colors.mark, roughness: 0.65 }),
      finishLine: new THREE.MeshStandardMaterial({ color: '#f4f5e6', roughness: 0.5 }),
      ribGeometry: new THREE.BoxGeometry(VISUAL_CONFIG.hazardRibWidth, VISUAL_CONFIG.hazardRibHeight, VISUAL_CONFIG.hazardRibLength),
      wallGeometry: wallGeometry(colors),
    };
    materialCache.set(key, entry);
  }
  entry.refs += 1;
  return { entry, key };
}

function releaseMaterials({ entry, key }) {
  entry.refs -= 1;
  if (entry.refs !== 0) return;
  for (const value of Object.values(entry)) {
    if (value?.isMaterial) value.dispose();
    else if (value?.isBufferGeometry) disposeGeometry(value);
  }
  materialCache.delete(key);
}

function disposeGeometry(geometry) {
  if (!disposedGeometry.has(geometry)) {
    geometry.dispose();
    disposedGeometry.add(geometry);
  }
}

/** A wrap-around arc uses the positive angular distance from start to end. */
function arcLength(start, end) {
  const difference = end - start;
  if (Math.abs(difference) >= TAU - 1e-6) return TAU;
  return ((difference % TAU) + TAU) % TAU;
}

/**
 * Extrusion takes place in shape XY, then maps shape Y onto world Z and
 * extrusion depth downward onto world Y. Compensating for the bevel keeps
 * the flat collision surface at precisely local Y = 0.
 */
function sectorGeometry(inner, outer, start, end, thickness, pivotX, pivotZ) {
  const shape = new THREE.Shape();
  shape.moveTo(Math.cos(start) * outer, Math.sin(start) * outer);
  shape.absarc(0, 0, outer, start, end, false);
  shape.lineTo(Math.cos(end) * inner, Math.sin(end) * inner);
  shape.absarc(0, 0, inner, end, start, true);
  shape.closePath();
  const bevel = Math.min(0.034, thickness * 0.15);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.65,
    bevelSegments: 1,
    steps: 1,
    // Coherent slices retain the same smooth, bevelled platform surfaces.
    curveSegments: Math.max(3, Math.ceil((end - start) * 8)),
  });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(-pivotX, -bevel, -pivotZ);
  return geometry;
}

function surfaceMarks(inner, outer, start, end, pivotX, pivotZ, height = 0.008) {
  const vertices = [];
  const span = end - start;
  const count = Math.max(1, Math.floor(span / 0.15));
  for (let index = 0; index < count; index += 1) {
    const angle = start + (index + 0.5) * span / count;
    // A slight slant makes these read as hazard hatching, not small gaps.
    const half = Math.min(0.025, span / (count * 5));
    const points = [
      [Math.cos(angle - half) * inner - pivotX, height, Math.sin(angle - half) * inner - pivotZ],
      [Math.cos(angle + half) * inner - pivotX, height, Math.sin(angle + half) * inner - pivotZ],
      [Math.cos(angle + half + 0.035) * outer - pivotX, height, Math.sin(angle + half + 0.035) * outer - pivotZ],
      [Math.cos(angle - half + 0.035) * outer - pivotX, height, Math.sin(angle - half + 0.035) * outer - pivotZ],
    ];
    for (const p of [0, 1, 2, 0, 2, 3]) vertices.push(...points[p]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function addOwnedMesh(parent, geometry, material, resources) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  parent.add(mesh);
  resources.geometries.push(geometry);
  resources.meshes.push(mesh);
  return mesh;
}

function colorSurface(geometry, kind, palette) {
  const fallback = kind === 'hazard' ? defaults.hazard : defaults.safe;
  topColor.set(palette[kind] || fallback);
  sideColor.set(palette[`${kind}Side`] || palette[kind] || fallback);
  let attribute = geometry.attributes.color;
  if (!attribute) {
    attribute = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3);
    geometry.setAttribute('color', attribute);
  }
  // Extrusion already separates cap/side vertices. Vertex colours preserve
  // palette depth in one draw per chunk instead of doubling material passes.
  for (const group of geometry.groups) {
    const color = group.materialIndex === 0 ? topColor : sideColor;
    for (let i = group.start; i < group.start + group.count; i++) attribute.setXYZ(i, color.r, color.g, color.b);
  }
  attribute.needsUpdate = true;
}

/** Shared palette phases keep hazard detail slow and avoid per-obstacle timers. */
export function updateHazardMaterials(time) {
  const intensity = VISUAL_CONFIG.hazardEmissiveMin + VISUAL_CONFIG.hazardEmissiveRange
    * (.5 + .5 * Math.sin(time * Math.PI * 2 * VISUAL_CONFIG.hazardPulseHz));
  for (const { hazard } of materialCache.values()) hazard.emissiveIntensity = intensity;
}

// A breathing arc deforms existing buffers in polar coordinates. Radius/height
// stay fixed; only each vertex's angle changes with the authoritative segment.
function bindAngularGeometry(geometry, start, end, pivotX, pivotZ) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const data = new Float32Array(position.count * 6);
  const center = (start + end) / 2;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) + pivotX;
    const z = position.getZ(i) + pivotZ;
    let angle = Math.atan2(z, x);
    angle += Math.round((center - angle) / TAU) * TAU;
    const cos = Math.cos(angle), sin = Math.sin(angle), at = i * 6;
    data[at] = Math.hypot(x, z);
    data[at + 1] = (angle - start) / (end - start);
    data[at + 2] = position.getY(i);
    data[at + 3] = normal.getX(i) * cos + normal.getZ(i) * sin;
    data[at + 4] = -normal.getX(i) * sin + normal.getZ(i) * cos;
    data[at + 5] = normal.getY(i);
  }
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  return { geometry, data };
}

function deformAngularGeometry(binding, start, end, pivotX, pivotZ) {
  const { geometry, data } = binding;
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  for (let i = 0; i < position.count; i++) {
    const at = i * 6, angle = start + data[at + 1] * (end - start);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    position.setXYZ(i, data[at] * cos - pivotX, data[at + 2], data[at] * sin - pivotZ);
    normal.setXYZ(i, data[at + 3] * cos - data[at + 4] * sin, data[at + 5], data[at + 3] * sin + data[at + 4] * cos);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  // The platform's full radial sphere is conservative for every gap width.
  // It is installed once at creation rather than recomputed every frame.
}

function placeRibs(mesh, start, end, pivotX, pivotZ) {
  const radius = CONFIG.world.outerRadius - .33;
  for (let i = 0; i < mesh.count; i++) {
    const angle = start + (i + .5) * (end - start) / mesh.count;
    instanceTransform.position.set(Math.cos(angle) * radius - pivotX,
      VISUAL_CONFIG.hazardRibHeight / 2 + .005, Math.sin(angle) * radius - pivotZ);
    instanceTransform.rotation.set(0, Math.PI / 2 - angle - .18, 0);
    instanceTransform.scale.setScalar(1);
    instanceTransform.updateMatrix();
    mesh.setMatrixAt(i, instanceTransform.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Create one circular platform from inspectable simulation data.
 *
 * Polar data uses X = r cos(angle), Z = r sin(angle). Three.js positive Y
 * rotation changes that polar angle in the opposite direction, so the
 * platform's mathematical base rotation is deliberately negated here.
 * Direct children are centered fragment groups ready for scene.attach().
 */
export function createPlatform(platform, palette = {}) {
  const inner = CONFIG.world.innerRadius;
  const outer = CONFIG.world.outerRadius;
  const thickness = CONFIG.world.platformThickness;
  const group = new THREE.Group();
  group.name = platform.finish ? 'Finish floor' : `Platform ${platform.id}`;
  group.position.y = platform.y;
  group.rotation.y = -(platform.motionState?.rotation ?? platform.baseRotation ?? 0);
  group.userData.platformId = platform.id;
  group.userData.id = platform.id;
  group.userData.finish = Boolean(platform.finish);
  group.userData.variant = platform.motion?.variant || null;
  const lease = acquireMaterials(palette);
  const resources = { lease, geometries: [], meshes: [], sharedMeshes: [], pieces: [], disposed: false };
  group.userData.platformResources = resources;
  const initialState = platform.motion
    ? evaluatePlatformRenderMotion(platform, platform.motionState?.time || 0) : platform;
  group.rotation.y = -(initialState.rotation ?? platform.baseRotation ?? 0);

  if (platform.finish) {
    const floor = new THREE.Group();
    group.add(floor);
    const geometry = new THREE.CylinderGeometry(outer + 0.13, outer + 0.13, thickness * 1.5, 72);
    geometry.translate(0, -thickness * 0.75, 0);
    addOwnedMesh(floor, geometry, lease.entry.finish, resources);
    for (const radius of [inner + 0.2, outer - 0.22]) {
      const ring = new THREE.RingGeometry(radius - 0.025, radius + 0.025, 72);
      ring.rotateX(-Math.PI / 2);
      ring.translate(0, 0.008, 0);
      addOwnedMesh(floor, ring, lease.entry.finishLine, resources);
    }
    // Four quiet radial markers make the goal recognizable from any rotation.
    for (let i = 0; i < 4; i += 1) {
      const angle = i * Math.PI / 2;
      const mark = new THREE.BoxGeometry(0.065, 0.01, 0.22);
      mark.rotateY(-angle);
      mark.translate(Math.cos(angle) * (outer - 0.48), 0.009, Math.sin(angle) * (outer - 0.48));
      addOwnedMesh(floor, mark, lease.entry.finishLine, resources);
    }
    return group;
  }

  const segments = initialState.segments;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex];
    const length = arcLength(segment.start, segment.end);
    if (length < 1e-5) continue;
    const chunks = Math.max(1, Math.ceil(length / CONFIG.particles.fragmentChunkAngle));
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const start = segment.start + length * chunk / chunks;
      const end = segment.start + length * (chunk + 1) / chunks;
      const centerAngle = (start + end) / 2;
      const pivotRadius = (inner + outer) / 2;
      const pivotX = Math.cos(centerAngle) * pivotRadius;
      const pivotZ = Math.sin(centerAngle) * pivotRadius;
      const piece = new THREE.Group();
      piece.position.set(pivotX, 0, pivotZ);
      piece.userData.fragment = true;
      piece.userData.kind = segment.kind;
      piece.userData.tipSide = segment.tipSide || null;
      if (segment.tipSide) piece.name = `Moving ${segment.tipSide} hazard tip`;
      piece.userData.arc = { segmentIndex, from: chunk / chunks, to: (chunk + 1) / chunks, start, end, deformers: [], ribs: null };
      // Conservative sphere around the pivot, including bevels and hatching.
      // Store it once so debris frustum checks allocate nothing per frame.
      piece.userData.fragmentRadius = Math.hypot(
        outer - pivotRadius,
        2 * outer * Math.sin((end - start) / 4),
        thickness,
      ) + 0.05;
      group.add(piece);
      resources.pieces.push(piece);
      const surface = addOwnedMesh(
        piece,
        sectorGeometry(inner, outer, start, end, thickness, pivotX, pivotZ),
        segment.kind === 'hazard' ? lease.entry.hazard : lease.entry.safe,
        resources,
      );
      surface.userData.surfaceKind = segment.kind;
      colorSurface(surface.geometry, segment.kind, palette);
      if (platform.type === 'breathing') {
        surface.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer * 2);
        piece.userData.arc.deformers.push(bindAngularGeometry(surface.geometry, start, end, pivotX, pivotZ));
      }
      if (segment.kind === 'hazard') {
        const marks = addOwnedMesh(piece, surfaceMarks(outer - .55, outer - .12, start, end, pivotX, pivotZ), lease.entry.mark, resources);
        if (platform.type === 'breathing') {
          marks.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer * 2);
          piece.userData.arc.deformers.push(bindAngularGeometry(marks.geometry, start, end, pivotX, pivotZ));
        }
        const ribs = new THREE.InstancedMesh(lease.entry.ribGeometry, lease.entry.mark,
          Math.max(1, Math.floor(length / chunks / VISUAL_CONFIG.hazardRibSpacing)));
        ribs.userData.sharedGeometry = true;
        ribs.frustumCulled = false;
        ribs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        piece.add(ribs);
        resources.meshes.push(ribs);
        resources.sharedMeshes.push({ mesh: ribs, key: 'ribGeometry' });
        piece.userData.arc.ribs = ribs;
        placeRibs(ribs, start, end, pivotX, pivotZ);
      }
    }
  }
  for (const wall of platform.walls || []) addWall(group, wall, resources);
  return group;
}

function addWall(group, wall, resources) {
  // Walls travel with their host chunk when destroyed; no extra debris pieces.
  let host = null;
  for (const piece of resources.pieces) {
    const { start, end } = piece.userData.arc;
    const angle = wall.angle + Math.round(((start + end) / 2 - wall.angle) / TAU) * TAU;
    if (piece.userData.kind === 'safe' && angle >= start && angle <= end) { host = piece; break; }
  }
  if (!host) throw new Error(`Wall on ${group.name} must belong to a safe arc`);
  const radius = (wall.innerRadius + wall.outerRadius) / 2;
  // Every vertical wall uses the exact shared killer-surface pulse and palette
  // family. Vertex colours retain a darker side and a brighter bevel/top.
  const mesh = new THREE.Mesh(resources.lease.entry.wallGeometry, resources.lease.entry.hazard);
  mesh.name = wall.type === 'low' ? 'Low hazard wall' : 'Hazard divider';
  mesh.userData.wall = wall;
  mesh.userData.sharedGeometry = true;
  mesh.position.set(Math.cos(wall.angle) * radius - host.position.x, wall.height / 2, Math.sin(wall.angle) * radius - host.position.z);
  mesh.rotation.y = Math.PI / 2 - wall.angle;
  mesh.scale.set(wall.width, wall.height, wall.outerRadius - wall.innerRadius);
  host.add(mesh);
  resources.meshes.push(mesh);
  resources.sharedMeshes.push({ mesh, key: 'wallGeometry' });
  const cap = new THREE.Mesh(resources.lease.entry.wallGeometry, resources.lease.entry.mark);
  cap.name = 'Hazard wall top accent';
  cap.userData.sharedGeometry = true;
  cap.position.copy(mesh.position);
  cap.position.y = wall.height - VISUAL_CONFIG.wallEdgeWidth / 2;
  cap.rotation.copy(mesh.rotation);
  cap.scale.set(wall.width, VISUAL_CONFIG.wallEdgeWidth, wall.outerRadius - wall.innerRadius);
  host.add(cap);
  resources.meshes.push(cap);
  resources.sharedMeshes.push({ mesh: cap, key: 'wallGeometry' });
  host.userData.fragmentRadius = Math.hypot(host.userData.fragmentRadius, wall.height);
}

/** Display sampling is optional; destruction defaults to exact impact state. */
export function updatePlatformView(group, platform, state = platform.motionState) {
  if (group.userData.shattered) return;
  group.rotation.y = -(state?.rotation ?? platform.baseRotation ?? 0);
  if (platform.type !== 'breathing' || !state) return;
  const resources = group.userData.platformResources;
  const pivotRadius = (CONFIG.world.innerRadius + CONFIG.world.outerRadius) / 2;
  for (const piece of resources.pieces) {
    const arc = piece.userData.arc, segment = state.segments[arc.segmentIndex];
    const length = arcLength(segment.start, segment.end);
    const start = segment.start + length * arc.from, end = segment.start + length * arc.to;
    if (arc.start === start && arc.end === end) continue;
    arc.start = start; arc.end = end;
    const angle = (start + end) / 2, x = Math.cos(angle) * pivotRadius, z = Math.sin(angle) * pivotRadius;
    piece.position.set(x, 0, z);
    for (const binding of arc.deformers) deformAngularGeometry(binding, start, end, x, z);
    if (arc.ribs) placeRibs(arc.ribs, start, end, x, z);
    piece.userData.fragmentRadius = Math.hypot(CONFIG.world.outerRadius - pivotRadius,
      2 * CONFIG.world.outerRadius * Math.sin((end - start) / 4), CONFIG.world.platformThickness) + .05;
  }
}

/** Recolour existing meshes, preserving geometry, motion, and detached debris. */
export function setPlatformPalette(group, palette) {
  const resources = group.userData.platformResources;
  if (resources.disposed) return;
  const previous = resources.lease, next = acquireMaterials(palette);
  const keys = Object.keys(previous.entry).filter(key => previous.entry[key]?.isMaterial);
  const replacement = material => next.entry[keys.find(key => previous.entry[key] === material)] || material;
  for (const mesh of resources.meshes) {
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(replacement) : replacement(mesh.material);
    if (mesh.userData.surfaceKind && !disposedGeometry.has(mesh.geometry)) colorSurface(mesh.geometry, mesh.userData.surfaceKind, palette);
  }
  for (const { mesh, key } of resources.sharedMeshes) mesh.geometry = next.entry[key];
  resources.lease = next;
  releaseMaterials(previous);
}

/** Release expired debris geometry while retaining its platform's material lease. */
export function disposeFragment(piece) {
  piece.traverse((child) => {
    if (child.geometry && !child.userData.sharedGeometry) disposeGeometry(child.geometry);
    if (child.isInstancedMesh && !disposedInstances.has(child)) { child.dispose(); disposedInstances.add(child); }
  });
  piece.removeFromParent();
}

/** Clear detached particles first, then release each old platform exactly once. */
export function disposePlatform(group) {
  const resources = group.userData.platformResources;
  if (!resources || resources.disposed) return;
  for (const geometry of resources.geometries) disposeGeometry(geometry);
  for (const mesh of resources.meshes) {
    if (mesh.isInstancedMesh && !disposedInstances.has(mesh)) { mesh.dispose(); disposedInstances.add(mesh); }
  }
  releaseMaterials(resources.lease);
  resources.disposed = true;
  group.removeFromParent();
  group.clear();
}
