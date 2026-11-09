import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { expect, test, vi } from 'vitest';
import i18n, { setLocale } from '../../../../../packages/frontend/src/app/i18n/index.ts';
import { authenticatedSessionLifecycle } from '../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts';
import { usePluginManagement } from '../../../../../packages/frontend/src/features/agent/plugins/composables/use-plugin-management.ts';
import PluginManagementSettings from '../../../../../packages/frontend/src/features/agent/plugins/components/PluginManagementSettings.vue';
import { AgentManagementFailure } from '../../../../../packages/frontend/src/features/agent/model/management-failure.ts';

const api = vi.hoisted(() => ({
	listPluginPublishers: vi.fn(),
	listPluginInstallations: vi.fn(),
	listPluginVersions: vi.fn(),
	listPluginPackageInstallations: vi.fn(),
	preparePluginInstallPlan: vi.fn(),
}));
vi.mock('../../../../../packages/frontend/src/features/agent/plugins/api/plugin-management-api.ts', () => api);

for (const readFails of [false, true]) {
	test(`package revalidation keeps recovery warnings hidden until readback settles (${readFails ? 'failure' : 'success'})`, async () => {
		await setLocale('en-US');
		const manifest = { id: 'nexus.test', version: '1.0.0', appContribution: null };
		const installation = {
			packageId: manifest.id,
			publisherKeyId: 'publisher',
			version: manifest.version,
			packageHash: 'package-hash',
			status: 'installed',
		};
		api.listPluginPublishers.mockResolvedValue([]);
		api.listPluginInstallations.mockResolvedValue({ installations: [], retainedAppIds: [] });
		api.listPluginVersions.mockResolvedValue([]);
		api.listPluginPackageInstallations.mockResolvedValue({
			installations: [installation],
			retainedPackageIds: [],
		});
		api.preparePluginInstallPlan.mockResolvedValue({
			target: { stage: { manifest, publisherKeyId: 'publisher', packageHash: 'package-hash' } },
			dependencies: [],
		});
		authenticatedSessionLifecycle.attach(1);
		let model;
		const wrapper = mount(
			defineComponent({
				setup() {
					model = usePluginManagement();
					return () => h(PluginManagementSettings, { model });
				},
			}),
			{
				attachTo: document.body,
				global: { plugins: [i18n, createPinia()], stubs: { PluginRepositorySettings: true } },
			},
		);
		const readback = Promise.withResolvers();
		const warnings = [];
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (node instanceof Element && node.matches('.ui-inline-notice[data-tone="warning"]')) {
						warnings.push(node.textContent);
					}
				}
			}
		});
		try {
			await flushPromises();
			api.listPluginVersions.mockImplementationOnce(() => readback.promise);
			observer.observe(wrapper.element, { childList: true, subtree: true });
			wrapper.findComponent({ name: 'PluginRepositorySettings' }).vm.$emit('prepare', {}, null);
			await flushPromises();
			expect(model.operation.busy.value).toBe(true);
			expect(model.operation.refreshRequired.value).toBe(true);
			expect(model.canWrite()).toBe(false);
			expect(warnings).toEqual([]);
			expect(wrapper.find('[role="alert"]').exists()).toBe(false);
			if (readFails) {
				readback.reject(new AgentManagementFailure('storage_unavailable', 'confirmed'));
			} else {
				readback.resolve([]);
			}
			await flushPromises();
			expect(model.operation.busy.value).toBe(false);
			expect(model.operation.refreshRequired.value).toBe(readFails);
			expect(model.canWrite()).toBe(!readFails);
			if (readFails) {
				expect(wrapper.get('[role="alert"]').text()).toContain(
					i18n.global.t('agent.settings.appManagement.refreshRequired'),
				);
			} else {
				expect(warnings).toEqual([]);
			}
		} finally {
			readback.resolve([]);
			observer.disconnect();
			wrapper.unmount();
			authenticatedSessionLifecycle.dispose();
		}
	});
}
