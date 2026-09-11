/** Presentation adapter for the authored case. Never classifies live signals. */
import {roadshowPacket,roadshowDecisionAt,ROADSHOW_AUDIO,roadshowAudioFor} from './roadshow-demo.ts';
import {roadshowSnapshot,roadshowView} from './roadshow-explainability.ts';
import {decodeControl} from './agent-protocol.ts';
import type {SelfReport} from './explainability.ts';

export const STAGE_LABELS:Record<string,string>={assess:'感受此刻',guided_breathing:'尝试慢呼气',switch_method:'换一种更轻的方式',settling:'留出安静的空间',fade_out:'减少刺激，准备结束',end:'主动退出'};
export const STATE_LABELS:Record<string,string>={activated:'唤醒偏高',settling:'正在趋稳',stable:'持续稳定',not_responding:'暂未明显趋稳',discomfort:'需要停止',ready_to_disengage:'可以减少交互'};
export const TREND_LABELS={up:'暂时上升',down:'正在下降',flat:'暂时持平'};
export const showDuration=(report:SelfReport)=>report==='already_sleepy'?30:60;
const sourceTime=(seconds:number,report:SelfReport)=>Math.max(0,Math.min(60,seconds*(report==='already_sleepy'?2:1)));
const sleepyAudio={duration:30,fadeAt:27,cueAt:(seconds:number)=>{
 const cue=roadshowAudioFor('already_sleepy').cueAt(seconds*2);
 return cue?{...cue,at:cue.at/2}:null;
}};
const tenseAudio={...ROADSHOW_AUDIO,cueAt:(t:number)=>{
 const cue=ROADSHOW_AUDIO.cueAt(t);
 return cue?.at===22?{at:22,text:'不用追赶节拍，回到自然呼吸。'}:cue;
}};
export const presentationAudio=(report:SelfReport)=>report==='already_sleepy'?sleepyAudio:report==='body_tense'?tenseAudio:ROADSHOW_AUDIO;
export function presentationAt(seconds:number,report:SelfReport='mind_racing'){
 const t=sourceTime(seconds,report),sleepy=report==='already_sleepy';
 const raw=roadshowPacket(t,'roadshow-local',Math.floor(t*4),1,report);
 const stage=raw.payload.guidance.stage;
 // Artistic presentation only: never map an interaction class to a diagnostic brain region.
 const mode=stage==='guided_breathing'?'pulse':stage==='switch_method'?'ripple':stage==='assess'?(sleepy?'serenity':'fold'):stage==='settling'?'ripple':'serenity';
 raw.payload.visual={...raw.payload.visual,mode,transition_sec:stage==='fade_out'?1.2:3,
  particle_density:stage==='fade_out'?raw.payload.visual.intensity:.35,
  glow:stage==='fade_out'?raw.payload.visual.intensity:.55};
 if(stage==='end')Object.assign(raw.payload.visual,{particle_density:0,glow:0});
 if(report==='body_tense'&&stage==='switch_method')raw.payload.guidance.text='不用追赶节拍，回到自然呼吸。';
 const frame=decodeControl(JSON.stringify(raw)).frame;
 const snapshot=roadshowSnapshot(t,report);
 if(report==='body_tense'){
  for(const trace of [snapshot.decision_trace,...snapshot.decision_history]){if(trace?.decision.stage==='switch_method')trace.decision.message='不用追赶节拍，回到自然呼吸。';}
 }
 const decision=roadshowDecisionAt(t);
 const title=sleepy?(t>=60?'不必做满，已经够了':t>=50?'省去额外练习，准备结束':'今晚已经有些困意，少做一点'):decision.title;
 const observation=sleepy?'自述已有困意，模拟读数接近个人参考。':decision.evidence;
 const next=sleepy?(t>=54?'停止追加任务，让声音和画面淡去。':'省去固定节拍，保留自然呼吸。'):report==='body_tense'&&stage==='switch_method'?'取消固定节拍，回到自然呼吸。':decision.action;
 const breath=stage==='guided_breathing'?(()=>{const phase=(t-10)%(frame.ritual.inhale_sec+frame.ritual.exhale_sec);return {label:phase<4?'轻轻吸气':'缓缓呼气',progress:phase<4?phase/4:1-(phase-4)/frame.ritual.exhale_sec};})():null;
 const cues=sleepy?[0,25,27,30]:[0,8,22,38,50,54,60];
 const trace=cues.filter(at=>at<=seconds).map(at=>{
  const source=sourceTime(at,report),d=roadshowDecisionAt(source);
  return {at,title:sleepy?(at===0?'省去固定节拍':at<27?'跳过额外练习':at<30?'减少提示':'主动退出'):source===54?'声音与画面渐弱':d.title};
 });
 return {frame,snapshot,view:roadshowView(t,report),title,observation,next,breath,trace,duration:showDuration(report),
  stateLabel:stage==='end'?'本次体验已结束':STATE_LABELS[snapshot.current_state!.state_class],
  trendLabel:TREND_LABELS[frame.state!.trend],stageLabel:STAGE_LABELS[stage]};
}

/** Explicit pause includes hidden tabs, so a projection never skips a decision on return. */
export class PresentationClock{
 elapsed=0;running=false;private previous=0;
 readonly duration:number;
 constructor(duration:number){this.duration=duration;}
 start(now:number){this.previous=now;this.running=true;}
 tick(now:number){if(this.running){this.elapsed=Math.min(this.duration,this.elapsed+Math.max(0,now-this.previous)/1000);this.previous=now;if(this.elapsed>=this.duration)this.running=false;}return this.elapsed;}
 pause(now:number){this.tick(now);this.running=false;}
}
