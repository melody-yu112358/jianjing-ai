import { z } from 'zod';
import { frameSchema, type Frame } from './state.ts';

export type ControlFrame = Omit<Frame, 'signals' | 'state'> & Partial<Pick<Frame, 'signals' | 'state'>>;
export const sleepEventSchema=z.object({id:z.string().min(1).max(128),type:z.literal('sleep_detected'),timestamp:z.number().finite().positive(),simulated:z.boolean()}).strict();
export type SleepEvent=z.infer<typeof sleepEventSchema>;
export const agentControlSchema = z.object({
  type: z.literal('agent.control'),
  version: z.literal('2.0'),
  session_id: z.string().min(1).max(128),
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  timestamp: z.number().finite().positive(), // Unix seconds, same unit as v1
  data_source: z.enum(['simulated', 'sensor', 'mixed', 'unknown']),
  payload: z.object({
    visual: frameSchema.shape.visual.strict(),
    guidance: z.object({
      text: z.string().max(4000),
      stage: frameSchema.shape.ritual.shape.stage,
      inhale_sec: z.number().finite().min(0).max(60),
      exhale_sec: z.number().finite().min(0).max(60),
    }).strict().superRefine((g, ctx) => {
      if ((g.inhale_sec === 0) !== (g.exhale_sec === 0)) ctx.addIssue({code: 'custom', message: 'Breathing durations must both be zero or both positive'});
      if (g.stage !== 'guided_breathing' && (g.inhale_sec !== 0 || g.exhale_sec !== 0)) ctx.addIssue({code: 'custom', message: 'Timed breathing only applies in guided_breathing'});
    }),
    events: z.array(sleepEventSchema).max(8).optional(),
    signals: frameSchema.shape.signals.optional(),
    state: frameSchema.shape.state.optional(),
  }).strict(),
}).strict().superRefine((p, ctx) => {
  if (p.payload.guidance.stage === 'end' && ['intensity','noise','speed'].some(k => p.payload.visual[k as 'intensity'|'noise'|'speed'] !== 0)) ctx.addIssue({code:'custom', message:'end requires zero visual controls'});
});
export type AgentControl = z.infer<typeof agentControlSchema>;
export interface DecodedControl {frame:ControlFrame; protocol:'1.0'|'2.0'; sessionId?:string; seq?:number; dataSource:string; events?:SleepEvent[];}
export function decodeControl(text:string):DecodedControl {
  if (text.length > 65536 || new TextEncoder().encode(text).length > 65536) throw new Error('Message exceeds 64 KiB limit');
  const raw:unknown=JSON.parse(text);
  if (raw && typeof raw==='object' && 'type' in raw) {
    const p=agentControlSchema.parse(raw);
    return {protocol:'2.0',sessionId:p.session_id,seq:p.seq,dataSource:p.data_source,events:p.payload.events,frame:{timestamp:p.timestamp,visual:p.payload.visual,message:p.payload.guidance.text,ritual:{stage:p.payload.guidance.stage,inhale_sec:p.payload.guidance.inhale_sec,exhale_sec:p.payload.guidance.exhale_sec},...(p.payload.signals?{signals:p.payload.signals}:{}),...(p.payload.state?{state:p.payload.state}:{})}};
  }
  return {protocol:'1.0',dataSource:'unknown',frame:frameSchema.parse(raw)};
}
// A connection uses one protocol. Old sessions and duplicate/out-of-order updates cannot take control.
export class ControlOrder {
  private protocol?:string;
  private session?:string;
  private seq=-1;
  private timestamp=0;
  private retired=new Set<string>();
  accept(p:DecodedControl):{accepted:boolean;reset:boolean} {
    if(this.protocol && this.protocol!==p.protocol)return {accepted:false,reset:false};
    if(p.protocol==='1.0'){
      if(p.frame.timestamp<=this.timestamp)return {accepted:false,reset:false};
      const reset=!this.protocol;this.protocol=p.protocol;this.timestamp=p.frame.timestamp;return {accepted:true,reset};
    }
    const id=p.sessionId!;
    if(this.retired.has(id))return {accepted:false,reset:false};
    const reset=id!==this.session;
    if(!reset && p.seq!<=this.seq)return {accepted:false,reset:false};
    if(reset && this.session){if(this.retired.size>=64)return {accepted:false,reset:false};this.retired.add(this.session);}
    this.protocol=p.protocol;this.session=id;this.seq=p.seq!;return {accepted:true,reset};
  }
}
export function effectiveFrame(frame:ControlFrame, manual:Frame['visual']|null):ControlFrame {
  // An Agent end always wins, even while a manual visual override is active.
  return !manual||frame.ritual.stage==='end'?frame:{...frame,visual:manual};
}
