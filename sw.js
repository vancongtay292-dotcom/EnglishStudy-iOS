const CACHE = 'english-study-ios-v1.1.1-word-family';
const CORE = [
  './','./index.html','./styles.css','./manifest.webmanifest','./VERSION.txt',
  './js/app.js','./js/db.js','./js/crypto.js','./js/importer.js','./js/ai.js','./js/audio.js','./js/utils.js',
  './icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url=new URL(e.request.url);
  if(url.origin!==self.location.origin)return;
  e.respondWith(
    fetch(e.request).then(resp=>{
      const copy=resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});
      return resp;
    }).catch(async()=>{
      const cached=await caches.match(e.request);
      return cached || caches.match('./index.html');
    })
  );
});
