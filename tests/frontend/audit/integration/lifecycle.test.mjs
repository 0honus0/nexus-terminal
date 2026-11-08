import { test, expect, vi, onTestFinished } from 'vitest';
import { h, ref, KeepAlive, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import AuditLogView from '../../../../packages/frontend/src/features/audit/views/AuditLogView.vue';
import { useAuditStore } from '../../../../packages/frontend/src/features/audit/store/audit.store.ts';
import { useFilesystemCatalogStore } from '../../../../packages/frontend/src/features/filesystem/composables/useFilesystemCatalog.ts';
import { auditApi } from '../../../../packages/frontend/src/features/audit/api/audit-api.ts';

test('actual audit page KeepAlive revokes the old read and late delivery cannot replace the current activity', async () => {
	const { application, pinia } = await openAuthenticatedFrontendApplication();
	await setLocale('en-US');
	const store = useAuditStore();
	const load = vi.spyOn(store, 'load');
	onTestFinished(() => load.mockRestore());
	const visible = ref(true);
	const reached = Promise.withResolvers();
	const release = Promise.withResolvers();
	onTestFinished(() => release.resolve());
	let reads = 0;
	let oldSignal;
	vi.stubGlobal('fetch', async (url, options) => {
		const response = await application.fetch(url, options);
		if (String(url).includes('/settings/audit-logs?') && ++reads === 2) {
			oldSignal = options.signal;
			reached.resolve();
			await release.promise;
		}
		return response;
	});
	const panel = mount(
		{ render: () => h(KeepAlive, () => (visible.value ? h(AuditLogView) : null)) },
		{ global: { plugins: [pinia, i18n] } },
	);
	onTestFinished(() => panel.unmount());

	const until = (predicate) => vi.waitFor(async () => expect(await predicate()).toBeTruthy(), { timeout: 5000 });

	await until(() => reads === 1 && !store.loading && store.logs.length > 0);
	visible.value = false;
	await nextTick();
	visible.value = true;
	await nextTick();
	await reached.promise;
	const oldRead = load.mock.results[1].value;
	expect(oldRead).toBeInstanceOf(Promise);
	expect(oldSignal.aborted).toBe(false);
	visible.value = false;
	await nextTick();
	expect(oldSignal.aborted).toBe(true);
	await useFilesystemCatalogStore().saveFavorite({ name: 'Current audit activity', path: '/audit-current' });
	// The backend writes the actual audit record asynchronously; observe its durable public query.
	let latest;
	await until(async () => {
		latest = (await auditApi.list({ event: 'HTTP_MUTATION' })).items[0];
		return Boolean(latest);
	});
	visible.value = true;
	await nextTick();
	await until(() => !store.loading && store.logs.some((entry) => entry.id === latest.id));
	const current = store.logs.map((entry) => entry.id);
	release.resolve();
	await oldRead;
	await nextTick();
	expect(store.logs.map((entry) => entry.id)).toEqual(current);
	expect(store.error).toBeNull();
});
