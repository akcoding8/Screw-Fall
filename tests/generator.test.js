import { describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { GENERATION } from '../src/game/GenerationConfig.js';
import { LEVEL_CADENCE, cadenceForLevel } from '../src/game/LevelCadence.js';
import { createLevel } from '../src/game/LevelManager.js';
import { generateLevel, GENERATOR_VERSION, FLOW_GENERATOR_VERSION } from '../src/game/LevelGenerator.js';
import { validateLevel } from '../src/game/LevelValidator.js';
import { SeededRandom, deriveSeed } from '../src/game/SeededRandom.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { TAU } from '../src/game/math.js';
import { classifyPlatform } from '../src/game/LevelManager.js';

const geometry = level => JSON.stringify(level.platforms.map(({ motionState, ...platform }) => platform));

describe('seeded gameplay generation', () => {
  it('has repeatable, nonconstant random output bounded below one', () => {
    const first = new SeededRandom(0);
    const second = new SeededRandom(0);
    const values = Array.from({ length: 10000 }, () => first.next());
    expect(values).toEqual(Array.from({ length: 10000 }, () => second.next()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(new Set(values).size).toBeGreaterThan(9900);
  });

  it('incorporates the full level number, generator version, and bounded attempt into seeds', () => {
    expect(new Set([deriveSeed(17), deriveSeed(17 + 2 ** 32), deriveSeed(17, 2), deriveSeed(17, 1, 1)]).size).toBe(4);
    expect(deriveSeed(17)).toBe(deriveSeed(17));
  });

  it.each([1, 17, 50, 100001, 100010, Number.MAX_SAFE_INTEGER])('reconstructs fresh identical geometry for level %s', number => {
    const first = generateLevel(number);
    expect(first.generatorVersion).toBe(number % 10 === 0 ? FLOW_GENERATOR_VERSION : GENERATOR_VERSION);
    expect(generateLevel(number)).toEqual(first);
    first.platforms[0].active = false;
    first.platforms[1].segments[0].start += 0.1;
    expect(generateLevel(number).platforms[0].active).toBe(true);
    expect(generateLevel(number)).not.toEqual(first);
  });

  it('normally changes layout for different numbers and generator versions', () => {
    const signatures = Array.from({ length: 150 }, (_, index) => geometry(generateLevel(index + 1)));
    expect(new Set(signatures).size).toBe(150);
    expect(geometry(generateLevel(17, { version: GENERATOR_VERSION + 1 }))).not.toBe(geometry(generateLevel(17)));
  });

  it('does not use unseeded random geometry', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Unseeded geometry'); });
    try { expect(validateLevel(generateLevel(33)).valid).toBe(true); } finally { random.mockRestore(); }
  });

  it('keeps palettes entirely outside geometry generation', () => {
    const levels = ['soft', 'vivid', 'mixed'].map(paletteStyle => createLevel(17, { paletteStyle }));
    expect(geometry(levels[0])).toBe(geometry(levels[1]));
    expect(geometry(levels[1])).toBe(geometry(levels[2]));
    expect(generateLevel(17)).not.toHaveProperty('palette');
  });

  it('resets exact geometry and animation phases on retry', () => {
    const sim = new Simulation({ levelNumber: 17 });
    const original = structuredClone(sim.platforms);
    sim.rotate(0.1);
    for (let index = 0; index < 120; index += 1) sim.step(CONFIG.physics.fixedStep);
    expect(sim.animationTime).toBeGreaterThan(0);
    sim.setState(STATES.DEAD_WAITING);
    expect(sim.retry()).toBe(true);
    expect(sim.animationTime).toBe(0);
    expect(sim.platforms).toEqual(original);
  });

  it('validates 1,106 low, high and very large levels quickly without fallback', () => {
    const numbers = [...Array.from({ length: 1000 }, (_, i) => i + 1),
      ...Array.from({ length: 100 }, (_, i) => i + 100001),
      1000000001, 9999999999, 2 ** 32, 2 ** 40, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER];
    const started = performance.now();
    for (const number of numbers) {
      const level = generateLevel(number);
      expect(level.fallback, `Level ${number}: ${level.generationErrors}`).toBe(false);
      const result = validateLevel(level);
      expect(result.errors, `Level ${number}`).toEqual([]);
      expect(result.valid).toBe(true);
      expect(level.generationAttempt).toBeLessThanOrEqual(GENERATION.maxAttempts);
    }
    expect(performance.now() - started).toBeLessThan(10000);
  }, 15000);

  it('bounds rejection attempts and returns an independently validated safe fallback', () => {
    const reject = vi.fn(() => ({ valid: false, errors: ['Injected rejected candidate'] }));
    const level = generateLevel(17, { validator: reject, maxAttempts: 1000 });
    expect(reject).toHaveBeenCalledTimes(GENERATION.maxAttempts);
    expect(level.fallback).toBe(true);
    expect(level.generationErrors).toEqual(['Injected rejected candidate']);
    expect(level.obstacleCounts.static).toBe(level.platformCount);
    expect(validateLevel(level).valid).toBe(true);
    const flow = generateLevel(10, { validator: reject, maxAttempts: 1 });
    expect(flow.kind).toBe('flow');
    expect(validateLevel(flow).valid).toBe(true);
  });

  it('records thrown validator errors and still reaches the bounded safe fallback', () => {
    const throwing = vi.fn(() => { throw new Error('Broken candidate shape'); });
    const level = generateLevel(17, { validator: throwing });
    expect(throwing).toHaveBeenCalledTimes(GENERATION.maxAttempts);
    expect(level.fallback).toBe(true);
    expect(level.generationErrors).toEqual(['Level validator threw: Broken candidate shape']);
    expect(validateLevel(level)).toEqual({ valid: true, errors: [] });
  });

  it('recovers from malformed validation results without silently accepting the candidate', () => {
    const level = generateLevel(10, { validator: () => undefined });
    expect(level.fallback).toBe(true);
    expect(level.generationErrors).toEqual(['Level validator returned a malformed result']);
    expect(validateLevel(level).valid).toBe(true);
  });

  it('protects the whole shared long-drop corridor after each smash rebound', () => {
    for (let number = 1; number <= 100; number += 1) {
      const level = generateLevel(number);
      for (const opportunity of level.smashOpportunities) {
        const chute = level.platforms.slice(opportunity.start, opportunity.catchIndex);
        let sharedSamples = 0;
        for (let angle = 0; angle < TAU; angle += Math.PI / 720) {
          const rotation = angle - CONFIG.world.ballWorldAngle;
          if (chute.some(platform => classifyPlatform(platform, rotation) !== 'gap')) continue;
          sharedSamples += 1;
          expect(classifyPlatform(level.platforms[opportunity.catchIndex], rotation)).not.toBe('gap');
          expect(classifyPlatform(level.platforms[opportunity.recoveryIndex], rotation), `Level ${number} recovery`).not.toBe('hazard');
        }
        expect(sharedSamples).toBeGreaterThan(200);
      }
    }
  });
});

describe('permanently bounded readable cadence', () => {
  it('contains exactly fifteen Gentle, twenty-three Standard, seven Challenge and five Flow slots', () => {
    const counts = Object.fromEntries(['gentle', 'standard', 'challenge', 'flow'].map(role => [role, LEVEL_CADENCE.filter(slot => slot.difficulty === role).length]));
    expect(counts).toEqual({ gentle: 15, standard: 23, challenge: 7, flow: 5 });
    expect(LEVEL_CADENCE).toHaveLength(50);
  });

  it('puts Flow every tenth slot and recovery after each challenge, including the wrap', () => {
    for (let index = 0; index < 50; index += 1) {
      const slot = LEVEL_CADENCE[index];
      expect(slot.kind === 'flow').toBe((index + 1) % 10 === 0);
      if (slot.difficulty === 'challenge') expect(['gentle', 'flow']).toContain(LEVEL_CADENCE[(index + 1) % 50].difficulty);
      const consecutiveHarder = Array.from({ length: 5 }, (_, offset) => LEVEL_CADENCE[(index + offset) % 50]);
      expect(consecutiveHarder.some(item => item.difficulty === 'gentle' || item.kind === 'flow')).toBe(true);
    }
  });

  it('repeats roles and parameter envelopes at high progress without a difficulty ramp', () => {
    for (let number = 1; number <= 50; number += 1) {
      // The original 50-slot rhythm stays intact except the new 100th-level override.
      if ((number + 50) % 100) expect(cadenceForLevel(number + 50)).toEqual(cadenceForLevel(number));
      expect(cadenceForLevel(number + 100000)).toEqual(cadenceForLevel(number));
      for (const offset of [0, 100000, 1000000000]) {
        const level = generateLevel(number + offset);
        const cadence = cadenceForLevel(number);
        expect(level.difficulty).toBe(cadence.difficulty);
        expect(level.difficultyRating).toBeGreaterThanOrEqual(cadence.ratingRange[0]);
        expect(level.difficultyRating).toBeLessThanOrEqual(cadence.ratingRange[1]);
        expect(level.permittedTypes.length).toBeLessThanOrEqual(4);
        expect(level.permittedTypes.filter(type => ['breathing', 'orbiting', 'stinger'].includes(type)).length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('data validation rejects unsafe geometry', () => {
  it.each([Infinity, -Infinity, NaN, 1000000000, -1, 3.5])('rejects invalid smash indices %s before using them as loop bounds', invalidIndex => {
    const level = generateLevel(1);
    level.smashOpportunities[0].catchIndex = invalidIndex;
    const result = validateLevel(level);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid or out-of-range smash sequence');
  });

  it.each([
    ['empty breathing segments', level => { level.platforms.find(platform => platform.motion).segments = []; }],
    ['null segment', level => { level.platforms[4].segments[0] = null; }],
    ['missing route', level => { delete level.platforms[4].route; }],
    ['null wall', level => { level.platforms[4].walls.push(null); }],
    ['cyclic data', level => { level.platforms[4].route.self = level.platforms[4].route; }],
    ['unknown level kind', level => { level.kind = 'unsupported'; }],
    ['unknown difficulty', level => { level.difficulty = 'unsupported'; }],
    ['inconsistent Flow difficulty', level => { level.difficulty = 'flow'; }],
  ])('rejects %s without throwing', (_name, mutate) => {
    const level = generateLevel(3);
    mutate(level);
    expect(validateLevel(level).valid).toBe(false);
  });

  it.each([
    ['wrong count', level => level.platforms.splice(2, 1)],
    ['wrong spacing', level => { level.platforms[4].y += 0.5; }],
    ['NaN', level => { level.platforms[4].baseRotation = NaN; }],
    ['overlapping arcs', level => { level.platforms[4].segments[1].start = 0; }],
    ['out of range arc', level => { level.platforms[4].segments[0].end = TAU + 1; }],
    ['no route', level => { level.platforms[4].route.angle += Math.PI; }],
    ['no smash opportunity', level => { level.smashOpportunities = []; }],
    ['bad finish', level => { level.platforms.at(-1).segments = []; }],
  ])('rejects %s', (_name, mutate) => {
    const level = generateLevel(1);
    mutate(level);
    expect(validateLevel(level).valid).toBe(false);
  });

  it('rejects excessive motion speed, bad wall dimensions and an opposing-wall trap', () => {
    const moving = generateLevel(5);
    moving.platforms.find(platform => platform.motion).motion.speed = 20;
    expect(validateLevel(moving).valid).toBe(false);
    const walls = generateLevel(16);
    const platform = walls.platforms.find(item => item.walls.length);
    platform.walls[0].height = 10;
    expect(validateLevel(walls).valid).toBe(false);
    platform.walls.push({ ...platform.walls[0], height: 1.87, angle: platform.walls[0].angle + Math.PI });
    expect(validateLevel(walls).errors).toContain(`${platform.id}: opposing wall trap`);
  });
});
