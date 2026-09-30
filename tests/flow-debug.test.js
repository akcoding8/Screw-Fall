import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Game } from '../src/game/Game.js';
import { DebugFlowView } from '../src/game/DebugFlowView.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { CONFIG } from '../src/game/config.js';
import { generateLevel } from '../src/game/LevelGenerator.js';

function replayFixture(debugEnabled = true, levelNumber = 10) {
  const game = { debugEnabled, simulation: new Simulation({ levelNumber }), settings: { levelNumber: 7 }, save: { save: vi.fn() } };
  game.loadDebugLevel = number => { game.flowReplay = null; game.simulation.loadLevel(number); };
  return game;
}

describe('Flow automation is an explicit debug inspection', () => {
  it('cannot start in ordinary play or on a normal tower', () => {
    for (const game of [replayFixture(false), replayFixture(true, 1)]) {
      expect(Game.prototype.startFlowReplay.call(game, 'skilled')).toBe(false);
      expect(game.flowReplay).toBeUndefined();
    }
  });
  it('does not execute even an attached controller when debug is disabled', () => {
    const controller = { step: vi.fn(() => { throw new Error('must stay manual'); }) };
    const game = { debugEnabled: false, flowReplay: { controller } };
    expect(Game.prototype.advanceFlowReplay.call(game, 1 / 120)).toBe(false);
    expect(controller.step).not.toHaveBeenCalled();
  });
  it.each(['ideal', 'skilled'])('replays %s with real unchanged physics, holds its finish, and never saves progress', mode => {
    const game = replayFixture();
    expect(Game.prototype.startFlowReplay.call(game, mode)).toBe(true);
    let ticks = 0;
    while (game.simulation.state !== STATES.COMPLETING && ticks++ < 2000) {
      if (!Game.prototype.advanceFlowReplay.call(game, CONFIG.physics.fixedStep)) game.simulation.step(CONFIG.physics.fixedStep);
    }
    expect(game.simulation.state).toBe(STATES.COMPLETING);
    const finalBall = { ...game.simulation.ball };
    for (let i = 0; i < 240; i++) {
      if (!Game.prototype.advanceFlowReplay.call(game, CONFIG.physics.fixedStep)) game.simulation.step(CONFIG.physics.fixedStep);
    }
    expect(game.simulation.levelNumber).toBe(10);
    expect(game.simulation.ball).toEqual(finalBall);
    expect(game.save.save).not.toHaveBeenCalled();
    expect(game.settings.levelNumber).toBe(7);
  });
});

describe('Flow debug geometry owns and releases its resources', () => {
  it('builds once on request without changing live level state', () => {
    const level = generateLevel(10), before = JSON.stringify(level), tower = new THREE.Group();
    const graph = { hidden: true, innerHTML: '', replaceChildren: vi.fn() };
    const view = new DebugFlowView(level, tower, graph);
    expect(tower.children).toHaveLength(0);
    view.toggle();
    expect(tower.children.length).toBeGreaterThanOrEqual(2);
    const geometries = view.lines.map(line => line.geometry);
    for (const geometry of geometries) expect(Array.from(geometry.attributes.position.array).every(Number.isFinite)).toBe(true);
    expect(graph.innerHTML).toContain('human');
    expect(graph.innerHTML).toContain('rad/s');
    view.toggle(); view.toggle();
    expect(view.lines.map(line => line.geometry)).toEqual(geometries);
    expect(JSON.stringify(level)).toBe(before);
    const disposed = geometries.map(geometry => vi.spyOn(geometry, 'dispose'));
    view.dispose(); view.dispose();
    expect(tower.children).toHaveLength(0);
    for (const dispose of disposed) expect(dispose).toHaveBeenCalledOnce();
  });
});
