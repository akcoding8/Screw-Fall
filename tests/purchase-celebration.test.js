import { describe, expect, it, vi } from 'vitest';
import { PurchaseCelebration, PURCHASE_CELEBRATIONS } from '../src/game/PurchaseCelebration.js';
import { getSkinDefinition } from '../src/game/SkinCatalog.js';
import { SoundManager } from '../src/game/SoundManager.js';

describe('bounded purchase feedback', () => {
  it.each([['rubber', 'standard'], ['pearl-shift', 'premium'], ['auric-gold', 'gold']])('%s ends within one second and reuses its pool', (id, kind) => {
    const canvas = { hidden: true }, burst = new PurchaseCelebration(canvas, { reducedMotion: false });
    const pool = [...burst.particles]; burst.start(getSkinDefinition(id));
    expect(burst.kind).toBe(kind); expect(burst.count).toBe(PURCHASE_CELEBRATIONS[kind].count);
    expect(burst.duration).toBeGreaterThanOrEqual(.5); expect(burst.duration).toBeLessThanOrEqual(1);
    expect(canvas.hidden).toBe(false);
    for (let i = 0; i < 121; i++) burst.update(1 / 120);
    expect(burst.active).toBe(false); expect(canvas.hidden).toBe(true);
    burst.start(getSkinDefinition(id));
    expect(burst.particles).toHaveLength(32); pool.forEach((p, i) => expect(burst.particles[i]).toBe(p));
    burst.dispose(); expect(canvas.hidden).toBe(true);
  });
  it('has restrained increasing budgets and a stationary reduced-motion alternative', () => {
    expect(PURCHASE_CELEBRATIONS.standard.count).toBeLessThan(PURCHASE_CELEBRATIONS.premium.count);
    expect(PURCHASE_CELEBRATIONS.premium.count).toBeLessThan(PURCHASE_CELEBRATIONS.gold.count);
    const burst = new PurchaseCelebration(null, { reducedMotion: true }); burst.start(getSkinDefinition('auric-gold'));
    const before = burst.particles.map(p => ({ ...p })); burst.update(.25);
    expect(burst.count).toBe(8); expect(burst.particles).toEqual(before);
    burst.update(.25); expect(burst.active).toBe(false);
  });
  it('plays short confirmation cues through existing mute and voice handling', () => {
    const sound = new SoundManager(); sound.context = { state: 'running' }; sound.playNote = vi.fn();
    for (const [name, count] of [['purchase', 2], ['purchasePremium', 3], ['purchaseGold', 4]]) {
      sound.playNote.mockClear(); sound.play(name); expect(sound.playNote).toHaveBeenCalledTimes(count);
      for (const [note] of sound.playNote.mock.calls) expect((note.delay || 0) + note.duration).toBeLessThan(.5);
    }
    sound.muted = true; sound.playNote.mockClear(); sound.play('purchaseGold'); expect(sound.playNote).not.toHaveBeenCalled();
  });
});
