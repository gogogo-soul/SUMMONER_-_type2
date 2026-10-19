const CACHE_NAME = "summoner-pwa-v20-rulebook-pdf-r1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./summoner.html",
  "./deckbuilder.html",
  "./decklibrary.html",
  "./updates.html",
  "./SUMMONER_Rulebook_Beta2_v2.0.pdf",
  "./cards.js",
  "./firebase-config.js",
  "./pwa.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async()=>{
    try{
      const fresh = await fetch(event.request, {cache:"no-store"});
      if (fresh && fresh.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") return caches.match("./index.html");
      throw _;
    }
  })());
});
