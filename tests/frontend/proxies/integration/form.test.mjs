import { test, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { openTargetPanel } from '../../targets/support/panel.mjs';
import ProxyView from '../../../../packages/frontend/src/features/proxies/views/ProxiesView.vue';
import { useProxiesStore } from '../../../../packages/frontend/src/features/proxies/store/proxies.store.ts';
import { proxiesApi } from '../../../../packages/frontend/src/features/proxies/api/proxies-api.ts';

test('proxy form commits one request for duplicate submissions and clears its secret draft', async () => {
	const { application, mount, until, fill, i18n, check, checks } = await openTargetPanel();
	let writes = 0;
	vi.stubGlobal('fetch', (url, options) => {
		if (String(url).endsWith('/proxies') && options?.method === 'POST') writes++;
		return application.fetch(url, options);
	});
	const proxies = useProxiesStore();
	const proxyUi = mount(ProxyView);
	try {
		await until(() =>
			[...proxyUi.node.querySelectorAll('button')].some(
				(button) => button.textContent.trim() === i18n.global.t('proxies.addProxy') && !button.disabled,
			),
		);
		[...proxyUi.node.querySelectorAll('button')]
			.find((button) => button.textContent.trim() === i18n.global.t('proxies.addProxy'))
			.click();
		await nextTick();
		await until(() => document.getElementById('proxy-name'));
		fill('proxy-name', 'formal proxy');
		fill('proxy-host', '127.0.0.1');
		fill('proxy-port', '9090');
		fill('proxy-password', '  formal  ');
		const form = document.getElementById('proxy-name').closest('form');
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await until(
			() => proxies.items.some((item) => item.name === 'formal proxy') && !document.getElementById('proxy-name'),
		);
		check(
			(await proxiesApi.list()).filter((item) => item.name === 'formal proxy').length === 1,
			'real formal Proxy view submits once and closes secret form',
		);
	} finally {
		proxyUi.close();
	}

	expect(writes).toBe(1);
	expect(checks).toHaveLength(1);
});
