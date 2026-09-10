import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentClient,validateEndpoint,type AgentSocket,type ConnectionSnapshot} from '../lib/agent-client.ts';
import {decodeControl,ControlOrder,effectiveFrame,type AgentControl} from '../lib/agent-protocol.ts';
import {demoFrame} from '../lib/state.ts';
import {PRESETS,resolveVisual,visualSchema} from '../lib/visual-controls.ts';
function packet(seq=1,session='a'):AgentControl {return {type:'agent.control',version:'2.0',session_id:session,seq,timestamp:Date.now()/1000,data_source:'simulated',payload:{visual:{...PRESETS.ripple},guidance:{text:'由 Agent 更新的提示',stage:'guided_breathing',inhale_sec:4,exhale_sec:6}}};}
class Socket implements AgentSocket {
 onopen:AgentSocket['onopen']=null;onmessage:AgentSocket['onmessage']=null;onclose:AgentSocket['onclose']=null;onerror:AgentSocket['onerror']=null;closed=false;
 close(){this.closed=true;this.onclose?.({});}
 send(p:unknown){this.onmessage?.({data:JSON.stringify(p)});}
}
function fixture(staleAfterMs=5000){
 const sockets:Socket[]=[],states:ConnectionSnapshot[]=[],frames:unknown[]=[];
 const c=new AgentClient({createSocket:()=>{const s=new Socket();sockets.push(s);return s;},staleAfterMs,connectTimeoutMs:100,retryDelaysMs:[10,20],onState:s=>states.push(s),onFrame:(p,reset)=>frames.push({p,reset})});
 return {c,sockets,states,frames};
}
test('v1 compatibility and v2 no-telemetry control',()=>{
 const old=demoFrame(0);assert.deepEqual(decodeControl(JSON.stringify(old)).frame,old);
 const p=decodeControl(JSON.stringify(packet()));assert.equal(p.frame.message,'由 Agent 更新的提示');assert.equal(p.frame.signals,undefined);assert.equal(p.frame.state,undefined);assert.equal(p.frame.visual.mode,'ripple');
});
test('malformed, unknown version, invalid visual, duration and terminal controls are rejected',()=>{
 for(const data of ['not-json','{}',JSON.stringify({...packet(),version:'3.0'}),JSON.stringify({...packet(),payload:{...packet().payload,visual:{intensity:2,noise:0,speed:0}}})])assert.throws(()=>decodeControl(data));
 const p=packet();p.payload.guidance.exhale_sec=0;assert.throws(()=>decodeControl(JSON.stringify(p)));
 p.payload.guidance={text:'结束',stage:'end',inhale_sec:0,exhale_sec:0};assert.throws(()=>decodeControl(JSON.stringify(p)));
 p.payload.visual={...PRESETS.storm,intensity:0,noise:0,speed:0};assert.equal(decodeControl(JSON.stringify(p)).frame.ritual.stage,'end');
 assert.throws(()=>decodeControl('界'.repeat(30000)));
});
test('duplicate, out-of-order, retired sessions and protocol switches do not take control',()=>{
 const order=new ControlOrder();const send=(seq:number,id='a')=>order.accept(decodeControl(JSON.stringify(packet(seq,id))));
 assert.deepEqual(send(2),{accepted:true,reset:true});assert.equal(send(2).accepted,false);assert.equal(send(1).accepted,false);assert.equal(send(3).accepted,true);
 assert.deepEqual(send(0,'b'),{accepted:true,reset:true});assert.equal(send(99,'a').accepted,false);
 assert.equal(order.accept(decodeControl(JSON.stringify(demoFrame(0)))).accepted,false);
});
test('manual visual override preserves latest guidance and telemetry; end wins',()=>{
 const p=decodeControl(JSON.stringify(packet())).frame,manual=PRESETS.storm;
 const out=effectiveFrame(p,manual);assert.equal(out.message,p.message);assert.equal(out.ritual,p.ritual);assert.equal(out.visual,manual);
 const next={...p,message:'新引导词'};assert.equal(effectiveFrame(next,manual).message,'新引导词');assert.equal(effectiveFrame(next,null).visual,p.visual);
 const end={...next,ritual:{stage:'end' as const,inhale_sec:0,exhale_sec:0},visual:{intensity:0,noise:0,speed:0}};assert.deepEqual(effectiveFrame(end,manual).visual,end.visual);
});
test('all modes provide independently resolved bounded controls; explicit zeros retained',()=>{
 for(const p of Object.values(PRESETS)){visualSchema.parse(p);assert.deepEqual(resolveVisual(p),p);}
 const zero=resolveVisual({intensity:0,noise:0,speed:0,particle_density:0,line_density:0,glow:0});assert.equal(zero.particle_density,0);assert.equal(zero.line_density,0);assert.equal(zero.glow,0);
 for(let n=0;n<=10;n++)visualSchema.parse(resolveVisual({intensity:n/10,noise:1-n/10,speed:.5}));
 assert.throws(()=>visualSchema.parse({...PRESETS.storm,mode:'unknown'}));assert.throws(()=>visualSchema.parse({...PRESETS.storm,hue:361}));
});
test('valid frames activate connection; invalid frames never replace guidance',()=>{
 const {c,sockets,states,frames}=fixture();c.connect('ws://localhost:8000/ws/state','http:');sockets[0].onopen?.({});assert.equal(states.at(-1)?.status,'waiting');
 sockets[0].send(packet());assert.equal(states.at(-1)?.status,'live');sockets[0].send({bad:true});assert.equal(frames.length,1);assert.equal(states.at(-1)?.rejected,1);c.disconnect();
});
test('stale data reconnects; rejected duplicates cannot prolong freshness; old socket ignored',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {c,sockets,states,frames}=fixture(50);c.connect('ws://localhost:8000/ws/state','http:');const old=sockets[0];old.send(packet(1));
 t.mock.timers.tick(40);old.send(packet(1));t.mock.timers.tick(10);assert.ok(states.some(s=>s.status==='stale'));assert.equal(old.closed,true);
 t.mock.timers.tick(10);assert.equal(sockets.length,2);old.send(packet(2));assert.equal(frames.length,1);sockets[1].send(packet(2));assert.equal(frames.length,2);assert.equal(states.at(-1)?.status,'live');c.disconnect();
});
test('intentional disconnect cancels pending retries; failed connection stops after bounded attempts',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const a=fixture();a.c.connect('ws://localhost/ws','http:');a.sockets[0].close();a.c.disconnect();t.mock.timers.tick(1000);assert.equal(a.sockets.length,1);
 const b=fixture();b.c.connect('ws://localhost/ws','http:');b.sockets[0].close();t.mock.timers.tick(10);b.sockets[1].close();t.mock.timers.tick(20);b.sockets[2].close();assert.equal(b.states.at(-1)?.status,'failed');b.c.disconnect();
});
test('mixed content and credential-bearing endpoints are rejected without replacing valid connection',()=>{
 assert.throws(()=>validateEndpoint('ws://host/ws','https:'));assert.throws(()=>validateEndpoint('wss://user:pass@host/ws','https:'));assert.throws(()=>validateEndpoint('https://host/ws','https:'));
 const a=fixture();a.c.connect('ws://localhost/ws','http:');assert.throws(()=>a.c.connect('not a URL'));assert.equal(a.sockets[0].closed,false);a.c.disconnect();
});

test('stale and far-future timestamps are rejected before taking control',()=>{
 const {c,sockets,frames,states}=fixture();c.connect('ws://localhost/ws','http:');
 const old=packet(1);old.timestamp-=60;sockets[0].send(old);const future=packet(2);future.timestamp+=60;sockets[0].send(future);assert.equal(frames.length,0);assert.equal(states.at(-1)?.rejected,2);sockets[0].send(packet(1));assert.equal(frames.length,1);c.disconnect();
});
