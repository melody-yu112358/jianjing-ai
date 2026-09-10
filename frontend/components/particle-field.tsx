'use client';
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {smoothingAlpha} from '@/lib/state';
import type {ControlFrame} from '@/lib/agent-protocol';
import {ModeTransition} from '@/lib/mode-transition';
import {resolveVisual} from '@/lib/visual-controls';
import {meshVertex,meshFragment,particleVertex,particleFragment,lineVertex,lineFragment} from '@/lib/soft-sphere-shaders';

export function ParticleField(props:{frame:ControlFrame;playing:boolean;gentle:boolean;stale:boolean;breathProgress?:number|null;sleepProgress?:number}){
 const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
 const [error,setError]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  const element=host.current;if(!element)return;setError(false);
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch{setError(true);return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));element.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
  renderer.debug.onShaderError=()=>setError(true);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.1,50);camera.position.z=7;
  const v=resolveVisual(latest.current.frame.visual);
  const morph=new ModeTransition(v.mode);
  const color=new THREE.Color().setHSL(v.hue/360,.20,.83);
  const modeWeights=(mode:string)=>new THREE.Vector4(mode==='serenity'?1:0,mode==='ripple'?1:0,mode==='fold'?1:0,mode==='storm'?1:0);
  const uniforms={uTime:{value:0},uParticleTime:{value:0},uLineTime:{value:0},uParticleSize:{value:v.particle_size},uParticleBrightness:{value:v.particle_brightness},uLineBrightness:{value:v.line_brightness},uSleep:{value:0},uIntensity:{value:v.intensity},uNoise:{value:v.noise},uDeform:{value:v.deformation},uFrequency:{value:v.frequency},uTurbulence:{value:v.turbulence},uSpread:{value:v.particle_spread},uGlow:{value:v.glow},uPulse:{value:v.pulse},uBreath:{value:.5},uModes:{value:modeWeights(v.mode)},uPulseMode:{value:v.mode==='pulse'?1:0},uPixelRatio:{value:renderer.getPixelRatio()},uDensity:{value:v.particle_density},uLineDensity:{value:v.line_density},uLineActivity:{value:v.line_activity},uColor:{value:color}};
  const material=(vertexShader:string,fragmentShader:string,additive=false)=>new THREE.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:!additive,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
  const solidGeo=new THREE.SphereGeometry(1,256,192),solidMat=material(meshVertex,meshFragment),solid=new THREE.Mesh(solidGeo,solidMat);
  const count=5000,positions=new Float32Array(count*3),seeds=new Float32Array(count);
  for(let i=0;i<count;i++){const theta=i*2.3999632297,y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y);positions.set([r*Math.cos(theta),y,r*Math.sin(theta)],i*3);const h=Math.sin(i*127.1+311.7)*43758.5453;seeds[i]=h-Math.floor(h);}
  const particleGeo=new THREE.BufferGeometry();particleGeo.setAttribute('position',new THREE.BufferAttribute(positions,3));particleGeo.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));
  const particleMat=material(particleVertex,particleFragment,true),points=new THREE.Points(particleGeo,particleMat);
  const linePositions:number[]=[],lineSeeds:number[]=[],lineProgress:number[]=[];
  // 64 closed tilted contours, each rendered as independently animated segments.
  for(let strand=0;strand<64;strand++)for(let j=0;j<128;j++)for(const k of [j,j+1]){
    const theta=k/128*Math.PI*2,lat=-.94+1.88*(strand+.5)/64,r=Math.sqrt(1-lat*lat),tilt=strand%3===0?.55:strand%3===1?-.35:.08;
    const x=r*Math.cos(theta),y=lat,z=r*Math.sin(theta);
    linePositions.push(x,y*Math.cos(tilt)-z*Math.sin(tilt),y*Math.sin(tilt)+z*Math.cos(tilt));lineSeeds.push(((strand*17)%64+.5)/64);lineProgress.push(k/128);
  }
  const lineGeo=new THREE.BufferGeometry();lineGeo.setAttribute('position',new THREE.Float32BufferAttribute(linePositions,3));lineGeo.setAttribute('aSeed',new THREE.Float32BufferAttribute(lineSeeds,1));lineGeo.setAttribute('aProgress',new THREE.Float32BufferAttribute(lineProgress,1));
  const lineMat=material(lineVertex,lineFragment,true),lines=new THREE.LineSegments(lineGeo,lineMat);
  const group=new THREE.Group();group.rotation.z=.18;solid.renderOrder=0;lines.renderOrder=1;points.renderOrder=2;group.add(solid,points,lines);scene.add(group);
  for(const item of [solid,points,lines])item.frustumCulled=false;
  const resize=()=>{const w=element.clientWidth,h=element.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.position.z=Math.max(7,6.7/camera.aspect);camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  let raf=0,last=performance.now(),speed=v.speed,particleSpeed=v.particle_speed,lineSpeed=v.line_speed;
  const targetColor=new THREE.Color();
  const tick=(now:number)=>{
   const dt=Math.min((now-last)/1000,.05);last=now;const p=latest.current;
   if(!document.hidden){
    const target=resolveVisual(p.frame.visual),alpha=smoothingAlpha(dt,target.transition_sec/3),gentle=p.gentle?.38:1;
    const values={uIntensity:p.stale?.015:target.intensity,uNoise:p.stale?0:target.noise,uDeform:target.deformation*gentle,uFrequency:target.frequency,uTurbulence:target.turbulence*gentle,uSpread:target.particle_spread*gentle,uGlow:target.glow,uPulse:target.pulse*gentle,uDensity:target.particle_density,uLineDensity:target.line_density,uLineActivity:target.line_activity*gentle,uParticleSize:target.particle_size,uParticleBrightness:target.particle_brightness,uLineBrightness:target.line_brightness};
    for(const [key,value] of Object.entries(values)){const u=uniforms[key as keyof typeof values];u.value+=(value-u.value)*alpha;}
    morph.setTarget(target.mode,target.transition_sec);
    const weights=morph.advance(dt);uniforms.uModes.value.set(weights[0],weights[1],weights[2],weights[3]);uniforms.uPulseMode.value=weights[4];
    targetColor.setHSL(target.hue/360,.20,.83);uniforms.uColor.value.lerp(targetColor,alpha);
    speed+=((p.stale?0:target.speed)*gentle-speed)*alpha;
    particleSpeed+=(target.particle_speed*gentle-particleSpeed)*alpha;lineSpeed+=(target.line_speed*gentle-lineSpeed)*alpha;
    if(p.playing&&!p.stale){uniforms.uTime.value+=dt*speed*2.4;uniforms.uParticleTime.value+=dt*particleSpeed*2.4;uniforms.uLineTime.value+=dt*lineSpeed*2.4;}
    const breathing=p.breathProgress??(.5+.5*Math.sin(uniforms.uTime.value*.55));
    uniforms.uBreath.value+=(breathing-uniforms.uBreath.value)*smoothingAlpha(dt,.35);
    const sleepTarget=Math.max(0,Math.min(1,p.sleepProgress??0));
    uniforms.uSleep.value=sleepTarget===0?0:THREE.MathUtils.lerp(uniforms.uSleep.value,sleepTarget,smoothingAlpha(dt,.1));
    const sleep=uniforms.uSleep.value;group.scale.setScalar(1-.88*sleep*sleep*(3-2*sleep));
    renderer.render(scene,camera);
   }raf=requestAnimationFrame(tick);
  };raf=requestAnimationFrame(tick);
  const lost=(e:Event)=>{e.preventDefault();cancelAnimationFrame(raf);setError(true);};renderer.domElement.addEventListener('webglcontextlost',lost);
  return()=>{cancelAnimationFrame(raf);observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',lost);for(const g of [solidGeo,particleGeo,lineGeo])g.dispose();for(const m of [solidMat,particleMat,lineMat])m.dispose();renderer.dispose();renderer.domElement.remove();};
 },[attempt]);
 const visual=resolveVisual(props.frame.visual);
 return <div ref={host} className="particle-canvas" role="img" aria-label={`柔性球、粒子与流线；${visual.mode} 模式，强度 ${Math.round(visual.intensity*100)}`}>{error&&<div className="webgl-fallback"><p>三维画面暂时不可用</p><span>状态数据和文字引导仍可使用。</span><button onClick={()=>setAttempt(n=>n+1)}>重试三维画面</button></div>}</div>;
}
