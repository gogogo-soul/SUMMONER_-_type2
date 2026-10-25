import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {DB} from '../src/cards-data.mjs';

const workerFile=new URL('../src/worker.mjs',import.meta.url),simFile=new URL('../src/_simulated_worker.mjs',import.meta.url);
const patched=readFileSync(workerFile,'utf8').replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }');
writeFileSync(simFile,patched);
const {DuelRoom}=await import(simFile.href);
unlinkSync(simFile);
class FakeWS {constructor(){this.state={};this.messages=[];}serializeAttachment(x){this.state=x}deserializeAttachment(){return this.state;}send(x){this.messages.push(JSON.parse(x))}close(){} }
class Storage {constructor(){this.kv=new Map()}async get(k){return this.kv.get(k)}async put(k,v){this.kv.set(k,structuredClone(v));}}
function fakeContext(){return {storage:new Storage(),sockets:[],getWebSockets(){return this.sockets}};}
const pickDeck=()=>{const ctx={DB,window:{},atob};vm.runInNewContext(readFileSync(new URL('../../starter-decks.js',import.meta.url),'utf8'),ctx);return Object.entries(ctx.window.SUMMONER_STARTER_DECKS[0].counts).flatMap(([name,n])=>Array(n).fill(name));};
const call=(room,ws,msg)=>room.webSocketMessage(ws,JSON.stringify(msg));
test('Two separate authenticated sockets receive distinct private game views',async()=>{
 const ctx=fakeContext(),room=new DuelRoom(ctx,{});
 const create=await room.fetch(new Request('https://room.internal/create',{method:'POST',body:JSON.stringify({code:'A23456789BC2',name:'Host'})}));assert.equal(create.status,200);const {token:hostToken}=await create.json();
 const join=await room.fetch(new Request('https://room.internal/join',{method:'POST',body:JSON.stringify({name:'Guest'})}));assert.equal(join.status,200);const {token:guestToken}=await join.json();
 const host=new FakeWS(),guest=new FakeWS();ctx.sockets.push(host,guest);
 await call(room,host,{type:'auth',token:hostToken});await call(room,guest,{type:'auth',token:guestToken});assert.equal(host.messages.at(-1).data.seat,0);assert.equal(guest.messages.at(-1).data.seat,1);
 const deck=pickDeck();await call(room,host,{type:'select_deck',deck});await call(room,guest,{type:'select_deck',deck});await call(room,host,{type:'ready',ready:true});await call(room,guest,{type:'ready',ready:true});
 const hostView=host.messages.at(-1).data,guestView=guest.messages.at(-1).data;assert.ok(hostView.game&&guestView.game);
 assert.equal(hostView.game.players[0].hand.length,7);assert.equal(hostView.game.players[1].hand,undefined);
 assert.equal(guestView.game.players[1].hand.length,7);assert.equal(guestView.game.players[0].hand,undefined);
 assert.equal(hostView.game.players[1].handCount,7);assert.equal(guestView.game.players[0].handCount,7);
 const rawHost=JSON.stringify(hostView);assert.equal(rawHost.includes(guestToken),false);
 const rawGuest=JSON.stringify(guestView);assert.equal(rawGuest.includes(hostToken),false);
 // Simulate the host winning first-play coin toss for deterministic remainder of the socket test
 room.room.game.turn=0;room.room.game.priority=0;
 await call(room,host,{type:'action',action:{type:'end_turn'}});
 const update=guest.messages.at(-1).data;assert.equal(update.game.turn,1);assert.equal(update.game.opponentDrawPending,0);assert.equal(update.game.drawPending,1);
 await call(room,guest,{type:'action',action:{type:'draw'}});
 assert.equal(host.messages.at(-1).data.game.players[1].handCount,8);
 assert.equal(host.messages.at(-1).data.game.players[1].hand,undefined);
});
test('Invalid token is rejected and state not published',async()=>{const ctx=fakeContext(),room=new DuelRoom(ctx,{});await room.fetch(new Request('https://room.internal/create',{method:'POST',body:JSON.stringify({code:'B23456789BC2',name:'Host'})}));const hacker=new FakeWS();ctx.sockets.push(hacker);await call(room,hacker,{type:'auth',token:'not-a-real-token'});assert.equal(hacker.messages.length,0);});

test('Post-match rematch needs both authenticated users; exiting notifies and revokes old token',async()=>{
 const ctx=fakeContext(),room=new DuelRoom(ctx,{});
 const create=await room.fetch(new Request('https://room.internal/create',{method:'POST',body:JSON.stringify({code:'D23456789BC2',name:'Host'})}));
 const {token:hostToken}=await create.json();
 const join=await room.fetch(new Request('https://room.internal/join',{method:'POST',body:JSON.stringify({name:'Guest'})}));
 const {token:guestToken}=await join.json();
 const host=new FakeWS(),guest=new FakeWS();ctx.sockets.push(host,guest);
 await call(room,host,{type:'auth',token:hostToken});await call(room,guest,{type:'auth',token:guestToken});
 const deck=pickDeck();for(const w of [host,guest])await call(room,w,{type:'select_deck',deck});
 for(const w of [host,guest])await call(room,w,{type:'ready',ready:true});
 const oldId=room.room.game.matchId;
 await call(room,host,{type:'surrender'});
 assert.equal(host.messages.at(-1).data.game.over,true);
 await call(room,host,{type:'rematch',accept:true});
 assert.equal(room.room.game.matchId,oldId);
 assert.deepEqual(guest.messages.at(-1).data.rematch.accepted,[true,false]);
 await call(room,guest,{type:'rematch',accept:true});
 assert.equal(room.room.game.matchId,oldId+1);
 assert.equal(host.messages.at(-1).data.game.over,false);
 assert.equal(host.messages.at(-1).data.game.players[1].hand,undefined);
 assert.equal(guest.messages.at(-1).data.game.players[0].hand,undefined);
 // Another round: leave while opponent is waiting for a rematch.
 await call(room,guest,{type:'surrender'});
 await call(room,host,{type:'rematch',accept:true});
 await call(room,guest,{type:'leave_room'});
 assert.equal(guest.messages.at(-1).type,'left_room');
 assert.equal(host.messages.at(-1).data.rematch.closed,true);
 assert.equal(host.messages.at(-1).data.rematch.leftSeat,1);
 assert.equal(room.room.players[1].token,'');
 await call(room,host,{type:'rematch',accept:true});
 assert.match(host.messages.at(-1).error,/退室/);
 const oldGuestMessageCount=guest.messages.length;
 room.pushAll();assert.equal(guest.messages.length,oldGuestMessageCount);
 const newSocket=new FakeWS();ctx.sockets.push(newSocket);await call(room,newSocket,{type:'auth',token:guestToken});
 assert.equal(newSocket.messages.length,0);
});

test('v35 REST leave returns to lobby without depending on WebSocket acknowledgement',async()=>{
 const ctx=fakeContext(),room=new DuelRoom(ctx,{});
 const make=await room.fetch(new Request('https://room.internal/create',{method:'POST',body:JSON.stringify({code:'E23456789BC2',name:'Host'})}));
 const hostToken=(await make.json()).token;
 const joined=await room.fetch(new Request('https://room.internal/join',{method:'POST',body:JSON.stringify({name:'Guest'})}));
 const guestToken=(await joined.json()).token;
 const host=new FakeWS(),guest=new FakeWS();ctx.sockets.push(host,guest);
 await call(room,host,{type:'auth',token:hostToken});await call(room,guest,{type:'auth',token:guestToken});
 const deck=pickDeck();for(const w of [host,guest])await call(room,w,{type:'select_deck',deck});
 for(const w of [host,guest])await call(room,w,{type:'ready',ready:true});
 const before=await room.fetch(new Request('https://room.internal/leave',{method:'POST',body:JSON.stringify({token:hostToken})}));
 assert.equal(before.status,400,'Cannot leave mid-game by finished-game path');
 await call(room,host,{type:'surrender'});
 const bad=await room.fetch(new Request('https://room.internal/leave',{method:'POST',body:JSON.stringify({token:'wrong-token'})}));
 assert.equal(bad.status,400);
 const exited=await room.fetch(new Request('https://room.internal/leave',{method:'POST',body:JSON.stringify({token:guestToken})}));
 assert.equal(exited.status,200);
 assert.equal((await exited.json()).ok,true);
 assert.equal(host.messages.at(-1).data.rematch.closed,true);
 assert.equal(room.room.players[1].token,'');
 const reattempt=await room.fetch(new Request('https://room.internal/leave',{method:'POST',body:JSON.stringify({token:guestToken})}));
 assert.equal(reattempt.status,400);
});
