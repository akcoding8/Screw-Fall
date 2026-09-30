import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config.js';
import { FrameClock } from '../src/game/FrameClock.js';
import { FrameDiagnostics } from '../src/game/FrameDiagnostics.js';
import { RenderTimeline } from '../src/game/RenderTimeline.js';
import { CameraRig } from '../src/game/CameraRig.js';

const baseline = JSON.parse(readFileSync(new URL('../tests/fixtures/phase21-baseline.json', import.meta.url)));
const schedules = { hz60:[1/60], hz90:[1/90], hz120:[1/120], alternating8_9:[.008,.009],
  occasionalLong:[.008,.009,.008,.009,.025,.008,.009,.016], mixed60_120:[1/120,1/120,1/60,1/120,1/60] };
const results = {};
let failures = 0;
for (const [name, schedule] of Object.entries(schedules)) {
  const camera = new THREE.PerspectiveCamera(40,1,.1,140), rig = new CameraRig(camera);
  rig.resize(390,844,{top:47,bottom:34}); rig.update(-20,0,true);
  const sim = {ball:{y:-20+.275,velocity:-18.4},anchorY:-20,animationTime:0,stateElapsed:0};
  const timeline = new RenderTimeline(), clock = new FrameClock(), diagnostics = new FrameDiagnostics();
  timeline.capture(sim,rig.simulationAnchorY,true);
  const point = new THREE.Vector3(); let minimum=Infinity,maximum=-Infinity,maxJump=0,previous=null;
  const step = dt => {
    timeline.beforeStep(); sim.ball.y-=18.4*dt; sim.anchorY=sim.ball.y-.275; sim.animationTime+=dt;
    rig.step(sim.anchorY,dt); timeline.capture(sim,rig.simulationAnchorY);
  };
  for(let frame=0;frame<900;frame++) {
    const dt=schedule[frame%schedule.length]; clock.advance(dt,step);
    const display=timeline.sample(clock.alpha); rig.render(display.anchor,clock.delta);
    point.set(0,display.y-.275,2.05).project(camera);
    const pixel=(1-point.y)*844/2;
    if(frame>=120) {minimum=Math.min(minimum,pixel);maximum=Math.max(maximum,pixel);if(previous!==null)maxJump=Math.max(maxJump,Math.abs(pixel-previous));}
    previous=pixel; diagnostics.record(dt,clock.substeps,clock.discarded);
  }
  diagnostics.refresh();
  const before=baseline.controlledTerminalScheduleObservations[name];
  results[name]={frameCount:900,estimatedRafHz:diagnostics.estimatedHz,p50Ms:diagnostics.p50,p95Ms:diagnostics.p95,p99Ms:diagnostics.p99,
    zeroFrames:diagnostics.zeroFrames,multiFrames:diagnostics.multiFrames,longFrames:diagnostics.longFrames,rollingSubsteps:[...diagnostics.substepDistribution],
    beforeMaximumScreenJumpPixels:before.maximumTerminalContactFrameJump*763,afterMaximumScreenJumpPixels:maxJump,
    beforeScreenRangePixels:before.terminalContactScreenRange*763,afterScreenRangePixels:maximum-minimum};
  if(maximum-minimum>1e-8) failures++;
}
const report={description:'Deterministic synthetic terminal fall at 18.4 world units/s, 390×844 viewport, safe insets 47/34. Measures ball contact relative to camera after 120 warmup frames. This is a timing/projection regression, not a physical device benchmark.',baseline:'tests/fixtures/phase21-baseline.json',fixedStep:CONFIG.physics.fixedStep,maxSubsteps:CONFIG.physics.maxSubsteps,maxFrameDelta:CONFIG.physics.maxFrameDelta,failures,results};
const outputIndex=process.argv.indexOf('--output');
const output=resolve(outputIndex>=0?process.argv[outputIndex+1]:'artifacts/phase22-motion-analysis.json');
mkdirSync(dirname(output),{recursive:true}); writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(failures) process.exitCode=1;
