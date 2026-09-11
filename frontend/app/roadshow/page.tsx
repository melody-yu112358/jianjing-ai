'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Waves,Play,Pause,RotateCcw,Maximize2,Volume2,VolumeX,ArrowRight} from 'lucide-react';
import {FilamentLife} from '@/components/filament-life';
import {useDemoAudio} from '@/components/use-demo-audio';
import {RoadshowInsights} from '@/components/roadshow-insights';
import {SELF_REPORTS,type SelfReport} from '@/lib/explainability';
import {presentationAt,presentationAudio,PresentationClock,showDuration} from '@/lib/roadshow-presentation';
import './roadshow.css';

export default function Roadshow(){
 const [report,setReport]=useState<SelfReport>('mind_racing');
 const [elapsed,setElapsed]=useState(0),[running,setRunning]=useState(false),[started,setStarted]=useState(false);
 const [notice,setNotice]=useState(''),[gentle,setGentle]=useState(false);
 const clock=useRef(new PresentationClock(60));
 const view=useMemo(()=>presentationAt(elapsed,report),[elapsed,report]);
 const sound=useDemoAudio(running,elapsed,true,presentationAudio(report));
 const stopSound=useRef(sound.stop);stopSound.current=sound.stop;
 const ended=elapsed>=view.duration;
 useEffect(()=>{setGentle(matchMedia('(prefers-reduced-motion: reduce)').matches);},[]);
 useEffect(()=>{
  const hide=()=>{if(document.hidden&&clock.current.running){clock.current.pause(performance.now());setElapsed(clock.current.elapsed);setRunning(false);stopSound.current();setNotice('演示已暂停，返回后可继续。');}};
  document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);
 },[]);
 useEffect(()=>{if(!running)return;const timer=setInterval(()=>{setElapsed(clock.current.tick(performance.now()));if(!clock.current.running)setRunning(false);},100);return()=>clearInterval(timer);},[running]);
 function start(){
  if(!started||ended){clock.current=new PresentationClock(showDuration(report));setElapsed(0);setStarted(true);sound.start(true);}
  else sound.start();
  clock.current.start(performance.now());setRunning(true);setNotice('');
 }
 function pause(){clock.current.pause(performance.now());setElapsed(clock.current.elapsed);setRunning(false);sound.stop();}
 function reset(){sound.stop();clock.current=new PresentationClock(showDuration(report));setElapsed(0);setRunning(false);setStarted(false);setNotice('');}
 function select(value:SelfReport){if(started)return;setReport(value);clock.current=new PresentationClock(showDuration(value));setElapsed(0);}
 async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{setNotice('当前浏览器不支持全屏，可使用浏览器全屏快捷键。');}}
 const voiceProblem=sound.voiceEnabled&&['missing','unavailable','error'].includes(sound.voiceStatus);
 return <main className={`show-page ${ended?'show-ended':''}`}>
  <header className="show-header"><a href="/" className="show-brand"><Waves size={26}/><strong>渐静</strong><span>JIANJING</span></a><span className="show-proof">模拟信号 · 预设决策回放</span><button className="show-icon" onClick={fullscreen} aria-label="切换全屏投影"><Maximize2 size={20}/></button></header>
  <section className="show-entry" aria-label="今晚状态选择">
   <div><span className="show-kicker">熄灯前，少做一点</span><h1>{started?'让身体的变化，改变下一步。':'今晚，你更接近哪种状态？'}</h1></div>
   <div className="show-reports" role="group" aria-label="选择今晚状态">{Object.entries(SELF_REPORTS).map(([key,label])=><button key={key} aria-pressed={report===key} disabled={started} onClick={()=>select(key as SelfReport)}>{label}</button>)}</div>
  </section>
  <div className="show-workspace">
   <section className="show-experience" aria-label="60秒动态体验">
    <div className="show-scene-label"><span>{view.stageLabel}</span><span>{report==='already_sleepy'?'30 秒 · 省去固定节拍':'60 秒 · 按变化调整'}</span></div>
    <div className="show-scene" data-stage={view.frame.ritual.stage}>
     <FilamentLife frame={view.frame} playing={running} gentle={gentle} stale={false} breathProgress={running?view.breath?.progress??null:null}/>
     {ended&&<div className="show-goodnight" role="status"><span>已经够了。</span><h2>今晚不用再看我了。</h2><p>不再追加练习，声音与画面已退出。</p></div>}
     <div className="show-layer-label" aria-hidden="true">内层回应状态 <span>·</span> 外层引导呼吸</div>
    </div>
    <div className="show-guidance" aria-live="off"><span>{ended?'仪式结束':!started?'先不用努力睡着':view.breath?.label??'自然呼吸'}</span><p>{ended?'你可以把屏幕放下了。':!started?'准备好后，一键开始今晚的短路径。':view.frame.message}</p></div>
    <div className="show-controls">
     <button className="show-start" onClick={running?pause:start}>{running?<Pause size={18}/>:<Play size={18}/>} {running?'暂停':ended?'再演示一次':started?'继续体验':`一键开始 · ${view.duration} 秒`}</button>
     <button className="show-icon" onClick={reset} aria-label="重新选择状态"><RotateCcw size={20}/></button>
     <div className="show-progress"><span>{Math.floor(elapsed).toString().padStart(2,'0')} / {view.duration} 秒</span><progress max={view.duration} value={elapsed} aria-label="路演进度"/></div>
     <button className="show-icon" aria-label={sound.muted?'开启声音':'静音'} aria-pressed={sound.muted} onClick={()=>sound.setMuted(!sound.muted)}>{sound.muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button>
    </div>
    {(notice||sound.status==='error'||voiceProblem)&&<p className="show-notice" role="status">{notice||'声音暂不可用，文字与演示继续。可静音完成本次体验。'}</p>}
   </section>
   <aside className="show-understanding" aria-label="AI状态理解">
    <div className="show-kicker">{!started?'今晚状态总览':'AI 状态理解'}</div>
    <h2>{view.title}</h2>
    <div className="show-state-line"><span>{view.stateLabel}</span><span>趋势 · {view.trendLabel}</span></div>
    <dl className="show-reasoning" aria-live="polite">
     <div><dt>观察</dt><dd>{view.observation}</dd></div>
     <div><dt>下一步</dt><dd>{view.next}</dd></div>
    </dl>
    <section className="show-baseline" aria-label="与个人参考比较"><h3>{started?'状态正在怎样变化':'与个人参考比较'}</h3>
     <div className="show-reading"><span>心率</span><strong>{Math.round(view.frame.signals!.heart_rate)}<small>次/分</small></strong><span>演示参考 72–80</span></div>
     <div className="show-reading"><span>呼吸</span><strong>{view.frame.signals!.resp_rate.toFixed(1)}<small>次/分</small></strong><span>演示参考 12–16</span></div>
     {started&&<p className="show-delta">相对开始：心率 {(view.frame.signals!.heart_rate-presentationAt(0,report).frame.signals!.heart_rate).toFixed(1)} 次/分 · 呼吸 {(view.frame.signals!.resp_rate-presentationAt(0,report).frame.signals!.resp_rate).toFixed(1)} 次/分</p>}
     <p>个人参考为预置模拟历史，当前读数也来自模拟。</p>
    </section>
    <section className="show-path" aria-label="AI短路径"><h3>今晚的短路径</h3><p>{report==='already_sleepy'?'自然呼吸 → 省去额外练习 → 提前退出':'尝试慢呼气 → 观察响应 → 调整方式 → 减少刺激'}</p>{report==='already_sleepy'&&<strong>不必做满同一套课程。</strong>}</section>
   </aside>
  </div>
  <section className="show-trace" aria-label="Decision Trace"><div className="show-trace-title"><h2>每次调整，都有依据。</h2><span>{ended?'回看刚才的选择':'决策足迹'}</span></div>
   <ol>{view.trace.filter(item=>![54,27].includes(item.at)).map(item=><li key={item.at}><time>{String(item.at).padStart(2,'0')}s</time><span>{item.title}</span></li>)}</ol>
   <p>演示用于呈现 Agent 的观察、调整与退出逻辑；状态变化不代表疗效或入睡判断。</p>
  </section>
  <div className="show-secondary">
   <details><summary>未来，接入你自己的身体信号 <ArrowRight size={16}/></summary><div className="show-future"><article><h3>手机 PPG</h3><p>采集原型已保留；真实心率尚未稳定通过质量检查。</p></article><article><h3>可穿戴设备</h3><p>已预留 Sensor Adapter；Apple Watch 目前仅接口与文档。</p></article><article><h3>长期个人参考</h3><p>当前使用模拟历史，真实个人 baseline 是后续方向。</p></article></div></details>
   <details><summary>技术模式与声音设置 <ArrowRight size={16}/></summary><div className="show-technical">
    <p>此入口不调用模型，也不连接真实传感器。信号、解释与控制帧来自同一固定案例时间线。</p>
    <label><input type="checkbox" checked={sound.voiceEnabled} onChange={e=>sound.setVoiceEnabled(e.target.checked)}/>中文语音（依赖浏览器音色；可关闭配合主持人口播）</label>
    <label><input type="checkbox" checked={gentle} onChange={e=>setGentle(e.target.checked)}/>轻柔动效</label>
    <label>环境音音量<input type="range" min="0" max=".6" step=".01" value={sound.volume} onChange={e=>sound.setVolume(Number(e.target.value))}/></label>
    <a href="/">进入后端连接与完整调试页面 →</a>
    <RoadshowInsights snapshot={view.snapshot} rows={view.view.rows} reference={view.view.reference} stale={false}/>
   </div></details>
  </div>
  <footer className="show-footer">不是告诉你怎么呼吸，而是根据你的身体有没有真的慢下来，实时改变引导。<small>当前展示为模拟闭环，不是医疗测量或实时 LLM 推理。</small></footer>
 </main>;
}
