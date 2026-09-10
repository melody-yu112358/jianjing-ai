import { z } from 'zod';
import {visualSchema} from './visual-controls.ts';
const unit=z.number().finite().min(0).max(1);
export const frameSchema=z.object({timestamp:z.number().finite().positive(),signals:z.object({heart_rate:z.number().finite().positive(),resp_rate:z.number().finite().positive()}),state:z.object({arousal:unit,stability:unit,trend:z.enum(['down','flat','up'])}),ritual:z.object({stage:z.enum(['assess','guided_breathing','settling','switch_method','fade_out','end']),inhale_sec:z.number().finite().nonnegative(),exhale_sec:z.number().finite().nonnegative()}),visual:visualSchema,message:z.string()});
export type Frame=z.infer<typeof frameSchema>;
export function parseFrame(data:string):Frame{return frameSchema.parse(JSON.parse(data));}
export function smoothingAlpha(dt:number,tau=3){return 1-Math.exp(-Math.max(0,Math.min(dt,.1))/tau);}
export function demoFrame(t:number,manual?:number):Frame{
 const p=Math.min(1,Math.max(0,t/52)),a=manual??(.82-.64*(p*p*(3-2*p))),stability=.22+.7*(1-a);
 const end=manual===undefined&&t>=60,fade=manual===undefined&&t>52;
 const intensity=end?0:(.2+.65*a)*(fade?Math.max(0,(60-t)/8):1),guided=!end&&!fade&&(manual===undefined?t<32:a>.45);
 return {timestamp:Date.now()/1000,signals:{heart_rate:68+a*23,resp_rate:9+a*9},state:{arousal:a,stability,trend:manual!==undefined||t===0?'flat':'down'},ritual:{stage:end?'end':fade?'fade_out':guided?'guided_breathing':'settling',inhale_sec:guided?4:0,exhale_sec:guided?6:0},visual:{intensity,noise:(1-stability)*intensity,speed:(.2+.8*a)*intensity},message:end?'不必急着做什么，留一点安静给自己。':guided?'不用刻意用力，让呼气稍微长一点。':'放下节拍，按舒服的节奏自然呼吸。'};
}
