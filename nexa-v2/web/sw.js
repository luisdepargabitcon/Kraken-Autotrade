// NEXA V2 — service worker mínimo: app-shell cache + red para /api.
const CACHE='nexa-v2-shell-v1';
const SHELL=['./','./index.html','./css/style.css','./manifest.webmanifest','./assets/icon.svg',
  './js/app.js','./js/ui.js','./js/util.js','./js/contracts.js','./js/fixtures.js','./js/provider.js','./js/screens.js'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET') return;            // nunca cachear mutaciones
  if(url.pathname.startsWith('/api/')){           // red primero para datos vivos
    e.respondWith(fetch(e.request).catch(()=>caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
