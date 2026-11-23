// NEXA rev24 — static shell only. Never cache API/auth responses.
// CACHE is rewritten by scripts/stamp-build.mjs at every build so each APK/web
// version invalidates the previous shell and never serves stale modules.
const CACHE='nexa-v2-dev';
const SHELL=[
 './','./index.html','./manifest.webmanifest','./assets/icon.svg',
 './css/style.css','./css/premium.css','./css/dashboard.css','./css/scope-portfolio.css',
 './js/app.js','./js/ui.js','./js/util.js','./js/contracts.js','./js/config.js',
 './js/provider.js','./js/screens.js','./js/premium.js','./js/premium-chart.js',
 './js/adapters.js','./js/auth.js','./js/actions.js','./js/pairing.js',
 './js/build-info.js','./js/dashboard.js','./js/display-scope.js','./js/experience.js',
 './js/fisco-view.js','./js/import-position.js','./js/inspector.js',
 './js/portfolio-view.js','./js/scoped-pages.js','./js/market-candles.js','./js/event-labels.js'
];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('nexa-v2-')&&key!==CACHE).map(key=>caches.delete(key))))
   .then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const req=event.request;
 const url=new URL(req.url);
 if(req.method!=='GET' || url.origin!==self.location.origin)return;
 // Fail closed: never return cached HTML in place of JSON or an auth challenge.
 if(url.pathname.includes('/api/')||url.pathname.includes('/v2/')||url.pathname.includes('/auth/')||
    url.pathname.includes('/pair/')||req.headers.has('Authorization'))return;
 const isShell=/\.(?:js|css|html|webmanifest|svg|png)$/.test(url.pathname)||url.pathname.endsWith('/');
 if(!isShell)return;
 // Network-first prevents stale APK/PWA code after updating premium navigation.
 event.respondWith(fetch(req).then(resp=>{
   if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(()=>{});}
   return resp;
 }).catch(()=>caches.match(req)));
});
