import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoAudio,demoAudioGain} from '../lib/demo-audio.ts';
import {MindfulnessReplay,SleepLatch} from '../lib/mindfulness-demo.ts';

class Media {
 src='';loop=false;preload:HTMLAudioElement['preload']='';volume=0;currentTime=0;duration=9.2;paused=true;plays=0;
 play(){this.paused=false;this.plays++;return Promise.resolve();}
 pause(){this.paused=true;}
 load(){this.currentTime=0;}
}

test('full 40s replay: loop, pause, resume, sleep fade and terminal silence',async()=>{
 const media=new Media(),audio=new DemoAudio(()=>media);
 const replay=new MindfulnessReplay('audio-test',Date.now()/1000),sleep=new SleepLatch();
 audio.start();await Promise.resolve();const track=audio.track;
 const events=[];
 for(let i=0;i<=160;i++){
  const r=replay.advance(i===0?0:.25),t=r.elapsed;
  const event=sleep.accept(r.packet,r.reset);if(event)events.push(t);
  audio.update(t<40,t,.25,false);
  if(t===12){audio.update(false,t,.25,false);assert.equal(media.paused,true);audio.start();await Promise.resolve();audio.update(true,t,.25,false);assert.equal(audio.track,track);}
  if(t>2&&t<34){assert.equal(media.volume,.25);assert.equal(media.paused,false);}
  if(t===37)assert.equal(media.volume,.125);
  if(t>media.duration&&t<40)assert.ok(Math.abs(media.currentTime-t%media.duration)<.8);
 }
 assert.deepEqual(events,[34]);assert.equal(media.volume,0);assert.equal(media.paused,true);
 audio.start(true);assert.equal(audio.track,track);audio.dispose();assert.equal(media.src,'');
});

test('mute and gain bounds preserve timeline; background stays fixed to sea',()=>{
 assert.equal(demoAudioGain(1,.4,false),.2);assert.equal(demoAudioGain(15,.4,true),0);
 assert.equal(demoAudioGain(40,.4,false),0);assert.equal(demoAudioGain(41,.4,false),0);
 const audio=new DemoAudio(()=>new Media());audio.start(true);assert.equal(audio.track?.id,'sea');audio.start(true);assert.equal(audio.track?.id,'sea');audio.dispose();
});

test('blocked play does not retry every frame and can be explicitly retried',async()=>{
 const media=new Media(),states:string[]=[];let reject=true;
 media.play=()=>{media.plays++;if(reject)return Promise.reject(Error('blocked'));media.paused=false;return Promise.resolve();};
 const audio=new DemoAudio(()=>media,s=>states.push(s));audio.start();await new Promise(r=>setImmediate(r));
 for(let t=0;t<10;t++)audio.update(true,t,.25,false);
 assert.equal(media.plays,1);assert.ok(states.includes('error'));
 reject=false;audio.start();await Promise.resolve();assert.equal(media.paused,false);audio.dispose();
});

test('a late rejected play cannot overwrite state after stop and replay',async()=>{
 const media=new Media(),states:string[]=[];let rejectOld:(reason:Error)=>void=()=>{};
 media.play=()=>new Promise<void>((_,reject)=>{rejectOld=reject;});
 const audio=new DemoAudio(()=>media,s=>states.push(s));audio.start();audio.stop();
 media.play=()=>{media.paused=false;return Promise.resolve();};audio.start(true);await Promise.resolve();
 rejectOld(Error('interrupted'));await new Promise(r=>setImmediate(r));
 assert.equal(states.at(-1),'playing');audio.dispose();
});
