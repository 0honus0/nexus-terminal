import { test, expect } from 'vitest';

test('TOTP KeepAlive and unmount clear secrets and preserve unknown writes', async () => {
	const { createApp, h, ref, nextTick, KeepAlive } = await import('vue');
	const { createPinia } = await import('pinia');
	const { default: i18n } = await import('../../../../packages/frontend/src/app/i18n/index.ts');
	const { useTwoFactorSettings } =
		await import('../../../../packages/frontend/src/features/security/composables/use-two-factor-settings.ts');
	const enabled = ref(false);
	const node = document.createElement('div');
	document.body.append(node);
	let controller;
	let changes = 0;
	const visible = ref(true);
	const flow = {
		setup() {
			controller = useTwoFactorSettings(
				() => enabled.value,
				() => changes++,
			);
			return () => h('div');
		},
	};
	const mounted = createApp({
		render: () => h(KeepAlive, null, { default: () => (visible.value ? h(flow) : h('div')) }),
	});
	mounted.use(createPinia()).use(i18n).mount(node);
	const original = globalThis.fetch;

	const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

	const checks = [];

	function check(value, name) {
		if (!value) {
			throw Error(name);
		}
		checks.push(name);
	}

	try {
		let calls = 0;
		globalThis.fetch = async () => {
			calls++;
			throw Error('unknown write');
		};
		await controller.begin();
		await controller.begin();
		check(
			controller.needsRefresh.value && calls === 1 && controller.setup.value === null,
			'unknown TOTP setup blocks repeated writes',
		);
		globalThis.fetch = async () =>
			json({ isAuthenticated: true, user: { id: 1, username: 'admin', twoFactorEnabled: true } });
		await controller.refresh();
		check(
			!controller.needsRefresh.value && !controller.loading.value,
			'TOTP recovery reads authoritative session without replay',
		);
		let finish;
		globalThis.fetch = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const stale = controller.begin();
		enabled.value = true;
		await nextTick();
		finish(json({ secret: 'A'.repeat(32), qrCodeUrl: 'data:image/png;base64,AAAA' }));
		await stale;
		check(
			controller.setup.value === null && !controller.loading.value,
			'changed factor status invalidates pending setup',
		);
		const hidden = controller.begin();
		visible.value = false;
		await nextTick();
		finish(json({ secret: 'C'.repeat(32), qrCodeUrl: 'data:image/png;base64,AAAA' }));
		await hidden;
		check(
			controller.needsRefresh.value && controller.setup.value === null && !controller.loading.value,
			'cached TOTP page deactivation clears secrets and fences unknown write',
		);
		visible.value = true;
		await nextTick();
		globalThis.fetch = async () =>
			json({ isAuthenticated: true, user: { id: 1, username: 'admin', twoFactorEnabled: false } });
		await controller.refresh();
		globalThis.fetch = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const late = controller.begin();
		controller.disablePassword.value = 'private-password';
		mounted.unmount();
		finish(json({ secret: 'B'.repeat(32), qrCodeUrl: 'data:image/png;base64,AAAA' }));
		await late;
		check(
			controller.setup.value === null &&
				controller.disablePassword.value === '' &&
				!controller.loading.value &&
				changes === 0,
			'unmounted TOTP flow clears secrets and ignores late completion',
		);
	} finally {
		globalThis.fetch = original;
		mounted.unmount();
		node.remove();
	}
	expect(checks).toHaveLength(5);
});
