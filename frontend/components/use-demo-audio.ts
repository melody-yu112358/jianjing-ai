'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {DemoAudio} from '@/lib/demo-audio';
import {DemoNarrator,type NarratorStatus} from '@/lib/demo-guidance';

export function useDemoAudio(running:boolean,elapsed:number,demo=true,timing?:{duration:number;fadeAt:number;cueAt:(t:number)=>{at:number;text:string}|null}) {
  const ref=useRef<DemoAudio|null>(null);
  const narrator=useRef<DemoNarrator|null>(null);
  const [voiceStatus,setVoiceStatus]=useState<NarratorStatus>('ready');
  const [voiceEnabled,setVoiceEnabled]=useState(true);
  const [track,setTrack]=useState('海浪');
  const [status,setStatus]=useState('ready');
  const [muted,setMuted]=useState(false),[volume,setVolume]=useState(.08);
  const start=useCallback((fresh=false)=>{
    if(!ref.current)ref.current=new DemoAudio(()=>new Audio(),setStatus,timing?.duration,timing?.fadeAt);
    ref.current.start(fresh);setTrack(ref.current.track!.name);
    if(typeof speechSynthesis==='undefined'||typeof SpeechSynthesisUtterance==='undefined'){setVoiceStatus('unavailable');return;}
    if(!narrator.current)narrator.current=new DemoNarrator(speechSynthesis,text=>new SpeechSynthesisUtterance(text),setVoiceStatus,timing?.cueAt);
    narrator.current.start(fresh);
  },[timing]);
  const stop=useCallback(()=>{ref.current?.stop();narrator.current?.pause();},[]);
  useEffect(()=>{ref.current?.update(running,elapsed,volume,muted);},[running,elapsed,volume,muted]);
  useEffect(()=>{if(!demo)narrator.current?.reset();else narrator.current?.update(running,elapsed,voiceEnabled&&!muted);},[demo,running,elapsed,voiceEnabled,muted]);
  useEffect(()=>()=>{ref.current?.dispose();ref.current=null;narrator.current?.cancel();narrator.current=null;},[]);
  return {track,status,muted,setMuted,volume,setVolume,start,stop,voiceEnabled,setVoiceEnabled,voiceStatus};
}
