import { test, expect, vi, onTestFinished } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import LoginPage from '../../../../packages/frontend/src/app/pages/login/LoginPage.vue';
import LoginView from '../../../../packages/frontend/src/features/auth/views/LoginView.vue';
import i18n, { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';

async function mountLogin(component, props = {}) {
	vi.stubGlobal('matchMedia', () => ({ matches: false }));
	onTestFinished(() => vi.unstubAllGlobals());
	await setLocale('en-US');
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{ path: '/', component: { render: () => null } }],
	});
	const wrapper = mount(component, { props, global: { plugins: [createPinia(), i18n, router] } });
	onTestFinished(() => wrapper.unmount());
	return wrapper;
}

test('the real login page reads both public login methods and CAPTCHA through exactly one request', async () => {
	const requests = [];
	vi.stubGlobal('fetch', async (url) => {
		requests.push(String(url));
		return new Response(
			JSON.stringify({
				captcha: { enabled: false, provider: 'none', hcaptchaSiteKey: '', recaptchaSiteKey: '' },
				hasPasskeys: true,
				oidc: { label: 'Pocket ID' },
			}),
			{ headers: { 'Content-Type': 'application/json' } },
		);
	});
	onTestFinished(() => vi.unstubAllGlobals());
	const wrapper = await mountLogin(LoginPage);
	await flushPromises();
	expect(wrapper.find('.login-oidc').text()).toContain('Pocket ID');
	expect(wrapper.findAll('.login-passkey')).toHaveLength(2);
	expect(requests.map((url) => new URL(url).pathname)).toEqual(['/api/v1/auth/login/options']);
});

test('alternative login entries follow registered methods and hide the empty group', async () => {
	const wrapper = await mountLogin(LoginView);
	expect(wrapper.find('.login-alternatives').exists()).toBe(false);
	await wrapper.setProps({ hasPasskeys: true });
	expect(wrapper.findAll('.login-passkey')).toHaveLength(1);
	expect(wrapper.find('.login-oidc').exists()).toBe(false);
	await wrapper.setProps({ oidcLabel: 'Pocket ID' });
	expect(wrapper.findAll('.login-passkey')).toHaveLength(2);
	await wrapper.setProps({ hasPasskeys: false });
	expect(wrapper.findAll('.login-passkey')).toHaveLength(1);
	expect(wrapper.get('.login-oidc').text()).toContain('Pocket ID');
	await wrapper.setProps({ oidcLabel: null });
	expect(wrapper.find('.login-alternatives').exists()).toBe(false);
});
