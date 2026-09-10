import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {SphereGeometry} from 'three';
import {MindfulnessReplay,SleepLatch,demoPacket,sleepFrame} from '../lib/mindfulness-demo.ts';
import {decodeControl,ControlOrder,effectiveFrame} from '../lib/agent-protocol.ts';
import {PRESETS} from '../lib/visual-controls.ts';
const Ajv=createRequire(import.meta.resolve('eslint'))('ajv');
const validate=new Ajv().compile(JSON.parse(readFileSync(new URL('../public/agent-control.schema.json',import.meta.url),'utf8')));
test('40-second timestamped replay validates in both schemas and reaches all story stages',()=>{
 const replay=new MindfulnessReplay('demo',1800000000),latch=new SleepLatch();let events=0,prior=-1,arousal=1;const modes=new Set(),stages=new Set();
 for(let i=0;i<=160;i++){
  const r=replay.advance(i===0?0:.25);assert.equal(validate(r.raw),true,JSON.stringify(validate.errors));
  assert.equal(r.packet.frame.timestamp,1800000000+i*.25);assert.ok(r.packet.seq!>prior);prior=r.packet.seq!;
  assert.ok(r.packet.frame.state!.arousal<=arousal);arousal=r.packet.frame.state!.arousal;
  modes.add(r.packet.frame.visual.mode);stages.add(r.packet.frame.ritual.stage);
  const event=latch.accept(r.packet,r.reset);if(event){events++;assert.equal(r.elapsed,34);assert.equal(event.simulated,true);}
  if(i===160){assert.equal(r.elapsed,40);assert.equal(r.packet.frame.ritual.stage,'end');assert.equal(r.packet.frame.visual.intensity,0);}
 }
 assert.equal(events,1);assert.deepEqual([...modes],['storm','fold','ripple','serenity']);assert.deepEqual([...stages],['assess','guided_breathing','settling','fade_out','end']);
});
test('pause retains virtual time; delayed ticks cross sleep exactly once; restart creates new event',()=>{
 const replay=new MindfulnessReplay('a',1800000000),latch=new SleepLatch();
 replay.advance(12);const paused=replay.advance(0);assert.equal(paused.elapsed,12);assert.equal(paused.packet.frame.timestamp,1800000012);
 const delayed=replay.advance(26);assert.equal(delayed.elapsed,38);assert.ok(latch.accept(delayed.packet,delayed.reset));
 const end=replay.advance(20);assert.equal(end.elapsed,40);assert.equal(latch.accept(end.packet,end.reset),null);
 const restart=new MindfulnessReplay('b',1800000100);const next=restart.advance(34);assert.equal(latch.accept(next.packet,next.reset)?.id,'b:sleep');
});
test('ordinary ending is not sleep; incoming sleep dominates manual controls and stays latched',()=>{
 const latch=new SleepLatch(),order=new ControlOrder();
 const end=demoPacket(40,'x',0,1800000000);delete end.payload.events;
 const ordinary=decodeControl(JSON.stringify(end));assert.equal(latch.accept(ordinary,true),null);
 const raw=demoPacket(34,'x',1,1800000000);raw.data_source='sensor';raw.payload.events![0].simulated=false;
 const p=decodeControl(JSON.stringify(raw));assert.equal(latch.accept(p)?.simulated,false);
 const adjusted=sleepFrame(effectiveFrame(p.frame,PRESETS.storm),.5);assert.equal(adjusted.visual.mode,'serenity');assert.equal(adjusted.message,'');assert.equal(adjusted.ritual.inhale_sec,0);
 assert.equal(sleepFrame(p.frame,1).visual.intensity,0);
 raw.seq=2;raw.payload.events![0].id='another-id';assert.equal(latch.accept(decodeControl(JSON.stringify(raw))),null);
 assert.equal(order.accept(p).accepted,true);assert.equal(order.accept(p).accepted,false);
});
test('event payload is strict, future events wait, and simulated sources remain labeled',()=>{
 const raw=demoPacket(34,'x',0,1800000000);raw.payload.events![0].timestamp+=1;
 const latch=new SleepLatch();assert.equal(latch.accept(decodeControl(JSON.stringify(raw)),true),null);
 raw.timestamp+=1;raw.payload.events![0].simulated=false;assert.equal(latch.accept(decodeControl(JSON.stringify(raw)))?.simulated,true);
 for(const events of [[{...raw.payload.events![0],simulated:'yes'}],[{...raw.payload.events![0],type:'other'}],Array(9).fill(raw.payload.events![0])]){
  const bad={...raw,payload:{...raw.payload,events}};assert.throws(()=>decodeControl(JSON.stringify(bad)));assert.equal(validate(bad),false);
 }
});
test('surface mesh is quadrupled without degenerate polar triangles',()=>{
 const old=new SphereGeometry(1,128,96),next=new SphereGeometry(1,256,192);
 assert.equal(next.index!.count/3,97792);assert.ok(next.index!.count/old.index!.count>=4);old.dispose();next.dispose();
});
