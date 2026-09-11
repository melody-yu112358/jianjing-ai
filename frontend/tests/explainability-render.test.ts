import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {transpileModule,ModuleKind,JsxEmit} from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {roadshowSnapshot,roadshowView} from '../lib/roadshow-explainability.ts';
// Compile the actual display component; no browser or implementation-copy renderer.
const source=readFileSync(new URL('../components/roadshow-insights.tsx',import.meta.url),'utf8').replace("'@/lib/explainability'","'../lib/explainability.ts'");
const path=new URL(`./render-component-${process.pid}.mjs`,import.meta.url);
writeFileSync(path,transpileModule(source,{compilerOptions:{module:ModuleKind.ESNext,jsx:JsxEmit.ReactJSX}}).outputText);
const {RoadshowInsights}=await import(path.href);
unlinkSync(path);

test('same rendered component displays baseline, plan, state, trace and provenance through 60s',()=>{
 for(const at of [0,10,22,38,50,54,60]){
  const view=roadshowView(at,'mind_racing');
  const html=renderToStaticMarkup(createElement(RoadshowInsights,{snapshot:roadshowSnapshot(at),rows:view.rows,reference:view.reference,stale:false}));
  for(const text of ['近期与今晚对比','今晚的短路径','AI 状态理解','Decision Trace','data-explanation-source="demo_fixture"','46%','67%','paired-signals','clear-reading','决策记录'])assert.ok(html.includes(text),`${at}: ${text}`);
  assert.ok(!html.includes('模拟案例 · 决策回放'));
  assert.ok(html.indexOf('决策记录')<html.indexOf('查看完整状态与决策字段'));
  if(at===22)assert.ok(html.includes('switch_to_grounding'));
  if(at===50)assert.ok(html.includes('reduce_stimulation'));
  if(at===54)assert.ok(html.includes('fade_out'));
  if(at===60)assert.ok(html.includes('已经够了'));
 }
});

test('display uses each selected state and controller timing, including sleepy and missing baselines',()=>{
 const sleepy=roadshowSnapshot(12,'already_sleepy');
 const view=roadshowView(12,'already_sleepy');
 const html=renderToStaticMarkup(createElement(RoadshowInsights,{snapshot:sleepy,rows:view.rows,reference:view.reference,stale:false}));
 assert.ok(html.includes('已经比较困'));
 assert.ok(html.includes('今晚唤醒低于近期参考，稳定度更高'));
 assert.ok(!html.includes('吸气 4 秒'));
 const tense=roadshowSnapshot(12,'body_tense');
 assert.ok(tense.current_state);
 assert.ok(tense.decision_trace);
 tense.provenance.explanation_source='backend';tense.provenance.decision_source='rule';
 tense.current_state.reason_codes=['baseline_pending','<unsafe>'];
 tense.decision_trace.next_reassessment_sec=77;
 const live=renderToStaticMarkup(createElement(RoadshowInsights,{snapshot:tense,rows:[],reference:null,stale:false}));
 assert.ok(live.includes('吸气 4 秒、呼气 5 秒'));
 assert.ok(live.includes('约第 77 秒重新观察'));
 assert.ok(live.includes('稳定度暂不可解读'));
 assert.ok(!live.includes('今晚唤醒高于'));
 assert.ok(live.includes('&lt;unsafe&gt;'));
 assert.ok(live.includes('data-decision-source="rule"'));
});

test('unavailable backend never renders demo trace or baseline numbers',()=>{
 const html=renderToStaticMarkup(createElement(RoadshowInsights,{snapshot:null,rows:[],reference:null,stale:true,message:'解释暂不可用'}));
 assert.ok(html.includes('暂无'));assert.ok(html.includes('解释暂不可用'));
 assert.ok(!html.includes('46%'));assert.ok(!html.includes('switch_to_grounding'));assert.ok(!html.includes('模拟案例 · 决策回放'));
});
