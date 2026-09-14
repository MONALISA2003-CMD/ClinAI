const CACHE='clinai-shell-v26';
const OLD_CACHES=['clinai-shell-v15','clinai-shell-v16','clinai-shell-v17','clinai-shell-v18','clinai-shell-v19','clinai-shell-v20','clinai-shell-v21','clinai-shell-v22','clinai-shell-v23','clinai-shell-v24','clinai-shell-v25'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.json']).catch(()=>{})));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>OLD_CACHES.includes(k)&&k!==CACHE).map(k=>caches.delete(k))))]))});
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin)return;event.respondWith(fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r}).catch(()=>caches.match(event.request).then(r=>r||caches.match('/'))))});
