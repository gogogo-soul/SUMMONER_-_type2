// SUMMONER 初期デッキ定義：ユーザー指定の7種類（通常50枚＋召喚士1枚）。
// ローカル保存デッキの一度きりのリセットは deck-reset-v30.js が担当。
(function(){
  "use strict";
  const sources = [
  {
    "name": "赤・フェヌグリーク",
    "code": "SMN2-AzINAQQDBAYECAMJAwoDDAMNBBEEEwQUAm0Bgwwf"
  },
  {
    "name": "青・ルフナ",
    "code": "SMN2-AzIMFgQYBBoEGwQfBCAEJQQmBCcEKgRvAYQK2Q"
  },
  {
    "name": "緑・オニキス",
    "code": "SMN2-AzIMLgQvBDADMwM1BDgEOgQ7BD0EPgR0AYUMFg"
  },
  {
    "name": "黄・ダニエル",
    "code": "SMN2-AzIMQARDBEYESQRKBEsETgRRAlIEVAR6AYYMBA"
  },
  {
    "name": "黒・ネグローニ",
    "code": "SMN2-AzIMVQJXBFoEWwRdBGAEYQRiBGcEaASAAYcM-Q"
  },
  {
    "name": "赤青緑・フェヌグリーク",
    "code": "SMN2-AzIODQQPBBMCHwMlBCYELwQ4AjsEPgRtAYMFhAWFBZY"
  },
  {
    "name": "青緑黒・ルフナ",
    "code": "SMN2-AzIOHwIgBCUEJgQvBDgEPQRaBF0EYAJvAYQFhQWHBHg"
  }
];
  function decode(code){
    const data=code.slice(5).replace(/-/g,"+").replace(/_/g,"/");
    const str=atob(data+"=".repeat((4-data.length%4)%4));
    const bytes=Array.from(str,c=>c.charCodeAt(0));
    if(!code.startsWith("SMN2-")||bytes.length<4)throw new Error("初期デッキコードが不正です");
    let sum=0x5a;
    for(let i=0;i<bytes.length-1;i++)sum=((sum*33)^bytes[i])&0xff;
    if(sum!==bytes[bytes.length-1])throw new Error("初期デッキコードの検証に失敗しました");
    const [version,total,entryCount]=bytes;
    if(version!==3||total!==50||bytes.length!==4+entryCount*2)throw new Error("初期デッキの形式が不正です");
    const numbers=new Map(Object.entries(DB).map(([name,card])=>[Number(String(card.code||"").replace("BS01-","")),name]));
    const counts={};
    let main=0,summoners=0;
    for(let i=0;i<entryCount;i++){
      const id=bytes[3+2*i],amount=bytes[4+2*i],name=numbers.get(id);
      if(!name||Object.hasOwn(counts,name)||amount<1||amount>(DB[name].t==="summoner"?1:(DB[name].n||4)))throw new Error("初期デッキに未対応カードが含まれています");
      counts[name]=amount;
      if(DB[name].t==="summoner")summoners+=amount;
      else main+=amount;
    }
    if(main!==50||summoners!==1)throw new Error("初期デッキの構築枚数が不正です");
    return Object.freeze(counts);
  }
  window.SUMMONER_STARTER_DECKS=Object.freeze(sources.map((item,i)=>Object.freeze({id:"__starter_"+i,name:item.name,code:item.code,counts:decode(item.code)})));
})();
