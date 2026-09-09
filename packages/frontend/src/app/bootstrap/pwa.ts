const CACHE_PREFIX = 'nexus-terminal-cache-';
const DYNAMIC_IMPORT_RELOAD_KEY = 'nexus-dynamic-import-reload';
const GLOBAL_DYNAMIC_IMPORT_RELOAD_KEY = 'nexus-global-dynamic-import-reload';
const GLOBAL_DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS = 60_000;

const isStaleDynamicImportError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed|Unable to preload CSS for/i.test(
    message,
  );
};

const clearAppCaches = async (): Promise<void> => {
  if (!('caches' in window)) return;

  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames.filter((cacheName) => cacheName.startsWith(CACHE_PREFIX)).map((cacheName) => caches.delete(cacheName)),
  );
};

const updateServiceWorker = async (): Promise<void> => {
  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.update().catch(() => undefined);
};

const currentReloadTarget = (): string => `${window.location.pathname}${window.location.search}${window.location.hash}`;

interface GlobalDynamicImportReloadMarker {
  target: string;
  attemptedAt: number;
}

const recentGlobalReloadAttempt = (target: string): boolean => {
  try {
    const raw = sessionStorage.getItem(GLOBAL_DYNAMIC_IMPORT_RELOAD_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw) as Partial<GlobalDynamicImportReloadMarker>;
    return (
      marker.target === target &&
      typeof marker.attemptedAt === 'number' &&
      Date.now() - marker.attemptedAt < GLOBAL_DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS
    );
  } catch {
    return false;
  }
};

const markGlobalReloadAttempt = (target: string): void => {
  sessionStorage.setItem(
    GLOBAL_DYNAMIC_IMPORT_RELOAD_KEY,
    JSON.stringify({ target, attemptedAt: Date.now() } satisfies GlobalDynamicImportReloadMarker),
  );
};

export const registerAppServiceWorker = (): void => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker
        .register('/sw.js?v=4', { updateViaCache: 'none' })
        .then((registration) => registration.update())
        .catch(() => undefined);
    },
    { once: true },
  );
};

export const recoverStaleDynamicImport = async (error: unknown, reloadTarget: string): Promise<boolean> => {
  if (!isStaleDynamicImportError(error)) return false;
  if (sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) === reloadTarget) return true;

  sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, reloadTarget);
  await clearAppCaches();
  await updateServiceWorker();
  window.location.reload();
  return true;
};

const recoverGlobalDynamicImport = async (error: unknown): Promise<boolean> => {
  if (!isStaleDynamicImportError(error)) return false;
  const reloadTarget = currentReloadTarget();
  if (recentGlobalReloadAttempt(reloadTarget)) return true;

  markGlobalReloadAttempt(reloadTarget);
  await clearAppCaches();
  await updateServiceWorker();
  window.location.reload();
  return true;
};

let globalDynamicImportRecoveryRegistered = false;

export const registerGlobalDynamicImportRecovery = (): void => {
  if (globalDynamicImportRecoveryRegistered) return;
  globalDynamicImportRecoveryRegistered = true;

  window.addEventListener('vite:preloadError', (event) => {
    const preloadEvent = event as Event & { payload?: unknown };
    if (!isStaleDynamicImportError(preloadEvent.payload)) return;
    event.preventDefault();
    void recoverGlobalDynamicImport(preloadEvent.payload);
  });

  window.addEventListener('error', (event) => {
    const cause = event.error ?? event.message;
    if (!isStaleDynamicImportError(cause)) return;
    event.preventDefault();
    void recoverGlobalDynamicImport(cause);
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (!isStaleDynamicImportError(event.reason)) return;
    event.preventDefault();
    void recoverGlobalDynamicImport(event.reason);
  });
};

export const clearDynamicImportRecoveryMarker = (routePath: string): void => {
  if (sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) === routePath) {
    sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
  }
};
