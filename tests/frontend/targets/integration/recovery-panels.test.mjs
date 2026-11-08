import { test, expect, onTestFinished } from 'vitest';
import { h, ref, nextTick, KeepAlive } from 'vue';
import { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { openTargetPanel } from '../support/panel.mjs';
import ProxyView from '../../../../packages/frontend/src/features/proxies/views/ProxiesView.vue';
import KeyModal from '../../../../packages/frontend/src/features/ssh-keys/components/SshKeyManagementModal.vue';
import KeySelector from '../../../../packages/frontend/src/features/ssh-keys/components/SshKeySelector.vue';
import { useProxiesStore } from '../../../../packages/frontend/src/features/proxies/store/proxies.store.ts';
import { useSshKeysStore } from '../../../../packages/frontend/src/features/ssh-keys/store/sshKeys.store.ts';

test('target panels cancel stale intents, preserve selection and fence actual lost proxy receipts', async () => {
	const { pinia, dialogs, original, check, checks, until, mount, hasFeedback, i18n, failure, response } =
		await openTargetPanel();
	const proxies = useProxiesStore(pinia);
	const keys = useSshKeysStore(pinia);
	const proxyInput = {
		name: 'proxy baseline',
		type: 'SOCKS5',
		host: '127.0.0.1',
		port: 1080,
		username: 'user',
		password: '  ',
	};
	await Promise.all([proxies.load(), keys.load()]);
	await proxies.create(proxyInput);
	const key = await keys.create({ name: 'key baseline', privateKey: 'panel-private-key' });

	function fill(id, value) {
		const input = document.getElementById(id);
		expect(input).not.toBeNull();
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
	}

	try {
		const confirmationUi = mount(ProxyView);
		let deletes = 0;
		window.fetch = (url, options) => {
			if (options?.method === 'DELETE') {
				deletes++;
			}
			return original(url, options);
		};
		try {
			await until(() =>
				[...confirmationUi.node.querySelectorAll('button')].some(
					(button) =>
						button.textContent.trim() === i18n.global.t('proxies.actions.delete') && !button.disabled,
				),
			);
			[...confirmationUi.node.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('proxies.actions.delete'))
				.click();
			await until(() => dialogs.state.visible);
			confirmationUi.close();
			await nextTick();
			check(
				!dialogs.state.visible && deletes === 0,
				'unmount cancels pending delete confirmation without dispatch',
			);
		} finally {
			window.fetch = original;
		}
		let writes = 0;
		window.fetch = async (url, options) => {
			if (options?.method === 'POST' && String(url).endsWith('/proxies')) {
				writes++;
				const committed = await original(url, options);
				await committed.body.cancel();
				throw new TypeError('controlled lost acknowledgement');
			}
			return original(url, options);
		};
		const unknown = await failure(
			() => proxies.create({ ...proxyInput, name: 'unknown committed' }),
			'request_failed',
		);
		await failure(() => proxies.create({ ...proxyInput, name: 'unknown committed' }), 'recovery_required');
		check(
			unknown.outcome === 'unknown' && writes === 1 && proxies.needsRefresh,
			'committed response loss fences non-idempotent retry',
		);
		window.fetch = original;
		await proxies.load(true);
		check(
			proxies.items.filter((item) => item.name === 'unknown committed').length === 1,
			'real read recovery locates the unacknowledged commit',
		);

		// Target response validation, stream cancellation and pre-dispatch abort run in the logic suite.

		let release;
		onTestFinished(() => release?.());
		window.fetch = (url, options) =>
			options?.method === 'GET' && String(url).endsWith('/proxies')
				? new Promise((resolve) => {
						release = () => resolve(response([]));
					})
				: original(url, options);
		const oldList = proxies.load(true).catch((cause) => cause);
		await until(() => release);
		const saved = await proxies.create({ ...proxyInput, name: 'newer than list' });
		release();
		await oldList;
		check(
			proxies.items.some((item) => item.id === saved.id) && !proxies.needsRefresh,
			'late pre-write list cannot overwrite confirmed mutation',
		);
		window.fetch = original;

		const selected = ref(key.id);
		const selector = mount(KeySelector, {}, (component) =>
			h(component, {
				modelValue: selected.value,

				'onUpdate:modelValue': (value) => (selected.value = value),
			}),
		);
		try {
			await until(
				() =>
					!keys.needsRefresh &&
					!selector.node.querySelector('[data-ui="select"]').hasAttribute('data-disabled'),
			);
			keys.reset();
			await nextTick();
			check(
				selected.value === key.id,
				'session/cache reset does not erase selected key without authoritative list',
			);
			window.fetch = async () => response({ code: 'storage_unavailable' }, 503);
			await failure(() => keys.load(true), 'storage_unavailable');
			await nextTick();
			check(selected.value === key.id && keys.needsRefresh, 'failed list keeps selection and blocks writes');
			[...selector.node.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('sshKeys.refresh'))
				.click();
			await until(() => hasFeedback('sshKeys.failures.failed'));
			check(
				!selector.node.textContent.includes(i18n.global.t('sshKeys.failures.unknown')),
				'failed read does not claim an unknown save',
			);
			window.fetch = original;
			await keys.load(true);
		} finally {
			selector.close();
		}

		const modalVisible = ref(true);
		const active = ref(true);
		const lifecycle = mount(KeyModal, {}, (component) =>
			h(KeepAlive, () =>
				active.value
					? h(component, {
							modelValue: modalVisible.value,

							'onUpdate:modelValue': (value) => (modalVisible.value = value),
						})
					: null,
			),
		);
		try {
			await until(() =>
				[...document.querySelectorAll('button')].some(
					(button) => button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey') && !button.disabled,
				),
			);
			[...document.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey'))
				.click();
			await nextTick();
			fill('key-name', 'discarded key');
			fill('key-private', 'private secret');
			fill('key-passphrase', 'phrase secret');
			modalVisible.value = false;
			await nextTick();
			modalVisible.value = true;
			await nextTick();
			check(!document.getElementById('key-private'), 'hidden modal clears private draft');
			await until(() =>
				[...document.querySelectorAll('button')].some(
					(button) => button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey') && !button.disabled,
				),
			);
			[...document.querySelectorAll('button')]
				.find((button) => button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey'))
				.click();
			await nextTick();
			fill('key-name', 'late key');
			fill('key-private', 'late key secret');
			let releaseWrite;
			onTestFinished(() => releaseWrite?.());
			window.fetch = (url, options) =>
				options?.method === 'POST' && String(url).endsWith('/ssh-keys')
					? new Promise((resolve) => {
							releaseWrite = () =>
								resolve(response({ ...key, id: key.id + 1000, name: 'late key' }, 201));
						})
					: original(url, options);
			document
				.getElementById('key-private')
				.closest('form')
				.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
			await until(() => releaseWrite);
			active.value = false;
			await nextTick();
			releaseWrite();
			await until(() => !keys.busy);
			check(
				keys.needsRefresh && !keys.items.some((item) => item.name === 'late key') && !modalVisible.value,
				'KeepAlive stop fences late write and retains unknown recovery',
			);
			window.fetch = original;
			await keys.load(true);
		} finally {
			lifecycle.close();
		}

		for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
			await setLocale(locale);
			check(
				i18n.global.te('proxies.failures.unknown', locale) &&
					i18n.global.te('sshKeys.modal.clearPassphrase', locale),
				'three-language recovery and secret-intent labels',
			);
		}
	} finally {
		globalThis.fetch = original;
	}
	expect(checks).toHaveLength(12);
});
