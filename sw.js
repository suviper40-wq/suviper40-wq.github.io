// Tiene in cache i file dell'app, così si apre subito anche con poca rete.
// Le chiamate a Gemini non passano di qui.
const CACHE = 'rulcio-v1';
const FILE = [
  './', 'index.html', 'style.css', 'app.js', 'gemini.js', 'prompts.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/marked.umd.js', 'vendor/purify.min.js', 'vendor/katex.min.js', 'vendor/katex.min.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((chiavi) => Promise.all(chiavi.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Prima la rete (per avere sempre l'ultima versione), la cache se si è offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
