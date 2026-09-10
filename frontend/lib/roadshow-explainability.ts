/** Authored local case only. Never import this adapter into the backend client. */
import {roadshowPacket,roadshowSignals,roadshowDecisionAt,PERSONAL_REFERENCE} from './roadshow-demo.ts';
import {explainabilitySchema,type ExplainabilitySnapshot,type DecisionTrace,type SelfReport} from './explainability.ts';
export const DEMO_HISTORY=[[.49,.63],[.43,.71],[.48,.65],[.45,.68],[.47,.66],[.44,.70],[.46,.66]] as const;
function traceAt(t:number,report:SelfReport):DecisionTrace{
 const p=roadshowPacket(t,'fixture',0,1,report).payload,s=p.state!,g=p.guidance;
 const action=g.stage==='end'?'end':g.stage==='fade_out'?'fade_out':g.stage==='guided_breathing'?'continue_breathing':g.stage==='switch_method'?(report==='body_tense'?'switch_to_natural_breathing':'switch_to_grounding'):t<22&&report!=='already_sleepy'?'switch_to_natural_breathing':'reduce_stimulation';
 const reason=report==='already_sleepy'?(t>=54?'案例：减少刺激并结束仪式':'案例：已经较困，省去固定节拍练习'):roadshowDecisionAt(t).evidence;
 const state={...s,state_class:(report==='already_sleepy'?'settling':t>=50?'ready_to_disengage':t>=38?'settling':t>=22?'not_responding':'activated') as DecisionTrace['state']['state_class'],confidence:0,reason_codes:[`self_report_${report}`,reason]};
 return {at:Math.floor(t),observation:p.signals!,state,decision:{stage:g.stage,action,inhale_sec:g.inhale_sec,exhale_sec:g.exhale_sec,visual_intensity:p.visual.intensity,audio_intensity:p.visual.intensity,message:g.text,reason},decision_source:null,next_reassessment_sec:t<22?22:t<38?38:t<50?50:t<54?54:null};
}
export function roadshowSnapshot(t:number,report:SelfReport='mind_racing',sessionId='demo-preview',epoch=1):ExplainabilitySnapshot{
 t=Math.max(0,Math.min(60,t));
 const trace=traceAt(t,report),initial=traceAt(0,report).state;
 return explainabilitySchema.parse({version:'1.0',session_id:sessionId,timestamp:epoch+t,session_second:Math.floor(t),scope:'local_replay',self_report:report,
 provenance:{data_source:'simulated',baseline_source:'simulated_demo_history',decision_source:null,explanation_source:'demo_fixture'},
 baseline:{source:'simulated_demo_history',history:DEMO_HISTORY.map(([arousal,stability],i)=>({session:i+1,arousal,stability})),arousal:.46,stability:.67},session_signal_baseline:null,current_state:trace.state,initial_state:initial,
 tonight_plan:{source:'demo_fixture',initial_decision:traceAt(10,report).decision,reassessment_interval_sec:22,conditional_note:report==='already_sleepy'?'不增加固定节拍练习，保持自然呼吸，减少提示后结束。':'先尝试一轮慢呼气，约 20 秒后观察；未趋稳就换方式，趋稳后减少提示并结束。'},
 decision_trace:trace,decision_history:[0,8,10,20,22,38,50,54,60].filter(at=>at<=t).map(at=>traceAt(at,report)),response:{arousal_delta:trace.state.arousal-initial.arousal,stability_delta:trace.state.stability-initial.stability,reference:'session_initial_state',observation_only:true}});
}
export function roadshowView(t:number,report:SelfReport){return {rows:Array.from({length:Math.floor(t*2)+1},(_,i)=>({at:i/2,...roadshowSignals(i/2,report)})),reference:PERSONAL_REFERENCE};}
