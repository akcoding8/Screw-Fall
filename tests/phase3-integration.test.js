import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Game } from '../src/game/Game.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { ScoreHUD } from '../src/game/ScoreHUD.js';
import { CONFIG } from '../src/game/config.js';
import { ProgressManager } from '../src/game/ProgressManager.js';
import { levelLabel } from '../src/game/LevelLabel.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

class Node extends EventTarget {
  constructor() {
    super(); this.hidden = false; this.disabled = false; this.textContent = ''; this.style = {};
    this.dataset = {}; this.classList = { toggle: vi.fn() }; this.children = [];
  }
  setAttribute() {}
  append(node) { this.children.push(node); }
  remove() {}
}

function smallLevel(levelNumber, lethal = false) {
  const make = (index, y, segments, finish = false) => ({ id: index, index, y, active: true, baseRotation: 0, type: 'static', segments, finish });
  return { levelNumber, difficultyRating: 5, kind: 'normal',
    palette: { ball: '#f5dfa7', hazard: '#e6806a', finish: '#91d6ba' },
    platforms: [make(0, 0, []), make(1, lethal ? -.05 : -2.25, []),
      make(2, lethal ? -.1 : -4.5, lethal ? [{ start: 0, end: Math.PI * 2, kind: 'hazard' }] : [], !lethal),
      ...(lethal ? [make(3, -2.25, [], true)] : [])],
  };
}

/** Uses real Game event/debug methods, scoring, HUD, saves and Simulation.
 * Only WebGL construction/rebuild and audio/render-only outputs are stubbed. */
function harness({ levelNumber = 1, levelFactory = number => smallLevel(number), saved = {} } = {}) {
  const nodes = new Map();
  const element = new Node();
  element.querySelector = id => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  vi.stubGlobal('document', { createElement: () => new Node() });
  const storage = { value: null, getItem() { return this.value; }, setItem: vi.fn(function (_key, value) { this.value = value; }) };
  const game = Object.create(Game.prototype);
  game.element = element;
  game.ui = Object.fromEntries(['debug', 'debug-controls', 'debug-info', 'settings-toggle', 'message', 'message-title', 'message-detail', 'tutorial-gesture']
    .map(id => [id, element.querySelector(`#${id}`)]));
  game.save = new SaveManager(storage, { lifecycle: false });
  game.save.save({ levelsCompletedHere: levelNumber - 1, ...saved });
  game.settings = game.save.load();
  game.debugEnabled = true;
  game.debugBrowsing = false;
  game.inFixedStep = true;
  game.ball = new THREE.Group();
  game.ball.position.set(0, .275, 2.05);
  game.tower = new THREE.Group();
  game.effectPosition = new THREE.Vector3();
  game.platformViews = new Map();
  game.input = { invalidateGesture: vi.fn(), blockPointer: vi.fn() };
  game.sound = { play: vi.fn() };
  game.particles = { shatter: vi.fn(), burst: vi.fn() };
  game.cosmetics = { onPass: vi.fn(), clearPlatform: vi.fn(), onLanding: vi.fn(), onSmash: vi.fn(), onDeath: vi.fn(), clearTransient: vi.fn() };
  game.trail = [];
  const scoreEvents = [];
  game.scoring = new ScoringManager({ save: game.save, onEvent: event => {
    scoreEvents.push(event); game.scoreHUD.onEvent(event);
  } });
  game.scoreHUD = new ScoreHUD(element, game.scoring);
  game.progress = new ProgressManager({ scoring: game.scoring });
  game.skins = { premiumUnlocked: false };
  game.simulation = new Simulation({ levelNumber, levelFactory, resolveNextLevel: number => game.resolveNextLevel(number) });
  game.buildLevel = () => {
    game.flowReplay = null;
    game.scoring.beginAttempt(game.simulation.level, game.simulation.state);
    game.progress.beginAttempt(game.simulation.level, game.simulation.state);
    game.platformViews.clear();
    for (const platform of game.simulation.platforms) {
      const view = new THREE.Group();
      // The harness does not construct platform geometry; the rendering update
      // safely skips these placeholders without altering simulation data.
      view.userData.shattered = true;
      game.platformViews.set(platform.id, view);
    }
    game.updateState();
  };
  game.buildLevel();
  game.simulation.onEvent = event => game.onGameEvent(event);
  game.setupDebug();
  return { game, nodes, storage, scoreEvents,
    click(action) { game.onDebugClick({ stopPropagation() {}, target: { closest: () => ({ dataset: { debug: action }, setAttribute() {} }) } }); },
    dispose() { game.save.dispose(); },
  };
}

describe('Phase 3 real gameplay-adapter boundaries', () => {
  it('records each real completion only after the original hold and survives reload', () => {
    const f = harness({ levelNumber: 99 });
    try {
      const { game } = f;
      game.simulation.rotate(.01);
      for (let tick = 0; game.simulation.state !== STATES.COMPLETING && tick < 2000; tick++) game.simulation.step(CONFIG.physics.fixedStep);
      expect(game.simulation.state).toBe(STATES.COMPLETING);
      expect(game.progress.data.levelsCompletedHere).toBe(98);
      const points = game.scoring.data.pointsBalance;
      game.simulation.step(CONFIG.timing.completionHold - .01);
      expect(game.progress.currentLevel).toBe(99);
      game.simulation.step(.01);
      expect(game.progress.data.levelsCompletedHere).toBe(99);
      expect(game.progress.currentLevel).toBe(100);
      expect(game.simulation.state).toBe(STATES.HOLDING);
      expect(game.simulation.levelNumber).toBe(100);
      expect(game.scoring.data.pointsBalance).toBe(points);
      game.buildLevel(); game.resolveNextLevel(100);
      expect(game.progress.data.levelsCompletedHere).toBe(99);
      expect(new SaveManager(f.storage, { lifecycle: false }).load().currentLevel).toBe(100);
    } finally { f.dispose(); }
  });

  it('imports and signed corrections rebuild safely without granting any rewards', () => {
    const f = harness({ levelNumber: 9, saved: { pointsBalance: 490, lifetimePoints: 1200,
      currentNoDeathScore: 70, bestNoDeathScore: 500 } });
    try {
      const { game } = f, before = game.scoring.data;
      const rewards = data => [data.pointsBalance, data.lifetimePoints, data.currentNoDeathScore, data.bestNoDeathScore, data.ownedSkinIds, data.selectedSkinId];
      game.scoring.dropStreak = 3;
      expect(game.progress.confirmStartingLevel({ startingLevel: '92', source: 'Test' }).ok).toBe(true);
      game.applyImportedProgress();
      expect(game.simulation.levelNumber).toBe(100);
      expect(game.simulation.state).toBe(STATES.HOLDING);
      expect(game.scoring.dropStreak).toBe(0);
      expect(game.progress.data.levelsCompletedHere).toBe(8);
      expect(rewards(game.scoring.data)).toEqual(rewards(before));
      expect(game.progress.addAdjustment({ amount: '-1', reason: 'correction' }).ok).toBe(true);
      game.applyImportedProgress();
      expect(game.simulation.levelNumber).toBe(99);
      expect(game.input.invalidateGesture).toHaveBeenCalled();
      expect(rewards(game.scoring.data)).toEqual(rewards(before));
    } finally { f.dispose(); }
  });

  it('never counts a manipulated completion, death, retry or debug milestone preview', () => {
    const f = harness();
    try {
      const { game } = f;
      game.loadDebugLevel(100);
      game.simulation.rotate(.01);
      for (let tick = 0; game.simulation.state !== STATES.COMPLETING && tick < 2000; tick++) game.simulation.step(CONFIG.physics.fixedStep);
      game.simulation.step(CONFIG.timing.completionHold);
      expect(game.simulation.levelNumber).toBe(101);
      expect(game.progress.data.levelsCompletedHere).toBe(0);
      expect(game.save.load().currentLevel).toBe(1);
      game.simulation.die?.();
      game.progress.handleEvent({ type: 'playerDied' }); game.progress.handleEvent({ type: 'retry' });
      expect(game.progress.completeAttempt().ok).toBe(false);
      expect(game.progress.data.levelsCompletedHere).toBe(0);
    } finally { f.dispose(); }
  });

  it.each([9, 99, 100, 1757, 99999, 1000000, 999000000, Number.MAX_SAFE_INTEGER])('formats the full level %s without scientific notation', number => {
    const label = levelLabel(number);
    expect(label.text.replaceAll(',', '')).toBe(String(number));
    expect(label.fontSize).toBeGreaterThanOrEqual(16);
    expect(label.text).not.toMatch(/[eE]/);
  });

  it('isolates Return to saved level even when it is the first modifying debug action', () => {
    const f = harness();
    try {
      const { game } = f;
      expect(game.scoring.eligible).toBe(true); // Showing debug is not a cheat.
      game.simulation.rotate(.01);
      for (let tick = 0; !game.scoring.dropStreak && tick < 400; tick++) game.simulation.step(CONFIG.physics.fixedStep);
      expect(game.scoring.data.pointsBalance).toBe(5);
      expect(game.scoring.savePending).toBe(true);
      f.click('return');
      expect(game.scoring.eligible).toBe(false);
      expect(game.scoring.ineligibleReason).toBe('Manual debug reset');
      expect(game.save.load().pointsBalance).toBe(5);
      const persisted = f.storage.value;
      game.simulation.rotate(.01);
      for (let tick = 0; game.simulation.state !== STATES.COMPLETING && tick < 1000; tick++) game.simulation.step(CONFIG.physics.fixedStep);
      expect(game.simulation.state).toBe(STATES.COMPLETING);
      expect(game.scoring.data.pointsBalance).toBe(20);
      expect(game.save.load().pointsBalance).toBe(5);
      expect(f.storage.value).toBe(persisted);
    } finally { f.dispose(); }
  });

  it.each(['ideal', 'skilled'])('lets %s Flow replay emit score feedback without changing persistent records or points', async mode => {
    const { createLevel } = await import('../src/game/LevelManager.js');
    const f = harness({ levelNumber: 10, levelFactory: createLevel,
      saved: { pointsBalance: 700, lifetimePoints: 900, currentNoDeathScore: 125, bestNoDeathScore: 350 } });
    try {
      const { game } = f, normal = game.save.load(), disk = f.storage.value;
      expect(game.startFlowReplay(mode)).toBe(true);
      let ticks = 0;
      while (!game.flowReplay.finished && ticks++ < 2000) {
        if (!game.advanceFlowReplay(CONFIG.physics.fixedStep)) game.simulation.step(CONFIG.physics.fixedStep);
      }
      expect(game.simulation.state).toBe(STATES.COMPLETING);
      expect(game.flowReplay.finished).toBe(true);
      expect(f.scoreEvents.filter(event => event.type === 'pointsAwarded').length).toBeGreaterThan(40);
      expect(f.scoreEvents.every(event => event.eligible === false)).toBe(true);
      expect(game.scoring.data.pointsBalance).toBeGreaterThan(normal.pointsBalance);
      expect(game.save.load()).toEqual(normal);
      expect(f.storage.value).toBe(disk);
      game.scoring.endRun(); // A later debug death also leaves the normal run intact.
      expect(game.save.load()).toEqual(normal);
      expect(f.storage.value).toBe(disk);
    } finally { f.dispose(); }
  });

  it('shows the final record after ordered passes and death in one real simulation update', () => {
    const f = harness({ levelFactory: number => smallLevel(number, true),
      saved: { pointsBalance: 200, lifetimePoints: 400, currentNoDeathScore: 40, bestNoDeathScore: 50 } });
    try {
      const { game } = f;
      game.simulation.rotate(.01);
      game.simulation.ball.y = CONFIG.physics.ballRadius + .025;
      game.simulation.ball.velocity = -CONFIG.physics.maxDownwardSpeed;
      game.simulation.step(CONFIG.physics.fixedStep);
      expect(f.scoreEvents.map(event => event.type)).toEqual(['pointsAwarded', 'pointsAwarded', 'runEnded']);
      expect(f.scoreEvents.slice(0, 2).map(event => [event.platformId, event.awardedPoints])).toEqual([[0, 5], [1, 10]]);
      expect(game.simulation.state).toBe(STATES.DEAD_ANIMATION);
      expect(game.scoring.lastDeathScore).toBe(55);
      expect(game.scoring.data).toMatchObject({ currentNoDeathScore: 0, bestNoDeathScore: 55, pointsBalance: 215, lifetimePoints: 415 });
      expect(f.nodes.get('#death-score').hidden).toBe(false);
      expect(f.nodes.get('#death-score-value').textContent).toBe('55');
      expect(f.nodes.get('#death-best-value').textContent).toBe('55');
      expect(f.nodes.get('#death-record').hidden).toBe(false);
      expect(f.nodes.get('#score-current').textContent).toBe('0');
      expect(game.scoring.savePending).toBe(false);
      expect(JSON.parse(f.storage.value).currentNoDeathScore).toBe(0);
      expect(game.cosmetics.onDeath).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
});
