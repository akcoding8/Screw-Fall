import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { makePlatform } from '../src/game/LevelGeometry.js';
import { SeededRandom } from '../src/game/SeededRandom.js';
import { arcContains, TAU } from '../src/game/math.js';
import { classifyLocalAngle } from '../src/game/LevelManager.js';
import { createPlatform, disposePlatform, setPlatformPalette } from '../src/game/Platform.js';
import { ParticleSystem } from '../src/game/ParticleSystem.js';
import { selectPalette } from '../src/game/PaletteManager.js';
import { SILHOUETTE_CONFIG, SILHOUETTE_NAMES, applyPlatformSilhouette, minimumSafeAngularWidth,
  usableWidthInBallDiameters, validatePlatformSilhouette } from '../src/game/PlatformSilhouettes.js';

function silhouette(name, seed = 99, context = {}) {
  const platform = makePlatform(13, 0, 1.3, .8);
  return applyPlatformSilhouette(platform, new SeededRandom(seed), {
    difficulty: 'standard', previousAngle: 1.65, shoulderType: 'none', requestedSilhouette: name, ...context,
  });
}

describe('original authoritative silhouette vocabulary', () => {
  it.each(SILHOUETTE_NAMES)('constructs %s with a real gap and a safe incoming landing', name => {
    const platform = silhouette(name);
    expect(platform.silhouette).toBe(name);
    expect(validatePlatformSilhouette(platform)).toMatchObject({ valid: true, errors: [] });
    expect(classifyLocalAngle(platform, 0)).toBe('gap');
    expect(classifyLocalAngle(platform, 1.65)).toBe('safe');
    for (let step = 0; step < 720; step++) {
      const angle = step * TAU / 720;
      const matches = platform.segments.filter(segment => arcContains(angle, segment.start, segment.end));
      expect(matches.length).toBeLessThanOrEqual(1);
      if (!matches.length) expect(classifyLocalAngle(platform, angle)).toBe('gap');
      else if (matches[0].kind === 'safe') expect(classifyLocalAngle(platform, angle)).toBe('safe');
    }
  });

  it('creates the requested disconnected topology, including avoidable complete hazard pieces', () => {
    for (const [name, count] of Object.entries({ broadRing: 1, offsetRing: 2, twoCrescents: 2,
      pairedLedges: 2, threePiece: 3, fourPiece: 4, smallIsland: 1, tinyLedge: 1,
      safeHazardIslands: 2, sparseObstacles: 2, mixedPieces: 3 })) {
      expect(silhouette(name).silhouetteMetrics.pieceCount).toBe(count);
    }
    for (const name of ['safeHazardIslands', 'sparseObstacles', 'mixedPieces']) {
      const platform = silhouette(name);
      expect(platform.silhouetteMetrics.hazardIslands).toBe(1);
      const hazard = platform.segments.find(segment => segment.kind === 'hazard');
      expect(classifyLocalAngle(platform, (hazard.start + hazard.end) / 2)).toBe('hazard');
      expect(classifyLocalAngle(platform, 0)).toBe('gap');
    }
  });

  it('retains distinct broad, medium, compact, third and quarter coverage ranges', () => {
    const coverage = name => TAU - silhouette(name).totalGapCoverage;
    expect(coverage('broadRing')).toBeGreaterThan(coverage('mediumCrescent'));
    expect(coverage('mediumCrescent')).toBeGreaterThan(coverage('compactCrescent'));
    expect(coverage('compactCrescent')).toBeGreaterThan(coverage('third'));
    expect(coverage('third')).toBeGreaterThan(coverage('quarter'));
    expect(coverage('quarter')).toBeGreaterThan(coverage('tinyLedge'));
  });

  it('preserves topology and fair incoming targets across seeds and both route directions', () => {
    for (const name of SILHOUETTE_NAMES) for (let seed = 1; seed <= 24; seed++) {
      for (const previousAngle of [1.4, 1.85, -1.4, -1.85]) {
        const platform = silhouette(name, seed, { previousAngle, shoulderType: undefined });
        expect(validatePlatformSilhouette(platform).errors).toEqual([]);
        expect(classifyLocalAngle(platform, previousAngle)).toBe('safe');
        expect(platform.silhouetteMetrics.safeWidthBallDiameters).toBeGreaterThanOrEqual(1.5 - 1e-7);
      }
    }
  });

  it('reconstructs fresh identical arcs on retry and leaves protected roles broad', () => {
    for (const name of SILHOUETTE_NAMES) {
      const first = silhouette(name), retry = silhouette(name);
      expect(retry).toEqual(first);
      first.segments[0].start += .1;
      expect(retry).toEqual(silhouette(name));
    }
    for (const role of ['opening', 'final', 'recovery', 'longDrop', 'smash']) {
      const platform = makePlatform(13, 0, 1.3, .8, role);
      const original = structuredClone(platform.segments);
      applyPlatformSilhouette(platform, new SeededRandom(20), { requestedSilhouette: 'tinyLedge' });
      expect(platform.silhouette).toBe('broadRing');
      expect(platform.segments).toEqual(original);
      expect(platform.hazardShoulder).toBe('none');
    }
  });

  it('permits only readable variations where the route generator explicitly selects them', () => {
    for (const role of ['opening', 'final', 'longDrop']) {
      for (const requestedSilhouette of ['tinyLedge', 'mixedPieces', 'mediumCrescent', 'offsetRing']) {
        const platform = makePlatform(13, 0, 1.3, .5, role);
        applyPlatformSilhouette(platform, new SeededRandom(99), { previousAngle: role === 'longDrop' ? 0 : 1.65,
          requestedSilhouette, shoulderType: 'double', hazardIsland: true,
          allowReadableVariation: true, allowPlannedVariation: true });
        expect(['broadRing', 'offsetRing', 'mediumCrescent', 'twoCrescents']).toContain(platform.silhouette);
        expect(platform.hazardShoulder).toBe('none');
        expect(platform.silhouetteMetrics.hazardIslands).toBe(0);
        expect(validatePlatformSilhouette(platform).errors).toEqual([]);
        for (const angle of [-.64, 0, .64]) expect(classifyLocalAngle(platform, angle)).toBe('gap');
      }
    }
  });
});

describe('physical safe landing widths', () => {
  it('derives its angle from the usable chord plus a physical margin on each side', () => {
    for (const ballRadius of [.25, .275, .3]) for (const contactRadius of [1.8, 2.05, 2.4]) {
      for (const diameters of [1.5, 2, 2.5]) {
        const angle = minimumSafeAngularWidth(diameters, ballRadius, contactRadius);
        const chord = 2 * contactRadius * Math.sin(angle / 2);
        expect(chord).toBeCloseTo(diameters * ballRadius * 2 + 2 * SILHOUETTE_CONFIG.landingMargin, 12);
        expect(usableWidthInBallDiameters(angle, ballRadius, contactRadius)).toBeCloseTo(diameters, 12);
      }
    }
    expect(minimumSafeAngularWidth() * 180 / Math.PI).toBeGreaterThan(26);
    expect(minimumSafeAngularWidth() * 180 / Math.PI).toBeLessThan(27);
  });

  it('never shrinks a tiny ledge to fit or stacks it with shoulders', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const platform = silhouette('tinyLedge', seed, { shoulderType: 'double' });
      expect(platform.silhouetteMetrics.safeWidthBallDiameters).toBeGreaterThanOrEqual(1.5 - 1e-7);
      expect(platform.silhouetteMetrics.safeWidthBallDiameters).toBeLessThanOrEqual(2.5 + 1e-7);
      expect(platform.hazardShoulder).toBe('none');
      expect(platform.segments.every(segment => segment.kind === 'safe')).toBe(true);
    }
    const invalid = silhouette('tinyLedge');
    invalid.segments[0].end = invalid.segments[0].start + minimumSafeAngularWidth() * .8;
    delete invalid.silhouetteMetrics;
    expect(validatePlatformSilhouette(invalid).errors.join(' ')).toContain('physical landing minimum');
  });

  it('rejects malformed dimensions and fully hazardous or overlapping layers', () => {
    expect(minimumSafeAngularWidth(1.5, .275, 0)).toBeNaN();
    expect(minimumSafeAngularWidth(100)).toBeNaN();
    const platform = silhouette('broadRing');
    platform.segments = [{ kind: 'hazard', start: 0, end: TAU }];
    expect(validatePlatformSilhouette(platform).valid).toBe(false);
    platform.segments = [{ kind: 'safe', start: 1, end: 3 }, { kind: 'hazard', start: 2, end: 4 }];
    expect(validatePlatformSilhouette(platform).errors).toContain('Invalid or overlapping silhouette arcs');
  });

  it('cannot claim the largest unrelated safe arc as a landing whose angle is in a gap', () => {
    const platform = silhouette('twoCrescents');
    platform.landingAngle = 0;
    expect(validatePlatformSilhouette(platform).errors).toContain('Landing target is outside actual safe geometry');
    expect(validatePlatformSilhouette(platform).metrics.safeWidthBallDiameters).toBe(0);
  });

  it('cannot conceal a sparse target behind broad metadata to bypass difficulty accounting', () => {
    const platform = silhouette('tinyLedge');
    platform.silhouette = 'broadRing';
    delete platform.silhouetteMetrics;
    expect(validatePlatformSilhouette(platform).errors).toContain('Broad ring metadata conceals additional empty coverage');
    platform.silhouette = 'invented';
    expect(validatePlatformSilhouette(platform).errors).toContain('Unknown platform silhouette');
  });
});

describe('existing renderer, palette and outward destruction preservation', () => {
  it.each(SILHOUETTE_NAMES)('draws, recolours and detaches all pieces of %s without a new destruction path', name => {
    const platform = silhouette(name), scene = new THREE.Scene(), particles = new ParticleSystem(scene);
    const view = createPlatform(platform, selectPalette(17));
    scene.add(view);
    const resources = view.userData.platformResources;
    const geometry = [...resources.geometries];
    const buffers = geometry.map(item => [...item.attributes.position.array]);
    const originalArcs = structuredClone(platform.segments);
    try {
      expect(resources.pieces.length).toBeLessThanOrEqual(CONFIG.particles.passFragmentCount);
      expect(new Set(resources.pieces.map(piece => piece.userData.arc.segmentIndex)).size).toBe(platform.segments.length);
      setPlatformPalette(view, selectPalette(17, 'vivid'));
      expect(resources.geometries).toEqual(geometry);
      expect(geometry.map(item => [...item.attributes.position.array])).toEqual(buffers);
      expect(platform.segments).toEqual(originalArcs);
      const count = view.children.length;
      particles.shatter(view, true);
      expect(view.children).toHaveLength(0);
      expect(particles.activeDebrisCount).toBe(count);
      for (const fragment of particles.fragments) {
        expect(fragment.vx * fragment.piece.position.x + fragment.vz * fragment.piece.position.z).toBeGreaterThan(0);
        expect(fragment.life).toBeGreaterThanOrEqual(CONFIG.particles.fragmentLifetime * .9);
      }
    } finally { particles.dispose(); disposePlatform(view); }
  });
});
