'use client';
import {useId} from 'react';
import {Heart,Wind,Sparkles} from 'lucide-react';
import {ACTION_LABELS,reasonLabel,SELF_REPORTS,type ExplainabilitySnapshot,type SignalSample,type SignalReference} from '@/lib/explainability';
export type {SignalSample} from '@/lib/explainability';

function SignalChart({kind,rows,t,reference,markers,updating}:{kind:'heart_rate'|'resp_rate';rows:SignalSample[];t:number;reference:SignalReference|null;markers:number[];updating:boolean}){
 const id=useId().replaceAll(':',''),heart=kind==='heart_rate',color=heart?'#f2bb99':'#94d5ed';
 const range=heart?[65,100]:[8,26],low=range[0],high=range[1];
 const bounds=reference?.[kind]??null;
 const top=Math.max(high,...rows.map(r=>r[kind])),bottom=Math.min(low,...rows.map(r=>r[kind]));
 const y=(v:number)=>100-(v-bottom)/(top-bottom)*80;
 const window=reference?60:Math.max(60,t-(rows[0]?.at??t)),start=reference?0:Math.max(0,t-window);
 const x=(v:number)=>36+(v-start)/window*294;
 const points=rows.map(r=>`${x(r.at)},${y(r[kind])}`).join(' '),last=rows.at(-1);
 return <div className="signal-chart"><div className="signal-chart-title"><span>{heart?<Heart size={18}/>:<Wind size={18}/>} {heart?'心率':'呼吸频率'}</span></div><div className="clear-reading">{last?(heart?Math.round(last[kind]):last[kind].toFixed(1)):'—'} <small>次/分</small></div>
  <svg viewBox="0 0 344 130" role="img" aria-label={`${heart?'心率':'呼吸频率'}随时间变化${reference?'，淡色区域为个人参考范围':''}`}>
   <defs><clipPath id={id}><rect x="35" y="8" width="300" height="104"/></clipPath></defs>
   {[bottom,(top+bottom)/2,top].map(v=><g key={v}><line x1="36" x2="330" y1={y(v)} y2={y(v)} stroke="#ffffff12"/><text x="28" y={y(v)+4} textAnchor="end">{Math.round(v)}</text></g>)}
   <g clipPath={`url(#${id})`}>{bounds&&<rect x="36" y={y(bounds[1])} width="294" height={y(bounds[0])-y(bounds[1])} fill={color} opacity=".10"/>}
   {reference&&markers.filter(at=>at>0&&at<60&&at<=t).map(at=><g key={at}><line x1={x(at)} x2={x(at)} y1="14" y2="104" stroke="#d3bca755" strokeDasharray="2 5"/><circle cx={x(at)} cy="14" r="2" fill="#e6c7a8"/></g>)}
   {rows.length>1&&<polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>}
   {last&&<><circle key={last.at} className={updating?'signal-update':''} cx={x(last.at)} cy={y(last[kind])} r="8" fill={color} opacity=".18"/><circle cx={x(last.at)} cy={y(last[kind])} r="3" fill={color}/></>}</g>
   {[0,20,40,60].map(s=><text key={s} x={36+s/60*294} y="124" textAnchor="middle">{reference?`${s}s`:s===0?'较早':s===60?'现在':''}</text>)}
  </svg></div>;
}
const pct=(v:number|undefined)=>v===undefined?'暂无':`${Math.round(v*100)}%`;
export function BaselineOverview({snapshot}:{snapshot:ExplainabilitySnapshot|null}){
 const b=snapshot?.baseline,s=snapshot?.current_state;
 return <section className="baseline-overview" aria-label="近期与今晚对比"><div className="history-heading"><h3>你的近期睡前状态</h3><small>{b?.history.length?`最近 ${b.history.length} 次`:'暂无历史'}</small></div>
 <table><thead><tr><th>状态指标</th><th>近期参考</th><th>今晚</th></tr></thead><tbody><tr><th>唤醒 Arousal</th><td>{pct(b?.arousal)}</td><td>{pct(s?.arousal)}</td></tr><tr><th>稳定 Stability</th><td>{pct(b?.stability)}</td><td>{pct(s?.stability)}</td></tr></tbody></table>
 {b&&<svg className="recent-history" viewBox="0 0 280 65" role="img" aria-label="近期睡前状态趋势，桃色为唤醒，蓝色为稳定"><polyline points={b.history.map((r,i)=>`${10+i/Math.max(1,b.history.length-1)*260},${58-r.arousal*50}`).join(' ')} stroke="#f2bb99" fill="none" strokeWidth="2"/><polyline points={b.history.map((r,i)=>`${10+i/Math.max(1,b.history.length-1)*260},${58-r.stability*50}`).join(' ')} stroke="#94d5ed" fill="none" strokeWidth="2"/></svg>}
 <div className="history-legend"><span>● 唤醒</span><span>● 稳定</span></div>
 {s?.reason_codes.includes('baseline_pending')&&<p>今晚读数仍在建立参考；当前唤醒来自自述先验，稳定度暂不可解读。</p>}
 </section>;
}
export function TonightPlan({snapshot}:{snapshot:ExplainabilitySnapshot|null}){
 const p=snapshot?.tonight_plan;
 return <section className="tonight-plan" aria-label="今晚的短路径"><h3>今晚的短路径</h3><ol className="plan-row"><li>{p?.initial_decision?ACTION_LABELS[p.initial_decision.action]:'等待本次参考'}</li><li>观察响应</li><li>调整与结束</li></ol><p>{p?.conditional_note??'后续安排暂无，等待有效决策。'}</p></section>;
}
const displayReason=(value:string)=>reasonLabel(value).replace(/^案例[：:]\s*/, '');
const trendNames={up:'上升',down:'回落',flat:'平稳'};
export function RoadshowInsights({snapshot,rows,reference,stale,message,updating=false}:{snapshot:ExplainabilitySnapshot|null;rows:SignalSample[];reference:SignalReference|null;stale:boolean;message?:string;updating?:boolean}){
 const d=snapshot?.decision_trace,s=snapshot?.current_state,demo=snapshot?.provenance.explanation_source==='demo_fixture';
 const t=reference?snapshot?.session_second??0:rows.at(-1)?.at??0;
 const markers=snapshot?.decision_history.map(item=>item.at)??[];
 const comparison=s&&snapshot&&!s.reason_codes.includes('baseline_pending')?'今晚唤醒'+(s.arousal>snapshot.baseline.arousal?'高于':s.arousal<snapshot.baseline.arousal?'低于':'接近')+'近期参考，稳定度'+(s.stability<snapshot.baseline.stability?'偏低':s.stability>snapshot.baseline.stability?'更高':'接近近期水平')+'。':'';
 return <div className="roadshow-insights-panel" data-explanation-source={snapshot?.provenance.explanation_source} data-decision-source={snapshot?.provenance.decision_source??undefined}>
 <div className="compact-title"><h2>此刻的身体信号</h2><span>{stale?'等待数据':d?.decision.stage==='end'?'记录结束':updating?'连续变化':'当前记录'}</span></div>
 <div className="paired-signals"><SignalChart kind="heart_rate" rows={rows} t={t} reference={reference} markers={markers} updating={updating&&!stale}/><SignalChart kind="resp_rate" rows={rows} t={t} reference={reference} markers={markers} updating={updating&&!stale}/></div>
 <section className="ai-panel" aria-label="智能体决策窗口"><div className="ai-title"><Sparkles size={20}/><h2>AI 状态理解与决策</h2><time>{snapshot?.session_second==null?'—':Math.floor(snapshot.session_second/60).toString().padStart(2,'0')+':'+(snapshot.session_second%60).toString().padStart(2,'0')}</time></div>
 <BaselineOverview snapshot={snapshot}/>
 <div className="report-tag"><span>今晚自述 <strong>{snapshot?SELF_REPORTS[snapshot.self_report]:'暂无'}</strong></span><span>趋势 · {s?trendNames[s.trend]:'暂无'}</span></div>
 <div className="assessment" aria-live="polite"><h3>结合近期与此刻的判断</h3><p>{comparison}{d?displayReason(d.decision.reason):message??'解释暂无，等待有效数据。'}</p>{d&&<p>{d.decision.message}</p>}</div>
 <TonightPlan snapshot={snapshot}/>
 <section className="decision-proof"><h3>本次决策依据</h3>{d?<><div><span>观察</span><p>自述状态、近期参考与连续读数</p></div><div><span>执行</span><p>{ACTION_LABELS[d.decision.action]}{d.decision.inhale_sec>0?' · 吸气 '+d.decision.inhale_sec+' 秒、呼气 '+d.decision.exhale_sec+' 秒':''}</p></div><div><span>复评</span><p>{d.next_reassessment_sec===null?'不再增加练习':'约第 '+d.next_reassessment_sec+' 秒重新观察'}</p></div></>:<p>暂无有效决策</p>}</section>
 <section className="decision-record" aria-label="已发生的决策"><h3>决策记录</h3>{snapshot?.decision_history.length?snapshot.decision_history.map((item,index)=><div className={index===snapshot.decision_history.length-1?'active':''} key={item.at+'-'+index}><time>{String(item.at).padStart(2,'0')} 秒</time><p>{ACTION_LABELS[item.decision.action]}</p></div>):<p>暂无记录</p>}</section>
 <details className="decision-details"><summary>查看完整状态与决策字段</summary><div className="state-understanding"><h3>{s?.state_class??'暂无'}</h3><dl><div><dt>Arousal</dt><dd>{s?.arousal.toFixed(2)??'暂无'}</dd></div><div><dt>Stability</dt><dd>{s?.stability.toFixed(2)??'暂无'}</dd></div><div><dt>Trend</dt><dd>{s?.trend??'暂无'}</dd></div><div><dt>Confidence</dt><dd>{demo?'暂无':s?.confidence.toFixed(2)??'暂无'}</dd></div></dl></div><ul className="explanation-reasons">{s?.reason_codes.map(code=><li key={code}>{displayReason(code)}</li>)}</ul>{d&&<ol className="decision-trace" aria-label="Decision Trace"><li>Observation：心率 {d.observation.heart_rate.toFixed(1)}，呼吸 {d.observation.resp_rate.toFixed(1)}</li><li>Validated Decision：{d.decision.stage}</li><li>Action：{d.decision.action}</li><li>Decision Source：{d.decision_source??'—'}</li></ol>}</details>
 </section></div>;
}
