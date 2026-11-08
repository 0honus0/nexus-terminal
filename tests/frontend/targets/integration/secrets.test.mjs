import { test, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openAuthenticatedFrontendApplication } from '../../../support/http/frontend-session.mjs';
import { SecretBox } from '../../../../packages/backend/dist/platform/security/secret-box.js';
import { proxiesApi } from '../../../../packages/frontend/src/features/proxies/api/proxies-api.ts';
import { sshKeysApi } from '../../../../packages/frontend/src/features/ssh-keys/api/ssh-keys-api.ts';
import { useProxiesStore } from '../../../../packages/frontend/src/features/proxies/store/proxies.store.ts';
import { useSshKeysStore } from '../../../../packages/frontend/src/features/ssh-keys/store/sshKeys.store.ts';
import { toProxyInput } from '../../../../packages/frontend/src/features/proxies/model/proxy-mapper.ts';
import {
	toSshKeyInput,
	toSshKeyChanges,
} from '../../../../packages/frontend/src/features/ssh-keys/model/ssh-key-mapper.ts';
import { TargetRequestFailure } from '../../../../packages/frontend/src/client/targets/target-types.ts';

test('real target secrets preserve whitespace and explicit intent, enforce CAS and protect references', async () => {
	const encryptionKey = randomBytes(32);
	const { application } = await openAuthenticatedFrontendApplication({ encryptionKey });
	const original = application.fetch;
	const proxies = useProxiesStore();
	const keys = useSshKeysStore();
	const proxyInput = {
		name: 'proxy one',
		type: 'SOCKS5',
		host: '127.0.0.1',
		port: 1080,
		username: 'user',
		password: '  ',
	};
	const keyDraft = {
		name: 'key one',
		privateKey: 'isolated-private-key-one',
		passphrase: '  retained phrase  ',
		clearPassphrase: false,
	};
	const checks = [];

	const check = (value, name) => {
		expect(value, name).toBeTruthy();
		checks.push(name);
	};

	async function failure(work, code) {
		const cause = await work().catch((cause) => cause);
		expect(cause).toBeInstanceOf(TargetRequestFailure);
		expect(cause.code).toBe(code);
	}

	function inspectTargetSecrets({ proxyId, keyId, password, privateKey, passphrase }) {
		const db = new DatabaseSync(join(application.directory, 'application.db'), { readOnly: true });
		try {
			const secrets = new SecretBox(encryptionKey);
			const proxy = db.prepare('SELECT encrypted_password FROM proxy_credentials WHERE proxy_id=?').get(proxyId);
			const key = db
				.prepare('SELECT encrypted_private_key,encrypted_passphrase FROM ssh_keys WHERE id=?')
				.get(keyId);
			return {
				password:
					password === null
						? !proxy || proxy.encrypted_password === null
						: secrets.decrypt(proxy.encrypted_password, 'proxy:password') === password,
				privateKey: secrets.decrypt(key.encrypted_private_key, 'ssh-key:private') === privateKey,
				passphrase:
					passphrase === null
						? key.encrypted_passphrase === null
						: secrets.decrypt(key.encrypted_passphrase, 'ssh-key:passphrase') === passphrase,
			};
		} finally {
			db.close();
		}
	}

	let proxy, key;
	await Promise.all([proxies.load(), keys.load()]);
	proxy = await proxies.create(proxyInput);
	key = await keys.create(toSshKeyInput(keyDraft));
	check(
		proxy.version === 1 && key.version === 1 && !('password' in proxy) && !('privateKey' in key),
		'real CRUD creates safe local summaries',
	);
	let secrets = await inspectTargetSecrets({
		proxyId: proxy.id,
		keyId: key.id,
		password: '  ',
		privateKey: keyDraft.privateKey,
		passphrase: keyDraft.passphrase,
	});
	check(
		secrets.password && secrets.privateKey && secrets.passphrase,
		'real SQLite preserves exact secret whitespace',
	);
	const oldProxy = proxy;
	proxy = await proxies.update(
		proxy,
		toProxyInput({
			name: 'renamed proxy',
			type: 'HTTP',
			host: '127.0.0.1',
			port: 8080,
			username: 'user',
			password: '',
			clearPassword: false,
		}),
	);
	key = await keys.update(
		key,
		toSshKeyChanges({
			name: 'replaced key',
			privateKey: 'isolated-private-key-two',
			passphrase: '',
			clearPassphrase: false,
		}),
	);
	secrets = await inspectTargetSecrets({
		proxyId: proxy.id,
		keyId: key.id,
		password: '  ',
		privateKey: 'isolated-private-key-two',
		passphrase: keyDraft.passphrase,
	});
	check(
		proxy.version === 2 && key.version === 2 && secrets.password && secrets.privateKey && secrets.passphrase,
		'real metadata/key replacement retains omitted password and passphrase',
	);
	await failure(() => proxies.update(oldProxy, proxyInput), 'version_conflict');
	check(proxies.needsRefresh && !proxies.busy, 'real original-version CAS conflict fences writes');
	await failure(() => proxies.create(proxyInput), 'recovery_required');
	await proxies.load(true);
	check(
		!proxies.needsRefresh && proxies.items[0].name === 'renamed proxy',
		'real read recovery observes conflict winner without replay',
	);
	proxy = await proxies.update(
		proxy,
		toProxyInput({
			name: proxy.name,
			type: proxy.type,
			host: proxy.host,
			port: proxy.port,
			username: 'user',
			password: '',
			clearPassword: true,
		}),
	);
	key = await keys.update(
		key,
		toSshKeyChanges({ name: key.name, privateKey: '', passphrase: '', clearPassphrase: true }),
	);
	secrets = await inspectTargetSecrets({
		proxyId: proxy.id,
		keyId: key.id,
		password: null,
		privateKey: 'isolated-private-key-two',
		passphrase: null,
	});
	check(
		secrets.password && secrets.privateKey && secrets.passphrase,
		'real explicit clears remove only selected saved secrets',
	);
	const rawConnection = await original('/api/v1/targets/connections', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name: 'reference owner',
			type: 'SSH',
			host: '127.0.0.1',
			port: 22,
			username: 'user',
			route: 'proxy',
			proxyId: proxy.id,
			notes: null,
			tagIds: [],
			jumpIds: [],
		}),
	});
	check(rawConnection.status === 201, 'real connection creates proxy reference');
	let connection = await rawConnection.json();
	const credential = await original(`/api/v1/targets/connections/${connection.id}/credential`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			version: connection.version,
			credential: { kind: 'ssh_key', sshKeyId: key.id },
		}),
	});
	check(credential.status === 200, 'real connection binds SSH Key reference');
	await failure(() => proxies.remove(proxy.id), 'reference_in_use');
	await failure(() => keys.remove(key.id), 'reference_in_use');
	check(
		(await proxiesApi.list()).some((item) => item.id === proxy.id) &&
			(await sshKeysApi.list()).some((item) => item.id === key.id),
		'real referenced deletions retain both records',
	);
	const released = await original(`/api/v1/targets/connections/${connection.id}`, { method: 'DELETE' });
	check(released.status === 200, 'real owner deletion releases references');

	await application.restart();
	expect(
		inspectTargetSecrets({
			proxyId: proxy.id,
			keyId: key.id,
			password: null,
			privateKey: 'isolated-private-key-two',
			passphrase: null,
		}),
	).toEqual({ password: true, privateKey: true, passphrase: true });
	await proxies.remove(proxy.id);
	await keys.remove(key.id);
	check(
		!(await proxiesApi.list()).some((item) => item.id === proxy.id) &&
			!(await sshKeysApi.list()).some((item) => item.id === key.id),
		'real unreferenced DELETE and list readback',
	);
	expect(checks).toHaveLength(11);
});
