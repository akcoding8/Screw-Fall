import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { classifyLocalAngle } from '../src/game/LevelManager.js';
import { classifyPlatformAtTime, evaluatePlatformMotion } from '../src/game/PlatformMotion.js';
import { HAZARD_COLLISION, HAZARD_EDGE_INSET, hazardEdgeInset, effectiveHazardArc,
  classifySegmentsAtAngle } from '../src/game/HazardCollision.js';
import { applyPlatformSilhouette, validatePlatformSilhouette } from '../src/game/PlatformSilhouettes.js';
import { makePlatform } from '../src/game/LevelGeometry.js';
import { SeededRandom } from '../src/game/SeededRandom.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { TAU } from '../src/game/math.js';

describe('physically derived hazard edge tolerance', () => {
  it('uses the same small chord allowance at the visual and effective boundaries', () => {
    const chord = 2 * CONFIG.world.ballOrbitRadius * Math.sin(HAZARD_EDGE_INSET / 2);
    expect(chord).toBeCloseTo(CONFIG.physics.ballRadius * HAZARD_COLLISION.ballRadiusFraction + HAZARD_COLLISION.physicalMargin, 12);
    expect(chord).toBeCloseTo(.034, 12);
    expect(HAZARD_EDGE_INSET * 180 / Math.PI).toBeLessThan(1);
    expect(hazardEdgeInset(.275, 1.8)).toBeGreaterThan(hazardEdgeInset(.275, 2.4));
  });

  it.each([{ start: 1, end: 2 }, { start: TAU - .4, end: .4 }])('handles clear gaps, visual edges and deadly interiors of $start → $end', arc => {
    const platform = { segments: [{ kind: 'hazard', ...arc }] };
    const effective = effectiveHazardArc(arc);
    expect(classifyLocalAngle(platform, arc.start - .05)).toBe('gap');
    expect(classifyLocalAngle(platform, arc.start)).toBe('safe');
    expect(classifyLocalAngle(platform, arc.start + HAZARD_EDGE_INSET * .5)).toBe('safe');
    expect(classifyLocalAngle(platform, arc.start + HAZARD_EDGE_INSET * 2)).toBe('hazard');
    expect(classifyLocalAngle(platform, effective.end - .03)).toBe('hazard');
    expect(classifyLocalAngle(platform, effective.end + HAZARD_EDGE_INSET * .5)).toBe('safe');
    expect(classifyLocalAngle(platform, arc.end + .05)).toBe('gap');
  });

  it('never makes a tiny visual hazard harmless, nor adds a hole at an occupied seam', () => {
    const narrow = { kind: 'hazard', start: 2, end: 2.01 };
    expect(effectiveHazardArc(narrow).inset).toBeCloseTo(.002);
    expect(classifySegmentsAtAngle([narrow], 2.005)).toBe('hazard');
    const arcs = [{ kind: 'safe', start: 1, end: 2 }, narrow];
    expect(classifySegmentsAtAngle(arcs, 2)).toBe('safe');
    expect(classifySegmentsAtAngle([{ kind: 'hazard', start: 0, end: TAU }], 0)).toBe('hazard');
  });

  it('shares the same tolerance with moving geometry sampled at impact time', () => {
    const platform = makePlatform(1, .4, 1.3, .8);
    platform.type = 'orbiting';
    platform.motion = { type: 'orbiting', speed: .35, phase: .2 };
    for (const time of [0, .125, 1.5, 15]) {
      const state = evaluatePlatformMotion(platform, time);
      for (const segment of state.segments) for (const offset of [-.02, 0, .008, .035]) {
        const local = segment.start + offset;
        const rotation = local + state.rotation - CONFIG.world.ballWorldAngle;
        expect(classifyPlatformAtTime(platform, rotation, time)).toBe(classifyLocalAngle(platform, local));
      }
    }
  });
});

describe('one- and two-sided danger shoulders', () => {
  it.each(['left', 'right', 'double'])('places %s immediately beside a real passable opening', shoulderType => {
    const platform = makePlatform(13, 0, 1.3, .8);
    applyPlatformSilhouette(platform, new SeededRandom(99), { difficulty: 'challenge', requestedSilhouette: 'broadRing',
      previousAngle: Math.PI, shoulderType });
    expect(platform.hazardShoulder).toBe(shoulderType);
    expect(validatePlatformSilhouette(platform).errors).toEqual([]);
    const half = platform.gapWidth / 2;
    expect(classifyLocalAngle(platform, 0)).toBe('gap');
    expect(classifyLocalAngle(platform, half - .05)).toBe('gap');
    expect(classifyLocalAngle(platform, -half + .05)).toBe('gap');
    if (shoulderType !== 'left') {
      expect(classifyLocalAngle(platform, half + HAZARD_EDGE_INSET / 2)).toBe('safe');
      expect(classifyLocalAngle(platform, half + HAZARD_EDGE_INSET * 2)).toBe('hazard');
    }
    if (shoulderType !== 'right') {
      expect(classifyLocalAngle(platform, -half - HAZARD_EDGE_INSET / 2)).toBe('safe');
      expect(classifyLocalAngle(platform, -half - HAZARD_EDGE_INSET * 2)).toBe('hazard');
    }
  });

  it('rejects invented shoulders and combinations with tiny geometry', () => {
    const platform = makePlatform(13, 0, 1.3, .8);
    applyPlatformSilhouette(platform, new SeededRandom(99), { requestedSilhouette: 'tinyLedge', previousAngle: 1.65 });
    platform.hazardShoulder = 'double';
    expect(validatePlatformSilhouette(platform).valid).toBe(false);
  });

  it('retains lethal contact and the approved smash rebound on a hazard-only island', () => {
    for (const ready of [false, true]) {
      const platform = makePlatform(0, 0, 1.3, .8);
      applyPlatformSilhouette(platform, new SeededRandom(99), { requestedSilhouette: 'safeHazardIslands', previousAngle: 1.65 });
      const hazard = platform.segments.find(segment => segment.kind === 'hazard');
      const sim = new Simulation({ levelFactory: () => ({ platforms: [platform, {
        id: 'finish', finish: true, active: true, y: -20, baseRotation: 0, segments: [], walls: [],
      }] }) });
      sim.state = STATES.ACTIVE;
      sim.rotation = (hazard.start + hazard.end) / 2 - CONFIG.world.ballWorldAngle;
      sim.ball.y = CONFIG.physics.ballRadius + .05;
      sim.ball.velocity = -10;
      sim.smashReady = ready;
      sim.passCount = ready ? CONFIG.smash.threshold : 0;
      sim.step(.02);
      if (ready) {
        expect(platform.active).toBe(false);
        expect(sim.ball.velocity).toBe(CONFIG.physics.bounceVelocity);
        expect(sim.smashReady).toBe(false);
      } else expect(sim.state).toBe(STATES.DEAD_ANIMATION);
    }
  });
});
