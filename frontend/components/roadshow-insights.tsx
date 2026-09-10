'use client';
import {useId} from 'react';
import {Heart,Wind,Sparkles} from 'lucide-react';
import {PERSONAL_REFERENCE,ROADSHOW_DECISIONS,roadshowDecisionAt,roadshowSignals} from '@/lib/roadshow-demo';
import type {ControlFrame} from '@/lib/agent-protocol';

export type SignalSample={at:number;heart_rate:number;resp_rate:number};
function SignalChart({kind,rows,t,reference}:{kind:'heart_rate'|'resp_rate';rows:SignalSample[];t:number;reference:boolean}){
 const id=useId().replaceAll(':',''),heart=kind==='heart_rate',color=heart?'#f2bb99':'#94d5ed';
 const range=heart?[65,100]:[8,26],low=range[0],high=range[1];
 const bounds=reference?PERSONAL_REFERENCE[kind]:null;
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
   {reference&&ROADSHOW_DECISIONS.filter(d=>d.at>0&&d.at<60&&d.at<=t).map(d=><g key={d.at}><line x1={x(d.at)} x2={x(d.at)} y1="14" y2="104" stroke="#d3bca755" strokeDasharray="2 5"/><circle cx={x(d.at)} cy="14" r="2" fill="#e6c7a8"/></g>)}
   {rows.length>1&&<polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>}
   {last&&<circle cx={x(last.at)} cy={y(last[kind])} r="3" fill={color}/>}</g>
   {[0,20,40,60].map(s=><text key={s} x={36+s/60*294} y="124" textAnchor="middle">{reference?`${s}s`:s===0?'较早':s===60?'现在':''}</text>)}
  </svg></div>;
}
export function RoadshowInsights({elapsed,source,frame,history,stale,started}:{elapsed:number;source:string;frame:ControlFrame;history:SignalSample[];stale:boolean;started:boolean}){
 const demo=source==='demo',manual=source==='manual',decision=roadshowDecisionAt(elapsed);
 const rows:SignalSample[]=demo?Array.from({length:Math.floor(elapsed*2)+1},(_,i)=>({at:i/2,...roadshowSignals(i/2)})):history;
 const currentTime=demo?elapsed:rows.at(-1)?.at??0;
 return <><div className="panel-title"><h2>身体的变化</h2><span className="signal-legend">{demo?'淡色带 · 个人参考':stale?'等待数据':'连续记录'}</span></div>
  <SignalChart kind="heart_rate" rows={rows} t={currentTime} reference={demo}/><SignalChart kind="resp_rate" rows={rows} t={currentTime} reference={demo}/>
  <section className="decision-window" aria-label="智能体决策窗口"><div className="decision-heading"><span><Sparkles size={17}/> 智能体决策</span><span>{demo?`${String(Math.floor(decision.at)).padStart(2,'0')}s`:manual?'手动探索':stale?'等待连接':'后端引导'}</span></div>
   <div className="decision-content" aria-live="polite" aria-atomic="true"><h3>{demo?started?decision.title:'看见变化，再作安排':manual?'正在探索主体的变化':stale?'等待有效控制消息':'正在执行后端引导'}</h3>
   <p className="decision-evidence">{demo?started?decision.evidence:'开始后，数据曲线、判断依据和引导安排会一起展开。':manual?'此时由你调节动画，播放案例可返回完整的决策过程。':stale?'收到有效消息后继续更新。':'当前接口提供了引导文字；完整决策依据尚未接入此窗口。'}</p>
   {!manual&&(started||!demo)&&<div className="decision-action"><span>接下来</span><p>{demo?decision.action:frame.message}</p></div>}</div>
   {demo&&started&&<><div className="path-caption">今晚的短路径</div><ol className="decision-path">{decision.path.map((step,i)=><li className={i===decision.active?'active':i<decision.active?'done':''} key={step}><span>{i+1}</span>{step}</li>)}</ol>
   <div className="decision-history" aria-label="已发生的决策">{ROADSHOW_DECISIONS.filter(d=>d.at<=elapsed).map(d=><span className={d.at===decision.at?'active':''} key={d.at}>{d.at}s · {d.at===0?'观察':d.at===8?'安排':d.at===22?'换方式':d.at===38?'保持':d.at===50?'缩短':'完成'}</span>)}</div></>}
  </section></>;
}
