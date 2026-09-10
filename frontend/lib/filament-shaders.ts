export const filamentShape=`
uniform float uTime,uLineTime,uParticleTime,uIntensity,uNoise,uDeform,uFrequency,uTurbulence;
uniform float uBreath,uGuide,uPulse,uSleep,uVisibility,uSpread,uGlow,uHue,uLineActivity,uLineDensity,uLineBrightness;
uniform float uDensity,uParticleSize,uParticleBrightness,uPixelRatio;
uniform vec4 uModes;
uniform float uPulseMode;
vec3 livingPoint(vec3 n,float layer,float seed){
 if(layer>1.05){
  float freeMotion=sin(n.y*3.+uTime*.35+seed)*.015;
  float radius=layer+uGuide*uBreath*.19+(1.-uGuide)*freeMotion;
  return n*radius*(1.-uSleep*.25);
 }
 float wave=sin(n.y*(4.+uFrequency*7.)+n.x*2.-uTime*1.7);
 float crosswave=sin(n.x*6.+n.z*4.+uTime*1.2)*sin(n.y*3.-uTime*.7);
 float fine=sin(n.z*11.+n.y*5.-uTime*2.1);
 float motion=uModes.x*wave*.12+uModes.y*wave*.65+uModes.z*crosswave*.7+uModes.w*(wave*.65+fine*.24)+uPulseMode*wave*.22;
 float radius=layer*(1.+motion*uDeform*.20);
 float twist=.36*n.y+.12*sin(n.y*4.+uTime*.43)*uLineActivity+.11*crosswave*uNoise;
 float cs=cos(twist),sn=sin(twist);
 vec3 p=vec3(n.x*cs-n.y*sn,n.x*sn+n.y*cs,n.z)*radius;
 p.x+=sin(n.y*5.+uTime*.65)*.024*uTurbulence;
 p.y+=sin(n.z*4.-uTime*.48)*.02*uTurbulence;
 return p*(1.-uSleep*.4);
}
vec3 lightColor(vec3 n,float seed){
 vec3 blue=vec3(.38,.69,1.),peach=vec3(1.,.65,.43),lilac=vec3(.73,.60,.95),mint=vec3(.42,.77,.83);
 float warm=smoothstep(-.55,.65,n.x+n.y*.34+sin(n.y*3.)*.22);
 vec3 c=mix(blue,peach,warm);
 c=mix(c,lilac,exp(-pow((n.y+.6)*3.,2.))*.38);
 c=mix(c,mint,exp(-pow((n.x+.55)*5.,2.)-pow((n.y+.1)*3.,2.))*.35);
 c=mix(c,vec3(1.,.82,.56),pow(seed,8.)*.44);
 // Keep the selected blue/peach identity, while preserving the Agent's hue input.
 c+=vec3(.05,-.01,-.035)*sin((uHue-220.)*.0174533);
 return max(c,vec3(0.));
}
`;
export const filamentVertex=filamentShape+`
attribute float aSeed,aProgress,aLayer;
varying vec3 vColor;
varying float vAlpha;
void main(){
 vec3 p=livingPoint(position,aLayer,aSeed);
 vec4 mv=modelViewMatrix*vec4(p,1.);
 gl_Position=projectionMatrix*mv;
 vColor=lightColor(position,aSeed);
 float front=smoothstep(-.85,.8,p.z);
 float current=pow(.5+.5*sin(aProgress*17.-uLineTime*2.3+aSeed*18.),10.);
 float ends=smoothstep(0.,.08,aProgress)*(1.-smoothstep(.88,1.,aProgress));
 // The foundational filaments define the being. Optional accent density remains independent.
 float visible=aSeed<.55?1.:1.-smoothstep(uLineDensity*.45+.55-.015,uLineDensity*.45+.55+.015,aSeed);
 vAlpha=(.035+.15*front)*(.6+aSeed*.4)+current*(.10+.17*uIntensity)*front;
 vAlpha*=ends*visible*(.55+.6*uGlow)*(aSeed<.55?1.:uLineBrightness*1.8)*(1.-uSleep)*uVisibility;
 if(aLayer>1.05){vAlpha*=.40;vColor=mix(vColor,vec3(.7,.84,1.),.25);}
}
`;
export const filamentFragment=`
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main(){gl_FragColor=vec4(vColor,vAlpha);}
`;
export const moteVertex=filamentShape+`
attribute float aSeed,aLayer;
varying vec3 vColor;
varying float vAlpha;
void main(){
 float angle=uParticleTime*(.18+aSeed*.2);
 vec3 n=position;float cs=cos(angle),sn=sin(angle);n.xz=mat2(cs,-sn,sn,cs)*n.xz;
 float outer=aSeed>.87?1.+(aSeed-.87)*uSpread*2.4:aLayer;
 vec3 p=livingPoint(n,outer,aSeed);
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 gl_PointSize=(.9+uParticleSize*2.6)*(aSeed>.975?1.6:1.)*uPixelRatio*4.5/max(2.,-mv.z);
 vColor=lightColor(n,aSeed);
 vAlpha=(.12+.58*smoothstep(-.8,.8,p.z))*uParticleBrightness;
 vAlpha*=1.-smoothstep(uDensity-.015,uDensity+.015,fract(aSeed*13.7));
 if(uDensity<=0.)vAlpha=0.;
 vAlpha*=(.72+.28*sin(aSeed*60.+uParticleTime*.8))*(1.-uSleep)*uVisibility;
}
`;
export const moteFragment=`
precision highp float;
varying vec3 vColor;
varying float vAlpha;
void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float a=exp(-d*d*5.);gl_FragColor=vec4(mix(vColor,vec3(1.,.92,.78),a*.3),vAlpha*a);}
`;
export const coreVertex=`
varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
`;
export const coreFragment=`
precision highp float;
uniform float uGlow,uSleep,uBreath,uVisibility;
varying vec2 vUv;
void main(){vec2 p=vUv-.5;float d=length(p*vec2(1.,1.15));float a=exp(-d*d*28.)*.09+exp(-d*d*115.)*.19;a*=.6+uGlow*.8;gl_FragColor=vec4(1.,.66,.42,a*(1.-uSleep)*uVisibility);}
`;
