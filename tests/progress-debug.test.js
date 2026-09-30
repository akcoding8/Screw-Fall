import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SaveManager } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { ProgressManager } from '../src/game/ProgressManager.js';
import { SkinManager } from '../src/game/SkinManager.js';
import { ProgressionDebug } from '../src/game/ProgressionDebug.js';
import { Simulation } from '../src/game/Simulation.js';
import { CosmeticEffectManager } from '../src/game/CosmeticEffectManager.js';
import { createPlatform, disposePlatform } from '../src/game/Platform.js';
import { CONFIG } from '../src/game/config.js';
import { getSkinDefinition } from '../src/game/SkinCatalog.js';

function fixture(partial = {}) {
  const storage = { getItem: () => JSON.stringify({ version: 5, ...partial }), setItem: vi.fn() };
  const save = new SaveManager(storage, { lifecycle: false });
  const scoring = new ScoringManager({ save });
  const progress = new ProgressManager({ scoring });
  const scene = new THREE.Scene(), tower = new THREE.Group(); scene.add(tower);
  const cosmetics = new CosmeticEffectManager(scene);
  const game = { save, scoring, progress, scene, tower, cosmetics, platformViews: new Map(),
    input: { invalidateGesture: vi.fn() }, scoreHUD: { refresh: vi.fn() }, ui: { 'debug-info': { textContent: '' } },
    settings: { paletteStyle: 'soft' }, resetMotionHistory: vi.fn(), events: [],
    evidenceStore: { metadataCount: 2 }, sessionEvidence: { metadataCount: 1 } };
  game.skins = new SkinManager({ scoring, onChange: () => cosmetics.setSkin(getSkinDefinition(game.skins.selectedSkinId)) });
  game.simulation = new Simulation({ debugEnabled: true, onEvent: event => game.events.push(event) });
  const rebuild = number => {
    for (const view of game.platformViews.values()) disposePlatform(view);
    game.platformViews.clear(); cosmetics.clear();
    game.simulation.loadLevel(number);
    for (const platform of game.simulation.platforms) {
      const view = createPlatform(platform, game.simulation.level.palette);
      tower.add(view); game.platformViews.set(platform.id, view);
    }
    cosmetics.setSkin(getSkinDefinition(game.skins.selectedSkinId));
  };
  game.loadDebugLevel = vi.fn(number => { scoring.markIneligible('Debug level preview'); rebuild(number); });
  game.applyImportedProgress = vi.fn(() => rebuild(progress.currentLevel));
  game.applyPalette = vi.fn(palette => { game.simulation.level.palette = palette; });
  const debug = Object.assign(Object.create(ProgressionDebug.prototype), { game, events: [], effectIndex: 0 });
  game.debugText = () => debug.text();
  return { game, debug, storage, save, dispose() {
    cosmetics.dispose(); for (const view of game.platformViews.values()) disposePlatform(view); save.dispose();
  } };
}

describe('Phase 4 hidden developer previews', () => {
  it('simulates an initial import and later adjustment only in the scoring fork', () => {
    const fx = fixture({ startingLevel: 200, startingLevelConfirmedAt: '2026-09-10T12:00:00.000Z',
      startingLevelSource: 'Original source', startingLevelEvidenceId: 'original-image', levelsCompletedHere: 181,
      laterImportedAdjustments: [{ id: 'existing', amount: 5, createdAt: '2026-09-11T12:00:00.000Z', reason: 'elsewhere' }] });
    try {
      const before = fx.save.load();
      expect(fx.debug.handle('import-start')).toBe(true);
      expect(fx.game.progress.currentLevel).toBe(1943);
      expect(fx.game.progress.data.levelsCompletedHere).toBe(181);
      expect(fx.game.progress.data.laterImportedAdjustments[0].amount).toBe(5);
      expect(fx.debug.handle('import-adjust')).toBe(true);
      expect(fx.game.progress.currentLevel).toBe(1975);
      expect(fx.game.applyImportedProgress).toHaveBeenCalledTimes(2);
      expect(fx.save.data).toEqual(before);
      expect(fx.storage.setItem).not.toHaveBeenCalled();
    } finally { fx.dispose(); }
  });

  it('previews both British towers and switches treatment without persisting preference or completions', () => {
    const fx = fixture({ levelsCompletedHere: 12 });
    try {
      const before = fx.save.load(), button = { setAttribute: vi.fn() };
      fx.debug.handle('milestone-100');
      expect(fx.game.simulation.level.kind).toBe('british-milestone');
      fx.debug.handle('british-palette', button);
      expect(fx.game.simulation.level.palette.family).toBe('vivid');
      fx.debug.handle('british-palette', button);
      expect(fx.game.simulation.level.palette.family).toBe('soft');
      fx.debug.handle('milestone-200');
      expect(fx.game.simulation.levelNumber).toBe(200);
      expect(fx.game.progress.data.levelsCompletedHere).toBe(12);
      expect(fx.game.settings.paletteStyle).toBe('soft');
      expect(fx.save.data).toEqual(before);
      expect(fx.storage.setItem).not.toHaveBeenCalled();
      expect(fx.debug.text()).toContain('British #2');
      expect(fx.debug.text()).toContain('Evidence metadata: stored 2 · session 1');
      expect(fx.debug.text()).toContain('Save schema 5 · starting 1 · completed here 12');
    } finally { fx.dispose(); }
  });

  it('preserves negative corrections when simulating a replacement starting record', () => {
    const fx = fixture({ startingLevel: 1757, levelsCompletedHere: 100,
      startingLevelConfirmedAt: '2026-09-10T12:00:00.000Z',
      laterImportedAdjustments: [{ id: 'correction', amount: -1000, createdAt: '2026-09-11T12:00:00.000Z', reason: 'correction' }] });
    try {
      const before = fx.save.load();
      fx.debug.handle('import-start');
      expect(fx.game.progress.currentLevel).toBe(857);
      expect(fx.game.progress.adjustmentTotal).toBe(-1000);
      expect(fx.game.progress.data.levelsCompletedHere).toBe(100);
      expect(fx.save.data).toEqual(before);
      expect(fx.storage.setItem).not.toHaveBeenCalled();
    } finally { fx.dispose(); }
  });

  it('places an actual full-size edge mark and reports its clipping bounds without touching saved ownership', () => {
    const fx = fixture();
    try {
      const before = fx.save.load();
      fx.debug.handle('paint-edge');
      expect(fx.game.skins.selectedSkinId).toBe('duo-splash');
      expect(fx.game.cosmetics.paintCount).toBe(1);
      const record = fx.game.cosmetics.paint.records.find(record => record.active);
      expect(record.size).toBeCloseTo(.56 - .035);
      expect(fx.debug.text()).toContain('full-size pixel discard');
      expect(fx.debug.text()).toContain('Edge contact');
      expect(fx.game.resetMotionHistory).toHaveBeenCalledTimes(1);
      expect(fx.save.data).toEqual(before);
      expect(fx.storage.setItem).not.toHaveBeenCalled();
    } finally { fx.dispose(); }
  });

  it('forces a real safe-plane smash event with the unchanged rebound, without scores or completions', () => {
    const fx = fixture({ pointsBalance: 120, lifetimePoints: 120, currentNoDeathScore: 120, bestNoDeathScore: 120 });
    try {
      const before = fx.save.load();
      fx.debug.handle('paint-smash');
      const smash = fx.game.events.find(event => event.type === 'platformSmashed');
      expect(smash).toBeDefined();
      expect(smash.platform.active).toBe(false);
      expect(fx.game.events.some(event => event.type === 'platformPassed')).toBe(false);
      expect(fx.game.simulation.ball.velocity).toBe(CONFIG.physics.bounceVelocity);
      expect(fx.game.progress.data.levelsCompletedHere).toBe(0);
      expect(fx.game.progress.data.pointsBalance).toBe(120);
      expect(fx.game.scoring.eligible).toBe(false);
      expect(fx.save.data).toEqual(before);
      expect(fx.storage.setItem).not.toHaveBeenCalled();
      expect(fx.debug.text()).toContain('Actual smash contact');
    } finally { fx.dispose(); }
  });
});
