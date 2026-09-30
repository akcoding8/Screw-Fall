import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { MOTION_LIMITS } from '../src/game/ObstacleConfig.js';
import { HAZARD_EDGE_INSET, effectiveHazardArc } from '../src/game/HazardCollision.js';
import { BREATHING_VARIANTS, PINCER_CONFIG, createBreathingSegments,
  minimumPincerOpening, pincerOpeningMetrics, validatePincerMotion } from '../src/game/PincerGeometry.js';
import { evaluatePlatformMotion, evaluatePlatformRenderMotion, classifyPlatformAtTime } from '../src/game/PlatformMotion.js';
import { createPlatform, updatePlatformView, setPlatformPalette, disposePlatform } from '../src/game/Platform.js';
import { ParticleSystem } from '../src/game/ParticleSystem.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { normalizeAngle, TAU } from '../src/game/math.js';

const variants = [
  ['breathing-safe', 'left', 0],
  ['breathing-single-tip', 'left', 1],
  ['breathing-single-tip', 'right', 1],
  ['breathing-double-pincer', 'left', 2],
];

function pincer(variant = 'breathing-double-pincer', tipSide = 'left', overrides = {}) {
  const motion = { type: 'breathing', variant, tipSide, tipWidth: PINCER_CONFIG.tipWidth,
    minWidth: MOTION_LIMITS.breathing.minWidth, maxWidth: 116 * Math.PI / 180,
    period: 2.7, phase: 0, ...overrides };
  const gapWidth = (motion.minWidth + motion.maxWidth) / 2;
  return { id: 'pincer', index: 0, y: 0, active: true, baseRotation: .2, type: 'breathing',
    gapWidth, motion, walls: [], segments: createBreathingSegments(gapWidth,
      variant, tipSide, motion.tipWidth, motion.gapCenter) };
}

function localKind(platform, angle, time) {
  return classifyPlatformAtTime(platform, angle + platform.baseRotation - CONFIG.world.ballWorldAngle, time);
}

function fixture(platform) {
  return { kind: 'normal', difficultyRating: 5, platforms: [platform,
    { id: 'lower-hazard', index: 1, y: -CONFIG.world.platformSpacing, active: true,
      baseRotation: 0, type: 'static', walls: [], segments: [{ kind: 'hazard', start: 0, end: TAU }] },
    { id: 'finish', y: -100, active: true, finish: true, baseRotation: 0, segments: [], walls: [] }] };
}

describe('hazard pincers share their visible and physical opening', () => {
  it.each(variants)('%s %s creates exactly %i attached hazard tips', (variant, side, count) => {
    const platform = pincer(variant, side);
    expect(validatePincerMotion(platform)).toEqual([]);
    expect(platform.segments.filter(segment => segment.kind === 'hazard')).toHaveLength(count);
    if (count === 1) expect(platform.segments.find(segment => segment.kind === 'hazard').tipSide).toBe(side);
    expect(createBreathingSegments(platform.gapWidth, variant, side)).toEqual(platform.segments);
    for (let frame = 0; frame <= 240; frame++) {
      const state = evaluatePlatformMotion(platform, platform.motion.period * frame / 240);
      expect(state.gapWidth).toBeGreaterThanOrEqual(minimumPincerOpening());
      expect(state.segments[0].start).toBeCloseTo(state.gapWidth / 2, 12);
      expect(state.segments.at(-1).end).toBeCloseTo(TAU - state.gapWidth / 2, 12);
      for (let index = 0; index < state.segments.length; index++) {
        const segment = state.segments[index];
        expect(segment.end).toBeGreaterThan(segment.start);
        if (segment.kind === 'hazard') expect(segment.end - segment.start).toBeCloseTo(platform.motion.tipWidth, 12);
        if (index) expect(segment.start).toBeCloseTo(state.segments[index - 1].end, 12);
      }
      expect(localKind(platform, 0, state.time)).toBe('gap');
    }
  });

  it('calculates real clearance from the full diameter, orbit radius, steering margin, and existing fairness allowance', () => {
    const minimum = minimumPincerOpening();
    const metrics = pincerOpeningMetrics(minimum);
    expect(metrics.minimumWorldWidth).toBeCloseTo(.75, 12);
    expect(metrics.visualWorldWidth).toBeCloseTo(.55 + 2 * .10, 12);
    expect(metrics.visualBallDiameters).toBeCloseTo(.75 / .55, 12);
    expect(metrics.effectiveAngle - metrics.visualAngle).toBeCloseTo(HAZARD_EDGE_INSET * 2, 12);
    expect(2 * CONFIG.world.ballOrbitRadius * Math.sin(metrics.tipInset / 2)).toBeCloseTo(.034, 12);
    expect(metrics.effectiveWorldWidth).toBeGreaterThan(metrics.visualWorldWidth);
    // One tip provides only one forgiving solid shoulder; Safe Breather has none.
    expect(pincerOpeningMetrics(minimum, 'breathing-single-tip').effectiveAngle - minimum).toBeCloseTo(HAZARD_EDGE_INSET, 12);
    expect(pincerOpeningMetrics(minimum, 'breathing-safe').effectiveAngle).toBe(minimum);
  });

  it('uses exact chord conversions safely across different ball and tower radii', () => {
    for (const radius of [.2, .275, .35]) for (const orbit of [1.6, 2.05, 2.5]) {
      const width = minimumPincerOpening(radius, orbit, .10);
      expect(2 * orbit * Math.sin(width / 2)).toBeCloseTo(radius * 2 + .20, 12);
      expect(pincerOpeningMetrics(width, 'breathing-double-pincer', PINCER_CONFIG.tipWidth,
        {}, radius, orbit).visualWorldWidth).toBeCloseTo(radius * 2 + .20, 12);
    }
    expect(() => minimumPincerOpening(.275, .3)).toThrow(RangeError);
    expect(() => minimumPincerOpening(NaN)).toThrow(RangeError);
    expect(() => pincerOpeningMetrics(NaN)).toThrow(RangeError);
    expect(() => createBreathingSegments(TAU, 'breathing-double-pincer')).toThrow(RangeError);
  });

  it.each([-TAU - .12, -.12, TAU - .12, TAU + .12])('classifies wrapped opening and both tip interiors at centre %s', gapCenter => {
    const platform = pincer('breathing-double-pincer', 'left', { gapCenter });
    for (const time of [0, .2, 1.35, 2.69]) {
      const state = evaluatePlatformMotion(platform, time);
      expect(localKind(platform, gapCenter, time)).toBe('gap');
      for (const segment of state.segments.filter(segment => segment.kind === 'hazard')) {
        expect(localKind(platform, (segment.start + segment.end) / 2, time)).toBe('hazard');
        const lethal = effectiveHazardArc(segment);
        expect(localKind(platform, segment.start + lethal.inset * .5, time)).toBe('safe');
        expect(localKind(platform, segment.start + lethal.inset * 1.5, time)).toBe('hazard');
        expect(localKind(platform, segment.end - lethal.inset * .5, time)).toBe('safe');
      }
    }
  });

  it.each([
    ['bad side', p => { p.motion.tipSide = 'up'; p.motion.variant = 'breathing-single-tip'; }],
    ['overlapping tips', p => { p.motion.maxWidth = TAU - p.motion.tipWidth; }],
    ['no steering space', p => { p.motion.minWidth = minimumPincerOpening() - .01; }],
    ['missing tip', p => { p.segments.pop(); }],
    ['nonfinite tip', p => { p.segments[0].start = NaN; }],
    ['wrong source boundary', p => { p.segments[0].end += .02; }],
    ['stale collision boundary', p => { evaluatePlatformMotion(p, .7).segments[0].start += .02; }],
    ['stale collision phase', p => { evaluatePlatformMotion(p, .7).phase += .02; }],
  ])('rejects %s without mutating runtime snapshots', (_, mutate) => {
    const platform = pincer();
    mutate(platform);
    const before = structuredClone(platform);
    expect(validatePincerMotion(platform).length).toBeGreaterThan(0);
    expect(platform).toEqual(before);
  });
});

describe('smooth authoritative pincer animation and collision', () => {
  it.each([1.9, 2.2, 2.7, 3.3, 3.8])('keeps the full corridor and smooth reversals during a %s second cycle', period => {
    const platform = pincer('breathing-double-pincer', 'left', { period });
    const min = evaluatePlatformMotion(platform, 0).gapWidth;
    const max = evaluatePlatformMotion(platform, period / 2).gapWidth;
    expect(min).toBe(platform.motion.minWidth);
    expect(max).toBe(platform.motion.maxWidth);
    expect(max - min).toBeGreaterThan(.7);
    for (const turn of [0, period / 2, period, period * 2]) {
      const at = evaluatePlatformMotion(platform, turn).gapWidth;
      const next = evaluatePlatformMotion(platform, turn + .00001).gapWidth;
      expect(Math.abs(next - at)).toBeLessThan(1e-8);
    }
    expect(validatePincerMotion(platform)).toEqual([]);
  });

  it('samples hazard fairness at exact impact rather than the earlier fixed-step phase', () => {
    const platform = pincer('breathing-double-pincer', 'left', { phase: Math.PI / 2 });
    const events = [], sim = new Simulation({ levelFactory: () => fixture(platform), onEvent: event => events.push(event) });
    const dt = CONFIG.physics.fixedStep, fall = 12 + CONFIG.physics.bounceGravity * dt;
    const impactTime = .05 / fall;
    const tip = evaluatePlatformMotion(platform, impactTime).segments[0];
    const angle = tip.start + HAZARD_EDGE_INSET - .0002;
    expect(localKind(platform, angle, 0)).toBe('hazard');
    expect(localKind(platform, angle, impactTime)).toBe('safe');
    sim.rotation = normalizeAngle(angle + platform.baseRotation - CONFIG.world.ballWorldAngle);
    sim.ball.y = CONFIG.physics.ballRadius + .05;
    sim.ball.velocity = -12;
    sim.step(dt);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(sim.ball.velocity).toBe(CONFIG.physics.bounceVelocity);
    expect(events.some(event => event.type === 'playerDied')).toBe(false);
    expect(events.find(event => event.type === 'platformLanded').impactTime).toBeCloseTo(impactTime, 12);
  });

  it.each(['left', 'right'])('an obvious %s tip contact kills normally and smash-ready rebounds before lower hazards', side => {
    for (const smash of [false, true]) {
      const platform = pincer('breathing-single-tip', side, { phase: 0 });
      const events = [], sim = new Simulation({ levelFactory: () => fixture(platform), onEvent: event => events.push(event) });
      sim.animationPaused = true;
      const tip = platform.motionState.segments.find(segment => segment.kind === 'hazard');
      sim.rotation = normalizeAngle((tip.start + tip.end) / 2 + platform.baseRotation - CONFIG.world.ballWorldAngle);
      sim.state = STATES.ACTIVE;
      sim.ball.y = CONFIG.physics.ballRadius + .05;
      sim.ball.velocity = -sim.maxDownwardSpeed;
      sim.smashReady = smash;
      sim.passCount = smash ? CONFIG.smash.threshold : 0;
      sim.step(.25);
      expect(events.filter(event => event.type === (smash ? 'platformSmashed' : 'playerDied'))).toHaveLength(1);
      expect(sim.platforms[1].active).toBe(true);
      if (smash) {
        expect(sim.state).toBe(STATES.ACTIVE);
        expect(sim.ball.y).toBe(CONFIG.physics.ballRadius);
        expect(sim.ball.velocity).toBe(CONFIG.physics.bounceVelocity);
        expect(sim.smashReady).toBe(false);
        expect(sim.passCount).toBe(0);
        expect(platform.active).toBe(false);
        const frozen = structuredClone(platform.motionState);
        expect(classifyPlatformAtTime(platform, sim.rotation, 100)).toBe('gap');
        expect(evaluatePlatformMotion(platform, 100)).toEqual(frozen);
      } else expect(sim.state).toBe(STATES.DEAD_ANIMATION);
    }
  });

  it('retry restores tips and phase, and paused simulation creates no wall-clock phase jump', () => {
    const sim = new Simulation({ levelFactory: () => fixture(pincer()) });
    const initial = structuredClone(sim.platforms[0].motionState);
    sim.step(.1);
    sim.animationPaused = true;
    const frozen = structuredClone(sim.platforms[0].motionState);
    for (let tick = 0; tick < 30; tick++) sim.step(CONFIG.physics.fixedStep);
    expect(sim.platforms[0].motionState).toEqual(frozen);
    sim.animationPaused = false;
    sim.step(CONFIG.physics.fixedStep);
    expect(sim.animationTime).toBeCloseTo(.1 + CONFIG.physics.fixedStep, 12);
    sim.state = STATES.DEAD_WAITING;
    sim.retry();
    expect(sim.platforms[0].motionState).toEqual(initial);
  });
});

describe('pincer rendering and destruction preserve existing resource architecture', () => {
  it.each(variants)('%s %s reuses geometry and arc buffers across 600 interpolated frames', (variant, side) => {
    const platform = pincer(variant, side);
    const collision = evaluatePlatformMotion(platform, .63);
    const snapshot = structuredClone(collision);
    const view = createPlatform(platform);
    const resources = view.userData.platformResources;
    const geometries = [...resources.geometries], positions = geometries.map(geometry => geometry.attributes.position.array);
    const render = evaluatePlatformRenderMotion(platform, 0), arcs = [...render.segments];
    try {
      for (let frame = 0; frame < 600; frame++) {
        const state = evaluatePlatformRenderMotion(platform, frame / 120);
        expect(state).toBe(render);
        state.segments.forEach((segment, index) => expect(segment).toBe(arcs[index]));
        updatePlatformView(view, platform, state);
        for (const piece of resources.pieces) {
          const arc = piece.userData.arc, segment = state.segments[arc.segmentIndex];
          expect(arc.start).toBeCloseTo(segment.start + (segment.end - segment.start) * arc.from, 12);
          expect(arc.end).toBeCloseTo(segment.start + (segment.end - segment.start) * arc.to, 12);
        }
      }
      expect(collision).toEqual(snapshot);
      expect(resources.geometries).toEqual(geometries);
      geometries.forEach((geometry, index) => expect(geometry.attributes.position.array).toBe(positions[index]));
      expect(resources.pieces.length).toBeLessThanOrEqual(9);
    } finally { disposePlatform(view); }
  });

  it('renders clear open space and physical tip surfaces from the same moving boundaries', () => {
    const platform = pincer(), view = createPlatform(platform);
    const ray = new THREE.Raycaster(), position = new THREE.Vector3();
    try {
      for (const time of [0, .4, 1.35, 2.3]) {
        const state = evaluatePlatformMotion(platform, time);
        updatePlatformView(view, platform, state);
        view.updateMatrixWorld(true);
        for (const segment of state.segments) {
          const angle = (segment.start + segment.end) / 2;
          position.set(Math.cos(angle + state.rotation) * CONFIG.world.ballOrbitRadius, 2,
            Math.sin(angle + state.rotation) * CONFIG.world.ballOrbitRadius);
          ray.set(position, new THREE.Vector3(0, -1, 0));
          const hits = ray.intersectObject(view, true).filter(hit => hit.object.userData.surfaceKind);
          expect(hits.length).toBeGreaterThan(0);
          expect(hits[0].object.userData.surfaceKind).toBe(localKind(platform, angle, time));
        }
        position.set(Math.cos(state.rotation) * CONFIG.world.ballOrbitRadius, 2,
          Math.sin(state.rotation) * CONFIG.world.ballOrbitRadius);
        ray.set(position, new THREE.Vector3(0, -1, 0));
        expect(ray.intersectObject(view, true)).toHaveLength(0);
      }
    } finally { disposePlatform(view); }
  });

  it('keeps ribs and hatching inside the moving tip instead of extending into the open corridor', () => {
    const platform = pincer(), view = createPlatform(platform);
    const vertex = new THREE.Vector3(), instance = new THREE.Matrix4();
    try {
      for (const time of [0, .7, 1.35]) {
        const state = evaluatePlatformMotion(platform, time);
        updatePlatformView(view, platform, state);
        view.updateMatrixWorld(true);
        for (const piece of view.userData.platformResources.pieces.filter(piece => piece.userData.tipSide)) {
          const arc = piece.userData.arc;
          for (const mesh of piece.children.filter(mesh => !mesh.userData.surfaceKind)) {
            for (let index = 0; index < (mesh.isInstancedMesh ? mesh.count : 1); index++) {
              if (mesh.isInstancedMesh) mesh.getMatrixAt(index, instance);
              const positions = mesh.geometry.attributes.position;
              for (let point = 0; point < positions.count; point++) {
                vertex.fromBufferAttribute(positions, point);
                if (mesh.isInstancedMesh) vertex.applyMatrix4(instance);
                vertex.applyMatrix4(mesh.matrixWorld);
                let angle = Math.atan2(vertex.z, vertex.x) - state.rotation;
                angle += Math.round(((arc.start + arc.end) / 2 - angle) / TAU) * TAU;
                expect(angle).toBeGreaterThanOrEqual(arc.start);
                expect(angle).toBeLessThanOrEqual(arc.end);
              }
            }
          }
        }
      }
    } finally { disposePlatform(view); }
  });

  it('preserves exact impact shape and bounded outward tip debris across palette changes', () => {
    const platform = pincer(), scene = new THREE.Scene(), particles = new ParticleSystem(scene);
    evaluatePlatformMotion(platform, .73);
    const view = createPlatform(platform);
    scene.add(view);
    const geometry = view.userData.platformResources.geometries;
    const before = geometry.map(item => [...item.attributes.position.array]);
    try {
      setPlatformPalette(view, { safe: '#3bca82', hazard: '#e02b83', hazardDetail: '#29103b' });
      expect(geometry.map(item => [...item.attributes.position.array])).toEqual(before);
      platform.active = false;
      particles.shatter(view, true);
      const state = structuredClone(platform.motionState);
      updatePlatformView(view, platform, evaluatePlatformRenderMotion(platform, 50));
      expect(view.children).toHaveLength(0);
      expect(platform.motionState).toEqual(state);
      expect(geometry.map(item => [...item.attributes.position.array])).toEqual(before);
      expect(particles.activeDebrisCount).toBeLessThanOrEqual(CONFIG.particles.smashFragmentCount);
      expect(particles.fragments.some(fragment => fragment.piece.userData.tipSide)).toBe(true);
      for (const fragment of particles.fragments) {
        expect(fragment.vx * fragment.piece.position.x + fragment.vz * fragment.piece.position.z).toBeGreaterThan(0);
      }
      particles.clear();
      expect(particles.activeCount).toBe(0);
    } finally { particles.dispose(); disposePlatform(view); }
  });
});
