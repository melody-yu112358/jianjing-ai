'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, CirclePause, CirclePlay, Heart, Maximize2, Minimize2, RotateCcw, Waves, Wind, Cable, Sparkles } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {MODE_LABELS,PRESETS,ADVANCED_CONTROLS,EFFECT_CONTROLS,resolveVisual,type VisualMode} from '@/lib/visual-controls';
import {StarBackdrop} from '@/components/star-backdrop';
import { ParticleField } from '@/components/particle-field';
import { demoFrame, type Frame } from '@/lib/state';
import { effectiveFrame, decodeControl, type DecodedControl, type SleepEvent, type ControlFrame } from '@/lib/agent-protocol';
import { AgentClient, type ConnectionSnapshot } from '@/lib/agent-client';
const stageNames:Record<string,string>={assess:'感受此刻',guided_breathing:'跟随呼吸',settling:'慢慢安定',switch_method:'回到自然呼吸',fade_out:'让画面轻轻退去',end:'本次体验已结束'};
import {MindfulnessReplay,SleepLatch,sleepFrame,demoPacket,DEMO_DURATION,SLEEP_AT,DEMO_PHASES} from '@/lib/mindfulness-demo';
const initial=decodeControl(JSON.stringify(demoPacket(0,'initial',0,1))).frame;
const projects=[
 {name:'Muse',kind:'环境反馈',text:'将实时脑与身体信号转为天气声景。借鉴它让环境随状态连续变化的反馈方式。',url:'https://choosemuse.com/pages/app'},
 {name:'DEEP',kind:'呼吸与空间',text:'用呼吸控制虚拟世界的移动与节奏。借鉴身体节律与视觉运动之间直观的联系。',url:'https://www.exploredeep.com/'},
 {name:'Moonbird',kind:'实时生理反馈',text:'用触觉节奏引导呼吸，应用呈现心率、HRV 等反馈。借鉴引导节奏与实测信号分开呈现。',url:'https://play.google.com/store/apps/details?id=life.moonbird.aura'},
 {name:'Breath',kind:'开源交互参考',text:'基于 Web / SVG 的呼吸动画。可参考轻量交互；本原型的粒子渲染独立实现，不复制该项目代码。',url:'https://github.com/nfreear/breath'}
];
export default function Home(){
 const [frame,setFrame]=useState<ControlFrame>(initial),[source,setSource]=useState<'demo'|'manual'|'backend'>('demo');
 const [playing,setPlaying]=useState(false),[elapsed,setElapsed]=useState(0),[gentle,setGentle]=useState(false),[immersive,setImmersive]=useState(false);
 const [endpointError,setEndpointError]=useState('');
 const [endpoint,setEndpoint]=useState(''),[connection,setConnection]=useState('未连接'),[sourceName,setSourceName]=useState('来源未核验');
 const [history,setHistory]=useState<number[]>([initial.state!.arousal]),[breath,setBreath]=useState({label:'自然呼吸',progress:0});
 const client=useRef<AgentClient|null>(null),generation=useRef(0),demoTime=useRef(0),protocol=useRef('');
 const [manualVisual,setManualVisual]=useState<Frame['visual']|null>(null);
 const [diagnostics,setDiagnostics]=useState<ConnectionSnapshot>({status:'idle',retry:0,received:0,rejected:0,lastReceivedAt:null,error:null});
 const [revision,setRevision]=useState(0);
 const replay=useRef<MindfulnessReplay|null>(null),sleepLatch=useRef(new SleepLatch());
 const [sleep,setSleep]=useState<{event:SleepEvent;received:number;sessionId?:string}|null>(null),[backendSleepProgress,setBackendSleepProgress]=useState(0);
 const [lastPacket,setLastPacket]=useState<DecodedControl|null>(null);
 const applyPacket=useCallback((packet:DecodedControl,reset:boolean)=>{
  protocol.current=packet.protocol;setFrame(packet.frame);setLastPacket(packet);
  setHistory(h=>packet.frame.state?[...(reset?[]:h.slice(-119)),packet.frame.state.arousal]:[]);
  if(reset){setRevision(v=>v+1);setSleep(null);setBackendSleepProgress(0);}
  const event=sleepLatch.current.accept(packet,reset);
  if(event){setSleep({event,received:performance.now(),sessionId:packet.sessionId});setManualVisual(null);window.dispatchEvent(new CustomEvent('jianjing:sleep-detected',{detail:{...event,session_id:packet.sessionId,data_source:packet.dataSource}}));}
  if(packet.frame.ritual.stage==='end')setManualVisual(null);
  if(packet.protocol==='2.0')setSourceName(({simulated:'后端 · 模拟数据',sensor:'后端声明 · 传感器',mixed:'后端声明 · 混合数据',unknown:'后端 · 来源未核验'})[packet.dataSource]??'后端 · 来源未核验');
 },[]);
 const sleepProgress=sleep?(source==='demo'?Math.max(0,Math.min(1,(elapsed-SLEEP_AT)/(DEMO_DURATION-SLEEP_AT))):backendSleepProgress):0;
 useEffect(()=>{if(!sleep||source!=='backend')return;const update=()=>setBackendSleepProgress(Math.min(1,(performance.now()-sleep.received)/6000));update();const timer=setInterval(update,100);return()=>clearInterval(timer);},[sleep,source]);
 useEffect(()=>{setGentle(matchMedia('(prefers-reduced-motion: reduce)').matches);return()=>{generation.current++;client.current?.disconnect();};},[]);
 const resetDemo=useCallback((run=false)=>{
  generation.current++;client.current?.disconnect();client.current=null;setManualVisual(null);setConnection('未连接');setEndpointError('');
  setDiagnostics({status:'idle',retry:0,received:0,rejected:0,lastReceivedAt:null,error:null});setSource('demo');demoTime.current=0;setElapsed(0);setSleep(null);setBackendSleepProgress(0);sleepLatch.current=new SleepLatch();
  replay.current=new MindfulnessReplay(`demo-${crypto.randomUUID()}`,Date.now()/1000);
  const first=replay.current.advance(0);applyPacket(first.packet,first.reset);setPlaying(run);
 },[applyPacket]);
 useEffect(()=>{if(source!=='demo'||!playing)return;
  if(!replay.current){replay.current=new MindfulnessReplay(`demo-${crypto.randomUUID()}`,Date.now()/1000);const first=replay.current.advance(0);applyPacket(first.packet,first.reset);}
  let last=performance.now();const timer=setInterval(()=>{const now=performance.now(),result=replay.current!.advance((now-last)/1000);last=now;demoTime.current=result.elapsed;setElapsed(result.elapsed);applyPacket(result.packet,result.reset);if(result.elapsed>=DEMO_DURATION)setPlaying(false);},250);
  return()=>clearInterval(timer);
 },[source,playing,applyPacket]);
 const guidanceActive=!sleep&&(source==='backend'?diagnostics.status==='live':playing);
 const active=sleep?(source==='backend'||playing):(source==='backend'&&manualVisual?playing:guidanceActive);
 const renderFrame=sleep?sleepFrame(frame,sleepProgress):effectiveFrame(frame,manualVisual);
 const controlsLocked=!!sleep||(source==='backend'&&frame.ritual.stage==='end');
 const visualSettings=resolveVisual(renderFrame.visual);
 useEffect(()=>{const {inhale_sec:ins,exhale_sec:outs}=frame.ritual;if(!guidanceActive||ins===0||outs===0||frame.ritual.stage==='end'){setBreath({label:frame.ritual.stage==='end'?'自在呼吸':guidanceActive?'自然呼吸':'随自己的节奏',progress:0});return;}const start=performance.now(),timer=setInterval(()=>{const phase=((performance.now()-start)/1000)%(ins+outs);setBreath({label:phase<ins?'轻轻吸气':'缓缓呼气',progress:phase<ins?phase/ins:1-(phase-ins)/outs});},100);return()=>clearInterval(timer);},[guidanceActive,frame.ritual.inhale_sec,frame.ritual.exhale_sec,frame.ritual.stage,revision]);
 useEffect(()=>{const doc=document as Document&{modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>Promise<void>|void}};if(!doc.modelContext)return;const abort=new AbortController();try{Promise.resolve(doc.modelContext.registerTool({name:'start_calming_demo',description:'重新开始页面中的 40 秒模拟状态可视化；会断开当前后端连接。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('Expected empty object');resetDemo(true);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));return {source:'simulated',playing:true};}},{signal:abort.signal})).catch(()=>{});}catch{}return()=>abort.abort();},[resetDemo]);
 function manual(value:number){
  if(controlsLocked)return;
  const f=demoFrame(0,value/100);
  if(source==='backend'){setManualVisual(f.visual);setPlaying(true);return;}
  setSource('manual');setPlaying(true);setFrame(f);setHistory(h=>[...h.slice(-119),f.state.arousal]);
 }
 function tuneVisual(key:keyof Frame['visual'],value:number|string){
  if(controlsLocked)return;
  const visual={...resolveVisual(manualVisual??frame.visual),[key]:value};
  if(source==='backend'){setManualVisual(visual);setPlaying(true);}
  else {setSource('manual');setPlaying(true);setFrame(f=>({...demoFrame(0,f.state?.arousal??.5),visual}));}
 }
 function chooseMode(mode:VisualMode){
  if(controlsLocked)return;
  const visual={...PRESETS[mode]};
  if(source==='backend'){setManualVisual(visual);setPlaying(true);}
  else {const f=demoFrame(0,mode==='storm'?.9:mode==='serenity'?.2:.5);setSource('manual');setPlaying(true);setFrame({...f,visual});}
 }
 async function connect(){
  // Validate before disposing a working connection.
  const {validateEndpoint}=await import('@/lib/agent-client');
  let address:string;try{address=validateEndpoint(endpoint,location.protocol);}catch(error){setEndpointError(error instanceof Error?error.message:'地址无效');return;}
  setEndpointError('');
  const attempt=++generation.current;client.current?.disconnect();protocol.current='';setManualVisual(null);setSource('backend');setPlaying(true);setHistory([]);setSourceName('后端 · 来源未核验');setSleep(null);setBackendSleepProgress(0);setLastPacket(null);sleepLatch.current=new SleepLatch();
  const c=new AgentClient({
   onState:state=>{if(attempt!==generation.current)return;setDiagnostics(state);setConnection(({idle:'未连接',connecting:'连接中…',waiting:'等待控制参数',live:'接收中',stale:'参数已过期',reconnecting:`自动重连 ${state.retry}/5`,failed:'重连失败，请检查服务'})[state.status]);},
   onFrame:(packet,reset)=>{if(attempt!==generation.current)return;applyPacket(packet,reset);}
  });
  client.current=c;c.connect(address,location.protocol);
  const metaURL=new URL(address);if(!/\/ws\/state\/?$/.test(metaURL.pathname))return;metaURL.protocol=metaURL.protocol==='wss:'?'https:':'http:';metaURL.pathname=metaURL.pathname.replace(/\/ws\/state\/?$/,'/api/demo');metaURL.search='';
  try{const r=await fetch(metaURL,{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();const meta=await r.json() as {data_source?:string};if(attempt===generation.current&&protocol.current!=='2.0')setSourceName(meta.data_source==='simulated'?'后端 · 模拟数据':'后端 · 来源未核验');}catch{}
 }
 const a=frame.state?.arousal??.5,stale=source==='backend'&&diagnostics.status!=='live';
 const label=sleep?(sleep.event.simulated?'模拟入睡':'后端报告入睡'):stale?'等待状态':frame.ritual.stage==='end'?'体验完成':!frame.state?'Agent 引导中':frame.ritual.stage==='assess'?'建立参考中':a>.65?'有些起伏':a>.38?'正在舒展':'趋于安定';
 const percentage=Math.round(a*100),dataLabel=source==='backend'?sourceName:source==='manual'?'手动模拟':'模拟数据';
 const chart=history.map((v,i)=>`${history.length===1?0:i/(history.length-1)*440},${78-v*62}`).join(' ');
 return <><StarBackdrop playing={active&&!stale} gentle={gentle} sleepProgress={sleepProgress}/><main className={immersive?'app immersive':'app'}>
  <header className="topbar"><a className="brand" href="/" aria-label="渐静首页"><Waves size={28}/><strong>渐静</strong><span>JIANJING</span></a><div className="header-note">身心之间，看见变化</div><span className="prototype">交互原型 <span>05</span></span></header>
  <div className="workspace">
   <section className="experience" aria-label="心理状态可视化">
    <div className="scene-top"><div><span className="eyebrow">YOUR INNER LANDSCAPE</span><h1>此刻的你，正在流动。</h1></div><button className="icon-button" onClick={()=>setImmersive(!immersive)} title={immersive?'退出沉浸':'沉浸模式'} aria-label={immersive?'退出沉浸':'沉浸模式'}>{immersive?<Minimize2 size={19}/>:<Maximize2 size={19}/>}</button></div>
    <div className="mode-presets" aria-label="视觉模式预设">{(Object.keys(MODE_LABELS) as VisualMode[]).map(mode=><button disabled={controlsLocked} aria-pressed={visualSettings.mode===mode} className={visualSettings.mode===mode?'selected':''} key={mode} onClick={()=>chooseMode(mode)}>{MODE_LABELS[mode].split(' · ')[0]}<small>{({serenity:'Serenity',ripple:'Ripple',fold:'Crosswave',storm:'Surge',pulse:'Breathing'})[mode]}</small></button>)}</div>
    <div className={`landscape ${sleep?'sleeping':''}`}><ParticleField sleepProgress={sleepProgress} breathProgress={guidanceActive&&frame.ritual.inhale_sec>0?breath.progress:null} frame={renderFrame} playing={active} gentle={gentle} stale={stale&&!manualVisual&&!sleep}/><div className="sleep-halo" style={{opacity:sleep?Math.sin(Math.PI*sleepProgress)*.5:0,transform:`translate(-50%,-50%) scale(${1+sleepProgress*.7})`}} aria-hidden="true"/>{sleep&&<div className="sleep-message" style={{opacity:Math.min(1,sleepProgress*3)}} role="status"><span>晚安，让此刻安静下来。</span><small>{sleep.event.simulated?'模拟入睡 · 演示事件':'已收到后端入睡事件'}</small></div>}<div className="state-caption"><span className="state-marker"/>{label}<span className="mode-indicator">{MODE_LABELS[visualSettings.mode]}</span></div><div className="scene-bottom"><span>起伏可以被看见，也可以慢慢舒展。</span><span className="field-index">{stale||!frame.state?'—':percentage.toString().padStart(2,'0')}<small> / 100 唤醒</small></span></div></div>
    <div className="breath-guide"><div className="breath-ring" style={{transform:`scale(${1+breath.progress*.16})`}}><Wind size={22}/></div><div><div className="breath-label">{sleep?'引导已停止':breath.label}</div><p>{sleep?'光点归拢，画面轻轻退去。':stale?'信号恢复后，画面会继续响应。':frame.message}</p></div><span className="breath-timing">{sleep?'安静守候':stale?'等待 Agent':guidanceActive&&frame.ritual.inhale_sec>0?`${frame.ritual.inhale_sec}s 吸 · ${frame.ritual.exhale_sec}s 呼`:stageNames[frame.ritual.stage]}</span></div>
    <div className="transport"><button className="primary-button" onClick={()=>{if(source==='backend')resetDemo(true);else if(elapsed>=DEMO_DURATION&&source==='demo')resetDemo(true);else if(source==='manual')resetDemo(true);else setPlaying(!playing);}}>{active&&source!=='backend'?<CirclePause size={19}/>:<CirclePlay size={19}/>} {source==='backend'?'切回模拟体验':source==='manual'?'播放 40 秒演示':playing?'暂停演示':elapsed>=DEMO_DURATION?'重播演示':'播放 40 秒演示'}</button><button className="icon-button" title="重置模拟体验" aria-label="重置模拟体验" onClick={()=>resetDemo()}><RotateCcw size={18}/></button><div className="timeline"><div><span>{source==='backend'?connection:source==='manual'?'手动探索':`${Math.floor(elapsed/60).toString().padStart(2,'0')}:${Math.floor(elapsed%60).toString().padStart(2,'0')}`}</span><span>{source==='demo'?'00:40 · 正念入睡演示':dataLabel}</span></div><div className="time-track"><i style={{width:`${source==='demo'?elapsed/DEMO_DURATION*100:0}%`}}/></div></div><label className="gentle"><Switch checked={gentle} onCheckedChange={setGentle} aria-label="轻柔动效"/><span>轻柔动效</span></label></div>
    <div className="demo-story"><div className="demo-story-title"><span>40 秒 · 从纷乱到晚安</span><small>模拟 Agent 数据回放</small></div><div className="demo-phases">{DEMO_PHASES.map((p,i)=><div key={p.at} className={source==='demo'&&elapsed>=p.at&&(i===DEMO_PHASES.length-1||elapsed<DEMO_PHASES[i+1].at)?'current':''}><span>{String(p.at).padStart(2,'0')}s</span><strong>{p.label}</strong></div>)}</div><p>演示将入睡过程压缩为 40 秒；第 34 秒模拟上传入睡事件，随后用 6 秒收拢光点、淡出画面。</p>{sleep&&<div className="sleep-event-log" role="status"><span>✓ {sleep.event.simulated?'模拟入睡事件':'后端入睡事件'} · {sleepProgress>=1?'收束完成':'正在收束'}</span><code>{new Date(sleep.event.timestamp*1000).toISOString()}</code><small>sleep_detected · 本会话已触发一次</small></div>}<details className="packet-inspector"><summary>查看时间戳与控制输入</summary>{lastPacket?<><p>协议 {lastPacket.protocol} · seq {lastPacket.seq??'—'} · {new Date(lastPacket.frame.timestamp*1000).toISOString()}</p><pre>{JSON.stringify({session_id:lastPacket.sessionId,timestamp:lastPacket.frame.timestamp,visual:lastPacket.frame.visual,guidance:{text:lastPacket.frame.message,...lastPacket.frame.ritual},events:lastPacket.events??[]},null,2)}</pre></>:<p>播放演示或连接 Agent 后显示输入。</p>}</details></div>
   </section>
   <aside className="insights"><div className="panel-title"><h2>身体的回声</h2><span className="data-badge">{dataLabel}</span></div><p className="panel-intro">感受变化，不必追求某个分数。</p>
    <div className="metric-pair"><div><span><Heart size={16}/>心率</span><strong>{stale||!frame.signals?'—':Math.round(frame.signals.heart_rate)}<small>次/分</small></strong></div><div><span><Wind size={16}/>呼吸频率</span><strong>{stale||!frame.signals?'—':frame.signals.resp_rate.toFixed(1)}<small>次/分</small></strong></div></div>
    <div className="trend-panel"><div className="section-label"><span>唤醒程度</span><span>{stale||!frame.state?'等待数据':frame.state.trend==='down'?<><ArrowDownRight size={15}/>正在回落</>:frame.state?.trend==='up'?<><ArrowUpRight size={15}/>有所上升</>:'保持平稳'}</span></div><div className="arousal-number">{stale||!frame.state?'—':percentage}<small>/ 100</small></div><svg className="trend-chart" viewBox="0 0 440 92" role="img" aria-label="当前会话唤醒指数趋势，0 到 100"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#9cb5e0" stopOpacity=".2"/><stop offset="1" stopColor="#9cb5e0" stopOpacity="0"/></linearGradient></defs><path d="M0 78H440 M0 47H440 M0 16H440" stroke="#253540" strokeDasharray="3 6"/>{history.length>1&&<><polygon points={`0,92 ${chart} 440,92`} fill="url(#chart-fill)"/><polyline points={chart} fill="none" stroke="#c2d4f1" strokeWidth="2"/></>}</svg><div className="chart-labels"><span>{source==='backend'?'最近 120 帧':'本次体验'}</span><span>现在</span></div></div>
    <div className="stability"><div className="section-label"><span>状态稳定度</span><strong>{stale||!frame.state?'暂无数据':frame.ritual.stage==='assess'?'建立参考中':`${Math.round((frame.state?.stability??0)*100)} / 100`}</strong></div><div className="stability-bars" aria-hidden="true">{Array.from({length:28},(_,i)=><i key={i} className={!stale&&frame.ritual.stage!=='assess'&&i<(frame.state?.stability??0)*28?'filled':''}/>)}</div></div>
    <fieldset className="explore" disabled={controlsLocked}>
     {source==='backend'&&<div className="control-owner"><strong>{manualVisual?'人工控制动画':'Agent 控制动画'}</strong><p>引导词持续由后端更新</p><button disabled={!manualVisual||connection!=='接收中'} onClick={()=>{setManualVisual(null);setPlaying(true);}}>交给 Agent</button></div>}
     <div className="visual-mode-select"><label id="visual-mode-label">水波形态</label><Select value={visualSettings.mode} onValueChange={mode=>tuneVisual('mode',mode)} disabled={controlsLocked}><SelectTrigger aria-labelledby="visual-mode-label"><SelectValue/></SelectTrigger><SelectContent>{(Object.keys(MODE_LABELS) as VisualMode[]).map(mode=><SelectItem key={mode} value={mode}>{MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select></div>
     <div className="visual-controls">{(['intensity','noise','speed'] as const).map(key=><label key={key}><span>{({intensity:'动画强度',noise:'水波交叠',speed:'流动速度'})[key]}<output>{(manualVisual??frame.visual)[key].toFixed(2)}</output></span><Slider min={0} max={100} step={1} value={[Math.round((manualVisual??frame.visual)[key]*100)]} onValueChange={v=>tuneVisual(key,v[0]/100)} disabled={controlsLocked} aria-label={key}/></label>)}</div>
     <div className="effects-controls"><div className="section-label"><h3>粒子与流线</h3><span>{source==='backend'&&!manualVisual?'Agent 控制':'可独立调节'}</span></div><div className="visual-controls">{EFFECT_CONTROLS.map(([key,label])=><label key={key}><span>{label}<output>{visualSettings[key].toFixed(2)}</output></span><Slider min={0} max={100} step={1} value={[Math.round(visualSettings[key]*100)]} onValueChange={v=>tuneVisual(key,v[0]/100)} disabled={controlsLocked} aria-label={label}/></label>)}</div></div>
     <details className="advanced-controls"><summary>精细控制 · 球面与过渡</summary><div className="visual-controls">{ADVANCED_CONTROLS.map(([key,label])=><label key={key}><span>{label}<output>{visualSettings[key].toFixed(2)}</output></span><Slider min={0} max={100} step={1} value={[Math.round(visualSettings[key]*100)]} onValueChange={v=>tuneVisual(key,v[0]/100)} disabled={controlsLocked} aria-label={label}/></label>)}<label><span>色相<output>{Math.round(visualSettings.hue)}°</output></span><Slider min={0} max={360} step={1} value={[visualSettings.hue]} onValueChange={v=>tuneVisual('hue',v[0])} aria-label="色相"/></label><label><span>过渡时间<output>{visualSettings.transition_sec.toFixed(1)} 秒</output></span><Slider min={.1} max={15} step={.1} value={[visualSettings.transition_sec]} onValueChange={v=>tuneVisual('transition_sec',v[0])} aria-label="过渡时间"/></label></div></details>
     {source!=='backend'&&<><div className="section-label"><h3><Sparkles size={16}/>探索状态变化</h3><span>手动模拟</span></div><p>拖动滑块，感受画面如何回应。</p><Slider className="state-slider" value={[percentage]} min={0} max={100} step={1} onValueChange={v=>manual(v[0])} aria-label="模拟唤醒程度"/><div className="slider-labels"><span>安定</span><span>活跃</span><span>起伏</span></div><div className="preset-row">{[[20,'安定'],[50,'舒展'],[90,'强烈起伏']].map(([n,s])=><button key={n} onClick={()=>manual(Number(n))} className={source==='manual'&&percentage===n?'selected':''}>{s}</button>)}</div></>}</fieldset>
    <p className="prototype-note"><Activity size={15}/><span>唤醒与稳定度为交互指数，不代表情绪诊断。模拟过程不代表实测改善。</span></p>
   </aside>
  </div>
  <section className="understory"><details className="connection-details"><summary><span><Cable size={18}/>连接后端 Agent</span><span className="detail-hint">{connection}</span></summary><div className="connection-body"><label htmlFor="ws-url">WebSocket 地址</label><div className="connection-form"><input id="ws-url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} placeholder="wss://你的后端域名/ws/state" type="url"/><button onClick={connect}>连接</button>{source==='backend'&&<button onClick={()=>{generation.current++;client.current?.disconnect();setConnection('未连接');setDiagnostics(d=>({...d,status:'idle'}));}}>断开</button>}</div><p role="status">{endpointError?endpointError+'。':''}{connection}。支持 Agent v2.0 控制消息和渐静 v1.0；线上页面使用 wss，后端需允许本页面来源。仅接入可信演示服务。</p><p>控制权：{source==='backend'?(manualVisual?'人工动画 / Agent 引导':'Agent 动画与引导'):'本地模拟'} · 有效消息 {diagnostics.received} · 拒绝消息 {diagnostics.rejected}{diagnostics.error?' · '+diagnostics.error:''}</p><div className="parameter-grid">{Object.entries(visualSettings).map(([k,v])=><div key={k}><span>{({intensity:'动画强度',noise:'基础扰动',speed:'流动速度',mode:'模式',deformation:'波浪高度',frequency:'波纹疏密',turbulence:'交叠程度',particle_density:'粒子密度',particle_spread:'粒子扩散',particle_speed:'粒子流速',particle_size:'粒子大小',particle_brightness:'粒子亮度',line_speed:'流线速度',line_brightness:'流线亮度',line_density:'线条密度',line_activity:'线条活跃',glow:'边缘辉光',pulse:'呼吸脉动',hue:'色相',transition_sec:'过渡秒数'} as Record<string,string>)[k]}</span><code>{typeof v==='number'?v.toFixed(2):v}</code></div>)}</div></div></details>
   <details className="research-details"><summary><span>设计依据与参考项目</span><span className="detail-hint">4 个项目 · 查看调研</span></summary><div className="research-body"><p>球体采用约 9.8 万三角面的高细分网格，以及细涟漪、随视角变化的水面反光与深浅水色构成的低饱和冰蓝、银白反光与透明中心构成的水感材质。传播的波峰、粒子和流线共用同一球面，五种模式从当前形态连续渐变，快速切换也能衔接。采用“状态映射 + 呼吸引导”的设计：强度决定波高，扰动增加水波交叠，速度决定传播节奏；参数平滑过渡。颜色辅助表达，运动本身承担主要反馈。</p><div className="research-grid">{projects.map(p=><a key={p.name} href={p.url} target="_blank" rel="noreferrer"><span>{p.kind}</span><h3>{p.name}<ArrowUpRight size={17}/></h3><p>{p.text}</p></a>)}</div><p>这些项目支持交互设计取舍，不能证明本原型具有相同效果。React + Three.js 独立实现；视觉阈值、40 秒模拟轨迹和平滑时间均为设计参数。现有后端的原型指数不能判定具体情绪。</p></div></details>
  </section><footer><span>渐静 JIANJING</span><span>让每一次变化，都有被感知的空间。</span><span>生理反馈可视化 · MVP</span></footer>
 </main></>;
}
