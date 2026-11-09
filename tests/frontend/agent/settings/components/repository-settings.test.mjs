import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { expect, test, vi } from 'vitest';
import i18n, { setLocale } from '../../../../../packages/frontend/src/app/i18n/index.ts';
import { authenticatedSessionLifecycle } from '../../../../../packages/frontend/src/shared/session/authenticatedSessionLifecycle.ts';
import PluginRepositorySettings from '../../../../../packages/frontend/src/features/agent/plugins/components/PluginRepositorySettings.vue';

const api = vi.hoisted(() => ({
	getPluginRepositories: vi.fn(),
	getPluginCatalog: vi.fn(),
	updatePluginRepositories: vi.fn(),
}));
vi.mock('../../../../../packages/frontend/src/features/agent/plugins/api/plugin-management-api.ts', () => api);

test('repository management owns a permanently visible add field, refresh, removal and draft disposal', async () => {
	await setLocale('en-US');
	authenticatedSessionLifecycle.attach(1);
	const existing = 'https://third.test/catalog.json';
	let saved = { version: 1, urls: [existing], updatedAt: 1 };
	api.getPluginRepositories.mockImplementation(async () => saved);
	api.getPluginCatalog.mockImplementation(async (source) => ({
		repositoryUrl: source ?? 'https://official.test/catalog.json',
		publishers: [],
		packages: [],
	}));
	api.updatePluginRepositories.mockImplementation(async (original, urls) => {
		expect(original.version).toBe(saved.version);
		saved = { version: saved.version + 1, urls, updatedAt: saved.updatedAt + 1 };
		return saved;
	});
	const wrapper = mount(PluginRepositorySettings, {
		attachTo: document.body,
		props: {
			active: true,
			blocked: false,
			publishers: [],
			installations: [],
			packageInstallations: [],
			retainedPackageIds: [],
			versions: [],
			retainedAppIds: [],
			clearing: false,
			apps: [],
		},
		global: { plugins: [i18n, createPinia()] },
	});
	try {
		await flushPromises();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		expect(wrapper.find('.plugin-market__source').exists()).toBe(false);
		const manage = wrapper.get('button[aria-label="Manage repositories"]');
		await manage.trigger('click');
		await flushPromises();
		const dialog = document.querySelector('[role="dialog"]');
		const form = dialog.querySelector('form[aria-label="Add repository"]');
		const field = form.querySelector('input');
		expect(field).not.toBeNull();
		expect(form.querySelector('button[type="submit"]')).not.toBeNull();
		expect(form.querySelector('button[aria-label="Refresh repositories"]')).not.toBeNull();
		field.value = 'https://new.test/catalog.json';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await flushPromises();
		expect(saved.urls).toEqual([existing, 'https://new.test/catalog.json']);
		expect(field.value).toBe('');
		expect(document.querySelector('[role="dialog"] form input')).toBe(field);
		dialog.querySelector('button[aria-label="Remove · third.test"]').click();
		await flushPromises();
		expect(saved.urls).toEqual(['https://new.test/catalog.json']);
		const reads = api.getPluginRepositories.mock.calls.length;
		form.querySelector('button[aria-label="Refresh repositories"]').click();
		await flushPromises();
		expect(api.getPluginRepositories.mock.calls.length).toBe(reads + 1);
		field.value = 'https://cancelled.test/catalog.json';
		field.dispatchEvent(new Event('input', { bubbles: true }));
		await wrapper.setProps({ active: false });
		await flushPromises();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await wrapper.setProps({ active: true });
		await flushPromises();
		await manage.trigger('click');
		await flushPromises();
		expect(document.querySelector('[role="dialog"] form input').value).toBe('');
	} finally {
		wrapper.unmount();
		authenticatedSessionLifecycle.dispose();
	}
});

for (const available of [true, false]) {
	test(`market shows retained package cleanup without a duplicate installed section (catalog ${available ? 'available' : 'unavailable'})`, async () => {
		await setLocale('en-US');
		authenticatedSessionLifecycle.attach(1);
		const entry = {
			definitionId: 'example.tool',
			displayName: 'Tool',
			description: 'Tool description',
			contributionKinds: ['tools'],
			version: '1.0.0',
			publisherKeyId: 'publisher',
			sha256: 'hash',
			compatible: true,
			compatibilityReason: null,
		};
		const removed = {
			packageId: entry.definitionId,
			version: entry.version,
			packageHash: entry.sha256,
			publisherKeyId: entry.publisherKeyId,
			status: 'removed',
			revision: 2,
		};
		api.getPluginRepositories.mockResolvedValue({ version: 1, urls: [], updatedAt: 1 });
		api.getPluginCatalog.mockImplementation(async () => {
			if (!available) throw new Error('Unavailable repository');
			return { repositoryUrl: 'https://official.test/catalog.json', publishers: [], packages: [entry] };
		});
		const props = {
			active: true,
			blocked: false,
			publishers: [],
			installations: [],
			packageInstallations: [
				removed,
				{
					packageId: 'example.installed',
					packageHash: 'installed',
					publisherKeyId: 'publisher',
					version: '1.0.0',
					status: 'installed',
					revision: 1,
				},
			],
			retainedPackageIds: [entry.definitionId],
			versions: [],
			retainedAppIds: [],
			clearing: false,
			apps: [],
		};
		const wrapper = mount(PluginRepositorySettings, {
			attachTo: document.body,
			props,
			global: { plugins: [i18n, createPinia()] },
		});
		try {
			await flushPromises();
			expect(wrapper.text()).not.toContain('Installed and retained data');
			expect(wrapper.text()).not.toContain('example.installed');
			expect(wrapper.findAll('article')).toHaveLength(available ? 0 : 1);
			const clear = wrapper
				.findAll('button')
				.find((button) => button.text() === 'Clear data' || button.attributes('aria-label') === 'Clear data');
			await clear.trigger('click');
			await flushPromises();
			const dialog = document.querySelector('[role="dialog"]');
			expect(dialog).not.toBeNull();
			const confirm = Array.from(dialog.querySelectorAll('button')).find(
				(button) => button.textContent.trim() === 'Clear data',
			);
			confirm.click();
			await flushPromises();
			expect(wrapper.emitted('retirePackage')[0]).toEqual([removed, true]);
		} finally {
			wrapper.unmount();
			authenticatedSessionLifecycle.dispose();
		}
	});
}
