import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { h, ref, nextTick } from 'vue';
import { SecretBox } from '../../../../packages/backend/dist/platform/security/secret-box.js';
import { openTargetPanel } from '../../targets/support/panel.mjs';
import KeyModal from '../../../../packages/frontend/src/features/ssh-keys/components/SshKeyManagementModal.vue';
import { useSshKeysStore } from '../../../../packages/frontend/src/features/ssh-keys/store/sshKeys.store.ts';
import { sshKeysApi } from '../../../../packages/frontend/src/features/ssh-keys/api/ssh-keys-api.ts';

test('key form creates a secret, preserves its omitted passphrase on replacement and explicitly clears only that passphrase', async () => {
	const encryptionKey = randomBytes(32);
	const { application, mount, until, fill, i18n, check, checks } = await openTargetPanel({ encryptionKey });
	const keys = useSshKeysStore();
	let secrets;

	function inspectTargetSecrets({ keyId, privateKey, passphrase }) {
		const db = new DatabaseSync(join(application.directory, 'application.db'), { readOnly: true });
		try {
			const row = db
				.prepare('SELECT encrypted_private_key, encrypted_passphrase FROM ssh_keys WHERE id=?')
				.get(keyId);
			const box = new SecretBox(encryptionKey);
			return {
				privateKey: box.decrypt(row.encrypted_private_key, 'ssh-key:private') === privateKey,
				passphrase:
					passphrase === null
						? row.encrypted_passphrase === null
						: box.decrypt(row.encrypted_passphrase, 'ssh-key:passphrase') === passphrase,
			};
		} finally {
			db.close();
		}
	}

	const visible = ref(true);
	const keyUi = mount(KeyModal, {}, (component) =>
		h(component, {
			modelValue: visible.value,

			'onUpdate:modelValue': (value) => (visible.value = value),
		}),
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
		fill('key-name', 'formal key');
		fill('key-private', 'formal-private-key');
		fill('key-passphrase', 'formal-phrase');
		document
			.getElementById('key-name')
			.closest('form')
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await until(
			() => keys.items.some((item) => item.name === 'formal key') && !document.getElementById('key-private'),
		);
		check(
			(await sshKeysApi.list()).some((item) => item.name === 'formal key'),
			'real formal SSH Key modal creates key and clears draft',
		);
		const formalKey = keys.items.find((item) => item.name === 'formal key');
		const row = document.querySelector(`[data-key-id="${formalKey.id}"]`);
		row.querySelector('button').click();
		await nextTick();
		fill('key-private', 'formal replacement');
		document
			.getElementById('key-name')
			.closest('form')
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await until(() => !document.getElementById('key-private'));
		secrets = inspectTargetSecrets({
			keyId: formalKey.id,
			privateKey: 'formal replacement',
			passphrase: 'formal-phrase',
		});
		check(
			secrets.privateKey && secrets.passphrase,
			'real formal key replacement preserves existing nonempty passphrase',
		);
		document.querySelector(`[data-key-id="${formalKey.id}"] button`).click();
		await nextTick();
		document.querySelector('[data-ui="checkbox"]').click();
		await nextTick();
		document
			.getElementById('key-name')
			.closest('form')
			.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await until(() => !document.getElementById('key-private'));
		secrets = inspectTargetSecrets({
			keyId: formalKey.id,
			privateKey: 'formal replacement',
			passphrase: null,
		});
		check(secrets.privateKey && secrets.passphrase, 'real explicit clear checkbox removes only key passphrase');
	} finally {
		keyUi.close();
	}

	expect(checks).toHaveLength(3);
});
