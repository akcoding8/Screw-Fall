import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import baseline from './fixtures/phase4-baseline.json';
import derivedWidths from './fixtures/phase4-derived-widths.json';
import { compareLevelBaseline } from '../scripts/level-baseline.mjs';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { cadenceForLevel } from '../src/game/LevelCadence.js';
import { generateLevel, NORMAL_GENERATOR_VERSION, FLOW_GENERATOR_VERSION } from '../src/game/LevelGenerator.js';
import { createLevel } from '../src/game/LevelManager.js';
import { validateLevel } from '../src/game/LevelValidator.js';
import { analyzeRoute, analyzeGapAlignment } from '../src/game/RouteAnalysis.js';
import { BRITISH_MILESTONE_KIND, BRITISH_MILESTONE_GENERATOR_VERSION, isBritishMilestone, britishGeometrySeed, britishThemeSeed } from '../src/game/BritishMilestone.js';
import { BRITISH_PALETTES, BRITISH_FLAG_LIMITS, getBritishPalette, unionJackColourRole,
  getBritishFlagTexture, applyBritishColumnMaterial, disposeBritishMilestoneTextures, britishThemeCacheStats } from '../src/game/BritishMilestoneTheme.js';
import { validatePalette, colorSeparation } from '../src/game/PaletteManager.js';
import { SKIN_CATALOG } from '../src/game/SkinCatalog.js';
import { skinReadability } from '../src/game/SkinMeshFactory.js';
import { basePointsForLevel } from '../src/game/ScoringManager.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { CONFIG } from '../src/game/config.js';

afterEach(() => disposeBritishMilestoneTextures());

describe('British milestone cadence with unchanged ordinary generation', () => {
  it.each([[10, 'flow'], [90, 'flow'], [100, BRITISH_MILESTONE_KIND], [110, 'flow'],
    [190, 'flow'], [200, BRITISH_MILESTONE_KIND], [201, 'normal']])('classifies Level %s as %s', (number, kind) => {
    expect(cadenceForLevel(number).kind).toBe(kind);
    expect(generateLevel(number).kind).toBe(kind);
  });

  it('gives every positive hundred priority over Flow without changing the other cadence slots', () => {
    for (let number = 1; number <= 1000; number++) {
      expect(cadenceForLevel(number).kind).toBe(number % 100 === 0 ? BRITISH_MILESTONE_KIND : number % 10 === 0 ? 'flow' : 'normal');
    }
    for (const value of [0, -100, 100.1, NaN, Infinity, '100']) expect(isBritishMilestone(value)).toBe(false);
  });

  it.each(baseline.levels.filter(level => level.number % 100 !== 0))('preserves complete Level $number geometry and metadata hashes', sample => {
    const result = compareLevelBaseline(generateLevel(sample.number), sample, derivedWidths.levels[sample.number]);
    expect(result.differences).toEqual([]);
    expect(result.hash).toBe(sample.hash);
  });

  it('adds an independently versioned generator without changing any ordinary tuning', () => {
    const { britishMilestone, ...unchanged } = GENERATION;
    expect(unchanged).toEqual(baseline.generation);
    expect(NORMAL_GENERATOR_VERSION).toBe(4); expect(FLOW_GENERATOR_VERSION).toBe(2);
    expect(BRITISH_MILESTONE_GENERATOR_VERSION).toBe(1);
    expect(britishMilestone.platformCount).toEqual([45, 50]);
    expect(britishGeometrySeed(100)).not.toBe(britishThemeSeed(100));
    expect(britishGeometrySeed(100, 1, 0)).not.toBe(britishGeometrySeed(100, 1, 1));
    expect(britishGeometrySeed(100)).not.toBe(britishGeometrySeed(200));
  });
});

describe('substantial, fair and deterministic milestone towers', () => {
  it('validates 500 milestone seeds with normal anti-screw, wall, pincer and recovery constraints', () => {
    for (let index = 1; index <= 500; index++) {
      const level = generateLevel(index * 100);
      expect(level.fallback, `Level ${level.levelNumber}`).toBe(false);
      expect(validateLevel(level).errors, `Level ${level.levelNumber}`).toEqual([]);
      expect(level.platformCount).toBeGreaterThanOrEqual(45); expect(level.platformCount).toBeLessThanOrEqual(50);
      expect(level.platforms).toHaveLength(level.platformCount + 1); expect(level.platforms.at(-1).finish).toBe(true);
      expect(level.difficulty).toBe('challenge'); expect([7, 8]).toContain(level.difficultyRating);
      expect(level.plannedDrops.length).toBeGreaterThanOrEqual(1); expect(level.plannedDrops.length).toBeLessThanOrEqual(2);
      expect(level.obstacleCounts.lowWall + level.obstacleCounts.divider).toBeGreaterThanOrEqual(3);
      expect(level.obstacleCounts.breathing + level.obstacleCounts.orbiting).toBeGreaterThanOrEqual(5);
      expect(new Set(level.platforms.filter(p => !p.finish).map(p => p.silhouette)).size).toBeGreaterThanOrEqual(3);
      expect(analyzeRoute(level).longestSameDirectionRun).toBeLessThanOrEqual(3);
      const gaps = analyzeGapAlignment(level);
      expect(gaps.hardViolationCount).toBe(0); expect(gaps.repeatedThreeWindows).toBe(0);
      expect(level.flow).toBeUndefined(); expect(level.isFlow).not.toBe(true);
      expect(basePointsForLevel(level)).toBe(level.difficultyRating);
    }
  }, 10000);

  it.each([100, 200, 1000000, 999999900])('rebuilds fresh identical Level %s after reload or retry', number => {
    const first = generateLevel(number);
    expect(generateLevel(number)).toEqual(first);
    const sim = new Simulation({ levelNumber: number });
    const platforms = structuredClone(sim.platforms);
    sim.rotate(.1); for (let i = 0; i < 50; i++) sim.step(CONFIG.physics.fixedStep);
    sim.setState(STATES.DEAD_WAITING); expect(sim.retry()).toBe(true);
    expect(sim.platforms).toEqual(platforms);
    expect(sim.level.kind).toBe(BRITISH_MILESTONE_KIND);
  });

  it('uses palette preference only for presentation, including deterministic Mixed', () => {
    const levels = ['soft', 'vivid', 'mixed'].map(paletteStyle => createLevel(100, { paletteStyle }));
    expect(levels[0].platforms).toEqual(levels[1].platforms); expect(levels[1].platforms).toEqual(levels[2].platforms);
    expect(levels[0].palette).toBe(BRITISH_PALETTES.soft); expect(levels[1].palette).toBe(BRITISH_PALETTES.vivid);
    expect(levels[2].palette).toBe(getBritishPalette(100, 'mixed'));
    expect(new Set(Array.from({ length: 30 }, (_, index) => getBritishPalette((index + 1) * 100, 'mixed').family))).toEqual(new Set(['soft', 'vivid']));
    expect(createLevel(101).kind).toBe('normal'); expect(createLevel(110).kind).toBe('flow');
  });

  it('rejects forged milestone metadata and accidental Flow classification', () => {
    for (const mutate of [level => { level.kind = 'flow'; }, level => { level.isFlow = true; },
      level => { level.milestone.themeSeed++; }, level => { delete level.milestone; },
      level => { level.plannedDrops = []; }]) {
      const level = generateLevel(100); mutate(level); expect(validateLevel(level).valid).toBe(false);
    }
  });
});

describe('procedural Union Jack theme and visual safety', () => {
  it('draws both central and diagonal crosses with white borders on a navy field', () => {
    expect(unionJackColourRole(.5, .03)).toBe('red'); // Central vertical cross.
    expect(unionJackColourRole(.03, .5)).toBe('red'); // Central horizontal cross.
    expect(unionJackColourRole(.57, .03)).toBe('white');
    expect(unionJackColourRole(.10, .10)).toBe('red'); // Offset diagonal cross.
    expect(unionJackColourRole(.90, .10)).toBe('red');
    expect(unionJackColourRole(.10, .16)).toBe('white');
    expect(unionJackColourRole(.10, .30)).toBe('navy');
  });

  it.each(Object.values(BRITISH_PALETTES))('$name keeps gameplay colours and all skins readable', palette => {
    expect(validatePalette(palette).errors).toEqual([]);
    expect(colorSeparation(palette.safe, palette.hazard).hueDistance).toBeGreaterThan(100);
    expect(palette.safe).not.toBe(palette.flagColours.red);
    expect(palette.hazard).toBe(palette.flagColours.red);
    expect(palette.confetti).toEqual([palette.flagColours.red, palette.flagColours.white, palette.safe]);
    for (const skin of SKIN_CATALOG) for (const metric of Object.values(skinReadability(skin, palette))) {
      expect(Math.max(metric.bestColorContrast, metric.edgeContrast || 0), skin.id).toBeGreaterThanOrEqual(2.3);
    }
  });

  it('caches at most four local textures sharing two bounded pixel buffers and releases them explicitly', () => {
    const softColumn = getBritishFlagTexture('soft', 'column'), softFinish = getBritishFlagTexture('soft', 'finish');
    expect(getBritishFlagTexture('soft', 'column')).toBe(softColumn);
    expect(softFinish.image.data).toBe(softColumn.image.data);
    expect(softColumn.image.width).toBe(256); expect(softColumn.image.height).toBe(128);
    expect(softColumn.repeat.toArray()).toEqual([2, 96]); expect(softFinish.repeat.toArray()).toEqual([1, 1]);
    const vividColumn = getBritishFlagTexture('vivid', 'column'), vividFinish = getBritishFlagTexture('vivid', 'finish');
    expect(britishThemeCacheStats()).toEqual({ textures: BRITISH_FLAG_LIMITS.maximumTextures, pixelBuffers: 2, pixelBytes: 262144 });
    const disposed = vi.fn();
    for (const texture of [softColumn, softFinish, vividColumn, vividFinish]) {
      expect(texture.isDataTexture).toBe(true); expect(texture.image.data).toBeInstanceOf(Uint8Array);
      expect(texture.userData.sharedBritishMilestone).toBe(true); texture.addEventListener('dispose', disposed);
    }
    const material = new THREE.MeshStandardMaterial();
    expect(applyBritishColumnMaterial(material, BRITISH_PALETTES.soft).map).toBe(softColumn);
    expect(material.color.getHexString()).toBe('ffffff'); material.dispose();
    disposeBritishMilestoneTextures(); expect(disposed).toHaveBeenCalledTimes(4);
    expect(britishThemeCacheStats()).toEqual({ textures: 0, pixelBuffers: 0, pixelBytes: 0 });
  });
});
