import assert from 'node:assert/strict';
import {AgentClient} from '../lib/agent-client.ts';
const modes=new Set(),texts=new Set();let client;
await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{client?.disconnect();reject(Error('WebSocket integration timeout'));},5000);
 client=new AgentClient({retryDelaysMs:[],onState:s=>{if(s.status==='failed'){clearTimeout(timer);reject(Error(s.error));}},onFrame:p=>{assert.equal(p.protocol,'2.0');assert.equal(p.frame.signals,undefined);modes.add(p.frame.visual.mode);texts.add(p.frame.message);if(modes.size===5){clearTimeout(timer);client.disconnect();resolve();}}});
 client.connect('ws://127.0.0.1:8765/ws/control','http:');
});
assert.equal(texts.size,5);console.log('PASS: Python → real WebSocket → AgentClient: 5 modes, 5 guidance texts, no raw physiology.');
