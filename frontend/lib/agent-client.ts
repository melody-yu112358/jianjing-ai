import {ControlOrder,decodeControl,type DecodedControl} from './agent-protocol.ts';
export type ConnectionStatus='idle'|'connecting'|'waiting'|'live'|'stale'|'reconnecting'|'failed';
export interface AgentSocket {
  onopen:((event:unknown)=>void)|null;onmessage:((event:{data:unknown})=>void)|null;
  onclose:((event:unknown)=>void)|null;onerror:((event:unknown)=>void)|null;
  close():void;
}
export interface ConnectionSnapshot {status:ConnectionStatus;retry:number;received:number;rejected:number;lastReceivedAt:number|null;error:string|null;}
interface Options {
  createSocket?:(url:string)=>AgentSocket;
  staleAfterMs?:number;connectTimeoutMs?:number;retryDelaysMs?:number[];maxFrameAgeMs?:number;maxFutureSkewMs?:number;
  onState:(state:ConnectionSnapshot)=>void;
  onFrame:(packet:DecodedControl,reset:boolean)=>void;
}
export function validateEndpoint(endpoint:string,pageProtocol:string):string {
  const u=new URL(endpoint);
  if(!['ws:','wss:'].includes(u.protocol)||u.username||u.password||u.hash)throw Error('请输入不含账号密码或片段的 WebSocket 地址');
  if(pageProtocol==='https:'&&u.protocol!=='wss:')throw Error('HTTPS 页面需要 wss:// 安全连接');
  return u.href;
}
export class AgentClient {
  private options:Options;
  private socket:AgentSocket|null=null;
  private generation=0;
  private stopped=true;
  private url='';
  private order=new ControlOrder();
  private connectionTimer:ReturnType<typeof setTimeout>|undefined;
  private staleTimer:ReturnType<typeof setTimeout>|undefined;
  private retryTimer:ReturnType<typeof setTimeout>|undefined;
  private snapshot:ConnectionSnapshot={status:'idle',retry:0,received:0,rejected:0,lastReceivedAt:null,error:null};
  constructor(options:Options){this.options=options;}
  private emit(patch:Partial<ConnectionSnapshot>){this.snapshot={...this.snapshot,...patch};this.options.onState({...this.snapshot});}
  private clearTimers(){clearTimeout(this.connectionTimer);clearTimeout(this.staleTimer);clearTimeout(this.retryTimer);}
  connect(endpoint:string,pageProtocol='https:'){
    const url=validateEndpoint(endpoint,pageProtocol); // Invalid input leaves current connection intact.
    this.disconnect();this.url=url;this.order=new ControlOrder();this.stopped=false;
    this.snapshot={status:'connecting',retry:0,received:0,rejected:0,lastReceivedAt:null,error:null};this.open();
  }
  disconnect(){this.stopped=true;this.generation++;this.clearTimers();this.socket?.close();this.socket=null;this.emit({status:'idle',error:null});}
  private open(){
    if(this.stopped)return;
    const generation=++this.generation;let socket:AgentSocket;
    const current=()=>!this.stopped&&generation===this.generation;
    this.emit({status:this.snapshot.retry?'reconnecting':'connecting'});
    const retry=()=>{
      if(!current())return;this.generation++;this.clearTimers();socket?.close();this.socket=null;
      const delays=this.options.retryDelaysMs??[1000,2000,4000,8000,10000];
      const delay=delays[this.snapshot.retry];
      if(delay===undefined){this.emit({status:'failed',error:'重连未成功，请检查服务后点击重新连接'});return;}
      this.emit({status:'reconnecting',retry:this.snapshot.retry+1});this.retryTimer=setTimeout(()=>this.open(),delay);
    };
    try{socket=(this.options.createSocket??(url=>new WebSocket(url) as unknown as AgentSocket))(this.url);this.socket=socket;}
    catch{this.emit({error:'无法建立连接'});retry();return;}
    this.connectionTimer=setTimeout(()=>{if(current()){this.emit({error:'未收到有效控制消息'});retry();}},this.options.connectTimeoutMs??10000);
    socket.onopen=()=>{if(current())this.emit({status:'waiting'});};
    socket.onmessage=event=>{
      if(!current())return;
      let packet:DecodedControl,reset:boolean;
      try{
        if(typeof event.data!=='string')throw Error('需要 UTF-8 JSON 文本');
        packet=decodeControl(event.data);const age=Date.now()-packet.frame.timestamp*1000;
        if(age>(this.options.maxFrameAgeMs??15000)||age<-(this.options.maxFutureSkewMs??5000))throw Error('控制消息时间戳过期或时钟不同步');
        const decision=this.order.accept(packet);
        if(!decision.accepted)throw Error('重复、乱序、旧会话或不匹配的协议');reset=decision.reset;
      }catch(error){this.emit({rejected:this.snapshot.rejected+1,error:error instanceof Error?error.message:'控制消息无效'});return;}
      clearTimeout(this.connectionTimer);clearTimeout(this.staleTimer);
      this.emit({status:'live',retry:0,received:this.snapshot.received+1,lastReceivedAt:Date.now(),error:null});
      this.options.onFrame(packet,reset);
      this.staleTimer=setTimeout(()=>{if(current()){this.emit({status:'stale',error:'控制参数超过有效等待时间'});retry();}},this.options.staleAfterMs??5000);
    };
    socket.onerror=()=>{if(current()){this.emit({error:'连接发生错误'});retry();}};
    socket.onclose=()=>{if(current())retry();};
  }
}
