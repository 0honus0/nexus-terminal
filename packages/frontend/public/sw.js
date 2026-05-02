/** Service Worker 版本号，每次部署时递增以触发更新检测 */
const SW_VERSION = '1.0.0';
const CACHE_NAME = `nexus-terminal-cache-${SW_VERSION}`;
const urlsToCache = [
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const shouldBypassCache =
    event.request.mode === 'navigate' ||
    requestUrl.pathname === '/' ||
    requestUrl.pathname === '/index.html' ||
    requestUrl.pathname === '/manifest.json';

  if (shouldBypassCache) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(event.request);
    })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

/**
 * 处理来自客户端的消息
 * 支持版本查询：客户端发送 { type: 'GET_SW_VERSION' }，SW 回复当前版本号
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_SW_VERSION') {
    event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
  }
  // 客户端确认跳过等待，立即激活新 SW
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
