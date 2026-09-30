import * as THREE from 'three';
import { CONFIG } from './config.js';
import { GENERATION } from './GenerationConfig.js';
import { simulateFlowController } from './FlowFeasibility.js';

/** Built only on an explicit debug request; no controller runs in a render loop. */
export class DebugFlowView {
  constructor(level, tower, graph) {
    this.level = level;
    this.tower = tower;
    this.graph = graph;
    this.visible = false;
    this.lines = [];
  }

  toggle() {
    this.visible = !this.visible;
    if (this.visible && !this.lines.length) this.build();
    for (const line of this.lines) line.visible = this.visible;
    if (this.graph) this.graph.hidden = !this.visible;
    return this.visible;
  }

  addTrajectory(points, color, name) {
    const vertices = [];
    let previous;
    for (const point of points) {
      const angle = point.angle;
      const radius = CONFIG.world.ballOrbitRadius;
      const position = [Math.cos(angle) * radius, point.y, Math.sin(angle) * radius];
      if (previous) vertices.push(...previous, ...position);
      previous = position;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: .85 }));
    line.name = name;
    line.renderOrder = 6;
    this.tower.add(line);
    this.lines.push(line);
  }

  build() {
    const ideal = simulateFlowController(this.level, { mode: 'ideal', trial: 0, trace: true });
    const skilled = simulateFlowController(this.level, { mode: 'skilled', trial: 0, trace: true });
    this.addTrajectory(ideal.trajectory, '#60cbff', 'Debug ideal Flow trajectory');
    this.addTrajectory(skilled.trajectory, '#ef81dc', 'Debug skilled Flow trajectory');
    const difficult = this.level.flow.feasibility.skilled.difficultSections;
    if (difficult.length) {
      const vertices = [];
      for (const section of difficult) {
        const platform = this.level.platforms[section.index];
        const angle = platform.route.angle, radius = CONFIG.world.ballOrbitRadius;
        const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
        vertices.push(x - .12, platform.y + .12, z, x + .12, platform.y - .12, z, x + .12, platform.y + .12, z, x - .12, platform.y - .12, z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const markers = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#ff8c70', depthTest: false }));
      markers.name = 'Debug predicted Flow difficult sections'; markers.renderOrder = 7;
      this.tower.add(markers); this.lines.push(markers);
    }
    if (!this.graph) return;
    const dt = CONFIG.world.platformSpacing / CONFIG.physics.maxDownwardSpeed;
    const rates = this.level.route.slice(1).map((point, index) => Math.abs(point.angle - this.level.route[index].angle) / dt);
    const routeLimit = GENERATION.flow.maxTurnSpeed;
    const max = CONFIG.input.sensitivity * CONFIG.input.multiplier.default * GENERATION.flow.human.viewportSpeed;
    const routeY = (95 - routeLimit / max * 70).toFixed(2);
    const points = rates.map((rate, index) => `${(10 + index * 280 / (rates.length - 1)).toFixed(2)},${(95 - rate / max * 70).toFixed(2)}`).join(' ');
    this.graph.innerHTML = `<svg viewBox="0 0 300 115" role="img" aria-label="Flow required angular rate, blue; route limit ${routeLimit.toFixed(2)} and human steering capacity ${max.toFixed(2)} radians per second"><path d="M10 25H290" stroke="#ef81dc" stroke-dasharray="4 4" fill="none"/><path d="M10 ${routeY}H290" stroke="#c9b879" stroke-dasharray="2 3" fill="none"/><path d="M10 95H290" stroke="#748d87"/><polyline points="${points}" fill="none" stroke="#60cbff" stroke-width="2"/><text x="10" y="14" fill="currentColor" font-size="10">${max.toFixed(2)} human · ${routeLimit.toFixed(2)} route rad/s</text><text x="10" y="110" fill="currentColor" font-size="10">Opening → finish</text></svg><span>Blue: ideal · pink: skilled trial 1 · orange: difficult sections · Route: openings</span>`;
  }

  dispose() {
    for (const line of this.lines) {
      line.removeFromParent(); line.geometry.dispose(); line.material.dispose();
    }
    this.lines.length = 0;
    if (this.graph) { this.graph.replaceChildren(); this.graph.hidden = true; }
    this.level = this.tower = this.graph = null;
  }
}
