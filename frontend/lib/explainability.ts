import {z} from 'zod';
import {validateEndpoint} from './agent-client.ts';
import type {DecodedControl} from './agent-protocol.ts';
export const SELF_REPORTS={mind_racing:'脑子停不下来',body_tense:'身体紧绷',tired_but_awake:'很累但还清醒',already_sleepy:'已经比较困'} as const;
export type SelfReport=keyof typeof SELF_REPORTS;
const unit=z.number().finite().min(0).max(1),positive=z.number().finite().nonnegative();
export const actionSchema=z.enum(['continue_breathing','slow_down','reduce_stimulation','switch_to_natural_breathing','switch_to_grounding','fade_out','end']);
export const ACTION_LABELS:Record<z.infer<typeof actionSchema>,string>={continue_breathing:'尝试一轮慢呼气',slow_down:'放缓并降低刺激',reduce_stimulation:'减少提示，不增加练习',switch_to_natural_breathing:'退出固定节拍，自然呼吸',switch_to_grounding:'退出固定节拍，关注周围声音',fade_out:'让提示逐渐淡去',end:'已经够了。接下来不用再看我。'};
const signals=z.object({heart_rate:z.number().finite().positive(),resp_rate:z.number().finite().positive()}).strict();
const state=z.object({arousal:unit,stability:unit,trend:z.enum(['up','down','flat']),state_class:z.enum(['activated','settling','stable','not_responding','discomfort','ready_to_disengage']),confidence:unit,reason_codes:z.array(z.string())}).strict();
const decision=z.object({stage:z.enum(['assess','guided_breathing','settling','switch_method','fade_out','end']),action:actionSchema,inhale_sec:positive,exhale_sec:positive,visual_intensity:unit,audio_intensity:unit,message:z.string(),reason:z.string()}).strict();
const source=z.enum(['rule','mock_llm','llm']).nullable();
const trace=z.object({at:positive.int(),observation:signals,state,decision,decision_source:source,next_reassessment_sec:positive.int().nullable()}).strict();
export const explainabilitySchema=z.object({
 version:z.literal('1.0'),session_id:z.string().min(1),timestamp:positive.nullable(),session_second:positive.int().nullable(),scope:z.enum(['shared_process','local_replay']),self_report:z.enum(['mind_racing','body_tense','tired_but_awake','already_sleepy']),
 provenance:z.object({data_source:z.enum(['simulated','mixed','sensor','unknown']),baseline_source:z.literal('simulated_demo_history'),decision_source:source,explanation_source:z.enum(['backend','demo_fixture'])}).strict(),
 baseline:z.object({source:z.literal('simulated_demo_history'),history:z.array(z.object({session:positive.int(),arousal:unit,stability:unit}).strict()),arousal:unit,stability:unit}).strict(),
 session_signal_baseline:signals.nullable(),current_state:state.nullable(),initial_state:state.nullable(),
 tonight_plan:z.object({source:z.enum(['controller_projection','demo_fixture']),initial_decision:decision.nullable(),reassessment_interval_sec:positive.int(),conditional_note:z.string()}).strict(),
 decision_trace:trace.nullable(),decision_history:z.array(trace),response:z.object({arousal_delta:z.number().finite(),stability_delta:z.number().finite(),reference:z.literal('session_initial_state'),observation_only:z.literal(true)}).strict().nullable()
}).strict();
export type ExplainabilitySnapshot=z.infer<typeof explainabilitySchema>;
export type DecisionTrace=NonNullable<ExplainabilitySnapshot['decision_trace']>;
export type SignalSample={at:number;heart_rate:number;resp_rate:number};
export type SignalReference={heart_rate:readonly number[];resp_rate:readonly number[]};
export function apiEndpoint(ws:string,path:string,pageProtocol='https:'){
 const u=new URL(validateEndpoint(ws,pageProtocol));
 if(!/\/ws\/(control|state)\/?$/.test(u.pathname))throw Error('解释接口需要渐静 /ws/control 或 /ws/state 地址');
 u.protocol=u.protocol==='wss:'?'https:':'http:';
 u.pathname=u.pathname.replace(/\/ws\/(control|state)\/?$/,path);u.search='';return u.href;
}
// Never join a REST explanation to another session, a stale socket or mismatched decision.
export function matchesControl(s:ExplainabilitySnapshot,p:DecodedControl|null,now=Date.now()/1000){
 if(s.provenance.explanation_source!=='backend'||s.scope!=='shared_process'||!p||p.protocol!=='2.0'||s.session_id!==p.sessionId||s.timestamp===null||!s.decision_trace)return false;
 const ended=s.decision_trace.decision.stage==='end'&&p.frame.ritual.stage==='end';
 if(now-p.frame.timestamp>5||p.frame.timestamp-now>5||s.timestamp-now>5)return false;
 if(!ended&&(now-s.timestamp>5||Math.abs(p.frame.timestamp-s.timestamp)>2))return false;
 if(p.frame.state&&s.current_state&&(['arousal','stability','trend'] as const).some(key=>p.frame.state![key]!==s.current_state![key]))return false;
 const d=s.decision_trace.decision,g=p.frame.ritual;
 return d.stage===g.stage&&d.inhale_sec===g.inhale_sec&&d.exhale_sec===g.exhale_sec&&d.message===p.frame.message;
}
export const REASONS:Record<string,string>={baseline_pending:'本次信号参考仍在建立',baseline_ready:'本次信号参考已建立',trend_window_pending:'连续趋势窗口尚未完整',heart_rate_decreasing:'心率相对本次参考下降',resp_rate_decreasing:'呼吸频率相对本次参考下降',respiration_stable:'呼吸波动较小',rolling_trend_up:'滚动趋势上升',rolling_trend_down:'滚动趋势下降',rolling_trend_flat:'滚动趋势持平',stable_duration_met:'持续稳定达到规则窗口',stable_for_two_windows:'连续两个窗口保持稳定',disengagement_criteria_met:'满足减少干预并退出的条件',no_improvement_after_intervention:'干预后变化未达到规则阈值',settling_criteria_not_met:'尚未满足趋稳条件',low_arousal_sleepy_start:'自述较困且低唤醒',user_reported_discomfort:'用户报告不适，立即停止',hold_current_stage:'保持当前阶段',response_not_clear:'身体响应尚不明确',reduce_interaction_after_improvement:'观察到趋稳，减少交互',sleepy_short_path:'已经较困，省去固定节拍练习',fade_in_progress:'正在淡出',fade_completed:'淡出已完成',session_ended:'仪式已经结束',session_time_limit:'达到本次仪式时限',state_became_less_stable:'状态变得不稳定',lower_stimulus_while_settling:'趋稳时降低刺激'};
export function reasonLabel(code:string){return code.startsWith('self_report_')?`今晚自述：${SELF_REPORTS[code.slice(12) as SelfReport]??code}`:REASONS[code]??code;}
