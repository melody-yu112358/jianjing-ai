export const landscapeVertex = `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}
`;

// Continuous color fields: no texture downloads, model surfaces, or hard mode cuts.
export const landscapeFragment = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime,uLineTime,uParticleTime,uIntensity,uNoise,uDeform,uFrequency,uTurbulence;
uniform float uGlow,uBreath,uPulse,uSleep,uDensity,uSpread,uParticleSize,uParticleBrightness;
uniform float uLineDensity,uLineActivity,uLineBrightness,uHue;
uniform float uWeights[5];
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float glow(vec2 p,vec2 c,float k){return exp(-length(p-c)*k);}
vec3 sky(vec2 p){
 vec3 c=mix(vec3(.62,.77,.87),vec3(.84,.89,.89),smoothstep(.15,1.,p.y));
 float bend=sin(p.x*3.8+uTime*.18)*.016*uDeform;
 float edge=max(abs(p.x-.64)*.78,abs(p.y+.06)*1.15)+bend;
 c=mix(c,vec3(.42,.58,.76),exp(-pow((edge-.47)*45.,2.))*.55);
 c=mix(c,vec3(.60,.77,.71),exp(-pow((edge-.435)*30.,2.))*.45);
 c=mix(c,vec3(.98,.72,.55),exp(-pow((edge-.345)*9.,2.))*.80*(1.-smoothstep(.51,.68,p.y)));
 c+=vec3(1.,.87,.48)*glow(p,vec2(.63,.485),27.)*(.3+uGlow*.3);
 c=mix(c,vec3(1.,.985,.87),glow(p,vec2(.63,.485),220.)*.95);
 return c;
}
vec3 aurora(vec2 p){
 vec3 c=vec3(.14,.115,.16);
 float fan=(p.x-.56)/(p.y+.22);
 float wave=fan+sin(p.y*6.-uTime*.22)*(.14+.25*uDeform)+sin(p.y*13.+uTime*.16)*.035*uNoise;
 float ribbons=sin(wave*10.+sin(p.y*4.+uTime*.1)*1.1);
 float fine=pow(.5+.5*sin(wave*(90.+uFrequency*95.)+uLineTime*.32),7.);
 vec3 bands=.54+.28*cos(vec3(2.5,1.2,.2)+wave*4.3+p.y*.9);
 bands=mix(bands,vec3(.27,.68,.65),smoothstep(-.4,.6,ribbons)*.4);
 float light=exp(-pow(wave*.95,2.))*.65+exp(-pow((wave+.72)*3.,2.))*.28;
 c=mix(c,bands,clamp(light*(.65+.35*ribbons),0.,1.));
 c+=bands*fine*.13*uLineDensity*uLineBrightness;
 c+=vec3(.54,.63,.38)*glow(p,vec2(.56,.24),10.)*(.7+uGlow);
 c+=vec3(.87,.94,.76)*glow(p,vec2(.56,.24),140.)*.7;
 return c;
}
vec3 sunfield(vec2 p){
 vec3 c=mix(vec3(.62,.73,.84),vec3(.73,.82,.88),p.y);
 float horizon=.225+sin(p.x*3.+uTime*.12)*.005*uDeform;
 float ground=1.-smoothstep(horizon-.006,horizon+.006,p.y);
 vec3 g=mix(vec3(.84,.61,.68),vec3(.94,.77,.75),p.y*3.);
 float speck=noise(p*vec2(450.,190.));g+=(speck-.5)*.12;
 c=mix(c,g,ground);
 vec2 q=(p-vec2(.59,.62))*vec2(uResolution.x/uResolution.y,1.);
 float d=length(q);float disc=1.-smoothstep(.069,.08,d);
 c=mix(c,vec3(.91,.43,.43),disc*.9);
 c=mix(c,vec3(.73,.77,.85),exp(-pow((p.y-.588)*180.,2.))*disc*.55);
 c+=vec3(.7,.33,.22)*exp(-d*19.)*.08;
 return c;
}
vec3 temple(vec2 p){
 vec2 q=p-vec2(.59,.58);q.x*=1.05;
 float d=max(abs(q.x),abs(q.y)*.73);
 d+=sin(p.y*8.+uTime*.14)*.006*uDeform;
 vec3 c=mix(vec3(.98,.76,.35),vec3(.67,.57,.72),smoothstep(.07,.58,d));
 float band=.5+.5*sin(d*80.+sin(p.y*5.)*.7+uTime*.07);
 c=mix(c,vec3(.93,.56,.49),band*.23*smoothstep(.16,.23,d));
 c+=vec3(.24,.15,.01)*exp(-d*7.);
 c+=vec3(.8,.65,.2)*glow(p,vec2(.59,.44),55.)*(.4+uGlow*.4);
 c=mix(c,vec3(1.,1.,.79),glow(p,vec2(.59,.44),260.));
 c+=vec3(.6,.48,.13)*glow(p,vec2(.59,.70),110.)*.65;
 return c;
}
vec3 rose(vec2 p){
 vec2 q=p-vec2(.61,.55);q.x*=uResolution.x/uResolution.y;
 float a=atan(q.y,q.x),r=length(q);
 float rad=.235+sin(a*3.+uTime*.11)*.012+sin(a*5.-uTime*.08)*(.005+.012*uDeform);
 rad+=(uBreath-.5)*.013*uPulse;
 float edge=abs(r-rad);
 vec3 c=mix(vec3(.65,.45,.44),vec3(.84,.62,.63),exp(-r*2.));
 c=mix(c,vec3(.98,.77,.58),(1.-smoothstep(rad-.025,rad+.025,r))*.63);
 c=mix(c,vec3(.88,.58,.63),smoothstep(.24,.29,r)*(1.-smoothstep(.3,.47,r))*.5);
 c+=vec3(.26,.25,.22)*exp(-edge*45.)*(.6+uGlow*.5);
 c+=vec3(.25,.25,.24)*exp(-edge*220.);
 c+=vec3(.36,.35,.33)*glow(p,vec2(.60,.81),20.);
 c=mix(c,vec3(1.,.96,.89),glow(p,vec2(.61,.58),240.)*.9);
 return c;
}
void main(){
 vec2 p=vUv;
 p.x+=sin(p.y*7.+uTime*.18)*.008*uNoise;
 p.y+=sin(p.x*8.-uTime*.12)*.006*uTurbulence;
 vec3 c=sky(p)*uWeights[0]+aurora(p)*uWeights[1]+sunfield(p)*uWeights[2]+temple(p)*uWeights[3]+rose(p)*uWeights[4];
 // Fine flowing filaments stay within a broad, coherent current.
 float stream=p.x+sin(p.y*5.+uLineTime*.08)*(.04+.05*uLineActivity);
 float threads=pow(.5+.5*sin(stream*(180.+uFrequency*150.)+p.y*12.),24.);
 c+=vec3(.82,.87,.76)*threads*.023*uLineDensity*uLineBrightness*(.2+uIntensity);
 vec2 sp=p*vec2(21.,15.);sp.y+=uParticleTime*.035;sp.x+=sin(sp.y*.7+uParticleTime*.06)*.15*uSpread;
 vec2 cell=floor(sp),local=fract(sp)-.5;float seed=hash(cell);
 float star=exp(-length(local)*(100.-uParticleSize*50.));
 float twinkle=.65+.35*sin(uParticleTime*.35+seed*40.);
 c+=vec3(1.,.98,.87)*star*step(1.-uDensity*.16,seed)*twinkle*uParticleBrightness*1.5;
 c+=vec3(.015,0.,-.013)*sin(uHue*6.28318);
 // Spatial grain is stationary: no frame-to-frame flicker.
 c+=(hash(gl_FragCoord.xy)-.5)*.027;
 c=mix(c,vec3(.075,.072,.12),smoothstep(0.,1.,uSleep)*.985);
 gl_FragColor=vec4(clamp(c,0.,1.),1.);
}
`;
