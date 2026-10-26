import { DB } from './cards-data.mjs';

const MAX_LOG = 36;
const SIDES = [0,1];
const TURNS = ['MAIN','BATTLE'];
const colorWords={red:'赤',blue:'青',green:'緑',yellow:'黄',black:'黒',none:'無色'};
const ids=Object.keys(DB);
export const CARD_NAMES = ids;
export function secureId(prefix='c') { const bytes=new Uint8Array(12); crypto.getRandomValues(bytes); return prefix+[...bytes].map(n=>n.toString(16).padStart(2,'0')).join(''); }
export function randomInt(max){const raw = new Uint32Array(1);const limit=4294967296-(4294967296%max);do{crypto.getRandomValues(raw)}while(raw[0]>=limit);return raw[0]%max;}
export function shuffle(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
export function validDeck(names) {
 if(!Array.isArray(names)||names.length!==51||names.some(n=>typeof n!=='string'||!DB[n]))return 'カード51枚（通常50枚＋召喚士1枚）が必要です';
 const summoners=names.filter(n=>DB[n].t==='summoner');if(summoners.length!==1)return '召喚士は別枠で1枚だけ指定してください';
 const count={};for(const n of names){const d=DB[n]; count[n]=(count[n]||0)+1;if(d.t!=='land'&&count[n]>4)return n+'は4枚までです';if(d.t==='land'&&count[n]>50)return n+'は50枚までです';}
 return null;
}
function inst(name){ const d=DB[name];return {id:secureId(),name,owner:0,tapped:false,spent:false,faceDown:false,summonSick:true,mod:0,spMod:0,mods:[],burst:false,haste:false,unblockable:false,indestructible:0}; }
function emptySeat(){return {name:'',token:'',deckNames:null,ready:false};}
export function newRoom(code){return {version:3,code,createdAt:Date.now(),players:[emptySeat(),emptySeat()],game:null,rematch:[false,false],matchCount:0,closed:false,leftSeat:null,events:[]};}
export function joinSeat(room,seat,name,token){if(!SIDES.includes(seat)||room.players[seat].token)throw Error('その席には参加できません'); room.players[seat]={name:String(name||`PLAYER ${seat+1}`).trim().slice(0,24),token,deckNames:null,ready:false};return room;}
function log(g,msg){g.log.push(msg);if(g.log.length>MAX_LOG)g.log.shift();}
function cardDef(card){return DB[card.name];}
function player(side,deck){const names=shuffle(deck.filter(n=>DB[n].t!=='summoner'));const p={lp:20,deck:names.map(n=>inst(n)),hand:[],field:[],lands:[],grave:[],summoner:inst(deck.find(n=>DB[n].t==='summoner')),mana:[],landPlaced:false,playedThisTurn:false,turnAttacks:0,prevent:0,effects:{}};p.summoner.owner=side;p.deck.forEach(c=>c.owner=side);return p;}
function drawCard(g,side){const p=g.players[side];if(!p.deck.length){p.lp=0;endGame(g,1-side,'山札切れ');return false;} p.hand.push(p.deck.pop());return true;}
export function startMatch(room){if(room.game)throw Error('対戦開始済みです');if(room.players.some(s=>!s.ready||!s.deckNames))throw Error('双方のデッキと準備完了が必要です');const firstSeat=randomInt(2);room.matchCount=(room.matchCount||0)+1;room.rematch=[false,false];const g={matchId:room.matchCount,players:room.players.map((s,i)=>player(i,s.deckNames)),turn:firstSeat,firstSeat,turnNo:1,phase:'MAIN',drawPending:0,pendingEffectDraw:null,endingTurnSide:null,stack:[],priority:firstSeat,pass:0,block:null,choice:null,over:false,winner:null,log:[],lastAction:'',serial:0,lifeEvents:[]};g.players.forEach((p,i)=>{for(let n=0;n<7;n++)drawCard(g,i)});log(g,`対戦開始：PLAYER ${firstSeat+1}の先攻・PLAYER ${2-firstSeat}の後攻（先攻初回ドローなし）`);room.game=g;return g;}
// Only the server can start a rematch: both original seats must agree after the match ends.
export function requestRematch(room,seat,accept=true){
 if(!SIDES.includes(seat)||!room.players[seat]?.token)throw Error('対戦参加者ではありません');
 if(!room.game?.over)throw Error('試合終了後に再戦を選択してください');
 if(room.closed)throw Error('相手が退室したため再戦できません');
 if(!room.players.every(p=>p.token&&p.deckNames))throw Error('相手が参加していません');
 if(!Array.isArray(room.rematch))room.rematch=[false,false];
 room.rematch[seat]=accept===true;
 if(room.rematch.every(Boolean)){
  room.matchCount=Math.max(room.matchCount||0,room.game.matchId||1); // Migrate v33 rooms without match counters.
  room.game=null;
  room.players.forEach(p=>p.ready=true);
  startMatch(room); // New deck shuffle, life, hands, board, and randomized first seat.
  return true;
 }
 return false;
}
export function leaveFinishedRoom(room,seat){
 if(!SIDES.includes(seat)||!room.players[seat]?.token)throw Error('対戦参加者ではありません');
 if(!room.game?.over)throw Error('試合終了後にマッチングへ戻れます');
 room.closed=true;
 room.leftSeat=seat;
 room.rematch=[false,false];
 room.players[seat].token=''; // Revoke reconnect and all other open tabs for this seat.
 room.players[seat].ready=false;
}
function endGame(g,winner,reason){g.over=true;g.winner=winner;log(g,`勝敗確定：PLAYER ${winner+1}の勝利（${reason}）`);}
function checkGame(g){if(g.over)return;const dead=g.players.map(p=>p.lp<=0);if(dead[0]&&dead[1]){g.over=true;g.winner=null;log(g,'両者敗北：引き分け')}else if(dead[0])endGame(g,1,'LP 0');else if(dead[1])endGame(g,0,'LP 0');}
function zone(g,id){for(let s=0;s<2;s++)for(const k of ['field','lands','hand','grave','deck']){const i=g.players[s][k].findIndex(c=>c.id===id);if(i>=0)return {side:s,part:k,index:i,card:g.players[s][k][i]};}return null;}
function target(g,side,id,part='field'){const q=zone(g,id);return q&&q.side===side&&q.part===part?q.card:null;}
function calcPower(g,c,s,blocking=false){let x=cardDef(c).power+c.mod;for(const m of c.mods)if(m.type==='power'&&(!m.blockOnly||blocking))x+=m.amount;for(const a of g.players[s].field)if(a!==c&&cardDef(a).effectKey==='auraAtk1')x+=1000;return x;}
function calcSP(c){return Math.max(0,Number(cardDef(c).sp)+c.spMod+ c.mods.filter(m=>m.type==='sp').reduce((t,m)=>t+m.amount,0));}
function effectiveFlags(g,c,s){return {burst:c.burst||cardDef(c).effectKey==='deathtouch'||!!g.players[s].effects.teamBurst,unblockable:c.unblockable||['unblockable'].includes(cardDef(c).effectKey)||!!g.players[s].effects.teamUnblockable,haste:c.haste||cardDef(c).haste||['haste','hasteBurn3'].includes(cardDef(c).effectKey)};}
function moveOut(g,id){const v=zone(g,id);if(!v)return null;g.players[v.side][v.part].splice(v.index,1);return v;}
function toGrave(g,c,s,from='field'){
 const p=g.players[s];const eff=cardDef(c).effectKey;if(from==='field'&&(eff==='returnOnDeath'||p.effects.returnAll)){p.hand.push(c);log(g,`《${c.name}》は手札に戻った`);return;}
 if(from==='field'&&(eff==='faceDownLandOnDeath'||p.effects.soulNever)){c.faceDown=true;c.tapped=false;c.spent=false;p.lands.push(c);log(g,`《${c.name}》は裏向き流脈になった`);return;}
 p.grave.push(c);
}
function kill(g,c,s){const v=zone(g,c.id);if(!v||v.part!=='field')return false;if(c.indestructible>0){c.indestructible--;log(g,`《${c.name}》の破壊耐性が発動`);return false;}moveOut(g,c.id);toGrave(g,c,s);log(g,`《${c.name}》が破壊された`);return true;}
function bounce(g,c){const v=moveOut(g,c.id);if(!v)return;g.players[v.side].hand.push(c);log(g,`《${c.name}》は手札に戻った`);}
function makeLand(g,c,s){const v=moveOut(g,c.id);if(!v)return;c.faceDown=true;c.tapped=false;c.spent=false;g.players[s].lands.push(c);log(g,'カード1枚が裏向き流脈になった');}
function modPower(g,c,s,amount,until){c.mods.push({type:'power',amount,until});if(calcPower(g,c,s)<=0)kill(g,c,s);}
function expEnd(g){for(let s=0;s<2;s++){const p=g.players[s];for(const c of p.field){c.mods=c.mods.filter(x=>x.until>g.turnNo);if(calcPower(g,c,s)<=0)kill(g,c,s);}if(p.effects.until<=g.turnNo){p.effects={};} }}
function manaColor(c){return c.faceDown?'none':cardDef(c).color;}
function endTurnSummonerPayment(p,sd){
 // Reserve the same-color flow vein; the additional generic mana may be
 // paid from the existing pool or generated from a different untapped vein.
 const colored=p.lands.find(c=>!c.tapped&&manaColor(c)===sd.color);
 if(!colored)return null;
 const extra=Math.max(0,(Number(sd.summonerAbilityCost)||1)-1);
 const fromPool=Math.min(extra,p.mana.length);
 const extraLands=p.lands.filter(c=>c.id!==colored.id&&!c.tapped).slice(0,extra-fromPool);
 return fromPool+extraLands.length===extra?{colored,fromPool,extraLands}:null;
}
function payEndTurnSummoner(p,payment){
 for(let i=0;i<payment.fromPool;i++){
  const mana=p.mana.shift(),source=p.lands.find(c=>c.id===mana.src);
  if(source)source.spent=true;
 }
 for(const land of [payment.colored,...payment.extraLands]){land.tapped=true;land.spent=true;}
}

function pay(p,d){const cost=Number(d.c)||0;if(p.mana.length<cost)throw Error('マナが不足しています');const color=d.color||'none';const index=color==='none'?-1:p.mana.findIndex(m=>m.color===color);if(color!=='none'&&index<0)throw Error(colorWords[color]+'のマナが必要です'); const indices=[];if(index>=0)indices.push(index);for(let i=0;i<p.mana.length&&indices.length<cost;i++)if(!indices.includes(i))indices.push(i);if(cost===0)indices.length=0;if(indices.length!==cost)throw Error('マナ不足');const used=indices.map(i=>p.mana[i]);p.mana=p.mana.filter((_,i)=>!indices.includes(i));for(const m of used){const land=p.lands.find(c=>c.id===m.src);if(land)land.spent=true;}}
function lpChange(g,side,amount,kind){if(!amount)return;g.lifeEvents??=[];g.serial=(g.serial||0)+1;g.lifeEvents.push({seq:g.serial,side,amount,kind});if(g.lifeEvents.length>24)g.lifeEvents.shift();}
function heal(g,side,n){g.players[side].lp+=n;lpChange(g,side,n,'heal');}
function hurt(g,side,n){const p=g.players[side];let x=n;if(p.prevent>0){const q=Math.min(x,p.prevent);x-=q;p.prevent-=q;}p.lp-=x;lpChange(g,side,-x,'damage');log(g,`PLAYER ${side+1}は${x}ダメージを受けた`);checkGame(g);}
function validateTarget(g,side,part,id){return id ? target(g,side,id,part):null;}
function requiredTarget(g,kind,side,values){let options=[];
 const own=g.players[side],opp=g.players[1-side];const opponent=1-side;
 switch(kind){
  case 'damageOpp2':case 'hpMinus3UntappedOpp':case 'hpMinus1EOT':case 'hpMinus2EOT':case 'tapOppOnSummon':case 'destroyOppMonster':case 'oppToFaceDownLand':case 'oppSpMinus1NextEnd':case 'oppBlockPowerPlus2NextEnd':case 'hpMinus1NextEnd': options=opp.field.filter(c=>kind!=='hpMinus3UntappedOpp'||!c.tapped);break;
  case 'destroyOppLand':options=opp.lands;break;
  case 'bounceAny':options=[...own.field,...opp.field];break;
  case 'recoverOne':case 'graveToFaceDownLand':case 'recoverUpTo2':options=own.grave.filter(c=>cardDef(c).t==='monster');break;
  case 'ownToFaceDownLand':case 'ownSpPlus1':case 'grantHaste':case 'grantUnblockable':case 'grantDeathtouch':case 'forceAttackTarget':case 'atkPlus1':options=own.field;break;
  case 'tapUpTo2':options=opp.field;break;
  case 'counterPlay':options=g.stack.filter(x=>x.side===opponent&&x.kind==='card'&&cardDef(x.card).t!=='summoner').map(x=>({id:x.id,name:x.card.name}));break;
  case 'destroyOneEach':options=own.field.length&&opp.field.length?own.field:[];break;
  case 'chooseBurn3': options=[...opp.field,{id:'player',name:'相手プレイヤー'}];break;
  case 'soulDrain':options=own.field;break;
  case 'freeSummon3':options=own.hand.filter(c=>cardDef(c).t==='monster'&&cardDef(c).c<=3);break;
  default: return null;
 }
 return options;
}
const SUPPORTED = new Set(['vanilla','haste','cannotAttack','cannotAttackFace','unblockable','deathtouch','sacLandOnAttack','hasteBurn3','destroyOppLand','damageAll3','damageOpp2','face4','chooseBurn3','attackUntappedEOT','draw1','draw2','draw3','bounceAllOpp','bounceAny','counterAttack','bounceHp3','counterPlay','returnAllOnDeath','teamUnblockable','bounceAll','draw5Bottom4','faceDownLandOnDeath','returnOnDeath','handToFaceDownLand','searchLand','auraAtk1','untapOnKill','graveToFaceDownLand','oppToFaceDownLand','ownToFaceDownLand','searchMonster','teamAtk3','search2Land','soulNever','blockHpPlus2','untapSelfEnd','tapOppOnSummon','searchSpell','tapAllOpp','prevent3','heal2','indestructibleOnce','tapUpTo2','freeSummon3','heal4','hpPlus3Team','destroyAll','sacOwnOnSummon','hpMinus1EOT','discardRandomOpp','destroyOppMonster','recoverUpTo2','hpMinus3AllEOT','recoverOne','hpMinus3UntappedOpp','destroyOneEach','teamDeathtouch','soulDrain','sixColorless','hpMinus2AllEOT']);
export function supportReport(){return Object.entries(DB).filter(([n,d])=>d.t!=='summoner'&&d.t!=='land'&&!SUPPORTED.has(d.effectKey)).map(([n,d])=>({name:n,key:d.effectKey}));}
function issueChoice(g,side,type,opts,min=1,max=1){g.choice={seat:side,type,options:opts.map(c=>({id:c.id,name:c.name})),min,max};}
function cardOptions(g,side,kind){const p=g.players[side];if(kind==='searchLand'||kind==='search2Land')return p.deck.filter(c=>cardDef(c).t==='land');if(kind==='searchMonster'||kind==='revealTopMonster')return p.deck.filter(c=>cardDef(c).t==='monster');if(kind==='searchSpell')return p.deck.filter(c=>cardDef(c).t==='spell');return [];}
function applySearch(g,side,kind){const options=cardOptions(g,side,kind); if(!options.length){log(g,'山札に条件を満たすカードがありません');return;}issueChoice(g,side,kind,options,kind==='search2Land'?Math.min(2,options.length):1,kind==='search2Land'?Math.min(2,options.length):1);}
function queueDrawEffect(g,side,n,source,after='none'){
 if(g.pendingEffectDraw)throw Error('ドロー効果の処理中です');
 g.pendingEffectDraw={seat:side,remaining:n,total:n,source,after};
 log(g,`《${source}》：${n}枚ドローします。DRAWボタンで1枚ずつ処理してください`);
}
function applyEffect(g,e){const {card:c,side,chosen=[],targetId=null}=e, p=g.players[side],opp=g.players[1-side],key=cardDef(c).effectKey;const tgt=zone(g,targetId);const targetCard=tgt?.card;const tSide=tgt?.side;
 const need=(allowedSides,where='field')=>targetCard&&tgt.part===where&&allowedSides.includes(tSide);
 const removeTarget=()=>{if(!targetCard)return;const rec=moveOut(g,targetCard.id);if(rec)toGrave(g,targetCard,rec.side,rec.part)};
 switch(key){
 case 'vanilla':case 'haste':case 'cannotAttack':case 'cannotAttackFace':case 'unblockable':case 'deathtouch':case 'auraAtk1':case 'untapOnKill':case 'untapSelfEnd':case 'faceDownLandOnDeath':case 'returnOnDeath':case 'blockHpPlus2':case 'sacLandOnAttack':case 'hasteBurn3': break;
 case 'damageAll3': for(const m of [...opp.field])if(calcPower(g,m,1-side)<=3000)kill(g,m,1-side);break;
 case 'damageOpp2': if(need([1-side])&&calcPower(g,targetCard,1-side)<=2000)kill(g,targetCard,1-side);break;
 case 'face4':hurt(g,1-side,4);break;
 case 'chooseBurn3':if(targetId==='player')hurt(g,1-side,3);else if(need([1-side])&&calcPower(g,targetCard,1-side)<=3000)kill(g,targetCard,1-side);break;
 case 'attackUntappedEOT':p.effects.attackUntapped=true;p.effects.until=g.turnNo;break;
 case 'destroyOppLand': if(need([1-side],'lands'))removeTarget();break;
 case 'draw1':case 'draw2':case 'draw3':queueDrawEffect(g,side,Number(key.slice(-1)),c.name);break;
 case 'draw5Bottom4':queueDrawEffect(g,side,5,c.name,'bottom4');break;
 case 'bounceAllOpp': for(const m of [...opp.field])bounce(g,m);break;
 case 'bounceAll':for(const s of [side,1-side])for(const m of [...g.players[s].field])bounce(g,m);break;
 case 'bounceAny':if(need([0,1]))bounce(g,targetCard);break;
 case 'bounceHp3':for(const m of [...opp.field])if(calcPower(g,m,1-side)<=3000)bounce(g,m);break;
 case 'counterAttack':if(g.block&&g.block.attacker){const v=zone(g,g.block.attacker);if(v&&v.part==='field')kill(g,v.card,v.side);g.block=null;}break;
 case 'counterPlay':{const item=g.stack.findIndex(x=>x.id===targetId&&x.side===1-side&&x.kind==='card');if(item>=0){const [entry]=g.stack.splice(item,1);g.players[entry.side].grave.push(entry.card);log(g,`《${entry.card.name}》が無効化された`);}break;}
 case 'returnAllOnDeath':p.effects.returnAll=true;p.effects.until=g.turnNo;break;
 case 'teamUnblockable':p.effects.teamUnblockable=true;p.effects.until=g.turnNo;break;
 case 'handToFaceDownLand':if(p.hand.length)issueChoice(g,side,'handToFaceDownLand',p.hand);break;
 case 'searchLand':case 'searchMonster':case 'searchSpell':case 'search2Land':applySearch(g,side,key);break;
 case 'graveToFaceDownLand':if(need([side],'grave'))makeLand(g,targetCard,side);break;
 case 'oppToFaceDownLand':if(need([1-side]))makeLand(g,targetCard,1-side);break;
 case 'ownToFaceDownLand':if(need([side]))makeLand(g,targetCard,side);break;
 case 'teamAtk3':for(const m of p.field)modPower(g,m,side,3000,g.turnNo);break;
 case 'soulNever':p.effects.soulNever=true;p.effects.until=g.turnNo;break;
 case 'tapOppOnSummon':if(need([1-side])){targetCard.tapped=true;targetCard.spent=true;}break;
 case 'tapAllOpp':opp.field.forEach(m=>{m.tapped=true;m.spent=true});break;
 case 'prevent3':p.prevent+=3;break;
 case 'heal2':heal(g,side,2);break;
 case 'heal4':heal(g,side,4);break;
 case 'indestructibleOnce':for(const m of p.field)m.indestructible+=1;break;
 case 'tapUpTo2':for(const id of chosen.slice(0,2)){const v=zone(g,id);if(v&&v.side===1-side&&v.part==='field'){v.card.tapped=true;v.card.spent=true;}}break;
 case 'freeSummon3': if(p.hand.some(x=>cardDef(x).t==='monster'&&cardDef(x).c<=3))issueChoice(g,side,'freeSummon3',p.hand.filter(x=>cardDef(x).t==='monster'&&cardDef(x).c<=3));break;
 case 'hpPlus3Team':for(const m of p.field)modPower(g,m,side,3000,g.turnNo);break;
 case 'destroyAll':for(const s of [0,1])for(const m of [...g.players[s].field])kill(g,m,s);break;
 case 'sacOwnOnSummon':if(p.field.length>1)issueChoice(g,side,'sacOwn',p.field.filter(x=>x.id!==c.id));else if(p.field.length===1)kill(g,c,side);break;
 case 'hpMinus1EOT':if(need([1-side]))modPower(g,targetCard,1-side,-1000,g.turnNo);break;
 case 'discardRandomOpp':if(opp.hand.length){const [d]=opp.hand.splice(randomInt(opp.hand.length),1);opp.grave.push(d);log(g,`PLAYER ${2-side}の手札1枚がランダムに捨てられた`);}break;
 case 'destroyOppMonster':if(need([1-side]))kill(g,targetCard,1-side);break;
 case 'recoverUpTo2':for(const id of chosen.slice(0,2)){const v=zone(g,id);if(v&&v.side===side&&v.part==='grave'&&cardDef(v.card).t==='monster'){moveOut(g,id);p.hand.push(v.card)}}break;
 case 'recoverOne':if(need([side],'grave')&&cardDef(targetCard).t==='monster'){moveOut(g,targetId);p.hand.push(targetCard);}break;
 case 'hpMinus3AllEOT':for(const m of [...opp.field])modPower(g,m,1-side,-3000,g.turnNo);break;
 case 'hpMinus2AllEOT':for(const m of [...opp.field])modPower(g,m,1-side,-2000,g.turnNo);break;
 case 'hpMinus3UntappedOpp':if(need([1-side])&&!targetCard.tapped)modPower(g,targetCard,1-side,-3000,g.turnNo);break;
 case 'destroyOneEach': {const a=zone(g,chosen[0]),b=zone(g,chosen[1]);if(a?.side===side&&a.part==='field')kill(g,a.card,side);if(b?.side===1-side&&b.part==='field')kill(g,b.card,1-side);break;}
 case 'teamDeathtouch':p.effects.teamBurst=true;p.effects.until=g.turnNo;break;
 case 'soulDrain':{let n=0;for(const id of chosen){const a=zone(g,id);if(a?.side===side&&a.part==='field'&&kill(g,a.card,side))n++;}heal(g,side,2*n);break;}
 case 'sixColorless':for(let i=0;i<6;i++)p.mana.push({color:'none',src:null});break;
 default:log(g,`《${c.name}》の固有効果は未対応です`);
 }
}
function resolveSummoner(g,e){const p=g.players[e.side],k=e.key,opp=g.players[1-e.side];const tgt=zone(g,e.targetId),c=tgt?.card;
 switch(k){
 case 'face2':hurt(g,1-e.side,2);break;
 case 'heal1':heal(g,e.side,1);break;
 case 'draw1SelfDamage2':queueDrawEffect(g,e.side,1,e.card.name,'damageSelf2');break;
 case 'revealTopMonster':{const top=p.deck.pop();if(top){if(cardDef(top).t==='monster')p.hand.push(top);else p.deck.unshift(top);log(g,`PLAYER ${e.side+1}は山札の一番上を公開：${top.name}`);}break;}
 case 'ownSpPlus1':if(tgt?.side===e.side&&tgt.part==='field')c.mods.push({type:'sp',amount:1,until:g.turnNo});break;
 case 'oppSpMinus1NextEnd':if(tgt?.side===1-e.side&&tgt.part==='field')c.mods.push({type:'sp',amount:-1,until:g.turnNo+1});break;
 case 'oppBlockPowerPlus2NextEnd':if(tgt?.side===1-e.side&&tgt.part==='field')c.mods.push({type:'power',amount:2000,blockOnly:true,until:g.turnNo+1});break;
 case 'hpMinus1NextEnd':if(tgt?.side===1-e.side&&tgt.part==='field')modPower(g,c,1-e.side,-1000,g.turnNo+1);break;
 case 'grantHaste':if(tgt?.side===e.side&&tgt.part==='field')c.haste=true;break;
 case 'grantUnblockable':if(tgt?.side===e.side&&tgt.part==='field'){c.unblockable=true;c.mods.push({type:'clearUnblockable',until:g.turnNo});}break;
 case 'grantDeathtouch':if(tgt?.side===e.side&&tgt.part==='field'){c.burst=true;c.mods.push({type:'clearBurst',until:g.turnNo});}break;
 case 'forceAttackTarget':if(tgt?.side===e.side&&tgt.part==='field'){c.tapped=true;c.mods.push({type:'forced',until:g.turnNo+1});}break;
 case 'reorderTop3':{ const cards=p.deck.slice(-3);if(cards.length)issueChoice(g,e.side,'reorderTop3',cards,cards.length,cards.length);break;}
 case 'endDrawIf2Attacks':if(p.turnAttacks>=2)queueDrawEffect(g,e.side,1,e.card.name,'endTurn');break;
 case 'endUntapAll':p.field.forEach(c=>{c.tapped=false;c.spent=false});break;
 default:log(g,'召喚士能力の処理に失敗');
 }
}
// Summoning and enter-the-battlefield triggers are two independent stack events.
// Players get priority for the summon first, then for its triggered effect.
function resolveStack(g){
 while(g.stack.length&&!g.choice&&!g.pendingEffectDraw&&!g.over){
  const e=g.stack.pop();log(g,`解決：《${e.card.name}》`);
  if(e.kind==='summoner'){resolveSummoner(g,e);continue;}
  if(e.kind==='trigger'){applyEffect(g,e);checkGame(g);continue;}
  const d=cardDef(e.card);
  if(d.t==='monster'){
   g.players[e.side].field.push(e.card);
   log(g,`PLAYER ${e.side+1}が《${e.card.name}》を召喚`);
   if(String(d.txt||'').includes('登場時')){
    const options=listMayTarget(g,d.effectKey,e.side);
    if(options!==null){
     if(!options.length){log(g,`《${e.card.name}》：対象がないため登場時効果は不発`);continue;}
     issueChoice(g,e.side,'etb_target',options.map(id=>{const x=zone(g,id);return {id,name:x?.card?.name||'相手プレイヤー'};}));
     g.choice.source={id:e.card.id,side:e.side};
     log(g,`《${e.card.name}》登場時効果：召喚後に対象を選択`);return;
    }
    g.stack.push({id:secureId('s'),kind:'trigger',side:e.side,card:e.card,targetId:null,chosen:[]});
    g.priority=1-e.side;g.pass=0;
    log(g,`登場時：《${e.card.name}》の効果がスタックへ（優先権：相手）`);
    return;
   }
  }else{g.players[e.side].grave.push(e.card);applyEffect(g,e);}
  checkGame(g);
 }
 if(!g.stack.length&&!g.pendingEffectDraw&&!g.choice){g.pass=0;g.priority=g.turn;if(g.endingTurnSide!==null&&g.endingTurnSide!==undefined){const ending=g.endingTurnSide;g.endingTurnSide=null;advanceTurn(g,ending);}}
}
function expire(g){for(let s=0;s<2;s++){const p=g.players[s];for(const c of p.field){c.indestructible=0;const expired=c.mods.filter(m=>m.until<=g.turnNo);c.mods=c.mods.filter(m=>m.until>g.turnNo);if(expired.some(m=>m.type==='clearUnblockable'))c.unblockable=false;if(expired.some(m=>m.type==='clearBurst'))c.burst=false;if(calcPower(g,c,s)<=0)kill(g,c,s)}if((p.effects.until||0)<=g.turnNo)p.effects={};}}
function battle(g){const b=g.block;if(!b)return;g.block=null;const attacker=target(g,b.seat,b.attacker);if(!attacker){log(g,'攻撃モンスターが戦場にいないため攻撃終了');return}const opp=1-b.seat;const defender=b.blocker?target(g,opp,b.blocker):b.target?target(g,opp,b.target):null;
 if(!defender){if(!b.target){hurt(g,opp,calcSP(attacker));log(g,`直接攻撃：SP ${calcSP(attacker)}`);}else log(g,'攻撃対象が戦場から離れた');return;}
 const ap=calcPower(g,attacker,b.seat,false),dp=calcPower(g,defender,opp,!!b.blocker);
 const aBurst=effectiveFlags(g,attacker,b.seat).burst,dBurst=effectiveFlags(g,defender,opp).burst;
 const aLose=ap<=dp||dBurst,dLose=dp<=ap||aBurst;
 if(aLose)kill(g,attacker,b.seat);if(dLose)kill(g,defender,opp);
 if(dLose&&!aLose&&cardDef(attacker).effectKey==='untapOnKill'){attacker.tapped=false;attacker.spent=false;}
 log(g,`戦闘：${ap} 対 ${dp} — ${aLose&&dLose?'双方破壊':aLose?'攻撃側敗北':dLose?'防御側敗北':'双方残存'}`);
}
function listMayTarget(g,key,side){const ops=requiredTarget(g,key,side);return ops===null?null:ops.map(x=>x.id);}
export function legalTargets(g,side,key){return listMayTarget(g,key,side);}
function validateSelection(g,side,key,id,chosen){const options=listMayTarget(g,key,side);if(options===null)return; if(key==='chooseBurn3'&&id==='player')return;if(key==='counterPlay'&&options.includes(id))return;
 if(['tapUpTo2','recoverUpTo2','soulDrain'].includes(key)){if(!options.length)throw Error('必要な対象が存在しないため発動できません');const values=chosen||[];if(values.length&&values.some(x=>!options.includes(x)))throw Error('対象にできないカードを含みます');if(!values.length&&key==='soulDrain')throw Error('対象を選択してください');return;}
 if(key==='destroyOneEach'){if(!options.includes(chosen?.[0])||!g.players[1-side].field.some(x=>x.id===chosen?.[1]))throw Error('自分と相手のモンスターを1体ずつ選択してください');return;}
 if(options.length===0)throw Error('必要な対象カードが存在しないため発動できません');
 if(!options.includes(id))throw Error('有効な対象を選択してください');}
function verifyActivity(g,side){if(!g||g.over)throw Error('対戦が進行していません');if(g.choice)throw Error('カード選択処理を完了してください');}
function advanceTurn(g,side){
 g.endingTurnSide=null;
 const p=g.players[side];
 for(const c of p.field)if(cardDef(c).effectKey==='untapSelfEnd'){c.tapped=false;c.spent=false;}
 expire(g);p.mana=[];g.turn=1-side;g.turnNo++;g.phase='MAIN';g.drawPending=1;g.priority=g.turn;g.pass=0;
 const now=g.players[g.turn];now.landPlaced=false;now.playedThisTurn=false;now.turnAttacks=0;now.mana=[];
 for(const c of now.field){c.tapped=false;c.spent=false;c.summonSick=false;}
 for(const c of now.lands){c.tapped=false;c.spent=false;}
 log(g,`PLAYER ${g.turn+1}のターン開始：1枚ドロー`);
}
export function handleGameAction(g,side,msg){if(!SIDES.includes(side))throw Error('不正なプレイヤー');verifyActivity(g,side);const p=g.players[side],opp=g.players[1-side],t=msg.type;
 if(t==='draw'){
  if(g.pendingEffectDraw){
   const q=g.pendingEffectDraw;if(q.seat!==side)throw Error('相手のドロー処理です');
   if(!drawCard(g,side)){g.pendingEffectDraw=null;return;}
   q.remaining--;log(g,`《${q.source}》：ドロー（残り${q.remaining}枚）`);
   if(q.remaining===0){
    g.pendingEffectDraw=null;
    if(q.after==='damageSelf2')hurt(g,side,2);
    else if(q.after==='bottom4'){const p=g.players[side];const n=Math.min(4,p.hand.length);if(n)issueChoice(g,side,'bottom4',p.hand,n,n);}
    else if(q.after==='endTurn'){advanceTurn(g,side);return;}
    if(!g.over&&!g.choice)resolveStack(g);
   }
   return;
  }
  if(g.turn!==side||!g.drawPending||g.stack.length)throw Error('今はドローできません');
  g.drawPending--;drawCard(g,side);log(g,`PLAYER ${side+1}がドロー`);return;
 }
 if(g.pendingEffectDraw)throw Error('ドロー効果の処理を完了してください');
 if(t==='land'){if(g.turn!==side||g.phase!=='MAIN'||g.drawPending||p.landPlaced||p.playedThisTurn||g.stack.length||g.block)throw Error('今は流脈を配置できません');const c=target(g,side,msg.card,'hand');if(!c||cardDef(c).t==='summoner')throw Error('手札にカードがありません');moveOut(g,c.id);c.faceDown=cardDef(c).t!=='land';c.tapped=false;c.spent=false;p.lands.push(c);p.landPlaced=true;log(g,`PLAYER ${side+1}が${c.faceDown?'裏向き':'表向き'}の流脈を配置`);return;}
 if(t==='tap_monster'||t==='untap_monster')throw Error('モンスターのタップ／アンタップはカード効果・攻撃・ターン処理でのみ行えます');
 if(t==='monster_ability'){
  if(g.turn!==side||g.phase!=='MAIN'||g.drawPending||g.choice||g.stack.length||g.block)throw Error('今は能力を使用できません');
  const c=target(g,side,msg.card,'field');if(!c||cardDef(c).effectKey!=='tapBurn2'||c.tapped)throw Error('このモンスターのタップ能力は使用できません');
  c.tapped=true;c.spent=true;hurt(g,1-side,2);log(g,`《${c.name}》の能力で相手に2ダメージ`);return;
 }
 if(t==='tap_land'){if(g.drawPending||g.block||g.choice)throw Error('今はタップできません');const c=target(g,side,msg.card,'lands');if(!c||c.tapped)throw Error('未タップの流脈を選択してください');c.tapped=true;p.mana.push({color:manaColor(c),src:c.id});return;}
 if(t==='untap_land'){const c=target(g,side,msg.card,'lands');if(!c||!c.tapped||c.spent)throw Error('この流脈は戻せません');const i=p.mana.findIndex(x=>x.src===c.id);if(i<0)throw Error('使用済み流脈は戻せません');p.mana.splice(i,1);c.tapped=false;return;}
 if(t==='play'){
  if(g.drawPending||g.choice)throw Error('別の処理を先に完了してください');const c=target(g,side,msg.card,'hand');if(!c)throw Error('カードが手札にありません');const d=cardDef(c);if(d.t==='summoner'||d.t==='land')throw Error('このカードは通常プレイできません');if(!SUPPORTED.has(d.effectKey))throw Error('このカードの効果はオンラインで未対応です');
  const instant=d.timing==='instant'||String(d.txt||'').includes('高速詠唱');
  if(g.block&&!g.stack.length){if(!instant||g.priority!==side)throw Error('攻撃中は防御側だけ高速詠唱を発動できます');}
  else if(g.stack.length){if(!instant||g.priority!==side)throw Error('優先権がある高速詠唱カードのみプレイできます');}
  else if(!instant&&(g.turn!==side||g.phase!=='MAIN'))throw Error('通常カードは自分のメインフェイズにプレイします');
  if(g.drawPending)throw Error('ドロー処理が必要です');
  if(d.effectKey==='counterAttack'&&!g.block)throw Error('攻撃に対応するときだけ使用できます');
  const targets=listMayTarget(g,d.effectKey,side);if(targets!==null){if(d.t==='monster'){}else if(d.effectKey==='freeSummon3'){if(!targets.length)throw Error('召喚できる対象のモンスターが手札にいません');}else validateSelection(g,side,d.effectKey,msg.target||null,msg.chosen||[]);}
  if((d.lpCost||0)&&p.lp<=d.lpCost)throw Error('LP支払い後に1以上必要です');pay(p,d);if(d.lpCost){p.lp-=d.lpCost;lpChange(g,side,-d.lpCost,'cost');}
  moveOut(g,c.id);p.playedThisTurn=true;
  const entry={id:secureId('s'),kind:'card',side,card:c,targetId:msg.target||null,chosen:(msg.chosen||[]).slice(0,50)};g.stack.push(entry);g.priority=1-side;g.pass=0;log(g,`PLAYER ${side+1}が《${c.name}》をプレイ`);checkGame(g);return;
 }
 if(t==='summoner'){
  if(g.drawPending||g.block||g.stack.length||g.turn!==side||g.phase!=='MAIN')throw Error('今は召喚士能力を使えません');const summ=p.summoner,sd=cardDef(summ),key=sd.summonerAbilityKey;
  if(sd.summonerTrigger==='turnEnd')throw Error('終了時の能力はEND TURN時に処理します');
  const opts=listMayTarget(g,key,side);if(opts!==null)validateSelection(g,side,key,msg.target||null,[]);
  const l=p.lands.find(x=>!x.tapped&&manaColor(x)===sd.color);if(!l)throw Error(colorWords[sd.color]+'の流脈が必要です');
  if(sd.summonerAbilityCost>1&&!p.mana.length)throw Error('追加マナが不足しています');l.tapped=true;l.spent=true; if(sd.summonerAbilityCost>1){p.mana.shift();}
  const e={id:secureId('s'),kind:'summoner',card:summ,side,key,targetId:msg.target||null};g.stack.push(e);g.priority=1-side;g.pass=0;log(g,`PLAYER ${side+1}が召喚士《${summ.name}》の能力を発動`);return;
 }
 if(t==='pass'){
  if(!g.stack.length||g.priority!==side)throw Error('パスできる優先権がありません');g.pass++;if(g.pass>=2){log(g,'双方がパス：スタックを上から連続解決');resolveStack(g);}else g.priority=1-side;return;
 }
 if(t==='phase'){
  if(g.turn!==side||g.drawPending||g.stack.length||g.block)throw Error('フェイズ変更できません');if(msg.to!=='BATTLE'||g.phase!=='MAIN')throw Error('メインフェイズからバトルフェイズに進む操作だけ可能です');g.phase='BATTLE';log(g,'バトルフェイズ開始');return;
 }
 if(t==='attack'){
  if(g.turn!==side||g.drawPending||g.phase!=='BATTLE'||g.stack.length||g.block)throw Error('今は攻撃できません');const c=target(g,side,msg.card,'field');if(!c||c.tapped||(c.summonSick&&!effectiveFlags(g,c,side).haste)||['cannotAttack'].includes(cardDef(c).effectKey))throw Error('攻撃可能なモンスターを選択してください');
  if(msg.target){const q=target(g,1-side,msg.target,'field');if(!q)throw Error('攻撃対象がいません');if(!q.tapped&&!p.effects.attackUntapped)throw Error('通常はタップ状態の相手だけ攻撃できます');}
  else if(cardDef(c).effectKey==='cannotAttackFace')throw Error('相手プレイヤーには攻撃できません');
  const flags=effectiveFlags(g,c,side);if(cardDef(c).effectKey==='sacLandOnAttack'){if(!p.lands.length)throw Error('攻撃コストの流脈がありません');const x=msg.sacrificeLand?target(g,side,msg.sacrificeLand,'lands'):p.lands.length===1?p.lands[0]:null;if(!x)throw Error('攻撃コストにする流脈を1枚選択してください');moveOut(g,x.id);p.grave.push(x);}
  c.tapped=true;c.spent=true;p.turnAttacks++;
  if(cardDef(c).effectKey==='hasteBurn3')hurt(g,1-side,3);
  g.block={seat:side,attacker:c.id,target:msg.target||null,blocker:null};g.priority=1-side;log(g,`PLAYER ${side+1}が《${c.name}》で攻撃`);
  // An empty defending battlefield cannot choose a blocker. Complete the direct attack immediately.
  if(flags.unblockable||(!msg.target&&!opp.field.some(mon=>!mon.tapped))){battle(g);}return;
 }
 if(t==='block'){
  if(!g.block||g.block.seat===side||g.stack.length)throw Error('ブロック選択中ではありません');
  if(msg.card){const c=target(g,side,msg.card,'field');if(!c||c.tapped)throw Error('アンタップ状態のブロッカーが必要です');c.tapped=true;c.spent=true;g.block.blocker=c.id;if(cardDef(c).effectKey==='blockHpPlus2')modPower(g,c,side,2000,g.turnNo);}
  battle(g);return;
 }
 if(t==='end_turn'){
  if(g.turn!==side||g.drawPending||g.stack.length||g.block)throw Error('まだターンを終了できません');
  const summ=p.summoner,sd=cardDef(summ);
  if(sd.summonerTrigger==='turnEnd'){
    const condition=sd.summonerAbilityKey!=='endDrawIf2Attacks'||p.turnAttacks>=2;
    if(endTurnSummonerPayment(p,sd)&&condition){issueChoice(g,side,'endTurnSummoner',[
      {id:'activate',name:'召喚士のターン終了時能力を使用する（同色流脈≋1 + ≋1）'},
      {id:'skip',name:'能力を使わずターン終了する'}]);return;}
  }
  advanceTurn(g,side);return;
 }
 throw Error('不明な操作です');
}
export function finishChoice(g,side,ids){if(!g.choice||g.choice.seat!==side)throw Error('選択権がありません');const c=g.choice;const unique=[...new Set(ids||[])];if(unique.length<c.min||unique.length>c.max||unique.some(i=>!c.options.some(o=>o.id===i)))throw Error('指定枚数のカードを選択してください');const p=g.players[side];
 if(c.type==='etb_target'){
  const source=zone(g,c.source?.id);
  g.choice=null;
  if(source?.part==='field'&&source.side===side){
    const trigger={id:secureId('s'),kind:'trigger',side,card:source.card,targetId:unique[0],chosen:[]};
    g.stack.push(trigger);g.priority=1-side;g.pass=0;
    log(g,`《${source.card.name}》登場時効果がスタックへ（対象選択済み）`);
  }else log(g,'登場時効果の発生源が戦場にないため不発');
  return;
 }
 if(c.type==='endTurnSummoner'){
  if(unique[0]==='activate'){
    const summ=p.summoner,sd=cardDef(summ),payment=endTurnSummonerPayment(p,sd);
    if(!payment)throw Error('能力に必要な流脈とマナが足りません');
    payEndTurnSummoner(p,payment);
    g.choice=null;g.endingTurnSide=side;
    g.stack.push({id:secureId('s'),kind:'summoner',side,key:sd.summonerAbilityKey,card:summ,targetId:null});
    g.priority=1-side;g.pass=0;
    log(g,`《${summ.name}》のターン終了時誘発効果をスタックに積みました`);
    return;
  }
  g.choice=null;advanceTurn(g,side);return;
 }
 switch(c.type){
 case 'handToFaceDownLand':{const v=zone(g,unique[0]);if(v?.side===side&&v.part==='hand')makeLand(g,v.card,side);break;}
 case 'searchLand':case 'searchMonster':case 'searchSpell':case 'search2Land':for(const id of unique){const v=zone(g,id);if(!v||v.side!==side||v.part!=='deck')continue;moveOut(g,id);if(c.type==='searchLand'||c.type==='search2Land')p.lands.push(v.card);else p.hand.push(v.card);}p.deck=shuffle(p.deck);break;
 case 'bottom4':for(const id of [...unique].reverse()){const v=zone(g,id);if(v?.side===side&&v.part==='hand'){moveOut(g,id);p.deck.unshift(v.card);}}break;
 case 'freeSummon3':{const v=zone(g,unique[0]);if(v?.side===side&&v.part==='hand'){moveOut(g,v.card.id);v.card.summonSick=true;p.field.push(v.card);}}break;
 case 'sacOwn':{const v=zone(g,unique[0]);if(v?.side===side&&v.part==='field')kill(g,v.card,side);break;}
 case 'reorderTop3':{const cards=unique.map(id=>{const v=zone(g,id);return v?.card}).filter(Boolean);p.deck=p.deck.filter(x=>!unique.includes(x.id));p.deck.push(...cards.reverse());break;}
 }
 g.choice=null;if(g.stack.length)resolveStack(g);
}
export function publicCard(c,s,forViewer=false,g=null){const d=DB[c.name];if(c.faceDown)return {id:c.id,name:'裏向き流脈',type:'land',faceDown:true,tapped:c.tapped,spent:c.spent,owner:s,privateName:forViewer?c.name:undefined};return {id:c.id,name:c.name,type:d.t,color:d.color,cost:d.c,power:g&&d.t==='monster'?calcPower(g,c,s):d.power,sp:g&&d.t==='monster'?calcSP(c):d.sp,txt:d.txt,faceDown:false,tapped:c.tapped,summonSick:c.summonSick,spent:c.spent,owner:s,code:d.code};}
export function viewFor(room,seat){const g=room.game;return {room:room.code,seat,rematch:{accepted:[...(room.rematch||[false,false])],closed:!!room.closed,leftSeat:room.leftSeat??null},players:room.players.map((p,i)=>({name:p.name,ready:p.ready,hasDeck:!!p.deckNames,deckName: i===seat?(p.deckNames?.find(n=>DB[n]?.t==='summoner')||''):undefined})),game:g?{
 matchId:g.matchId||1,turn:g.turn,firstSeat:g.firstSeat,turnNo:g.turnNo,phase:g.phase,drawPending:g.turn===seat?g.drawPending:0,opponentDrawPending:g.turn!==seat?g.drawPending:0,effectDraw:g.pendingEffectDraw?{seat:g.pendingEffectDraw.seat,remaining:g.pendingEffectDraw.remaining,total:g.pendingEffectDraw.total,source:g.pendingEffectDraw.source}:null,priority:g.priority,stack:g.stack.map(e=>({id:e.id,name:e.card.name,side:e.side,kind:e.kind})),block:g.block?{seat:g.block.seat,attacker:g.block.attacker,target:g.block.target}:null,choice:g.choice&&g.choice.seat===seat?g.choice:g.choice?{seat:g.choice.seat,waiting:true}:null,over:g.over,winner:g.winner,log:g.log.slice(-15),lifeEvents:(g.lifeEvents||[]).slice(-24),
 players:g.players.map((p,i)=>({lp:p.lp,hand:i===seat?p.hand.map(c=>publicCard(c,i,true,g)):undefined,handCount:p.hand.length,deckCount:p.deck.length,field:p.field.map(c=>publicCard(c,i,false,g)),lands:p.lands.map(c=>publicCard(c,i,i===seat,g)),grave:p.grave.map(c=>publicCard(c,i,false,g)),summoner:publicCard(p.summoner,i,false,g),mana:i===seat?p.mana.map(m=>m.color):undefined,landsPlaced:p.landPlaced,playedThisTurn:p.playedThisTurn}))}:null};}
export {DB};
