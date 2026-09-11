'use client';
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {resolveVisual} from '@/lib/visual-controls';
import {ModeTransition} from '@/lib/mode-transition';
import {smoothingAlpha} from '@/lib/state';
import {buildFilaments,buildOuterFilaments,seeded} from '@/lib/filament-geometry';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {filamentVertex,filamentFragment,moteVertex,moteFragment,coreVertex,coreFragment} from '@/lib/filament-shaders';
import type {ControlFrame} from '@/lib/agent-protocol';

export function FilamentLife(props:{frame:ControlFrame;playing:boolean;gentle:boolean;stale:boolean;breathProgress?:number|null;sleepProgress?:number}){
 const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
 const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const el=host.current;if(!el)return;setFailed(false);
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{setFailed(true);return;}
  renderer.setClearColor(0x000000,0);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden','true');renderer.debug.onShaderError=()=>setFailed(true);
  const v=resolveVisual(latest.current.frame.visual),morph=new ModeTransition(v.mode);
  const uniforms={uTime:{value:0},uLineTime:{value:0},uParticleTime:{value:0},uIntensity:{value:v.intensity},uNoise:{value:v.noise},uDeform:{value:v.deformation},uFrequency:{value:v.frequency},uTurbulence:{value:v.turbulence},uBreath:{value:0},uGuide:{value:0},uPulse:{value:v.pulse},uSleep:{value:0},uVisibility:{value:1},uSpread:{value:v.particle_spread},uGlow:{value:v.glow},uHue:{value:v.hue},uLineActivity:{value:v.line_activity},uLineDensity:{value:v.line_density},uLineBrightness:{value:v.line_brightness},uDensity:{value:v.particle_density},uParticleSize:{value:v.particle_size},uParticleBrightness:{value:v.particle_brightness},uPixelRatio:{value:renderer.getPixelRatio()},uModes:{value:new THREE.Vector4(...morph.weights.slice(0,4))},uPulseMode:{value:morph.weights[4]}};
  const material=(vertexShader:string,fragmentShader:string)=>new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending});
  const compact=el.clientWidth<550,curves=buildFilaments(compact?384:640,compact?128:160);
  const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.BufferAttribute(curves.position,3));lineGeo.setAttribute('aSeed',new THREE.BufferAttribute(curves.seed,1));lineGeo.setAttribute('aProgress',new THREE.BufferAttribute(curves.progress,1));lineGeo.setAttribute('aLayer',new THREE.BufferAttribute(curves.layer,1));
  const lineMat=material(filamentVertex,filamentFragment),lines=new THREE.LineSegments(lineGeo,lineMat);
  const shell=buildOuterFilaments(compact?96:144,128),outerGeo=new THREE.BufferGeometry();
  outerGeo.setAttribute('position',new THREE.BufferAttribute(shell.position,3));outerGeo.setAttribute('aSeed',new THREE.BufferAttribute(shell.seed,1));outerGeo.setAttribute('aProgress',new THREE.BufferAttribute(shell.progress,1));outerGeo.setAttribute('aLayer',new THREE.BufferAttribute(shell.layer,1));
  const outer=new THREE.LineSegments(outerGeo,lineMat);
  const count=compact?4000:6500,pos=new Float32Array(count*3),seeds=new Float32Array(count),layers=new Float32Array(count);
  for(let i=0;i<count;i++){
   const idx=Math.floor(seeded(i+908)*curves.count),j=idx*3;
   pos.set([curves.position[j],curves.position[j+1],curves.position[j+2]],i*3);
   seeds[i]=seeded(i+483);layers[i]=curves.layer[idx]+(seeded(i+905)-.5)*.025;
  }
  const moteGeo=new THREE.BufferGeometry();moteGeo.setAttribute('position',new THREE.BufferAttribute(pos,3));moteGeo.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));moteGeo.setAttribute('aLayer',new THREE.BufferAttribute(layers,1));
  const moteMat=material(moteVertex,moteFragment),motes=new THREE.Points(moteGeo,moteMat);
  const coreGeo=new THREE.PlaneGeometry(2.6,2.6),coreMat=material(coreVertex,coreFragment),core=new THREE.Mesh(coreGeo,coreMat);core.position.set(.1,0,-.25);
  const group=new THREE.Group();group.rotation.set(.12,0,-.20);group.add(core,lines,outer,motes);for(const obj of [core,lines,outer,motes])obj.frustumCulled=false;
  const scene=new THREE.Scene();scene.add(group);const camera=new THREE.PerspectiveCamera(38,1,.1,30);
  const composer=new EffectComposer(renderer),output=new OutputPass();
  composer.addPass(new RenderPass(scene,camera));composer.addPass(output);
  const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;renderer.setSize(w,h);composer.setSize(w,h);camera.aspect=w/h;camera.position.z=Math.max(4.7,4.1/camera.aspect);camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  let raf=0,last=performance.now(),lastPaint=0,speed=v.speed,lineSpeed=v.line_speed,particleSpeed=v.particle_speed;
  function tick(now:number){
   raf=requestAnimationFrame(tick);if(now-lastPaint<(compact?32:22))return;lastPaint=now;
   const dt=Math.min((now-last)/1000,.06);last=now;if(document.hidden)return;
   const p=latest.current,target=resolveVisual(p.frame.visual),alpha=smoothingAlpha(dt,Math.max(.25,target.transition_sec/3)),gentle=p.gentle?.25:1;
   const values={uVisibility:p.frame.ritual.stage==='end'?0:p.frame.ritual.stage==='fade_out'?Math.min(1,target.intensity/.32):1,uIntensity:target.intensity,uNoise:target.noise*gentle,uDeform:target.deformation*gentle,uFrequency:target.frequency,uTurbulence:target.turbulence*gentle,uPulse:target.pulse*gentle,uSpread:target.particle_spread,uGlow:target.glow,uHue:target.hue,uLineActivity:target.line_activity*gentle,uLineDensity:target.line_density,uLineBrightness:target.line_brightness,uDensity:target.particle_density,uParticleSize:target.particle_size,uParticleBrightness:target.particle_brightness};
   for(const [key,value] of Object.entries(values)){const u=uniforms[key as keyof typeof values];u.value+=(value-u.value)*alpha;}
   morph.setTarget(target.mode,Math.max(1,target.transition_sec));const weights=morph.advance(dt);uniforms.uModes.value.set(weights[0],weights[1],weights[2],weights[3]);uniforms.uPulseMode.value=weights[4];
   speed+=(target.speed*gentle-speed)*alpha;lineSpeed+=(target.line_speed*gentle-lineSpeed)*alpha;particleSpeed+=(target.particle_speed*gentle-particleSpeed)*alpha;
   if(p.playing&&!p.stale){uniforms.uTime.value+=dt*speed*1.5;uniforms.uLineTime.value+=dt*lineSpeed*2.;uniforms.uParticleTime.value+=dt*particleSpeed*1.5;}
   const guided=p.breathProgress!=null;
   if(p.playing&&!p.stale)uniforms.uGuide.value+=((guided?1:0)-uniforms.uGuide.value)*smoothingAlpha(dt,1.2);
   const breathing=p.breathProgress??.5;if(p.playing&&!p.stale)uniforms.uBreath.value+=(breathing-uniforms.uBreath.value)*smoothingAlpha(dt,.18);
   const sleep=Math.min(1,Math.max(0,p.sleepProgress??0));uniforms.uSleep.value=sleep===0?0:uniforms.uSleep.value+(sleep-uniforms.uSleep.value)*smoothingAlpha(dt,.12);
   group.rotation.y=Math.sin(uniforms.uTime.value*.055)*.11;
   composer.render();
  }
  raf=requestAnimationFrame(tick);const lost=(e:Event)=>{e.preventDefault();cancelAnimationFrame(raf);setFailed(true);};renderer.domElement.addEventListener('webglcontextlost',lost);
  return()=>{cancelAnimationFrame(raf);observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',lost);for(const g of [lineGeo,outerGeo,moteGeo,coreGeo])g.dispose();for(const m of [lineMat,moteMat,coreMat])m.dispose();output.dispose();composer.dispose();renderer.dispose();renderer.domElement.remove();};
 },[attempt]);
 return <div className="particle-canvas filament-canvas" ref={host} role="img" aria-label="双层光丝生命体：内层随状态流动，透明外层随呼吸引导舒展和回收">{failed&&<div className="webgl-fallback"><p>动态画面暂时不可用</p><span>仍可跟随文字呼吸。</span><button onClick={()=>setAttempt(n=>n+1)}>重新加载画面</button></div>}</div>;
}
