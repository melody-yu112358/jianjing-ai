/** Deterministic streamlines on a unit sphere, shared by the GPU line and mote layers. */
export type Vec3=[number,number,number];
const normal=(v:Vec3):Vec3=>{const r=Math.hypot(...v)||1;return [v[0]/r,v[1]/r,v[2]/r];};
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const axis=normal([.2,.8,.35]),vortexA=normal([.62,.55,.8]),vortexB=normal([-.6,-.42,.8]);
function flow(n:Vec3):Vec3{
 const a=cross(axis,n),b=cross(vortexA,n),c=cross(vortexB,n);
 const w1=2.8*Math.exp((dot(n,vortexA)-1)*2.7),w2=2.4*Math.exp((dot(n,vortexB)-1)*2.7);
 return normal([a[0]*.24+b[0]*w1-c[0]*w2,a[1]*.24+b[1]*w1-c[1]*w2,a[2]*.24+b[2]*w1-c[2]*w2]);
}
export function seeded(i:number){const n=Math.sin(i*127.1+311.7)*43758.5453123;return n-Math.floor(n);}
export function buildFilaments(strands=480,steps=168){
 const count=strands*steps*2,position=new Float32Array(count*3),seed=new Float32Array(count),progress=new Float32Array(count),layer=new Float32Array(count);
 let at=0;
 for(let i=0;i<strands;i++){
  // Neighbouring strands travel as ribbons, with space between the bundles.
  const bundle=Math.floor(i/8),groups=Math.ceil(strands/8),offset=(i%8-3.5)*.008;
  const sy=1-2*(bundle+.5)/groups,theta=bundle*2.3999632297+offset,rr=Math.sqrt(1-sy*sy);
  let n=normal([rr*Math.cos(theta)+offset,sy+offset*.6,rr*Math.sin(theta)]);
  const depth=.66+.32*seeded(bundle+9)+offset*.15,s=seeded(i+173),step=.012+.006*seeded(bundle+361);
  for(let j=0;j<steps;j++){
   const f=flow(n),mid=normal([n[0]+f[0]*step*.5,n[1]+f[1]*step*.5,n[2]+f[2]*step*.5]),fm=flow(mid);
   const next=normal([n[0]+fm[0]*step,n[1]+fm[1]*step,n[2]+fm[2]*step]);
   for(const [v,p] of [[n,j/steps],[next,(j+1)/steps]] as [Vec3,number][]){position.set(v,at*3);seed[at]=s;progress[at]=p;layer[at]=depth;at++;}
   n=next;
  }
 }
 return {position,seed,progress,layer,count};
}

/** Separate, lighter shell. Its radius is animated by the guidance phase. */
export function buildOuterFilaments(strands=144,steps=128){
 const count=strands*steps*2,position=new Float32Array(count*3),seed=new Float32Array(count),progress=new Float32Array(count),layer=new Float32Array(count);
 let at=0;
 for(let i=0;i<strands;i++){
  const s=seeded(i+1103),axis=normal([Math.cos(i*2.399)*.65,Math.sin(i*2.399)*.65,.75]);
  const u=normal(cross(axis,[0,1,0])),v=cross(axis,u),latitude=(seeded(Math.floor(i/4)+83)-.5)*.95;
  const start=s*Math.PI*2,length=Math.PI*(1.1+seeded(i+91)*.75);
  for(let j=0;j<steps;j++)for(const k of [j,j+1]){
   const p=k/steps,a=start+p*length;
   const n=normal([u[0]*Math.cos(a)+v[0]*Math.sin(a)+axis[0]*latitude,u[1]*Math.cos(a)+v[1]*Math.sin(a)+axis[1]*latitude,u[2]*Math.cos(a)+v[2]*Math.sin(a)+axis[2]*latitude]);
   position.set(n,at*3);seed[at]=s;progress[at]=p;layer[at]=1.12+seeded(i+72)*.035;at++;
  }
 }
 return {position,seed,progress,layer,count};
}
