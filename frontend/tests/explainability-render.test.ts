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
  for(const text of ['近期与今晚对比','今晚的短路径','AI 状态理解','Decision Trace','模拟案例 · 决策回放','46%','67%'])assert.ok(html.includes(text),`${at}: ${text}`);
  if(at===22)assert.ok(html.includes('switch_to_grounding'));
  if(at===50)assert.ok(html.includes('reduce_stimulation'));
  if(at===54)assert.ok(html.includes('fade_out'));
  if(at===60)assert.ok(html.includes('已经够了'));
 }
});

test('unavailable backend never renders demo trace or baseline numbers',()=>{
 const html=renderToStaticMarkup(createElement(RoadshowInsights,{snapshot:null,rows:[],reference:null,stale:true,message:'解释暂不可用'}));
 assert.ok(html.includes('暂无'));assert.ok(html.includes('解释暂不可用'));
 assert.ok(!html.includes('46%'));assert.ok(!html.includes('switch_to_grounding'));assert.ok(!html.includes('模拟案例 · 决策回放'));
});
