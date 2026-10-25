// Small Socket.IO-compatible client facade backed by the Netlify Function endpoint.
// Polling keeps multiplayer state server-authoritative without a continuously running server.
type Handler=(payload:any)=>void;
export type Socket = { on:(event:string,handler:Handler)=>Socket; emit:(event:string,payload?:any)=>void; removeAllListeners:()=>void; disconnect:()=>void };
type Session = {roomCode:string;playerId:string;sessionToken:string};
function getSession():Session|null { try {const raw=sessionStorage.getItem('bqa-session')||localStorage.getItem('bqa-session');return raw?JSON.parse(raw):null;}catch{return null;} }
export function io(_url?:string,_options?:unknown):Socket {
 const handlers=new Map<string,Set<Handler>>();let active=true;let timer:number|undefined;let polling=false;
 const on=(event:string,handler:Handler)=>{if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event)!.add(handler);return socket;};
 const fire=(event:string,payload?:any)=>{for(const handler of handlers.get(event)||[])handler(payload);};
 async function request(action:string,payload:any={}){if(!active)return;const session=getSession();const body={...payload,action,sessionToken:payload.sessionToken||session?.sessionToken,code:payload.code||session?.roomCode};try{const response=await fetch('/.netlify/functions/game',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});const data=await response.json();if(data.error){fire('game-error',{message:data.error});return;}for(const [event,value] of data.events||[])fire(event,value);}catch{fire('disconnect');}}
 async function poll(){if(!active||polling)return;const session=getSession();if(!session){timer=window.setTimeout(poll,1000);return;}polling=true;await request('poll',{code:session.roomCode,sessionToken:session.sessionToken});polling=false;if(active)timer=window.setTimeout(poll,900);}
 const socket:Socket={on,emit:(event,payload={})=>{void request(event,payload);},removeAllListeners:()=>handlers.clear(),disconnect:()=>{active=false;if(timer)window.clearTimeout(timer);handlers.clear();}};
 queueMicrotask(()=>{fire('connect');fire('connected',{serverNow:Date.now()});void poll();});return socket;
}
