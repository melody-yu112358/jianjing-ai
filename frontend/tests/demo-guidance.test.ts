import test from 'node:test';
import assert from 'node:assert/strict';
import {demoPacket} from '../lib/mindfulness-demo.ts';
import {DemoNarrator,SPOKEN_GUIDES,guidanceAt} from '../lib/demo-guidance.ts';

function fixture(available=true){
 const utterances:SpeechSynthesisUtterance[]=[],states:string[]=[];
 const voice={lang:'zh-CN',localService:true} as SpeechSynthesisVoice;
 const synth={voices:available?[voice]:[],cancelled:0,paused:0,resumed:0,
  getVoices(){return this.voices;},cancel(){this.cancelled++;},pause(){this.paused++;},resume(){this.resumed++;},
  speak(u:SpeechSynthesisUtterance){utterances.push(u);}};
 const narrator=new DemoNarrator(synth,text=>({text} as SpeechSynthesisUtterance),s=>states.push(s));
 return {narrator,synth,utterances,states,voice};
}

test('whole 40s timeline speaks each cue once and stops speech at simulated sleep',()=>{
 const f=fixture();f.narrator.start(true);
 for(let t=0;t<=40;t+=.25)f.narrator.update(true,t,true);
 assert.deepEqual(f.utterances.map(u=>u.text),SPOKEN_GUIDES.map(c=>c.text));
 assert.equal(guidanceAt(34),null);assert.ok(f.synth.cancelled>0);
 assert.ok(f.utterances.every(u=>u.voice===f.voice&&u.lang==='zh-CN'));
});

test('pause/resume does not repeat the current cue; restart clears old speech',()=>{
 const f=fixture();f.narrator.start();f.narrator.update(true,8,true);
 f.narrator.update(false,9,true);assert.equal(f.synth.paused,1);
 f.narrator.update(true,9,true);assert.equal(f.utterances.length,1);assert.ok(f.synth.resumed>0);
 f.narrator.start(true);f.narrator.update(true,0,true);assert.equal(f.utterances.at(-1)?.text,SPOKEN_GUIDES[0].text);
});

test('mute, delayed frames and missing voices never queue obsolete cues',()=>{
 const f=fixture(false);f.narrator.start();f.narrator.update(true,0,true);assert.equal(f.states.at(-1),'missing');
 f.synth.voices=[f.voice];f.narrator.update(true,7,true);assert.equal(f.utterances.length,0);
 f.narrator.update(true,8,true);assert.equal(f.utterances.length,1);
 f.narrator.update(true,12,false);f.narrator.update(true,12.25,true);assert.equal(f.utterances.length,1);
 f.narrator.update(true,18,true);assert.equal(f.utterances.length,2);
});

test('cancel invalidates old speech callbacks and no sound starts without a gesture',()=>{
 const f=fixture();f.narrator.update(true,0,true);assert.equal(f.utterances.length,0);
 f.narrator.start();f.narrator.update(true,0,true);const old=f.utterances[0];
 f.narrator.cancel();const count=f.states.length;old.onerror?.call(old,{} as SpeechSynthesisErrorEvent);
 assert.equal(f.states.length,count);
});


test('two complete breath cycles finish before natural breathing and voice is slower and quieter',()=>{
 const f=fixture();f.narrator.start();f.narrator.update(true,8,true);
 assert.ok(f.utterances[0].rate<.8&&f.utterances[0].pitch<1&&f.utterances[0].volume<.6);
 assert.deepEqual(SPOKEN_GUIDES.filter(c=>c.text==='吸气。').map(c=>c.at),[8,18]);
 assert.deepEqual(SPOKEN_GUIDES.filter(c=>c.text==='呼气。').map(c=>c.at),[12,22]);
 const guided=demoPacket(27.99,'s',0,Date.now()/1000).payload.guidance;
 const natural=demoPacket(28,'s',1,Date.now()/1000).payload.guidance;
 assert.equal(guided.stage,'guided_breathing');assert.equal(guided.inhale_sec+guided.exhale_sec,10);
 assert.equal(natural.stage,'settling');assert.equal(natural.inhale_sec+natural.exhale_sec,0);
});
