import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ALL_PALETTES, SOFT_PALETTES, VIVID_PALETTES, PALETTE_COLOR_FIELDS, PALETTE_LIMITS,
  PALETTE_STYLES, PALETTE_VERSION, arePalettesSimilar, colorSeparation,
  normalizePaletteStyle, parsePaletteColor, selectPalette, validatePalette,
} from '../src/game/PaletteManager.js';

describe('curated colour libraries', () => {
  it('provides at least 20 explicit, uniquely named palettes in each family', () => {
    expect(SOFT_PALETTES.length).toBeGreaterThanOrEqual(20);
    expect(VIVID_PALETTES.length).toBeGreaterThanOrEqual(20);
    expect(SOFT_PALETTES.every((palette) => palette.family === 'soft')).toBe(true);
    expect(VIVID_PALETTES.every((palette) => palette.family === 'vivid')).toBe(true);
    expect(new Set(ALL_PALETTES.map((palette) => palette.id)).size).toBe(ALL_PALETTES.length);
    expect(new Set(ALL_PALETTES.map((palette) => palette.name)).size).toBe(ALL_PALETTES.length);
    expect(PALETTE_VERSION).toBe(1);
  });

  it.each(ALL_PALETTES.map((palette) => [palette.name, palette]))('validates every colour and contrast in %s', (_, palette) => {
    for (const field of PALETTE_COLOR_FIELDS) expect(parsePaletteColor(palette[field]), field).not.toBeNull();
    expect(palette.confetti.length).toBeGreaterThanOrEqual(3);
    for (const color of palette.confetti) expect(parsePaletteColor(color)).not.toBeNull();
    const result = validatePalette(palette);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    const surface = result.metrics.safeHazard;
    expect(surface.contrast >= PALETTE_LIMITS.surfaceContrast
      || (surface.hueDistance >= PALETTE_LIMITS.surfaceHueSeparation && surface.minimumSaturation >= 0.2 && surface.colorDistance >= 0.28)).toBe(true);
    for (const surfaceName of ['column', 'safe', 'hazard']) {
      expect(result.metrics[`ball-${surfaceName}`].contrast).toBeGreaterThanOrEqual(PALETTE_LIMITS.ballContrast);
    }
    expect(result.metrics.interface.contrast).toBeGreaterThanOrEqual(PALETTE_LIMITS.interfaceContrast);
    expect(result.metrics.background.contrast).toBeGreaterThanOrEqual(PALETTE_LIMITS.backgroundContrast);
  });

  it('keeps the ball deliberately coloured and the families independently curated', () => {
    const balls = ALL_PALETTES.map((palette) => parsePaletteColor(palette.ball));
    expect(balls.every((rgb) => Math.min(...rgb) < 0.84)).toBe(true);
    expect(new Set(ALL_PALETTES.map((palette) => palette.ball)).size).toBeGreaterThan(20);
    expect(new Set(ALL_PALETTES.map((palette) => palette.safe)).size).toBe(40);
    expect(Object.isFrozen(SOFT_PALETTES)).toBe(true);
    expect(Object.isFrozen(SOFT_PALETTES[0])).toBe(true);
    expect(Object.isFrozen(SOFT_PALETTES[0].confetti)).toBe(true);
  });

  it('preserves every Soft preset exactly while making all Vivid surface pairs saturated', () => {
    // Phase 3's Soft data is intentionally untouched by this presentation pass.
    expect(createHash('sha256').update(JSON.stringify(SOFT_PALETTES)).digest('hex'))
      .toBe('a2a7a7cf87f5df86916cdd1b34c6a2d41468e55862636000bb566c269c99c551');
    const saturation = hex => {
      const rgb = parsePaletteColor(hex), maximum = Math.max(...rgb);
      return maximum ? (maximum - Math.min(...rgb)) / maximum : 0;
    };
    VIVID_PALETTES.forEach((palette, index) => {
      expect(saturation(palette.safe), palette.id).toBeGreaterThan(.72);
      expect(saturation(palette.hazard), palette.id).toBeGreaterThan(.73);
      expect(saturation(palette.safe) - saturation(SOFT_PALETTES[index].safe), palette.id)
        .toBeGreaterThan(.20);
      expect(colorSeparation(palette.background, palette.column).contrast, palette.id)
        .toBeGreaterThan(3);
    });
  });

  it('rejects missing colours, malformed colours, low contrast, and invisible bevels', () => {
    const source = SOFT_PALETTES[0];
    expect(validatePalette(null).valid).toBe(false);
    expect(validatePalette({ ...source, safeSide: undefined }).errors).toContain('Invalid colour: safeSide');
    expect(validatePalette({ ...source, hazard: '#zz00ff' }).errors).toContain('Invalid colour: hazard');
    expect(validatePalette({ ...source, confetti: ['red'] }).valid).toBe(false);
    expect(validatePalette({ ...source, hazard: source.safe }).errors).toContain('Safe/hazard colours need stronger luminance or hue separation');
    expect(validatePalette({ ...source, ball: source.column }).errors).toContain('Ball/column contrast is too low');
    expect(validatePalette({ ...source, ball: source.safe }).errors).toContain('Ball/safe contrast is too low');
    expect(validatePalette({ ...source, ball: source.hazard }).errors).toContain('Ball/hazard contrast is too low');
    expect(validatePalette({ ...source, accent: source.uiBackground }).errors).toContain('Interface text contrast is too low');
    expect(validatePalette({ ...source, safeSide: source.safe }).errors).toContain('safe bevel needs depth contrast');
  });

  it('handles colour parsing and circular hue distances explicitly', () => {
    expect(parsePaletteColor('#00ff7F')).toEqual([0, 1, 127 / 255]);
    for (const value of ['red', '#fff', '#1234567', '', undefined, 123, '#12345g']) expect(parsePaletteColor(value)).toBeNull();
    expect(colorSeparation('invalid', '#000000')).toBeNull();
    expect(colorSeparation('#ff0010', '#ff1000').hueDistance).toBeLessThan(10);
    expect(colorSeparation('#ffffff', '#000000').contrast).toBe(21);
  });
});

describe('deterministic level palette selection', () => {
  it.each(PALETTE_STYLES)('preserves %s palette on retry and reload, including large levels', (style) => {
    for (const number of [1, 10, 17, 50, 51, 1757, 100000, 100001, 4294967313, Number.MAX_SAFE_INTEGER]) {
      const first = selectPalette(number, style);
      expect(selectPalette(number, style)).toBe(first);
      expect(JSON.stringify(selectPalette(number, style))).toBe(JSON.stringify(first));
      if (style !== 'mixed') expect(first.family).toBe(style);
    }
  });

  it.each(PALETTE_STYLES)('avoids adjacent similar palettes and short ABAB runs in %s', (style) => {
    const used = new Set();
    for (let number = 1; number <= 10000; number += 1) {
      const current = selectPalette(number, style);
      const next = selectPalette(number + 1, style);
      used.add(current.id);
      expect(next.id).not.toBe(current.id);
      expect(arePalettesSimilar(current, next), `levels ${number}/${number + 1}`).toBe(false);
      expect(selectPalette(number + 2, style).id).not.toBe(current.id);
    }
    expect(used.size).toBe(style === 'mixed' ? 40 : 20);
  });

  it('varies Mixed family order with no family run longer than two levels', () => {
    const familyPairs = new Set();
    let longest = 0;
    let run = 0;
    let previous;
    for (let number = 1; number <= 10000; number += 1) {
      const family = selectPalette(number, 'mixed').family;
      run = family === previous ? run + 1 : 1;
      longest = Math.max(longest, run);
      if (number % 2 === 1) familyPairs.add(`${family}/${selectPalette(number + 1, 'mixed').family}`);
      previous = family;
    }
    expect(longest).toBe(2);
    expect(familyPairs).toEqual(new Set(['soft/vivid', 'vivid/soft']));
  });

  it('recovers invalid styles and level numbers to deterministic defaults', () => {
    for (const style of [undefined, null, 1, {}, 'Soft', 'other']) {
      expect(normalizePaletteStyle(style)).toBe('soft');
      expect(selectPalette(17, style)).toBe(selectPalette(17, 'soft'));
    }
    for (const number of [0, -1, Infinity, NaN, '17', 2.5]) expect(selectPalette(number)).toBe(selectPalette(1));
  });
});
