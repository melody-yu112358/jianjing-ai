'use client';
import {useId} from 'react';
import {Heart,Wind,Sparkles} from 'lucide-react';
import {ACTION_LABELS,reasonLabel,SELF_REPORTS,type ExplainabilitySnapshot,type SignalSample,type SignalReference} from '@/lib/explainability';
export type {SignalSample} from '@/lib/explainability';

function SignalChart({kind,rows,t,reference,markers}:{kind:'heart_rate'|'resp_rate';rows:SignalSample[];t:number;reference:SignalReference|null;markers:number[]}){
 const id=useId().replaceAll(':',''),heart=kind==='heart_rate',color=heart?'#f2bb99':'#94d5ed';
 const range=heart?[65,100]:[8,26],low=range[0],high=range[1];
 const bounds=reference?.[kind]??null;
 const top=Math.max(high,...rows.map(r=>r[kind])),bottom=Math.min(low,...rows.map(r=>r[kind]));
 const y=(v:number)=>100-(v-bottom)/(top-bottom)*80;
 const window=reference?60:Math.max(60,t-rows[0]?.at||60),start=reference?0:Math.max(0,t-window);
 const x=(v:number)=>36+(v-start)/window*294;
 const points=rows.map(r=>`${x(r.at)},${y(r[kind])}`).join(' '),last=rows.at(-1);
 return <div className="signal-chart"><div className="signal-chart-title"><span>{heart?<Heart size={16}/>:<Wind size={16}/>} {heart?'心率':'呼吸频率'}</span><span>{last?(heart?Math.round(last[kind]):last[kind].toFixed(1)):'—'} <small>次/分</small></span></div>
  <svg viewBox="0 0 344 130" role="img" aria-label={`${heart?'心率':'呼吸频率'}随时间变化${reference?'，淡色区域为个人参考范围':''}`}>
   <defs><clipPath id={id}><rect x="35" y="8" width="300" height="104"/></clipPath></defs>
   {[bottom,(top+bottom)/2,top].map(v=><g key={v}><line x1="36" x2="330" y1={y(v)} y2={y(v)} stroke="#ffffff12"/><text x="28" y={y(v)+4} textAnchor="end">{Math.round(v)}</text></g>)}
   <g clipPath={`url(#${id})`}>{bounds&&<rect x="36" y={y(bounds[1])} width="294" height={y(bounds[0])-y(bounds[1])} fill={color} opacity=".10"/>}
   {reference&&markers.filter(at=>at>0&&at<60&&at<=t).map(at=><g key={at}><line x1={x(at)} x2={x(at)} y1="14" y2="104" stroke="#d3bca755" strokeDasharray="2 5"/><circle cx={x(at)} cy="14" r="2" fill="#e6c7a8"/></g>)}
   {rows.length>1&&<polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>}
   {last&&<circle cx={x(last.at)} cy={y(last[kind])} r="3" fill={color}/>}</g>
   {[0,20,40,60].map(s=><text key={s} x={36+s/60*294} y="124" textAnchor="middle">{reference?`${s}s`:s===0?'较早':s===60?'现在':''}</text>)}
  </svg></div>;
}
const pct=(v:number|undefined)=>v===undefined?'暂无':`${Math.round(v*100)}%`;
export function BaselineOverview({snapshot}:{snapshot:ExplainabilitySnapshot|null}){
 const b=snapshot?.baseline,s=snapshot?.current_state;
 return <section className="baseline-overview" aria-label="近期与今晚对比"><h3>你的近期睡前状态</h3><small>最近 7 次 · 模拟历史参考，不是真实用户记录</small>
 <table><thead><tr><th>状态指标</th><th>近期参考</th><th>今晚</th></tr></thead><tbody><tr><th>唤醒 Arousal</th><td>{pct(b?.arousal)}</td><td>{pct(s?.arousal)}</td></tr><tr><th>稳定 Stability</th><td>{pct(b?.stability)}</td><td>{pct(s?.stability)}</td></tr></tbody></table>
 {b&&<svg viewBox="0 0 280 65" role="img" aria-label="最近七次模拟睡前状态趋势，桃色为唤醒，蓝色为稳定"><polyline points={b.history.map((r,i)=>`${10+i*43},${58-r.arousal*50}`).join(' ')} stroke="#f2bb99" fill="none" strokeWidth="2"/><polyline points={b.history.map((r,i)=>`${10+i*43},${58-r.stability*50}`).join(' ')} stroke="#94d5ed" fill="none" strokeWidth="2"/></svg>}
 <small>桃色：唤醒 · 蓝色：稳定。原型交互指数。</small>
 {s?.reason_codes.includes('baseline_pending')&&<p>今晚读数仍在建立参考；当前唤醒来自自述先验，稳定度暂不可解读。</p>}
 </section>;
}
export function TonightPlan({snapshot}:{snapshot:ExplainabilitySnapshot|null}){
 const p=snapshot?.tonight_plan;
 return <section className="tonight-plan" aria-label="今晚的短路径"><h3>今晚的短路径</h3><ol className="decision-path"><li><span>1</span>{p?.initial_decision?ACTION_LABELS[p.initial_decision.action]:'先自然呼吸，等待后端建立本次参考'}</li><li><span>2</span>{p?`约 ${p.reassessment_interval_sec} 秒的判断窗口，重新观察响应`:'等待提供判断窗口'}</li><li><span>3</span>{p?.conditional_note??'后端尚未提供后续安排'}</li></ol></section>;
}
export function RoadshowInsights({snapshot,rows,reference,stale,message}:{snapshot:ExplainabilitySnapshot|null;rows:SignalSample[];reference:SignalReference|null;stale:boolean;message?:string}){
 const d=snapshot?.decision_trace,s=snapshot?.current_state,demo=snapshot?.provenance.explanation_source==='demo_fixture';
 const t=reference?snapshot?.session_second??0:rows.at(-1)?.at??0;
 const markers=snapshot?.decision_history.map(d=>d.at)??[];
 return <><div className="panel-title"><h2>身体的变化</h2><span className="signal-legend">{reference?'淡色带 · 演示个人参考':stale?'等待数据':'连续记录'}</span></div>
 <SignalChart kind="heart_rate" rows={rows} t={t} reference={reference} markers={markers}/><SignalChart kind="resp_rate" rows={rows} t={t} reference={reference} markers={markers}/>
 {snapshot?.session_second===0?<><BaselineOverview snapshot={snapshot}/><TonightPlan snapshot={snapshot}/></>:<details className="reference-details"><summary>近期参考与今晚短路径{snapshot?` · 唤醒 ${pct(snapshot.baseline.arousal)} → ${pct(snapshot.current_state?.arousal)}`:''}</summary><BaselineOverview snapshot={snapshot}/><TonightPlan snapshot={snapshot}/></details>}
 <section className="decision-window" aria-label="智能体决策窗口"><div className="decision-heading"><span><Sparkles size={17}/> AI 状态理解</span><span>{demo?'模拟案例 · 决策回放':snapshot?`实际来源 · ${snapshot.provenance.decision_source??'暂无'}`:'解释暂未提供'}</span></div>
 {snapshot&&<small>今晚自述：{SELF_REPORTS[snapshot.self_report]} · 信号来源：{snapshot.provenance.data_source}</small>}
 <div className="state-understanding"><h3>{s?.state_class??'暂无'}</h3><dl><div><dt>Arousal</dt><dd>{s?.arousal.toFixed(2)??'暂无'}</dd></div><div><dt>Stability</dt><dd>{s?.stability.toFixed(2)??'暂无'}</dd></div><div><dt>Trend</dt><dd>{s?.trend??'暂无'}</dd></div><div><dt>Confidence</dt><dd>{demo?'未计算（回放）':s?.confidence.toFixed(2)??'暂无'}</dd></div></dl><small>置信度表示证据覆盖与一致性，不是临床概率。</small></div>
 <details open><summary>判断依据 · reason_codes</summary><ul className="explanation-reasons">{s?s.reason_codes.map(code=><li key={code}>{reasonLabel(code)}</li>):<li>{stale?'等待有效连接与解释快照':'暂无；不会借用模拟案例解释后端状态'}</li>}</ul></details>
 <div className="decision-content" aria-live="polite"><h3>{d?ACTION_LABELS[d.decision.action]:'等待有效决策'}</h3><p className="decision-evidence">{d?reasonLabel(d.decision.reason):message??'后端解释尚未提供'}</p></div>
 {d&&<><ol className="decision-trace" aria-label="Decision Trace"><li>观察 Observation：心率 {d.observation.heart_rate.toFixed(1)}，呼吸 {d.observation.resp_rate.toFixed(1)}</li><li>状态理解：{d.state.state_class}</li><li>判断依据：{d.state.reason_codes.map(reasonLabel).join('；')}</li><li>Validated Decision：{d.decision.stage}{demo?'（预设回放）':''}</li><li>Action：{d.decision.action} · {d.decision.inhale_sec}s / {d.decision.exhale_sec}s</li><li>重新观察：{d.next_reassessment_sec===null?'不再增加练习':`本会话约 ${d.next_reassessment_sec}s 再判断`}</li></ol><p className="decision-message">{d.decision.message}</p></>}
 {snapshot?.response&&<p className="response-summary">相对本次初始：唤醒 {(snapshot.response.arousal_delta*100).toFixed(0)} 个百分点，稳定 {(snapshot.response.stability_delta*100).toFixed(0)} 个百分点。仅描述变化，不证明干预效果。</p>}
 <div className="decision-history" aria-label="已发生的决策">{snapshot?.decision_history.map((item,i)=><span key={`${item.at}-${i}`}>{item.at}s · {ACTION_LABELS[item.decision.action]}</span>)}</div>
 </section></>;
}
