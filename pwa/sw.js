// Offline app shell: cache-first with background refresh for same-origin
// static assets; /api/* is never cached (sync must always hit the server).
// Bump CACHE when shipping asset changes to force a clean refetch.

const CACHE = 'zw-shell-v3';
// The dictionary TSVs are large (~13 MB) and effectively immutable, so they
// live in their own cache-first bucket that survives shell bumps: no
// background refetch on every visit. Bump DATA_CACHE to ship new data.
const DATA_CACHE = 'zw-data-v1';
const SHELL = [
  './', // the assets handler serves index.html here (and 307s /index.html to it)
  './app.js',
  './db.js',
  './sync.js',
  './review.js',
  './wordlist.js',
  './details.js',
  './speech.js',
  './lib/srs.js',
  './lib/merge.js',
  './lib/cedict.js',
  './lib/dict.js',
  './manifest.webmanifest',
  './icons/icon180.png',
  './icons/icon192.png',
  './icons/icon512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // network only

  if (url.pathname.includes('/data/')) {
    // strict cache-first: fetch once, then serve from cache forever
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Stale-while-revalidate: serve from cache instantly, refresh in the
  // background so the next load picks up deployed changes.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const refresh = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    }),
  );
});
