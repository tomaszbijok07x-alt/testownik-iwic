const CACHE = 'iwi-c-e-github-1-9-2-7a0e70724b0e';
const FILES = ['./index.html', './style.css', './mobile.css', './app.js', './core.mjs', './questions.json', './topics.json', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const urls = FILES.map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const responses = await Promise.all(urls.map(async url => {
      const response = await fetch(url, {cache: 'reload', credentials: 'same-origin'});
      if (!response.ok || response.redirected || new URL(response.url).origin !== self.location.origin) throw new Error('Incomplete offline download');
      return response;
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(responses.map((response, i) => cache.put(urls[i], response)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key.startsWith('iwi-c-e-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // The cached shell and its versioned files form one complete release.
      // Online visits still pass through the private hosting access check.
      try {
        const response = await fetch(request);
        if (response.ok && !response.redirected) {
          const cache = await caches.open(CACHE);
          return (await cache.match(new URL('./index.html', self.registration.scope).href)) || response;
        }
        return response;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(new URL('./index.html', self.registration.scope).href)) || Response.error();
      }
    })());
  } else if (urls.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request)) || fetch(request);
    })());
  }
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'VERIFY_OFFLINE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const found = await Promise.all(urls.map(url => cache.match(url)));
    event.ports[0].postMessage({ok: found.every(Boolean), files: found.filter(Boolean).length, required: urls.length});
  })());
});
