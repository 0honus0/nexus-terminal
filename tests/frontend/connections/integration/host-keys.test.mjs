import { test, expect as verify } from 'vitest';
import { h, ref, nextTick, KeepAlive } from 'vue';
import { setLocale } from '../../../../packages/frontend/src/app/i18n/index.ts';
import { openTargetPanel } from '../../targets/support/panel.mjs';

test('host trust panels preserve exact identity, unknown commits and cancelled owners', async () => {
	const { pinia, dialogs, original, check, checks, until, mount, hasFeedback, i18n, failure, response } =
		await openTargetPanel();
	try {
		const { hostKeysApi } =
			await import('../../../../packages/frontend/src/features/connections/api/host-keys-api.ts');
		const { default: HostKeyModal } =
			await import('../../../../packages/frontend/src/features/connections/components/HostKeyManagementModal.vue');
		const fingerprint = 'SHA256:' + 'A'.repeat(43);
		const hostInput = { host: 'FiXtUrE.Example', port: 2222, fingerprint };
		const firstPin = await hostKeysApi.confirm(hostInput);
		check(
			firstPin.host === 'fixture.example' && (await hostKeysApi.list()).length === 1,
			'real host pin confirmation canonicalizes address and reads safe summary',
		);
		const updatedPin = await hostKeysApi.confirm({ ...hostInput, fingerprint: 'SHA256:' + 'B'.repeat(43) });
		check(
			(await hostKeysApi.list())[0].fingerprint === updatedPin.fingerprint,
			'real confirmation replaces the host/port pin',
		);
		let hostWrites = 0;
		window.fetch = (url, options) => {
			if (String(url).includes('/host-keys/') && options?.method === 'POST') hostWrites += 1;
			return original(url, options);
		};
		for (const invalid of [
			{ ...hostInput, fingerprint: 'SHA256:invalid' },
			{ ...hostInput, host: 'bad host' },
			{ ...hostInput, port: 0 },
		]) {
			await failure(() => hostKeysApi.confirm(invalid), 'invalid_input');
		}
		check(hostWrites === 0, 'invalid pin inputs are rejected before dispatch');
		window.fetch = original;
		for (const invalid of [
			[updatedPin, updatedPin],
			[{ ...updatedPin, host: 'UPPER.example' }],
			[{ ...updatedPin, fingerprint: 'wrong' }],
			[{ ...updatedPin, secret: 'not public' }],
		]) {
			window.fetch = (url, options) =>
				String(url).endsWith('/host-keys') && options?.method === 'GET'
					? Promise.resolve(response(invalid))
					: original(url, options);
			await failure(() => hostKeysApi.list(), 'protocol_failure');
		}
		check(true, 'pin list rejects duplicate identity, noncanonical host, malformed fingerprint and extra fields');
		window.fetch = (url, options) =>
			String(url).endsWith('/host-keys/confirm')
				? Promise.resolve(response({ ...updatedPin, host: 'other.example' }, 201))
				: original(url, options);
		await failure(() => hostKeysApi.confirm(hostInput), 'protocol_failure');
		check(true, 'pin confirmation rejects an unrelated resource response');
		window.fetch = original;

		function hostButton(key) {
			return [...document.querySelectorAll('button')].find(
				(button) => button.textContent.trim() === i18n.global.t(key),
			);
		}

		function fillHost(label, value) {
			const input = document.getElementById('host-key-' + label.slice('hostKeys.'.length));
			input.value = value;
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}

		const pinVisible = ref(true);
		const pinModal = mount(HostKeyModal, {}, () =>
			h(HostKeyModal, {
				visible: pinVisible.value,

				onClose: () => {
					pinVisible.value = false;
				},
			}),
		);
		try {
			await until(() => hostButton('hostKeys.confirm') && !hostButton('hostKeys.confirm').disabled);
			fillHost('hostKeys.host', 'ui.example');
			fillHost('hostKeys.port', '22');
			fillHost('hostKeys.fingerprint', fingerprint);
			await nextTick();
			hostButton('hostKeys.confirm').click();
			await until(() => dialogs.state.visible);
			check(
				dialogs.state.message.includes(fingerprint) && dialogs.state.message.includes('ui.example'),
				'formal pin dialog shows exact confirmation identity',
			);
			dialogs.accept();
			await until(() => hasFeedback('hostKeys.saved'));
			check(
				(await hostKeysApi.list()).some((pin) => pin.host === 'ui.example'),
				'real formal pin form confirms and stores trust',
			);
			hostButton('hostKeys.remove').click();
			await until(() => dialogs.state.visible);
			dialogs.accept();
			await until(() => hasFeedback('hostKeys.removed'));
			check(
				!(await hostKeysApi.list()).some((pin) => pin.host === updatedPin.host),
				'real formal pin removal deletes the selected address',
			);
			let unknownWrites = 0;
			window.fetch = async (url, options) => {
				if (String(url).endsWith('/host-keys/confirm')) {
					unknownWrites += 1;
					const reply = await original(url, options);
					await reply.arrayBuffer();
					throw new TypeError('controlled lost pin acknowledgement');
				}
				return original(url, options);
			};
			fillHost('hostKeys.host', 'unknown.example');
			fillHost('hostKeys.fingerprint', fingerprint);
			await nextTick();
			hostButton('hostKeys.confirm').click();
			await until(() => dialogs.state.visible);
			dialogs.accept();
			await until(
				() =>
					hostButton('hostKeys.confirm').disabled &&
					hostButton('hostKeys.refresh') &&
					!hostButton('hostKeys.refresh').disabled,
			);
			check(
				hostButton('hostKeys.confirm').disabled && unknownWrites === 1,
				'lost pin acknowledgement blocks automatic and manual replay',
			);
			window.fetch = original;
			hostButton('hostKeys.refresh').click();
			await until(() => !hostButton('hostKeys.confirm').disabled);
			check(
				document.body.textContent.includes('unknown.example') &&
					(await hostKeysApi.list()).some((pin) => pin.host === 'unknown.example'),
				'real explicit readback resolves committed pin unknown',
			);
			hostButton('hostKeys.remove').click();
			await until(() => dialogs.state.visible);
			pinVisible.value = false;
			await nextTick();
			check(
				!dialogs.state.visible && (await hostKeysApi.list()).length === 2,
				'closing formal pin panel cancels its own removal confirmation',
			);
		} finally {
			pinModal.close();
			window.fetch = original;
		}

		let releasePinRead;
		window.fetch = (url, options) =>
			String(url).endsWith('/host-keys') && options?.method === 'GET'
				? new Promise((resolve) => {
						releasePinRead = () => resolve(response([updatedPin]));
					})
				: original(url, options);
		const latePinVisible = ref(true);
		const latePinModal = mount(HostKeyModal, {}, () => h(HostKeyModal, { visible: latePinVisible.value }));
		try {
			await until(() => releasePinRead);
			latePinVisible.value = false;
			await nextTick();
			releasePinRead();
			window.fetch = original;
			latePinVisible.value = true;
			await until(() => hostButton('hostKeys.confirm') && !hostButton('hostKeys.confirm').disabled);
			check(
				document.body.textContent.includes('unknown.example'),
				'late closed-panel read cannot replace newly reopened pin list',
			);
		} finally {
			releasePinRead?.();
			latePinModal.close();
			window.fetch = original;
		}
		const hostActive = ref(true);
		const lateWriteVisible = ref(true);
		const lateWriteModal = mount(HostKeyModal, {}, () =>
			h(KeepAlive, null, {
				default: () =>
					hostActive.value
						? h(HostKeyModal, {
								visible: lateWriteVisible.value,

								onClose: () => {
									lateWriteVisible.value = false;
								},
							})
						: null,
			}),
		);
		let releasePinWrite;
		let latePinWrites = 0;
		try {
			await until(() => hostButton('hostKeys.confirm') && !hostButton('hostKeys.confirm').disabled);
			window.fetch = async (url, options) => {
				if (String(url).endsWith('/host-keys/confirm')) {
					latePinWrites += 1;
					const reply = await original(url, options);
					return new Promise((resolve) => {
						releasePinWrite = () => resolve(reply);
					});
				}
				return original(url, options);
			};
			fillHost('hostKeys.host', 'late-write.example');
			fillHost('hostKeys.fingerprint', fingerprint);
			await nextTick();
			hostButton('hostKeys.confirm').click();
			await until(() => dialogs.state.visible);
			dialogs.accept();
			await until(() => releasePinWrite);
			hostActive.value = false;
			await nextTick();
			releasePinWrite();
			window.fetch = original;
			check(
				!lateWriteVisible.value && latePinWrites === 1,
				'KeepAlive stop cancels panel delivery without replaying committed trust',
			);
			hostActive.value = true;
			await nextTick();
			lateWriteVisible.value = true;
			await until(() => hostButton('hostKeys.confirm') && !hostButton('hostKeys.confirm').disabled);
			check(
				document.body.textContent.includes('late-write.example'),
				'real reopened pin panel reads committed late write',
			);
		} finally {
			releasePinWrite?.();
			lateWriteModal.close();
			window.fetch = original;
		}

		for (const pin of await hostKeysApi.list()) await hostKeysApi.remove(pin);
		check((await hostKeysApi.list()).length === 0, 'real pin removal and final empty list readback');
		for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
			await setLocale(locale);
			check(
				i18n.global.te('hostKeys.warning', locale) && i18n.global.te('hostKeys.failures.unknown', locale),
				'host pin warnings and recovery translated: ' + locale,
			);
		}
	} finally {
		globalThis.fetch = original;
	}
	verify(checks.length).toBe(18);
});
