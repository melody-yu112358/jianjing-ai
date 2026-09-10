'use client';
import {useEffect,useRef} from 'react';

// Quiet, deterministic star field. Separate from Agent-controlled foreground particles.
export function StarBackdrop(props:{playing:boolean;gentle:boolean;sleepProgress:number}){
 const host=useRef<HTMLCanvasElement>(null),latest=useRef(props);latest.current=props;
 useEffect(()=>{
  const canvas=host.current;if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
  let width=1,height=1,ratio=1,raf=0,last=performance.now(),time=0;
  let seed=5917;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  const stars=Array.from({length:240},()=>({x:random(),y:random(),depth:random(),phase:random()*Math.PI*2,radius:.35+random()*.65,alpha:.15+random()*.42}));
  const resize=()=>{width=window.innerWidth;height=window.innerHeight;ratio=Math.min(devicePixelRatio,1.5);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);};
  const draw=(now:number)=>{
   const dt=Math.min(.05,(now-last)/1000);last=now;const p=latest.current;
   if(!document.hidden){
    if(p.playing&&!p.gentle)time+=dt;
    ctx.clearRect(0,0,width,height);
    const density=Math.min(stars.length,Math.round(width*height/6500));
    for(let i=0;i<density;i++){
     const star=stars[i],drift=time*(.22+star.depth*.5);
     const x=(star.x*width+drift*.28)%width,y=(star.y*height-drift+height*100)%height;
     const quiet=1-p.sleepProgress*.82;
     ctx.globalAlpha=star.alpha*(p.gentle?1:.93+.07*Math.sin(time*.32+star.phase))*quiet;
     ctx.fillStyle=star.depth>.8?'#dbe8ff':'#eaf0ff';
     ctx.beginPath();ctx.arc(x,y,star.radius,0,Math.PI*2);ctx.fill();
     if(star.depth>.94){ctx.globalAlpha*=.1;ctx.beginPath();ctx.arc(x,y,star.radius*3,0,Math.PI*2);ctx.fill();}
    }
   }
   raf=requestAnimationFrame(draw);
  };
  resize();window.addEventListener('resize',resize);raf=requestAnimationFrame(draw);
  return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',resize);};
 },[]);
 return <canvas ref={host} className="star-backdrop" aria-hidden="true"/>;
}
