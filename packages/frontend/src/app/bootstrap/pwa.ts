const CACHE_PREFIX = 'nexus-terminal-cache-';
const DYNAMIC_IMPORT_RELOAD_KEY = 'nexus-dynamic-import-reload';

const isStaleDynamicImportError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(
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
  const registration = await navigator.serviceWorker?.getRegistration();
  await registration?.update().catch(() => undefined);
  window.location.reload();
  return true;
};

export const clearDynamicImportRecoveryMarker = (routePath: string): void => {
  if (sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) === routePath) {
    sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY);
  }
};
