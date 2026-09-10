'use client';
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {resolveVisual} from '@/lib/visual-controls';
import type {ControlFrame} from '@/lib/agent-protocol';
import {landscapeVertex,landscapeFragment} from '@/lib/inner-landscape-shader';

export function InnerLandscape(props:{frame:ControlFrame;scene:number;playing:boolean;gentle:boolean;breath:number;sleepProgress:number}){
 const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
 const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const el=host.current;if(!el)return;setFailed(false);
  let r:THREE.WebGLRenderer;
  try{r=new THREE.WebGLRenderer({antialias:false,alpha:false,powerPreference:'low-power'});}catch{setFailed(true);return;}
  r.setPixelRatio(Math.min(window.devicePixelRatio,1.35));el.appendChild(r.domElement);
  r.domElement.setAttribute('aria-hidden','true');r.debug.onShaderError=()=>setFailed(true);
  const v=resolveVisual(latest.current.frame.visual);
  const u:Record<string,{value:any}>={uResolution:{value:new THREE.Vector2(1,1)},uTime:{value:0},uLineTime:{value:0},uParticleTime:{value:0},uWeights:{value:[0,0,0,0,0].map((_,i)=>i===latest.current.scene?1:0)},uBreath:{value:.5},uSleep:{value:0}};
  const keys={intensity:'uIntensity',noise:'uNoise',deformation:'uDeform',frequency:'uFrequency',turbulence:'uTurbulence',glow:'uGlow',pulse:'uPulse',particle_density:'uDensity',particle_spread:'uSpread',particle_size:'uParticleSize',particle_brightness:'uParticleBrightness',line_density:'uLineDensity',line_activity:'uLineActivity',line_brightness:'uLineBrightness'} as const;
  for(const [key,name] of Object.entries(keys))u[name]={value:v[key as keyof typeof keys]};u.uHue={value:v.hue/360};
  const geometry=new THREE.PlaneGeometry(2,2),material=new THREE.ShaderMaterial({uniforms:u,vertexShader:landscapeVertex,fragmentShader:landscapeFragment,depthTest:false,depthWrite:false});
  const scene=new THREE.Scene();scene.add(new THREE.Mesh(geometry,material));const camera=new THREE.Camera();
  const resize=()=>{r.setSize(el.clientWidth,el.clientHeight);u.uResolution.value.set(el.clientWidth,el.clientHeight);};
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  let raf=0,last=performance.now(),lastPaint=0,clockSpeed=v.speed,lineSpeed=v.line_speed,particleSpeed=v.particle_speed;
  const lost=(e:Event)=>{e.preventDefault();setFailed(true);};r.domElement.addEventListener('webglcontextlost',lost);
  function draw(now:number){
   raf=requestAnimationFrame(draw);if(now-lastPaint<32)return;lastPaint=now;
   const dt=Math.min((now-last)/1000,.1);last=now;if(document.hidden)return;
   const p=latest.current,visual=resolveVisual(p.frame.visual),alpha=1-Math.exp(-dt*4/Math.max(1,visual.transition_sec));
   for(const [key,name] of Object.entries(keys))u[name].value+=(visual[key as keyof typeof keys]-u[name].value)*alpha;
   u.uHue.value+=(visual.hue/360-u.uHue.value)*alpha;
   for(let i=0;i<5;i++)u.uWeights.value[i]+=((i===p.scene?1:0)-u.uWeights.value[i])*alpha;
   u.uBreath.value+=(p.breath-u.uBreath.value)*(1-Math.exp(-dt*3));
   u.uSleep.value+=(p.sleepProgress-u.uSleep.value)*(1-Math.exp(-dt*6));
   clockSpeed+=(visual.speed-clockSpeed)*alpha;lineSpeed+=(visual.line_speed-lineSpeed)*alpha;particleSpeed+=(visual.particle_speed-particleSpeed)*alpha;
   if(p.playing){const ease=p.gentle?.12:1;u.uTime.value+=dt*(.15+clockSpeed*.7)*ease;u.uLineTime.value+=dt*lineSpeed*ease;u.uParticleTime.value+=dt*particleSpeed*ease;}
   r.render(scene,camera);
  }
  raf=requestAnimationFrame(draw);
  return()=>{cancelAnimationFrame(raf);observer.disconnect();r.domElement.removeEventListener('webglcontextlost',lost);geometry.dispose();material.dispose();r.dispose();r.domElement.remove();};
 },[attempt]);
 return <div className="inner-landscape" ref={host}>{failed&&<div className="art-fallback" role="status"><p>动态画面暂时不可用，仍可跟随文字呼吸。</p><button onClick={()=>setAttempt(n=>n+1)}>重新加载画面</button></div>}</div>;
}
