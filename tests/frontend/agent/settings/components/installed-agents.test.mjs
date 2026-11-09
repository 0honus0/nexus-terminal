import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { ref } from 'vue';
import { expect, test, vi } from 'vitest';
import i18n, { setLocale } from '../../../../../packages/frontend/src/app/i18n/index.ts';
import AppManagementSettings from '../../../../../packages/frontend/src/features/agent/settings/AppManagementSettings.vue';

test('compact Agent rows retain settings, expandable policies, enable and uninstall actions', async () => {
	await setLocale('en-US');
	const apps = [
		{ id: 'first', name: 'First agent', definitionId: 'example.agent', definitionVersion: '1.0.0', enabled: true },
		{
			id: 'second',
			name: 'Second agent',
			definitionId: 'example.agent',
			definitionVersion: '1.0.0',
			enabled: false,
		},
	];
	const installation = {
		packageId: 'example.agent',
		packageHash: 'hash',
		publisherKeyId: 'publisher',
		status: 'installed',
		version: '1.0.0',
	};
	const model = {
		apps: ref(apps),
		selectedId: ref(''),
		appOperation: { busy: ref(false), refreshRequired: ref(false), notice: ref('') },
		loadApps: vi.fn(),
		toggle: vi.fn(),
	};
	const plugins = {
		installations: ref(apps.map((app) => ({ appId: app.id, definitionId: app.definitionId, ...installation }))),
		packageInstallations: ref([installation]),
		versions: ref([
			{
				packageHash: 'hash',
				publisherKeyId: 'publisher',
				manifest: { id: 'example.agent', version: '1.0.0', settings: {} },
			},
		]),
		operation: { busy: ref(false) },
		retire: vi.fn(),

		canWrite: () => true,
	};
	const wrapper = mount(AppManagementSettings, {
		attachTo: document.body,
		props: { model, plugins, active: true },
		global: {
			plugins: [i18n, createPinia()],
			stubs: { AppGovernanceEditor: { props: ['app'], template: '<div data-policy-editor>{{app.id}}</div>' } },
		},
	});
	try {
		const first = wrapper.get('article[data-app-id="first"]');
		const second = wrapper.get('article[data-app-id="second"]');
		await second.get('button[aria-label="Settings"]').trigger('click');
		expect(wrapper.emitted('settings')[0]).toEqual([installation, 'second']);
		const firstPolicies = first.get('button[aria-label="Configure Policies"]');
		await firstPolicies.trigger('click');
		expect(firstPolicies.attributes('aria-expanded')).toBe('true');
		expect(first.get('[data-policy-editor]').text()).toBe('first');
		await second.get('button[aria-label="Configure Policies"]').trigger('click');
		expect(first.find('[data-policy-editor]').exists()).toBe(false);
		expect(second.get('[data-policy-editor]').text()).toBe('second');
		await second.get('button[aria-label="Configure Policies"]').trigger('click');
		expect(wrapper.find('[data-policy-editor]').exists()).toBe(false);
		await second.get('button[aria-label="Enable"]').trigger('click');
		expect(model.toggle).toHaveBeenCalledExactlyOnceWith(apps[1]);
		expect(first.get('button[aria-label="Uninstall"]').element.disabled).toBe(true);
		expect(second.get('button[aria-label="Uninstall"]').element.disabled).toBe(false);
	} finally {
		wrapper.unmount();
	}
});
