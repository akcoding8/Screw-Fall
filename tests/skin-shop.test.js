import { describe, expect, it, vi } from 'vitest';
import { SkinShopPanel } from '../src/game/SkinShopPanel.js';
import { InputController } from '../src/game/InputController.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { SkinManager } from '../src/game/SkinManager.js';

class Element extends EventTarget {
  constructor(doc) { super(); this.ownerDocument = doc; this.dataset = {}; this.attributes = {}; this.children = []; this.open = false; this.textContent = ''; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  focus = vi.fn();
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}
function fixture() {
  const doc = { defaultView: new EventTarget(), createElement: () => new Element(doc) };
  const nodes = new Map();
  const element = { querySelector: id => { if (!nodes.has(id)) nodes.set(id, new Element(doc)); return nodes.get(id); } };
  const surface = new Element(doc); surface.clientWidth = 390;
  const rotate = vi.fn(), tap = vi.fn();
  const input = new InputController(surface, { onRotate: rotate, onTap: tap });
  const storage = { getItem: () => null, setItem: vi.fn() };
  const save = new SaveManager(storage, { lifecycle: false });
  save.save({ pointsBalance: 3000, lifetimePoints: 3000, currentNoDeathScore: 400, bestNoDeathScore: 400 });
  const scoring = new ScoringManager({ save }), skins = new SkinManager({ scoring });
  const preview = Object.fromEntries(['open','close','select','setPalette','update','dispose'].map(name => [name, vi.fn()]));
  preview.thumbnail = () => 'data:image/png;base64,preview';
  let allowed = true;
  const panel = new SkinShopPanel({ element, input, skins, scoring, getPalette: () => ({}), canOpen: () => allowed,
    onOpenChange: open => input.setPaused(open), onPurchase: vi.fn(), preview });
  const pointer = (target,type,id=1,x=100) => {
    const event = new Event(`pointer${type}`, { bubbles: true, cancelable: true });
    for (const [key,value] of Object.entries({pointerId:id,clientX:x,clientY:100,button:0,pointerType:'touch'})) Object.defineProperty(event,key,{value});
    if(type==='up'||type==='cancel') doc.defaultView.dispatchEvent(event);
    target.dispatchEvent(event);
  };
  const dispose = () => {panel.dispose();input.dispose();save.dispose();};
  return {panel,preview,scoring,skins,save,storage,input,surface,rotate,tap,pointer,dispose,setAllowed:value=>allowed=value};
}

describe('deliberate skin shop and fresh gesture boundary', () => {
  it('shows twenty Standard cards and selecting an unowned skin cannot purchase it', () => {
    const f = fixture();
    try {
      expect(f.panel.cards.size).toBe(27); f.panel.open(); f.panel.select('rubber');
      expect([...f.panel.cards.values()].filter(card => !card.button.hidden)).toHaveLength(20);
      expect(f.skins.isOwned('rubber')).toBe(false); expect(f.scoring.data.pointsBalance).toBe(3000);
      expect(f.panel.action.textContent).toBe('Buy for 750 Points');
      f.panel.transact(); f.panel.transact();
      expect(f.skins.selectedSkinId).toBe('rubber'); expect(f.scoring.data.pointsBalance).toBe(2250);
      expect(f.scoring.data.lifetimePoints).toBe(3000); expect(f.scoring.data.currentNoDeathScore).toBe(400);
      expect(f.panel.action.disabled).toBe(true); expect(f.panel.action.textContent).toBe('Equipped');
      expect(f.panel.onPurchase).toHaveBeenCalledOnce();
      expect(f.panel.celebration.kind).toBe('standard');
      expect(f.panel.celebration.active).toBe(true);
    } finally { f.dispose(); }
  });
  it('shows exact shortfall and blocks an unaffordable purchase', () => {
    const f = fixture(); try {
      f.panel.open(); f.panel.select('paint-burst');
      expect(f.panel.action.disabled).toBe(true); expect(f.panel.status.textContent).toBe('12,000 more Points needed');
      expect(f.panel.transact()).toBe(false); expect(f.scoring.data.pointsBalance).toBe(3000);
    } finally { f.dispose(); }
  });
  it('isolates shop pointers and requires a fresh drag after close', () => {
    const f = fixture(); try {
      f.pointer(f.panel.trigger,'down'); f.panel.open();
      expect(f.input.paused).toBe(true); expect(f.input.gesture).toBeNull();
      f.pointer(f.panel.dialog,'move',1,240); f.panel.close();
      f.pointer(f.surface,'move',1,270); f.pointer(f.surface,'up',1,270);
      expect(f.rotate).not.toHaveBeenCalled(); expect(f.tap).not.toHaveBeenCalled();
      f.pointer(f.surface,'down',2,100); f.pointer(f.surface,'move',2,150);
      expect(f.rotate).toHaveBeenCalledOnce(); expect(f.input.paused).toBe(false);
    } finally { f.dispose(); }
  });
  it('honours holding availability, stops preview when closed, and disposes once', () => {
    const f = fixture();
    f.setAllowed(false); expect(f.panel.open()).toBe(false); expect(f.preview.open).not.toHaveBeenCalled();
    f.setAllowed(true); f.panel.open(); f.panel.update(.02); expect(f.preview.update).toHaveBeenCalledOnce();
    f.panel.close(); f.panel.update(.02); expect(f.preview.update).toHaveBeenCalledOnce();
    f.dispose(); expect(f.preview.dispose).toHaveBeenCalledOnce();
  });
  it('cannot leak a debug purchase or death into the normal save', () => {
    const f = fixture(); try {
      const normal = f.save.load(); f.scoring.grantTemporaryPoints(20000); f.panel.open(); f.panel.select('paint-burst');
      f.panel.transact(); f.scoring.endRun(); f.panel.close();
      expect(f.skins.selectedSkinId).toBe('paint-burst'); expect(f.save.load()).toEqual(normal);
    } finally { f.dispose(); }
  });
  it('ignores an old queued close event after reopening', () => {
    const f = fixture(); try {
      f.panel.dialog.close = () => { f.panel.dialog.open = false; };
      f.panel.open(); f.panel.close(); f.panel.open(); f.panel.dialog.dispatchEvent(new Event('close'));
      expect(f.panel.isOpen).toBe(true); expect(f.input.paused).toBe(true);
    } finally { f.dispose(); }
  });

  it('shows lifetime progress while locked and does not expose purchase controls or run previews', () => {
    const f = fixture(); try {
      f.panel.open(); f.panel.setTier('premium');
      expect(f.panel.unlock.hidden).toBe(false); expect(f.panel.collection.hidden).toBe(true);
      expect(f.panel.tabs.premium.attributes['aria-controls']).toBe('premium-unlock');
      expect(f.panel.progress.textContent).toBe('3,000 / 100,000');
      expect(f.panel.action.disabled).toBe(true); expect(f.panel.transact()).toBe(false);
      expect(f.panel.select('auric-gold')).toBe(false);
      f.panel.update(.05); expect(f.preview.update).not.toHaveBeenCalled();
      expect(f.panel.onPurchase).not.toHaveBeenCalled();
      f.panel.setTier('standard'); expect(f.panel.collection.hidden).toBe(false);
    } finally { f.dispose(); }
  });

  it('unlocks at lifetime milestone independently of balance, then celebrates a Premium purchase once', () => {
    const f = fixture(); try {
      f.save.save({ lifetimePoints: 100000, pointsBalance: 0 });
      f.panel.open(); f.panel.setTier('premium');
      expect(f.panel.collection.hidden).toBe(false); expect(f.panel.lockLabel.hidden).toBe(true);
      expect(f.panel.tabs.premium.attributes['aria-controls']).toBe('skins-collection');
      expect(f.panel.action.disabled).toBe(true);
      expect([...f.panel.cards.values()].filter(card => !card.button.hidden)).toHaveLength(7);
      f.save.save({ pointsBalance: 100000 }); f.panel.refresh();
      expect(f.panel.transact()).toBe(true); expect(f.panel.transact()).toBe(false);
      expect(f.scoring.data.pointsBalance).toBe(0); expect(f.scoring.data.lifetimePoints).toBe(100000);
      expect(f.skins.selectedSkinId).toBe('pearl-shift'); expect(f.panel.onPurchase).toHaveBeenCalledOnce();
      expect(f.panel.celebration.kind).toBe('premium');
      expect(f.panel.celebration.duration).toBeLessThanOrEqual(1);
      // Celebration does not lock navigation or immediate re-equipping.
      f.panel.setTier('standard'); f.panel.select('classic'); expect(f.panel.transact()).toBe(true);
      expect(f.skins.selectedSkinId).toBe('classic'); expect(f.panel.onPurchase).toHaveBeenCalledOnce();
      f.panel.setTier('premium'); expect(f.panel.collection.hidden).toBe(false);
    } finally { f.dispose(); }
  });

  it('provides keyboard tab navigation and keeps tab semantics in sync', () => {
    const f = fixture(); try {
      f.panel.open();
      const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value: 'ArrowRight' });
      f.panel.tabs.standard.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true); expect(f.panel.tier).toBe('premium');
      expect(f.panel.tabs.premium.attributes['aria-selected']).toBe('true');
      expect(f.panel.tabs.premium.tabIndex).toBe(0); expect(f.panel.tabs.standard.tabIndex).toBe(-1);
      expect(f.panel.tabs.premium.focus).toHaveBeenCalledOnce();
    } finally { f.dispose(); }
  });
});
