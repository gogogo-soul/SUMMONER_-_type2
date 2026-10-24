(()=>{'use strict';
const $=id=>document.getElementById(id);
const STORAGE='summoner_online_pvp_session_v1',SERVER_STORE='summoner_online_worker_url_v1';
let session=null,ws=null,view=null,pending=null,selected=null,dialogCb=null,dialogChosen=[],dialogMax=1,dialogMin=1,reconnect=0,manualClose=false;
const CE=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el};
const n=v=>String(v||'');
const status=(msg,err=false)=>{$('status').textContent=msg;$('status').classList.toggle('err',err)};
const server=()=>{const raw=($('serverUrl').value||'').trim().replace(/\/$/,'');if(!raw)return null;try{const u=new URL(raw);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))return null;return u.origin;}catch{return null;}};
function getServer(){return server()}
function saveSession(r){session=r;localStorage.setItem(STORAGE,JSON.stringify(r));}
function forget(){manualClose=true;if(ws)ws.close();session=null;view=null;localStorage.removeItem(STORAGE);$('lobbyWait').classList.add('hidden');$('duelView').classList.add('hidden');$('lobbyView').classList.remove('hidden');status('このブラウザからルームの接続情報を解除しました。');}
function titleRoom(){const code=session?.code;if(!code)return '';return code;}
function roomInvite(){const u=new URL('online.html',location.href);u.searchParams.set('room',titleRoom());if(getServer())u.searchParams.set('server',getServer());return u.href;}
async function rest(path,data){const root=getServer();if(!root)throw Error('Cloudflare WorkerのURLを設定してください');const r=await fetch(root+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await r.json();if(!r.ok)throw Error(body.error||`通信エラー HTTP ${r.status}`);return body;}
function send(data){if(!ws||ws.readyState!==WebSocket.OPEN)throw Error('サーバー未接続です');ws.send(JSON.stringify(data));}
function attempt(data){try{send(data)}catch(e){status(e.message,true)}}
function act(type,extra={}){attempt({type:'action',action:{type,...extra}});}
function connect(){if(!session||!getServer())return;manualClose=false; if(ws&&ws.readyState<=1)ws.close(); const url=getServer().replace(/^http/,'ws')+`/api/rooms/${session.code}/socket`;ws=new WebSocket(url);const thisSocket=ws;
 status('対戦サーバーへ接続しています…');
 ws.onopen=()=>{if(ws!==thisSocket)return;reconnect=0;send({type:'auth',token:session.token});status('対戦サーバーに接続しました。')};
 ws.onmessage=e=>{if(ws!==thisSocket)return;let m;try{m=JSON.parse(e.data)}catch{return}if(m.type==='error'){status(m.error,true);return;}if(m.type==='state'){view=m.data;render();status(`ルーム ${session.code} に接続中／PLAYER ${session.seat+1}`);}};
 ws.onclose=()=>{if(ws!==thisSocket||manualClose)return;status('通信が切断されました。数秒後に再接続します。',true);const sec=Math.min(20,1+Math.pow(2,Math.min(++reconnect,4)));setTimeout(()=>{if(!manualClose&&session)connect()},sec*1000)};
 ws.onerror=()=>status('通信エラー。接続先・ネットワーク・Cloudflareの設定を確認してください。',true);
}
function currentUser(){return localStorage.getItem('arcana_duel_current_user')||'Guest'}
function listDecks(){const list=[];for(const st of window.SUMMONER_STARTER_DECKS||[]){list.push({label:'初期：'+st.name,deck:st.counts});}
 const saved=JSON.parse(localStorage.getItem(`arcana_duel_decks_${currentUser()}`)||'{}');for(const [name,counts] of Object.entries(saved)){list.push({label:'保存：'+name,deck:counts});}return list;}
let availableDecks=[];
function refreshDecks(){availableDecks=listDecks();const select=$('deckPick');select.replaceChildren();availableDecks.forEach((item,i)=>{const o=CE('option','',item.label);o.value=String(i);select.append(o)});}
function deckAsNames(counts){const d=[];for(const [name,num] of Object.entries(counts||{}))for(let i=0;i<Number(num);i++)d.push(name);return d;}
function renderLobby(){if(!view)return;const playerList=$('roomPlayers');playerList.replaceChildren();view.players.forEach((p,i)=>{const row=CE('div','player-info');row.append(CE('span','',`PLAYER ${i+1}：${p.name||'参加待ち'}`),CE('span','',`${p.hasDeck?'デッキ登録済み':'未登録'}／${p.ready?'準備完了':'未準備'}`));playerList.append(row)});const mine=view.players[view.seat];$('ready').textContent=mine.ready?'準備完了を取り消す':'準備完了';$('roomLabel').textContent=view.room;$('lobbyWait').classList.remove('hidden');}
function empty(node){node.replaceChildren();}
function makeCard(c,handler=null){const cEl=CE('button','card '+(c.faceDown?'unknown':c.type||'')+(c.tapped?' tapped':''));cEl.type='button';if(c.faceDown){cEl.append(CE('div','name','流脈 ≋'),CE('div','type','裏向き'));}else{cEl.append(CE('div','cost',c.cost>0?`≋${c.cost}`:c.type==='land'?'≋':' '),CE('div','name',c.name));if(c.type==='monster'){const stats=CE('div','stats');stats.append(CE('span','',`P ${c.power}`),CE('span','',`SP ${c.sp}`));cEl.append(stats);}else cEl.append(CE('div','type',c.type==='summoner'?'◎ 召喚士':c.type==='spell'?'✦ 魔法':c.type==='land'?'≋ 流脈':''));}if(handler)cEl.addEventListener('click',()=>handler(c));return cEl;}
function putCards(node,cards,part,side){empty(node);for(const c of cards||[])node.append(makeCard(c,()=>openCard(c,part,side)));if(!cards?.length)node.append(CE('span','muted','—'));}
function backs(node,count){empty(node);for(let i=0;i<Math.min(count,16);i++)node.append(CE('div','back','✦'));if(count>16)node.append(CE('div','back',`+${count-16}`))}
const colorWord=c=>({red:'赤',blue:'青',green:'緑',yellow:'黄',black:'黒',none:'無色'})[c]||'無色';
function prettyMana(m){return (m||[]).length?m.map(c=>colorWord(c)).join(' / '):'なし';}
function button(parent,text,fn,klass){const b=CE('button',klass||'',text);b.onclick=fn;parent.append(b);return b;}
function renderDuel(){const g=view.game,me=view.seat,enemy=1-me,mine=g.players[me],op=g.players[enemy];$('lobbyView').classList.add('hidden');$('duelView').classList.remove('hidden');
 $('myName').textContent=`PLAYER ${me+1}：${view.players[me].name}`;$('opName').textContent=`PLAYER ${enemy+1}：${view.players[enemy].name}`;$('myLP').textContent=`${mine.lp} LP`;$('opLP').textContent=`${op.lp} LP`;
 $('myMana').textContent=`マナ：${prettyMana(mine.mana)}`;$('opCounts').textContent=`手札 ${op.handCount} / 山札 ${op.deckCount}`;$('opHandLabel').textContent=`相手の手札 ${op.handCount}枚（内容は非公開）`;
 backs($('opHand'),op.handCount);putCards($('opField'),op.field,'field',enemy);putCards($('myField'),mine.field,'field',me);putCards($('opLands'),op.lands,'lands',enemy);putCards($('myLands'),mine.lands,'lands',me);putCards($('opSummoner'),[op.summoner],'summoner',enemy);putCards($('mySummoner'),[mine.summoner],'summoner',me);putCards($('myHand'),mine.hand,'hand',me);
 $('opDeck').textContent=`山札 ${op.deckCount}`;$('myDeck').textContent=`山札 ${mine.deckCount}`;$('opGrave').textContent=`墓地 ${op.grave.length}`;$('myGrave').textContent=`墓地 ${mine.grave.length}`;
 $('opGrave').onclick=()=>openGrave(enemy);$('myGrave').onclick=()=>openGrave(me);
 $('phaseLabel').textContent=`T${g.turnNo} / ${g.phase}`;const stack=$('stackCenter');empty(stack);for(const s of g.stack)stack.append(CE('span','item',`P${s.side+1}：《${s.name}》`));if(!g.stack.length)stack.append(CE('span','muted','解決待ちなし'));
 $('stackPriority').textContent=g.stack.length?`優先権 P${g.priority+1}`:'';
 $('drawBtn').disabled=g.over||g.turn!==me||!g.drawPending;
 $('battleBtn').disabled=g.over||g.turn!==me||g.phase!=='MAIN'||g.drawPending>0||g.stack.length>0||!!g.block;
 $('endBtn').disabled=g.over||g.turn!==me||g.drawPending>0||g.stack.length>0||!!g.block;
 $('passBtn').disabled=g.over||!g.stack.length||g.priority!==me;
 $('summonerBtn').disabled=g.over||g.turn!==me||g.phase!=='MAIN'||g.drawPending>0||g.stack.length>0||!!g.block;
 $('surrenderBtn').disabled=g.over;
 let headline='',explain='';if(g.over){headline=g.winner==null?'引き分け':(g.winner===me?'勝利！':'敗北');explain='対戦は終了しました。';}else if(g.choice){headline=g.choice.waiting?'相手が選択中':'カードを選択してください';explain='選択処理中は操作が停止します。';}else if(g.block){headline=g.block.seat===me?'相手のブロックを待っています':'ブロッカーを選んでください';explain='ブロックしない場合は「NO BLOCK」を選択します。';}else if(g.stack.length){headline=g.priority===me?'あなたの優先権':'相手の優先権';explain='対応する高速詠唱カードを使うかPASSします。';}else if(g.drawPending){headline=g.turn===me?'DRAWでカードを引いてください':'相手がドロー中';explain='ドローを完了するとカードをプレイできます。';}else {headline=g.turn===me?'あなたのターン':'相手のターン';explain='ターン中に流脈を配置し、タップしてマナを作り、カードをプレイします。';}
 $('turnStatus').textContent=headline;$('turnHelp').textContent=explain;
 const actEl=$('actions');const old=actEl.querySelector('#noBlockBtn');if(old)old.remove();if(g.block&&g.block.seat!==me&&!g.over)button(actEl,'NO BLOCK',()=>act('block',{}),'primary').id='noBlockBtn';
 const logNode=$('gameLog');empty(logNode);for(const line of [...g.log].reverse())logNode.append(CE('div','logline',line));
 if(g.choice&&!g.choice.waiting&&g.choice.seat===me&&!pending){promptChoice(g.choice)};
}
function openGrave(side){const g=view.game;const list=g.players[side].grave;const title=side===view.seat?'自分の墓地':'相手の墓地';const info=list.map(c=>`${c.name}（${c.type}）`).join('\n');$('cardInfo').textContent=title+'\n'+(info||'カードなし');}
function openCard(c,part,side){const g=view?.game;if(!g)return;selected={c,part,side};const d=DB[c.name];$('cardInfo').textContent=`${c.privateName?'裏向き（自分のみ確認）：'+c.privateName:c.name}\n${c.type||''}  コスト${c.cost||0}\n${c.type==='monster'?`パワー${c.power}  SP${c.sp}\n`:''}${c.txt||d?.txt||''}`;
 const box=$('cardActions');empty(box);const me=view.seat;
 if(g.over)return;
 if(side===me&&part==='hand'){if(c.type!=='summoner')button(box,'流脈として配置',()=>act('land',{card:c.id}));if(c.type==='monster'||c.type==='spell')button(box,'プレイする',()=>playWithTarget(c),'primary');}
 if(side===me&&part==='lands')button(box,c.tapped?'タップを戻す':'タップしてマナ生成',()=>act(c.tapped?'untap_land':'tap_land',{card:c.id}));
 if(side===me&&part==='field'&&g.phase==='BATTLE'&&g.turn===me)button(box,'攻撃する',()=>attackWithTarget(c),'primary');
 if(side===me&&part==='field'&&g.block&&g.block.seat!==me&&!c.tapped)button(box,'このモンスターでブロック',()=>act('block',{card:c.id}),'primary');
}
function doDialog(title,help,opts,min,max,callback){pending={title};dialogCb=callback;dialogChosen=[];dialogMin=min;dialogMax=max;$('dialogCancel').disabled=false;$('dialogTitle').textContent=title;$('dialogHelp').textContent=help;$('dialog').classList.remove('hidden');const area=$('dialogOptions');empty(area);for(const opt of opts){const b=button(area,opt.label,()=>{if(dialogMax===1){dialogChosen=[opt.id];update();return}if(dialogChosen.includes(opt.id))dialogChosen=dialogChosen.filter(x=>x!==opt.id);else if(dialogChosen.length<dialogMax)dialogChosen.push(opt.id);update();});b.dataset.id=opt.id;}
 function update(){for(const b of area.querySelectorAll('button'))b.classList.toggle('active',dialogChosen.includes(b.dataset.id));$('dialogOk').disabled=dialogChosen.length<min||dialogChosen.length>max;}
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
function playWithTarget(c){const key=DB[c.name]?.effectKey;const available=choices(key,view.seat);
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
function attackWithTarget(c){const opp=view.game.players[1-view.seat].field;const list=[{id:'',label:'相手プレイヤーへ直接攻撃（SPダメージ）'},...opp.map(x=>({id:x.id,label:`《${x.name}》 (P${x.power}) ${x.tapped?'タップ':'アンタップ'}`}))];doDialog('攻撃対象を選択','通常、相手モンスターはタップ状態のときだけ攻撃可能です。',list,1,1,ids=>act('attack',{card:c.id,target:ids[0]||null}));}
function summonAbility(){const c=view.game.players[view.seat].summoner;const key=DB[c.name]?.summonerAbilityKey;const opts=choices(key,view.seat);if(opts===null){act('summoner');return;}if(!opts.length){status('能力の対象がいません',true);return;}doDialog('召喚士《'+c.name+'》','同色の流脈≋1で能力を発動します。',opts.map(readable),1,1,x=>act('summoner',{target:x[0]}));}
function promptChoice(choice){const opts=choice.options.map(x=>({id:x.id,label:x.name}));doDialog('カードを選択','サーバーからの選択処理です。選択順が一部の効果で結果に影響します。',opts,choice.min,choice.max,ids=>attempt({type:'choose',ids}));pending.forced=true;$('dialogCancel').disabled=true;}
$('drawBtn').onclick=()=>act('draw');$('battleBtn').onclick=()=>act('phase',{to:'BATTLE'});$('endBtn').onclick=()=>act('end_turn');$('passBtn').onclick=()=>act('pass');$('summonerBtn').onclick=summonAbility;
$('surrenderBtn').onclick=()=>{if(confirm('降参しますか？'))attempt({type:'surrender'});};
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
 try{session=JSON.parse(localStorage.getItem(STORAGE)||'null');if(session&&!session.token)session=null;}catch{session=null}
 if(session&&q.get('room')&&session.code!==q.get('room').toUpperCase()){session=null;localStorage.removeItem(STORAGE);}
 if(savedServer){$('serverConfig').classList.add('hidden');status('対戦サーバーの設定が読み込まれました。');if(invitationServer&&server())localStorage.setItem(SERVER_STORE,server());if(session)connect();}else status('オンライン対戦には先にCloudflare Workerの無料デプロイが必要です。設定URLを入力してください。');
}
bootstrap();
})();
