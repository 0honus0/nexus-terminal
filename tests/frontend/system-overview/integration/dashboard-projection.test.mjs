import { test, expect, vi, onTestFinished } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h, KeepAlive } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { openAccess } from '../../auth/support/fixture.mjs';
import i18n from '../../../../packages/frontend/src/app/i18n/index.ts';
import Dashboard from '../../../../packages/frontend/src/app/pages/dashboard/DashboardPage.vue';
import { connectionsApi } from '../../../../packages/frontend/src/features/connections/api/connections-api.ts';
import { systemOverviewApi } from '../../../../packages/frontend/src/features/system-overview/api/system-overview-api.ts';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';
import { configurationApi } from '../../../../packages/frontend/src/features/preferences/api/configuration-api.ts';
import { toSshResource } from '../../../../packages/frontend/src/features/system-overview/model/system-overview-mapper.ts';
import { readSshResourceStatus } from '../../../../packages/shared/src/remote/monitoring/http-codec.ts';

test('the actual Dashboard card renders missing measurements separately from explicit zeros', async () => {
	await openAccess({ password: 'Dashboard-projection-2026!' });
	const pinia = createPinia();
	setActivePinia(pinia);
	await useAuthStore().login({ username: 'admin', password: 'Dashboard-projection-2026!' });
	onTestFinished(() => authenticatedSessionLifecycle.dispose());
	await configurationApi.saveMonitoring(await configurationApi.get(), {
		statusIntervalSeconds: 1,
		hostIntervalSeconds: 5,
	});
	const imported = await connectionsApi.importMany([
		{
			connection: {
				name: 'Projection SSH',
				type: 'SSH',
				host: '127.0.0.1',
				port: 22,
				username: 'fixture',
				route: 'direct',
				proxyId: null,
				tagIds: [],
				jumpIds: [],
				notes: null,
			},
		},
	]);
	expect(imported[0].status).toBe('ok');
	let missing = true;
	// Only the remote producer is controlled. The actual page, controller, mapper,
	// registered settings and remaining HTTP consumers retain their normal owners.
	const remote = vi.spyOn(systemOverviewApi, 'ssh').mockImplementation(async (target) =>
		toSshResource(
			readSshResourceStatus({
				key: '127.0.0.1:22',
				connectionId: target.id,
				name: target.name,
				username: target.username,
				host: target.host,
				port: target.port,
				checkedAt: Date.now(),
				status: missing
					? { timestamp: Date.now() }
					: {
							timestamp: Date.now(),
							cpuPercent: 0,
							memPercent: 0,
							memUsed: 0,
							memTotal: 100,
							diskPercent: 0,
							diskUsed: 0,
							diskTotal: 100,
						},
			}),
		),
	);
	onTestFinished(() => remote.mockRestore());
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{ path: '/', name: 'Dashboard', component: Dashboard }],
	});
	await router.push('/');
	vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
	onTestFinished(() => vi.useRealTimers());
	const mounted = mount(
		{ render: () => h(KeepAlive, () => h(Dashboard)) },
		{ global: { plugins: [pinia, i18n, router] } },
	);
	onTestFinished(() => mounted.unmount());

	const card = () => mounted.find('.dashboard-connection-card');

	await vi.waitFor(() => expect(card().attributes('data-resource-state')).toBe('ready'), { timeout: 5000 });
	expect(card().text()).toContain('—');
	expect(card().text()).not.toContain('0%');
	expect(
		card()
			.findAll('.dashboard-gauge__value')
			.map((item) => item.text()),
	).toEqual(['—', '—', '—']);
	missing = false;
	// Component refresh timing is virtual; natural backend cache expiry remains
	// covered by the real OpenSSH browser journey.
	await vi.advanceTimersByTimeAsync(5_000);
	await vi.waitFor(
		() =>
			expect(
				card()
					.findAll('.dashboard-gauge__value')
					.map((item) => item.text()),
			).toEqual(['0%', '0%', '0%']),
		{ timeout: 5000 },
	);
	expect(card().text()).not.toContain('—');
	expect(remote).toHaveBeenCalledTimes(2);
});
