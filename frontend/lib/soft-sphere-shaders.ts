// Original bounded parametric deformation, shared by the solid, particles and line layers.
export const surfaceGLSL=`
uniform float uTime,uIntensity,uNoise,uDeform,uFrequency,uTurbulence,uSpread,uGlow,uPulse,uBreath;
uniform vec4 uModes;
uniform float uPulseMode;
vec3 surface(vec3 n){
 // Travelling wavefronts preserve the spherical body. No domain warp or tangential twist.
 float f=mix(8.0,29.0,uFrequency);
 vec3 d1=normalize(vec3(.8,.5,.3)),d2=normalize(vec3(-.4,.8,.5)),d3=normalize(vec3(.3,-.4,.85));
 float p1=dot(n,d1)*f-uTime*1.25;
 float p2=dot(n,d2)*f*.83+uTime*.95;
 float p3=dot(n,d3)*f*1.17-uTime*.72;
 float calm=(sin(p1*.55)*.65+sin(p2*.48)*.35)*.025;
 // Circular wavefronts measured by chord distance: smooth even at the source and antipode.
 float circular=(1.0-dot(n,normalize(vec3(.25,.7,.66))))*f;
 float ripple=(sin(circular-uTime*1.15)*.78+sin(circular*1.45-uTime*.85)*.22)*.13;
 float crossing=(sin(p1)*.58+sin(p2)*.42)*.17;
 float crest1=sin(p1),crest2=sin(p2),crest3=sin(p3);
 float storm=(crest1*.52+crest2*.30+crest3*.18)*.20;
 // Turbulence/noise enrich coherent crossing waves instead of producing random lumps.
 storm+=sin(p2*.72-uTime*.25)*sin(p3*.68)*uTurbulence*.025;
 float pulse=(sin(circular*.55-uTime*.6)*.7+sin(p1*.6)*.3)*.07;
 float displacement=dot(vec4(calm,ripple,crossing,storm),uModes)+pulse*uPulseMode;
 displacement+=sin(p3*.9+uTime*.15)*uNoise*.012;
 float amplitude=uDeform*(.25+.75*uIntensity);
 vec3 p=n*(1.48+displacement*amplitude);
 // A very small whole-body breath, never a large pumping motion.
 p*=1.0+(uBreath-.5)*uPulse*.035;
 return p;
}

`;
// Smooth normals follow the actual displaced surface, including its tangential folds.
export const meshVertex=surfaceGLSL+`
varying vec3 vView,vDirection,vNormal;
void main(){
 vec3 n=normalize(position),p=surface(n);
 vec3 axis=abs(n.y)>.95?vec3(1.0,0.0,0.0):vec3(0.0,1.0,0.0);
 vec3 T=normalize(cross(axis,n)),B=cross(n,T);
 vec3 dp=surface(normalize(n+T*.002))-surface(normalize(n-T*.002));
 vec3 dq=surface(normalize(n+B*.002))-surface(normalize(n-B*.002));
 vNormal=normalize(normalMatrix*normalize(cross(dp,dq)));
 vec4 mv=modelViewMatrix*vec4(p,1.0);vView=mv.xyz;vDirection=n;gl_Position=projectionMatrix*mv;
}`;
// Clear water: neutral reflection, sparse white glints and a transparent core.
// Procedural lighting and alpha transmission; no physical background refraction.
export const meshFragment=`
uniform vec3 uColor;uniform float uGlow,uIntensity,uSleep,uTime,uNoise;varying vec3 vView,vDirection,vNormal;
void main(){
 vec3 V=normalize(-vView),baseNormal=normalize(vNormal);
 vec3 detail=vec3(sin(vDirection.y*23.0+vDirection.z*9.0-uTime*.34),cos(vDirection.z*19.0+vDirection.x*8.0+uTime*.27),sin(vDirection.x*21.0-vDirection.y*7.0-uTime*.22));
 vec3 N=normalize(baseNormal+(detail-baseNormal*dot(detail,baseNormal))*(.009+.018*uNoise));
 float facing=clamp(dot(N,V),0.0,1.0);
 float fresnel=.02+.98*pow(1.0-facing,4.5);
 vec3 R=reflect(-V,N),L=normalize(vec3(-.65,.95,1.5));
 float sky=smoothstep(-.35,.85,R.y);
 vec3 reflected=mix(vec3(.12,.15,.21),vec3(.70,.78,.90),sky);
 float softbox=pow(max(dot(R,normalize(vec3(-.45,.75,1.1))),0.0),32.0);
 reflected+=vec3(.91,.95,1.0)*softbox*.60;
 float glint=pow(max(dot(N,normalize(L+V)),0.0),100.0);
 float broad=pow(max(dot(N,normalize(L+V)),0.0),20.0);
 vec3 tint=mix(vec3(.84,.90,1.0),uColor,.18);
 vec3 color=mix(tint*.25,reflected,.32+.64*fresnel);
 color+=vec3(.92,.96,1.0)*(glint*.58+broad*.11);
 color+=tint*pow(1.0-facing,3.5)*(.08+uGlow*.14);
 // Center transmits the dark star field; grazing angles describe a thin water boundary.
 float opacity=clamp(.14+fresnel*.48+glint*.22+broad*.07,.14,.8);
 opacity*=smoothstep(0.0,.09,uIntensity)*(1.0-smoothstep(.4,1.0,uSleep));
 gl_FragColor=vec4(color,opacity);
}`;
export const particleVertex=surfaceGLSL+`
uniform float uPixelRatio,uDensity,uSleep,uParticleTime,uParticleSize,uParticleBrightness;attribute float aSeed;varying float vAlpha;varying vec3 vTint;
uniform vec3 uColor;
void main(){
 float orbit=uParticleTime*(.12+aSeed*.22);
 vec3 n=normalize(position);n.xz=mat2(cos(orbit),-sin(orbit),sin(orbit),cos(orbit))*n.xz;
 float drift=sin(uParticleTime*(.25+aSeed*.4)+aSeed*70.0);
 vec3 p=surface(n)*(1.08+uSpread*(.16+aSeed*.85));
 p+=vec3(sin(aSeed*57.0+uParticleTime*.6),cos(aSeed*41.0+uParticleTime*.47),drift)*uTurbulence*uSpread*.23;
 vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;
 gl_PointSize=clamp(mix(1.2,7.0,uParticleSize)*(.65+aSeed*.65)*uPixelRatio*4.0/-mv.z,1.0,9.0);
 vAlpha=(1.0-smoothstep(uDensity-.025,uDensity+.025,aSeed))*step(.001,uDensity)*(.40+aSeed*.45)*uParticleBrightness*1.2*smoothstep(0.0,.1,uIntensity)*(1.0-smoothstep(.3,1.0,uSleep));
 vTint=mix(uColor,vec3(.90,.95,1.0),.65+aSeed*.25);
}`;
export const particleFragment=`varying float vAlpha;varying vec3 vTint;void main(){float r=length(gl_PointCoord-.5);if(r>.5)discard;gl_FragColor=vec4(vTint,vAlpha*(1.0-smoothstep(.04,.5,r)));}`;
export const lineVertex=surfaceGLSL+`
uniform float uLineDensity,uLineActivity,uSleep,uLineTime,uLineBrightness;uniform vec3 uColor;attribute float aSeed;attribute float aProgress;varying float vAlpha;
void main(){
 vec3 n=normalize(position);vec3 p=surface(n)*(1.045+uSpread*(.08+aSeed*.48));
 p+=vec3(n.z,0.0,-n.x)*sin(aProgress*8.0-uLineTime*.8+aSeed*20.0)*uLineActivity*uTurbulence*.12;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
 float flow=.3+.7*pow(.5+.5*sin(aProgress*11.0-uLineTime*(.3+uLineActivity*3.0)+aSeed*30.0),3.0);
 vAlpha=(1.0-smoothstep(uLineDensity-.02,uLineDensity+.02,aSeed))*step(.001,uLineDensity)*(.22+uGlow*.3)*uLineBrightness*1.25*mix(.65,flow,uLineActivity)*smoothstep(0.0,.1,uIntensity)*(1.0-smoothstep(.3,1.0,uSleep));
}`;
export const lineFragment=`uniform vec3 uColor;varying float vAlpha;void main(){gl_FragColor=vec4(mix(uColor,vec3(.85,.96,1.0),.5),vAlpha);}`;
