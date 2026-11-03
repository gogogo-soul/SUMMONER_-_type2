/*
 * SUMMONER Solo AI v1
 * Free, browser-local AI. No API key, external service, or paid model required.
 * Planning: beam-search over the AI's visible hand/resources + tactical minimax
 * for attacks/blocks. Hidden opponent hand/deck contents are never read.
 */
(() => {
  'use strict';

  const STORE_ENABLED = 'summoner_solo_ai_enabled_v45';
  const STORE_LEVEL = 'summoner_solo_ai_level_v45';
  const LEVELS = {
    normal: {depth: 2, width: 6, label: '標準'},
    strong: {depth: 3, width: 12, label: '強い'},
    expert: {depth: 4, width: 18, label: '最強'}
  };
  const AI = {
    enabled: localStorage.getItem(STORE_ENABLED) !== 'false',
    level: LEVELS[localStorage.getItem(STORE_LEVEL)] ? localStorage.getItem(STORE_LEVEL) : 'strong',
    timer: null,
    observer: null,
    busy: false,
    lastActionAt: 0,
    lastStateKey: '',
    status: ''
  };

  const api = () => window.SUMMONER_AI_BRIDGE;
  const state = () => api()?.getState?.();
  const db = () => api()?.getDB?.() || {};
  const el = id => document.getElementById(id);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const opponent = side => side === 'cpu' ? 'you' : 'cpu';
  const currentLevel = () => LEVELS[AI.level] || LEVELS.strong;

  function setStatus(text='') {
    AI.status = text;
    const node = el('cpuAiStatus');
    if (!node) return;
    node.textContent = text;
    node.hidden = !text;
  }

  function configure(options={}) {
    if (typeof options.enabled === 'boolean') AI.enabled = options.enabled;
    if (LEVELS[options.level]) AI.level = options.level;
    try {
      localStorage.setItem(STORE_ENABLED, String(AI.enabled));
      localStorage.setItem(STORE_LEVEL, AI.level);
    } catch (_) {}
    const toggle = el('aiOpponentEnabled');
    const level = el('aiDifficulty');
    if (toggle) toggle.checked = AI.enabled;
    if (level) level.value = AI.level;
    updateLabels();
    if (AI.enabled) schedule(100);
    else setStatus('');
  }

  function updateLabels() {
    const enabled = AI.enabled;
    const name = el('cpuPlayerName');
    const handTitle = el('cpuHandTitle');
    if (name) name.textContent = enabled ? 'PLAYER 2 / AI' : 'PLAYER 2';
    if (handTitle) handTitle.textContent = enabled ? 'AI HAND ' : 'PLAYER 2 HAND ';
    const p2Title = el('p2DeckTitle');
    if (p2Title) p2Title.textContent = enabled ? 'AIが使用するデッキ' : 'PLAYER 2 使用デッキ';
  }

  function gameIsReady(g=state()) { return !!(g && g.cpu && g.you && !g.preparing); }
  function cardThreat(c, owner) {
    if (!c) return 0;
    const a = api();
    const power = a.attackPower(c, owner) / 1000;
    const sp = a.attackSP(c);
    let value = 1.6 + power * 0.78 + sp * 1.75;
    const k = c.effectKey || '';
    if (a.cardHasHaste(c)) value += 0.75;
    if (k === 'unblockable') value += 1.35;
    if (k === 'deathtouch' || c.burst) value += 1.15;
    if (k === 'auraAtk1') value += 0.8 + (state()?.[owner]?.field?.length || 0) * 0.35;
    if (k === 'untapOnKill') value += 0.65;
    if (k === 'returnOnDeath' || c.returnOnDeath) value += 0.7;
    if (k === 'cannotAttack') value -= 0.65;
    if (k === 'cannotAttackFace') value -= 0.3;
    if (c.tapped) value -= 0.2;
    if (c.summon && !a.cardHasHaste(c)) value -= 0.25;
    return Math.max(0.2, value);
  }

  function simpleCard(c) {
    return {
      id: c.id, name: c.name, t: c.t, color: c.color || 'none', c: Number(c.c)||0,
      lpCost: Number(c.lpCost)||0, power: Number(c.power)||0, sp: Number(c.sp)||0,
      effectKey: c.effectKey || 'vanilla', timing: c.timing || 'normal', txt: c.txt || '',
      haste: !!c.haste, flying: !!c.flying, tapped: !!c.tapped, summon: !!c.summon,
      burst: !!c.burst, returnOnDeath: !!c.returnOnDeath, indestructible: !!c.indestructible, soulNever: !!c.soulNever,
      unblockableUntilTurnNo: c.unblockableUntilTurnNo || 0
    };
  }

  function snapshotForSearch(g) {
    const me = g.cpu, opp = g.you;
    const mana = (me.manaPool || []).map(m => typeof m === 'string' ? m : (m.color || 'colorless'));
    (me.lands || []).filter(x => !x.tapped && !x.tapLocked && !x.usedThisTurn).forEach(x => mana.push(x.isFaceDown ? 'colorless' : (x.color || 'colorless')));
    return {
      hpMe: me.hp, hpOpp: opp.hp,
      hand: me.hand.map(simpleCard),
      deck: me.deck.map(simpleCard),
      grave: me.grave.map(simpleCard),
      fieldMe: me.field.map(simpleCard),
      fieldOpp: opp.field.map(simpleCard),
      landMe: me.lands.length, landOpp: opp.lands.length,
      oppHandCount: opp.hand.length,
      mana, preventMe: me.damagePrevent || 0,
      counterMe: me.counterAttack || 0, canAttackUntapped: !!me.canAttackUntapped,
      turnNo: g.turnNo
    };
  }

  function cloneSim(s) {
    return {
      hpMe:s.hpMe, hpOpp:s.hpOpp, hand:s.hand.map(x=>({...x})), deck:s.deck.map(x=>({...x})),
      grave:s.grave.map(x=>({...x})), fieldMe:s.fieldMe.map(x=>({...x})), fieldOpp:s.fieldOpp.map(x=>({...x})),
      landMe:s.landMe, landOpp:s.landOpp, oppHandCount:s.oppHandCount, mana:[...s.mana],
      preventMe:s.preventMe, counterMe:s.counterMe, canAttackUntapped:s.canAttackUntapped, turnNo:s.turnNo
    };
  }

  function boardValue(c, owner, field) {
    const p = Math.max(0, Number(c.power)||0) / 1000;
    const sp = Math.max(0, Number(c.sp)||0);
    let v = 1.45 + p * 0.78 + sp * 1.7;
    const k = c.effectKey || '';
    if (c.haste || k === 'haste' || k === 'hasteBurn3') v += 0.55;
    if (k === 'unblockable' || Number(c.unblockableUntilTurnNo||0) >= 0 && Number(c.unblockableUntilTurnNo||0) > 0) v += 1.1;
    if (k === 'deathtouch' || c.burst) v += 0.9;
    if (k === 'auraAtk1') v += 0.7 + field.length * 0.3;
    if (k === 'untapOnKill') v += 0.55;
    if (k === 'returnOnDeath' || c.returnOnDeath) v += 0.55;
    if (c.soulNever) v += 0.35;
    if (c.indestructible) v += 0.45;
    if (k === 'cannotAttack') v -= 0.55;
    if (k === 'cannotAttackFace') v -= 0.2;
    if (c.tapped) v -= 0.85;
    if (c.summon && !c.haste) v -= 0.2;
    return Math.max(0.2, v);
  }

  function evaluateSim(s) {
    const myBoard = s.fieldMe.reduce((n,c)=>n+boardValue(c,'cpu',s.fieldMe),0);
    const opBoard = s.fieldOpp.reduce((n,c)=>n+boardValue(c,'you',s.fieldOpp),0);
    const handValue = s.hand.reduce((n,c)=>n+0.72+Math.max(0,c.c)*0.035,0);
    const myLandValue = s.landMe * 0.72;
    const opLandValue = s.landOpp * 0.72;
    const handThreat = s.oppHandCount * 0.22;
    const readyEnemy=s.fieldOpp.filter(x=>!x.tapped).length;
    const attackPressure=s.counterMe>0?Math.min(1,s.counterMe)*Math.min(3,readyEnemy)*1.15:0;
    const untapAttackBonus=s.canAttackUntapped?Math.min(3,readyEnemy)*0.75:0;
    return (s.hpMe - s.hpOpp) * 1.55 + myBoard - opBoard + handValue - handThreat + myLandValue - opLandValue + s.mana.length * 0.12 + s.preventMe * 0.35 + attackPressure + untapAttackBonus;
  }

  function simPay(s, c) {
    const need = Math.max(0, Number(c.c)||0);
    if (s.mana.length < need) return false;
    const pool = [...s.mana];
    let remaining = need;
    if (need > 0 && c.color && c.color !== 'none') {
      const i = pool.indexOf(c.color);
      if (i < 0) return false;
      pool.splice(i,1); remaining--;
    }
    while (remaining > 0) {
      let i = pool.indexOf('colorless');
      if (i < 0) i = pool.length - 1;
      if (i < 0) return false;
      pool.splice(i,1); remaining--;
    }
    s.mana = pool;
    return true;
  }

  function simPick(field, predicate=()=>true, score=null) {
    const list = field.filter(predicate || (()=>true));
    if (!list.length) return null;
    const value = c => score ? score(c, 'you', field) : boardValue(c, 'you', field);
    return list.slice().sort((a,b)=>value(b)-value(a))[0];
  }
  function simRemove(field, c) { const i=field.indexOf(c); if(i>=0)field.splice(i,1); }
  function simDraw(s,n) { for(let i=0;i<n&&s.deck.length;i++)s.hand.push(s.deck.pop()); }
  function simLandColor(s) {
    const demand={red:0,blue:0,yellow:0,green:0,black:0};
    s.hand.forEach(c=>{if(c.color in demand)demand[c.color]+=1/(1+Math.max(0,c.c-2)*0.2);});
    return Object.keys(demand).sort((a,b)=>demand[b]-demand[a])[0] || 'colorless';
  }
  function simAddLandFromDeck(s,n) {
    for(let j=0;j<n;j++){
      const lands=s.deck.filter(c=>c.t==='land');
      if(!lands.length)break;
      const wanted=simLandColor(s);
      const pick=lands.find(c=>c.color===wanted)||lands[0];
      simRemove(s.deck,pick);s.landMe++;
    }
  }
  function simApplyMonster(s,c,depth=0) {
    s.fieldMe.push({...c,tapped:false,summon:true});
    const k=c.effectKey;
    const enemy=s.fieldOpp;
    if(k==='draw1')simDraw(s,1);
    else if(k==='draw2')simDraw(s,2);
    else if(k==='destroyOppLand')s.landOpp=Math.max(0,s.landOpp-1);
    else if(k==='damageAll3')s.fieldOpp=enemy.filter(x=>(Number(x.power)||0)>3000);
    else if(k==='bounceAllOpp'){s.oppHandCount+=enemy.length;s.fieldOpp=[];}
    else if(k==='tapAllOpp')enemy.forEach(x=>x.tapped=true);
    else if(k==='tapOppOnSummon'){const x=simPick(enemy.filter(x=>!x.tapped),null,boardValue);if(x)x.tapped=true;}
    else if(k==='searchLand')simAddLandFromDeck(s,1);
    else if(k==='searchMonster'){
      const x=simPick(s.deck.filter(x=>x.t==='monster'),null,(a)=>0.8+Math.max(0,a.power)/1000+Math.max(0,a.sp)*1.5-Math.max(0,a.c)*0.4);
      if(x){simRemove(s.deck,x);s.hand.push(x);}
    }
    else if(k==='searchSpell'){
      const x=simPick(s.deck.filter(x=>x.t==='spell'),null,(a)=>1+Math.max(0,a.c)*0.05);
      if(x){simRemove(s.deck,x);s.hand.push(x);}
    }
    else if(k==='search2Land')simAddLandFromDeck(s,2);
    else if(k==='oppToFaceDownLand'){
      const x=simPick(enemy);if(x){simRemove(enemy,x);s.landOpp++;}
    }
    else if(k==='destroyOppMonster'){
      const x=simPick(enemy);if(x)simRemove(enemy,x);
    }
    else if(k==='hpMinus1EOT')simDebuff(s,1);
    else if(k==='hpMinus2EOT')simDebuff(s,2);
    else if(k==='hpMinus3AllEOT')simDebuffAll(s,3);
    else if(k==='discardRandomOpp')s.oppHandCount=Math.max(0,s.oppHandCount-1);
    else if(k==='graveToFaceDownLand'){
      const x=simPick(s.grave.filter(x=>x.t==='monster'),null,(a)=>1+Math.max(0,a.power)/1000+Math.max(0,a.sp));
      if(x){simRemove(s.grave,x);s.landMe++;}
    }
    else if(k==='handToFaceDownLand'){
      const x=simPick(s.hand.filter(x=>x.t!=='summoner'&&x.t!=='land'),null,(a)=>1+Math.max(0,a.c)*0.2+Math.max(0,a.power)/1000+Math.max(0,a.sp));
      if(x){simRemove(s.hand,x);s.landMe++;}
    }
    else if(k==='sacOwnOnSummon'){
      const x=simPick(s.fieldMe.filter(x=>x!==s.fieldMe[s.fieldMe.length-1]),null,(a)=>boardValue(a,'cpu',s.fieldMe));
      if(x){simRemove(s.fieldMe,x);s.grave.push(x);}
    }
    else if(k==='recoverUpTo2'){
      for(let j=0;j<2;j++){const x=simPick(s.grave.filter(x=>x.t==='monster'),null,(a)=>boardValue(a,'cpu',s.fieldMe));if(!x)break;simRemove(s.grave,x);s.hand.push(x);}
    }
    else if(k==='hpMinus3AllEOT')simDebuffAll(s,3);
    else if(k==='freeSummon3'&&depth<2){
      const x=simPick(s.hand.filter(x=>x.t==='monster'&&x.c<=3),null,(a)=>1+Math.max(0,a.power)/1000+Math.max(0,a.sp)*1.5-Math.max(0,a.c)*0.25);
      if(x){simRemove(s.hand,x);simApplyMonster(s,x,depth+1);}
    }
    else if(k==='auraAtk1')s.fieldMe.forEach(x=>{if(x!==s.fieldMe[s.fieldMe.length-1])x.power=(Number(x.power)||0)+1000;});
  }

  function simDebuff(s, amount) {
    const x=simPick(s.fieldOpp,null,(a)=>boardValue(a,'you',s.fieldOpp));
    if(!x)return;
    x.power=(Number(x.power)||0)-amount*1000;
    if(x.power<=0)simRemove(s.fieldOpp,x);
  }
  function simDebuffAll(s, amount) {
    s.fieldOpp.forEach(x=>x.power=(Number(x.power)||0)-amount*1000);
    s.fieldOpp=s.fieldOpp.filter(x=>x.power>0);
  }

  function simApplySpell(s,c) {
    const k=c.effectKey,enemy=s.fieldOpp,own=s.fieldMe;
    if(k==='face4')s.hpOpp-=4;
    else if(k==='face2')s.hpOpp-=2;
    else if(k==='chooseBurn3'){
      const x=simPick(enemy.filter(x=>(Number(x.power)||0)<=3000));
      if(s.hpOpp<=3 || !x)s.hpOpp-=3; else simRemove(enemy,x);
    }
    else if(k==='damageAll3')s.fieldOpp=enemy.filter(x=>(Number(x.power)||0)>3000);
    else if(k==='damageOpp2'){
      const x=simPick(enemy.filter(x=>(Number(x.power)||0)<=2000));if(x)simRemove(enemy,x);
    }
    else if(k==='destroyOppMonster'){
      const x=simPick(enemy);if(x)simRemove(enemy,x);
    }
    else if(k==='destroyOppLand')s.landOpp=Math.max(0,s.landOpp-1);
    else if(k==='oppToFaceDownLand'){
      const x=simPick(enemy);if(x){simRemove(enemy,x);s.landOpp++;}
    }
    else if(k==='bounceAny'){
      const x=simPick(enemy);if(x){simRemove(enemy,x);s.oppHandCount++;}
    }
    else if(k==='bounceHp3'){
      const gone=enemy.filter(x=>(Number(x.power)||0)<=3000);s.oppHandCount+=gone.length;s.fieldOpp=enemy.filter(x=>(Number(x.power)||0)>3000);
    }
    else if(k==='bounceAllOpp'){s.oppHandCount+=enemy.length;s.fieldOpp=[];}
    else if(k==='bounceAll'){
      s.hand.push(...own);s.fieldMe=[];s.oppHandCount+=enemy.length;s.fieldOpp=[];
    }
    else if(k==='draw1')simDraw(s,1);
    else if(k==='draw2')simDraw(s,2);
    else if(k==='draw3')simDraw(s,3);
    else if(k==='draw5Bottom4'){
      simDraw(s,5);
      const sorted=s.hand.slice().sort((a,b)=>cardHandValue(a)-cardHandValue(b));
      for(let j=0;j<Math.min(4,sorted.length);j++)simRemove(s.hand,sorted[j]);
    }
    else if(k==='searchMonster'||k==='searchSpell'){
      const type=k==='searchMonster'?'monster':'spell';
      const x=simPick(s.deck.filter(x=>x.t===type),null,(a)=>cardHandValue(a));
      if(x){simRemove(s.deck,x);s.hand.push(x);}
    }
    else if(k==='search2Land')simAddLandFromDeck(s,2);
    else if(k==='ownToFaceDownLand'){
      const x=simPick(own);if(x){simRemove(own,x);s.landMe++;}
    }
    else if(k==='handToFaceDownLand'){
      const x=simPick(s.hand,null,(a)=>cardHandValue(a));if(x){simRemove(s.hand,x);s.landMe++;}
    }
    else if(k==='teamAtk3'||k==='hpPlus3Team')own.forEach(x=>x.power=(Number(x.power)||0)+3000);
    else if(k==='teamUnblockable')own.forEach(x=>x.unblockableUntilTurnNo=s.turnNo+1);
    else if(k==='attackUntappedEOT')s.canAttackUntapped=true;
    else if(k==='counterAttack')s.counterMe+=1;
    else if(k==='teamDeathtouch')own.forEach(x=>x.burst=true);
    else if(k==='tapAllOpp')enemy.forEach(x=>x.tapped=true);
    else if(k==='tapUpTo2'){
      enemy.slice().sort((a,b)=>boardValue(b,'you',enemy)-boardValue(a,'you',enemy)).slice(0,2).forEach(x=>x.tapped=true);
    }
    else if(k==='hpMinus2AllEOT')simDebuffAll(s,2);
    else if(k==='hpMinus3UntappedOpp'){
      const x=simPick(enemy.filter(x=>!x.tapped));if(x){x.power-=3000;if(x.power<=0)simRemove(enemy,x);}
    }
    else if(k==='hpMinus1EOT')simDebuff(s,1);
    else if(k==='destroyAll'){
      s.grave.push(...own,...enemy);s.fieldMe=[];s.fieldOpp=[];
    }
    else if(k==='discardRandomOpp')s.oppHandCount=Math.max(0,s.oppHandCount-1);
    else if(k==='recoverOne'||k==='recoverUpTo2'){
      const count=k==='recoverOne'?1:2;
      for(let j=0;j<count;j++){const x=simPick(s.grave.filter(x=>x.t==='monster'),null,(a)=>cardHandValue(a));if(!x)break;simRemove(s.grave,x);s.hand.push(x);}
    }
    else if(k==='freeSummon3'){
      const x=simPick(s.hand.filter(x=>x.t==='monster'&&x.c<=3),null,(a)=>cardHandValue(a));if(x){simRemove(s.hand,x);simApplyMonster(s,x);}
    }
    else if(k==='soulDrain'){
      const canHeal=Math.max(0,20-s.hpMe);
      const count=Math.min(own.length,Math.ceil(canHeal/2));
      const weak=own.slice().sort((a,b)=>boardValue(a,'cpu',own)-boardValue(b,'cpu',own)).slice(0,count);
      weak.forEach(x=>{simRemove(own,x);s.grave.push(x);});s.hpMe=Math.min(20,s.hpMe+weak.length*2);
    }
    else if(k==='destroyOneEach'){
      const mine=simPick(own,null,(a)=>boardValue(a,'cpu',own));const theirs=simPick(enemy);
      if(mine){simRemove(own,mine);s.grave.push(mine);}if(theirs)simRemove(enemy,theirs);
    }
    else if(k==='heal2')s.hpMe=Math.min(20,s.hpMe+2);
    else if(k==='heal4')s.hpMe=Math.min(20,s.hpMe+4);
    else if(k==='prevent3')s.preventMe+=3;
    else if(k==='sixColorless')s.mana.push('colorless','colorless','colorless','colorless','colorless','colorless');
    else if(k==='returnAllOnDeath')own.forEach(x=>x.returnOnDeath=true);
    else if(k==='soulNever')own.forEach(x=>x.soulNever=true);
    else if(k==='indestructibleOnce')own.forEach(x=>x.indestructible=true);
  }

  function cardHandValue(c) {
    if(!c)return 0;
    if(c.t==='monster')return 1.3+(Number(c.power)||0)/1000*0.85+(Number(c.sp)||0)*1.55+((c.effectKey==='draw1'||c.effectKey==='draw2'||c.effectKey==='draw3')?1.4:0)-Math.max(0,c.c)*0.25;
    const map={face4:4.2,face2:2.4,destroyOppMonster:4.5,damageAll3:4,bounceAllOpp:4.3,draw3:4.5,draw2:3,draw1:1.8,searchMonster:3,searchSpell:2.6,search2Land:3.2,searchLand:1.8,tapAllOpp:3,teamAtk3:2.5,teamUnblockable:2.6,freeSummon3:3.5,chooseBurn3:3.2,bounceAny:3.1,destroyAll:2.8};
    return (map[c.effectKey]||1.3)-Math.max(0,c.c)*0.2;
  }

  function validTargetsFor(c,g) {
    const own=g.cpu.field.filter(x=>x.t==='monster');
    const enemy=g.you.field.filter(x=>x.t==='monster');
    const grave=g.cpu.grave.filter(x=>x.t==='monster');
    switch(c.effectKey){
      case 'destroyOppLand': return g.you.lands.length>0;
      case 'counterPlay': return g.stack.some(e=>e.owner==='you'&&e.kind==='card'&&e.card?.t!=='summoner');
      case 'counterAttack': return g.you.field.some(x=>x.t==='monster'&&!x.tapped&&!x.summon&&x.effectKey!=='cannotAttack');
      case 'damageOpp2': case 'oppToFaceDownLand': case 'tapOppOnSummon': case 'hpMinus1EOT': case 'hpMinus2EOT': case 'destroyOppMonster': return enemy.length>0;
      case 'hpMinus3UntappedOpp': return enemy.some(x=>!x.tapped);
      case 'bounceAny': return own.length>0||enemy.length>0;
      case 'atkPlus1': case 'ownToFaceDownLand': return own.length>0;
      case 'graveToFaceDownLand': case 'recoverOne': case 'recoverUpTo2': return grave.length>0;
      case 'tapUpTo2': return enemy.length>0;
      case 'soulDrain': return own.length>0;
      case 'destroyOneEach': return own.length>0&&enemy.length>0;
      case 'sacOwnOnSummon': return own.length>0;
      case 'handToFaceDownLand': return g.cpu.hand.length>1;
      case 'freeSummon3': return g.cpu.hand.some(x=>x!==c&&x.t==='monster'&&x.c<=3);
      default: return true;
    }
  }

  function searchBestFirstPlay(g) {
    const config=currentLevel();
    const initial=snapshotForSearch(g);
    const baseScore=evaluateSim(initial);
    let beam=[{sim:initial,firstId:null,score:baseScore,seq:[]}];
    let best=beam[0];
    for(let depth=0;depth<config.depth;depth++){
      const candidates=[];
      for(const node of beam){
        for(const c of node.sim.hand){
          if(c.t==='land'||c.t==='summoner')continue;
          if(node.seq.length===0){const actual=g.cpu.hand.find(x=>x.id===c.id);if(actual&&!validTargetsFor(actual,g))continue;}
          if(c.lpCost>0&&node.sim.hpMe<=c.lpCost)continue;
          const next=cloneSim(node.sim);
          const idx=next.hand.findIndex(x=>x.id===c.id);
          if(idx<0)continue;
          const played=next.hand[idx];
          if(!simPay(next,played))continue;
          next.hand.splice(idx,1);
          if(played.lpCost>0)next.hpMe-=played.lpCost;
          if(played.t==='monster'){
            simApplyMonster(next,played);
          }else if(played.t==='spell'){
            simApplySpell(next,played);
            next.grave.push(played);
          }
          next.hpMe=clamp(next.hpMe,0,20);
          next.hpOpp=clamp(next.hpOpp,0,20);
          const seq=node.seq.concat(played.name);
          const score=evaluateSim(next)+seq.length*0.025;
          const item={sim:next,firstId:node.firstId||played.id,score,seq};
          candidates.push(item);
          if(score>best.score)best=item;
        }
      }
      if(!candidates.length)break;
      candidates.sort((a,b)=>b.score-a.score);
      beam=candidates.slice(0,config.width);
    }
    if(!best.firstId||best.score<baseScore+0.08)return null;
    return {id:best.firstId,sequence:best.seq,score:best.score-baseScore};
  }

  function chooseLandDrop(g) {
    const p=g.cpu;
    const lands=p.hand.filter(c=>c.t==='land');
    const demand={red:0,blue:0,yellow:0,green:0,black:0};
    [...p.hand,...p.deck].forEach(c=>{if(c.t!=='land'&&c.t!=='summoner'&&demand[c.color]!=null)demand[c.color]+=1/(1+Math.max(0,c.c-2)*0.22);});
    if(lands.length){
      return lands.slice().sort((a,b)=>(demand[b.color]||0)-(demand[a.color]||0))[0];
    }
    const fodder=p.hand.filter(c=>c.t!=='summoner'&&c.t!=='land');
    if(!fodder.length)return null;
    return fodder.slice().sort((a,b)=>cardHandValue(a)-cardHandValue(b))[0];
  }

  function ensureMana(card, owner='cpu', allowLandTap=true) {
    const g=state(),p=g[owner],a=api();
    if(a.canPayCost(p,card))return true;
    if(!allowLandTap||g.blockPending)return false;
    const ready=p.lands.filter(x=>!x.tapped&&!x.tapLocked&&!x.usedThisTurn);
    const matchingNeeded=card.c>0&&card.color&&card.color!=='none'&&!(p.manaPool||[]).some(m=>(typeof m==='string'?m:m.color)===card.color);
    if(matchingNeeded){
      const land=ready.find(x=>!x.isFaceDown&&x.color===card.color);
      if(land){a.toggleLandMana(land,owner);return a.canPayCost(p,card)||ensureMana(card,owner,true);}
    }
    if((p.manaPool||[]).length<card.c){
      const pool=(p.manaPool||[]).map(m=>typeof m==='string'?m:m.color);
      const needColor=card.c>0&&card.color&&card.color!=='none'&&!pool.includes(card.color);
      const candidates=ready.slice().sort((x,y)=>{
        const xcol=x.isFaceDown?'colorless':x.color, ycol=y.isFaceDown?'colorless':y.color;
        const score=z=>z==='colorless'?0:(z===card.color&&needColor?3:1);
        return score(xcol)-score(ycol);
      });
      const land=candidates[0];
      if(land){a.toggleLandMana(land,owner);return a.canPayCost(p,card)||ensureMana(card,owner,true);}
    }
    return a.canPayCost(p,card);
  }

  function abilityIsUseful(summoner,g) {
    const key=summoner.summonerAbilityKey, own=g.cpu.field.filter(x=>x.t==='monster'), enemy=g.you.field.filter(x=>x.t==='monster');
    const attackers=own.filter(x=>api().canAttackMonsterNow(x,'cpu'));
    switch(key){
      case 'face2': return g.you.hp>0;
      case 'heal1': return g.cpu.hp<20;
      case 'grantHaste': return own.some(x=>x.summonedTurnNo===g.turnNo&&!api().cardHasHaste(x));
      case 'ownSpPlus1': return attackers.some(x=>api().attackSP(x)>0);
      case 'grantUnblockable': return attackers.length>0&&enemy.some(x=>!x.tapped);
      case 'grantDeathtouch': return attackers.length>0&&enemy.some(x=>api().attackPower(x,'you')>0);
      case 'oppSpMinus1NextEnd': return enemy.some(x=>api().attackSP(x)>0);
      case 'hpMinus1NextEnd': return enemy.some(x=>api().attackPower(x,'you')<=1000);
      case 'forceAttackTarget': return enemy.some(x=>!x.tapped)&&own.some(x=>api().attackPower(x,'cpu')>=3000);
      case 'revealTopMonster': return g.cpu.deck.length>0&&(g.cpu.deck[g.cpu.deck.length-1]?.t==='monster'||g.cpu.hand.length<3);
      case 'reorderTop3': return g.cpu.deck.length>=2;
      case 'draw1SelfDamage2': return g.cpu.hp>2&&g.cpu.hand.length<5;
      case 'untapOwnSummoner': return g.cpu.lands.some(x=>x.tapped&&x.usedThisTurn);
      default:return false;
    }
  }

  function maybeUseSummonerAbility(g) {
    const a=api(),p=g.cpu;
    const summoner=p.summoners.find(x=>x.t==='summoner');
    if(!summoner||!summoner.summonerAbilityKey||summoner.summonerTrigger)return false;
    if(!abilityIsUseful(summoner,g))return false;
    const extra=Math.max(0,(Number(summoner.summonerAbilityCost)||0)-1);
    const colored=a.untappedSameColorLand(summoner,'cpu');
    if(!colored)return false;
    while((p.manaPool||[]).length<extra){
      const land=p.lands.find(x=>x!==colored&&!x.tapped&&!x.tapLocked&&!x.usedThisTurn);
      if(!land)return false;
      a.toggleLandMana(land,'cpu');
    }
    if(!a.canPaySummonerAbilityCost(summoner,'cpu'))return false;
    AI.currentAbilityKey=summoner.summonerAbilityKey;
    const activated=a.activateSummonerAbility(summoner,'cpu');
    if(!activated)AI.currentAbilityKey='';
    return !!activated;
  }

  function cardResponseValue(c,g,top) {
    const k=c.effectKey, enemy=g.you.field.filter(x=>x.t==='monster'), own=g.cpu.field.filter(x=>x.t==='monster');
    const topCard=top?.card;
    const tk=topCard?.effectKey||'';
    const topOwner=top?.owner;
    const topThreat=topOwner==='you'&&topCard ? cardHandValue(simpleCard(topCard)) : 0;
    if(k==='counterPlay'){
      if(!topCard||topOwner!=='you'||topCard.t==='summoner')return -100;
      const dangerous=['destroyAll','damageAll3','bounceAll','bounceAllOpp','destroyOppMonster','oppToFaceDownLand','face4','face2','damageOpp2','chooseBurn3','bounceAny','bounceHp3','draw5Bottom4','freeSummon3','tapAllOpp','hpMinus2AllEOT','hpMinus3UntappedOpp','discardRandomOpp'];
      return (dangerous.includes(tk)?8:topThreat+1.2)-Math.max(0,topCard.c||0)*0.15;
    }
    if(k==='prevent3'){
      if(topOwner!=='you')return -100;
      return ['face4','face2','chooseBurn3'].includes(tk)?7: -1;
    }
    if(k==='indestructibleOnce'){
      if(!own.length||topOwner!=='you')return -100;
      return ['destroyAll','damageAll3','destroyOppMonster'].includes(tk)?7+own.reduce((n,x)=>n+cardThreat(x,'cpu'),0)*0.3:-1;
    }
    if(k==='returnAllOnDeath'||k==='soulNever'){
      if(!own.length||topOwner!=='you')return -100;
      return ['destroyAll','damageAll3'].includes(tk)?6+own.length*0.8:-1;
    }
    if(k==='destroyOppMonster'||k==='oppToFaceDownLand'||k==='bounceAny'){
      if(!enemy.length)return -100;
      const target=enemy.slice().sort((a,b)=>cardThreat(b,'you')-cardThreat(a,'you'))[0];
      return 2.6+cardThreat(target,'you')*0.75;
    }
    if(k==='damageOpp2'){
      const target=enemy.find(x=>api().attackPower(x,'you')<=2000);
      return target?3+cardThreat(target,'you')*0.7:-100;
    }
    if(k==='chooseBurn3'){
      const target=enemy.find(x=>api().attackPower(x,'you')<=3000);
      return target?3.5+cardThreat(target,'you')*0.7:(g.you.hp<=3?9:2.8);
    }
    if(k==='damageAll3')return enemy.filter(x=>api().attackPower(x,'you')<=3000).length*2.8-1;
    if(k==='tapAllOpp')return enemy.filter(x=>!x.tapped).length*1.5+(g.cpu.hp<=8?2:0)-1;
    if(k==='counterAttack')return enemy.some(x=>api().canAttackMonsterNow(x,'you'))?4.2:-100;
    if(k==='soulDrain')return g.cpu.hp<15&&own.length?Math.min(own.length,Math.ceil((20-g.cpu.hp)/2))*1.1:-100;
    if(k==='bounceHp3')return enemy.filter(x=>api().attackPower(x,'you')<=3000).length*2.2-1;
    if(k==='draw3')return g.cpu.hand.length<4?5:2.2;
    if(k==='heal2')return g.cpu.hp<=16?2.8:-100;
    if(k==='heal4')return g.cpu.hp<=14?4.4:-100;
    if(k==='teamUnblockable')return g.turn==='cpu'&&own.some(x=>api().canAttackMonsterNow(x,'cpu'))&&enemy.some(x=>!x.tapped)?3.5:-100;
    if(k==='teamAtk3'||k==='hpPlus3Team')return g.turn==='cpu'&&own.some(x=>api().canAttackMonsterNow(x,'cpu'))?3.2:-100;
    if(k==='sixColorless')return 2.8;
    return -100;
  }

  function respondToStack(g) {
    const a=api(),p=g.cpu;
    if(!g.stack.length||g.priority!=='cpu'||g.resolvingStack)return false;
    const top=g.stack[g.stack.length-1];
    if(top.owner==='cpu') { a.passPriority(); return true; }
    const candidates=p.hand.filter(c=>c.t!=='land'&&c.t!=='summoner'&&(c.timing==='instant'||String(c.txt||'').includes('高速詠唱')))
      .map(c=>({c,score:cardResponseValue(c,g,top)})).filter(x=>x.score>=3.1)
      .sort((x,y)=>y.score-x.score);
    for(const item of candidates){
      if(!a.canAddToStack(item.c,'cpu'))continue;
      if(!a.canPayCost(p,item.c)){
        if(g.blockPending)return false;
        if(!ensureMana(item.c,'cpu',true))continue;
      }
      if(!a.canPayAllPlayCosts(p,item.c))continue;
      const idx=p.hand.indexOf(item.c);
      if(idx<0)continue;
      AI.currentCard=item.c;
      a.playCard(idx,'cpu');
      return true;
    }
    a.passPriority();
    return true;
  }

  function targetForButton(label,g) {
    const zones=[
      ['cpu','field'],['you','field'],['cpu','lands'],['you','lands'],
      ['cpu','grave'],['you','grave'],['cpu','hand'],['cpu','deck']
    ];
    for(const [owner,zone] of zones){
      for(const c of (g[owner]?.[zone]||[])){
        if(c.name&&label.includes(c.name))return {card:c,owner,zone};
      }
    }
    return null;
  }

  function targetScore(info,title,g,buttonText='') {
    if(!info)return -1;
    const {card:c,owner,zone}=info;
    const own=owner==='cpu';
    const v=zone==='field'?cardThreat(c,owner):cardHandValue(simpleCard(c));
    const lower=title.toLowerCase();
    if(title.includes('発動する'))return 100;
    if(title.includes('破壊する自分')||title.includes('墓地へ送る自分')||title.includes('流脈ゾーンのカードとして')||title.includes('山札の下'))return own?-v:-100;
    if(title.includes('手札に加える')||title.includes('墓地から')||title.includes('回収'))return own?v:-100;
    if(title.includes('パワーを-')||title.includes('SP-')||title.includes('タップする相手')||title.includes('破壊する相手')||title.includes('対象の相手')||title.includes('相手モンスター'))return own?-100:v;
    if(title.includes('ブロックされない')||title.includes('速攻')||title.includes('SP+')||title.includes('炸裂')||title.includes('強化'))return own?v:-100;
    if(title.includes('攻撃コスト'))return zone==='lands'?(c.isFaceDown?1:0.5):-100;
    if(title.includes('相手流脈ゾーン')||(zone==='lands'&&owner==='you')){
      const same=g.you.lands.filter(x=>x.color===c.color).length;
      return (c.tapped?0.5:1.5)+(same===1?2.2:0);
    }
    if(title.includes('裏向き流脈')&&zone==='grave')return own?-v:-100;
    if(title.includes('流脈カードを選択')||title.includes('流脈ゾーンに置く流脈カード')){
      if(c.t!=='land')return -100;
      const demand=g.cpu.hand.filter(x=>x.color===c.color&&x.t!=='land').length;
      return 2+demand*1.2;
    }
    if(zone==='deck')return own?cardHandValue(simpleCard(c)):-100;
    if(zone==='hand')return own?-cardHandValue(simpleCard(c)):-100;
    if(zone==='grave')return own?cardHandValue(simpleCard(c)):-100;
    if(zone==='lands')return own?1:-1;
    if(zone==='field')return own?-v:v;
    return v;
  }

  function buttonScore(button,title,g) {
    const label=button.textContent.trim();
    if(label.includes('発動する'))return 100;
    if(label.includes('発動しない'))return -100;
    if(label.includes('相手プレイヤーに')){
      const damage=Number((label.match(/(\d+)ダメージ/)||[])[1])||2;
      return g.you.hp<=damage?100:3.2+damage*0.55;
    }
    if(label.includes('相手モンスター1体に3ダメージ')){
      const targets=g.you.field.filter(x=>x.t==='monster'&&api().attackPower(x,'you')<=3000);
      return targets.length?5+Math.max(...targets.map(x=>cardThreat(x,'you'))):0;
    }
    const info=targetForButton(label,g);
    if(info)return targetScore(info,title,g,label);
    if(label.includes('選択を確定'))return -50;
    return 0;
  }

  function desiredMultiTargets(title,g,buttons) {
    const available=buttons.map(b=>({b,info:targetForButton(b.textContent,g)})).filter(x=>x.info);
    if(title.includes('最大2体を対象')||title.includes('最大2体を選択')){
      return available.sort((a,b)=>targetScore(b.info,title,g)-targetScore(a.info,title,g)).slice(0,2).map(x=>x.b);
    }
    if(AI.currentCard?.effectKey==='soulDrain'||title.includes('ソウル・ドレイン')){
      const count=g.cpu.hp<=12?Math.min(2,available.length):g.cpu.hp<=16?Math.min(1,available.length):0;
      return available.sort((a,b)=>targetScore(a.info,title,g)-targetScore(b.info,title,g)).slice(0,count).map(x=>x.b);
    }
    if(title.includes('破壊する自分のモンスター')){
      const count=g.cpu.hp<=12?Math.min(2,available.length):g.cpu.hp<=16?Math.min(1,available.length):0;
      return available.sort((a,b)=>targetScore(a.info,title,g)-targetScore(b.info,title,g)).slice(0,count).map(x=>x.b);
    }
    if(title.includes('墓地から最大'))return available.sort((a,b)=>targetScore(b.info,title,g)-targetScore(a.info,title,g)).slice(0,2).map(x=>x.b);
    return [];
  }

  function modalBelongsToAI(g) {
    if(!el('modal')||el('modal').style.display!=='flex')return false;
    if(g.action?.owner==='cpu')return true;
    if(g.pendingPlayDraft?.owner==='cpu')return true;
    if(g.resolvingEntryOwner==='cpu')return true;
    if(g.currentSummonerTriggerOwner==='cpu')return true;
    if(g.blockPending?.defender==='cpu')return true;
    if(g.turn==='cpu'&&!g.resolvingEntryOwner)return true;
    if(g.stack.length&&g.priority==='cpu'&&!g.resolvingStack)return true;
    return false;
  }

  function handleModal(g) {
    const title=el('modalTitle')?.textContent||'';
    const box=el('targets');
    if(!box)return false;
    let buttons=[...box.querySelectorAll('button')].filter(b=>!b.disabled);
    if(!buttons.length)return false;

    if(title.includes('能力を発動しますか')){
      const source=g.cpu.summoners.find(x=>title.includes(x.name));
      let activate=true;
      if(source?.summonerAbilityKey==='endUntapAll')activate=g.cpu.field.some(x=>x.t==='monster'&&x.tapped);
      if(['endDrawIf2Attacks','endDrawSummonerOnly'].includes(source?.summonerAbilityKey))activate=g.cpu.deck.length>0;
      const choice=buttons.find(b=>b.textContent.includes(activate?'発動する':'発動しない'));
      if(choice){choice.click();return true;}
    }

    const confirm=buttons.find(b=>b.textContent.includes('選択を確定'));
    if(confirm){
      const targetButtons=buttons.filter(b=>b!==confirm);
      const desired=desiredMultiTargets(title,g,targetButtons);
      const selected=targetButtons.filter(b=>b.textContent.trim().startsWith('✓'));
      const desiredSet=new Set(desired.map(b=>b.textContent.replace(/^✓\s*/,'')));
      const currentSet=new Set(selected.map(b=>b.textContent.replace(/^✓\s*/,'')));
      const missing=desired.find(b=>!currentSet.has(b.textContent.replace(/^✓\s*/,'')));
      if(missing){missing.click();return true;}
      confirm.click();return true;
    }

    // Omnimind: bottom the least useful four cards from the AI's own hand.
    if(title.includes('オムニ・マインド')){
      const candidates=buttons.map(b=>({b,info:targetForButton(b.textContent,g)})).filter(x=>x.info?.owner==='cpu'&&x.info.zone==='hand');
      if(candidates.length){candidates.sort((a,b)=>cardHandValue(simpleCard(a.info.card))-cardHandValue(simpleCard(b.info.card)));candidates[0].b.click();return true;}
    }

    // Scry/reorder: choose the strongest available top card first.
    if(title.includes('上から3枚')||title.includes('山札の上')){
      const candidates=buttons.map(b=>({b,info:targetForButton(b.textContent,g)})).filter(x=>x.info?.owner==='cpu'&&x.info.zone==='deck');
      if(candidates.length){candidates.sort((a,b)=>cardHandValue(simpleCard(b.info.card))-cardHandValue(simpleCard(a.info.card)));candidates[0].b.click();return true;}
    }

    // Multi-step hand/deck searches and ordinary target prompts.
    const scored=buttons.map(b=>({b,score:buttonScore(b,title,g)})).sort((a,b)=>b.score-a.score);
    if(scored.length){
      const best=scored[0];
      if(best.score>-80){best.b.click();return true;}
    }
    buttons[0].click();
    return true;
  }

  function chooseBlock(g) {
    const a=api(),bp=g.blockPending;
    if(!bp||bp.defender!=='cpu')return false;
    const attacker=a.findById(bp.attacker);
    if(!attacker){g.blockPending=null;return false;}
    const blockers=g.cpu.field.filter(x=>a.canBlock(attacker,x,bp.attackerOwner,'cpu'));
    if(!blockers.length){a.noBlock();return true;}
    const direct=!bp.attackTarget;
    const incoming=direct?a.attackSP(attacker):0;
    const lethal=direct&&incoming>=g.cpu.hp;
    const attackValue=cardThreat(attacker,'you');
    let best=null;
    for(const blocker of blockers){
      const ap=a.attackPower(attacker,bp.attackerOwner);
      let bpw=a.attackPower(blocker,'cpu')+a.blockingPowerBonus(blocker);
      if(blocker.effectKey==='blockHpPlus2')bpw+=2000;
      const attackerDies=ap<=bpw||!!attacker.burst||!!g.you.teamDeathtouch;
      const blockerDies=bpw<=ap||!!blocker.burst||!!g.cpu.teamDeathtouch;
      const savedDamage=direct?incoming*1.9:0;
      const value=(attackerDies?attackValue*1.25:0)-(blockerDies?cardThreat(blocker,'cpu')*1.25:0)+savedDamage;
      if(!best||value>best.value)best={blocker,value,attackerDies,blockerDies};
    }
    const shouldBlock=lethal||best.value>0.55;
    if(shouldBlock){a.chooseBlocker(best.blocker);return true;}
    a.noBlock();return true;
  }

  function combatOutcome(attacker, blocker, attackerOwner, blockerOwner) {
    const a=api();
    const ap=a.attackPower(attacker,attackerOwner);
    let bp=a.attackPower(blocker,blockerOwner)+a.blockingPowerBonus(blocker);
    if(blocker.effectKey==='blockHpPlus2')bp+=2000;
    const aDies=ap<=bp||!!attacker.burst||!!state()[attackerOwner].teamDeathtouch;
    const bDies=bp<=ap||!!blocker.burst||!!state()[blockerOwner].teamDeathtouch;
    return (bDies?cardThreat(blocker,blockerOwner)*1.2:0)-(aDies?cardThreat(attacker,attackerOwner)*1.2:0);
  }

  function evaluateAttack(attacker,target,g) {
    const a=api();
    const blockers=g.you.field.filter(x=>a.canBlock(attacker,x,'cpu','you'));
    const hasTrap=(g.you.counterAttack||0)>0;
    const burn=attacker.effectKey==='hasteBurn3'?4.65:0;
    if(hasTrap)return -cardThreat(attacker,'cpu')*1.4+burn;
    if(target==='face'){
      if(attacker.effectKey==='cannotAttackFace')return -100;
      const noBlock=a.attackSP(attacker)*2.1+burn+(g.you.hp<=a.attackSP(attacker)?35:0);
      if(!blockers.length)return noBlock;
      const bestDefense=Math.min(...blockers.map(b=>combatOutcome(attacker,b,'cpu','you')));
      return Math.min(noBlock,bestDefense+burn);
    }
    const noBlock=combatOutcome(attacker,target,'cpu','you')+burn;
    if(!blockers.length)return noBlock;
    const bestDefense=Math.min(noBlock,...blockers.map(b=>combatOutcome(attacker,b,'cpu','you')+burn));
    return bestDefense;
  }

  function chooseAttackTarget(attacker,g) {
    const a=api();
    const forced=a.forcedAttackTargets('cpu');
    if(forced.length){
      return forced.slice().sort((x,y)=>evaluateAttack(attacker,y,g)-evaluateAttack(attacker,x,g))[0];
    }
    const choices=[];
    if(attacker.effectKey!=='cannotAttackFace')choices.push({target:'face',score:evaluateAttack(attacker,'face',g)});
    g.you.field.filter(x=>x.t==='monster').forEach(x=>choices.push({target:x,score:evaluateAttack(attacker,x,g)}));
    choices.sort((x,y)=>y.score-x.score);
    if(!choices.length||choices[0].score<-0.2)return null;
    return choices[0].target;
  }

  function performAttack(g) {
    const a=api();
    if(g.blockPending)return false;
    const forced=a.forcedAttackers('cpu');
    const attackers=(forced.length?forced:g.cpu.field.filter(x=>a.canAttackMonsterNow(x,'cpu')))
      .slice().sort((x,y)=>cardThreat(y,'cpu')-cardThreat(x,'cpu'));
    for(const attacker of attackers){
      if(!a.canAttackMonsterNow(attacker,'cpu'))continue;
      const target=chooseAttackTarget(attacker,g);
      if(!target)continue;
      a.selectAttacker(attacker);
      if(target==='face')a.declareDirectAttack();
      else a.selectTarget(target);
      return true;
    }
    return false;
  }

  function mainPhase(g) {
    const a=api(),p=g.cpu;
    if(p.drawPending>0){a.playerDraw();return true;}
    if(!p.land&&!p.mainActionStarted){
      const c=chooseLandDrop(g);
      if(c){const i=p.hand.indexOf(c);a.playLand(i,c.t!=='land','cpu');return true;}
    }
    if(maybeUseSummonerAbility(g))return true;
    const plan=searchBestFirstPlay(g);
    if(plan){
      const c=p.hand.find(x=>x.id===plan.id);
      if(c&&validTargetsFor(c,g)&&a.canPayAllPlayCosts(p,c)){
        AI.currentCard=c;
        const index=p.hand.indexOf(c);
        a.playCard(index,'cpu');
        return true;
      }
      if(c&&validTargetsFor(c,g)&&ensureMana(c,'cpu',true)){
        AI.currentCard=c;
        a.playCard(p.hand.indexOf(c),'cpu');
        return true;
      }
    }
    if(g.phase==='MAIN PHASE'){
      el('battleBtn')?.click();
      return true;
    }
    return false;
  }

  function tick() {
    const g=state();
    if(!AI.enabled||!gameIsReady(g)||g.over){setStatus('');return;}
    if(AI.busy)return;
    AI.busy=true;
    try {
      // AI block decisions happen even during the human player's turn.
      if(g.blockPending?.defender==='cpu'){
        setStatus('AI思考中');chooseBlock(g);return;
      }

      // Draws caused by an AI-owned effect must be completed by the AI.
      const aiEffectOwner=g.action?.owner==='cpu'||g.resolvingEntryOwner==='cpu'||g.pendingPlayDraft?.owner==='cpu'||g.currentSummonerTriggerOwner==='cpu';
      if(g.cpu.drawPending>0&&(g.turn==='cpu'||aiEffectOwner)){
        setStatus('AIドロー中');api().playerDraw();return;
      }

      if(el('modal')?.style.display==='flex'){
        if(modalBelongsToAI(g)){
          setStatus('AI思考中');handleModal(g);return;
        }
        setStatus('');return;
      }

      if(g.resolvingStack||g.processingSummonerTrigger||g.triggerTargetPending||g.pendingPlayDraft||g.endingTurnSide){setStatus('');return;}

      if(g.stack.length){
        if(g.priority==='cpu'){
          setStatus('AI思考中');respondToStack(g);return;
        }
        setStatus('');return;
      }

      if(g.turn!=='cpu') {setStatus('');return;}
      setStatus('AI思考中');
      if(g.phase==='MAIN PHASE'){mainPhase(g);return;}
      if(g.phase==='BATTLE PHASE'){
        if(performAttack(g))return;
        if(!g.blockPending&&!g.stack.length){api().requestEndTurn();return;}
      }
    } catch(err) {
      console.error('[SUMMONER AI]',err);
      setStatus('AIエラー');
      // Fail safe: do not repeatedly invoke a broken action. Let the player
      // recover control through the existing controls.
    } finally {
      AI.busy=false;
    }
  }

  function schedule(ms=180) {
    if(AI.timer)clearTimeout(AI.timer);
    AI.timer=setTimeout(()=>{AI.timer=null;tick();},ms);
  }

  function startGame() {
    AI.lastActionAt=0;AI.lastStateKey='';
    updateLabels();
    if(AI.enabled)schedule(450);
    else setStatus('');
  }

  function boot() {
    updateLabels();
    const modal=el('modal');
    if(modal&&window.MutationObserver){
      AI.observer=new MutationObserver(()=>schedule(80));
      AI.observer.observe(modal,{attributes:true,childList:true,subtree:true});
    }
    window.setInterval(()=>{
      if(AI.enabled)schedule(120);
    },180);
    const toggle=el('aiOpponentEnabled');
    const level=el('aiDifficulty');
    if(toggle)toggle.addEventListener('change',()=>configure({enabled:toggle.checked,level:level?.value||AI.level}));
    if(level)level.addEventListener('change',()=>configure({enabled:toggle?.checked!==false,level:level.value}));
    configure({enabled:AI.enabled,level:AI.level});
  }

  function clearContext(){AI.currentAbilityKey='';AI.currentCard=null;}
  window.SUMMONER_AI={configure,startGame,boot,clearContext,get enabled(){return AI.enabled;},get level(){return AI.level;}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
