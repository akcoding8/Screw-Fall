import { describe, expect, it } from 'vitest';
import { ScoreHUD } from '../src/game/ScoreHUD.js';
import { SaveManager } from '../src/game/SaveManager.js';
import { ScoringManager } from '../src/game/ScoringManager.js';
import { PerspectiveCamera, Vector3 } from 'three';

function fixture() {
  const nodes = new Map();
  const element = { querySelector: id => { if (!nodes.has(id)) nodes.set(id,{textContent:'',hidden:false,style:{}}); return nodes.get(id); } };
  const save = new SaveManager(null, { lifecycle:false });
  const scoring = new ScoringManager({ save }); const hud = new ScoreHUD(element,scoring);
  const camera = new PerspectiveCamera(40,1,.1,100); camera.position.z=10; camera.updateMatrixWorld();
  const position = new Vector3();
  return {hud,scoring,save,nodes,update:dt=>hud.update(dt,position,camera,390,844)};
}
describe('bounded score presentation', () => {
  it('merges fast award feedback while retaining one fixed DOM set', () => {
    const f=fixture(); f.hud.setState('ACTIVE'); const size=f.nodes.size;
    f.hud.onEvent({type:'pointsAwarded',awardedPoints:10}); f.update(.12);
    f.hud.onEvent({type:'pointsAwarded',awardedPoints:20}); expect(f.nodes.get('#score-award').textContent).toBe('+30');
    f.update(.15); f.hud.onEvent({type:'pointsAwarded',awardedPoints:30}); expect(f.nodes.get('#score-award').textContent).toBe('+30');
    for(let i=0;i<100;i++) f.hud.onEvent({type:'pointsAwarded',awardedPoints:1});
    expect(f.nodes.size).toBe(size); f.save.dispose();
  });
  it('keeps final death score distinct from the zero current score', () => {
    const f=fixture(); f.save.save({currentNoDeathScore:450,bestNoDeathScore:450,currentRunIsRecord:true});
    f.scoring.endRun(); f.hud.setState('DEAD_WAITING');
    expect(f.nodes.get('#death-score-value').textContent).toBe('450'); expect(f.nodes.get('#score-current').textContent).toBe('0');
    expect(f.nodes.get('#death-record').hidden).toBe(false); f.save.dispose();
  });
  it('clears old award and record notices across a level boundary', () => {
    const f=fixture(); f.hud.setState('ACTIVE'); f.hud.onEvent({type:'pointsAwarded',awardedPoints:12,newBest:true}); f.update(.01);
    expect(f.nodes.get('#score-record').hidden).toBe(false);
    f.hud.setState('HOLDING'); f.hud.setState('ACTIVE'); f.update(.01);
    expect(f.nodes.get('#score-record').hidden).toBe(true); expect(f.nodes.get('#score-feedback').hidden).toBe(true); f.save.dispose();
  });
  it('uses bounded merge windows throughout a rapid Flow descent', () => {
    const f=fixture(); f.hud.setState('ACTIVE');
    f.hud.onEvent({type:'pointsAwarded',awardedPoints:1}); f.update(.12);
    f.hud.onEvent({type:'pointsAwarded',awardedPoints:2}); expect(f.hud.mergedAward).toBe(3); f.update(.12);
    f.hud.onEvent({type:'pointsAwarded',awardedPoints:3}); expect(f.hud.mergedAward).toBe(3);
    f.save.dispose();
  });
});
