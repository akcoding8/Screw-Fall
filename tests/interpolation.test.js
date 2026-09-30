import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FrameClock, interpolationAlpha } from '../src/game/FrameClock.js';
import { FrameDiagnostics } from '../src/game/FrameDiagnostics.js';
import { RenderTimeline } from '../src/game/RenderTimeline.js';
import { CameraRig } from '../src/game/CameraRig.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { Game } from '../src/game/Game.js';
import { CONFIG } from '../src/game/config.js';
import { dragRotation } from '../src/game/math.js';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/phase21-baseline.json', import.meta.url)));
const h = CONFIG.physics.fixedStep;
const schedules = {
  hz60: [1 / 60], hz90: [1 / 90], hz120: [h],
  alternating8_9: [.008, .009], occasionalLong: [.008, .009, .008, .009, .025, .008, .009, .016],
  mixed60_120: [h, h, 1 / 60, h, 1 / 60],
};
function levelFactory(kinds = ['gap', 'safe', 'finish']) {
  return number => ({ levelNumber: number, platforms: kinds.map((kind, index) => ({
    id: String(index), index, y: 0 - index * 2.25, active: true, baseRotation: 0,
    finish: kind === 'finish', type: 'static', walls: [],
    segments: kind === 'gap' ? [] : [{ start: 0, end: Math.PI * 2, kind }],
  })) });
}
function harness(kinds) {
  const simulation = new Simulation({ levelFactory: levelFactory(kinds) });
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 140);
  const cameraRig = new CameraRig(camera);
  cameraRig.resize(390, 844, { top: 47, bottom: 34 });
  cameraRig.update(simulation.anchorY, 0, true);
  const game = { simulation, cameraRig, timeline: new RenderTimeline(), clock: new FrameClock(),
    inFixedStep: false, renderDiscontinuity: false,
    resetMotionHistory: Game.prototype.resetMotionHistory,
  };
  game.fixedUpdate = Game.prototype.fixedUpdate.bind(game);
  game.resetMotionHistory();
  const events = [];
  simulation.onEvent = event => {
    events.push({ type: event.type, y: simulation.ball.y, level: simulation.levelNumber });
    if (['platformLanded', 'platformSmashed', 'ceilingContact', 'playerDied', 'gameLevelCompleted'].includes(event.type)) game.renderDiscontinuity = true;
    if (event.type === 'levelLoaded') {
      cameraRig.step(simulation.anchorY, 0, true);
      game.resetMotionHistory();
    }
  };
  return { ...game, game, events, camera, frame: dt => {
    game.clock.advance(dt, game.fixedUpdate);
    const display = game.timeline.sample(game.clock.alpha);
    cameraRig.render(display.anchor, game.clock.delta);
    return display;
  } };
}

describe('bounded fixed-step elapsed time and interpolation', () => {
  it.each([[0, 0], [h / 2, .5], [h, 1], [-1, 0], [10, 1], [NaN, 0], [Infinity, 0]])('maps accumulator %s to alpha %s', (value, expected) => {
    expect(interpolationAlpha(value)).toBe(expected);
  });
  it('rejects invalid step dimensions and frame durations', () => {
    for (const step of [0, -1, NaN, Infinity]) expect(interpolationAlpha(.1, step)).toBe(0);
    const clock = new FrameClock(), run = vi.fn();
    for (const dt of [-1, NaN, Infinity, 0]) clock.advance(dt, run);
    expect(run).not.toHaveBeenCalled(); expect(clock.alpha).toBe(0);
  });
  it('handles zero, one, and multiple steps without changing the fixed duration', () => {
    const clock = new FrameClock(), durations = [];
    const run = dt => durations.push(dt);
    clock.advance(h * .5, run); expect(clock.substeps).toBe(0); expect(clock.alpha).toBeCloseTo(.5);
    clock.advance(h, run); expect(clock.substeps).toBe(1); expect(clock.alpha).toBeCloseTo(.5);
    clock.advance(h * 3, run); expect(clock.substeps).toBe(3); expect(clock.alpha).toBeCloseTo(.5);
    expect(durations).toEqual([h, h, h, h]);
  });
  it('reports discarded clamp time and preserves a fractional remainder after twelve steps', () => {
    const clock = new FrameClock(), run = vi.fn();
    clock.advance(h * .4, run); clock.advance(1, run);
    expect(clock.substeps).toBe(12); expect(run).toHaveBeenCalledTimes(12);
    expect(clock.discarded).toBeCloseTo(.9, 12); expect(clock.alpha).toBeCloseTo(.4, 12);
    expect(clock.totalDiscarded).toBeCloseTo(.9, 12);
  });
  it('a level reset during a multi-step frame invalidates old remaining time', () => {
    const clock = new FrameClock();
    const run = vi.fn(() => clock.reset());
    clock.advance(.1, run);
    expect(run).toHaveBeenCalledOnce(); expect(clock.accumulator).toBe(0); expect(clock.alpha).toBe(0);
  });
});

describe('coherent ball/camera/render snapshots', () => {
  it('interpolates preallocated snapshots without touching authoritative state or rounding', () => {
    const h = harness(); h.frame(.011);
    const before = { ball: { ...h.simulation.ball }, anchorY: h.simulation.anchorY };
    const object = h.game.timeline.display;
    for (const alpha of [0, .00123, .314159, .75, 1]) {
      const state = h.game.timeline.sample(alpha);
      const { previous, current } = h.game.timeline;
      expect(state).toBe(object);
      for (const key of ['y', 'velocity', 'anchor', 'animationTime', 'stateElapsed']) {
        expect(state[key]).toBeCloseTo(previous[key] + (current[key] - previous[key]) * alpha, 13);
      }
    }
    expect(h.simulation.ball).toEqual(before.ball);
    expect(h.simulation.anchorY).toBe(before.anchorY);
  });
  it('raw comparison uses current snapshots without changing simulation or input', () => {
    const h = harness(); h.frame(.014);
    expect(h.game.timeline.sample(.2, false)).toEqual(h.game.timeline.current);
    h.simulation.rotate(.7);
    expect(h.simulation.rotation).toBeCloseTo(.7, 12);
    expect(h.game.timeline.current).not.toHaveProperty('rotation');
    for (const sensitivity of [.5, 1.2, 3]) expect(dragRotation(39, 390, CONFIG.input, sensitivity)).toBeCloseTo(.52 * sensitivity, 14);
  });
  it.each(['safe', 'hazard', 'finish'])('resolves %s contact without rendering below its surface', kind => {
    const t = harness(['gap', kind, 'finish']);
    let contact = false;
    for (let tick = 0; tick < 400; tick++) {
      t.frame(h);
      if (t.events.some(event => ['platformLanded', 'playerDied', 'gameLevelCompleted'].includes(event.type))) {
        contact = true;
        for (const alpha of [0, .25, .9, 1]) expect(t.game.timeline.sample(alpha).y).toBeCloseTo(-2.25 + .275, 12);
        expect(t.game.timeline.previous).toEqual(t.game.timeline.current);
        break;
      }
    }
    expect(contact).toBe(true);
  });
  it('smash rebounds at the resolved plane with no interpolated penetration', () => {
    const t = harness(['gap', 'gap', 'gap', 'hazard', 'finish']);
    for (let tick = 0; tick < 500 && !t.events.some(event => event.type === 'platformSmashed'); tick++) t.frame(h);
    expect(t.events.some(event => event.type === 'platformSmashed')).toBe(true);
    expect(t.simulation.ball.velocity).toBe(9.058875);
    expect(t.game.timeline.previous.y).toBe(t.simulation.ball.y);
    expect(t.game.timeline.current.y).toBe(-6.75 + .275);
  });
  it('retry, next-level and debug jumps never interpolate between towers', () => {
    const t = harness(['gap', 'hazard', 'finish']);
    for (let tick = 0; tick < 700 && t.simulation.state !== STATES.DEAD_WAITING; tick++) t.frame(h);
    expect(t.simulation.retry()).toBe(true);
    expect(t.game.timeline.previous).toEqual(t.game.timeline.current);
    expect(t.game.timeline.sample(.5).y).toBe(.275);
    for (const number of [2, 70, 100001, 1]) {
      t.simulation.loadLevel(number);
      expect(t.game.timeline.sample(.5).y).toBe(.275);
      expect(t.game.timeline.previous.animationTime).toBe(0);
      expect(t.game.clock.accumulator).toBe(0);
    }
  });
  it('visibility restore discards fractional time and snaps coherent snapshots', () => {
    const t = harness(); t.frame(.011); const before = { ...t.simulation.ball };
    t.game.resetMotionHistory();
    expect(t.game.clock.accumulator).toBe(0);
    expect(t.game.timeline.previous).toEqual(t.game.timeline.current);
    expect(t.game.timeline.sample(.3).y).toBe(t.simulation.ball.y);
    expect(t.simulation.ball).toEqual(before);
  });
});

describe('render schedule regression measurements', () => {
  it.each(Object.entries(schedules))('%s keeps terminal ball/camera motion coherent across zero/multiple steps', (name, schedule) => {
    const t = harness(['gap', 'gap', 'finish']);
    let y = -20 + .275;
    t.simulation.ball.y = y; t.simulation.ball.velocity = -18.4; t.simulation.anchorY = y - .275;
    t.cameraRig.step(y - .275, 0, true); t.game.resetMotionHistory();
    const clock = new FrameClock(); const point = new THREE.Vector3(); const pixels = [];
    const step = dt => {
      t.game.timeline.beforeStep(); y -= 18.4 * dt;
      t.simulation.ball.y = y; t.simulation.anchorY = y - .275; t.simulation.animationTime += dt;
      t.cameraRig.step(t.simulation.anchorY, dt);
      t.game.timeline.capture(t.simulation, t.cameraRig.simulationAnchorY);
    };
    for (let frame = 0; frame < 900; frame++) {
      clock.advance(schedule[frame % schedule.length], step);
      const display = t.game.timeline.sample(clock.alpha);
      t.cameraRig.render(display.anchor, clock.delta);
      point.set(0, display.y - .275, 2.05).project(t.camera);
      if (frame > 120) pixels.push((1 - point.y) * 844 / 2);
    }
    expect(Math.max(...pixels) - Math.min(...pixels)).toBeLessThan(1e-8);
    if (name === 'alternating8_9') expect(baseline.controlledTerminalScheduleObservations[name].maximumTerminalContactFrameJump * 763).toBeGreaterThan(6);
  });
  it.each(Object.entries(schedules))('%s produces identical authoritative physics and collisions over equal elapsed time', (_name, schedule) => {
    const candidate = harness(['gap', 'gap', 'safe', 'finish']);
    const reference = harness(['gap', 'gap', 'safe', 'finish']);
    for (let tick = 0; tick < 720; tick++) reference.frame(h);
    let elapsed = 0, index = 0;
    while (elapsed < 6 - 1e-12) {
      const dt = Math.min(schedule[index++ % schedule.length], 6 - elapsed);
      candidate.frame(dt); elapsed += dt;
    }
    expect(candidate.simulation.ball).toEqual(reference.simulation.ball);
    expect(candidate.simulation.anchorY).toBe(reference.simulation.anchorY);
    expect(candidate.simulation.animationTime).toBe(reference.simulation.animationTime);
    expect(candidate.events).toEqual(reference.events);
    expect(candidate.cameraRig.simulationAnchorY).toBe(reference.cameraRig.simulationAnchorY);
  });
  it('preserves all physics/input/camera/render/debris/audio configuration', () => {
    for (const key of ['physics', 'input', 'camera', 'world', 'renderer', 'particles', 'audio', 'smash', 'timing']) expect(CONFIG[key]).toEqual(baseline.config[key]);
    expect(CONFIG.save).toEqual({ ...baseline.config.save, version: 5 });
  });
});

describe('debug-only adaptive diagnostics', () => {
  it.each([60, 90, 120])('estimates %s Hz and adapts long-frame thresholds', hz => {
    const stats = new FrameDiagnostics();
    for (let i = 0; i < 300; i++) stats.record(1 / hz, hz === 60 ? 2 : 1);
    stats.refresh(); expect(stats.estimatedHz).toBeCloseTo(hz, 9);
    expect(stats.longFrames).toBe(0); expect(stats.fps).toBeCloseTo(hz, 9);
    stats.record(2 / hz, 2); expect(stats.longFrames).toBe(1);
  });
  it('records bounded percentiles, rolling steps, zero/multiple frames and discarded time', () => {
    const stats = new FrameDiagnostics(10);
    for (let i = 0; i < 20; i++) stats.record(.008 + i * .0001, i % 3, i === 19 ? .4 : 0);
    stats.refresh(); expect(stats.count).toBe(10); expect(stats.framesSeen).toBe(20);
    expect(stats.zeroFrames).toBe(7); expect(stats.multiFrames).toBe(6);
    expect(stats.discardedSeconds).toBe(.4);
    expect([...stats.substepDistribution].reduce((a, b) => a + b, 0)).toBe(10);
    expect(stats.p50).toBeCloseTo(9.45, 10); expect(stats.p95).toBeCloseTo(9.855, 10);
    const buffers = [stats.frames, stats.steps, stats.sorted, stats.substepDistribution];
    for (let i = 0; i < 500; i++) stats.record(.008, 1);
    expect([stats.frames, stats.steps, stats.sorted, stats.substepDistribution]).toEqual(buffers);
  });
});

describe('adapter discontinuity boundaries', () => {
  it('a zero-step render moves within the existing interval without advancing physics', () => {
    const t = harness(); const first = { ...t.frame(h * 1.2) };
    const authoritative = { ...t.simulation.ball };
    const second = { ...t.frame(h * .3) };
    expect(t.game.clock.substeps).toBe(0);
    expect(second.y).toBeGreaterThan(first.y);
    expect(second.animationTime).toBeGreaterThan(first.animationTime);
    expect(t.simulation.ball).toEqual(authoritative);
  });
  it('completion during a multi-step frame leaves the new tower at its exact spawn', () => {
    const t = harness(['gap', 'finish']);
    t.simulation.state = STATES.COMPLETING;
    t.simulation.stateElapsed = CONFIG.timing.completionHold - h;
    t.simulation.ball.y = -2.25 + .275;
    t.game.resetMotionHistory();
    t.frame(.1);
    expect(t.simulation.levelNumber).toBe(2);
    expect(t.game.clock.substeps).toBe(1);
    expect(t.game.clock.accumulator).toBe(0);
    expect(t.game.timeline.previous).toEqual(t.game.timeline.current);
    expect(t.game.timeline.display.y).toBe(.275);
  });
  it('a pointer wall death snaps the display before any subsequent physics step', () => {
    const t = harness(['safe', 'finish']); const game = t.game;
    Object.assign(game, { input: { invalidateGesture: vi.fn() }, updateState: vi.fn(),
      ball: { position: new THREE.Vector3(0, .275, 2.05) }, effectPosition: new THREE.Vector3(),
      particles: { burst: vi.fn() }, sound: { play: vi.fn() },
      scoring: { handleEvent: vi.fn() }, scoreHUD: { refresh: vi.fn() },
      clearCosmeticTrails: vi.fn(), cosmetics: { onDeath: vi.fn() } });
    t.simulation.level.palette = { hazard: '#dd4466' };
    const platform = t.simulation.platforms[0];
    platform.walls = [{ type: 'low', angle: 0, height: .9, width: .12, innerRadius: .77, outerRadius: 2.81 }];
    t.simulation.wallPlatforms.push(platform);
    t.simulation.ball.y = .5; t.simulation.rotation = 0;
    t.simulation.onEvent = event => Game.prototype.onGameEvent.call(game, event);
    t.simulation.rotate(-2);
    expect(t.simulation.state).toBe(STATES.DEAD_ANIMATION);
    expect(game.timeline.previous).toEqual(game.timeline.current);
    expect(game.timeline.sample(0).y).toBe(t.simulation.ball.y);
    expect(game.input.invalidateGesture).toHaveBeenCalledOnce();
    expect(game.sound.play).toHaveBeenCalledExactlyOnceWith('death');
  });
  it('a new-level timestamp reset excludes synchronous build work from physics but records delivered rAF timing', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const run = vi.fn();
    const game = { frame: () => {}, paused: false, lastViewportTime: 1000, lastTime: null,
      lastDiagnosticTime: 1000, clock: new FrameClock(), fixedUpdate: run, elapsed: 0,
      levelJustBuilt: true, frameDiagnostics: new FrameDiagnostics(), renderState: vi.fn() };
    Game.prototype.frame.call(game, 1080);
    expect(run).not.toHaveBeenCalled();
    expect(game.renderState).toHaveBeenCalledWith(0, 0);
    expect(game.frameDiagnostics.instantMs).toBe(80);
    Game.prototype.frame.call(game, 1080 + 1000 / 120);
    expect(run).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
