import type { Pinia } from 'pinia';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { createAuthNavigationFacade, loadSetupView } from '@/features/auth/public';
import { loadConnectionsView } from '@/features/connections/public';
import { loadProxiesView } from '@/features/proxies/public';
import { loadTargetsNextDevView } from '@/features/targets-next/public';
import { loadAgentNextDevView } from '@/features/agent/public';
import { loadNotificationsView } from '@/features/notifications/public';
import { loadAuditLogView } from '@/features/audit/public';
import { clearDynamicImportRecoveryMarker, recoverStaleDynamicImport } from '@/app/bootstrap/pwa';

const loadDashboard = () => import('../pages/dashboard/DashboardPage.vue');

const loadLogin = () => import('../pages/login/LoginPage.vue');

const loadSettings = () => import('../pages/settings/SettingsPage.vue');

const loadWorkspacePage = () => import('../pages/workspace/WorkspacePage.vue');

let authenticatedPreloadScheduled = false;

const canPreloadRoutes = (): boolean => {
	if (navigator.onLine === false || document.visibilityState !== 'visible') return false;
	const connection = (
		navigator as Navigator & {
			connection?: { saveData?: boolean; effectiveType?: string; rtt?: number; downlink?: number };
		}
	).connection;
	return !(
		connection?.saveData ||
		['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '') ||
		(connection?.rtt !== undefined && connection.rtt >= 300) ||
		(connection?.downlink !== undefined && connection.downlink <= 1)
	);
};

export const preloadAuthenticatedRoutes = (): void => {
	if (authenticatedPreloadScheduled || typeof window === 'undefined' || !canPreloadRoutes()) return;
	authenticatedPreloadScheduled = true;

	const preload = async () => {
		// Warm the common connection/terminal path only. Settings and administrative
		// pages stay lazy instead of competing with the current page's requests.
		for (const loader of [loadConnectionsView, loadWorkspacePage]) {
			if (!canPreloadRoutes()) return;
			await loader().catch(() => undefined);
		}
	};

	const requestIdle = (
		window as Window & {
			requestIdleCallback?: (callback: () => void) => number;
		}
	).requestIdleCallback;
	if (requestIdle) requestIdle.call(window, () => void preload());
	else window.setTimeout(() => void preload(), 800);
};

const routes: RouteRecordRaw[] = [
	{
		path: '/',
		name: 'Dashboard',
		meta: { keepAlive: true },
		component: loadDashboard,
	},
	{
		path: '/login',
		name: 'Login',
		meta: { public: true },
		component: loadLogin,
	},
	{
		path: '/setup',
		name: 'Setup',
		meta: { public: true },
		component: loadSetupView,
	},
	{ path: '/workspace', name: 'Workspace', component: loadWorkspacePage, meta: { keepAlive: true } },
	{
		path: '/connections',
		name: 'Connections',
		meta: { keepAlive: true },
		component: loadConnectionsView,
	},
	{
		path: '/proxies',
		name: 'Proxies',
		meta: { keepAlive: true },
		component: loadProxiesView,
	},
	{
		path: '/notifications',
		name: 'Notifications',
		meta: { keepAlive: true },
		component: loadNotificationsView,
	},
	{
		path: '/audit-logs',
		name: 'AuditLogs',
		meta: { keepAlive: true },
		component: loadAuditLogView,
	},
	{
		path: '/settings',
		name: 'Settings',
		meta: { keepAlive: true },
		component: loadSettings,
	},
	{
		path: '/:pathMatch(.*)*',
		redirect: '/',
	},
];

if (import.meta.env.DEV) {
	const catchAllIndex = routes.findIndex((route) => route.path === '/:pathMatch(.*)*');
	routes.splice(catchAllIndex < 0 ? routes.length : catchAllIndex, 0, {
		path: '/__ui',
		name: 'UiGallery',

		component: () => import('../pages/ui/UiGalleryPage.vue'),
	});
	routes.splice(catchAllIndex < 0 ? routes.length : catchAllIndex, 0, {
		path: '/__targets-next',
		name: 'TargetsNextDev',
		component: loadTargetsNextDevView,
	});
	routes.splice(catchAllIndex < 0 ? routes.length : catchAllIndex, 0, {
		path: '/__agent-next',
		name: 'AgentNextDev',
		component: loadAgentNextDevView,
	});
}

export const createAppRouter = (pinia: Pinia) => {
	const router = createRouter({
		history: createWebHistory(import.meta.env.BASE_URL),
		routes,
	});
	const auth = createAuthNavigationFacade(pinia);

	router.onError(async (error, to) => {
		const reloadTarget = to.fullPath || window.location.pathname;
		await recoverStaleDynamicImport(error, reloadTarget);
	});

	router.afterEach((to) => {
		clearDynamicImportRecoveryMarker(to.fullPath);
	});

	router.beforeEach(async (to) => {
		// DEV inspection view; it uses the same Backend as the formal application.
		if (import.meta.env.DEV && (to.name === 'TargetsNextDev' || to.name === 'AgentNextDev')) return true;
		await auth.resolveSetupState();
		if (!auth.setupResolved) {
			return to.name === 'Login' ? true : { name: 'Login' };
		}

		if (auth.setupRequired && to.name !== 'Setup') return { name: 'Setup' };

		if (!auth.setupRequired && to.name === 'Setup') {
			await auth.resolveSession();
			return auth.authenticated ? { name: 'Dashboard' } : { name: 'Login' };
		}

		await auth.resolveSession();
		const isPublic = to.meta.public === true;

		if (!isPublic && !auth.authenticated) return { name: 'Login' };
		if (to.name === 'Login' && auth.authenticated) return { name: 'Dashboard' };
		return true;
	});

	return router;
};
