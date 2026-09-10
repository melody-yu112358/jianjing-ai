import { z } from 'zod';
const unit=z.number().finite().min(0).max(1);
export const visualSchema=z.object({
 intensity:unit,noise:unit,speed:unit,
 mode:z.enum(['serenity','ripple','fold','storm','pulse']).optional(),
 deformation:unit.optional(),frequency:unit.optional(),turbulence:unit.optional(),
 particle_density:unit.optional(),particle_spread:unit.optional(),
 particle_speed:unit.optional(),particle_size:unit.optional(),particle_brightness:unit.optional(),
 line_density:unit.optional(),line_activity:unit.optional(),line_speed:unit.optional(),line_brightness:unit.optional(),
 glow:unit.optional(),pulse:unit.optional(),hue:z.number().finite().min(0).max(360).optional(),
 transition_sec:z.number().finite().min(.1).max(15).optional(),
});
export type VisualInput=z.infer<typeof visualSchema>;
export type ResolvedVisual=Required<VisualInput>;
export type VisualMode=ResolvedVisual['mode'];
export const MODE_LABELS:Record<VisualMode,string>={serenity:'静澜 · Serenity',ripple:'涟漪 · Ripple',fold:'叠浪 · Crosswave',storm:'浪涌 · Surge',pulse:'呼吸波 · Pulse'};
const calmEffects={particle_speed:.12,particle_size:.35,particle_brightness:.55,line_speed:.10,line_brightness:.45};
export const PRESETS:Record<VisualMode,ResolvedVisual>={
 serenity:{...calmEffects,mode:'serenity',intensity:.25,noise:.06,speed:.09,deformation:.16,frequency:.18,turbulence:.03,particle_density:.18,particle_spread:.12,line_density:.2,line_activity:.08,glow:.42,pulse:.32,hue:210,transition_sec:4.8},
 ripple:{...calmEffects,mode:'ripple',particle_speed:.25,line_speed:.3,intensity:.52,noise:.24,speed:.32,deformation:.56,frequency:.46,turbulence:.16,particle_density:.38,particle_spread:.3,line_density:.48,line_activity:.38,glow:.55,pulse:.24,hue:218,transition_sec:4.2},
 fold:{...calmEffects,mode:'fold',particle_speed:.35,line_speed:.4,intensity:.7,noise:.5,speed:.38,deformation:.7,frequency:.54,turbulence:.32,particle_density:.28,particle_spread:.2,line_density:.6,line_activity:.4,glow:.38,pulse:.16,hue:242,transition_sec:4.2},
 storm:{...calmEffects,mode:'storm',particle_speed:.62,particle_size:.40,particle_brightness:.75,line_speed:.7,line_brightness:.7,intensity:.95,noise:.94,speed:.9,deformation:.9,frequency:.68,turbulence:.65,particle_density:.9,particle_spread:.85,line_density:.88,line_activity:.94,glow:.75,pulse:.45,hue:228,transition_sec:3.8},
 pulse:{...calmEffects,mode:'pulse',intensity:.5,noise:.1,speed:.2,deformation:.5,frequency:.26,turbulence:.08,particle_density:.34,particle_spread:.28,line_density:.35,line_activity:.25,glow:.62,pulse:.95,hue:232,transition_sec:4.8},
};
export const ADVANCED_CONTROLS=[
 ['deformation','波浪高度'],['frequency','波纹疏密'],['turbulence','交叠程度'],
 ['glow','边缘辉光'],['pulse','呼吸脉动'],
] as const;
export const EFFECT_CONTROLS=[
 ['particle_density','粒子密度'],['particle_spread','粒子扩散'],['particle_speed','粒子流速'],['particle_size','粒子大小'],['particle_brightness','粒子亮度'],
 ['line_density','流线密度'],['line_activity','流线起伏'],['line_speed','流线速度'],['line_brightness','流线亮度'],
] as const;
export function resolveVisual(v:VisualInput):ResolvedVisual{
 // Legacy inputs retain independent intensity/noise/speed controls; no physiology is inferred.
 const mode=v.mode??(v.noise>.45?'storm':v.noise>.23?'fold':v.intensity>.38?'ripple':'serenity');
 return {...PRESETS[mode],...v,mode,
  deformation:v.deformation??v.intensity,frequency:v.frequency??(.16+.7*v.noise),turbulence:v.turbulence??v.noise,
  particle_density:v.particle_density??(.12+.75*v.intensity),particle_spread:v.particle_spread??v.noise,
  line_density:v.line_density??(.12+.65*v.intensity),line_activity:v.line_activity??v.speed,
 };
}
