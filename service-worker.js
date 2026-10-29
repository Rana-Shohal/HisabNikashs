const CACHE = 'lenden-khata-v7';
const ASSETS = ['./', './index.html', './people.html', './records.html', './settings.html', './common.js', './common.css', './manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // never cache API POST/GET calls to Apps Script
  const url = e.request.url;
  if (url.includes('script.google.com')) return; // always go to network for API
  if (url.includes('accounts.google.com') || url.includes('googleusercontent.com')) return; // Google login / avatars

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      return (
        cached ||
        fetch(e.request)
          .then((res) => {
            const resClone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, resClone));
            return res;
          })
          .catch(() => cached)
      );
    })
  );
});
