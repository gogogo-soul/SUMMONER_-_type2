import { DurableObject } from 'cloudflare:workers';
import {newRoom,joinSeat,startMatch,requestRematch,leaveFinishedRoom,validDeck,handleGameAction,finishChoice,viewFor,secureId} from './engine.mjs';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
function answer(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{...HEADERS,...extra}});}
function errorMsg(e){return typeof e?.message==='string'?e.message:'処理できませんでした';}
function allowed(request,env){const origin=request.headers.get('Origin');if(!origin)return true;const list=String(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);return list.includes(origin)||(/\blocalhost\b|127\.0\.0\.1/.test(origin)&&env.ALLOW_LOCAL==='true');}
function cors(request,env){const o=request.headers.get('Origin');return allowed(request,env)&&o?{'access-control-allow-origin':o,'vary':'Origin','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}:{}}
function validCode(code){return /^[A-Z0-9]{6}$/.test(code)}
function roomCode(){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';const raw=new Uint8Array(6);crypto.getRandomValues(raw);return [...raw].map(n=>alphabet[n%alphabet.length]).join('');}
function jsonBody(request){return request.json().then(x=>{if(!x||typeof x!=='object')throw Error('リクエスト形式が不正です');return x;})}
export default {
 async fetch(request,env){const url=new URL(request.url),path=url.pathname;const c=cors(request,env);
  if(request.method==='OPTIONS'){if(!allowed(request,env))return answer({error:'Origin not allowed'},403);return new Response(null,{status:204,headers:c});}
  if(!allowed(request,env))return answer({error:'許可されていないサイトからのアクセスです。ALLOWED_ORIGINSを設定してください。'},403);
  if(path==='/health')return answer({service:'SUMMONER Online Duel',status:'ok',version:'alpha2-v40-triggerfix-20261026',features:['rematch','leave_room','leave_http']},200,c);
  try {
    if(path==='/api/rooms'&&request.method==='POST'){
      const data=await jsonBody(request);const code=roomCode();const id=env.ROOMS.idFromName(code);const stub=env.ROOMS.get(id);
      const r=await stub.fetch('https://room.internal/create',{method:'POST',body:JSON.stringify({code,name:data.name})});
      return answer(await r.json(),r.status,c);
    }
    const match=path.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|socket|leave)$/);
    if(match){const [,code,op]=match;if(!validCode(code))throw Error('不正なルームコード');const stub=env.ROOMS.get(env.ROOMS.idFromName(code));
      if(op==='leave'&&request.method==='POST'){const d=await jsonBody(request);const r=await stub.fetch('https://room.internal/leave',{method:'POST',body:JSON.stringify(d)});return answer(await r.json(),r.status,c);}
      if(op==='join'&&request.method==='POST'){const data=await jsonBody(request);const r=await stub.fetch('https://room.internal/join',{method:'POST',body:JSON.stringify(data)});return answer(await r.json(),r.status,c);}
      if(op==='socket'&&request.headers.get('Upgrade')?.toLowerCase()==='websocket')return stub.fetch('https://room.internal/socket',{headers:{Upgrade:'websocket'}});
    }
    return answer({error:'ページがありません'},404,c);
  }catch(e){return answer({error:errorMsg(e)},400,c)}
 }
};
export class DuelRoom extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.serial=Promise.resolve();}
 async load(){if(!this.loaded){this.room=await this.ctx.storage.get('room')||null;this.loaded=true;}return this.room;}
 async save(){await this.ctx.storage.put('room',this.room)}
 async fetch(request){try{
   const url=new URL(request.url);const r=await this.load();
   if(url.pathname==='/create'&&request.method==='POST'){
    if(r)return answer({error:'ルームはすでに存在します'},409);
    const d=await request.json();if(typeof d.code!=='string'||!validCode(d.code))throw Error('不正なルームコード');const token=secureId('seat');this.room=joinSeat(newRoom(d.code),0,d.name,token);await this.save();return answer({code:d.code,seat:0,token});
   }
   if(url.pathname==='/join'&&request.method==='POST'){
    if(!r)throw Error('ルームがありません');if(r.game)throw Error('対戦が始まっているため途中参加できません');if(Date.now()-r.createdAt>24*3600*1000)throw Error('ルームの有効期限が過ぎています');
    const d=await request.json();if(r.players[1].token)throw Error('定員2名に達しています');const token=secureId('seat');joinSeat(r,1,d.name,token);await this.save();this.pushAll();return answer({code:r.code,seat:1,token});
   }
   if(url.pathname==='/leave'&&request.method==='POST'){
    if(!r)throw Error('ルームがありません');
    const d=await request.json();if(typeof d.token!=='string'||!d.token)throw Error('退出の認証情報が必要です');
    const seat=r.players.findIndex(x=>x.token===d.token&&!!x.token);
    if(seat<0)throw Error('ルームの接続情報が無効です');
    leaveFinishedRoom(r,seat);
    await this.save();this.pushAll();
    // WebSocket connections belonging to this player can no longer receive state.
    return answer({ok:true,room:r.code});
   }
   if(url.pathname==='/socket'&&request.headers.get('Upgrade')?.toLowerCase()==='websocket'){
    if(!r)return answer({error:'ルームがありません'},404);
    const pair=new WebSocketPair();const [client,server]=Object.values(pair);this.ctx.acceptWebSocket(server);server.serializeAttachment({seat:-1,authenticated:false,at:0,n:0});return new Response(null,{status:101,webSocket:client});
   }
   return answer({error:'無効な操作です'},404);
  }catch(e){return answer({error:errorMsg(e)},400);}}
 send(socket,data){try{socket.send(JSON.stringify(data))}catch(_){}}
 pushAll(){if(!this.room)return;for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment();if(a?.authenticated&&[0,1].includes(a.seat)&&a.token===this.room.players[a.seat].token){this.send(ws,{type:'state',data:viewFor(this.room,a.seat)});}}}
 async onMessage(ws,raw){const room=await this.load();if(!room){ws.close(1008,'Room unavailable');return;}if(typeof raw!=='string'||raw.length>150000){ws.close(1009,'Too long');return;}
   const now=Date.now(),auth=ws.deserializeAttachment()||{seat:-1,authenticated:false,at:0,n:0};if(now-auth.at>1000){auth.at=now;auth.n=0;}if(++auth.n>20){this.send(ws,{type:'error',error:'操作が多すぎます'});ws.serializeAttachment(auth);return;}ws.serializeAttachment(auth);
   const msg=JSON.parse(raw);if(!msg||typeof msg!=='object')throw Error('不正なメッセージ');
   if(!auth.authenticated){if(msg.type!=='auth'||typeof msg.token!=='string')throw Error('認証が必要です');const seat=room.players.findIndex(p=>p.token===msg.token&&!!p.token);if(seat<0){ws.close(1008,'Unauthorized');return;}ws.serializeAttachment({...auth,seat,token:msg.token,authenticated:true});this.send(ws,{type:'state',data:viewFor(room,seat)});return;}
   const seat=auth.seat;if(room.players[seat].token===''||room.players[seat].token!==auth.token)throw Error('認証が無効になりました。再接続してください。');
   let leftRoom=false;
   if(msg.type==='select_deck'){if(room.game)throw Error('対戦中のデッキ変更はできません');const names=msg.deck;const err=validDeck(names);if(err)throw Error(err);room.players[seat].deckNames=names;room.players[seat].ready=false;}
   else if(msg.type==='ready'){if(room.game)throw Error('対戦中です');if(!room.players[seat].deckNames)throw Error('デッキを選択してください');room.players[seat].ready=!!msg.ready;if(room.players.every(p=>p.ready&&p.deckNames))startMatch(room);}
   else if(msg.type==='action'){if(!room.game)throw Error('対戦開始前です');const next=structuredClone(room.game);handleGameAction(next,seat,msg.action||{});room.game=next;}
   else if(msg.type==='choose'){if(!room.game)throw Error('対戦開始前です');const next=structuredClone(room.game);finishChoice(next,seat,msg.ids||[]);room.game=next;}
   else if(msg.type==='surrender'){if(!room.game||room.game.over)throw Error('対戦中ではありません');room.game.over=true;room.game.winner=1-seat;room.game.log.push(`PLAYER ${seat+1}が降参`);}
   else if(msg.type==='rematch'){requestRematch(room,seat,msg.accept===true);}
   else if(msg.type==='leave_room'){leaveFinishedRoom(room,seat);leftRoom=true;}
   else if(msg.type!=='sync')throw Error('不正な命令');
   await this.save();if(leftRoom){this.send(ws,{type:'left_room'});ws.serializeAttachment({...auth,authenticated:false});}this.pushAll();
 }
 webSocketMessage(ws,raw){this.serial=this.serial.catch(()=>{}).then(()=>this.onMessage(ws,raw)).catch(e=>{this.send(ws,{type:'error',error:errorMsg(e)});});return this.serial;}
 webSocketClose(ws){try{ws.close()}catch(_){}}
 webSocketError(ws){try{ws.close()}catch(_){}}
}
