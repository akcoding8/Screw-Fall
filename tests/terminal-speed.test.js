import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../src/game/config.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { createPrototypeLevel } from '../src/game/PrototypeLevels.js';
import { PHASE2_TERMINAL_SPEED, PRODUCTION_TERMINAL_SPEED, terminalSpeedForPercent } from '../src/game/TerminalSpeed.js';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/phase2-baseline.json', import.meta.url)));
const candidates = [[100, 23], [90, 20.7], [80, 18.4], [75, 17.25]];

function fixture(kinds, debugEnabled = true, kind = 'normal') {
  const events = [];
  const levelFactory = number => ({ ...createPrototypeLevel(number), kind, platforms: kinds.map((type, index) => ({
    id: `contact-${index}`, index, y: -2.25 * index, baseRotation: 0,
    active: true, finish: type === 'finish', walls: [],
    segments: type === 'gap' ? [] : [{ kind: type === 'finish' ? 'safe' : type, start: 0, end: 2 * Math.PI }],
  })) });
  const sim = new Simulation({ debugEnabled, levelFactory, onEvent: event => events.push(event) });
  sim.rotate(.001);
  events.length = 0;
  return { sim, events };
}

describe('global descent calibration with debug-only candidates', () => {
  it('reduces only the downward cap in the complete Phase 2 physics snapshot', () => {
    expect(PHASE2_TERMINAL_SPEED).toBe(baseline.config.physics.maxDownwardSpeed);
    expect(PRODUCTION_TERMINAL_SPEED).toBe(18.4);
    expect(PRODUCTION_TERMINAL_SPEED / PHASE2_TERMINAL_SPEED).toBeCloseTo(.8, 14);
    expect(CONFIG.physics).toEqual({ ...baseline.config.physics, maxDownwardSpeed: 18.4 });
    for (const section of ['world', 'input', 'smash', 'timing', 'audio', 'particles', 'renderer']) {
      expect(CONFIG[section], section).toEqual(baseline.config[section]);
    }
    expect(CONFIG.save).toEqual({ ...baseline.config.save, version: 5 });
  });

  it.each(candidates)('%i%% maps to %s without touching upward bounce', (percent, cap) => {
    expect(terminalSpeedForPercent(percent)).toBe(cap);
    const { sim } = fixture(['safe', 'finish']);
    const y = sim.ball.y;
    expect(sim.setDebugTerminalSpeed(percent)).toBe(true);
    expect(sim.maxDownwardSpeed).toBe(cap);
    expect(sim.ball.y).toBe(y);
    expect(sim.ball.velocity).toBe(9.058875);
    sim.step(CONFIG.physics.fixedStep);
    expect(sim.ball.velocity).toBeCloseTo(9.058875 - 28 / 120, 12);
  });

  it('gates overrides to debug instances and rejects unsupported values', () => {
    const { sim } = fixture(['safe', 'finish'], false);
    expect(sim.setDebugTerminalSpeed(100)).toBe(false);
    expect(sim.maxDownwardSpeed).toBe(18.4);
    for (const value of [NaN, Infinity, 0, 50, '100', undefined, null]) {
      expect(terminalSpeedForPercent(value)).toBeNull();
    }
    const debug = fixture(['safe', 'finish']).sim;
    expect(debug.setDebugTerminalSpeed(NaN)).toBe(false);
    expect(debug.maxDownwardSpeed).toBe(18.4);
    expect(new Simulation({ levelFactory: createPrototypeLevel }).terminalSpeedPercent).toBe(80);
  });

  it('clamps a falling ball cleanly, preserves position/progress, and keeps retry in memory', () => {
    const { sim } = fixture(['safe', 'finish']);
    sim.setDebugTerminalSpeed(100);
    sim.ball.velocity = -23;
    sim.ball.y = -1;
    sim.progress = .3;
    sim.setDebugTerminalSpeed(75);
    expect(sim.ball.velocity).toBe(-17.25);
    expect(sim.ball.y).toBe(-1);
    expect(sim.progress).toBe(.3);
    sim.state = STATES.DEAD_WAITING;
    sim.retry();
    expect(sim.maxDownwardSpeed).toBe(17.25);
    expect(sim.ball.velocity).toBe(9.058875);
  });

  it.each(candidates)('preserves ordered swept collision and smash rebound at %i%%', (percent, cap) => {
    const { sim, events } = fixture(['gap', 'gap', 'gap', 'hazard', 'finish']);
    sim.setDebugTerminalSpeed(percent);
    sim.ball.y = .375;
    sim.ball.velocity = -cap;
    // Deliberately oversized test step crosses several planes; gameplay remains 1/120s.
    sim.step(8 / cap);
    expect(events.filter(event => event.type === 'platformPassed').map(event => event.platform.index)).toEqual([0, 1, 2]);
    expect(events.filter(event => event.type === 'platformSmashed')).toHaveLength(1);
    expect(sim.ball.velocity).toBe(9.058875);
    expect(sim.ball.y).toBe(-6.75 + .275);
    expect(sim.platforms.at(-1).active).toBe(true);
    expect(sim.state).toBe(STATES.ACTIVE);
    const safe = fixture(['safe', 'finish']).sim;
    safe.setDebugTerminalSpeed(percent);
    safe.ball.y = .375;
    safe.ball.velocity = -cap;
    safe.step(.2);
    expect(safe.ball.velocity).toBe(9.058875);
  });

  it.each(candidates)('uses identical ordinary-fall trajectories in normal and Flow at %i%%', (percent, cap) => {
    const normal = fixture(['gap', 'finish'], true, 'normal').sim;
    const flow = fixture(['gap', 'finish'], true, 'flow').sim;
    for (const sim of [normal, flow]) {
      sim.setDebugTerminalSpeed(percent);
      sim.platforms.at(-1).y = -1000;
      sim.ball.y = -1;
      sim.ball.velocity = -5;
    }
    for (let i = 0; i < 360; i++) {
      normal.step(1 / 120);
      flow.step(1 / 120);
      expect(flow.ball).toEqual(normal.ball);
      expect(normal.ball.velocity).toBeGreaterThanOrEqual(-cap);
    }
    expect(normal.ball.velocity).toBe(-cap);
  });
});
