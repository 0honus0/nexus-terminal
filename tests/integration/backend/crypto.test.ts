import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CryptoApi } from '../../../src/crypto/node/crypto-api.js';
import { CryptoEngine, type CryptoCredentials } from '../../../src/crypto/node/crypto-engine.js';
import type { LogInput } from '../../../src/log/node/log-api.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';
import { PluginCryptoFailureSchema } from 'nexus-terminal/node';

test('本地密钥重启后可用，并按插件所有者和 context 隔离', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-crypto-'));
	const events: LogInput[] = [];
	const services = {
		log: {
			report: (event: LogInput) => {
				events.push(event);
			},
		},
	};
	const first = new CryptoApi({ directory, services });
	const second = new CryptoApi({ directory, services });
	const scope = new PluginScope(() => {});

	t.after(async () => {
		first.close();
		second.close();
		await scope.close();
		await rm(directory, { recursive: true, force: true });
	});

	const options = { mode: 'local', context: 'connection' } as const;
	const owner = '@test/owner';
	const bytes = Buffer.from([0, 127, 255]);
	await first.initialize(new AbortController().signal);
	const encrypted = await first.bind(owner, scope).encrypt(bytes, options);
	assert.ok(encrypted.isOk());
	const sealed = encrypted.value;
	assert.notDeepEqual(Buffer.from(sealed), bytes);
	first.close();

	await second.initialize(new AbortController().signal);
	const plugin = second.bind(owner, scope);
	const decrypted = await plugin.decrypt(sealed, options);
	assert.ok(decrypted.isOk());
	assert.deepEqual(Buffer.from(decrypted.value), bytes);
	for (const failure of [
		await second.bind('@test/other', scope).decrypt(sealed, options),
		await plugin.decrypt(sealed, { ...options, context: 'different' }),
	]) {
		assert.ok(failure.isErr());
		assert.equal(PluginCryptoFailureSchema.parse(failure.error).code, 'AUTHENTICATION_FAILED');
		assert.equal(Object.keys(failure.error).length, 2);
	}
	assert.deepEqual(
		events.map(({ pluginId }) => pluginId),
		['@test/other', owner],
	);
});

test('密码模式可跨宿主解密，错误密码和损坏的信封分别返回稳定错误', async (t) => {
	const resources = new AsyncDisposableStack();

	t.after(() => resources.disposeAsync());

	async function setup() {
		const directory = await mkdtemp(join(tmpdir(), 'nexus-crypto-password-'));
		resources.defer(() => rm(directory, { recursive: true, force: true }));
		const api = new CryptoApi({ directory, services: { log: { report() {} } } });
		resources.defer(() => api.close());
		const scope = new PluginScope(() => {});
		resources.defer(() => scope.close());
		await api.initialize(new AbortController().signal);
		return api.bind('@test/owner', scope);
	}

	const source = await setup();
	const target = await setup();
	const options = { mode: 'password', password: 'fixture-password', context: 'backup' } as const;
	const encrypted = await source.encrypt(new Uint8Array(), options);
	assert.ok(encrypted.isOk());
	const decrypted = await target.decrypt(encrypted.value, options);
	assert.ok(decrypted.isOk());
	assert.equal(decrypted.value.length, 0);
	const wrong = await target.decrypt(encrypted.value, { ...options, password: 'another-password' });
	assert.ok(wrong.isErr());
	assert.equal(wrong.error.code, 'AUTHENTICATION_FAILED');
	const damaged = await target.decrypt(encrypted.value.subarray(0, 4), options);
	assert.ok(damaged.isErr());
	assert.equal(damaged.error.code, 'INVALID_ENVELOPE');
});

test('插件停用后擦除迟到结果与派生密钥，不交付结果或记录取消为失败', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-crypto-cancel-'));
	const scope = new PluginScope(() => {});
	const operation = Promise.withResolvers<Uint8Array>();
	const started = Promise.withResolvers<CryptoCredentials>();
	const logs: unknown[] = [];

	t.mock.method(CryptoEngine.prototype, 'encrypt', (_input: Uint8Array, credentials: CryptoCredentials) => {
		started.resolve(credentials);
		return operation.promise;
	});

	const api = new CryptoApi({
		directory,
		services: {
			log: {
				report: (event) => {
					logs.push(event);
				},
			},
		},
	});

	t.after(async () => {
		api.close();
		await scope.close();
		await rm(directory, { recursive: true, force: true });
	});

	await api.initialize(new AbortController().signal);
	const plugin = api.bind('@test/owner', scope);
	const pending = plugin.encrypt(Uint8Array.of(1), { mode: 'local' });
	const credentials = await started.promise;
	assert.equal(credentials.mode, 'key');
	assert.ok(credentials.key.some(Boolean));

	await scope.close();
	const late = Uint8Array.of(1, 2, 3);
	operation.resolve(late);
	const result = await pending;
	assert.ok(result.isErr());
	assert.deepEqual(result.error, { code: 'CANCELLED' });
	assert.deepEqual(late, new Uint8Array(3));
	assert.ok(credentials.key.every((byte) => byte === 0));
	assert.deepEqual(logs, []);
});
