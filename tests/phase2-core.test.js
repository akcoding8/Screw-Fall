import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config.js';
import { PHASE16_CONFIG } from './fixtures/phase16-config.js';

describe('approved core tuning remains locked through Phase 2.1', () => {
  it('changes only the authorised impulse, descent cap, composition and save schema', () => {
    expect(CONFIG.physics).toEqual({ ...PHASE16_CONFIG.physics, bounceVelocity: 9.058875, maxDownwardSpeed: 18.4 });
    expect(CONFIG.physics.bounceVelocity / PHASE16_CONFIG.physics.bounceVelocity).toBeCloseTo(1.015, 12);
    for (const section of ['world', 'input', 'particles', 'audio', 'renderer']) {
      expect(CONFIG[section], section).toEqual(PHASE16_CONFIG[section]);
    }
    for (const key of ['distance', 'height', 'targetOffset', 'pitchDegrees', 'fieldOfView', 'portraitWidth', 'followResponse', 'impactStrength', 'smashStrength']) {
      expect(CONFIG.camera[key], key).toBe(PHASE16_CONFIG.camera[key]);
    }
    expect(CONFIG.save).toEqual({ ...PHASE16_CONFIG.save, version: 5 });
  });
});
