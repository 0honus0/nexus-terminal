import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { ref } from 'vue';
import { expect, test, vi } from 'vitest';
import i18n, { setLocale } from '../../../../../packages/frontend/src/app/i18n/index.ts';
import InstalledPluginsSettings from '../../../../../packages/frontend/src/features/agent/plugins/components/InstalledPluginsSettings.vue';

function fixture() {
	const packages = ['app', 'tool', 'chat', 'removed'].map((id) => ({
		packageId: 'example.' + id,
		version: '1.0.0',
		publisherKeyId: 'publisher',
		packageHash: id,
		status: id === 'removed' ? 'removed' : 'installed',
		revision: 1,
	}));
	const versions = packages.map((item) => ({
		packageHash: item.packageHash,
		publisherKeyId: item.publisherKeyId,
		manifest: {
			id: item.packageId,
			version: item.version,
			displayName: item.packageHash,
			appContribution: item.packageHash === 'app' ? { entry: 'example.run' } : null,
			settings: item.packageHash === 'tool' ? {} : null,
			dependencies:
				item.packageHash === 'app' ? [{ packageId: 'example.chat', publisherKeyId: 'publisher' }] : [],
		},
	}));
	const model = {
		packageInstallations: ref(packages),
		versions: ref(versions),
		installations: ref([
			{ appId: 'app', definitionId: 'example.app', publisherKeyId: 'publisher', status: 'installed' },
		]),
		operation: { busy: ref(false), refreshRequired: ref(false), recoveryRequired: ref(false) },
		load: vi.fn(),
		retirePackage: vi.fn(),
		cancelPackageUpdate: vi.fn(),
		mutationUnknown: ref(false),
		acknowledged: ref(false),
		newIntent: vi.fn(),

		canWrite: () =>
			!model.operation.busy.value && !model.operation.refreshRequired.value && !model.mutationUnknown.value,
	};
	return model;
}

test('installed plugin list excludes Apps and removed data, preserves settings and reference protection', async () => {
	await setLocale('en-US');
	const model = fixture();
	const wrapper = mount(InstalledPluginsSettings, {
		attachTo: document.body,
		props: { model, active: true },
		global: { plugins: [i18n, createPinia()] },
	});
	try {
		expect(wrapper.findAll('article').map((row) => row.attributes('aria-label'))).toEqual(['tool', 'chat']);
		const tool = wrapper.get('article[aria-label="tool"]');
		await tool.get('button[aria-label="Settings"]').trigger('click');
		expect(wrapper.emitted('settings')[0]).toEqual([model.packageInstallations.value[1]]);
		expect(wrapper.get('article[aria-label="chat"] button[aria-label="Uninstall package"]').element.disabled).toBe(
			true,
		);
		await tool.get('button[aria-label="Uninstall package"]').trigger('click');
		await flushPromises();
		const dialog = document.querySelector('[role="dialog"]');
		expect(dialog).not.toBeNull();
		const checkbox = dialog.querySelector('[role="checkbox"]');
		checkbox.click();
		await flushPromises();
		const confirm = Array.from(dialog.querySelectorAll('button')).find(
			(button) => button.textContent.trim() === 'Uninstall package',
		);
		confirm.click();
		await flushPromises();
		expect(model.retirePackage).toHaveBeenCalledExactlyOnceWith(model.packageInstallations.value[1], true);
		await wrapper.setProps({ active: false });
		await flushPromises();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await wrapper.setProps({ active: true });
		await flushPromises();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
	} finally {
		wrapper.unmount();
	}
});

test('a changed package revision invalidates an open removal confirmation', async () => {
	await setLocale('en-US');
	const model = fixture();
	const wrapper = mount(InstalledPluginsSettings, {
		attachTo: document.body,
		props: { model, active: true },
		global: { plugins: [i18n, createPinia()] },
	});
	try {
		await wrapper.get('article[aria-label="tool"] button[aria-label="Uninstall package"]').trigger('click');
		await flushPromises();
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
		model.packageInstallations.value = model.packageInstallations.value.map((item) => ({
			...item,
			revision: item.revision + 1,
		}));
		await flushPromises();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(model.retirePackage).not.toHaveBeenCalled();
	} finally {
		wrapper.unmount();
	}
});
