import {ControlOrder,decodeControl,type AgentControl,type DecodedControl,type SleepEvent,type ControlFrame} from './agent-protocol.ts';
import {PRESETS,type ResolvedVisual} from './visual-controls.ts';
export const DEMO_DURATION=40, SLEEP_AT=34;
export const DEMO_PHASES=[{at:0,label:'心绪纷乱'},{at:8,label:'觉察呼吸'},{at:16,label:'释放紧绷'},{at:25,label:'渐入宁静'},{at:34,label:'模拟入睡'}];
const keyframes=[{at:0,v:PRESETS.storm},{at:8,v:PRESETS.fold},{at:16,v:PRESETS.ripple},{at:25,v:PRESETS.serenity},{at:34,v:{...PRESETS.serenity,intensity:.15,deformation:.04,speed:.025,particle_spread:0,line_activity:.015,pulse:.1}},{at:40,v:{...PRESETS.serenity,intensity:0,noise:0,speed:0,deformation:0,particle_density:0,line_density:0,pulse:0}}];
const guides=['慢慢安顿下来。','轻轻吸气，缓缓呼气。','轻轻吸气，缓缓呼气。','自然呼吸，就好。',''];
export function demoPacket(seconds:number,sessionId:string,seq:number,epoch:number):AgentControl {
 const t=Math.max(0,Math.min(DEMO_DURATION,seconds));
 const index=Math.max(0,keyframes.findLastIndex(k=>k.at<=t));
 const from=keyframes[index],to=keyframes[Math.min(index+1,keyframes.length-1)];
 const x=to.at===from.at?1:(t-from.at)/(to.at-from.at),blend=x*x*(3-2*x);
 const visual={...from.v,transition_sec:4.2} as ResolvedVisual;
 for(const key of Object.keys(visual) as (keyof ResolvedVisual)[])if(key!=='mode'&&key!=='transition_sec')visual[key]=from.v[key]+(to.v[key]-from.v[key])*blend;
 const phase=t>=34?4:t>=28?3:t>=16?2:t>=8?1:0,sleep=t>=SLEEP_AT,end=t>=DEMO_DURATION;
 const arousal=.94-.90*(t/DEMO_DURATION);
 return {type:'agent.control',version:'2.0',session_id:sessionId,seq,timestamp:epoch+t,data_source:'simulated',payload:{visual,guidance:{text:guides[phase],stage:end?'end':sleep?'fade_out':t>=28?'settling':t>=8?'guided_breathing':'assess',inhale_sec:t>=8&&t<28?4:0,exhale_sec:t>=8&&t<28?6:0},signals:{heart_rate:92-34*t/40,resp_rate:19-9*t/40},state:{arousal,stability:.15+.8*t/40,trend:'down'},...(sleep?{events:[{id:`${sessionId}:sleep`,type:'sleep_detected' as const,timestamp:epoch+SLEEP_AT,simulated:true}]}:{})}};
}
// Pause/resume retains elapsed time and packet order. Replay resets by constructing a new session.
export class MindfulnessReplay {
 private seq=0;private order=new ControlOrder();private elapsed=0;
 readonly sessionId:string;readonly epoch:number;
 constructor(sessionId:string,epoch:number){this.sessionId=sessionId;this.epoch=epoch;}
 advance(deltaSeconds:number){
  this.elapsed=Math.min(DEMO_DURATION,this.elapsed+Math.max(0,deltaSeconds));
  const raw=demoPacket(this.elapsed,this.sessionId,this.seq++,this.epoch);
  const packet=decodeControl(JSON.stringify(raw)),order=this.order.accept(packet);
  if(!order.accepted)throw Error('Invalid replay order');
  return {raw,packet,reset:order.reset,elapsed:this.elapsed};
 }
}
// A session has one sleep transition, including when snapshots repeat its event or change its id.
export class SleepLatch {
 private fired=false;
 accept(packet:DecodedControl,reset=false):SleepEvent|null {
  if(reset)this.fired=false;
  if(this.fired)return null;
  const event=packet.events?.find(e=>e.timestamp<=packet.frame.timestamp);
  if(!event)return null;
  this.fired=true;
  return {...event,simulated:event.simulated||packet.dataSource==='simulated'};
 }
}
export function sleepFrame(frame:ControlFrame,progress:number):ControlFrame {
 return {...frame,message:'',ritual:{stage:progress>=1?'end':'fade_out',inhale_sec:0,exhale_sec:0},visual:{...PRESETS.serenity,deformation:.04,speed:.025,pulse:0,particle_spread:0,transition_sec:1.5,...(progress>=1?{intensity:0,noise:0,speed:0}:{})}};
}
