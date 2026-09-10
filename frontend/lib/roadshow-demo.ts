import {ControlOrder,decodeControl,type AgentControl} from './agent-protocol.ts';
import type {SelfReport} from './explainability.ts';
import {PRESETS} from './visual-controls.ts';

export const ROADSHOW_DURATION=60;
export const ROADSHOW_PHASES=[{at:0,label:'观察变化'},{at:8,label:'安排路径'},{at:22,label:'调整方式'},{at:38,label:'保留空间'},{at:50,label:'减少引导'},{at:60,label:'仪式完成'}];
export const PERSONAL_REFERENCE={heart_rate:[72,80],resp_rate:[12,16]} as const;
export const ROADSHOW_CUES=[
 {at:0,text:'不用急着睡着。先让呼吸自然来去。'},
 {at:10,text:'轻轻吸气。'},
 {at:14,text:'缓缓呼气。'},
 {at:22,text:'不用追赶节拍。听一会儿海浪。'},
 {at:38,text:'按舒服的节奏，慢慢呼吸。'},
 {at:50,text:'已经够了。接下来不用再看我。'},
] as const;
export function roadshowGuidanceAt(t:number){return t<0||t>=56?null:ROADSHOW_CUES.findLast(c=>c.at<=t)??null;}
export const ROADSHOW_AUDIO={duration:60,fadeAt:54,cueAt:roadshowGuidanceAt};

// Authored presentation data, never used to classify live sensor measurements.
const anchors=[
 [0,87.6,20.0,.75,.34],[8,86.8,19.7,.72,.38],[14,84.9,18.2,.62,.43],
 [20,88.1,20.2,.81,.28],[24,90.0,20.5,.88,.24],[30,88.6,18.7,.76,.39],
 [38,85.1,17.1,.58,.57],[46,81.8,15.9,.40,.73],[54,79.7,15.0,.28,.84],
 [60,79.2,14.8,.26,.86],
] as const;
const smooth=(v:number)=>v*v*(3-2*v);
export function roadshowSignals(seconds:number,report:SelfReport='mind_racing'){
 const t=Math.max(0,Math.min(60,seconds));
 const i=Math.max(0,anchors.findLastIndex(a=>a[0]<=t)),a=anchors[i],b=anchors[Math.min(i+1,anchors.length-1)];
 const x=a[0]===b[0]?1:smooth((t-a[0])/(b[0]-a[0]));
 const v=[1,2,3,4].map(k=>a[k]+(b[k]-a[k])*x);
 const variation=t<30?.65:Math.max(.12,.65-(t-30)*.025);
 return {heart_rate:report==='already_sleepy'?76-t*.03:v[0]+variation*(Math.sin(t*1.4)*.5+Math.sin(t*.57)*.3),
  resp_rate:report==='already_sleepy'?14-t*.005:v[1]+variation*(Math.sin(t*.89+.6)*.3+Math.sin(t*1.71)*.1),
  arousal:report==='already_sleepy'?.32-t*.002:Math.max(0,v[2]+({mind_racing:0,body_tense:-.01,tired_but_awake:-.13}[report])),stability:report==='already_sleepy'?.72+t*.002:v[3]};
}
export const ROADSHOW_DECISIONS=[
 {at:0,title:'先观察，留出参考',evidence:'心率与呼吸高于个人平常范围，先观察一段连续变化。',action:'暂不催促呼吸，建立本次参考。',path:['自然呼吸','观察变化','再作安排'],active:0},
 {at:8,title:'生成今晚的短路径',evidence:'两项读数仍高于个人参考，近期没有明显上升。',action:'先尝试一轮慢呼气，再决定是否继续。',path:['一轮慢呼气','观察响应','按变化调整'],active:0},
 {at:22,title:'暂未趋稳，改变方式',evidence:'短暂回落后，两条曲线再次上升，波动尚未收小。',action:'取消下一轮固定节拍，转向海浪声音。',path:['慢呼气','听一会儿海浪','观察响应'],active:1},
 {at:38,title:'保持当前方式',evidence:'呼吸先放缓，心率随后回落，最近一段波动正在减小。',action:'不增加练习，减少口令，让变化继续。',path:['声音关注','减少口令','自然呼吸'],active:1},
 {at:50,title:'缩短后续安排',evidence:'两条曲线已接近个人参考范围，近期保持回落。',action:'跳过额外练习，逐渐结束引导。',path:['自然呼吸','跳过额外练习','结束仪式'],active:2},
 {at:60,title:'今晚的仪式已完成',evidence:'本段记录已结束，曲线保留供回看。',action:'停止声音与节拍，留下一点安静。',path:['自然呼吸','减少引导','仪式完成'],active:2},
] as const;
export function roadshowDecisionAt(t:number){return ROADSHOW_DECISIONS.findLast(d=>d.at<=t)??ROADSHOW_DECISIONS[0];}
export function roadshowBreath(t:number){
 if(t<10||t>=20)return null;
 const p=t-10;return {label:p<4?'轻轻吸气':'缓缓呼气',progress:p<4?p/4:1-(p-4)/6};
}
export function roadshowPacket(seconds:number,sessionId:string,seq:number,epoch:number,report:SelfReport='mind_racing'):AgentControl{
 const t=Math.max(0,Math.min(60,seconds)),s=roadshowSignals(t,report),guided=report!=='already_sleepy'&&t>=10&&t<(report==='body_tense'?19:20),end=t>=60;
 const mode=t<10?'fold':guided?'pulse':t<30?'storm':t<46?'ripple':'serenity';
 const fade=t<=54?1:1-smooth((t-54)/6);
 const visual={...PRESETS[mode],intensity:(.15+s.arousal*.66)*fade,noise:(1-s.stability)*.65*fade,
  speed:(.06+s.arousal*.55)*fade,deformation:.08+s.arousal*.2,turbulence:(1-s.stability)*.65,
  particle_density:.5,particle_brightness:.45,line_brightness:.65,glow:.65,
  pulse:guided?.6:0,transition_sec:3};
 if(end){visual.intensity=0;visual.noise=0;visual.speed=0;}
 return {type:'agent.control',version:'2.0',session_id:sessionId,seq,timestamp:epoch+t,data_source:'simulated',payload:{
  visual,signals:{heart_rate:s.heart_rate,resp_rate:s.resp_rate},
  state:{arousal:s.arousal,stability:s.stability,trend:t>=14&&t<24?'up':t===0?'flat':'down'},
  guidance:{stage:end?'end':t>=54?'fade_out':guided?'guided_breathing':t<10?'assess':t<22||report==='already_sleepy'?'settling':t<38?'switch_method':'settling',
   text:end?'今晚的睡前仪式已完成。':roadshowAudioFor(report).cueAt(t)?.text??'可以把屏幕放下了。',inhale_sec:guided?4:0,exhale_sec:guided?(report==='body_tense'?5:6):0}
 }};
}
export class RoadshowReplay{
 private seq=0;private order=new ControlOrder();private elapsed=0;
 readonly sessionId:string;readonly epoch:number;readonly report:SelfReport;
 constructor(sessionId:string,epoch:number,report:SelfReport='mind_racing'){this.sessionId=sessionId;this.epoch=epoch;this.report=report;}
 advance(delta:number){
  this.elapsed=Math.min(60,this.elapsed+Math.max(0,delta));
  const raw=roadshowPacket(this.elapsed,this.sessionId,this.seq++,this.epoch,this.report),packet=decodeControl(JSON.stringify(raw));
  const order=this.order.accept(packet);if(!order.accepted)throw Error('Invalid roadshow replay order');
  return {raw,packet,reset:order.reset,elapsed:this.elapsed};
 }
}

const SLEEPY_AUDIO={duration:60,fadeAt:54,cueAt:(t:number)=>t<0||t>=56?null:t>=50?{at:50,text:'已经够了。接下来不用再看我。'}:{at:0,text:'已经有些困了，就保持自然呼吸。不需要再完成练习。'}};
export function roadshowAudioFor(report:SelfReport){return report==='already_sleepy'?SLEEPY_AUDIO:ROADSHOW_AUDIO;}
