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
  for (const id of ['camera','roi','pre','post','reset','stop','summary','status','result','progress','details'])
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
        url==='/api/sensor/ppg' ? {valid:true,heart_rate:72,signal_quality:.9} : {pre_ritual_hr:null};
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
