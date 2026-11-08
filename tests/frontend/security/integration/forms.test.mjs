import { test, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import UiSelect from '../../../../packages/frontend/src/foundation/ui/UiSelect.vue';
import { openAccess } from '../../auth/support/fixture.mjs';

test('real CAPTCHA and IP forms retain their own original CAS and use global explicit read recovery', async () => {
	const fixture = await openAccess({ password: 'final-password-789' });
	await fixture.api.login({ username: 'admin', password: fixture.password });
	const { configurationApi } =
		await import('../../../../packages/frontend/src/features/preferences/api/configuration-api.ts');
	const current = await configurationApi.get();
	await configurationApi.saveCaptcha(current.revision, {
		enabled: false,
		provider: 'hcaptcha',
		siteKey: 'fixture-site',
		hostname: 'localhost',
		secretAction: 'clear',
		secretValue: '',
	});
	const { h, nextTick } = await import('vue');
	const { createPinia } = await import('pinia');
	const { useAuthStore } = await import('../../../../packages/frontend/src/features/auth/store/auth.store.ts');
	const { default: i18n } = await import('../../../../packages/frontend/src/app/i18n/index.ts');
	const { default: CaptchaPanel } =
		await import('../../../../packages/frontend/src/features/security/components/CaptchaPanel.vue');
	const { default: IpAccessPanel } =
		await import('../../../../packages/frontend/src/features/security/components/IpAccessPanel.vue');

	const { useNotificationStore } =
		await import('../../../../packages/frontend/src/shared/feedback/store/notification.store.ts');
	const pinia = createPinia();
	const store = useAuthStore(pinia);
	const notifications = useNotificationStore(pinia);
	await store.login({ username: 'admin', password: 'final-password-789' });
	const node = document.createElement('div');
	document.body.append(node);
	let mounted;
	const original = globalThis.fetch;
	let writes = 0;
	globalThis.fetch = (url, options) => {
		if (options?.method === 'PUT') {
			writes++;
		}
		return original(url, options);
	};
	const checks = [];

	async function until(predicate) {
		await vi.waitFor(async () => expect(await predicate()).toBeTruthy(), { timeout: 5000, interval: 25 });
	}

	function check(value, name) {
		if (!value) {
			throw Error(name);
		}
		checks.push(name);
	}

	const hasNotice = (message) => notifications.notifications.some((notice) => notice.message === message);

	async function input(id, value) {
		const control = node.querySelector('#' + id);
		control.value = value;
		control.dispatchEvent(new Event('input', { bubbles: true }));
		await nextTick();
		return control;
	}

	const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

	try {
		mounted = mount(
			{ render: () => h('div', [h(CaptchaPanel), h(IpAccessPanel)]) },
			{ attachTo: node, global: { plugins: [pinia, i18n] } },
		);
		await until(() => node.querySelector('#captcha-provider') && !node.querySelector('fieldset').disabled);
		await until(() => hasNotice(i18n.global.t('settings.configuration.restart')));
		const toggle = node.querySelector('#captcha-provider').closest('fieldset').querySelector('[role=checkbox]');
		if (toggle.getAttribute('aria-checked') !== 'true') toggle.click();
		// Component events validate form logic; actual select input stays in browser UI tests.
		mounted
			.findAllComponents(UiSelect)
			.find((item) => item.vm.$attrs.id === 'captcha-provider')
			.vm.$emit('update:modelValue', 'hcaptcha');
		await nextTick();
		await until(
			() =>
				node.querySelector('#captcha-site') &&
				!node.querySelector('fieldset').disabled &&
				!node.querySelector('#ipWhitelist').disabled,
		);
		await input('captcha-hostname', 'localhost');
		mounted
			.findAllComponents(UiSelect)
			.find((item) => item.vm.$attrs.id === 'captcha-secret-action')
			.vm.$emit('update:modelValue', 'replace');
		await nextTick();
		await input('captcha-secret', 'security-ui-fixture-secret');
		const field = await input('captcha-site', 'updated-ui-site');
		submit(field.closest('form'));
		submit(field.closest('form'));
		await until(
			() => !node.querySelector('fieldset').disabled && hasNotice(i18n.global.t('settings.configuration.saved')),
		);
		check(
			writes === 1 &&
				(await configurationApi.get()).captcha.siteKey === 'updated-ui-site' &&
				!node.textContent.includes(i18n.global.t('settings.configuration.restart')),
			'real CAPTCHA form prevents duplicates and persists explicit draft',
		);
		const networkField = await input('maxLoginAttempts', '8');
		submit(networkField.closest('form'));
		await until(() => hasNotice(i18n.global.t('settings.configuration.conflict')));
		check(
			writes === 2 && node.querySelector('#ipWhitelist').disabled,
			'real independent panels expose stale CAS and block further writes',
		);
		const { useSettingsReloadStore } =
			await import('../../../../packages/frontend/src/shared/feedback/store/settings-reload.store.ts');
		expect(await useSettingsReloadStore(pinia).reloadPending()).toEqual({ attempted: 1, failed: 0, remaining: 0 });
		await until(() => !node.querySelector('#ipWhitelist').disabled);
		await input('maxLoginAttempts', '8');
		submit(networkField.closest('form'));
		await until(
			() =>
				!node.querySelector('#ipWhitelist').disabled &&
				hasNotice(i18n.global.t('settings.configuration.savedLive')),
		);
		await until(async () => (await configurationApi.get()).network.maxLoginAttempts === 8);
		check(
			writes === 3 && hasNotice(i18n.global.t('settings.configuration.savedLive')),
			'real network form converts numeric input after deliberate conflict recovery',
		);
	} finally {
		mounted?.unmount();
		node.remove();
		globalThis.fetch = original;
	}
	expect(checks).toHaveLength(3);
});
