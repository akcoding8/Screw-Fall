import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { Simulation, STATES } from '../src/game/Simulation.js';
import { InputController } from '../src/game/InputController.js';
import { sweepAngularInterval, resolveWallRotation, resolveWallSweep, wallSweepFraction,
  wallAngularHalfWidth, wallTopContactY, getWallBounds } from '../src/game/WallCollisionResolver.js';
import { WALL_CONFIG } from '../src/game/ObstacleConfig.js';
import { TAU } from '../src/game/math.js';

function wallPlatform(type = 'low') {
  return {
    id: 'wall-platform', index: 0, type: type === 'low' ? 'lowWall' : 'divider',
    y: 0, active: true, baseRotation: 0,
    segments: [{ kind: 'safe', start: 0, end: TAU }],
    walls: [{ type, angle: CONFIG.world.ballWorldAngle + .7,
      height: type === 'low' ? WALL_CONFIG.lowHeight : WALL_CONFIG.dividerHeight,
      width: WALL_CONFIG.width, innerRadius: CONFIG.world.innerRadius, outerRadius: CONFIG.world.outerRadius }],
  };
}
function simulation(type = 'low') {
  const p = wallPlatform(type);
  const events = [];
  const sim = new Simulation({ levelFactory: () => ({ platforms: [p, {
    id: 'finish', y: -10, active: true, finish: true, baseRotation: 0, segments: [],
  }] }), onEvent: event => events.push(event) });
  return { p, sim, events };
}

describe('swept angular contacts', () => {
  it.each([1, 3, 50])('stops a positive sweep of %s revolutions at the first wall', revolutions => {
    expect(sweepAngularInterval(0, revolutions * TAU, 1, .2)).toBeCloseTo(.8 - WALL_CONFIG.angularEpsilon);
  });
  it.each([1, 3, 50])('stops a negative sweep of %s revolutions at the first wall', revolutions => {
    expect(sweepAngularInterval(0, -revolutions * TAU, -1, .2)).toBeCloseTo(-.8 + WALL_CONFIG.angularEpsilon);
  });
  it('works across the zero/two-pi seam in either direction', () => {
    expect(sweepAngularInterval(TAU - .4, 1, .1, .1)).toBeCloseTo(.4 - WALL_CONFIG.angularEpsilon);
    expect(sweepAngularInterval(.4, -1, TAU - .1, .1)).toBeCloseTo(-.4 + WALL_CONFIG.angularEpsilon);
  });
  it('allows immediate reverse movement away from a blocked contact without jitter', () => {
    const allowed = sweepAngularInterval(0, 2, 1, .2);
    expect(sweepAngularInterval(allowed, .2, 1, .2)).toBeCloseTo(0, 10);
    expect(sweepAngularInterval(allowed, -.3, 1, .2)).toBe(-.3);
  });
  it('lets a sphere leave a top contact but cannot skip the next full revolution', () => {
    expect(sweepAngularInterval(1, TAU * 3, 1, .2)).toBeCloseTo(TAU - .2 - WALL_CONFIG.angularEpsilon);
  });
});

describe('sphere contact with low walls and tall dividers', () => {
  it('blocks below a low wall top and permits passage clearly above it', () => {
    const p = wallPlatform();
    const blocked = resolveWallRotation([p], 0, 2, CONFIG.physics.ballRadius);
    expect(blocked.delta).toBeGreaterThan(.5);
    expect(blocked.delta).toBeLessThan(.7);
    const clear = resolveWallRotation([p], 0, 2, WALL_CONFIG.lowHeight + CONFIG.physics.ballRadius + .01);
    expect(clear.delta).toBe(2);
  });
  it('blocks a tall divider through the normal bounce apex and releases below its band', () => {
    const p = wallPlatform('divider');
    expect(resolveWallRotation([p], 0, 2, 1.71).delta).toBeLessThan(2);
    expect(resolveWallRotation([p], 0, 2, -.3).delta).toBe(2);
    expect(p.walls[0].height).toBeLessThan(CONFIG.world.platformSpacing - CONFIG.world.platformThickness);
  });
  it('uses the actual rounded sphere instead of a vertical point test', () => {
    const p = wallPlatform();
    expect(wallAngularHalfWidth(p, p.walls[0], WALL_CONFIG.lowHeight + .2)).toBeGreaterThan(0);
    expect(wallAngularHalfWidth(p, p.walls[0], WALL_CONFIG.lowHeight + .28)).toBe(0);
  });
  it('ignores removed walls and destroyed platforms immediately', () => {
    const p = wallPlatform();
    p.active = false;
    expect(resolveWallRotation([p], 0, 20, .275).delta).toBe(20);
    p.active = true;
    p.walls[0].active = false;
    expect(resolveWallRotation([p], 0, 20, .275).delta).toBe(20);
  });
  it('kills once on a 3.0× full viewport input and ignores its remaining displacement', () => {
    const { sim, events } = simulation();
    sim.rotate(CONFIG.input.sensitivity * 3);
    expect(sim.rotation).toBeLessThan(.7);
    expect(events.filter(event => event.type === 'playerDied')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'playerDied', wallContact: true, platformIndex: 0 });
    expect(sim.state).toBe(STATES.DEAD_ANIMATION);
    const contact = sim.rotation;
    expect(sim.rotate(-.1)).toBe(false);
    sim.step(.01);
    expect(sim.rotation).toBe(contact);
    expect(events.filter(event => event.type === 'playerDied')).toHaveLength(1);
  });
  it.each([STATES.DEAD_WAITING, STATES.DEAD_ANIMATION, STATES.COMPLETING])('does not move walls in %s', state => {
    const { sim } = simulation();
    sim.state = state;
    expect(sim.rotate(1)).toBe(false);
    expect(sim.rotation).toBe(0);
  });
  it('kills at a descending wall-top contact, including the rounded edge', () => {
    const { p, sim, events } = simulation();
    sim.rotation = .74;
    const contactY = wallTopContactY(p, p.walls[0], sim.rotation);
    expect(contactY).toBeGreaterThan(p.walls[0].height);
    expect(contactY).toBeLessThan(p.walls[0].height + CONFIG.physics.ballRadius);
    sim.ball.y = contactY + .05;
    sim.ball.velocity = -10;
    sim.step(.02);
    expect(sim.ball.y).toBeCloseTo(contactY);
    expect(sim.ball.velocity).toBe(0);
    expect(sim.ball.previousY).toBe(sim.ball.y);
    expect(events.at(-1)).toMatchObject({ type: 'playerDied', wallContact: true });
    expect(sim.state).toBe(STATES.DEAD_ANIMATION);
  });
  it('kills a smash-ready ball on a wall top without destroying the parent', () => {
    const { p, sim, events } = simulation();
    sim.rotation = .7;
    sim.ball.y = p.walls[0].height + CONFIG.physics.ballRadius + .05;
    sim.ball.velocity = -10;
    sim.smashReady = true;
    sim.passCount = CONFIG.smash.threshold;
    sim.step(.02);
    expect(p.active).toBe(true);
    expect(sim.smashReady).toBe(false);
    expect(sim.passCount).toBe(0);
    expect(sim.ball.velocity).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'playerDied', wallContact: true });
    expect(events.some(event => event.type === 'platformSmashed')).toBe(false);
  });

  it('preserves the active-ceiling safeguard for a synthetic elevated rebound', () => {
    const { sim, p, events } = simulation();
    const upper = { id: 'ceiling', y: CONFIG.world.platformSpacing, baseRotation: 0,
      active: true, segments: [{ kind: 'safe', start: 0, end: TAU }] };
    sim.platforms.unshift(upper);
    // Synthetic high rebound retains the general ceiling safeguard; this angle
    // is safely away from the now-lethal wall.
    sim.rotation = 0;
    sim.rebound(p, p.walls[0].height + CONFIG.physics.ballRadius);
    for (let step = 0; step < 30; step++) {
      sim.step(CONFIG.physics.fixedStep);
      expect(sim.ball.y + CONFIG.physics.ballRadius).toBeLessThanOrEqual(upper.y - CONFIG.world.platformThickness + 1e-9);
    }
    expect(events.some(event => event.type === 'ceilingContact')).toBe(true);
    expect(sim.state).not.toContain('DEAD');
  });
  it('invalidates a lethal pointer sweep so retry cannot release stored rotation', () => {
    const { sim } = simulation();
    class Surface extends EventTarget {
      clientWidth = 400;
      setPointerCapture() {}
      releasePointerCapture() {}
    }
    const surface = new Surface();
    const input = new InputController(surface, { onRotate: delta => sim.rotate(delta),
      canRotate: () => [STATES.ACTIVE, STATES.HOLDING].includes(sim.state),
      getSensitivityMultiplier: () => 3 });
    const pointer = (type, x) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { pointerId: 1, clientX: x, clientY: 10, pointerType: 'touch', button: 0 });
      surface.dispatchEvent(event);
    };
    pointer('pointerdown', 0);
    pointer('pointermove', 400);
    const blockedRotation = sim.rotation;
    sim.ball.y = 2;
    pointer('pointermove', 401);
    expect(sim.rotation).toBe(blockedRotation);
    expect(input.gesture).toBe(null);
    sim.state = STATES.DEAD_WAITING;
    sim.retry();
    pointer('pointermove', 600);
    expect(sim.rotation).toBe(0);
    input.dispose();
  });
});

describe('continuous lethal wall sweep', () => {
  it.each(['low', 'divider'])('kills %s side contact even when smash-ready', type => {
    const { sim, events } = simulation(type);
    sim.smashReady = true;
    sim.rotate(2);
    expect(sim.state).toBe(STATES.DEAD_ANIMATION);
    expect(sim.smashReady).toBe(false);
    expect(events.filter(event => event.type === 'playerDied')).toHaveLength(1);
    expect(events.some(event => event.type === 'platformSmashed')).toBe(false);
  });

  it('lets a low wall cross safely at the approved bounce apex', () => {
    const { sim } = simulation();
    for (let step = 0; step < 38; step++) sim.step(CONFIG.physics.fixedStep);
    expect(sim.ball.y - CONFIG.physics.ballRadius).toBeGreaterThan(WALL_CONFIG.lowHeight);
    expect(sim.rotate(TAU * 3)).toBe(true);
    expect(sim.state).toBe(STATES.ACTIVE);
  });

  it('cannot jump a divider at the approved bounce apex', () => {
    const { sim } = simulation('divider');
    for (let step = 0; step < 38; step++) sim.step(CONFIG.physics.fixedStep);
    sim.rotate(TAU * 3);
    expect(sim.state).toBe(STATES.DEAD_ANIMATION);
  });

  it('detects a descending side/corner sweep without final overlap', () => {
    const p = wallPlatform();
    const hit = resolveWallSweep([p], .7, 0, 3, -3);
    expect(hit.wall).toBe(p.walls[0]);
    expect(hit.y).toBeCloseTo(wallTopContactY(p, p.walls[0], .7));
    expect(hit.fraction).toBeGreaterThan(0);
    expect(hit.fraction).toBeLessThan(1);
  });

  it('detects ascending underside contact', () => {
    const p = wallPlatform();
    const bounds = getWallBounds(p, p.walls[0]);
    const hit = resolveWallSweep([p], .7, 0, -1, 1);
    expect(hit.wall).toBe(p.walls[0]);
    expect(hit.y).toBeCloseTo(bounds.minY - CONFIG.physics.ballRadius);
  });

  it.each([1, -1])('finds a lethal contact across the angular seam in direction %s', direction => {
    const p = wallPlatform();
    p.baseRotation = CONFIG.world.ballWorldAngle;
    p.walls[0].angle = direction > 0 ? .1 : TAU - .1;
    const hit = resolveWallSweep([p], direction > 0 ? TAU - .4 : .4, direction, .3, .3);
    expect(hit.wall).toBe(p.walls[0]);
    expect(Math.abs(hit.delta)).toBeGreaterThan(.3);
    expect(Math.abs(hit.delta)).toBeLessThan(.5);
  });

  it.each([1, 3, 50, 1000000])('detects the first contact across %s complete turns', turns => {
    const p = wallPlatform();
    const first = resolveWallSweep([p], 0, TAU * turns, .4, .4);
    expect(first.wall).toBe(p.walls[0]);
    expect(first.delta).toBeGreaterThan(.5);
    expect(first.delta).toBeLessThan(.7);
    expect(first.delta).toBeCloseTo(resolveWallSweep([p], 0, TAU, .4, .4).delta, 9);
  });

  it.each([1, -1])('handles simultaneous descent and rotation in direction %s', direction => {
    const p = wallPlatform();
    p.walls[0].angle = CONFIG.world.ballWorldAngle + direction * .7;
    const hit = resolveWallSweep([p], 0, direction * 2, 1.6, .3);
    expect(hit.wall).toBe(p.walls[0]);
    expect(hit.fraction).toBeGreaterThan(.25);
    expect(hit.fraction).toBeLessThan(.5);
    // Stop just before contact, then the remaining interval finds it at its start.
    const before = hit.fraction - 1e-5;
    expect(resolveWallSweep([p], 0, direction * 2 * before, 1.6, 1.6 - 1.3 * before).wall).toBe(null);
    expect(resolveWallSweep([p], hit.delta, direction * .01, hit.y, hit.y - .01).fraction).toBeLessThan(1e-6);
  });

  it('can clear the first turn above a low wall but die during a later descending turn', () => {
    const p = wallPlatform();
    const hit = resolveWallSweep([p], 0, TAU * 8, 3, .3);
    expect(hit.wall).toBe(p.walls[0]);
    expect(hit.delta).toBeGreaterThan(TAU * 5);
    expect(hit.y).toBeLessThan(WALL_CONFIG.lowHeight + CONFIG.physics.ballRadius);
  });

  it('returns the nearest wall regardless of platform list order and stops before later floors', () => {
    const { p, sim, events } = simulation();
    p.walls.push({ ...p.walls[0], angle: CONFIG.world.ballWorldAngle + .4 });
    sim.rotate(TAU * 10);
    expect(events.at(-1).wall).toBe(p.walls[1]);
    expect(sim.rotation).toBeLessThan(.4);
    expect(events.filter(event => event.type === 'playerDied')).toHaveLength(1);

    const other = simulation();
    other.sim.rotation = .7;
    other.sim.ball.y = 3;
    other.sim.ball.velocity = -18.4;
    other.sim.step(.5);
    expect(other.sim.state).toBe(STATES.DEAD_ANIMATION);
    expect(other.p.active).toBe(true);
    expect(other.events.some(event => ['platformLanded', 'platformSmashed', 'platformPassed'].includes(event.type))).toBe(false);
  });

  it('honours earlier safe platform contact before a lower wall', () => {
    const { sim, p, events } = simulation();
    const upper = { ...p, id: 'upper-safe', index: -1, y: 1.5, walls: [] };
    sim.platforms.unshift(upper);
    sim.rotation = .7;
    sim.ball.y = 3;
    sim.ball.velocity = -18.4;
    sim.step(.5);
    expect(sim.state).toBe(STATES.HOLDING);
    expect(sim.ball.y).toBeCloseTo(upper.y + CONFIG.physics.ballRadius);
    expect(events.some(event => event.type === 'playerDied')).toBe(false);
  });

  it('uses a small shared inset and explicit low-wall clearance plane', () => {
    const p = wallPlatform();
    const b = getWallBounds(p, p.walls[0]);
    expect(b.halfWidth).toBeCloseTo(.05);
    expect(b.maxY).toBeCloseTo(.892);
    const grazingY = WALL_CONFIG.lowHeight + CONFIG.physics.ballRadius - .004;
    expect(resolveWallSweep([p], 0, TAU, grazingY, grazingY).wall).toBe(null);
    const obviousY = WALL_CONFIG.lowHeight + CONFIG.physics.ballRadius - .03;
    expect(resolveWallSweep([p], 0, TAU, obviousY, obviousY).wall).toBe(p.walls[0]);
    expect(resolveWallSweep([p], 0, TAU, b.maxY + CONFIG.physics.ballRadius + .001,
      b.maxY + CONFIG.physics.ballRadius + .001).wall).toBe(null);
  });

  it('rounds a top corner instead of killing within an inflated square box', () => {
    const p = wallPlatform();
    const b = getWallBounds(p, p.walls[0]);
    const angle = .7 + Math.asin((b.halfWidth + .23) / CONFIG.world.ballOrbitRadius);
    const y = b.maxY + .23;
    expect(wallSweepFraction(p, p.walls[0], angle, 0, y, y)).toBe(Infinity);
    expect(wallSweepFraction(p, p.walls[0], angle, 0, y - .12, y - .12)).toBe(0);
  });

  it('permits a microscopic side graze moving away but kills clear side penetration', () => {
    const { p, sim } = simulation();
    const b = getWallBounds(p, p.walls[0]);
    const edge = Math.asin((CONFIG.physics.ballRadius + b.halfWidth) / CONFIG.world.ballOrbitRadius);
    sim.rotation = .7 - edge - .002;
    sim.rotate(-.02);
    expect(sim.state).toBe(STATES.ACTIVE);
    sim.rotation = .7 - edge + .002;
    sim.rotate(-.02);
    expect(sim.state).toBe(STATES.DEAD_ANIMATION);
  });

  it('removes the wall collider immediately after its parent is smashed at the platform plane', () => {
    const { p, sim, events } = simulation();
    sim.ball.y = CONFIG.physics.ballRadius + .03;
    sim.ball.velocity = -10;
    sim.smashReady = true;
    sim.step(.02);
    expect(p.active).toBe(false);
    expect(events.some(event => event.type === 'platformSmashed')).toBe(true);
    expect(events.some(event => event.type === 'playerDied')).toBe(false);
    expect(resolveWallSweep([p], 0, TAU * 10, .3, -.3).wall).toBe(null);
  });

  it('matches an independent sampled sphere/box oracle for simultaneous sweeps', () => {
    let seed = 42191;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const samples = 6000;
    for (let caseIndex = 0; caseIndex < 120; caseIndex++) {
      const p = wallPlatform(caseIndex % 2 ? 'low' : 'divider');
      p.baseRotation = random() * TAU;
      p.walls[0].angle = random() * TAU;
      const rotation = random() * TAU;
      const delta = (random() - .5) * 180;
      const startY = random() * 5 - 2;
      const endY = random() * 5 - 2;
      const hit = resolveWallSweep([p], rotation, delta, startY, endY);
      const b = getWallBounds(p, p.walls[0]);
      const inside = fraction => {
        const angle = CONFIG.world.ballWorldAngle + rotation + delta * fraction - p.baseRotation - p.walls[0].angle;
        const x = CONFIG.world.ballOrbitRadius * Math.cos(angle);
        const z = CONFIG.world.ballOrbitRadius * Math.sin(angle);
        const y = startY + (endY - startY) * fraction;
        const squared = Math.max(b.minRadius - x, x - b.maxRadius, 0) ** 2
          + Math.max(Math.abs(z) - b.halfWidth, 0) ** 2
          + Math.max(b.minY - y, y - b.maxY, 0) ** 2;
        return squared < CONFIG.physics.ballRadius ** 2 - 1e-10;
      };
      let firstSample = Infinity;
      for (let sample = 0; sample <= samples; sample++) {
        if (inside(sample / samples)) { firstSample = sample / samples; break; }
      }
      if (Number.isFinite(firstSample)) {
        expect(hit.wall, `missed case ${caseIndex}`).toBe(p.walls[0]);
        expect(hit.fraction).toBeLessThanOrEqual(firstSample + 1e-7);
        expect(hit.fraction).toBeGreaterThanOrEqual(firstSample - 1 / samples - 1e-6);
      } else if (hit.wall) {
        // A very narrow real crossing can lie between the oracle's samples.
        expect(inside(Math.min(1, hit.fraction + 1e-7)), `false hit ${caseIndex}`).toBe(true);
      }
    }
  });

  it.each([STATES.DEAD_WAITING, STATES.DEAD_ANIMATION, STATES.COMPLETING, STATES.TRANSITIONING])(
    'does not process an overlapping fin in %s', state => {
      const { sim, events } = simulation();
      sim.rotation = .7;
      sim.state = state;
      sim.step(.01);
      expect(events.some(event => event.type === 'playerDied')).toBe(false);
    });

  it('ignores destroyed walls during combined sweeps without changing caller state', () => {
    const p = wallPlatform();
    p.active = false;
    const result = {};
    expect(resolveWallSweep([p], 0, TAU * 4, 3, -3, result)).toBe(result);
    expect(result.wall).toBe(null);
    expect(result.delta).toBe(TAU * 4);
    expect(p.active).toBe(false);
  });

  it('rejects non-finite sweep input without NaN contact results', () => {
    const p = wallPlatform();
    expect(wallSweepFraction(p, p.walls[0], 0, Infinity, .3, .3)).toBe(Infinity);
    expect(wallSweepFraction(p, p.walls[0], NaN, 1, .3, .3)).toBe(Infinity);
  });
});
