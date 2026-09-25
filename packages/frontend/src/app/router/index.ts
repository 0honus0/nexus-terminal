import type { Pinia } from 'pinia';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { createAuthNavigationFacade, loadSetupView } from '@/features/auth/public';
import { loadConnectionsView } from '@/features/connections/public';
import { loadProxiesView } from '@/features/proxies/public';
import { loadNotificationsView } from '@/features/notifications/public';
import { loadAuditLogView } from '@/features/audit/public';
import { loadWorkspaceView } from '@/runtimes/workspace/public';
import { clearDynamicImportRecoveryMarker, recoverStaleDynamicImport } from '@/app/bootstrap/pwa';

const loadDashboard = () => import('../pages/dashboard/DashboardPage.vue');
const loadLogin = () => import('../pages/login/LoginPage.vue');
const loadSettings = () => import('../pages/settings/SettingsPage.vue');

let authenticatedPreloadScheduled = false;
export const preloadAuthenticatedRoutes = (): void => {
  if (authenticatedPreloadScheduled || typeof window === 'undefined') return;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;
  authenticatedPreloadScheduled = true;
  const preload = async () => {
    for (const loader of [
      loadConnectionsView,
      loadSettings,
      loadWorkspaceView,
      loadNotificationsView,
      loadProxiesView,
      loadAuditLogView,
    ]) {
      await loader().catch(() => undefined);
    }
  };
  const requestIdle = (
    window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    }
  ).requestIdleCallback;
  if (requestIdle) requestIdle(() => void preload(), { timeout: 2_500 });
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
    component: loadLogin,
  },
  {
    path: '/setup',
    name: 'Setup',
    component: loadSetupView,
  },
  { path: '/workspace', name: 'Workspace', component: loadWorkspaceView },
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
}

export const createAppRouter = (pinia: Pinia) => {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
  });
  const auth = createAuthNavigationFacade(pinia);
  const publicRoutes = new Set(['Login', 'Setup']);

  router.onError(async (error, to) => {
    const reloadTarget = to.fullPath || window.location.pathname;
    await recoverStaleDynamicImport(error, reloadTarget);
  });

  router.afterEach((to) => {
    clearDynamicImportRecoveryMarker(to.fullPath);
  });

  router.beforeEach(async (to) => {
    await auth.resolveSetupState();

    if (auth.setupRequired && to.name !== 'Setup') return { name: 'Setup' };

    if (!auth.setupRequired && to.name === 'Setup') {
      await auth.resolveSession();
      return auth.authenticated ? { name: 'Dashboard' } : { name: 'Login' };
    }

    await auth.resolveSession();
    const isPublic = publicRoutes.has(String(to.name));

    if (!isPublic && !auth.authenticated) return { name: 'Login' };
    if (to.name === 'Login' && auth.authenticated) return { name: 'Dashboard' };
    return true;
  });

  return router;
};
