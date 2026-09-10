// Timing matches the demonstration's 4s inhale / 6s exhale from second 8.
export const SPOKEN_GUIDES = [
 {at:0,text:'慢慢安顿下来。'},
 {at:8,text:'吸气。'},
 {at:12,text:'呼气。'},
 {at:18,text:'吸气。'},
 {at:22,text:'呼气。'},
 {at:28,text:'自然呼吸，就好。'},
] as const;

export function guidanceAt(t:number){
 if(t<0||t>=34)return null;
 return SPOKEN_GUIDES.findLast(c=>c.at<=t)??null;
}

export type NarratorStatus='ready'|'speaking'|'paused'|'missing'|'error'|'unavailable';
type Synth = Pick<SpeechSynthesis,'speak'|'cancel'|'pause'|'resume'|'getVoices'>;

export class DemoNarrator {
 private synth:Synth;
 private make:(text:string)=>SpeechSynthesisUtterance;
 private notify:(status:NarratorStatus)=>void;
 private lastCue=-1;
 private lastTime=0;
 private revision=0;
 private current:SpeechSynthesisUtterance|null=null;
 private paused=false;
 private authorized=false;
 private cueAt:(t:number)=>{at:number;text:string}|null;
 constructor(synth:Synth,make:(text:string)=>SpeechSynthesisUtterance,notify:(status:NarratorStatus)=>void,cueAt:(t:number)=>{at:number;text:string}|null=guidanceAt){
  this.cueAt=cueAt;
  this.synth=synth;this.make=make;this.notify=notify;
 }
 start(fresh=false){if(fresh)this.reset();this.authorized=true;}
 pause(){if(this.current&&!this.paused){this.synth.pause();this.paused=true;this.notify('paused');}}
 reset(){this.cancel();this.lastCue=-1;this.lastTime=0;}
 cancel(){this.revision++;this.synth.cancel();this.current=null;this.paused=false;}
 update(running:boolean,t:number,enabled:boolean){
  if(t<this.lastTime)this.reset();this.lastTime=t;
  const cue=this.cueAt(t);
  if(!enabled||!cue){this.cancel();this.lastCue=cue?.at??-1;return;}
  if(!running){this.pause();return;}
  if(!this.authorized)return;
  if(this.paused){this.synth.resume();this.paused=false;if(this.current)this.notify('speaking');}
  if(cue.at===this.lastCue)return;
  this.cancel();
  const voices=this.synth.getVoices();
  const chinese=voices.filter(v=>/^zh([-_]|$)/i.test(v.lang));
  const voice=chinese.find(v=>/^zh[-_]CN$/i.test(v.lang)&&/Xiaoxiao.*(Natural|Neural)|(Natural|Neural).*Xiaoxiao/i.test(v.name))
    ??chinese.find(v=>/^zh[-_]CN$/i.test(v.lang)&&/Natural|Neural/i.test(v.name))
    ??chinese.find(v=>/^zh[-_]CN$/i.test(v.lang)&&v.localService)
    ??chinese.find(v=>/^zh[-_]CN$/i.test(v.lang))??chinese.find(v=>!/^zh[-_]HK$/i.test(v.lang));
  if(!voice){this.notify('missing');return;}
  // Do not queue missed instructions after a delayed frame or late voice loading.
  if(t-cue.at>1.5){this.lastCue=cue.at;return;}
  this.lastCue=cue.at;
  const u=this.make(cue.text),rev=this.revision;
  u.lang=voice.lang;u.voice=voice;u.rate=.72;u.pitch=.85;u.volume=.55;
  u.onstart=()=>{if(rev===this.revision)this.notify('speaking');};
  u.onend=()=>{if(rev===this.revision){this.current=null;this.notify('ready');}};
  u.onerror=()=>{if(rev===this.revision){this.current=null;this.notify('error');}};
  this.current=u;this.synth.resume();this.synth.speak(u);
 }
}
