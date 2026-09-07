const CACHE_PREFIX = 'nexus-terminal-cache-';
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const STATIC_RESOURCES = [
  '/manifest.json',
  '/icons/icon-144x144.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_RESOURCES)));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  const isStaticPwaResource = requestUrl.pathname === '/manifest.json' || requestUrl.pathname.startsWith('/icons/');
  if (!isStaticPwaResource) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const responseToCache = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
              .map((cacheName) => caches.delete(cacheName)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});
