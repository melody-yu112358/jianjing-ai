/** Deterministic streamlines on a unit sphere, shared by the GPU line and mote layers. */
export type Vec3=[number,number,number];
const normal=(v:Vec3):Vec3=>{const r=Math.hypot(...v)||1;return [v[0]/r,v[1]/r,v[2]/r];};
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const axis=normal([.3,1,.2]),vortexA=normal([.65,.3,.65]),vortexB=normal([-.7,-.35,.55]);
function flow(n:Vec3):Vec3{
 const a=cross(axis,n),b=cross(vortexA,n),c=cross(vortexB,n);
 const w1=1.65*Math.exp((dot(n,vortexA)-1)*3.5),w2=1.35*Math.exp((dot(n,vortexB)-1)*3.);
 return normal([a[0]*.65+b[0]*w1-c[0]*w2,a[1]*.65+b[1]*w1-c[1]*w2,a[2]*.65+b[2]*w1-c[2]*w2]);
}
export function seeded(i:number){const n=Math.sin(i*127.1+311.7)*43758.5453123;return n-Math.floor(n);}
export function buildFilaments(strands=480,steps=168){
 const count=strands*steps*2,position=new Float32Array(count*3),seed=new Float32Array(count),progress=new Float32Array(count),layer=new Float32Array(count);
 let at=0;
 for(let i=0;i<strands;i++){
  const sy=1-2*(i+.5)/strands,theta=i*2.3999632297,rr=Math.sqrt(1-sy*sy);
  let n:Vec3=[rr*Math.cos(theta),sy,rr*Math.sin(theta)];
  const depth=.83+.18*seeded(i+9),s=seeded(i+173),step=.028+.014*seeded(i+361);
  for(let j=0;j<steps;j++){
   const f=flow(n),mid=normal([n[0]+f[0]*step*.5,n[1]+f[1]*step*.5,n[2]+f[2]*step*.5]),fm=flow(mid);
   const next=normal([n[0]+fm[0]*step,n[1]+fm[1]*step,n[2]+fm[2]*step]);
   for(const [v,p] of [[n,j/steps],[next,(j+1)/steps]] as [Vec3,number][]){position.set(v,at*3);seed[at]=s;progress[at]=p;layer[at]=depth;at++;}
   n=next;
  }
 }
 return {position,seed,progress,layer,count};
}
