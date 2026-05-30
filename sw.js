/* ==========================================================================
   sw.js — Service Worker do ProcDetails
   Estratégia:
   - Recursos externos (CDN): cache-first (D3, sql.js, fontes)
   - Recursos locais: network-first com fallback ao cache (inclui .enc)
   ========================================================================== */
const CACHE = 'procdetails-v1';

/* Pré-cache do shell — instalado na primeira visita */
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './services.js',
  './store.js',
  './grafo.js',
  './manifest.json',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  if (ev.request.method !== 'GET') return;

  const url = new URL(ev.request.url);
  const isCDN = url.origin !== self.location.origin;

  if (isCDN) {
    /* Recursos externos: cache-first, atualiza em background */
    ev.respondWith(
      caches.match(ev.request).then((cached) => {
        const fresh = fetch(ev.request).then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(ev.request, res.clone()));
          return res;
        }).catch(() => null);
        return cached || fresh;
      })
    );
  } else {
    /* Recursos locais (.enc, JS, CSS, HTML): network-first, cache como fallback */
    ev.respondWith(
      fetch(ev.request)
        .then((res) => {
          /* Não cache respostas parciais (range requests do .enc) */
          if (res.ok && res.status !== 206) {
            caches.open(CACHE).then((c) => c.put(ev.request, res.clone()));
          }
          return res;
        })
        .catch(() => caches.match(ev.request))
    );
  }
});
