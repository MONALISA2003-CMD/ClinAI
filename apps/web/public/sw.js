/* P1 privacy boundary: cache only immutable same-origin static assets. Never
 * cache HTML, API responses, authenticated pages, patient data or POST bodies. */
const CACHE = 'clinai-static-p1';
const STATIC_ASSETS = [
  '/manifest.json',
  '/clinai-icon.png',
  '/clinai-icon-192.png',
  '/clinai-logo.png',
  '/favicon-16.png',
  '/favicon-32.png',
  '/favicon-64.png',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => /^(clinai-shell-|clinai-static-)/.test(key) && key !== CACHE)
        .map((key) => caches.delete(key)),
    )),
  ]));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isStaticAsset = STATIC_ASSETS.includes(url.pathname) || url.pathname.startsWith('/_next/static/');
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (!response.ok || response.type !== 'basic') return response;
    const cacheControl = response.headers.get('cache-control') || '';
    if (/\b(no-store|private)\b/i.test(cacheControl) || response.headers.has('set-cookie')) return response;
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
    return response;
  })());
});
