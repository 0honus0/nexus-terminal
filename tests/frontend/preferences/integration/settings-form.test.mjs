import { test, expect, vi, onTestFinished } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import Panel from '../../../../packages/frontend/src/features/preferences/components/PreferencesSettingsPanel.vue';
import UiSelect from '../../../../packages/frontend/src/foundation/ui/UiSelect.vue';
import { usePreferences, usePresentationStore } from '../../../../packages/frontend/src/features/preferences/public.ts';
import { presentationApi } from '../../../../packages/frontend/src/features/preferences/api/presentation-api.ts';
import { useNotificationStore } from '../../../../packages/frontend/src/shared/feedback/store/notification.store.ts';
import { useSettingsReloadStore } from '../../../../packages/frontend/src/shared/feedback/store/settings-reload.store.ts';

test('settings form retains its original CAS and dirty timezone through another consumer update, then explicitly reloads', async () => {
	const { application, pinia } = await openAuthenticatedFrontendApplication();
	await setLocale('en-US');
	const preferences = usePreferences();
	const store = usePresentationStore();
	const notifications = useNotificationStore();
	const reload = useSettingsReloadStore();
	const node = document.createElement('div');
	document.body.append(node);
	const panel = mount(Panel, { attachTo: node, props: { section: 'system' }, global: { plugins: [pinia, i18n] } });
	onTestFinished(() => {
		try {
			panel.unmount();
		} finally {
			node.remove();
		}
	});

	const until = (predicate) => vi.waitFor(() => expect(predicate()).toBeTruthy(), { timeout: 5000 });

	await until(() => panel.find('#timezoneSelect').exists() && preferences.loaded.value);
	const form = panel.find('#timezone-settings-form');
	const select = form.findComponent(UiSelect);
	expect(select.exists()).toBe(true);
	select.vm.$emit('update:modelValue', 'Europe/London');
	await nextTick();
	await form.trigger('submit');
	await until(() => preferences.values.value.timezone === 'Europe/London');
	const originalVersion = store.snapshot.version;
	select.vm.$emit('update:modelValue', 'Asia/Shanghai');
	await nextTick();
	await preferences.update({ showConnectionTags: false });
	expect(store.snapshot.version).toBe(originalVersion + 1);
	expect(panel.find('#timezoneSelect').attributes('data-value')).toBe('Asia/Shanghai');
	const writes = [];
	vi.stubGlobal('fetch', (url, options) => {
		if (String(url).endsWith('/settings/preferences') && options?.method === 'PUT')
			writes.push(JSON.parse(options.body));
		return application.fetch(url, options);
	});
	await form.trigger('submit');
	await until(() => store.blocked);
	expect(writes).toHaveLength(1);
	expect(writes[0].expectedVersion).toBe(originalVersion);
	expect(panel.find('#timezoneSelect').attributes('data-value')).toBe('Asia/Shanghai');
	expect(
		notifications.notifications.some((item) => item.message === i18n.global.t('common.personalDataConflict')),
	).toBe(true);
	const actual = await presentationApi.load();
	expect(actual.version).toBe(originalVersion + 1);
	expect(actual.preferences.timezone).toBe('Europe/London');
	expect(actual.preferences.showConnectionTags).toBe(false);
	expect(reload.pendingCount).toBe(1);
	expect(await reload.reloadPending()).toEqual({ attempted: 1, failed: 0, remaining: 0 });
	await until(() => panel.find('#timezoneSelect').attributes('data-value') === 'Europe/London');
	expect(writes).toHaveLength(1);
});
