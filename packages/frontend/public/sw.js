/** Service Worker 版本号，每次部署时递增以触发更新检测 */
const SW_VERSION = '2.0.0';

// 命名缓存桶，按资源类型隔离
const CACHE_STATIC = `nexus-static-v${SW_VERSION}`;
const CACHE_API = `nexus-api-v${SW_VERSION}`;
const CACHE_ICONS = `nexus-icons-v${SW_VERSION}`;
const CACHE_PAGES = `nexus-pages-v${SW_VERSION}`;

// API 缓存配置
const API_CACHE_MAX = 50;
const API_TIMEOUT_MS = 10000;

// 预缓存的应用 shell 资源
const APP_SHELL_URLS = ['/', '/index.html'];

// 需要预缓存的图标
const ICON_URLS = [
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
];

// ==================== install ====================
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      // 预缓存应用 shell
      caches.open(CACHE_STATIC).then((cache) => cache.addAll(APP_SHELL_URLS)),
      // 预缓存图标
      caches.open(CACHE_ICONS).then((cache) => cache.addAll(ICON_URLS)),
    ])
  );
  self.skipWaiting();
});

// ==================== fetch ====================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 仅处理同源请求
  if (url.origin !== self.location.origin) return;

  // 导航请求：Network-First，降级到缓存的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithFallback(request, CACHE_PAGES));
    return;
  }

  // API 请求：Network-First，10 秒超时降级到缓存
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithTimeout(request, CACHE_API, API_TIMEOUT_MS));
    return;
  }

  // 静态资源（JS/CSS/字体）：Cache-First
  if (
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.ttf')
  ) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 图标：Cache-First
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, CACHE_ICONS));
    return;
  }

  // 其他请求：Network-First
  event.respondWith(networkFirst(request));
});

// ==================== activate ====================
self.addEventListener('activate', (event) => {
  const currentCaches = [CACHE_STATIC, CACHE_API, CACHE_ICONS, CACHE_PAGES];
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => !currentCaches.includes(name))
            .map((name) => caches.delete(name))
        )
      )
  );
  self.clients.claim();
});

// ==================== message ====================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_SW_VERSION') {
    event.source.postMessage({ type: 'SW_VERSION', version: SW_VERSION });
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // 运行时缓存指定 URL（供客户端按需缓存 API 响应等）
  if (event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls)) {
    caches
      .open(CACHE_API)
      .then((cache) =>
        Promise.all(event.data.urls.map((url) => fetch(url).then((r) => cache.put(url, r))))
      );
  }
});

// ==================== 缓存策略实现 ====================

/** Cache-First：优先从缓存读取，未命中则网络请求并缓存 */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/** Network-First：优先网络请求，失败时降级到缓存 */
async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

/** Network-First + 离线降级：导航请求专用，失败时返回缓存的 index.html */
async function networkFirstWithFallback(request, cacheName) {
  try {
    const response = await fetch(request);
    // 缓存最新的 index.html 供离线使用
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match('/index.html'));
    return (
      cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } })
    );
  }
}

/** Network-First + 超时降级：API 请求专用，超时后降级到缓存 */
async function networkFirstWithTimeout(request, cacheName, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
      // 限制 API 缓存条目数量，FIFO 淘汰
      trimCache(cacheName, API_CACHE_MAX);
    }
    return response;
  } catch {
    clearTimeout(timeoutId);
    const cached = await caches.match(request);
    return (
      cached ||
      new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }
}

/** 限制缓存条目数量，淘汰最早的条目 */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    // 删除最早的条目（keys[0] 是最早的）
    await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
  }
}
