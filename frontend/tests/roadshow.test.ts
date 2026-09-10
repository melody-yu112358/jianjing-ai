import test from 'node:test';
import assert from 'node:assert/strict';
import {RoadshowReplay,roadshowSignals,roadshowPacket,roadshowDecisionAt,roadshowBreath,roadshowGuidanceAt,ROADSHOW_CUES} from '../lib/roadshow-demo.ts';
import {DemoNarrator} from '../lib/demo-guidance.ts';
import {DemoAudio,demoAudioGain} from '../lib/demo-audio.ts';
import {buildFilaments,buildOuterFilaments} from '../lib/filament-geometry.ts';

test('60-second case is valid, has a setback, and ends without reporting sleep',()=>{
 const replay=new RoadshowReplay('case',Date.now()/1000);let previous=-1;
 for(let i=0;i<=240;i++){
  const r=replay.advance(i===0?0:.25);assert.ok(r.packet.seq!>previous);previous=r.packet.seq!;
  assert.equal(r.raw.payload.events,undefined);
  assert.equal(r.raw.payload.guidance.stage==='guided_breathing',r.elapsed>=10&&r.elapsed<20);
 }
 assert.ok(roadshowSignals(24).heart_rate>roadshowSignals(14).heart_rate);
 assert.ok(roadshowSignals(24).resp_rate>roadshowSignals(14).resp_rate);
 assert.ok(roadshowSignals(54).heart_rate<roadshowSignals(38).heart_rate);
 assert.equal(replay.advance(10).raw.payload.guidance.stage,'end');
 assert.equal(replay.advance(10).raw.payload.visual.intensity,0);
});
test('pause, large time jumps and restart keep decisions on the same timeline',()=>{
 const r=new RoadshowReplay('a',Date.now()/1000);
 const a=r.advance(21);assert.equal(r.advance(0).elapsed,a.elapsed);
 const b=r.advance(2);assert.equal(roadshowDecisionAt(b.elapsed).at,22);
 assert.equal(b.raw.payload.guidance.inhale_sec,0);
 assert.equal(roadshowBreath(23),null);assert.equal(roadshowBreath(10)?.progress,0);
 assert.equal(roadshowBreath(14)?.progress,1);assert.equal(roadshowBreath(20),null);
 assert.equal(new RoadshowReplay('b',Date.now()/1000).advance(0).reset,true);
 assert.equal(roadshowDecisionAt(49).at,38);assert.equal(roadshowDecisionAt(50).at,50);
});
test('roadshow narration cancels beat prompts at the strategy change and speaks no analysis',()=>{
 const spoken:SpeechSynthesisUtterance[]=[],voice={lang:'zh-CN',localService:true} as SpeechSynthesisVoice;
 let cancellations=0;
 const n=new DemoNarrator({getVoices:()=>[voice],speak:u=>spoken.push(u),cancel:()=>{cancellations++;},pause:()=>{},resume:()=>{}},text=>({text} as SpeechSynthesisUtterance),()=>{},roadshowGuidanceAt);
 n.start(true);for(let t=0;t<=60;t+=.25)n.update(true,t,true);
 assert.deepEqual(spoken.map(u=>u.text),ROADSHOW_CUES.map(c=>c.text));
 assert.equal(spoken.filter(u=>u.text.includes('吸气')).length,1);
 assert.ok(spoken.every(u=>u.rate<.8&&u.volume<.6));assert.ok(cancellations>0);
 assert.equal(roadshowGuidanceAt(56),null);
 assert.equal(roadshowPacket(60,'x',0,1).payload.guidance.text,'今晚的睡前仪式已完成。');
});
test('sea audio continues past the old 40s endpoint, fades at 54s, and stops at 60s',()=>{
 const media={src:'',loop:false,preload:'' as HTMLMediaElement['preload'],volume:0,currentTime:0,duration:30,paused:true,play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;},load(){}};
 const a=new DemoAudio(()=>media,()=>{},60,54);a.start(true);a.update(true,45,.08,false);
 assert.equal(media.paused,false);assert.equal(media.currentTime,15);assert.equal(media.volume,.08);
 a.update(true,57,.08,false);assert.equal(media.volume,.04);
 a.update(true,60,.08,false);assert.equal(media.paused,true);
 assert.equal(demoAudioGain(40,.08,false),0);assert.equal(demoAudioGain(40,.08,false,60,54),.08);
});
test('inner ribbons and breathing shell remain separate, finite and reproducible',()=>{
 const inner=buildFilaments(48,32),outer=buildOuterFilaments(24,32);
 assert.ok([...inner.layer].every(x=>x<1.05));assert.ok([...outer.layer].every(x=>x>1.05));
 assert.ok([...inner.position,...outer.position].every(Number.isFinite));
 assert.deepEqual(buildOuterFilaments(24,32).position,outer.position);
});
