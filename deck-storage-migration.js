// Beta2 v30: 以前に保存された個人デッキを一度だけ削除する。
// ユーザー名、Firebaseの公開投稿、設定、初期デッキの定義は消去しない。
(function(){
  "use strict";
  const marker="summoner_saved_decks_reset_v30";
  try {
    if (localStorage.getItem(marker)==="completed") return;
    const keys=[];
    for (let i=0; i<localStorage.length; i++) {
      const key=localStorage.key(i);
      if (key && (key.startsWith("arcana_duel_decks_") || key.startsWith("arcana_duel_active_deck_"))) {
        keys.push(key);
      }
    }
    for (const key of keys) localStorage.removeItem(key);
    // 読み込み予約だけが残って旧デッキを復活させないようにする。
    localStorage.removeItem("summoner_deck_library_import");
    // 一度完了したら、新たにユーザーが保存するデッキは消さない。
    localStorage.setItem(marker,"completed");
  } catch (error) {
    console.warn("SUMMONER: 保存デッキの初回リセットが完了しませんでした",error);
  }
})();
