import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { ScoringManager, basePointsForLevel } from '../src/game/ScoringManager.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { MAX_POINTS, formatScore, formatMultiplier, normalizePoints, saturatingAdd } from '../src/game/ScoreFormatter.js';
import { Simulation } from '../src/game/Simulation.js';
import { TAU } from '../src/game/math.js';

function setup({ rating = 5, kind = 'normal', initial = {} } = {}) {
  const save = new SaveManager(null, { lifecycle: false });
  save.save(initial);
  const events = [];
  const warnings = [];
  const scoring = new ScoringManager({ save, onEvent: event => events.push(event), onWarning: message => warnings.push(message) });
  const level = { levelNumber: 7, kind, difficultyRating: rating,
    platforms: Array.from({ length: 50 }, (_, index) => ({ id: `p${index}`, index, active: true, finish: index === 49 })) };
  scoring.beginAttempt(level, 'ACTIVE');
  const pass = index => scoring.handleEvent({ type: 'platformPassed', platform: level.platforms[index], levelNumber: 7 });
  return { save, scoring, level, events, warnings, pass };
}

afterEach(() => { vi.useRealTimers(); });

describe('difficulty-weighted authoritative scoring', () => {
  it('assigns Flow one base point regardless of rating', () => {
    expect(basePointsForLevel({ kind: 'flow', difficultyRating: 10 })).toBe(1);
    expect(basePointsForLevel({ isFlow: true })).toBe(1);
  });
  it.each([[3, 3], [5.6, 6], [7.4, 7], [0, 2], [-20, 2], [99, 10], [NaN, 2], [Infinity, 2], ['8', 2]])
    ('rounds/clamps hidden rating %s to %s', (difficultyRating, expected) => {
      expect(basePointsForLevel({ difficultyRating })).toBe(expected);
    });
  it('awards base times sequential streak with no cap, all three balances and immediate best', () => {
    const { scoring, pass, events } = setup({ rating: 10 });
    expect(Array.from({ length: 5 }, (_, index) => pass(index).awardedPoints)).toEqual([10, 20, 30, 40, 50]);
    expect(scoring.data).toMatchObject({ pointsBalance: 150, lifetimePoints: 150, currentNoDeathScore: 150, bestNoDeathScore: 150 });
    for (let index = 5; index < 49; index++) pass(index);
    expect(scoring.dropStreak).toBe(49);
    expect(scoring.lastAward).toBe(490);
    expect(events.filter(event => event.newBest)).toHaveLength(1);
  });
  it('accepts the legitimate inactive event, but rejects duplicates, foreign objects and finish', () => {
    const { scoring, level, pass } = setup();
    level.platforms[0].active = false;
    expect(pass(0).awardedPoints).toBe(5);
    expect(pass(0)).toBeNull();
    expect(pass(49)).toBeNull();
    expect(scoring.handleEvent({ type: 'platformPassed', platform: { ...level.platforms[1] } })).toBeNull();
    expect(scoring.handleEvent({ type: 'platformPassed', platform: level.platforms[1], levelNumber: 8 })).toBeNull();
    expect(scoring.data.pointsBalance).toBe(5);
  });
  it('excludes platforms already inactive before the attempt', () => {
    const { scoring, level, pass } = setup();
    level.platforms[0].active = false;
    scoring.beginAttempt(level, 'ACTIVE');
    expect(pass(0)).toBeNull();
  });
  it.each(['HOLDING', 'DEAD_ANIMATION', 'DEAD_WAITING', 'COMPLETING', 'TRANSITIONING'])
    ('ignores pass events outside ACTIVE (%s)', state => {
      const { scoring, pass } = setup();
      scoring.handleEvent({ type: 'stateChanged', state });
      expect(pass(0)).toBeNull();
      expect(scoring.data.pointsBalance).toBe(0);
    });
  it.each(['platformLanded', 'platformSmashed', 'gameLevelCompleted', 'retry', 'manualReset'])
    ('resets streak but preserves all earned score on %s', type => {
      const { scoring, pass, level } = setup();
      pass(0); pass(1);
      scoring.handleEvent({ type, platform: level.platforms[2] });
      expect(scoring.dropStreak).toBe(0);
      expect(scoring.data.currentNoDeathScore).toBe(15);
      expect(scoring.savePending).toBe(false);
      expect(pass(3).awardedPoints).toBe(5);
    });
  it('a smashed platform and its former empty plane cannot score', () => {
    const { scoring, pass, level } = setup();
    scoring.handleEvent({ type: 'platformSmashed', platform: level.platforms[0] });
    level.platforms[0].active = false;
    expect(pass(0)).toBeNull();
    expect(scoring.data.pointsBalance).toBe(0);
  });
  it('level transition carries current score and resets attempt identity/streak', () => {
    const { scoring, pass, level } = setup();
    pass(0); pass(1);
    scoring.handleEvent({ type: 'gameLevelCompleted', platform: level.platforms[49] });
    const next = { ...level, levelNumber: 8, platforms: level.platforms.map(platform => ({ ...platform })) };
    scoring.beginAttempt(next, 'ACTIVE');
    expect(scoring.data.currentNoDeathScore).toBe(15);
    expect(scoring.handleEvent({ type: 'platformPassed', platform: level.platforms[2] })).toBeNull();
    expect(scoring.handleEvent({ type: 'platformPassed', platform: next.platforms[0], levelNumber: 8 }).awardedPoints).toBe(5);
    expect(scoring.data.currentNoDeathScore).toBe(20);
  });
  it('death banks the final run, clears only current/streak, immediately flushes and is idempotent', () => {
    const { scoring, pass } = setup();
    pass(0); pass(1);
    const result = scoring.handleEvent({ type: 'playerDied' });
    expect(result).toMatchObject({ finalScore: 15, newBest: true });
    expect(scoring.lastDeathScore).toBe(15);
    expect(scoring.data).toMatchObject({ pointsBalance: 15, lifetimePoints: 15, currentNoDeathScore: 0, bestNoDeathScore: 15, currentRunIsRecord: false });
    expect(scoring.dropStreak).toBe(0);
    expect(scoring.savePending).toBe(false);
    expect(scoring.handleEvent({ type: 'playerDied' })).toBeNull();
    expect(scoring.lastDeathScore).toBe(15);
  });
  it('record indication survives levels and reloads, and a tie does not create a record', () => {
    const { scoring, pass, save, level } = setup({ initial: { bestNoDeathScore: 10 } });
    expect(pass(0).newBest).toBe(false);
    expect(pass(1).newBest).toBe(true);
    const resumed = new ScoringManager({ save });
    resumed.beginAttempt(level, 'ACTIVE');
    expect(resumed.handleEvent({ type: 'platformPassed', platform: level.platforms[2] }).newBest).toBe(false);
    resumed.endRun();
    resumed.beginAttempt(level, 'ACTIVE');
    resumed.handleEvent({ type: 'platformPassed', platform: level.platforms[0] });
    resumed.handleEvent({ type: 'platformLanded' });
    resumed.handleEvent({ type: 'platformPassed', platform: level.platforms[1] });
    expect(resumed.recordRun).toBe(false);
    save.dispose();
  });
  it('a retry receives fresh scoring flags without restoring the ended no-death run', () => {
    const { scoring, pass, level } = setup();
    pass(0); pass(1);
    scoring.endRun();
    const retry = { ...level, platforms: level.platforms.map(platform => ({ ...platform, active: true })) };
    scoring.beginAttempt(retry, 'ACTIVE');
    expect(scoring.handleEvent({ type: 'platformPassed', platform: retry.platforms[0] }).awardedPoints).toBe(5);
    expect(scoring.data).toMatchObject({ pointsBalance: 20, lifetimePoints: 20, currentNoDeathScore: 5, bestNoDeathScore: 15 });
  });
  it('saturates without unsafe arithmetic and warns only once', () => {
    const { scoring, pass, warnings } = setup({ initial: { pointsBalance: MAX_POINTS - 1,
      lifetimePoints: MAX_POINTS - 1, currentNoDeathScore: MAX_POINTS - 1, bestNoDeathScore: MAX_POINTS - 1 } });
    pass(0); pass(1);
    for (const field of ['pointsBalance', 'lifetimePoints', 'currentNoDeathScore', 'bestNoDeathScore']) expect(scoring.data[field]).toBe(MAX_POINTS);
    expect(warnings).toHaveLength(1);
  });
  it('debug overlay alone stays eligible; a cheat permanently forks progression until reload', () => {
    const { scoring, save, pass } = setup();
    pass(0);
    expect(scoring.eligible).toBe(true);
    scoring.markIneligible('Flow controller');
    const persistent = { ...save.data };
    expect(save.pending).toBe(false);
    pass(1);
    scoring.endRun();
    scoring.grantTemporaryPoints(50000);
    expect(save.data).toEqual(persistent);
    expect(scoring.eligible).toBe(false);
    expect(new ScoringManager({ save }).eligible).toBe(true);
    expect(save.data.currentNoDeathScore).toBe(5);
  });
  it('debug reset never changes normal progression', () => {
    const { scoring, save, pass } = setup();
    pass(0);
    scoring.resetTemporaryScores();
    expect(scoring.data.pointsBalance).toBe(0);
    expect(save.data.pointsBalance).toBe(5);
  });
});

function sweptFixture(kinds) {
  const platforms = kinds.map((kind, index) => ({ id: `sweep-${index}`, index, y: -index * CONFIG.world.platformSpacing,
    active: true, baseRotation: 0, finish: false, segments: kind === 'gap' ? [] : [{ kind, start: 0, end: TAU }] }));
  platforms.push({ id: 'finish', index: platforms.length, y: -100, active: true, finish: true, baseRotation: 0, segments: [] });
  const level = { levelNumber: 7, kind: 'normal', difficultyRating: 5, platforms };
  const save = new SaveManager(null, { lifecycle: false });
  const awards = [];
  const scoring = new ScoringManager({ save, onEvent: event => { if (event.type === 'pointsAwarded') awards.push(event); } });
  const sim = new Simulation({ levelNumber: 7, levelFactory: () => level });
  scoring.beginAttempt(level, sim.state);
  sim.onEvent = event => scoring.handleEvent(event);
  sim.ball.y = CONFIG.physics.ballRadius + .1;
  sim.ball.previousY = sim.ball.y;
  sim.ball.velocity = -CONFIG.physics.maxDownwardSpeed;
  sim.rotate(.01);
  return { sim, scoring, awards };
}

describe('real simulation event ordering', () => {
  it('processes multiple downward layers in vertical order with sequential multipliers', () => {
    const { sim, scoring, awards } = sweptFixture(['gap', 'gap', 'gap', 'safe']);
    sim.step((3 * CONFIG.world.platformSpacing + .11) / CONFIG.physics.maxDownwardSpeed);
    expect(awards.map(event => event.platformId)).toEqual(['sweep-0', 'sweep-1', 'sweep-2']);
    expect(awards.map(event => event.awardedPoints)).toEqual([5, 10, 15]);
    expect(scoring.dropStreak).toBe(0); // The fourth layer smashed and rebounded.
    expect(scoring.data.currentNoDeathScore).toBe(30);
    sim.ball.y = -3 * CONFIG.world.platformSpacing + CONFIG.physics.ballRadius + .1;
    sim.ball.velocity = -CONFIG.physics.maxDownwardSpeed;
    sim.step(.02);
    expect(awards).toHaveLength(3); // Crossing the destroyed layer cannot score.
  });
  it('preserves valid passes before a later death in the same update', () => {
    const { sim, scoring, awards } = sweptFixture(['gap', 'gap', 'hazard']);
    sim.step((2 * CONFIG.world.platformSpacing + .11) / CONFIG.physics.maxDownwardSpeed);
    expect(awards.map(event => event.awardedPoints)).toEqual([5, 10]);
    expect(scoring.lastDeathScore).toBe(15);
    expect(scoring.data).toMatchObject({ pointsBalance: 15, lifetimePoints: 15, currentNoDeathScore: 0, bestNoDeathScore: 15 });
  });
});

describe('safe score formatting', () => {
  it.each([NaN, Infinity, -Infinity, null, undefined, '30', {}])('recovers non-numeric score %j', value => {
    expect(normalizePoints(value)).toBe(0);
  });
  it('formats full integer scores and multipliers, and saturates integer addition', () => {
    expect(formatScore(28640.9)).toBe('28,640');
    expect(formatScore(MAX_POINTS)).toBe('9,007,199,254,740,991');
    expect(formatMultiplier(5)).toBe('×5');
    expect(formatMultiplier(0)).toBe('×1');
    expect(normalizePoints(-1)).toBe(0);
    expect(normalizePoints(1e30)).toBe(MAX_POINTS);
    expect(saturatingAdd(MAX_POINTS - 1, 5)).toBe(MAX_POINTS);
  });
});
