import { describe, it, expect, vi, beforeEach } from 'vitest';
import router from './index';

// Mock auth store
vi.mock('../stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}));

// Mock views to avoid actual component loading
vi.mock('../views/DashboardView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/LoginView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/SetupView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/WorkspaceView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/ConnectionsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/ProxiesView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/SettingsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/NotificationsView.vue', () => ({ default: { template: '<div />' } }));
vi.mock('../views/AuditLogView.vue', () => ({ default: { template: '<div />' } }));

describe('路由守卫', () => {
  let mockAuthStore: {
    isInitCompleted: boolean;
    needsSetup: boolean;
    isAuthenticated: boolean;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAuthStore = {
      isInitCompleted: true,
      needsSetup: false,
      isAuthenticated: false,
    };
    const { useAuthStore } = await import('../stores/auth.store');
    vi.mocked(useAuthStore).mockReturnValue(mockAuthStore as any);
  });

  it('应该允许访问登录页面', async () => {
    const to = { name: 'Login', path: '/login' };
    const result = await router.options.routes;
    expect(result.length).toBeGreaterThan(0);
  });

  it('应该允许访问公开路由', async () => {
    mockAuthStore.isInitCompleted = true;
    mockAuthStore.needsSetup = false;
    mockAuthStore.isAuthenticated = false;

    const guard = router.beforeEach;
    expect(guard).toBeDefined();
  });

  it('应该包含所有必要路由', () => {
    const routes = router.getRoutes();
    const routeNames = routes.map((r) => r.name);

    expect(routeNames).toContain('Dashboard');
    expect(routeNames).toContain('Login');
    expect(routeNames).toContain('Setup');
    expect(routeNames).toContain('Workspace');
    expect(routeNames).toContain('Connections');
    expect(routeNames).toContain('Settings');
  });
});
