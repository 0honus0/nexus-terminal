import type { Pinia } from 'pinia';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { createAuthNavigationFacade } from '@/features/auth/public';
import { clearDynamicImportRecoveryMarker, recoverStaleDynamicImport } from '@/app/bootstrap/pwa';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../pages/dashboard/DashboardPage.vue'),
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../pages/login/LoginPage.vue'),
  },
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('@/features/auth/views/SetupView.vue'),
  },
  { path: '/workspace', name: 'Workspace', component: () => import('@/runtimes/workspace/views/WorkspaceView.vue') },
  {
    path: '/connections',
    name: 'Connections',
    component: () => import('@/features/connections/views/ConnectionsView.vue'),
  },
  { path: '/proxies', name: 'Proxies', component: () => import('@/features/proxies/views/ProxiesView.vue') },
  {
    path: '/notifications',
    name: 'Notifications',
    component: () => import('@/features/notifications/views/NotificationsView.vue'),
  },
  { path: '/audit-logs', name: 'AuditLogs', component: () => import('@/features/audit/views/AuditLogView.vue') },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../pages/settings/SettingsPage.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
];

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
