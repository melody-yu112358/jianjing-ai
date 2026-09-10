// Tests only: a simulated DOM/camera, no real browser or device access.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function harness({torch=true, denied=false, pending=false}={}) {
  let stopped=0, cameraResolve, capture, frame=0;
  const posts=[], elements={};
  const track={stop(){stopped++},getCapabilities(){return {torch}},getSettings(){return {torch}},
    async applyConstraints(){},addEventListener(){}};
  const stream={getTracks(){return [track]},getVideoTracks(){return [track]}};
  for (const id of ['camera','roi','pre','post','reset','stop','summary','status','result','progress','details','diagnostics','diagnose','enter','ritual-status'])
    elements[id]={disabled:false,textContent:'',value:0};
  Object.assign(elements.camera,{videoWidth:320,videoHeight:240,srcObject:null,async play(){},
    requestVideoFrameCallback(fn){capture=fn;return 1},cancelVideoFrameCallback(){capture=null}});
  elements.roi.getContext=()=>({drawImage(){},getImageData(){return {data:Array.from({length:4096},(_,i)=>
    i%4===0 ? 180+2*Math.sin(2*Math.PI*1.2*frame/30) : i%4===1 ? 70 : i%4===2 ? 50 : 255)}}});
  const context=vm.createContext({document:{getElementById:id=>elements[id],addEventListener(){}},
    window:{isSecureContext:true,addEventListener(){}},navigator:{mediaDevices:{getUserMedia(){
      if(denied) return Promise.reject({name:'NotAllowedError',message:''});
      if(pending) return new Promise(resolve=>{cameraResolve=resolve});
      return Promise.resolve(stream);
    }}},performance:{now:()=>0},Date,console,AbortController,setTimeout:()=>1,clearTimeout(){},
    async fetch(url,options){
      if(url==='/api/sensor/ppg') {assert.ok(stopped>0);posts.push(JSON.parse(options.body));}
      const data=url==='/api/sensor/status' ? {mode:'mixed',server_timestamp:Date.now()/1000,session_id:'session-test'} :
        url==='/api/sensor/ppg' ? {valid:true,accepted:true,heart_rate:72,signal_quality:.9} : {pre_ritual_hr:null};
      return {ok:true,json:async()=>data};
    }});
  vm.runInContext(source, context);
  return {elements,posts,run:s=>vm.runInContext(s,context),get stopped(){return stopped},
    resolve(){cameraResolve(stream)},async frame(i){frame=i;await capture(1600+i*1000/30,{mediaTime:i/30})}};
}
test('permission denied gives readable error',async()=>{
  const h=harness({denied:true});await h.run('measure("pre")');
  assert.match(h.elements.status.textContent,/权限/);assert.equal(h.posts.length,0);assert.equal(h.elements.pre.disabled,false);
});
test('unsupported torch releases camera and never uploads',async()=>{
  const h=harness({torch:false});await h.run('measure("pre")');
  assert.ok(h.stopped>0);assert.equal(h.posts.length,0);assert.match(h.elements.status.textContent,/闪光灯/);
});
test('cancel while permission pending releases late stream',async()=>{
  const h=harness({pending:true});const pending=h.run('measure("pre")');
  await new Promise(resolve=>setImmediate(resolve));h.run('stop()');h.resolve();await pending;
  assert.ok(h.stopped>0);assert.equal(h.posts.length,0);
});
test('25 seconds ROI samples upload after camera is stopped',async()=>{
  const h=harness();await h.run('measure("pre")');
  for(let i=0;i<=750;i++) await h.frame(i);
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].samples.length,751);
  assert.equal(h.posts[0].samples[750].t,25);assert.equal(h.posts[0].phase,'pre');
  assert.equal(h.posts[0].source,undefined);assert.equal(h.posts[0].session_id,'session-test');
  assert.equal(h.elements.pre.disabled,false);
});
test('post without pre never starts camera',async()=>{
  const h=harness();await h.run('measure("post")');assert.match(h.elements.status.textContent,/先完成前测/);assert.equal(h.posts.length,0);
});
test('empty camera error has fallback text',()=>{
  const h=harness();assert.match(h.run('errorText({message:""})'),/摄像头/);
});

test('diagnostics report actual sampled fps and acceptance',async()=>{
  const h=harness();await h.run('measure("pre")');for(let i=0;i<=750;i++) await h.frame(i);
  const d=JSON.parse(h.elements.diagnostics.textContent);
  assert.equal(d.actual_sampling_fps,30);assert.equal(d.duration_sec,25);assert.equal(d.acceptance,'accepted');
  assert.equal(d.session_id,'session-test');assert.equal(d.torch_capability,true);
});
test('protocol errors offer actionable explanations',()=>{
  const h=harness();for(const code of ['session_mismatch','timestamp_expired','measurement_timestamp_invalid'])
    assert.notEqual(h.run(`errorText({message:"${code}"})`),code);
});
test('enter ritual cannot bypass pre measurement',async()=>{
  const h=harness();await h.run('enterRitual()');assert.match(h.elements['ritual-status'].textContent,/先完成前测/);
});
test('expired source uses server status rather than local BPM',async()=>{
  const h=harness();await h.run('refreshDiagnostics()');h.run(`request = async () => ({session_id:'session-test',effective_data_source:'simulated',ttl_sec:5,
    heart_rate:{source:'simulated'},resp_rate:{source:'simulated'},external_heart_rate:{age_sec:6,stale_reason:'external_expired'},stale_reason:'external_expired'})`);
  await h.run('refreshDiagnostics()');const d=JSON.parse(h.elements.diagnostics.textContent);
  assert.equal(d.expired,true);assert.equal(d.data_source,'simulated');assert.equal(d.external_age_sec,6);
});
test('session change interrupts capture',async()=>{
  const h=harness();await h.run('refreshDiagnostics()');await h.run('measure("pre")');
  h.run(`request = async () => ({session_id:'replacement',effective_data_source:'simulated'})`);
  await h.run('refreshDiagnostics()');assert.ok(h.stopped>0);assert.equal(h.posts.length,0);
  assert.match(h.elements.status.textContent,/会话不匹配/);
});

test('poor signal reports rejection and never displays a BPM',async()=>{
  const h=harness();await h.run('measure("pre")');
  h.run(`request = async path => path === '/api/sensor/ppg' ? {valid:false,accepted:false,signal_quality:0.1,failure_reason:'low_signal_quality'} : {session_id:'session-test'}`);
  for(let i=0;i<=750;i++) await h.frame(i);
  assert.equal(JSON.parse(h.elements.diagnostics.textContent).acceptance,'rejected');
  assert.doesNotMatch(h.elements.result.textContent,/BPM/);assert.match(h.elements.status.textContent,/质量不足/);
});
test('ritual uses same session, streams guidance, and closes at end',async()=>{
  const h=harness();h.run(`window.location = {href:'https://example.test/tools/ppg-demo/'};
    URL = class {constructor(){this.protocol='https:'}};
    WebSocket = class {constructor(){globalThis.socket=this}close(){this.closed=true}};
    request = async () => ({pre_ritual_hr:72,session_id:'session-test'});`);
  await h.run('enterRitual()');
  h.run(`socket.onmessage({data:JSON.stringify({type:'agent.control',version:'2.0',session_id:'session-test',data_source:'mixed',payload:{guidance:{stage:'end',text:'结束'}}})})`);
  assert.match(h.elements['ritual-status'].textContent,/mixed/);assert.equal(h.run('socket.closed'),true);
});
