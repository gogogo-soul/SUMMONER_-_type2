(()=>{'use strict';
const $=id=>document.getElementById(id);
const STORAGE='summoner_online_pvp_session_v1',SERVER_STORE='summoner_online_worker_url_v1';
let session=null,ws=null,view=null,pending=null,selected=null,armedAttack=null,dialogCb=null,dialogChosen=[],dialogMax=1,dialogMin=1,reconnect=0,manualClose=false,lastMatchId=null,leavingRoom=false,serverVersion='',matchEndError='',resultIntroMatch=null,resultIntroDone=false,resultIntroTimer=null;
const CE=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el};
const n=v=>String(v||'');
const status=(msg,err=false)=>{const n=$('status');n.textContent=msg;n.classList.toggle('err',err);const hud=$('onlineNotice');if(view?.game&&hud&&err){hud.hidden=false;hud.replaceChildren();const message=CE('span','online-notice-text','エラー：'+msg);const close=CE('button','online-notice-close','閉じる ×');close.type='button';close.setAttribute('aria-label','エラー表示を閉じる');close.onclick=()=>{hud.hidden=true;hud.classList.remove('error');};hud.append(message,close);hud.classList.add('error');}};
function dismissError(){const hud=$('onlineNotice');if(hud){hud.hidden=true;hud.classList.remove('error');}}
const server=()=>{const raw=($('serverUrl').value||'').trim().replace(/\/$/,'');if(!raw)return null;try{const u=new URL(raw);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))return null;return u.origin;}catch{return null;}};
function getServer(){return server()}
function saveSession(r){session=r;localStorage.setItem(STORAGE,JSON.stringify(r));}
function forget(){clearTimeout(resultIntroTimer);resultIntroMatch=null;resultIntroDone=false;$('onlineOutcome').classList.add('hidden');dismissError();lastMatchId=null;leavingRoom=false;matchEndError='';selected=null;armedAttack=null;pending=null;$('dialog').classList.add('hidden');$('matchEndPanel').classList.add('hidden');$('roomCode').value='';try{const u=new URL(location.href);u.searchParams.delete('room');history.replaceState(null,'',u.href);}catch(_){}manualClose=true;const oldSocket=ws;ws=null;if(oldSocket)try{oldSocket.close()}catch(_){}session=null;view=null;localStorage.removeItem(STORAGE);$('lobbyWait').classList.add('hidden');$('duelView').classList.add('hidden');document.body.classList.remove('online-active','info-open','hands-compact','attack-targeting');$('onlineFieldCss').disabled=true;$('onlineOverrideCss').disabled=true;$('lobbyView').classList.remove('hidden');status('マッチング画面に戻りました。');}
function titleRoom(){const code=session?.code;if(!code)return '';return code;}
function roomInvite(){const u=new URL('online.html',location.href);u.searchParams.set('room',titleRoom());if(getServer())u.searchParams.set('server',getServer());return u.href;}
async function rest(path,data){const root=getServer();if(!root)throw Error('Cloudflare WorkerのURLを設定してください');const r=await fetch(root+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Error(body.error||`通信エラー HTTP ${r.status}`);return body;}
function send(data){if(!ws||ws.readyState!==WebSocket.OPEN)throw Error('サーバー未接続です');ws.send(JSON.stringify(data));}
function attempt(data){try{send(data)}catch(e){showMatchError(e.message)}}
function showMatchError(msg){const oldWorker=/不正な命令|unknown|unsupported|rematch|leave_room/i.test(msg);matchEndError=oldWorker?'Cloudflareサーバーが旧版の可能性があります。v40のWorker更新後に新しいルームでお試しください。':msg;status(matchEndError,true);if(view?.game?.over)renderMatchEnd(view.game,view.seat);}
async function checkWorkerVersion(){const root=getServer();if(!root)return;try{const r=await fetch(root+'/health',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const info=await r.json();if(root!==getServer())return;serverVersion=info.version||'不明';const compatible=/^alpha2-v(?:3[4-9]|[4-9][0-9])(?:$|\b)/.test(serverVersion);if(!compatible&&view?.game?.over){matchEndError=`Cloudflareは ${serverVersion} です。再戦にはv34以降、確実な退出にはv35が必要です。`;renderMatchEnd(view.game,view.seat);}return info;}catch(e){serverVersion='確認不可';return null;}}
function act(type,extra={}){attempt({type:'action',action:{type,...extra}});}
function connect(){if(!session||!getServer())return;manualClose=false; if(ws&&ws.readyState<=1)ws.close(); const url=getServer().replace(/^http/,'ws')+`/api/rooms/${session.code}/socket`;ws=new WebSocket(url);const thisSocket=ws;
 status('対戦サーバーへ接続しています…');
 ws.onopen=()=>{if(ws!==thisSocket)return;reconnect=0;send({type:'auth',token:session.token});status('対戦サーバーに接続しました。');checkWorkerVersion();};
 ws.onmessage=e=>{if(ws!==thisSocket)return;let m;try{m=JSON.parse(e.data)}catch{return}if(m.type==='error'){leavingRoom=false;showMatchError(m.error||'サーバーで処理できませんでした。');return;}if(m.type==='left_room'){forget();status('マッチングに戻りました。新しいルームを作成、または参加してください。');return;}if(m.type==='state'){const prevId=view?.game?.matchId;view=m.data;if(!view?.game?.over||view?.game?.matchId!==prevId)matchEndError='';render();status(`ルーム ${session.code} に接続中／PLAYER ${session.seat+1}`);}};
 ws.onclose=e=>{if(ws!==thisSocket||manualClose)return;if(e.code===1008){forget();status('このルームの接続が終了したため、マッチング画面に戻りました。');return;}leavingRoom=false;showMatchError('通信が切断されました。再接続しています。再戦操作は接続が回復してから行ってください。');const sec=Math.min(20,1+Math.pow(2,Math.min(++reconnect,4)));setTimeout(()=>{if(!manualClose&&session)connect()},sec*1000)};
 ws.onerror=()=>showMatchError('通信エラー。接続先・ネットワーク・Cloudflareの設定を確認してください。');
}
function currentUser(){return localStorage.getItem('arcana_duel_current_user')||'Guest'}
function listDecks(){const list=[];for(const st of window.SUMMONER_STARTER_DECKS||[]){list.push({label:'初期：'+st.name,deck:st.counts});}
 const saved=JSON.parse(localStorage.getItem(`arcana_duel_decks_${currentUser()}`)||'{}');for(const [name,counts] of Object.entries(saved)){list.push({label:'保存：'+name,deck:counts});}return list;}
let availableDecks=[];
let lastLifeSeq=0;
function updateLpText(id,amount){const el=$(id),text=`${amount} LP`,old=el.querySelector('.online-lp-value');if(old){old.textContent=text;}else{el.textContent='';el.append(CE('span','online-lp-value',text));}}
function showLifeEvents(events,me){const fresh=(events||[]).filter(x=>x.seq>lastLifeSeq),offsets={0:0,1:0};for(const evt of fresh){lastLifeSeq=Math.max(lastLifeSeq,evt.seq);if(!Number(evt.amount))continue;const badge=CE('span','online-lp-delta '+(evt.kind==='heal'?'life-heal':evt.kind==='cost'?'life-cost':'life-damage'),(evt.amount>0?'+':'')+evt.amount);badge.style.setProperty('--life-offset',(offsets[evt.side]++*23)+'px');badge.setAttribute('aria-label',(evt.kind==='cost'?'LPコスト':evt.kind==='heal'?'回復':'ダメージ')+' '+evt.amount);const anchor=$(evt.side===me?'myLP':'opLP');anchor.append(badge);if(evt.amount<0)lifeShatter(anchor);badge.addEventListener('animationend',()=>badge.remove(),{once:true});setTimeout(()=>badge.remove(),2600);}}
function lifeShatter(anchor){
 // Short glass-break animation, anchored to the damaged player's LP, no effect on game state.
 anchor.classList.remove('online-lp-impact');void anchor.offsetWidth;anchor.classList.add('online-lp-impact');
 const layer=CE('span','online-shatter-layer');layer.setAttribute('aria-hidden','true');
 const shards=11;
 for(let i=0;i<shards;i++){const piece=CE('i','online-glass-piece');const angle=(Math.PI*2*i/shards);const d=25+(i%4)*12;piece.style.setProperty('--dx',Math.round(Math.cos(angle)*d)+'px');piece.style.setProperty('--dy',Math.round(Math.sin(angle)*d)+'px');piece.style.setProperty('--spin',(i%2?-1:1)*(110+i*37)+'deg');piece.style.setProperty('--delay',(i%3)*22+'ms');layer.append(piece);}
 anchor.append(layer);setTimeout(()=>{layer.remove();anchor.classList.remove('online-lp-impact')},820);
}
function refreshDecks(){availableDecks=listDecks();const select=$('deckPick');select.replaceChildren();availableDecks.forEach((item,i)=>{const o=CE('option','',item.label);o.value=String(i);select.append(o)});}
function deckAsNames(counts){const d=[];for(const [name,num] of Object.entries(counts||{}))for(let i=0;i<Number(num);i++)d.push(name);return d;}
function renderLobby(){if(!view)return;const playerList=$('roomPlayers');playerList.replaceChildren();view.players.forEach((p,i)=>{const row=CE('div','player-info');row.append(CE('span','',`PLAYER ${i+1}：${p.name||'参加待ち'}`),CE('span','',`${p.hasDeck?'デッキ登録済み':'未登録'}／${p.ready?'準備完了':'未準備'}`));playerList.append(row)});const mine=view.players[view.seat];$('ready').textContent=mine.ready?'準備完了を取り消す':'準備完了';$('roomLabel').textContent=view.room;$('lobbyWait').classList.remove('hidden');}
function empty(node){node.replaceChildren();}
const ICONS={monster:'△',spell:'✦',land:'≋',summoner:'◎'};
const jpType={monster:'モンスター',spell:'魔法',land:'流脈',summoner:'召喚士'};
function isInstant(c){return DB[c.name]?.timing==='instant'||String(c.txt||DB[c.name]?.txt||'').includes('高速詠唱');}
function canCastNow(c){const g=view?.game;if(!g||g.over||g.drawPending||g.effectDraw||g.choice)return false;
 const me=view.seat;if(!isInstant(c))return g.turn===me&&g.phase==='MAIN'&&!g.stack.length&&!g.block;
 return !g.stack.length||g.priority===me;}
function canPlaceFlowVein(){const g=view?.game,me=view?.seat;if(!g||me==null||g.over)return false;const p=g.players[me];return g.turn===me&&g.phase==='MAIN'&&!g.drawPending&&!g.effectDraw&&!g.choice&&!g.stack.length&&!g.block&&!p.landsPlaced&&!p.playedThisTurn;}
function hasMana(c){const me=view?.seat;if(me==null)return false;const mana=view.game.players[me].mana||[],n=Number(c.cost)||0;
 return mana.length>=n&&(n===0||!c.color||c.color==='none'||mana.includes(c.color));}
function makeCard(c,handler=null,back=false,part=null,side=null){
 const d=DB[c.name]||{};
 const hidden=back||c.faceDown;
 const affordable=part==='hand'&&side===view?.seat&&c.type!=='land'&&canCastNow(c)&&hasMana(c);
 const klass='card '+(hidden?'back':c.type||'')+(!hidden&&c.color&&c.color!=='none'?' color-'+c.color:'')+(c.tapped?' tapped':'')+(part==='field'&&c.summonSick&&c.type==='monster'?' summon-sick':'')+(affordable?' affordable-red':'')+(armedAttack&&c.id===armedAttack.id?' attack-ready':'');
 const node=CE('div',klass);node.dataset.id=c.id||'';
 if(hidden){node.append(CE('div','name',back?'裏向きカード':'裏向き流脈'),CE('div','art',back?'✦':'≋'));}
 else{
  node.append(CE('div','name',c.name),CE('div','type',`${c.code||d.code||''}${(c.code||d.code)?' / ':''}${jpType[c.type]||''}${d.race?' / '+d.race:''}`));
  if(c.type!=='land'&&c.type!=='summoner')node.append(CE('div','cost',String(c.cost??d.c??0)));
  node.append(CE('div','art',isInstant(c)?'⚡':ICONS[c.type]||'✦'));
  if(c.type==='monster')node.append(CE('div','power-stat',String(c.power??d.power??0)),CE('div','sp-stat',String(c.sp??d.sp??0)));
 }
 if(handler){node.setAttribute('role','button');node.tabIndex=0;node.addEventListener('click',()=>handler(c,node));node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();handler(c,node)}});}
 return node;
}
function putCards(node,cards,part,side){node.replaceChildren();for(const c of cards||[])node.append(makeCard(c,(x,dom)=>onBoardCard(x,part,side,dom),false,part,side));
 if(part==='hand'){const list=[...node.children];const mid=(list.length-1)/2;list.forEach((card,i)=>{card.style.setProperty('--fan-angle',((i-mid)*1.25)+'deg');card.style.setProperty('--fan-y',(Math.abs(i-mid)*.75)+'px');});}}
function cardAction(parent,label,callback,title,cls=''){
 const b=CE('button',cls,label);b.type='button';b.title=title;b.addEventListener('click',e=>{e.stopPropagation();callback();});parent.append(b);return b;
}
function syncCardControls(){
 $('duelView').querySelectorAll('.card-controls').forEach(n=>n.remove());
 $('duelView').querySelectorAll('.card.selected').forEach(n=>n.classList.remove('selected'));
 if(!selected||!view?.game||view.game.over)return;
 const g=view.game,me=view.seat,{c,part,side}=selected;
 const dom=[...$('duelView').querySelectorAll('.card[data-id]')].find(n=>n.dataset.id===c.id);if(!dom)return;dom.classList.add('selected');
 if(side!==me)return;
 const isLand=part==='lands',isField=part==='field',isHandVein=part==='hand'&&c.type==='land',isSummoner=part==='summoner';
 if(!isLand&&!isField&&part!=='hand'&&!isSummoner)return;
 const controls=CE('div','card-controls');
 if(part==='hand'&&c.type!=='summoner'){
  const b=cardAction(controls,'置',()=>act('land',{card:c.id}),c.type==='land'?'流脈を表向きで置く':'このカードを裏向きの流脈として置く','place-btn');b.disabled=!canPlaceFlowVein();
  if(c.type!=='land'){const play=cardAction(controls,'▶',()=>playWithTarget(c),'カードを通常プレイ','play-btn');play.disabled=!canCastNow(c)||!hasMana(c);}
 }
 else if(isLand){const locked=!!c.tapped&&!!c.spent;const b=cardAction(controls,locked?'🔒':c.tapped?'↶':'↷',()=>act(c.tapped?'untap_land':'tap_land',{card:c.id}),locked?'使用済み流脈はアンタップできません':c.tapped?'未使用マナを取り消す':'タップしてマナを生成');b.disabled=locked||!!g.choice;}
 else if(isSummoner){const d=DB[c.name],automatic=d?.summonerTrigger==='turnEnd';const b=cardAction(controls,'効',summonAbility,automatic?'ターン終了時に発動条件を確認する召喚士です':'召喚士能力を発動','ability-btn');b.disabled=!d?.summonerAbilityKey||!automatic&&(!canActivateSummoner());}
 else if(isField&&c.type==='monster'){
  // Manual tapping/untapping of battlefield monsters is not allowed.
  if(DB[c.name]?.effectKey==='tapBurn2'){
    const x=cardAction(controls,'⚡',()=>act('monster_ability',{card:c.id}),'このモンスターのタップ能力','ability-btn');x.disabled=g.turn!==me||c.tapped;
  }
 }
 if(controls.children.length)dom.append(controls);
}
function onBoardCard(c,part,side,dom){
 const g=view?.game;if(!g||g.over)return;
 const me=view.seat;
 if(g.block&&g.block.seat!==me&&side===me&&part==='field'&&!c.tapped){act('block',{card:c.id});return;}
 if(armedAttack&&side===1-me&&part==='summoner'){const attacker=g.players[me].field.find(x=>x.id===armedAttack.id);if(attacker){attackOnTarget(attacker,null);return;}}
 if(armedAttack&&side===1-me&&part==='field'){
   const attacker=g.players[me].field.find(x=>x.id===armedAttack.id);
   if(attacker){attackOnTarget(attacker,c.id);return;}
 }
 openCard(c,part,side,dom);
 if(side!==me)return;
 if(part==='hand'&&c.type!=='land'&&c.type!=='summoner'){
   openPlayMethod(c);return;
 }
 // Click selects a Summoner; the '効' marker activates its ability.
 if(part==='field'&&c.type==='monster'&&g.turn===me&&g.phase==='BATTLE'&&!g.block){
    if(c.tapped||c.summonSick&&!DB[c.name]?.haste){status('このモンスターは現在攻撃できません',true);return;}
    armedAttack={id:c.id};document.body.classList.add('attack-targeting');$('turnHelp').textContent=`《${c.name}》で攻撃：相手のモンスターまたは召喚士を選択してください。`;
    $('opSummoner').title='召喚士をクリックしてプレイヤーへ直接攻撃';
    $('duelView').querySelectorAll('.card.attack-ready').forEach(n=>n.classList.remove('attack-ready'));
    dom.classList.add('attack-ready');
 }
}
function attackOnTarget(c,targetId=null){
 const g=view.game,me=view.seat;
 const submit=(sacrificeLand=null)=>{armedAttack=null;document.body.classList.remove('attack-targeting');act('attack',{card:c.id,target:targetId,sacrificeLand});};
 if(DB[c.name]?.effectKey==='sacLandOnAttack'){
  const lands=g.players[me].lands;if(!lands.length){status('攻撃に必要な流脈がありません',true);return;}
  doDialog('《'+c.name+'》：攻撃コスト','墓地に置く流脈を選択してください。',lands.map(readable),1,1,ids=>submit(ids[0]));
 }else submit();
}
function backs(node,count){node.replaceChildren();for(let i=0;i<count;i++)node.append(makeCard({name:'',type:'unknown'},null,true));}
const colorWord=c=>({red:'赤',blue:'青',green:'緑',yellow:'黄',black:'黒',none:'無色'})[c]||'無色';
function prettyMana(m){return (m||[]).length?m.map(c=>colorWord(c)).join(' / '):'なし';}
function button(parent,text,fn,klass){const b=CE('button',klass||'',text);b.onclick=fn;parent.append(b);return b;}
function renderDuel(){
 const g=view.game,me=view.seat,enemy=1-me,mine=g.players[me],op=g.players[enemy];
 if(lastMatchId!==g.matchId){clearTimeout(resultIntroTimer);resultIntroMatch=null;resultIntroDone=false;$('onlineOutcome').classList.add('hidden');dismissError();lastMatchId=g.matchId;if($('onlineCardPopup'))$('onlineCardPopup').hidden=true;lastLifeSeq=Math.max(0,...(g.lifeEvents||[]).map(e=>e.seq));clearCardSelection();armedAttack=null;pending=null;$('dialog').classList.add('hidden');$('cardInfo').textContent='カードを選択すると詳細が表示されます。';}
 $('lobbyView').classList.add('hidden');$('duelView').classList.remove('hidden');
 document.body.classList.add('online-active');$('onlineFieldCss').disabled=false;$('onlineOverrideCss').disabled=false;
 $('myName').textContent=`PLAYER ${me+1}：${view.players[me].name}（自分）`;
 $('opName').textContent=`PLAYER ${enemy+1}：${view.players[enemy].name}`;
 updateLpText('myLP',mine.lp);updateLpText('opLP',op.lp);showLifeEvents(g.lifeEvents,me);
 $('myMana').replaceChildren();for(const m of mine.mana||[]){const icon=CE('span','mana-icon '+m,({red:'🔴',blue:'🔵',green:'🟢',yellow:'🟡',black:'🟣',none:'⚪'})[m]||'⚪');$('myMana').append(icon);} 
 $('opHandLabel').textContent=`相手の手札 ${op.handCount}枚 — 非公開`;
 $('opHandCount').textContent=String(op.handCount);$('handCount').textContent=mine.hand.length+' cards';$('topTurn').textContent='TURN '+g.turnNo;
 $('opLandCount').textContent=String(op.lands.length);$('myLandCount').textContent=String(mine.lands.length);
 backs($('opHand'),op.handCount);
 putCards($('opField'),op.field,'field',enemy);putCards($('myField'),mine.field,'field',me);
 putCards($('opLands'),op.lands,'lands',enemy);putCards($('myLands'),mine.lands,'lands',me);
 putCards($('opSummoner'),[op.summoner],'summoner',enemy);putCards($('mySummoner'),[mine.summoner],'summoner',me);
 const handScroll=$('myHand').scrollLeft;putCards($('myHand'),mine.hand,'hand',me);$('myHand').scrollLeft=handScroll;
 $('opDeckCount').textContent=String(op.deckCount);$('myDeckCount').textContent=String(mine.deckCount);
 $('opGraveCount').textContent=String(op.grave.length);$('myGraveCount').textContent=String(mine.grave.length);
 $('opGrave').onclick=()=>openGrave(enemy);$('myGrave').onclick=()=>openGrave(me);$('opDeck').onclick=()=>status('山札の中身を見ることはできません。');$('myDeck').onclick=()=>status('山札の中身を見ることはできません。');
 const cur=g.turn===me?'あなた':'相手';
 $('phaseLabel').textContent=g.over?(g.winner===me?'勝利！':g.winner==null?'引き分け':'敗北'):`PLAYER ${g.turn+1} TURN`;document.querySelector('#duelView .centerbar .phase').textContent=g.phase==='MAIN'?'MAIN PHASE':'BATTLE PHASE';
 const stack=$('stackCenter');stack.replaceChildren();for(const x of g.stack)stack.append(CE('div','stack-entry',`PLAYER ${x.side+1}：《${x.name}》`));
 $('centralStackPanel').hidden=!g.stack.length;
 $('stackPriority').textContent=g.stack.length?`優先権：PLAYER ${g.priority+1}`:'';
 const progress=$('drawProgressPanel');progress.hidden=!(g.effectDraw||g.drawPending||g.opponentDrawPending||g.choice&&!g.choice.waiting);
 if(!progress.hidden)progress.textContent=g.effectDraw?`《${g.effectDraw.source}》：${g.effectDraw.total}枚ドロー / 残り${g.effectDraw.remaining}枚（${g.effectDraw.seat===me?'DRAWを押してください':'相手の処理待ち'}）`:g.drawPending?'DRAW：カードを1枚引いてください':g.opponentDrawPending?'相手がドロー処理中…':'効果処理中：カード選択待ち';
 $('drawBtn').disabled=g.over||!(g.effectDraw?g.effectDraw.seat===me:g.turn===me&&g.drawPending);
 $('battleBtn').disabled=g.over||g.turn!==me||g.phase!=='MAIN'||g.drawPending>0||!!g.effectDraw||g.stack.length>0||!!g.block;
 $('endBtn').disabled=g.over||g.turn!==me||g.drawPending>0||!!g.effectDraw||g.stack.length>0||!!g.block;
 $('passBtn').disabled=g.over||!g.stack.length||g.priority!==me;
 $('summonerBtn').disabled=g.over||g.turn!==me||g.phase!=='MAIN'||g.drawPending>0||!!g.effectDraw||g.stack.length>0||!!g.block;
 $('surrenderBtn').disabled=g.over;
 if($('surrenderConfirm')&&g.over)$('surrenderConfirm').classList.add('hidden');
 const b=$('noBlockBtn');b.disabled=!(g.block&&g.block.seat!==me&&!g.over);
 let headline='',explain='';
 if(g.effectDraw){headline=g.effectDraw.seat===me?'効果のドロー処理':'相手の効果処理';explain=`《${g.effectDraw.source}》：残り${g.effectDraw.remaining}枚のドロー`; }
 else if(g.over){headline=g.winner==null?'引き分け':g.winner===me?'勝利！':'敗北';explain='対戦は終了しました。';}
 else if(g.choice){headline=g.choice.waiting?'相手が選択中':'カードを選択してください';explain='効果の選択完了を待っています。';}
 else if(g.block){headline=g.block.seat===me?'ブロック待ち':'ブロッカーを選択';explain='NO BLOCKを押すとブロックしません。';}
 else if(g.stack.length){headline=g.priority===me?'あなたの優先権':'相手の優先権';explain='高速詠唱を使うかPASSを押します。';}
 else if(g.drawPending||g.opponentDrawPending){headline=g.turn===me?'ドローしてください':'相手がドロー中';explain='DRAW後にメインフェイズへ進みます。';}
 else{headline=g.turn===me?'あなたのターン':'相手のターン';explain=`先攻はPLAYER ${g.firstSeat+1}（サーバーでランダム決定）。`}
 $('turnStatus').textContent=g.phase==='MAIN'?'MAIN PHASE':'BATTLE PHASE';$('turnHelp').textContent=headline+' — '+explain;
 renderMatchEnd(g,me);
 const logs=$('gameLog');logs.replaceChildren();for(const x of [...g.log].reverse())logs.append(CE('div','',x));
 if(armedAttack){const c=mine.field.find(x=>x.id===armedAttack.id);if(!c||g.turn!==me||g.phase!=='BATTLE'||g.over||g.block){armedAttack=null;document.body.classList.remove('attack-targeting');}}
 if(selected){const fresh=g.players[selected.side]?.[selected.part==='hand'?'hand':selected.part==='field'?'field':selected.part==='lands'?'lands':'summoner'];const next=Array.isArray(fresh)?fresh.find(x=>x.id===selected.c.id):null;if(next)selected.c=next;else selected=null;}
 syncCardControls();
 if(g.choice&&!g.choice.waiting&&g.choice.seat===me&&!pending)promptChoice(g.choice);
}
function renderMatchEnd(g,me){
 const box=$('matchEndPanel'),result=$('matchEndTitle'),details=$('matchEndDetails'),waiting=$('matchEndWaitStatus'),rematch=$('rematchBtn'),back=$('backToMatchBtn'),error=$('matchEndError');
 if(!g.over){box.classList.add('hidden');$('onlineOutcome').classList.add('hidden');clearTimeout(resultIntroTimer);resultIntroMatch=null;resultIntroDone=false;leavingRoom=false;matchEndError='';return;}
 if(resultIntroMatch!==g.matchId){
   resultIntroMatch=g.matchId;resultIntroDone=false;
   const intro=$('onlineOutcome');intro.classList.remove('hidden','outcome-win','outcome-lose','outcome-draw');
   const kind=g.winner==null?'draw':g.winner===me?'win':'lose';intro.classList.add('outcome-'+kind);
   $('onlineOutcomeText').textContent=kind==='win'?'WIN':kind==='lose'?'LOSE':'DRAW';
   box.classList.add('hidden');clearTimeout(resultIntroTimer);
   resultIntroTimer=setTimeout(()=>{resultIntroDone=true;intro.classList.add('hidden');if(view?.game?.over&&view.game.matchId===resultIntroMatch)renderMatchEnd(view.game,view.seat)},2900);
 }
 if(!resultIntroDone){box.classList.add('hidden');return;}
 box.classList.remove('hidden');
 if(!matchEndError&&serverVersion&&serverVersion!=='確認不可'&&!/^alpha2-v(?:3[5-9]|[4-9][0-9])(?:$|\b)/.test(serverVersion))matchEndError=`Cloudflareのサーバーは ${serverVersion} です。最新v40へ更新してください（再戦・退出にはサーバー側の更新も必要です）。`;
 result.textContent=g.winner==null?'引き分け':g.winner===me?'勝利！':'敗北';
 details.textContent=g.winner==null?'引き分けで対戦が終了しました。':g.winner===me?'対戦に勝利しました。':'対戦に敗北しました。';
 const r=view.rematch||{},own=!!r.accepted?.[me],op=!!r.accepted?.[1-me];
 if(r.closed){waiting.textContent='相手がルームを退出しました。再戦はできません。';}
 else if(own){waiting.textContent=op?'再戦準備中です…':'再戦を希望しました。相手の選択を待っています。';}
 else if(op){waiting.textContent='相手が再戦を希望しています。';}
 else{waiting.textContent='続けて遊ぶ場合は、両プレイヤーが「再戦」を選んでください。';}
 error.hidden=!matchEndError;error.textContent=matchEndError;rematch.disabled=!!r.closed||leavingRoom;
 rematch.textContent=own?'再戦希望を取り消す':'続けて遊ぶ（再戦）';
 back.disabled=leavingRoom;
 back.textContent=leavingRoom?'退出しています…':'マッチングに戻る';
}
function backToMatching(){
 if(leavingRoom)return;
 if(!view?.game?.over)return showMatchError('試合終了後に選択してください。');
 // Exit UI immediately, even if the connection has already failed. A REST request
 // revokes the server-side seat; unlike closing a WebSocket, it has a response.
 const s=session?{...session}:null,root=getServer();
 forget();
 if(!s||!root){status('マッチング画面に戻りました。退出通知は送れませんでした。',true);return;}
 status('マッチングに戻りました。サーバーに退出を通知しています…');
 fetch(root+`/api/rooms/${encodeURIComponent(s.code)}/leave`,{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({token:s.token}),keepalive:true
 }).then(async r=>{const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||`HTTP ${r.status}`);return body;})
 .then(()=>{if(!session)status('マッチングに戻りました。ルームから退出しました。');})
 .catch(e=>{if(!session)status('マッチングには戻りましたが、サーバーへの退出通知は未完了です。Cloudflareをv40に更新してください。 ('+e.message+')',true);});
}
$('rematchBtn').onclick=()=>{
 if(!view?.game?.over||view.rematch?.closed)return;
 if(!ws||ws.readyState!==WebSocket.OPEN){showMatchError('通信が切れています。再接続後に再戦を押してください。');return;}
 matchEndError='';renderMatchEnd(view.game,view.seat);
 const requested=!!view.rematch?.accepted?.[view.seat];
 attempt({type:'rematch',accept:!requested});
};
$('backToMatchBtn').onclick=backToMatching;
function inspectCard(c){
 const info=$('cardInfo');info.replaceChildren();
 if(!c){info.append(CE('div','big','No card selected'),CE('div','sub','カードを選択してください'),CE('p','','手札や戦場のカードをクリックすると、ここに詳細が表示されます。'));return;}
 const d=DB[c.name]||{};if(c.faceDown){info.append(CE('div','big','裏向き流脈'),CE('div','sub','無色マナを生成'),CE('p','','裏向きの流脈です。'+(c.privateName?' 元カード：《'+c.privateName+'》':'')));return;}
 const head=CE('div','big',c.name),meta=CE('div','sub',`${c.code||d.code||''} / ${jpType[c.type]||''} ${d.race?' / '+d.race:''} ${c.color&&c.color!=='none'?'【'+colorWord(c.color)+'】':''}${c.type==='monster'||c.type==='spell'?' コスト '+(c.cost||0):''}${isInstant(c)?' 【高速詠唱】':''}`);
 info.append(head,meta,CE('p','',c.txt||d.txt||''));if(c.type==='monster')info.append(CE('p','',`パワー ${c.power||0} / SP ${c.sp||0}`));
}
function openGrave(side){const g=view.game;const list=g.players[side].grave;const title=side===view.seat?'自分の墓地':'相手の墓地';
 if(!list.length){status(title+'は空です');return;}
 doDialog(title,`${list.length}枚。選択するとカードの詳細を表示します。`,[...list].reverse().map(readable),1,1,ids=>{const x=list.find(c=>c.id===ids[0]);if(x)inspectCard(x);});
}
function clearCardSelection(){selected=null;syncCardControls();}
function showCardPopup(c){const box=$('onlineCardPopup');if(!box||!c)return;const d=DB[c.name]||{};box.replaceChildren();const close=CE('button','online-popup-close','×');close.type='button';close.setAttribute('aria-label','閉じる');close.onclick=()=>{box.hidden=true;};box.append(close,CE('h3','',c.faceDown?'裏向き流脈':c.name),CE('div','online-popup-meta',c.type==='monster'?`パワー ${c.power??d.power??0} / SP ${c.sp??d.sp??0}`:`${jpType[c.type]||''} / コスト ${c.cost??d.c??0}`),CE('p','',c.faceDown?'無色の流脈として扱います':c.txt||d.txt||'効果なし'));box.hidden=false;}
function openCard(c,part,side,dom){
 if(!view?.game)return;selected={c,part,side};inspectCard(c);showCardPopup(c);if(window.innerWidth>900)document.body.classList.add('info-open');syncCardControls();
}
// Direct attack is selected by clicking the opponent Summoner, not their LP.
function doDialog(title,help,opts,min,max,callback){pending={title};dialogCb=callback;dialogChosen=[];dialogMin=min;dialogMax=max;$('dialogCancel').disabled=false;$('dialogTitle').textContent=title;$('dialogHelp').textContent=help;$('dialog').classList.remove('hidden');const area=$('dialogOptions');empty(area);for(const opt of opts){const b=button(area,opt.label,()=>{if(dialogMax===1){dialogChosen=[opt.id];update();return}if(dialogChosen.includes(opt.id))dialogChosen=dialogChosen.filter(x=>x!==opt.id);else if(dialogChosen.length<dialogMax)dialogChosen.push(opt.id);update();});b.dataset.id=opt.id;b.dataset.label=opt.label;}
 function update(){for(const b of area.querySelectorAll('button')){const i=dialogChosen.indexOf(b.dataset.id);b.classList.toggle('active',i>=0);b.textContent=(i>=0&&dialogMax>1?`${i+1}. `:'')+(b.dataset.label||b.textContent.replace(/^\d+\. /,''));}$('dialogOk').disabled=dialogChosen.length<min||dialogChosen.length>max;}
 update();}
function clearDialog(){pending=null;dialogCb=null;$('dialog').classList.add('hidden');}
$('dialogCancel').onclick=()=>{if(pending?.forced)return;clearDialog();};$('dialogOk').onclick=()=>{const cb=dialogCb,sel=[...dialogChosen];clearDialog();cb?.(sel);};
function choices(key,side){const g=view.game,own=g.players[side],enemy=g.players[1-side];const ownMon=own.field,oppMon=enemy.field;
 switch(key){
 case 'damageOpp2':case 'hpMinus1EOT':case 'hpMinus2EOT':case 'destroyOppMonster':case 'tapOppOnSummon':case 'oppToFaceDownLand':case 'hpMinus1NextEnd':case 'oppSpMinus1NextEnd':case 'oppBlockPowerPlus2NextEnd':return oppMon;
 case 'hpMinus3UntappedOpp':return oppMon.filter(x=>!x.tapped);
 case 'destroyOppLand':return enemy.lands;
 case 'bounceAny':return [...ownMon,...oppMon];
 case 'recoverOne':case 'graveToFaceDownLand':case 'recoverUpTo2':return own.grave.filter(x=>x.type==='monster');
 case 'ownToFaceDownLand':case 'ownSpPlus1':case 'grantHaste':case 'grantUnblockable':case 'grantDeathtouch':case 'forceAttackTarget':case 'atkPlus1':return ownMon;
 case 'tapUpTo2':return oppMon;
 case 'counterPlay':return g.stack.filter(s=>s.side!==side&&s.kind==='card');
 case 'chooseBurn3':return [...oppMon,{id:'player',name:'相手プレイヤー'}];
 case 'soulDrain':return ownMon;
 case 'destroyOneEach':return ownMon;
 default:return null;
 }
}
function readable(o){return {id:o.id,label:(o.name||'裏向き')+(o.power?` / POWER ${o.power}`:'')};}
function openPlayMethod(c){
 const options=[];if(canCastNow(c)&&hasMana(c))options.push({id:'play',label:`通常プレイ（コスト ${c.cost||0}）`});
 if(canPlaceFlowVein())options.push({id:'land',label:'裏向きで流脈ゾーンに置く（無色マナ）'});
 if(!options.length){status('通常プレイに必要なマナ、流脈配置のタイミングを確認してください。',true);return;}
 doDialog(`《${c.name}》のプレイ方法を選択`,'通常プレイ、または手札から裏向き流脈として配置します。',options,1,1,ids=>{if(ids[0]==='land')act('land',{card:c.id});else playWithTarget(c);});
}
function playWithTarget(c){if(c.type==='monster'&&String(c.txt||DB[c.name]?.txt||'').includes('登場時')){act('play',{card:c.id});return;}const key=DB[c.name]?.effectKey;const available=choices(key,view.seat);
 if(key==='destroyOneEach'){
  const own=view.game.players[view.seat].field,opp=view.game.players[1-view.seat].field;
  if(!own.length||!opp.length)return status('自分と相手に対象モンスターが必要です',true);
  doDialog('《'+c.name+'》：自分のモンスター','1体を対象に選択',own.map(readable),1,1,one=>doDialog('《'+c.name+'》：相手のモンスター','1体を対象に選択',opp.map(readable),1,1,two=>act('play',{card:c.id,chosen:[one[0],two[0]]})));return;
 }
 if(available===null){act('play',{card:c.id});return;}
 if(!available.length){if(c.type==='monster')act('play',{card:c.id});else status('発動対象がいないためこのカードは使えません',true);return;}
 if(['soulDrain','recoverUpTo2','tapUpTo2'].includes(key)){
  const max=key==='soulDrain'?available.length:2;const min=key==='soulDrain'?1:0;
  doDialog('《'+c.name+'》：対象を選択',`${min}〜${max}体を選択`,available.map(readable),min,max,chosen=>act('play',{card:c.id,chosen}));return;
 }
 doDialog('《'+c.name+'》：対象を選択','対象を指定してからスタックへ積みます。',available.map(readable),1,1,ids=>act('play',{card:c.id,target:ids[0]}));
}
function attackWithTarget(c){
 const g=view.game,me=view.seat,opp=g.players[1-me].field;
 const chooseTarget=(sacrificeLand=null)=>{
  const list=[{id:'',label:'相手プレイヤーへ直接攻撃（SPダメージ）'},...opp.map(x=>({id:x.id,label:`《${x.name}》 (P${x.power}) ${x.tapped?'タップ':'アンタップ'}`}))];
  doDialog('攻撃対象を選択','相手プレイヤー、または攻撃可能な相手モンスターを指定してください。',list,1,1,ids=>act('attack',{card:c.id,target:ids[0]||null,sacrificeLand}));
 };
 if(DB[c.name]?.effectKey==='sacLandOnAttack'){
  const lands=g.players[me].lands;if(!lands.length){status('攻撃に必要な流脈がありません',true);return;}
  doDialog('《'+c.name+'》：攻撃コスト','墓地に置く自分の流脈を1枚選んでください。',lands.map(readable),1,1,ids=>chooseTarget(ids[0]));
 }else chooseTarget();
}
function canActivateSummoner(){const g=view?.game;if(!g||g.over)return false;const me=view.seat,sd=DB[g.players[me].summoner.name];if(!sd||sd.summonerTrigger==='turnEnd'||!sd.summonerAbilityKey)return false;return g.turn===me&&g.phase==='MAIN'&&!g.drawPending&&!g.effectDraw&&!g.block&&!g.choice&&!g.stack.length;}
function summonAbility(){const g=view?.game;if(!g||g.over)return;const me=view.seat,c=g.players[me].summoner,d=DB[c.name],key=d?.summonerAbilityKey;if(!key){status('この召喚士には起動能力がありません',true);return;}
 if(d.summonerTrigger==='turnEnd'){status(`《${c.name}》はターン終了時に判定される能力です。条件を満たしてEND TURNを押すと発動を選べます。`);return;}
 if(!canActivateSummoner()){status('召喚士能力は自分のメインフェイズ、他の処理がないときに発動できます。',true);return;}
 const land=g.players[me].lands.find(l=>!l.faceDown&&!l.tapped&&l.color===d.color);if(!land){status(`${colorWord(d.color)}の未タップ流脈が1枚必要です。裏向き流脈は無色なので使えません。`,true);return;}
 if((d.summonerAbilityCost||0)>1&&!(g.players[me].mana||[]).length){status('追加マナが1つ必要です。別の流脈をタップしてから発動してください。',true);return;}
 const opts=choices(key,me);if(opts===null){act('summoner');return;}if(!opts.length){status('召喚士能力の対象がいません',true);return;}doDialog('召喚士《'+c.name+'》',`${colorWord(d.color)}の流脈≋1をコストとしてタップします。`,opts.map(readable),1,1,x=>act('summoner',{target:x[0]}));}
function promptChoice(choice){const opts=choice.options.map(x=>({id:x.id,label:x.name}));const endTrigger=choice.type==='endTurnSummoner';doDialog(endTrigger?'召喚士の誘発効果':choice.type==='reorderTop3'?'山札の上からの順番を指定':'カードを選択',endTrigger?'ターン終了時の能力です。コストを支払って発動するか選んでください。':choice.type==='reorderTop3'?'1→2→3の順にカードを選んでください。番号1が山札の一番上です。':'選択順は1、2、3…の数字で表示します。',opts,choice.min,choice.max,ids=>attempt({type:'choose',ids}));pending.forced=true;$('dialogCancel').disabled=true;}
$('noBlockBtn').onclick=()=>act('block');$('drawBtn').onclick=()=>act('draw');$('battleBtn').onclick=()=>act('phase',{to:'BATTLE'});$('endBtn').onclick=()=>act('end_turn');$('passBtn').onclick=()=>act('pass');$('summonerBtn').onclick=summonAbility;
$('surrenderBtn').onclick=()=>{const modal=$('surrenderConfirm');if(!modal||!view?.game||view.game.over)return;modal.classList.remove('hidden');};
$('surrenderYes').onclick=()=>{$('surrenderConfirm').classList.add('hidden');};
$('surrenderNo').onclick=()=>{$('surrenderConfirm').classList.add('hidden');attempt({type:'surrender'});};
$('changeServer').onclick=()=>{$('serverConfig').classList.remove('hidden');status('接続先URLを入力し直してください。変更後は必要に応じてルームへ入り直してください。');};
$('saveServer').onclick=async()=>{const s=server();if(!s){status('HTTPSのCloudflare Worker URLを入力してください',true);return;}localStorage.setItem(SERVER_STORE,s);try{const r=await fetch(s+'/health');if(!r.ok)throw Error('接続先が応答しません');const d=await r.json();status(`接続確認済み：${d.service||'SUMMONER server'}`);$('serverConfig').classList.add('hidden');if(session)connect();}catch(e){status('接続できません：'+e.message,true)}};
$('create').onclick=async()=>{try{const data=await rest('/api/rooms',{name:$('hostName').value});saveSession(data);connect();}catch(e){status(e.message,true)}};
$('join').onclick=async()=>{try{const code=$('roomCode').value.trim().toUpperCase();const data=await rest(`/api/rooms/${code}/join`,{name:$('guestName').value});saveSession(data);connect();}catch(e){status(e.message,true)}};
$('copyInvite').onclick=async()=>{try{await navigator.clipboard.writeText(roomInvite());status('招待URLをコピーしました')}catch{status(roomInvite())}};
$('forgetSeat').onclick=()=>{if(confirm('接続情報を解除しますか？対戦中の場合は再接続できなくなります。'))forget();};
$('selectDeck').onclick=()=>{const item=availableDecks[Number($('deckPick').value)];if(!item)return status('デッキがありません',true);const deck=deckAsNames(item.deck);attempt({type:'select_deck',deck});};
$('ready').onclick=()=>attempt({type:'ready',ready:!view?.players[view.seat].ready});
function render(){if(!view)return;renderLobby();if(view.game)renderDuel();else{$('lobbyView').classList.remove('hidden');$('duelView').classList.add('hidden');}}
function bootstrap(){refreshDecks();$('hostName').value=currentUser();$('guestName').value=currentUser();$('roomCode').value=(new URLSearchParams(location.search).get('room')||'').toUpperCase();
 const q=new URLSearchParams(location.search);const invitationServer=q.get('server');const savedServer=invitationServer||window.SUMMONER_ONLINE_SERVER||localStorage.getItem(SERVER_STORE)||'';$('serverUrl').value=savedServer;
 try{session=JSON.parse(localStorage.getItem(STORAGE)||'null');if(session&&!session.token)session=null;if(session&&!/^[A-Z0-9]{6}$/.test(session.code||'')){session=null;localStorage.removeItem(STORAGE);}}catch{session=null}
 if(session&&q.get('room')&&session.code!==q.get('room').toUpperCase()){session=null;localStorage.removeItem(STORAGE);}
 if(savedServer){$('serverConfig').classList.add('hidden');status('対戦サーバーの設定が読み込まれました。');if(invitationServer&&server())localStorage.setItem(SERVER_STORE,server());if(session)connect();}else status('オンライン対戦には先にCloudflare Workerの無料デプロイが必要です。設定URLを入力してください。');
}

// Same playmat source and browser-stored field image as the local duel.
const FIELD_DB='summoner_ui_v1',FIELD_STORE='settings',FIELD_KEY='customFieldImage';
let fieldObjectUrl=null;
function fieldStore(mode,fn){return new Promise((resolve,reject)=>{const req=indexedDB.open(FIELD_DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(FIELD_STORE))req.result.createObjectStore(FIELD_STORE)};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;const tx=db.transaction(FIELD_STORE,mode);const q=fn(tx.objectStore(FIELD_STORE));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close();};});}
function applyField(blob){if(fieldObjectUrl)URL.revokeObjectURL(fieldObjectUrl);fieldObjectUrl=URL.createObjectURL(blob);document.documentElement.style.setProperty('--custom-field-image',`url("${fieldObjectUrl}")`);document.body.classList.add('custom-field-active');$('onlineFieldImageStatus').textContent='現在：カスタム背景';}
async function restoreField(){try{const val=await fieldStore('readonly',s=>s.get(FIELD_KEY));if(val?.blob)applyField(val.blob);}catch(e){console.warn('背景画像の読み込みに失敗',e)}}
// Background customization is retained in IndexedDB, but no Field button is shown.
function openOnlineFieldSettings(){$('onlineFieldImageStatus').textContent=document.body.classList.contains('custom-field-active')?'現在：カスタム背景':'現在：v17標準フィールド';$('onlineFieldSettings').classList.add('open');};$('onlineFieldClose').onclick=()=>$('onlineFieldSettings').classList.remove('open');$('onlineFieldSettings').addEventListener('click',e=>{if(e.target===$('onlineFieldSettings'))$('onlineFieldSettings').classList.remove('open');});
$('onlineResetField').onclick=async()=>{try{await fieldStore('readwrite',s=>s.delete(FIELD_KEY));}catch(e){console.warn(e)}document.body.classList.remove('custom-field-active');$('onlineFieldImageStatus').textContent='現在：v17標準フィールド';document.documentElement.style.removeProperty('--custom-field-image');if(fieldObjectUrl){URL.revokeObjectURL(fieldObjectUrl);fieldObjectUrl=null;}};
$('onlineFieldInput').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>10*1024*1024||!/^image\/(png|jpeg|webp)$/.test(file.type)){status('画像は10MB以内のPNG・JPG・WebPを使用してください',true);return;}try{await fieldStore('readwrite',s=>s.put({blob:file,name:file.name},FIELD_KEY));applyField(file);}catch(e){status('背景画像を保存できませんでした',true)}e.target.value='';};
// Battle topbar intentionally contains only the surrender action.
// Playmat card interactions do not collapse the hand; clicking other surfaces does.
function setCompactHand(value){document.body.classList.toggle('hands-compact',!!value);$('mobileHandSizeBtn').textContent=value?'手札を広げる':'手札を縮小';$('mobileHandSizeBtn').setAttribute('aria-pressed',String(!!value));}
$('mobileHandSizeBtn').onclick=e=>{e.stopPropagation();setCompactHand(!document.body.classList.contains('hands-compact'));};
$('duelView').querySelector('.handbar').addEventListener('click',e=>{if(document.body.classList.contains('hands-compact')){e.stopPropagation();e.preventDefault();setCompactHand(false);}},true);
document.addEventListener('click',e=>{if(!view?.game)return;const t=e.target;if(!(t instanceof Element))return;
 if(t.closest('.handbar,.opponent-hand-wrap')){setCompactHand(false);return;}
 if(t.closest('#duelView .card,#duelView .card-controls'))return;
 if(t.closest('#duelView'))setCompactHand(true);
});
restoreField();

bootstrap();
})();
