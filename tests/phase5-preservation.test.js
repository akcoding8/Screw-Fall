import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import baseline from './fixtures/phase5-baseline.json';
import { CONFIG } from '../src/game/config.js';
import { EVIDENCE_DATABASE } from '../src/game/EvidenceImageStore.js';

const hash = contents => createHash('sha256').update(contents).digest('hex');
// Phase 5 adds release adapters and UI. Its only existing game-module changes
// connect event-driven update safety, drain pending evidence operations, and
// verify persistence before restart. The normal save fallback is unchanged.
// Every simulation, renderer, generator, progression and cosmetic module stays
// byte-identical to the working Phase 4 snapshot, including the save schema.
const releaseAdapters = new Set(['src/main.js', 'src/styles.css', 'src/game/Game.js',
  'src/game/ProgressPanel.js', 'src/game/EvidenceImageStore.js', 'src/game/SaveManager.js']);

describe('Phase 5 preserves the complete approved game', () => {
  it.each(Object.entries(baseline.sourceHashes).filter(([file]) => !releaseAdapters.has(file)))(
    'preserves %s byte-for-byte', (file, expected) => {
      expect(hash(readFileSync(new URL(`../${file}`, import.meta.url)))).toBe(expected);
    });

  it('adds only the explicit verified restart gate to the existing SaveManager', () => {
    const source = readFileSync(new URL('../src/game/SaveManager.js', import.meta.url), 'utf8');
    const start = source.indexOf('  /** A PWA restart'), end = source.indexOf('  bindLifecycle', start);
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    expect(hash(source.slice(0, start) + source.slice(end))).toBe(baseline.sourceHashes['src/game/SaveManager.js']);
  });

  it('retains same-origin save data and evidence names without unnecessary migrations', () => {
    expect(CONFIG.save.version).toBe(baseline.saveVersion);
    expect(CONFIG.save.key).toBe(baseline.localStorage[0]);
    expect(CONFIG.save.key.startsWith('screw-fall:')).toBe(true);
    expect(EVIDENCE_DATABASE).toEqual({ name: baseline.indexedDB.name, version: baseline.indexedDB.version,
      images: baseline.indexedDB.stores[0], metadata: baseline.indexedDB.stores[1] });
    expect(EVIDENCE_DATABASE.name.startsWith('screw-fall-')).toBe(true);
  });
});
