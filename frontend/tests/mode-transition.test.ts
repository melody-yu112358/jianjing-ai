import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModeTransition} from '../lib/mode-transition.ts';
import {decodeControl} from '../lib/agent-protocol.ts';
import {demoPacket} from '../lib/mindfulness-demo.ts';
import {resolveVisual,PRESETS} from '../lib/visual-controls.ts';
test('mode change starts at displayed shape, reaches midpoint and target within its duration',()=>{
 const morph=new ModeTransition('storm');morph.setTarget('serenity',3);
 assert.deepEqual(morph.advance(0),[0,0,0,1,0]);
 const middle=morph.advance(1.5);assert.equal(middle[0],.5);assert.equal(middle[3],.5);
 // Continuous snapshots of the same requested mode must not restart the blend.
 morph.setTarget('serenity',3);assert.deepEqual(morph.advance(1.5),[1,0,0,0,0]);
});
test('rapid retargeting preserves the displayed mixture and normalized weights, including pulse',()=>{
 const morph=new ModeTransition('storm');morph.setTarget('fold',2);const before=[...morph.advance(.8)];
 morph.setTarget('pulse',3);assert.deepEqual(morph.advance(0),before);
 for(let i=0;i<180;i++){const w=morph.advance(1/60);assert.ok(w.every(v=>v>=0&&v<=1));assert.ok(Math.abs(w.reduce((a,b)=>a+b,0)-1)<1e-10);}
 const done=morph.advance(.01);assert.deepEqual(done,[0,0,0,0,1]);
});
test('Agent independently controls all effect fields; explicit zeros survive defaults and unrelated changes',()=>{
 const raw=demoPacket(12,'fx',0,1800000000);
 const fx={particle_density:.7,particle_spread:.4,particle_speed:0,particle_size:.8,particle_brightness:.6,line_density:.5,line_activity:.3,line_speed:.9,line_brightness:0};
 Object.assign(raw.payload.visual,fx);
 const visual=resolveVisual(decodeControl(JSON.stringify(raw)).frame.visual);
 for(const [k,v] of Object.entries(fx))assert.equal(visual[k as keyof typeof visual],v);
 const changed=resolveVisual({...visual,mode:'serenity',intensity:.2});
 for(const [k,v] of Object.entries(fx))assert.equal(changed[k as keyof typeof changed],v);
 assert.equal(resolveVisual({intensity:.5,noise:.1,speed:.2}).particle_size,PRESETS.ripple.particle_size);
 for(const key of ['particle_speed','particle_size','particle_brightness','line_speed','line_brightness']){
  const invalid=structuredClone(raw);Object.assign(invalid.payload.visual,{[key]:1.1});assert.throws(()=>decodeControl(JSON.stringify(invalid)));
 }
});
