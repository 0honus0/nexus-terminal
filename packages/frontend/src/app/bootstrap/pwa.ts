import {
	jsonStorageCodec,
	readStoredValue,
	removeStoredValue,
	stringStorageCodec,
	writeStoredValue,
} from '@/foundation/browser';
import { reactive, readonly } from 'vue';

const CACHE_PREFIX = 'nexus-terminal-cache-';
const dynamicImportReloadStorage = {
	namespace: 'pwa.dynamic-import-reload',
	version: 1,
	area: 'session',
	codec: stringStorageCodec(),
	legacyKeys: ['nexus-dynamic-import-reload'],
} as const;
const GLOBAL_DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS = 60_000;
const APP_UPDATE_CHECK_INTERVAL_MS = 60_000;

const appUpdateState = reactive({
	available: false,
	applying: false,
	dismissed: false,
});

export const appUpdate = readonly(appUpdateState);

let serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
let pendingUpdateWorker: ServiceWorker | null = null;
let dismissedUpdateWorker: ServiceWorker | null = null;
let serviceWorkerControlledAtStartup = false;
let lastUpdateCheckAt = 0;

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
		cacheNames
			.filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
			.map((cacheName) => caches.delete(cacheName)),
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

const globalDynamicImportReloadStorage = {
	namespace: 'pwa.global-dynamic-import-reload',
	version: 1,
	area: 'session',
	codec: jsonStorageCodec<GlobalDynamicImportReloadMarker>((value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
		const candidate = value as Record<string, unknown>;
		return typeof candidate.target === 'string' && typeof candidate.attemptedAt === 'number'
			? { target: candidate.target, attemptedAt: candidate.attemptedAt }
			: undefined;
	}),
	legacyKeys: ['nexus-global-dynamic-import-reload'],
} as const;

const recentGlobalReloadAttempt = (target: string): boolean => {
	const marker = readStoredValue(globalDynamicImportReloadStorage);
	return Boolean(
		marker &&
		marker.target === target &&
		Date.now() - marker.attemptedAt < GLOBAL_DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS,
	);
};

const markGlobalReloadAttempt = (target: string): void => {
	writeStoredValue(globalDynamicImportReloadStorage, { target, attemptedAt: Date.now() });
};

const announceAppUpdate = (worker: ServiceWorker | null): void => {
	if (!serviceWorkerControlledAtStartup || appUpdateState.available || !worker || worker === dismissedUpdateWorker)
		return;
	pendingUpdateWorker = worker;
	appUpdateState.available = true;
	appUpdateState.dismissed = false;
};

const monitorUpdateWorker = (worker: ServiceWorker | null): void => {
	if (!worker) return;

	const check = (): void => {
		if (worker.state === 'installed' || worker.state === 'activated') announceAppUpdate(worker);
	};

	check();
	worker.addEventListener('statechange', check);
};

const monitorServiceWorkerRegistration = (registration: ServiceWorkerRegistration): void => {
	serviceWorkerRegistration = registration;
	if (registration.waiting) monitorUpdateWorker(registration.waiting);
	if (registration.installing) monitorUpdateWorker(registration.installing);
	registration.addEventListener('updatefound', () => monitorUpdateWorker(registration.installing));
};

const checkForAppUpdate = (force = false): void => {
	const now = Date.now();
	if (!force && now - lastUpdateCheckAt < APP_UPDATE_CHECK_INTERVAL_MS) return;
	lastUpdateCheckAt = now;
	void serviceWorkerRegistration?.update().catch(() => undefined);
};

export const dismissAppUpdate = (): void => {
	appUpdateState.dismissed = true;
	appUpdateState.available = false;
	dismissedUpdateWorker = pendingUpdateWorker;
	pendingUpdateWorker = null;
};

export const applyAppUpdate = async (): Promise<void> => {
	if (!appUpdateState.available || appUpdateState.applying) return;
	appUpdateState.applying = true;

	const worker = pendingUpdateWorker;
	if (worker && worker.state !== 'activated' && worker.state !== 'redundant') {
		await new Promise<void>((resolve) => {
			const finish = (): void => {
				window.clearTimeout(timer);
				worker.removeEventListener('statechange', finish);
				resolve();
			};

			const timer = window.setTimeout(finish, 1_500);
			worker.addEventListener('statechange', finish);
		});
	}

	try {
		await clearAppCaches();
	} finally {
		window.location.reload();
	}
};

let serviceWorkerRegistrationInitialized = false;

export const registerAppServiceWorker = (): void => {
	if (!('serviceWorker' in navigator)) return;
	if (serviceWorkerRegistrationInitialized) return;
	serviceWorkerRegistrationInitialized = true;
	serviceWorkerControlledAtStartup = Boolean(navigator.serviceWorker.controller);

	navigator.serviceWorker.addEventListener('controllerchange', () => {
		if (serviceWorkerControlledAtStartup) announceAppUpdate(navigator.serviceWorker.controller);
	});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') checkForAppUpdate();
	});
	window.addEventListener('online', () => checkForAppUpdate(true));

	window.addEventListener(
		'load',
		() => {
			void navigator.serviceWorker
				.register('/sw.js?v=4', { updateViaCache: 'none' })
				.then((registration) => {
					monitorServiceWorkerRegistration(registration);
					checkForAppUpdate(true);
				})
				.catch(() => undefined);
		},
		{ once: true },
	);
};

export const recoverStaleDynamicImport = async (error: unknown, reloadTarget: string): Promise<boolean> => {
	if (!isStaleDynamicImportError(error)) return false;
	if (readStoredValue(dynamicImportReloadStorage) === reloadTarget) return true;

	writeStoredValue(dynamicImportReloadStorage, reloadTarget);
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
	if (readStoredValue(dynamicImportReloadStorage) === routePath) removeStoredValue(dynamicImportReloadStorage);
};
