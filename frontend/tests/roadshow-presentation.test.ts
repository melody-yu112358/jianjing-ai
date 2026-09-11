import test from 'node:test';
import assert from 'node:assert/strict';
import {presentationAt,presentationAudio,PresentationClock,showDuration} from '../lib/roadshow-presentation.ts';
import {SELF_REPORTS,explainabilitySchema} from '../lib/explainability.ts';
import type {SelfReport} from '../lib/explainability.ts';
import {DemoAudio,demoAudioGain} from '../lib/demo-audio.ts';
import {DemoNarrator} from '../lib/demo-guidance.ts';

for(const report of Object.keys(SELF_REPORTS) as SelfReport[]){
 test(`${report}: fixed snapshots, explanatory trace and bounded terminal control`,()=>{
  const duration=showDuration(report);
  for(let at=0;at<=duration;at+=.25){
   const v=presentationAt(at,report);assert.deepEqual(v,presentationAt(at,report));
   assert.equal(v.snapshot.provenance.data_source,'simulated');
   assert.equal(v.snapshot.provenance.decision_source,null);assert.equal(v.snapshot.provenance.explanation_source,'demo_fixture');
   explainabilitySchema.parse(v.snapshot);
   assert.ok(v.trace.every(item=>item.at<=at));
   for(const field of ['intensity','noise','speed'] as const)assert.ok(v.frame.visual[field]>=0&&v.frame.visual[field]<=1);
  }
  const v=presentationAt(duration,report);
  assert.equal(v.frame.ritual.stage,'end');assert.equal(v.frame.visual.intensity,0);assert.equal(v.frame.visual.speed,0);assert.equal(v.frame.visual.noise,0);
  assert.equal(presentationAudio(report).cueAt(duration),null);
 });
}
test('already sleepy takes 30s, never forces guided breathing or a storm visual',()=>{
 assert.equal(showDuration('already_sleepy'),30);
 for(let t=0;t<=30;t+=.25){const v=presentationAt(t,'already_sleepy');assert.notEqual(v.frame.ritual.stage,'guided_breathing');assert.notEqual(v.frame.visual.mode,'storm');assert.equal(v.breath,null);}
 assert.equal(presentationAt(27,'already_sleepy').frame.ritual.stage,'fade_out');
});
test('guidance, explanatory action and spoken switch agree for body tension',()=>{
 const v=presentationAt(22,'body_tense');
 assert.equal(v.frame.message,presentationAudio('body_tense').cueAt(22)?.text);
 assert.equal(v.frame.message,v.snapshot.decision_trace!.decision.message);
 assert.match(v.next,/自然呼吸/);assert.equal(v.snapshot.decision_trace!.decision.action,'switch_to_natural_breathing');
});
test('scene shows distinct gentle transitions for assess, breathing, switch, settling and fade',()=>{
 assert.deepEqual([0,10,22,38,54].map(t=>presentationAt(t).frame.visual.mode),['fold','pulse','storm','ripple','serenity']);
 assert.equal(presentationAt(10).breath!.progress,0);assert.equal(presentationAt(14).breath!.progress,1);
 assert.equal(presentationAt(22).breath,null);
});
test('audio and visual share terminal fade in normal and short presentations',()=>{
 for(const report of ['mind_racing','already_sleepy'] as SelfReport[]){
  const timing=presentationAudio(report),values=[];
  for(let t=timing.fadeAt;t<=timing.duration;t+=.25)values.push([presentationAt(t,report).frame.visual.intensity,demoAudioGain(t,.2,false,timing.duration,timing.fadeAt)]);
  for(let i=1;i<values.length;i++){assert.ok(values[i][0]<=values[i-1][0]);assert.ok(values[i][1]<=values[i-1][1]);}
  assert.deepEqual(values.at(-1),[0,0]);
 }
});
test('pause/hidden-tab resume preserves elapsed time and caps delayed ticks at ending',()=>{
 const clock=new PresentationClock(60);clock.start(1000);assert.equal(clock.tick(23000),22);
 clock.pause(24000);assert.equal(clock.tick(90000),23);clock.start(100000);assert.equal(clock.tick(101000),24);
 assert.equal(clock.tick(200000),60);assert.equal(clock.running,false);
 const reset=new PresentationClock(30);assert.equal(reset.elapsed,0);assert.equal(reset.running,false);
});
test('short session actually stops media and narration on its own end',()=>{
 const media={src:'',loop:false,preload:'' as HTMLMediaElement['preload'],volume:0,currentTime:0,duration:30,paused:true,play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;},load(){}};
 const timing=presentationAudio('already_sleepy'),audio=new DemoAudio(()=>media,()=>{},timing.duration,timing.fadeAt);
 const spoken:string[]=[];let cancels=0;
 const narrator=new DemoNarrator({getVoices:()=>[{lang:'zh-CN',name:'local',localService:true} as SpeechSynthesisVoice],speak:u=>spoken.push(u.text),cancel:()=>{cancels++;},pause(){},resume(){}},text=>({text} as SpeechSynthesisUtterance),()=>{},timing.cueAt);
 audio.start(true);narrator.start(true);
 for(let t=0;t<=30;t+=.25){audio.update(t<30,t,.2,false);narrator.update(t<30,t,true);}
 assert.equal(media.paused,true);assert.equal(media.volume,0);assert.ok(cancels>0);
 assert.ok(spoken.length>0);assert.ok(spoken.every(text=>!text.includes('吸气')));
});
