'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, CirclePause, CirclePlay, Heart, Maximize2, Minimize2, RotateCcw, Waves, Wind, Cable, Sparkles } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {PRESETS,ADVANCED_CONTROLS,EFFECT_CONTROLS,resolveVisual,type VisualMode} from '@/lib/visual-controls';
import {StarBackdrop} from '@/components/star-backdrop';
import {useDemoAudio} from '@/components/use-demo-audio';
import { FilamentLife } from '@/components/filament-life';
import { demoFrame, type Frame } from '@/lib/state';
import { effectiveFrame, decodeControl, type DecodedControl, type SleepEvent, type ControlFrame } from '@/lib/agent-protocol';
import { AgentClient, type ConnectionSnapshot } from '@/lib/agent-client';
const stageNames:Record<string,string>={assess:'感受此刻',guided_breathing:'跟随呼吸',settling:'慢慢安定',switch_method:'回到自然呼吸',fade_out:'让画面轻轻退去',end:'本次体验已结束'};
import {SleepLatch,sleepFrame,SLEEP_AT} from '@/lib/mindfulness-demo';
import {RoadshowReplay as MindfulnessReplay,roadshowPacket as demoPacket,ROADSHOW_DURATION as DEMO_DURATION,ROADSHOW_PHASES as DEMO_PHASES,roadshowAudioFor,roadshowDecisionAt} from '@/lib/roadshow-demo';
import {SELF_REPORTS,apiEndpoint,matchesControl,type SelfReport} from '@/lib/explainability';
import {roadshowSnapshot,roadshowView} from '@/lib/roadshow-explainability';
import {useExplainability} from '@/components/use-explainability';
import {RoadshowInsights,type SignalSample} from '@/components/roadshow-insights';
const initial=decodeControl(JSON.stringify(demoPacket(0,'preview',0,1))).frame;
const MODE_LABELS:Record<VisualMode,string>={serenity:'安定 · Stillness',ripple:'舒展 · Flow',fold:'交织 · Interweave',storm:'起伏 · Surge',pulse:'呼吸 · Breathe'};
const projects=[
 {name:'Muse',kind:'环境反馈',text:'将实时脑与身体信号转为天气声景。借鉴它让环境随状态连续变化的反馈方式。',url:'https://choosemuse.com/pages/app'},
 {name:'DEEP',kind:'呼吸与空间',text:'用呼吸控制虚拟世界的移动与节奏。借鉴身体节律与视觉运动之间直观的联系。',url:'https://www.exploredeep.com/'},
 {name:'Moonbird',kind:'实时生理反馈',text:'用触觉节奏引导呼吸，应用呈现心率、HRV 等反馈。借鉴引导节奏与实测信号分开呈现。',url:'https://play.google.com/store/apps/details?id=life.moonbird.aura'},
 {name:'Breath',kind:'开源交互参考',text:'基于 Web / SVG 的呼吸动画。可参考轻量交互；本原型的粒子渲染独立实现，不复制该项目代码。',url:'https://github.com/nfreear/breath'}
];
export default function Home(){
 const [frame,setFrame]=useState<ControlFrame>(initial),[source,setSource]=useState<'demo'|'manual'|'backend'>('demo');
 const [playing,setPlaying]=useState(false),[elapsed,setElapsed]=useState(0),[gentle,setGentle]=useState(false),[immersive,setImmersive]=useState(false);
 const [selfReport,setSelfReport]=useState<SelfReport>('mind_racing'),[overviewReady,setOverviewReady]=useState(false),[backendAddress,setBackendAddress]=useState('');
 const sound=useDemoAudio(source==='demo'&&playing,elapsed,source==='demo',roadshowAudioFor(selfReport));
 const [endpointError,setEndpointError]=useState('');
 const [endpoint,setEndpoint]=useState(''),[connection,setConnection]=useState('未连接'),[sourceName,setSourceName]=useState('来源未核验');
 const [signalHistory,setSignalHistory]=useState<SignalSample[]>([]);
 const [history,setHistory]=useState<number[]>([initial.state!.arousal]),[breath,setBreath]=useState({label:'自然呼吸',progress:0});
 const connectionRequest=useRef(0);
 const client=useRef<AgentClient|null>(null),generation=useRef(0),demoTime=useRef(0),protocol=useRef('');
 const [manualVisual,setManualVisual]=useState<Frame['visual']|null>(null);
 const [diagnostics,setDiagnostics]=useState<ConnectionSnapshot>({status:'idle',retry:0,received:0,rejected:0,lastReceivedAt:null,error:null});
 const [revision,setRevision]=useState(0);
 const replay=useRef<MindfulnessReplay|null>(null),sleepLatch=useRef(new SleepLatch());
 const [sleep,setSleep]=useState<{event:SleepEvent;received:number;sessionId?:string}|null>(null),[backendSleepProgress,setBackendSleepProgress]=useState(0);
 const [lastPacket,setLastPacket]=useState<DecodedControl|null>(null);
 const explanation=useExplainability(backendAddress,source==='backend'&&diagnostics.status==='live',lastPacket?.sessionId);
 const snapshot=source==='demo'?roadshowSnapshot(elapsed,selfReport,replay.current?.sessionId,replay.current?.epoch):source==='backend'&&diagnostics.status==='live'&&explanation.snapshot&&matchesControl(explanation.snapshot,lastPacket)?explanation.snapshot:null;
 const demoView=source==='demo'?roadshowView(elapsed,selfReport):null;
 const applyPacket=useCallback((packet:DecodedControl,reset:boolean)=>{
  protocol.current=packet.protocol;setFrame(packet.frame);setLastPacket(packet);
  setSignalHistory(h=>packet.frame.signals?[...(reset?[]:h.slice(-119)),{at:packet.frame.timestamp,...packet.frame.signals}]:[]);
  setHistory(h=>packet.frame.state?[...(reset?[]:h.slice(-119)),packet.frame.state.arousal]:[]);
  if(reset){setRevision(v=>v+1);setSleep(null);setBackendSleepProgress(0);}
  const event=sleepLatch.current.accept(packet,reset);
  if(event){setSleep({event,received:performance.now(),sessionId:packet.sessionId});setManualVisual(null);window.dispatchEvent(new CustomEvent('jianjing:sleep-detected',{detail:{...event,session_id:packet.sessionId,data_source:packet.dataSource}}));}
  if(packet.frame.ritual.stage==='end')setManualVisual(null);
  if(packet.protocol==='2.0')setSourceName(({simulated:'后端 · 模拟数据',sensor:'后端声明 · 传感器',mixed:'后端声明 · 混合数据',unknown:'后端 · 来源未核验'})[packet.dataSource]??'后端 · 来源未核验');
 },[]);
 const sleepProgress=sleep?(source==='demo'?Math.max(0,Math.min(1,(elapsed-SLEEP_AT)/(DEMO_DURATION-SLEEP_AT))):backendSleepProgress):0;
 useEffect(()=>{if(!sleep||source!=='backend')return;const update=()=>setBackendSleepProgress(Math.min(1,(performance.now()-sleep.received)/6000));update();const timer=setInterval(update,100);return()=>clearInterval(timer);},[sleep,source]);
 useEffect(()=>{setGentle(matchMedia('(prefers-reduced-motion: reduce)').matches);return()=>{connectionRequest.current++;generation.current++;client.current?.disconnect();};},[]);
 const resetDemo=useCallback((run=false)=>{
  connectionRequest.current++;setOverviewReady(run);
  if(run)sound.start(true);else sound.stop();
  generation.current++;client.current?.disconnect();client.current=null;setManualVisual(null);setConnection('未连接');setEndpointError('');
  setDiagnostics({status:'idle',retry:0,received:0,rejected:0,lastReceivedAt:null,error:null});setSource('demo');demoTime.current=0;setElapsed(0);setSleep(null);setBackendSleepProgress(0);sleepLatch.current=new SleepLatch();
  replay.current=new MindfulnessReplay(`demo-${crypto.randomUUID()}`,Date.now()/1000,selfReport);
  const first=replay.current.advance(0);applyPacket(first.packet,first.reset);setPlaying(run);
 },[applyPacket,sound.start,sound.stop,selfReport]);
 useEffect(()=>{if(source!=='demo'||!playing)return;
  if(!replay.current){replay.current=new MindfulnessReplay(`demo-${crypto.randomUUID()}`,Date.now()/1000,selfReport);const first=replay.current.advance(0);applyPacket(first.packet,first.reset);}
  let last=performance.now();const timer=setInterval(()=>{const now=performance.now(),result=replay.current!.advance((now-last)/1000);last=now;demoTime.current=result.elapsed;setElapsed(result.elapsed);applyPacket(result.packet,result.reset);if(result.elapsed>=DEMO_DURATION)setPlaying(false);},250);
  return()=>clearInterval(timer);
 },[source,playing,applyPacket,selfReport]);
 const guidanceActive=!sleep&&(source==='backend'?diagnostics.status==='live':playing);
 const active=sleep?(source==='backend'||playing):(source==='backend'&&manualVisual?playing:guidanceActive);
 const renderFrame=sleep?sleepFrame(frame,sleepProgress):effectiveFrame(frame,manualVisual);
 const controlsLocked=!!sleep||(source==='backend'&&frame.ritual.stage==='end');
 const visualSettings=resolveVisual(renderFrame.visual);
 useEffect(()=>{const {inhale_sec:ins,exhale_sec:outs}=frame.ritual;if(!guidanceActive||ins===0||outs===0||frame.ritual.stage==='end'){setBreath({label:frame.ritual.stage==='end'?'自在呼吸':guidanceActive?'自然呼吸':'随自己的节奏',progress:0});return;}if(source==='demo'){const phase=Math.max(0,elapsed-10)%(ins+outs);setBreath({label:phase<ins?'轻轻吸气':'缓缓呼气',progress:phase<ins?phase/ins:1-(phase-ins)/outs});return;}const start=performance.now(),timer=setInterval(()=>{const phase=((performance.now()-start)/1000)%(ins+outs);setBreath({label:phase<ins?'轻轻吸气':'缓缓呼气',progress:phase<ins?phase/ins:1-(phase-ins)/outs});},100);return()=>clearInterval(timer);},[guidanceActive,frame.ritual.inhale_sec,frame.ritual.exhale_sec,frame.ritual.stage,revision,source,elapsed]);
 useEffect(()=>{const doc=document as Document&{modelContext?:{registerTool:(tool:unknown,options:{signal:AbortSignal})=>Promise<void>|void}};if(!doc.modelContext)return;const abort=new AbortController();try{Promise.resolve(doc.modelContext.registerTool({name:'start_calming_demo',description:'重新开始页面中的 60 秒模拟状态可视化；会断开当前后端连接。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute:async(input:unknown)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('Expected empty object');resetDemo(true);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));return {source:'simulated',playing:true};}},{signal:abort.signal})).catch(()=>{});}catch{}return()=>abort.abort();},[resetDemo]);
 function manual(value:number){
  if(controlsLocked)return;
  const f=demoFrame(0,value/100);
  if(source==='backend'){setManualVisual(f.visual);setPlaying(true);return;}
  setSource('manual');setPlaying(true);setFrame(f);setSignalHistory([{at:f.timestamp,...f.signals}]);setHistory(h=>[...h.slice(-119),f.state.arousal]);
 }
 function tuneVisual(key:keyof Frame['visual'],value:number|string){
  if(controlsLocked)return;
  const visual={...resolveVisual(manualVisual??frame.visual),[key]:value};
  if(source==='backend'){setManualVisual(visual);setPlaying(true);}
  else {setSource('manual');setPlaying(true);setSignalHistory([]);setFrame(f=>({...demoFrame(0,f.state?.arousal??.5),visual}));}
 }
 function chooseMode(mode:VisualMode){
  if(controlsLocked)return;
  const visual={...PRESETS[mode]};
  if(source==='backend'){setManualVisual(visual);setPlaying(true);}
  else {const f=demoFrame(0,mode==='storm'?.9:mode==='serenity'?.2:.5);setSource('manual');setPlaying(true);setSignalHistory([{at:f.timestamp,...f.signals}]);setFrame({...f,visual});}
 }
 async function connect(startNew=false){
  // Validate before disposing a working connection.
  const {validateEndpoint}=await import('@/lib/agent-client');
  let address:string;try{address=validateEndpoint(endpoint,location.protocol);}catch(error){setEndpointError(error instanceof Error?error.message:'地址无效');return;}
  const request=++connectionRequest.current;
  setEndpointError('');
  if(startNew){try{const r=await fetch(apiEndpoint(address,'/api/demo',location.protocol),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:selfReport==='already_sleepy'?'already_sleepy':'calming',self_report:selfReport}),signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();}catch{if(request===connectionRequest.current)setEndpointError('无法建立所选状态的后端会话，请检查服务及 CORS');return;}}
  if(request!==connectionRequest.current)return;
  setBackendAddress(address);
  sound.stop();
  const attempt=++generation.current;client.current?.disconnect();protocol.current='';setManualVisual(null);setSource('backend');setPlaying(true);setHistory([]);setSignalHistory([]);setSourceName('后端 · 来源未核验');setSleep(null);setBackendSleepProgress(0);setLastPacket(null);sleepLatch.current=new SleepLatch();
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
 return <><StarBackdrop playing={active&&!stale} gentle={gentle} sleepProgress={sleepProgress}/><main className={immersive?'app immersive filament-app roadshow-app':'app filament-app roadshow-app'}>
  <header className="topbar"><a className="brand" href="/" aria-label="渐静首页"><Waves size={28}/><strong>渐静</strong><span>JIANJING</span></a><div className="header-note">身心之间，看见变化</div><a className="prototype" href="/roadshow">进入决赛演示 →</a><span className="prototype">{source==='demo'?'模拟案例 · 决策回放':source==='manual'?'手动探索':sourceName}</span></header>
  {source==='demo'&&!playing&&elapsed===0&&<section className="tonight-entry" aria-label="今晚状态选择"><div><h2>今晚你更接近哪种状态？</h2><p>先不用急着睡着，只看看此刻需要什么。</p></div><Select value={selfReport} onValueChange={value=>{const report=value as SelfReport;setSelfReport(report);setOverviewReady(false);replay.current=null;setLastPacket(null);setFrame(decodeControl(JSON.stringify(demoPacket(0,'preview',0,1,report))).frame);}}><SelectTrigger aria-label="今晚状态"><SelectValue/></SelectTrigger><SelectContent>{Object.entries(SELF_REPORTS).map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><button className="primary-button" onClick={()=>setOverviewReady(true)}>查看今晚总览</button>{overviewReady&&<div className="tonight-summary" role="status"><h3>{selfReport==='already_sleepy'?'今晚已经有些困意，可以少做一点。':'今晚和近期参考有些不同。'}</h3><p>近期模拟参考：唤醒 46% / 稳定 67%。今晚案例：唤醒 {Math.round((snapshot?.current_state?.arousal??0)*100)}% / 稳定 {Math.round((snapshot?.current_state?.stability??0)*100)}%。</p><p>{snapshot?.tonight_plan.conditional_note}</p><small>以下为模拟案例与预设决策。准备好后播放 60 秒体验。</small></div>}</section>}
  <div className="workspace">
   <section className="experience" aria-label="心理状态可视化">
    <div className="scene-top"><div><span className="eyebrow">YOUR INNER LANDSCAPE</span><h1>让变化，找到自己的节奏。</h1></div><button className="icon-button" onClick={()=>setImmersive(!immersive)} title={immersive?'退出沉浸':'沉浸模式'} aria-label={immersive?'退出沉浸':'沉浸模式'}>{immersive?<Minimize2 size={19}/>:<Maximize2 size={19}/>}</button></div>

    <div className={`landscape ${sleep?'sleeping':''}`}><FilamentLife sleepProgress={sleepProgress} breathProgress={guidanceActive&&frame.ritual.inhale_sec>0?breath.progress:null} frame={renderFrame} playing={active||(source==='demo'&&!replay.current&&elapsed===0)} gentle={gentle} stale={stale&&!manualVisual&&!sleep}/><div className="sleep-halo" style={{opacity:sleep?Math.sin(Math.PI*sleepProgress)*.5:0,transform:`translate(-50%,-50%) scale(${1+sleepProgress*.7})`}} aria-hidden="true"/>{sleep&&<div className="sleep-message" style={{opacity:Math.min(1,sleepProgress*3)}} role="status"><span>晚安，让此刻安静下来。</span><small>{sleep.event.simulated?'模拟入睡 · 演示事件':'已收到后端入睡事件'}</small></div>}<div className="state-caption"><span className="state-marker"/>{source==='demo'?(selfReport==='already_sleepy'?'已经有些困意，减少任务':roadshowDecisionAt(elapsed).title):label}</div><div className="scene-bottom"><span>内层回应状态 · 外层引导呼吸</span><span className="field-index">{source==='demo'&&elapsed>=60?'仪式完成':guidanceActive&&frame.ritual.inhale_sec>0?'跟随呼吸':'自然流动'}</span></div></div>
    <div className="breath-guide"><div className="breath-ring" style={{transform:`scale(${1+breath.progress*.16})`}}><Wind size={22}/></div><div><div className="breath-label">{sleep?'引导已停止':breath.label}</div><p>{sleep?'光丝轻轻靠拢，暖光缓缓退去。':stale?'信号恢复后，画面会继续响应。':frame.message}</p></div><span className="breath-timing">{sleep?'安静守候':stale?'等待 Agent':guidanceActive&&frame.ritual.inhale_sec>0?`${frame.ritual.inhale_sec}s 吸 · ${frame.ritual.exhale_sec}s 呼`:stageNames[frame.ritual.stage]}</span></div>
    <div className="transport"><button disabled={source==='demo'&&elapsed===0&&!overviewReady} className="primary-button" onClick={()=>{if(source==='backend')resetDemo(true);else if(elapsed>=DEMO_DURATION&&source==='demo')resetDemo(true);else if(source==='manual')resetDemo(true);else {if(!playing)sound.start();else sound.stop();setPlaying(!playing);}}}>{active&&source!=='backend'?<CirclePause size={19}/>:<CirclePlay size={19}/>} {source==='backend'?'切回模拟体验':source==='manual'?'播放 60 秒演示':playing?'暂停演示':elapsed>=DEMO_DURATION?'重播演示':'播放 60 秒演示'}</button><button className="icon-button" title="重置模拟体验" aria-label="重置模拟体验" onClick={()=>resetDemo()}><RotateCcw size={18}/></button><div className="timeline"><div><span>{source==='backend'?connection:source==='manual'?'手动探索':`${Math.floor(elapsed/60).toString().padStart(2,'0')}:${Math.floor(elapsed%60).toString().padStart(2,'0')}`}</span><span>{source==='demo'?'01:00 · 今晚的短路径':dataLabel}</span></div><div className="time-track"><i style={{width:`${source==='demo'?elapsed/DEMO_DURATION*100:0}%`}}/></div></div><label className="gentle"><Switch checked={gentle} onCheckedChange={setGentle} aria-label="轻柔动效"/><span>轻柔动效</span></label></div>
    <div className="demo-audio-controls" aria-label="演示声音">
     <label className="voice-toggle"><Switch checked={sound.voiceEnabled} onCheckedChange={sound.setVoiceEnabled} aria-label="中文语音引导"/><span>中文语音引导<small role="status">{!sound.voiceEnabled?'已关闭':sound.voiceStatus==='missing'?'未找到普通话音色，请使用带中文语音的 Edge 或 Chrome':sound.voiceStatus==='unavailable'?'浏览器不支持语音朗读':sound.voiceStatus==='error'?'语音播放失败，请重播或更换浏览器':sound.voiceStatus==='speaking'?'正在朗读':sound.voiceStatus==='paused'?'语音已暂停':'浏览器合成语音 · 随演示播放'}</small></span></label>
     <button type="button" aria-pressed={sound.muted} onClick={()=>sound.setMuted(!sound.muted)}>{sound.muted?'开启全部声音':'全部静音'}</button>
     <span>背景 · {sound.track}<small>{source!=='demo'?'仅在模拟演示中播放':sound.status==='error'?'声音未能播放，可重试':playing?'随演示播放 · 结尾渐弱':'点击播放演示后开始'}</small></span>
     <Slider value={[Math.round(sound.volume*100)]} min={0} max={60} step={1} onValueChange={v=>sound.setVolume(v[0]/100)} aria-label="环境音音量"/>
     {sound.status==='error'&&source==='demo'&&playing&&<button type="button" onClick={()=>sound.start()}>重试声音</button>}
    </div>

   </section>
   <aside className="insights"><RoadshowInsights snapshot={snapshot} rows={demoView?.rows??signalHistory} reference={demoView?.reference??null} stale={stale} message={source==='backend'?explanation.error||frame.message:source==='manual'?'手动探索不产生 AI 决策':undefined}/>
    <details className="manual-tools"><summary>手动探索与精细控制</summary>
    <fieldset className="explore" disabled={controlsLocked}>
     {source==='backend'&&<div className="control-owner"><strong>{manualVisual?'人工控制动画':'Agent 控制动画'}</strong><p>引导词持续由后端更新</p><button disabled={!manualVisual||connection!=='接收中'} onClick={()=>{setManualVisual(null);setPlaying(true);}}>交给 Agent</button></div>}
     {source!=='backend'&&<><div className="section-label"><h3><Sparkles size={16}/>探索状态变化</h3><span>手动模拟</span></div><p>拖动滑块，感受画面如何回应。</p><Slider className="state-slider" value={[percentage]} min={0} max={100} step={1} onValueChange={v=>manual(v[0])} aria-label="模拟唤醒程度"/><div className="slider-labels"><span>安定</span><span>活跃</span><span>起伏</span></div><div className="preset-row">{[[20,'安定'],[50,'舒展'],[90,'强烈起伏']].map(([n,s])=><button key={n} onClick={()=>manual(Number(n))} className={source==='manual'&&percentage===n?'selected':''}>{s}</button>)}</div></>}<details className="filament-details"><summary>光丝与粒子 · 精细调节</summary>     <div className="visual-mode-select"><label id="visual-mode-label">光丝运动</label><Select value={visualSettings.mode} onValueChange={mode=>tuneVisual('mode',mode)} disabled={controlsLocked}><SelectTrigger aria-labelledby="visual-mode-label"><SelectValue/></SelectTrigger><SelectContent>{(Object.keys(MODE_LABELS) as VisualMode[]).map(mode=><SelectItem key={mode} value={mode}>{MODE_LABELS[mode]}</SelectItem>)}</SelectContent></Select></div>
     <div className="visual-controls">{(['intensity','noise','speed'] as const).map(key=><label key={key}><span>{({intensity:'动画强度',noise:'流动交叠',speed:'流动速度'})[key]}<output>{(manualVisual??frame.visual)[key].toFixed(2)}</output></span><Slider min={0} max={100} step={1} value={[Math.round((manualVisual??frame.visual)[key]*100)]} onValueChange={v=>tuneVisual(key,v[0]/100)} disabled={controlsLocked} aria-label={key}/></label>)}</div>
     <div className="effects-controls"><div className="section-label"><h3>粒子与流线</h3><span>{source==='backend'&&!manualVisual?'Agent 控制':'可独立调节'}</span></div><div className="visual-controls">{EFFECT_CONTROLS.map(([key,label])=><label key={key}><span>{label}<output>{visualSettings[key].toFixed(2)}</output></span><Slider min={0} max={100} step={1} value={[Math.round(visualSettings[key]*100)]} onValueChange={v=>tuneVisual(key,v[0]/100)} disabled={controlsLocked} aria-label={label}/></label>)}</div></div>
     <details className="advanced-controls"><summary>精细控制 · 光丝与过渡</summary><div className="visual-controls">{ADVANCED_CONTROLS.map(([key,label])=><label key={key}><span>{label}<output>{visualSettings[key].toFixed(2)}</output></span><Slider min={0} max={100} step={1} value={[Math.round(visualSettings[key]*100)]} onValueChange={v=>tuneVisual(key,v[0]/100)} disabled={controlsLocked} aria-label={label}/></label>)}<label><span>色相<output>{Math.round(visualSettings.hue)}°</output></span><Slider min={0} max={360} step={1} value={[visualSettings.hue]} onValueChange={v=>tuneVisual('hue',v[0])} aria-label="色相"/></label><label><span>过渡时间<output>{visualSettings.transition_sec.toFixed(1)} 秒</output></span><Slider min={.1} max={15} step={.1} value={[visualSettings.transition_sec]} onValueChange={v=>tuneVisual('transition_sec',v[0])} aria-label="过渡时间"/></label></div></details>
</details></fieldset></details>

   </aside>
  </div>
  <section className="understory"><details className="replay-details"><summary><span>60 秒 · 看见一次安排的改变</span><span className="detail-hint">案例说明与时间线</span></summary>    <div className="demo-story"><div className="demo-story-title"><span>观察 → 尝试 → 调整 → 结束</span><small>预设个人参考与连续记录</small></div><div className="demo-phases">{DEMO_PHASES.map((p,i)=><div key={p.at} className={source==='demo'&&elapsed>=p.at&&(i===DEMO_PHASES.length-1||elapsed<DEMO_PHASES[i+1].at)?'current':''}><span>{String(p.at).padStart(2,'0')}s</span><strong>{p.label}</strong></div>)}</div><p>本案例预置个人参考范围（心率 72–80 次/分，呼吸 12–16 次/分），数据与决策按统一时间线回放，不调用模型。22 秒改变引导方式，50 秒缩短后续安排；结束表示仪式完成。</p>{sleep&&<div className="sleep-event-log" role="status"><span>✓ {sleep.event.simulated?'模拟入睡事件':'后端入睡事件'} · {sleepProgress>=1?'收束完成':'正在收束'}</span><code>{new Date(sleep.event.timestamp*1000).toISOString()}</code><small>sleep_detected · 本会话已触发一次</small></div>}<details className="packet-inspector"><summary>查看时间戳与控制输入</summary>{lastPacket?<><p>协议 {lastPacket.protocol} · seq {lastPacket.seq??'—'} · {new Date(lastPacket.frame.timestamp*1000).toISOString()}</p><pre>{JSON.stringify({session_id:lastPacket.sessionId,timestamp:lastPacket.frame.timestamp,visual:lastPacket.frame.visual,guidance:{text:lastPacket.frame.message,...lastPacket.frame.ritual},events:lastPacket.events??[]},null,2)}</pre></>:<p>播放演示或连接 Agent 后显示输入。</p>}</details></div></details><details className="connection-details"><summary><span><Cable size={18}/>连接后端 Agent</span><span className="detail-hint">{connection}</span></summary><div className="connection-body"><p>所选状态：{SELF_REPORTS[selfReport]}。开始新后端会话会重置共享演示进程；所有观众将同步切换。</p><label htmlFor="ws-url">WebSocket 地址</label><div className="connection-form"><input id="ws-url" value={endpoint} onChange={e=>setEndpoint(e.target.value)} placeholder="wss://你的后端域名/ws/control" type="url"/><button onClick={()=>connect()}>查看现有后端会话</button><button onClick={()=>connect(true)}>以今晚状态开始后端会话</button>{source==='backend'&&<button onClick={()=>{connectionRequest.current++;generation.current++;client.current?.disconnect();setConnection('未连接');setDiagnostics(d=>({...d,status:'idle'}));}}>断开</button>}</div><p role="status">{endpointError?endpointError+'。':''}{connection}。支持 Agent v2.0 控制消息和渐静 v1.0；线上页面使用 wss，后端需允许本页面来源。仅接入可信演示服务。</p><p>控制权：{source==='backend'?(manualVisual?'人工动画 / Agent 引导':'Agent 动画与引导'):'本地模拟'} · 有效消息 {diagnostics.received} · 拒绝消息 {diagnostics.rejected}{diagnostics.error?' · '+diagnostics.error:''}</p><div className="parameter-grid">{Object.entries(visualSettings).map(([k,v])=><div key={k}><span>{({intensity:'动画强度',noise:'基础扰动',speed:'流动速度',mode:'模式',deformation:'光丝起伏',frequency:'流动疏密',turbulence:'交叠程度',particle_density:'粒子密度',particle_spread:'粒子扩散',particle_speed:'粒子流速',particle_size:'粒子大小',particle_brightness:'粒子亮度',line_speed:'流线速度',line_brightness:'流线亮度',line_density:'线条密度',line_activity:'线条活跃',glow:'内部微光',pulse:'呼吸脉动',hue:'色相',transition_sec:'过渡秒数'} as Record<string,string>)[k]}</span><code>{typeof v==='number'?v.toFixed(2):v}</code></div>)}</div></div></details>
   <details className="research-details"><summary><span>设计依据与参考项目</span><span className="detail-hint">4 个项目 · 查看调研</span></summary><div className="research-body"><p>主体由三维光丝与少量粒子构成，雾蓝与桃金的光沿曲线流动。起伏时光丝交叠更明显，安定时形成缓慢、连贯的节律；内层光丝响应状态，外层按引导节拍开合；仪式结束时逐渐淡去。人工调节与 Agent 共用同一组动画参数，呼吸引导与状态反馈分别处理。</p><div className="research-grid">{projects.map(p=><a key={p.name} href={p.url} target="_blank" rel="noreferrer"><span>{p.kind}</span><h3>{p.name}<ArrowUpRight size={17}/></h3><p>{p.text}</p></a>)}</div><p>这些项目支持交互设计取舍，不能证明本原型具有相同效果。React + Three.js 独立实现；视觉阈值、60 秒模拟轨迹和平滑时间均为设计参数。现有后端的原型指数不能判定具体情绪。</p></div></details>
  </section><footer><span>渐静 JIANJING</span><span>让每一次变化，都有被感知的空间。</span><span>生理反馈可视化 · MVP</span></footer>
 </main></>;
}
