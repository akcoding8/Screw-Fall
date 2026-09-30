import * as THREE from 'three';
import { CONFIG } from './config.js';
import { HAZARD_EDGE_INSET, HAZARD_COLLISION } from './HazardCollision.js';
import { minimumSafeAngularWidth } from './PlatformSilhouettes.js';
import { getPlatformState, evaluatePlatformRenderMotion } from './PlatformMotion.js';
import { getWallBounds } from './WallCollisionResolver.js';
import { normalizeAngle, TAU } from './math.js';

const height = .055;

function arc(vertices, center, halfWidth, y, radius = CONFIG.world.ballOrbitRadius) {
  for (let i = 0; i < 16; i++) {
    for (const fraction of [i / 16, (i + 1) / 16]) {
      const angle = center - halfWidth + 2 * halfWidth * fraction;
      vertices.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }
  }
}

function lines(vertices, color) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const mesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .9, depthTest: false }));
  mesh.renderOrder = 5;
  return mesh;
}

function wallBoundsLines(wall, minRadius, maxRadius, halfWidth, minY, maxY, color) {
  const vertices = [];
  const corners = [];
  const cosine = Math.cos(wall.angle), sine = Math.sin(wall.angle);
  for (const y of [minY, maxY]) for (const radius of [minRadius, maxRadius]) for (const across of [-halfWidth, halfWidth]) {
    corners.push([cosine * radius - sine * across, y, sine * radius + cosine * across]);
  }
  for (const pair of [[0, 1], [2, 3], [0, 2], [1, 3], [4, 5], [6, 7], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) {
    vertices.push(...corners[pair[0]], ...corners[pair[1]]);
  }
  return lines(vertices, color);
}

function ballSphereLines() {
  const vertices = [];
  const radius = CONFIG.physics.ballRadius;
  for (let plane = 0; plane < 3; plane++) for (let i = 0; i < 32; i++) for (let side = 0; side < 2; side++) {
    const angle = (i + side) * TAU / 32;
    const a = Math.cos(angle) * radius, b = Math.sin(angle) * radius;
    vertices.push(plane === 0 ? 0 : a, plane === 1 ? 0 : plane === 0 ? a : b, plane === 2 ? 0 : b);
  }
  return lines(vertices, '#69caff');
}

/** Optional inspection geometry is built once, and never enters physical/debris data. */
export class DebugGeometry {
  constructor(level, platformViews, tower) {
    this.groups = {};
    this.owned = [];
    this.platformRecords = [];
    this.wallRecords = [];
    this.tower = tower;
    for (const name of ['drops', 'gaps', 'footprint', 'hazards', 'walls']) {
      const group = new THREE.Group();
      group.name = `Debug ${name}`;
      group.visible = false;
      tower.add(group);
      this.groups[name] = group;
    }
    this.ballSphere = ballSphereLines();
    this.ballSphere.visible = false;
    this.add(this.groups.walls, this.ballSphere);
    const drops = [];
    for (const drop of level.plannedDrops || level.smashOpportunities || []) {
      const first = level.platforms[drop.start];
      const last = level.platforms[drop.catchIndex];
      const halfWidth = Math.min(...level.platforms.slice(drop.start, drop.start + drop.passes)
        .map(platform => platform.route.halfWidth));
      for (const sign of [-1, 1]) {
        const a = drop.angle + sign * halfWidth;
        drops.push(Math.cos(a) * CONFIG.world.ballOrbitRadius, first.y + height, Math.sin(a) * CONFIG.world.ballOrbitRadius,
          Math.cos(a) * CONFIG.world.ballOrbitRadius, last.y + height, Math.sin(a) * CONFIG.world.ballOrbitRadius);
      }
    }
    this.add(this.groups.drops, lines(drops, '#ffc13b'));
    const shared = [];
    for (const window of level.gapAlignment?.windows || []) {
      for (const interval of window.intervals) {
        for (let i = window.start; i < window.start + window.length; i++) {
          arc(shared, (interval.start + interval.end) / 2, (interval.end - interval.start) / 2, level.platforms[i].y + height * 2);
        }
      }
    }
    this.add(this.groups.gaps, lines(shared, '#ff71da'));
    for (const platform of level.platforms) {
      if (platform.finish) continue;
      const parent = platformViews.get(platform.id);
      const footprint = [];
      arc(footprint, platform.landingAngle ?? Math.PI, minimumSafeAngularWidth() / 2, height);
      const foot = lines(footprint, '#39bfff');
      foot.visible = false;
      this.add(parent, foot);
      const hazards = platform.segments.filter(segment => segment.kind === 'hazard');
      const edge = lines(new Float32Array(hazards.length * 24), '#ffffff');
      edge.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), CONFIG.world.outerRadius + .1);
      const colors = new Float32Array(hazards.length * 24);
      const visual = new THREE.Color('#ff6b74'), effective = new THREE.Color('#63ffb1');
      for (let i = 0; i < colors.length / 3; i++) (i % 8 < 4 ? visual : effective).toArray(colors, i * 3);
      edge.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      edge.material.vertexColors = true;
      edge.visible = false;
      this.add(parent, edge);
      const record = { platform, foot, edge };
      this.platformRecords.push(record);
      this.writeHazardEdges(record);
      for (const wall of platform.walls || []) {
        const bounds = getWallBounds(platform, wall);
        const visible = wallBoundsLines(wall, wall.innerRadius, wall.outerRadius, wall.width / 2, 0, wall.height, '#ff718b');
        const effective = wallBoundsLines(wall, bounds.minRadius, bounds.maxRadius, bounds.halfWidth,
          bounds.minY - platform.y, bounds.maxY - platform.y, '#64f8ac');
        const meshes = [visible, effective];
        if (wall.type === 'low') meshes.push(wallBoundsLines(wall, wall.innerRadius, wall.outerRadius,
          wall.width / 2 + CONFIG.physics.ballRadius, bounds.maxY - platform.y, bounds.maxY - platform.y, '#ffd16f'));
        for (const mesh of meshes) { mesh.visible = false; this.add(parent, mesh); }
        this.wallRecords.push({ platform, wall, bounds, visible, effective, clearance: meshes[2], meshes });
      }
    }
  }

  add(parent, mesh) {
    parent.add(mesh);
    this.owned.push(mesh);
  }

  writeHazardEdges({ platform, edge }, renderTime) {
    const positions = edge.geometry.attributes.position;
    let offset = 0;
    const state = Number.isFinite(renderTime) ? evaluatePlatformRenderMotion(platform, renderTime) : getPlatformState(platform);
    for (const segment of state.segments) {
      if (segment.kind !== 'hazard') continue;
      const width = Math.abs(segment.end - segment.start) >= TAU ? TAU : normalizeAngle(segment.end - segment.start);
      const inset = width >= TAU ? 0 : Math.min(HAZARD_EDGE_INSET, width * HAZARD_COLLISION.maximumArcFraction);
      // Four radial lines: two visible edges, then two inset collision edges.
      for (let boundary = 0; boundary < 4; boundary++) {
        const angle = boundary === 0 ? segment.start : boundary === 1 ? segment.end
          : boundary === 2 ? segment.start + inset : segment.start + width - inset;
        for (let side = 0; side < 2; side++) {
          const radius = side ? CONFIG.world.outerRadius : CONFIG.world.innerRadius;
          positions.array[offset++] = Math.cos(angle) * radius;
          positions.array[offset++] = height;
          positions.array[offset++] = Math.sin(angle) * radius;
        }
      }
    }
    positions.needsUpdate = true;
  }

  toggle(name) {
    const group = this.groups[name];
    if (!group) return false;
    group.visible = !group.visible;
    this.update();
    return group.visible;
  }

  update(renderTime, ballY) {
    const footprints = this.groups.footprint.visible;
    const hazards = this.groups.hazards.visible;
    for (const record of this.platformRecords) {
      record.foot.visible = footprints && record.platform.active;
      record.edge.visible = hazards && record.platform.active;
      if (record.edge.visible && record.platform.motion) this.writeHazardEdges(record, renderTime);
    }
    const walls = this.groups.walls.visible;
    for (const record of this.wallRecords) {
      const visible = walls && record.platform.active && record.wall.active !== false;
      for (const mesh of record.meshes) mesh.visible = visible;
    }
    this.ballSphere.visible = walls && Number.isFinite(ballY);
    if (this.ballSphere.visible) {
      const angle = CONFIG.world.ballWorldAngle + this.tower.rotation.y;
      this.ballSphere.position.set(Math.cos(angle) * CONFIG.world.ballOrbitRadius, ballY,
        Math.sin(angle) * CONFIG.world.ballOrbitRadius);
    }
  }

  dispose() {
    for (const mesh of this.owned) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    for (const group of Object.values(this.groups)) group.removeFromParent();
    this.owned.length = 0;
    this.platformRecords.length = 0;
    this.wallRecords.length = 0;
  }
}
