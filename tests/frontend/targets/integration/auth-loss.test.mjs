import { test, expect, onTestFinished, vi } from 'vitest';
import { ref, h, nextTick } from 'vue';
import { openTargetPanel } from '../support/panel.mjs';
import HostKeyModal from '../../../../packages/frontend/src/features/connections/components/HostKeyManagementModal.vue';
import { useProxiesStore } from '../../../../packages/frontend/src/features/proxies/store/proxies.store.ts';
import { useSshKeysStore } from '../../../../packages/frontend/src/features/ssh-keys/store/sshKeys.store.ts';
import { useTagsStore } from '../../../../packages/frontend/src/features/tags/store/tags.store.ts';
import { authenticatedSessionLifecycle } from '../../../../packages/frontend/src/shared/session/public.ts';
import { hostKeysApi } from '../../../../packages/frontend/src/features/connections/api/host-keys-api.ts';

test('actual logout closes the trust panel and late collection delivery cannot revive populated caches', async () => {
	const { application, auth, mount, until, i18n } = await openTargetPanel();
	const proxies = useProxiesStore();
	const keys = useSshKeysStore();
	const tags = useTagsStore();
	await Promise.all([proxies.load(), keys.load(), tags.load()]);
	await proxies.create({
		name: 'private proxy baseline',
		type: 'SOCKS5',
		host: '127.0.0.1',
		port: 1080,
		username: 'user',
	});
	await keys.create({ name: 'private key baseline', privateKey: 'private test key' });
	await tags.create('private tag baseline');
	await hostKeysApi.confirm({ host: 'private.example', port: 22, fingerprint: 'SHA256:' + 'A'.repeat(43) });
	expect([proxies.items.length, keys.items.length, tags.items.length]).toEqual([1, 1, 1]);
	const visible = ref(true);
	const panel = mount(HostKeyModal, {}, () =>
		h(HostKeyModal, {
			visible: visible.value,

			onClose: () => {
				visible.value = false;
			},
		}),
	);

	const confirm = () =>
		Array.from(document.querySelectorAll('button')).find(
			(button) => button.textContent.trim() === i18n.global.t('hostKeys.confirm'),
		);

	await until(() => confirm() && !confirm().disabled);
	expect(document.body.textContent).toContain('private.example');
	const entered = Promise.withResolvers();
	const release = Promise.withResolvers();
	onTestFinished(() => release.resolve());
	vi.stubGlobal('fetch', async (url, options) => {
		const response = await application.fetch(url, options);
		if (options?.method === 'GET' && String(url).endsWith('/proxies')) {
			entered.resolve();
			await release.promise;
		}
		return response;
	});
	const pending = proxies.load(true).catch((cause) => cause);
	await entered.promise;
	await auth.logout();
	// The App owns this notification; this isolated component test drives its boundary explicitly.
	const revoked = authenticatedSessionLifecycle.logout();
	expect(revoked.failures).toEqual([]);
	await nextTick();
	expect(visible.value).toBe(false);
	expect(confirm()).toBeUndefined();
	panel.close();
	release.resolve();
	await pending;
	expect([proxies.loaded, keys.loaded, tags.loaded]).toEqual([false, false, false]);
	expect([proxies.items.length, keys.items.length, tags.items.length]).toEqual([0, 0, 0]);
});
