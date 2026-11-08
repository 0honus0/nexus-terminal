import { test, expect, vi } from 'vitest';
import { openAccess } from '../../auth/support/fixture.mjs';

test('actual password form submits once and navigates after its own authenticated unmount', async () => {
	await openAccess({ password: 'changed-password-456' });
	const { createApp, h, onBeforeUnmount, nextTick } = await import('vue');
	const { createPinia } = await import('pinia');
	const { createRouter, createMemoryHistory } = await import('vue-router');
	const { default: i18n } = await import('../../../../packages/frontend/src/app/i18n/index.ts');
	const { useAuthStore } = await import('../../../../packages/frontend/src/features/auth/store/auth.store.ts');
	const { default: ChangePasswordPanel } =
		await import('../../../../packages/frontend/src/features/security/components/ChangePasswordPanel.vue');
	const pinia = createPinia();
	const store = useAuthStore(pinia);
	await store.login({ username: 'admin', password: 'changed-password-456' });
	const empty = { render: () => h('div') };
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: '/settings', name: 'Settings', component: empty },
			{ path: '/login', name: 'Login', component: empty },
		],
	});
	await router.push('/settings');
	let unmounted = 0;
	const child = {
		setup() {
			onBeforeUnmount(() => unmounted++);
			return () => h(ChangePasswordPanel);
		},
	};
	const node = document.createElement('div');
	document.body.append(node);
	const mounted = createApp({ render: () => (store.sessionState === 'authenticated' ? h(child) : h('div')) });
	mounted.use(pinia).use(i18n).use(router).mount(node);
	const original = globalThis.fetch;
	let writes = 0;
	globalThis.fetch = (url, options) => {
		if (String(url).endsWith('/auth/password')) {
			writes++;
		}
		return original(url, options);
	};
	try {
		for (const [id, value] of [
			['currentPassword', 'changed-password-456'],
			['newPassword', 'final-password-789'],
			['confirmPassword', 'final-password-789'],
		]) {
			const input = node.querySelector('#' + id);
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await nextTick();
		}
		const form = node.querySelector('form');
		const submitted = new Event('submit', { bubbles: true, cancelable: true });
		form.dispatchEvent(submitted);
		if (!submitted.defaultPrevented) {
			throw Error('Vue submit handler was not attached');
		}
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('Login'), { timeout: 5000 });
		if (
			writes !== 1 ||
			unmounted !== 1 ||
			store.sessionState !== 'anonymous' ||
			router.currentRoute.value.name !== 'Login'
		) {
			throw Error(
				'Password navigation mismatch: ' +
					JSON.stringify({
						writes,
						unmounted,
						session: store.sessionState,
						route: router.currentRoute.value.name,
					}),
			);
		}
		expect(writes).toBe(1);
		expect(unmounted).toBe(1);
	} finally {
		globalThis.fetch = original;
		mounted.unmount();
		node.remove();
	}
});
