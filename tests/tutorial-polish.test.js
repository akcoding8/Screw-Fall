import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game/Game.js';
import { SaveManager } from '../src/game/SaveManager.js';

function fixture(saved = {}) {
  const storage = { raw: null, getItem() { return this.raw; }, setItem(key, value) { this.raw = value; } };
  const save = new SaveManager(storage, { lifecycle: false }); save.save(saved);
  const nodes = new Map(), node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: '', classList: { toggle: vi.fn() } });
    return nodes.get(id);
  };
  const game = Object.create(Game.prototype);
  Object.assign(game, { save, settings: save.load(), simulation: { state: 'HOLDING' },
    ui: Object.fromEntries(['message', 'message-title', 'message-detail', 'tutorial-gesture', 'settings-toggle'].map(id => [id, node(id)])),
    element: { dataset: {}, querySelector: node }, scoring: { handleEvent: vi.fn(), eligible: true },
    scoreHUD: { setState: vi.fn(), refresh: vi.fn() }, input: { invalidateGesture: vi.fn() } });
  return { game, node, storage, save };
}

describe('clean persistent first-player tutorial', () => {
  it('removes ornamental UI copy and retains useful labels', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const game = readFileSync(new URL('../src/game/Game.js', import.meta.url), 'utf8');
    for (const text of ['THE WAY DOWN', 'A LITTLE ROTATION. A LONG WAY DOWN.', 'Find the gaps. Follow the fall.',
      'YOUR COLLECTION', 'Every shape. The same familiar fall.', 'A little off course', 'Same tower. A fresh turn.', 'Nicely done. On to the next.']) expect(html + game).not.toContain(text);
    expect(html).toContain('Drag to rotate'); expect(html).toContain('score-holding');
  });
  it('shows new-player guidance, learns on normal play, and retains stats on later holding screens and reload', () => {
    const f = fixture(); try {
      f.game.updateState(); expect(f.node('message-title').textContent).toBe('Drag to rotate');
      expect(f.node('tutorial-gesture').hidden).toBe(false);
      f.game.simulation.state = 'ACTIVE'; f.game.onGameEvent({ type: 'stateChanged', state: 'ACTIVE' });
      expect(f.save.data.hintSeen).toBe(true);
      const reloaded = new SaveManager(f.storage, { lifecycle: false });
      f.game.settings = reloaded.load(); expect(f.game.settings.hintSeen).toBe(true);
      f.game.simulation.state = 'HOLDING'; f.game.updateState();
      expect(f.node('message-title').hidden).toBe(true); expect(f.node('message-detail').hidden).toBe(true);
      expect(f.node('tutorial-gesture').hidden).toBe(true);
      expect(f.node('message').classList.toggle).toHaveBeenLastCalledWith('quiet', false);
      expect(f.game.scoreHUD.setState).toHaveBeenLastCalledWith('HOLDING'); reloaded.dispose();
    } finally { f.save.dispose(); }
  });
  it('does not learn from debug play or repeatedly write an already learned tutorial', () => {
    const f = fixture(); try {
      const write = vi.spyOn(f.save, 'save'); f.game.scoring.eligible = false;
      f.game.simulation.state = 'ACTIVE'; f.game.onGameEvent({ type: 'stateChanged', state: 'ACTIVE' });
      expect(f.save.data.hintSeen).toBe(false); expect(write).not.toHaveBeenCalled();
      f.game.scoring.eligible = true; f.game.onGameEvent({ type: 'stateChanged', state: 'ACTIVE' });
      f.game.onGameEvent({ type: 'stateChanged', state: 'ACTIVE' }); expect(write).toHaveBeenCalledOnce();
    } finally { f.save.dispose(); }
  });
});
