import type {VisualMode} from './visual-controls.ts';
export const MODE_ORDER:VisualMode[]=['serenity','ripple','fold','storm','pulse'];
// Retarget from the currently displayed mixture. Repeated Agent snapshots do not restart it.
export class ModeTransition {
 weights:number[];private from:number[];private target:VisualMode;private elapsed=0;private duration=0;
 constructor(mode:VisualMode){this.target=mode;this.weights=MODE_ORDER.map(m=>m===mode?1:0);this.from=[...this.weights];}
 setTarget(mode:VisualMode,seconds:number){
  if(mode===this.target)return;
  this.from=[...this.weights];this.target=mode;this.elapsed=0;this.duration=Math.max(.1,seconds);
 }
 advance(dt:number){
  this.elapsed=Math.min(this.duration,this.elapsed+Math.max(0,dt));
  const x=this.duration===0?1:this.elapsed/this.duration;
  const ease=Math.max(0,Math.min(1,x*x*x*(x*(x*6-15)+10)));
  this.weights=this.from.map((v,i)=>v+((MODE_ORDER[i]===this.target?1:0)-v)*ease);
  return this.weights;
 }
}
