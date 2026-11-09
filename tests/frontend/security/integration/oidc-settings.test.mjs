import { test, expect, vi, onTestFinished } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import { openAccess } from '../../auth/support/fixture.mjs';
import { openOidcProvider } from '../../../support/protocols/oidc-provider.ts';
import { createOidcApi } from '../../../../packages/frontend/src/features/auth/api/oidc-api.ts';
import { useAuthStore } from '../../../../packages/frontend/src/features/auth/store/auth.store.ts';
import OidcPanel from '../../../../packages/frontend/src/features/security/components/OidcPanel.vue';
import i18n from '../../../../packages/frontend/src/app/i18n/index.ts';

test('binding alone publishes the login entry, and later edits preserve the binding and saved secret', async () => {
	const provider = await openOidcProvider();
	onTestFinished(() => provider.close());
	const password = 'Oidc-ui-regression-2026!';
	const { api: access } = await openAccess({ password });
	const pinia = createPinia();
	await useAuthStore(pinia).login({ username: 'admin', password });
	const api = createOidcApi();
	const signal = new AbortController().signal;
	await api.save(
		{
			revision: null,
			label: 'Pocket ID',
			issuer: provider.issuer,
			clientId: 'nexus-client',
			clientAuthentication: 'client_secret_basic',
			secret: { action: 'replace', value: 'oidc-test-secret' },
			password,
		},
		signal,
	);
	expect((await access.loginOptions()).oidc).toBeNull();
	const configured = await api.settings(signal);
	await api.finish('binding', provider.authorize(await api.bind(configured.revision, password, signal)), signal);
	expect((await access.loginOptions()).oidc).toEqual({ label: 'Pocket ID' });
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [{ path: '/', name: 'Settings', component: { render: () => null } }],
	});
	const node = document.createElement('div');
	document.body.append(node);
	const panel = mount(OidcPanel, { attachTo: node, global: { plugins: [pinia, i18n, router] } });
	onTestFinished(() => {
		panel.unmount();
		node.remove();
	});
	await vi.waitFor(() => expect(panel.get('#oidc-client').element.value).toBe('nexus-client'));
	expect(panel.find('[role="checkbox"]').exists()).toBe(false);
	expect(panel.get('#oidc-secret').element.value).toBe('');
	await panel.get('#oidc-label').setValue('Company SSO');
	await panel.get('#oidc-password').setValue(password);
	expect(panel.get('#oidc-settings-form').element.checkValidity()).toBe(true);
	const save = panel.get('button[form="oidc-settings-form"]');
	expect(save.element.disabled).toBe(false);
	save.element.click();
	await vi.waitFor(() => expect(save.element.disabled).toBe(true));
	await vi.waitFor(async () => expect((await access.loginOptions()).oidc).toEqual({ label: 'Company SSO' }));
	await vi.waitFor(() => expect(panel.get('#oidc-password').element.value).toBe(''));
	const saved = await api.settings(signal);
	expect(saved).toMatchObject({ bound: true, hasSecret: true, label: 'Company SSO' });
	expect(saved.revision).not.toBe(configured.revision);
	await panel.get('#oidc-password').setValue(password);
	const unlink = panel.findAll('button').find((button) => button.text() === 'Unlink account');
	expect(unlink.element.disabled).toBe(false);
	unlink.element.click();
	await vi.waitFor(async () => expect((await access.loginOptions()).oidc).toBeNull());
	expect((await api.settings(signal)).bound).toBe(false);
});
