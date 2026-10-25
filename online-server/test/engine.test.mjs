import test from 'node:test';
import assert from 'node:assert/strict';
import {DB,newRoom,joinSeat,validDeck,startMatch,viewFor,handleGameAction,finishChoice,supportReport} from '../src/engine.mjs';
const r=(side=0)=>{const room=newRoom('A23456789BC2'); const names=Object.keys(DB);const summ=names.find(n=>DB[n].t==='summoner');const land=names.find(n=>DB[n].t==='land');for(const i of [0,1]){joinSeat(room,i,'P'+i,'TOKEN'+i);room.players[i].deckNames=[...Array(50).fill(land),summ];room.players[i].ready=true;} startMatch(room);room.game.turn=0;room.game.priority=0;return room;};
const piece=(name,i=0)=>({id:'inst_'+name+'_'+i,name,owner:i,tapped:false,spent:false,faceDown:false,summonSick:false,mod:0,spMod:0,mods:[],burst:false,haste:false,unblockable:false,indestructible:0});
const at=(room,side,action)=>handleGameAction(room.game,side,action);
test('Opening seat is picked by server randomness, both seats occur',()=>{const counts=[0,0];for(let i=0;i<45;i++){const room=r();const {firstSeat}=room.game;assert.ok(firstSeat===0||firstSeat===1);counts[firstSeat]++;assert.equal(viewFor(room,0).game.firstSeat,firstSeat);}assert.ok(counts[0]&&counts[1]);});
test('All existing card effect keys are registered for online engine',()=>{assert.deepEqual(supportReport(),[])});
test('Server validates 50+1, illegal duplicates, summoner seat',()=>{const s=Object.keys(DB).find(n=>DB[n].t==='summoner');const l=Object.keys(DB).find(n=>DB[n].t==='land');assert.equal(validDeck([...Array(50).fill(l),s]),null);assert.ok(validDeck([...Array(49).fill(l),s]));assert.ok(validDeck([...Array(51).fill(l),s]));const c=Object.keys(DB).find(n=>DB[n].t==='monster');assert.ok(validDeck([...Array(50).fill(c),s]));});
test('Opponents only receive hand count, never hidden cards or deck list',()=>{const room=r();const first=room.game.players[0].hand[0].name;const view=viewFor(room,1);assert.equal(view.game.players[0].hand,undefined);assert.equal(view.game.players[0].deck,undefined);assert.equal(view.game.players[0].handCount,7);assert.equal(view.players[0].deckName,undefined);assert.equal(JSON.stringify(view).includes('TOKEN0'),false);assert.equal(view.game.players[1].hand.length,7);const own=viewFor(room,0);assert.equal(own.game.players[0].hand[0].name,first);});
test('Server shuffles and keeps draw private; only active side can draw',()=>{const room=r(),g=room.game;assert.equal(g.drawPending,0);at(room,0,{type:'end_turn'});assert.equal(g.turn,1);assert.equal(g.drawPending,1);assert.throws(()=>at(room,0,{type:'draw'}));const before=g.players[1].hand.length;at(room,1,{type:'draw'});assert.equal(g.players[1].hand.length,before+1);assert.equal(viewFor(room,0).game.players[1].hand,undefined);});
test('Land placement once, tap, untap unused, mana spent locked',()=>{const room=r(),g=room.game;const c=g.players[0].hand[0];at(room,0,{type:'land',card:c.id});assert.equal(g.players[0].lands.length,1);assert.equal(g.players[0].lands[0].faceDown,false);assert.throws(()=>at(room,0,{type:'land',card:g.players[0].hand[0].id}));at(room,0,{type:'tap_land',card:c.id});assert.equal(g.players[0].mana.length,1);at(room,0,{type:'untap_land',card:c.id});assert.equal(g.players[0].mana.length,0);});
test('Battle equal power destroys both and higher power survives',()=>{const room=r(),g=room.game;const a=piece('陽炎のジン',0),b=piece('斥候ゴブリン',1);g.players[0].field=[a];g.players[1].field=[b];b.tapped=true;at(room,0,{type:'phase',to:'BATTLE'});at(room,0,{type:'attack',card:a.id,target:b.id});at(room,1,{type:'block'});assert.equal(g.players[0].field.length,0);assert.equal(g.players[1].field.length,0);});
test('Direct attack auto resolves without NO BLOCK if defender has no monsters',()=>{const room=r(),g=room.game;const a=piece('アックス・ソルジャー',0);g.players[0].field.push(a);at(room,0,{type:'phase',to:'BATTLE'});at(room,0,{type:'attack',card:a.id});assert.equal(g.block,null);assert.equal(g.players[1].lp,17);assert.equal(viewFor(room,1).game.lifeEvents.at(-1).amount,-3);assert.equal(viewFor(room,1).game.lifeEvents.at(-1).kind,'damage');});
test('NO BLOCK remains available if opponent has monsters',()=>{const room=r(),g=room.game;const a=piece('アックス・ソルジャー',0);g.players[0].field.push(a);g.players[1].field.push(piece('陽炎のジン',1));at(room,0,{type:'phase',to:'BATTLE'});at(room,0,{type:'attack',card:a.id});assert.ok(g.block);at(room,1,{type:'block'});assert.equal(g.players[1].lp,17);});
test('Targetless spell is rejected before spending mana',()=>{const room=r(),g=room.game;const spell=piece('墓荒らし',0);g.players[0].hand.push(spell);g.players[0].mana=[{color:'black',src:null},{color:'blue',src:null}];assert.throws(()=>at(room,0,{type:'play',card:spell.id}),/対象/);assert.ok(g.players[0].hand.includes(spell));assert.equal(g.players[0].mana.length,2);});
test('Counterable card enters server stack, two passes resolve',()=>{const room=r(),g=room.game;const a=piece('陽炎のジン',0);g.players[0].hand.push(a);g.players[0].mana=[{color:'red',src:null}];at(room,0,{type:'play',card:a.id});assert.equal(g.stack.length,1);assert.equal(g.priority,1);at(room,1,{type:'pass'});at(room,0,{type:'pass'});assert.equal(g.stack.length,0);assert.equal(g.players[0].field.some(c=>c.id===a.id),true);});
test('Block bonus +2000 considered only in comparison',()=>{const room=r(),g=room.game;const a=piece('陽炎のジン',0),b=piece('ボウガンスタチュー',1);b.mods.push({type:'power',amount:2000,blockOnly:true,until:9});g.players[0].field=[a];g.players[1].field=[b];at(room,0,{type:'phase',to:'BATTLE'});at(room,0,{type:'attack',card:a.id});at(room,1,{type:'block',card:b.id});assert.equal(g.players[0].field.length,0);assert.equal(g.players[1].field.length,1);assert.equal(viewFor(room,0).game.players[1].field[0].power,3000);});
test('Hidden face-down land shows original identity only to owner',()=>{const room=r(),g=room.game;const c=piece('陽炎のジン');c.faceDown=true;g.players[0].lands.push(c);const a=viewFor(room,0).game.players[0].lands.at(-1);const b=viewFor(room,1).game.players[0].lands.at(-1);assert.equal(a.privateName,'陽炎のジン');assert.equal(b.privateName,undefined);assert.equal(b.name,'裏向き流脈');});
test('Ownership check stops malicious opponent move',()=>{const room=r(),g=room.game;const c=g.players[0].hand[0];assert.throws(()=>at(room,1,{type:'land',card:c.id}));});
test('Seven bundled decks are all valid 50 + summoner 1',async()=>{const {readFileSync}=await import('node:fs');const vm=await import('node:vm');const contents=readFileSync(new URL('../../starter-decks.js',import.meta.url),'utf8');const ctx={window:{},atob,DB};vm.runInNewContext(contents,ctx);assert.equal(ctx.window.SUMMONER_STARTER_DECKS.length,7);for(const s of ctx.window.SUMMONER_STARTER_DECKS){const deck=Object.entries(s.counts).flatMap(([n,x])=>Array(x).fill(n));assert.equal(validDeck(deck),null,s.name);}});
test('No valid spell may be cast targeting an opponent hidden hand without permission',()=>{const room=r(),g=room.game;const c=piece('墓荒らし',0);g.players[0].hand.push(c);g.players[0].mana=[{color:'black',src:null},{color:'black',src:null}];const secretId=g.players[1].hand[0].id;assert.throws(()=>at(room,0,{type:'play',card:c.id,target:secretId}),/対象/);});
test('Opponent action cannot move attack targets when not the active player',()=>{const room=r(),g=room.game;g.players[1].field.push(piece('陽炎のジン',1));assert.throws(()=>at(room,1,{type:'attack',card:g.players[1].field[0].id}));});
test('Choice from hidden deck only visible to selecting player',()=>{const room=r(),g=room.game;g.choice={seat:0,type:'searchLand',options:g.players[0].deck.slice(0,2).map(x=>({id:x.id,name:x.name})),min:1,max:1};assert.equal(viewFor(room,1).game.choice.options,undefined);assert.equal(viewFor(room,0).game.choice.options.length,2);});
test('Draw-two spell waits for two separate DRAW commands, with progress and hidden hands',()=>{
 const room=r(),g=room.game;const [name,def]=Object.entries(DB).find(([,d])=>d.effectKey==='draw2');
 const card=piece(name,0);g.players[0].hand.push(card);g.players[0].mana=Array.from({length:def.c},()=>({color:def.color,src:null}));
 const startHand=g.players[0].hand.length;
 at(room,0,{type:'play',card:card.id});at(room,1,{type:'pass'});at(room,0,{type:'pass'});
 assert.equal(g.players[0].hand.length,startHand-1);
 assert.equal(g.pendingEffectDraw.remaining,2);
 assert.equal(viewFor(room,1).game.players[0].hand,undefined);
 assert.equal(viewFor(room,0).game.effectDraw.remaining,2);
 assert.throws(()=>at(room,0,{type:'end_turn'}),/ドロー/);
 assert.throws(()=>at(room,1,{type:'draw'}),/相手/);
 at(room,0,{type:'draw'});assert.equal(g.pendingEffectDraw.remaining,1);
 at(room,0,{type:'draw'});assert.equal(g.pendingEffectDraw,null);
 assert.equal(g.players[0].hand.length,startHand+1);
 assert.equal(viewFor(room,1).game.players[0].hand,undefined);
});
test('Omni-Mind waits for five DRAW commands and then chooses four for deck bottom',()=>{
 const room=r(),g=room.game;const [name,def]=Object.entries(DB).find(([,d])=>d.effectKey==='draw5Bottom4');
 const card=piece(name,0);g.players[0].hand.push(card);g.players[0].mana=Array.from({length:def.c},()=>({color:def.color,src:null}));
 at(room,0,{type:'play',card:card.id});at(room,1,{type:'pass'});at(room,0,{type:'pass'});
 assert.equal(g.pendingEffectDraw.remaining,5);
 for(let i=4;i>=0;i--){at(room,0,{type:'draw'});if(i)assert.equal(g.pendingEffectDraw.remaining,i);}
 assert.equal(g.pendingEffectDraw,null);assert.equal(g.choice?.type,'bottom4');
 const chosen=g.choice.options.slice(0,4).map(c=>c.id);
 finishChoice(g,0,chosen);assert.equal(g.choice,null);
 assert.equal(viewFor(room,1).game.players[0].hand,undefined);
});
test('Bounce-power-three only returns opponent monsters, not the caster own monster',()=>{
 const room=r(),g=room.game;const [name,def]=Object.entries(DB).find(([,d])=>d.effectKey==='bounceHp3');
 const own=piece('陽炎のジン',0),opponent=piece('陽炎のジン',1);
 g.players[0].field.push(own);g.players[1].field.push(opponent);
 const card=piece(name,0);g.players[0].hand.push(card);g.players[0].mana=Array.from({length:def.c},()=>({color:def.color,src:null}));
 at(room,0,{type:'play',card:card.id});at(room,1,{type:'pass'});at(room,0,{type:'pass'});
 assert.ok(g.players[0].field.some(x=>x.id===own.id));
 assert.equal(g.players[1].field.some(x=>x.id===opponent.id),false);
});
test('Sacrifice-on-attack uses the chosen own land, not an arbitrary land',()=>{
 const room=r(),g=room.game,attacker=piece('ボウガンスタチュー',0);g.players[0].field=[attacker];
 const a=piece('赤の流脈',0),b=piece('青の流脈',0);a.tapped=false;b.tapped=false;g.players[0].lands=[a,b];
 at(room,0,{type:'phase',to:'BATTLE'});
 assert.throws(()=>at(room,0,{type:'attack',card:attacker.id}),/選択/);
 at(room,0,{type:'attack',card:attacker.id,sacrificeLand:b.id});
 assert.deepEqual(g.players[0].lands.map(x=>x.id),[a.id]);
 assert.ok(g.players[0].grave.some(x=>x.id===b.id));
});
test('Offline and online card databases keep exactly the same 125 card definitions',async()=>{
 const vm=await import('node:vm');const fs=await import('node:fs');const src=fs.readFileSync(new URL('../../cards.js',import.meta.url),'utf8');
 const context={window:{}};vm.runInNewContext(src+'\nwindow.__sourceDB=DB;',context);
 assert.equal(Object.keys(context.window.__sourceDB).length,125);
 assert.deepEqual(JSON.parse(JSON.stringify(context.window.__sourceDB)),JSON.parse(JSON.stringify(DB)));
});

test('Rematch requires both players after a finished game and fully resets the game', async()=>{
 const {requestRematch,leaveFinishedRoom}=await import('../src/engine.mjs');
 const room=r();const original=room.game;const originalId=original.matchId;
 assert.throws(()=>requestRematch(room,0),/試合終了後/);
 original.players[0].lp=1;original.players[0].hand.splice(0,3);
 original.over=true;original.winner=1;
 assert.equal(requestRematch(room,0,true),false);
 assert.equal(room.game,original);
 assert.deepEqual(viewFor(room,0).rematch.accepted,[true,false]);
 assert.equal(requestRematch(room,0,false),false);
 assert.deepEqual(viewFor(room,1).rematch.accepted,[false,false]);
 assert.equal(requestRematch(room,1,true),false);
 assert.equal(requestRematch(room,0,true),true);
 assert.notEqual(room.game,original);
 assert.equal(room.game.matchId,originalId+1);
 assert.equal(room.game.over,false);
 assert.equal(room.game.players[0].lp,20);
 assert.equal(room.game.players[0].hand.length,7);
 assert.equal(room.game.players[1].hand.length,7);
 assert.equal(room.game.players[0].field.length,0);
 assert.equal(room.game.players[0].lands.length,0);
 assert.equal(room.game.turn,room.game.firstSeat);
 assert.deepEqual(viewFor(room,0).rematch.accepted,[false,false]);
 // Each viewer continues to see only their own hand after restarting.
 assert.equal(viewFor(room,0).game.players[1].hand,undefined);
 assert.equal(viewFor(room,1).game.players[0].hand,undefined);
});
test('Leaving a finished room blocks rematch and invalidates the departing seat', async()=>{
 const {requestRematch,leaveFinishedRoom}=await import('../src/engine.mjs');
 const room=r();room.game.over=true;requestRematch(room,0,true);
 leaveFinishedRoom(room,1);
 assert.equal(viewFor(room,0).rematch.closed,true);
 assert.equal(viewFor(room,0).rematch.leftSeat,1);
 assert.equal(room.players[1].token,'');
 assert.deepEqual(viewFor(room,0).rematch.accepted,[false,false]);
 assert.throws(()=>requestRematch(room,0),/退室/);
 assert.throws(()=>leaveFinishedRoom(room,1),/参加者/);
 leaveFinishedRoom(room,0);assert.equal(room.players[0].token,'');
});

test('v36: red flow vein placement, tapping, and monster casting work in sequence',()=>{
 const room=r(),g=room.game,own=g.players[0];
 const land=piece('赤の流脈',0),monster=piece('陽炎のジン',0);
 own.hand.push(land,monster);
 at(room,0,{type:'land',card:land.id});
 assert.equal(own.lands.some(c=>c.id===land.id),true);
 at(room,0,{type:'tap_land',card:land.id});
 assert.equal(own.mana.some(m=>m.color==='red'),true);
 at(room,0,{type:'play',card:monster.id});
 assert.equal(g.stack.length,1);
 at(room,1,{type:'pass'});at(room,0,{type:'pass'});
 assert.equal(own.field.some(c=>c.id===monster.id),true);
 assert.equal(own.mana.length,0);
 assert.equal(viewFor(room,1).game.players[0].hand,undefined);
});
test('v37: manual monster tap and undo match local card controls without cheating',()=>{
 const room=r(),g=room.game;const c=piece('パラディン',0);g.players[0].field.push(c);
 at(room,0,{type:'tap_monster',card:c.id});assert.equal(c.tapped,true);
 assert.equal(viewFor(room,1).game.players[0].field[0].tapped,true);
 at(room,0,{type:'untap_monster',card:c.id});assert.equal(c.tapped,false);
 at(room,0,{type:'tap_monster',card:c.id});c.spent=true;
 assert.throws(()=>at(room,0,{type:'untap_monster',card:c.id}),/使用済み/);
 assert.throws(()=>at(room,1,{type:'untap_monster',card:c.id}),/自分/);
});


test('v38 ordinary monster or spell can be placed face-down as colorless vein before playing',()=>{
 const room=r(),g=room.game,p=g.players[0];const c=piece('陽炎のジン',0);p.hand.push(c);
 assert.equal(viewFor(room,0).game.players[0].playedThisTurn,false);
 at(room,0,{type:'land',card:c.id});assert.equal(p.lands.some(x=>x.id===c.id&&x.faceDown),true);
 assert.equal(viewFor(room,0).game.players[0].landsPlaced,true);
 const op=viewFor(room,1).game.players[0].lands.find(x=>x.id===c.id);assert.equal(op.name,'裏向き流脈');assert.equal(op.privateName,undefined);
 at(room,0,{type:'tap_land',card:c.id});assert.equal(p.mana.at(-1).color,'none');
});
test('v38 normal summoner costs one matching flow vein and produces effect via stack',()=>{
 const room=r(),g=room.game,p=g.players[0];p.summoner=piece('サミュエル',0);p.lp=16;const land=piece('黄の流脈',0);p.lands.push(land);
 at(room,0,{type:'summoner'});assert.equal(land.tapped,true);assert.equal(land.spent,true);assert.equal(p.mana.length,0);
 assert.equal(g.stack[0].kind,'summoner');at(room,1,{type:'pass'});at(room,0,{type:'pass'});
 assert.equal(p.lp,17);assert.equal(viewFor(room,1).game.lifeEvents.at(-1).kind,'heal');
 assert.equal(viewFor(room,1).game.lifeEvents.at(-1).amount,1);
});
test('v38 summoner targeting can apply SP effect',()=>{
 const room=r(),g=room.game,p=g.players[0];p.summoner=piece('オニキス',0);const land=piece('緑の流脈',0),c=piece('陽炎のジン',0);p.lands.push(land);p.field.push(c);
 at(room,0,{type:'summoner',target:c.id});at(room,1,{type:'pass'});at(room,0,{type:'pass'});
 assert.equal(viewFor(room,0).game.players[0].field[0].sp,2);
});

test('v38 colored LP feedback events distinguish spell LP costs from damage',()=>{
 const room=r(),g=room.game,p=g.players[0],c=piece('わが命を懸けて',0);
 p.hand.push(c);p.mana=Array.from({length:4},()=>({color:'black',src:null}));
 at(room,0,{type:'play',card:c.id});
 assert.equal(p.lp,17);
 const events=viewFor(room,0).game.lifeEvents;
 assert.equal(events.at(-1).amount,-3);
 assert.equal(events.at(-1).kind,'cost');
 assert.equal(viewFor(room,1).game.lifeEvents.at(-1).kind,'cost');
});
test('v38 end-turn-triggered summoner is resolved by END TURN rather than main phase',()=>{
 const room=r(),g=room.game,p=g.players[0];p.summoner=piece('フェヌグリーク',0);
 assert.throws(()=>at(room,0,{type:'summoner'}),/終了時/);
 p.turnAttacks=2;p.lands.push(piece('赤の流脈',0));p.mana.push({color:'none',src:null});
 at(room,0,{type:'end_turn'});
 assert.equal(g.choice.type,'endTurnSummoner');
 finishChoice(g,0,['activate']);
 assert.ok(g.pendingEffectDraw);
 assert.equal(g.pendingEffectDraw.remaining,1);
});

// v39: automatic unblocked resolution must depend on legal untapped blockers, not field size.
test('v39 directly damages LP without NO BLOCK when all defenders are tapped',()=>{
 const room=r(),g=room.game;
 const a=piece('アックス・ソルジャー',0);g.players[0].field.push(a);
 const b=piece('陽炎のジン',1),c=piece('斥候ゴブリン',1);b.tapped=true;c.tapped=true;g.players[1].field.push(b,c);
 at(room,0,{type:'phase',to:'BATTLE'});at(room,0,{type:'attack',card:a.id});
 assert.equal(g.block,null);assert.equal(g.players[1].lp,17);assert.equal(g.players[1].field.length,2);
 assert.equal(g.lifeEvents.at(-1).kind,'damage');
});
test('v39 still offers NO BLOCK when one among multiple defenders is untapped',()=>{
 const room=r(),g=room.game,a=piece('アックス・ソルジャー',0);
 g.players[0].field.push(a);
 const b=piece('陽炎のジン',1),c=piece('斥候ゴブリン',1);b.tapped=true;g.players[1].field.push(b,c);
 at(room,0,{type:'phase',to:'BATTLE'});at(room,0,{type:'attack',card:a.id});
 assert.notEqual(g.block,null);assert.equal(g.players[1].lp,20);
 at(room,1,{type:'block'});assert.equal(g.players[1].lp,17);
});
