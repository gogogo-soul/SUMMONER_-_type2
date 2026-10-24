// SUMMONER Beta2 v30: 依頼に基づく保存デッキの一度きりの初期化。
// ゲーム用のローカルデッキだけ削除します。ユーザー一覧・設定・Firebaseの共有投稿は対象外。
(function () {
  "use strict";
  const marker = "summoner_v30_saved_decks_reset_20261024";
  try {
    if (localStorage.getItem(marker) === "done") return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("arcana_duel_decks_") || key.startsWith("arcana_duel_active_deck_"))) {
        keys.push(key);
      }
    }
    for (const key of keys) localStorage.removeItem(key);
    localStorage.setItem(marker, "done");
  } catch (error) {
    console.warn("SUMMONER: 保存デッキの初期化に失敗しました。", error);
  }
})();
