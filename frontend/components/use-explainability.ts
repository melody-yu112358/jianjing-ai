'use client';
import {useEffect,useState} from 'react';
import {apiEndpoint,explainabilitySchema,type ExplainabilitySnapshot} from '@/lib/explainability';
export function useExplainability(address:string,enabled:boolean,sessionId?:string){
 const [snapshot,setSnapshot]=useState<ExplainabilitySnapshot|null>(null),[error,setError]=useState('');
 useEffect(()=>{
  setSnapshot(null);setError('');if(!enabled)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>;const abort=new AbortController();
  async function poll(){try{
   const url=apiEndpoint(address,'/api/explainability',location.protocol);
   const r=await fetch(url,{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(4000)])});
   if(!r.ok)throw Error(`解释接口 HTTP ${r.status}`);
   const value=explainabilitySchema.parse(await r.json());
   if(value.provenance.explanation_source!=='backend'||value.session_id!==sessionId)throw Error('等待与控制消息一致的后端会话');
   if(!cancelled){setSnapshot(value);setError('');}
  }catch{if(!cancelled){setSnapshot(null);setError('解释接口暂不可用或会话不匹配；仅显示已收到的控制数据。');}}
  finally{if(!cancelled)timer=setTimeout(poll,750);}}
  void poll();return()=>{cancelled=true;abort.abort();clearTimeout(timer);};
 },[address,enabled,sessionId]);
 return {snapshot,error};
}
