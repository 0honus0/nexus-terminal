import { expect, test, vi, onTestFinished } from 'vitest';
import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import { openFrontendApplication } from '../../../support/http/frontend-application.mjs';
import { createAccessApi } from '../../../../packages/frontend/src/features/auth/api/access-api.ts';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import { getHostDiagnostics } from '../../../../packages/frontend/src/features/system-overview/api/diagnostics-api.ts';
import { HostDiagnosticFailure } from '../../../../packages/frontend/src/features/system-overview/model/diagnostic-types.ts';
import Panel from '../../../../packages/frontend/src/features/system-overview/components/HostDiagnosticsPanel.vue';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';

test('actual host diagnostics project all resource owners and reject incomplete wire facts without defaults', async () => {
	const app = await openFrontendApplication();
	vi.stubGlobal('fetch', app.fetch);
	onTestFinished(() => vi.unstubAllGlobals());
	await expect(getHostDiagnostics()).rejects.toMatchObject({ code: 'unauthenticated' });
	const password = 'Diagnostics-fixture-2026!';
	await createAccessApi().setup({ username: 'admin', password, confirmPassword: password });
	const pinia = createPinia();
	const identity = await useAuthStore(pinia).login({ username: 'admin', password, rememberMe: false });
	expect(identity.status).toBe('authenticated');
	expect(authenticatedSessionLifecycle.attach(identity.user.id).failures).toHaveLength(0);
	onTestFinished(() => authenticatedSessionLifecycle.dispose());
	const value = await getHostDiagnostics();
	expect(value.database.available).toBe(true);
	expect(value.database.schemaVersion).toBeGreaterThanOrEqual(1);
	expect(value.process.runtimeVersion).toMatch(/^v[0-9]+/u);
	expect(value.database).not.toHaveProperty('path');
	expect(value.process).not.toHaveProperty('environment');
	for (const name of ['heapTotalBytes', 'externalBytes', 'arrayBufferBytes', 'gcCount', 'gcDurationSeconds']) {
		expect(Number.isFinite(value.process[name]) && value.process[name] >= 0).toBe(true);
	}
	expect(value.modules.map((module) => module.id).sort()).toEqual([
		'access',
		'operations',
		'preferences',
		'remote',
		'storage',
		'system',
		'targets',
	]);
	expect(value.modules.every((module) => module.status === 'available')).toBe(true);
	const storage = value.modules.find((module) => module.id === 'storage');
	for (const name of [
		'worker_heap_used_bytes',
		'worker_heap_total_bytes',
		'worker_external_bytes',
		'worker_array_buffer_bytes',
	]) {
		expect(storage.metrics.some((metric) => metric.name === name && metric.unit === 'bytes')).toBe(true);
	}
	expect(storage.metrics.some((metric) => metric.name === 'pending_operations' && metric.unit === 'count')).toBe(
		true,
	);
	expect(storage.metrics.find((metric) => metric.name === 'worker_heap_used_bytes').value).toBeLessThanOrEqual(
		storage.metrics.find((metric) => metric.name === 'worker_heap_total_bytes').value,
	);
	expect(
		value.modules
			.find((module) => module.id === 'remote')
			.metrics.some((metric) => metric.name === 'output_buffer_bytes' && metric.unit === 'bytes'),
	).toBe(true);
	for (const module of value.modules) {
		for (const metric of module.metrics) expect(Number.isSafeInteger(metric.value) && metric.value >= 0).toBe(true);
	}
	await setLocale('en-US');
	const node = document.createElement('div');
	document.body.append(node);
	const mounted = createApp({ render: () => h(Panel) });
	onTestFinished(() => {
		mounted.unmount();
		node.remove();
	});
	mounted.use(pinia).use(i18n).mount(node);
	await vi.waitFor(() => expect(node.querySelectorAll('[data-diagnostic-module]')).toHaveLength(7), {
		timeout: 15000,
	});
	vi.stubGlobal('fetch', async (path, input) =>
		path === '/api/v1/system/diagnostics'
			? Response.json({ diagnostics: { process: {} } })
			: app.fetch(path, input),
	);
	await expect(getHostDiagnostics()).rejects.toBeInstanceOf(HostDiagnosticFailure);
	await expect(getHostDiagnostics()).rejects.toMatchObject({ code: 'protocol_failure' });
});
