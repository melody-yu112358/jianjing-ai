export const DEMO_TRACKS = [
  {id:'sea',name:'海浪',url:'/audio/baltic-sea.mp3'},
] as const;

export function demoAudioGain(elapsed:number,volume:number,muted:boolean) {
  if(muted || elapsed>=40 || elapsed<0)return 0;
  const fadeIn=Math.min(1,elapsed/2);
  const fadeOut=elapsed<=34?1:Math.max(0,(40-elapsed)/6);
  return Math.min(1,Math.max(0,volume))*fadeIn*fadeOut;
}

type Media = Pick<HTMLAudioElement,'src'|'loop'|'preload'|'volume'|'currentTime'|'duration'|'paused'|'play'|'pause'|'load'>;
type AudioStatus = 'ready'|'playing'|'paused'|'error';

/** One media element per session; no network request is needed after local assets load. */
export class DemoAudio {
  private media:Media;
  private revision=0;
  private wanted=false;
  private pending=false;
  private blocked=false;
  private selected=-1;
  private status:(value:AudioStatus)=>void;
  constructor(create:()=>Media,status:(value:AudioStatus)=>void=()=>{}) {
    this.status=status;this.media=create();this.media.loop=true;this.media.preload='auto';this.media.volume=0;
  }
  get track(){return this.selected<0?null:DEMO_TRACKS[this.selected];}
  /** Call directly from a user gesture so browsers can authorize playback. */
  start(fresh=false) {
    if(fresh || this.selected<0){
      this.stop();this.selected=0;this.media.src=DEMO_TRACKS[0].url;
      this.media.volume=0;this.media.load();this.status('ready');
    }
    this.blocked=false;this.wanted=true;this.play();
  }
  private play() {
    if(this.pending||this.blocked||!this.wanted||!this.media.paused)return;
    const rev=this.revision;this.pending=true;
    void this.media.play().then(()=>{
      if(rev!==this.revision)return;
      this.pending=false;if(!this.wanted)this.media.pause();else this.status('playing');
    }).catch(()=>{
      if(rev!==this.revision)return;
      this.pending=false;this.blocked=true;this.status('error');
    });
  }
  update(running:boolean,elapsed:number,volume:number,muted:boolean) {
    if(!running || elapsed>=40){this.stop();return;}
    if(this.selected<0)return; // Never authorize sound through an effect alone.
    this.wanted=true;
    this.media.volume=demoAudioGain(elapsed,volume,muted);
    const duration=this.media.duration;
    if(Number.isFinite(duration)&&duration>0){
      const target=elapsed%duration;
      if(Math.abs(this.media.currentTime-target)>.75)this.media.currentTime=target;
    }
    this.play();
  }
  stop(){
    if(!this.wanted&&!this.pending&&this.media.paused)return;
    this.wanted=false;this.pending=false;this.revision++;this.media.pause();this.media.volume=0;this.status('paused');
  }
  dispose(){this.stop();this.media.src='';this.media.load();}
}
