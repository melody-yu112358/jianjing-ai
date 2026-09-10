import test from 'node:test';
import assert from 'node:assert/strict';
import {explainabilitySchema,matchesControl,apiEndpoint,SELF_REPORTS,type SelfReport} from '../lib/explainability.ts';
import {roadshowSnapshot,roadshowView} from '../lib/roadshow-explainability.ts';
import {roadshowPacket,RoadshowReplay,roadshowAudioFor} from '../lib/roadshow-demo.ts';
import {decodeControl} from '../lib/agent-protocol.ts';

test('all self reports affect shared snapshots, controls and short paths',()=>{
 const states=[];
 for(const report of Object.keys(SELF_REPORTS) as SelfReport[]){
  const s=roadshowSnapshot(10,report),p=roadshowPacket(10,'demo-preview',0,1,report);
  assert.equal(s.self_report,report);assert.equal(s.current_state?.arousal,p.payload.state?.arousal);
  assert.equal(s.decision_trace?.decision.exhale_sec,p.payload.guidance.exhale_sec);
  states.push(s.current_state?.arousal);
 }
 assert.equal(new Set(states).size,4);
 assert.equal(roadshowSnapshot(10,'already_sleepy').tonight_plan.initial_decision?.action,'reduce_stimulation');
 assert.equal(roadshowPacket(10,'x',0,1,'already_sleepy').payload.guidance.inhale_sec,0);
 assert.ok(!roadshowAudioFor('already_sleepy').cueAt(14)?.text.includes('缓缓呼气'));
 assert.equal(roadshowPacket(14,'x',0,1,'body_tense').payload.guidance.exhale_sec,5);
});

test('baseline overview is deterministic, explicitly simulated, and plan exists before replay',()=>{
 const a=roadshowSnapshot(0),b=roadshowSnapshot(0);
 assert.deepEqual(a,b);assert.equal(a.baseline.history.length,7);assert.equal(a.baseline.arousal,.46);assert.equal(a.baseline.stability,.67);
 assert.equal(a.provenance.baseline_source,'simulated_demo_history');assert.equal(a.provenance.explanation_source,'demo_fixture');assert.equal(a.provenance.decision_source,null);
 assert.equal(a.tonight_plan.initial_decision?.action,'continue_breathing');
 assert.equal(roadshowView(0,'mind_racing').reference.heart_rate[0],72);
});

test('complete 60s trace follows actual replay guidance and preserves adaptation nodes',()=>{
 for(let t=0;t<=60;t+=.25){
  const s=roadshowSnapshot(t),p=roadshowPacket(t,'demo-preview',0,1);
  explainabilitySchema.parse(s);
  assert.equal(s.decision_trace?.decision.stage,p.payload.guidance.stage);
  assert.equal(s.decision_trace?.decision.message,p.payload.guidance.text);
  assert.equal(s.current_state?.arousal,p.payload.state?.arousal);
  assert.ok(s.decision_history.every(d=>d.at<=t));
 }
 assert.equal(roadshowSnapshot(22).decision_trace?.decision.action,'switch_to_grounding');
 assert.equal(roadshowSnapshot(22).decision_trace?.decision.inhale_sec,0);
 assert.equal(roadshowSnapshot(50).decision_trace?.decision.action,'reduce_stimulation');
 assert.equal(roadshowSnapshot(54).decision_trace?.decision.action,'fade_out');
 assert.equal(roadshowSnapshot(60).decision_trace?.decision.action,'end');
});

test('pause resume and restart preserve source and timeline isolation',()=>{
 const r=new RoadshowReplay('one',1,'body_tense');r.advance(21);
 assert.equal(r.advance(0).elapsed,21);assert.equal(r.advance(1).elapsed,22);
 assert.equal(roadshowSnapshot(22,'body_tense').decision_trace?.decision.action,'switch_to_natural_breathing');
 const n=new RoadshowReplay('two',1,'already_sleepy');assert.equal(n.advance(0).elapsed,0);assert.equal(n.sessionId,'two');
});

test('backend mode rejects demo, foreign sessions, stale or mismatched decisions',()=>{
 const s=roadshowSnapshot(10,'mind_racing','live',1000),p=decodeControl(JSON.stringify(roadshowPacket(10,'live',0,1000)));
 assert.equal(matchesControl(s,p,1010),false);
 s.provenance.explanation_source='backend';s.scope='shared_process';s.provenance.decision_source='rule';
 assert.equal(matchesControl(s,p,1010),true);
 assert.equal(matchesControl(s,p,1020),false);
 assert.equal(matchesControl({...s,session_id:'old'},p,1010),false);
 assert.equal(matchesControl(s,null,1010),false);
 p.frame.message='another adopted decision';assert.equal(matchesControl(s,p,1010),false);
});

test('endpoint derivation preserves deployment prefix and rejects mixed content or unsupported paths',()=>{
 assert.equal(apiEndpoint('wss://example.test/jianjing/ws/control','/api/explainability'),'https://example.test/jianjing/api/explainability');
 assert.throws(()=>apiEndpoint('ws://example.test/ws/control','/api/demo'));
 assert.throws(()=>apiEndpoint('wss://example.test/arbitrary','/api/demo'));
 assert.throws(()=>explainabilitySchema.parse({...roadshowSnapshot(0),version:'2.0'}));
});

test('real Python-produced example passes frontend contract without fixture substitution',async()=>{
 const {readFileSync}=await import('node:fs');
 const s=explainabilitySchema.parse(JSON.parse(readFileSync(new URL('../../docs/explainability.example.json',import.meta.url),'utf8')));
 assert.equal(s.provenance.explanation_source,'backend');assert.equal(s.provenance.decision_source,'rule');
 assert.equal(s.current_state?.state_class,'not_responding');assert.equal(s.decision_trace?.decision.action,'switch_to_grounding');
 assert.equal(s.tonight_plan.reassessment_interval_sec,30);
});

test('terminal explanation stays visible only with fresh matching terminal control',()=>{
 const s=roadshowSnapshot(60,'mind_racing','live',1000),p=decodeControl(JSON.stringify(roadshowPacket(60,'live',0,1000)));
 s.provenance.explanation_source='backend';s.scope='shared_process';p.frame.timestamp=1100;
 assert.equal(matchesControl(s,p,1100),true);assert.equal(matchesControl(s,p,1106),false);
});
