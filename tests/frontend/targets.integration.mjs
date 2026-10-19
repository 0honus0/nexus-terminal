import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { openSshd } from '../backend/remote/openssh-fixture.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');

// Controlled public collection producer; exercise the installed HTTP handler and safe response, without a database write loop.
const { createTargetsRoutes } =
	await import('../../packages/backend/dist/modules/targets/interfaces/http/target-http.js');
const { TARGET_MANAGEMENT_MAX_ITEMS, TARGET_MANAGEMENT_RESPONSE_MAX_BYTES } =
	await import('../../packages/shared/dist/targets/values.js');
let producerItems = [];
const producerRoutes = createTargetsRoutes(
	{ authenticate: async () => ({ userId: 1 }) },
	{
		list: async () => producerItems,

		proxies: { list: async () => producerItems },
		sshKeys: { list: async () => producerItems },
		tags: { list: async () => producerItems },
		hostKeys: { list: async () => producerItems },
	},
	{ run: async (_actor, action) => action() },
);
let producerResult;
const producerContext = {
	cookie: () => 'isolated-token',

	query: new URLSearchParams(),

	send: (status, body) => {
		producerResult = { status, body };
	},
};
const producerProxy = {
	id: 1,
	name: 'proxy',
	type: 'HTTP',
	host: '127.0.0.1',
	port: 8080,
	username: null,
	version: 1,
	createdAt: 1,
	updatedAt: 1,
};
producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
	...producerProxy,
	id: index + 1,
}));
await producerRoutes
	.find((route) => route.method === 'GET' && route.path === '/api/v1/targets/proxies')
	.handle(producerContext);
assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
producerItems = [
	{
		id: 1,
		name: 'x'.repeat(TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['ssh-keys']),
		version: 1,
		createdAt: 1,
		updatedAt: 1,
	},
];
await producerRoutes
	.find((route) => route.method === 'GET' && route.path === '/api/v1/targets/ssh-keys')
	.handle(producerContext);
assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
producerItems = [];
console.log('Targets controlled producer checks: 2 PASS (item count and complete response bytes)');

producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
	id: index + 1,
	name: 'tag',
	version: 1,
	createdAt: 1,
	updatedAt: 1,
}));
const tagListRoute = producerRoutes.find((route) => route.method === 'GET' && route.path === '/api/v1/targets/tags');
await tagListRoute.handle(producerContext);
assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
producerItems = [
	{ id: 1, name: 'x'.repeat(TARGET_MANAGEMENT_RESPONSE_MAX_BYTES.tags), version: 1, createdAt: 1, updatedAt: 1 },
];
await tagListRoute.handle(producerContext);
assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS }, (_, index) => ({
	id: index + 1,
	name: '\u0001'.repeat(128),
	version: Number.MAX_SAFE_INTEGER,
	createdAt: Number.MAX_SAFE_INTEGER,
	updatedAt: Number.MAX_SAFE_INTEGER,
}));
await tagListRoute.handle(producerContext);
assert.equal(producerResult.status, 200);
const { readTagList } = await import('../../packages/shared/dist/targets/tags/http-codec.js');
assert.equal(readTagList(producerResult.body).length, TARGET_MANAGEMENT_MAX_ITEMS);
producerItems = [];
console.log('Tags controlled producer checks: 3 PASS (count, bytes, maximum valid escaped collection)');

const hostListRoute = producerRoutes.find(
	(route) => route.method === 'GET' && route.path === '/api/v1/targets/host-keys',
);
producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
	host: index + '.example',
	port: 22,
	fingerprint: 'SHA256:' + 'A'.repeat(43),
	confirmedAt: 0,
}));
await hostListRoute.handle(producerContext);
assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
producerItems = [
	{
		host: 'x'.repeat(TARGET_MANAGEMENT_RESPONSE_MAX_BYTES['host-keys']),
		port: 22,
		fingerprint: 'SHA256:' + 'A'.repeat(43),
		confirmedAt: 0,
	},
];
await hostListRoute.handle(producerContext);
assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS }, (_, index) => ({
	host: String(index).padStart(5, '0') + '\\'.repeat(248),
	port: 65535,
	fingerprint: 'SHA256:' + 'A'.repeat(43),
	confirmedAt: Number.MAX_SAFE_INTEGER,
}));
await hostListRoute.handle(producerContext);
assert.equal(producerResult.status, 200);
const { readHostKeyList } = await import('../../packages/shared/dist/targets/host-keys/http-codec.js');
assert.equal(readHostKeyList(producerResult.body).length, TARGET_MANAGEMENT_MAX_ITEMS);
producerItems = [];
console.log('Host Key controlled producer checks: 3 PASS (count, bytes, maximum valid escaped collection)');

const connectionListRoute = producerRoutes.find(
	(route) => route.method === 'GET' && route.path === '/api/v1/targets/connections',
);
const producerConnection = {
	id: 1,
	version: 1,
	createdAt: 0,
	updatedAt: 0,
	name: 'connection',
	type: 'SSH',
	host: 'localhost',
	port: 22,
	username: 'user',
	route: 'direct',
	proxyId: null,
	notes: null,
	rdpRemoteApp: null,
	rdpRemoteAppDirectory: null,
	rdpRemoteAppArguments: null,
	tagIds: [],
	jumpIds: [],
};
producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS + 1 }, (_, index) => ({
	...producerConnection,
	id: index + 1,
}));
await connectionListRoute.handle(producerContext);
assert.deepEqual(producerResult, { status: 413, body: { code: 'limit_exceeded' } });
producerItems = Array.from({ length: TARGET_MANAGEMENT_MAX_ITEMS }, (_, index) => ({
	...producerConnection,
	id: index + 1,
}));
await connectionListRoute.handle(producerContext);
const { readConnectionList } = await import('../../packages/shared/dist/targets/connections/http-codec.js');
assert.equal(producerResult.status, 200);
assert.equal(readConnectionList(producerResult.body).length, TARGET_MANAGEMENT_MAX_ITEMS);
producerItems = [];
console.log('Connections controlled producer checks: 2 PASS (count refusal and complete maximum-size collection)');

const root = await mkdtemp(join(tmpdir(), 'nexus-f1-targets-'));
const encryptionKey = randomBytes(32);
let app;
let frontend;
let browser;
let ssh;
try {
	await mkdir(join(root, 'ssh'));
	ssh = await openSshd(join(root, 'ssh'));
	const socket = createServer();
	socket.listen(0, '127.0.0.1');
	await new Promise((resolve) => socket.once('listening', resolve));
	const port = socket.address().port;
	await new Promise((resolve) => socket.close(resolve));
	const origin = 'http://localhost:' + port;
	app = await createApp(join(root, 'auth.db'), {
		encryptionKey,

		configuration: () => ({
			ipWhitelist: '',
			ipBlacklistEnabled: true,
			maxLoginAttempts: 5,
			loginBanDuration: 300,
			statusMonitorIntervalSeconds: 3,
			remoteHostRefreshIntervalSeconds: 60,
			passkeys: [{ origin, rpId: 'localhost' }],
			captcha: { enabled: false, provider: 'none', siteKey: '', secretKey: '', expectedHostname: null },
		}),
	});
	const backend = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	frontend = spawn(
		process.execPath,
		['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		{
			cwd: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
			env: {
				...process.env,
				NEXUS_VITE_BACKEND_ORIGIN: 'http://' + backend,
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	const output = [];
	frontend.stdout.on('data', (value) => output.push(value.toString()));
	frontend.stderr.on('data', (value) => output.push(value.toString()));
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (frontend.exitCode !== null) {
			throw Error('Vite startup failed: ' + output.join('').slice(-2000));
		}
		try {
			const response = await fetch(origin);
			if (response.ok) {
				ready = true;
				break;
			}
		} catch {
			/* startup */
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	assert.ok(ready, 'Vite ready');
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	const downloads = [];
	page.on('download', (download) => downloads.push(download));
	page.on('pageerror', (error) => console.error('Browser error:', error.message));
	await page.exposeFunction('inspectTargetSecrets', async ({ proxyId, keyId, password, privateKey, passphrase }) => {
		const { DatabaseSync } = await import('node:sqlite');
		const { SecretBox } = await import('../../packages/backend/dist/platform/security/secret-box.js');
		const db = new DatabaseSync(join(root, 'auth.db'), { readOnly: true });
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
	});
	await page.goto(origin + '/__targets-next');
	const result = await page.evaluate(
		async (ssh) => {
			const { createPinia, setActivePinia } = await import('/node_modules/.vite/deps/pinia.js');
			const { createApp, h, ref, computed, nextTick, KeepAlive } =
				await import('/node_modules/.vite/deps/vue.js');
			const { provideRuntimeFeatureCapabilities } = await import('/src/shared/capabilities/public.ts');
			let runtimeCapabilities = null;
			const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
			const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
			const { proxiesApi } = await import('/src/features/proxies/api/proxies-api.ts');
			const { sshKeysApi } = await import('/src/features/ssh-keys/api/ssh-keys-api.ts');
			const { useProxiesStore } = await import('/src/features/proxies/store/proxies.store.ts');
			const { useSshKeysStore } = await import('/src/features/ssh-keys/store/sshKeys.store.ts');
			const { toProxyInput } = await import('/src/features/proxies/model/proxy-mapper.ts');
			const { toSshKeyInput, toSshKeyChanges } = await import('/src/features/ssh-keys/model/ssh-key-mapper.ts');
			const { TargetRequestFailure } = await import('/src/client/targets/target-types.ts');
			const { default: i18n } = await import('/src/app/i18n/index.ts');
			const { default: ProxyView } = await import('/src/features/proxies/views/ProxiesView.vue');
			const { default: KeyModal } = await import('/src/features/ssh-keys/components/SshKeyManagementModal.vue');
			const { default: KeySelector } = await import('/src/features/ssh-keys/components/SshKeySelector.vue');
			const { useDialogStore } = await import('/src/shared/feedback/store/dialog.store.ts');
			const { authenticatedSessionLifecycle } = await import('/src/shared/session/public.ts');
			const pinia = createPinia();
			setActivePinia(pinia);
			const auth = useAuthStore(pinia);
			const access = createAccessApi();
			await access.setup({
				username: 'admin',
				password: 'targets-fixture-password-123',
				confirmPassword: 'targets-fixture-password-123',
			});
			await auth.login({ username: 'admin', password: 'targets-fixture-password-123' });
			authenticatedSessionLifecycle.attach(auth.user.id);
			const real = [];
			const controlled = [];
			const original = window.fetch;
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
			const proxies = useProxiesStore(pinia);
			const keys = useSshKeysStore(pinia);

			function check(value, name, kind = real) {
				if (!value) {
					throw Error(name);
				}
				kind.push(name);
			}

			async function until(predicate) {
				await nextTick();
				for (let attempt = 0; attempt < 200; attempt++) {
					if (await predicate()) {
						return;
					}
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				throw Error('Targets condition deadline exceeded');
			}

			async function failure(work, code) {
				try {
					await work();
				} catch (cause) {
					if (cause instanceof TargetRequestFailure && cause.code === code) {
						return cause;
					}
					throw cause;
				}
				throw Error('Expected Target failure: ' + code);
			}

			function mount(component, props = {}, wrapper) {
				const node = document.createElement('div');
				document.body.append(node);
				const app = createApp({
					setup() {
						if (runtimeCapabilities) provideRuntimeFeatureCapabilities(runtimeCapabilities);
						return () => (wrapper ? wrapper(component, props) : h(component, props));
					},
				});
				app.use(pinia);
				app.use(i18n);
				app.mount(node);
				return {
					node,

					close() {
						app.unmount();
						node.remove();
					},
				};
			}

			function fill(id, value) {
				const node = document.getElementById(id);
				if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
					throw Error('Missing field ' + id);
				}
				node.value = value;
				node.dispatchEvent(new Event('input', { bubbles: true }));
			}

			function response(body, status = 200) {
				return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
			}

			let proxy;
			let key;
			try {
				await Promise.all([proxies.load(), keys.load()]);
				proxy = await proxies.create(proxyInput);
				key = await keys.create(toSshKeyInput(keyDraft));
				check(
					proxy.version === 1 && key.version === 1 && !('password' in proxy) && !('privateKey' in key),
					'real CRUD creates safe local summaries',
				);
				let secrets = await window.inspectTargetSecrets({
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
				secrets = await window.inspectTargetSecrets({
					proxyId: proxy.id,
					keyId: key.id,
					password: '  ',
					privateKey: 'isolated-private-key-two',
					passphrase: keyDraft.passphrase,
				});
				check(
					proxy.version === 2 &&
						key.version === 2 &&
						secrets.password &&
						secrets.privateKey &&
						secrets.passphrase,
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
				secrets = await window.inspectTargetSecrets({
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
						rdpRemoteApp: null,
						rdpRemoteAppDirectory: null,
						rdpRemoteAppArguments: null,
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

				const proxyUi = mount(ProxyView);
				try {
					await until(() =>
						[...proxyUi.node.querySelectorAll('button')].some(
							(button) =>
								button.textContent.trim() === i18n.global.t('proxies.addProxy') && !button.disabled,
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
						() =>
							proxies.items.some((item) => item.name === 'formal proxy') &&
							!document.getElementById('proxy-name'),
					);
					check(
						(await proxiesApi.list()).filter((item) => item.name === 'formal proxy').length === 1,
						'real formal Proxy view submits once and closes secret form',
					);
				} finally {
					proxyUi.close();
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
							(button) =>
								button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey') && !button.disabled,
						),
					);
					[...document.querySelectorAll('button')]
						.find((button) => button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey'))
						.click();
					await nextTick();
					fill('key-name', 'formal key');
					const fileInput = document.querySelector('input[type="file"]');
					const invalidFile = new DataTransfer();
					invalidFile.items.add(new File([new Uint8Array([255])], 'invalid-key'));
					fileInput.files = invalidFile.files;
					fileInput.dispatchEvent(new Event('change', { bubbles: true }));
					await until(() =>
						document
							.querySelector('[role="alert"]')
							?.textContent.includes(i18n.global.t('sshKeys.failures.invalid_input')),
					);
					check(
						document.getElementById('key-private').value === '',
						'real file input rejects malformed UTF-8',
					);
					const oversizedFile = new DataTransfer();
					oversizedFile.items.add(new File([new Uint8Array(64 * 1024 + 1)], 'oversized-key'));
					fileInput.files = oversizedFile.files;
					fileInput.dispatchEvent(new Event('change', { bubbles: true }));
					await until(() => !document.getElementById('key-name').closest('fieldset').disabled);
					check(
						document.getElementById('key-private').value === '',
						'real file size guard rejects oversized key before reading',
					);
					const validFile = new DataTransfer();
					validFile.items.add(new File(['formal-private-key'], 'valid-key'));
					fileInput.files = validFile.files;
					fileInput.dispatchEvent(new Event('change', { bubbles: true }));
					await until(() => document.getElementById('key-private').value === 'formal-private-key');
					check(true, 'real bounded UTF-8 file populates key draft');
					fill('key-passphrase', 'formal-phrase');
					document
						.getElementById('key-name')
						.closest('form')
						.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
					await until(
						() =>
							keys.items.some((item) => item.name === 'formal key') &&
							!document.getElementById('key-private'),
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
					secrets = await window.inspectTargetSecrets({
						proxyId: proxy.id,
						keyId: formalKey.id,
						password: null,
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
					secrets = await window.inspectTargetSecrets({
						proxyId: proxy.id,
						keyId: formalKey.id,
						password: null,
						privateKey: 'formal replacement',
						passphrase: null,
					});
					check(
						secrets.privateKey && secrets.passphrase,
						'real explicit clear checkbox removes only key passphrase',
					);
				} finally {
					keyUi.close();
				}

				// Faults below control delivery only; real reads and writes use the same installed backend.
				const dialogs = useDialogStore(pinia);
				const oldOwner = new AbortController();
				const oldConfirm = dialogs.confirm({ message: 'old owner', signal: oldOwner.signal });
				const currentConfirm = dialogs.confirm({ message: 'current owner' });
				oldOwner.abort();
				check(
					!(await oldConfirm) && dialogs.state.visible && dialogs.state.message === 'current owner',
					'stale confirmation cancellation cannot close replacement dialog',
					controlled,
				);
				dialogs.accept();
				check(await currentConfirm, 'replacement confirmation retains its own completion', controlled);
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
								button.textContent.trim() === i18n.global.t('proxies.actions.delete') &&
								!button.disabled,
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
						controlled,
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
					controlled,
				);
				window.fetch = original;
				await proxies.load(true);
				check(
					proxies.items.filter((item) => item.name === 'unknown committed').length === 1,
					'real read recovery locates the unacknowledged commit',
				);

				for (const malformed of [
					{ status: 'updated', value: { ...proxy, id: proxy.id + 100, version: proxy.version + 1 } },
					{ status: 'updated', value: { ...proxy, version: proxy.version + 2 } },
					{ status: 'updated', value: { ...proxy, version: proxy.version + 1, password: 'leaked' } },
				]) {
					window.fetch = async () => response(malformed);
					const cause = await failure(() => proxiesApi.update(proxy, proxyInput), 'protocol_failure');
					check(
						cause.outcome === 'unknown',
						'wrong resource/revision/private-field response rejected',
						controlled,
					);
				}
				window.fetch = async () => response({ code: 'unauthenticated' }, 500);
				await failure(() => proxiesApi.list(), 'protocol_failure');
				check(true, 'mismatched safe error status rejected', controlled);
				window.fetch = async () => response([key, key]);
				await failure(() => sshKeysApi.list(), 'protocol_failure');
				check(true, 'duplicate collection identity rejected', controlled);
				window.fetch = async () => response([{ ...key, updatedAt: key.createdAt - 1 }]);
				await failure(() => sshKeysApi.list(), 'protocol_failure');
				check(true, 'inverted response timestamp rejected', controlled);
				window.fetch = original;
				let cancelledBody = false;
				window.fetch = async () =>
					new Response(
						new ReadableStream({
							cancel() {
								cancelledBody = true;
							},
						}),
						{
							headers: {
								'content-type': 'application/json',
								'content-length': String(64 * 1024 * 1024 + 1),
							},
						},
					);
				await failure(() => proxiesApi.list(), 'protocol_failure');
				check(cancelledBody, 'oversized response declaration cancels unconsumed body', controlled);
				let prematureDispatch = 0;
				window.fetch = async () => {
					prematureDispatch++;
					return response([]);
				};
				const stopped = new AbortController();
				stopped.abort();
				const beforeDispatch = await failure(() => proxiesApi.create(proxyInput, stopped.signal), 'cancelled');
				check(
					prematureDispatch === 0 && beforeDispatch.outcome === 'not_dispatched',
					'pre-cancelled write never dispatches',
					controlled,
				);
				window.fetch = original;

				let release;
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
					controlled,
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
						controlled,
					);
					window.fetch = async () => response({ code: 'storage_unavailable' }, 503);
					await failure(() => keys.load(true), 'storage_unavailable');
					await nextTick();
					check(
						selected.value === key.id && keys.needsRefresh,
						'failed list keeps selection and blocks writes',
						controlled,
					);
					[...selector.node.querySelectorAll('button')]
						.find((button) => button.textContent.trim() === i18n.global.t('sshKeys.refresh'))
						.click();
					await until(() => selector.node.textContent.includes(i18n.global.t('sshKeys.failures.failed')));
					check(
						!selector.node.textContent.includes(i18n.global.t('sshKeys.failures.unknown')),
						'failed read does not claim an unknown save',
						controlled,
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
							(button) =>
								button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey') && !button.disabled,
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
					check(!document.getElementById('key-private'), 'hidden modal clears private draft', controlled);
					await until(() =>
						[...document.querySelectorAll('button')].some(
							(button) =>
								button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey') && !button.disabled,
						),
					);
					[...document.querySelectorAll('button')]
						.find((button) => button.textContent.trim() === i18n.global.t('sshKeys.modal.addKey'))
						.click();
					await nextTick();
					fill('key-name', 'late key');
					fill('key-private', 'late key secret');
					let releaseWrite;
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
						keys.needsRefresh &&
							!keys.items.some((item) => item.name === 'late key') &&
							!modalVisible.value,
						'KeepAlive stop fences late write and retains unknown recovery',
						controlled,
					);
					window.fetch = original;
					await keys.load(true);
				} finally {
					lifecycle.close();
				}

				for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
					check(
						i18n.global.te('proxies.failures.unknown', locale) &&
							i18n.global.te('sshKeys.modal.clearPassphrase', locale),
						'three-language recovery and secret-intent labels',
						controlled,
					);
				}
				await proxies.remove(proxy.id);
				await keys.remove(key.id);
				check(
					!(await proxiesApi.list()).some((item) => item.id === proxy.id) &&
						!(await sshKeysApi.list()).some((item) => item.id === key.id),
					'real unreferenced DELETE and list readback',
				);

				const { tagsApi } = await import('/src/features/tags/api/tags-api.ts');
				const { useTagsStore } = await import('/src/features/tags/store/tags.store.ts');
				const { default: TagPicker } = await import('/src/features/tags/components/ConnectionTagPicker.vue');
				const { default: TagManager } =
					await import('/src/runtimes/workspace/components/WorkspaceTagGroupManager.vue');
				const { useConnectionsStore } = await import('/src/features/connections/store/connections.store.ts');
				const tags = useTagsStore(pinia);
				await tags.load();
				await failure(() => tags.create('猫'.repeat(43)), 'invalid_input');
				check(
					!tags.needsRefresh && tags.items.length === 0,
					'UTF-8 tag name capacity rejected before dispatch',
					controlled,
				);
				const initialTag = await tags.create('  integration tag  ');
				check(
					initialTag.name === 'integration tag' && initialTag.version === 1,
					'real tag creation normalizes name',
				);
				const renamedTag = await tags.rename(initialTag, 'renamed tag');
				await failure(() => tags.rename(initialTag, 'stale name'), 'version_conflict');
				check(
					tags.needsRefresh &&
						(await tagsApi.list()).find((tag) => tag.id === initialTag.id).name === 'renamed tag',
					'real tag CAS refuses stale edit and fences writes',
				);
				await tags.load(true);
				const ensured = await tags.ensure([' existing tag ', 'existing tag', 'renamed tag']);
				check(
					ensured.length === 2 && ensured[1].id === initialTag.id,
					'real ensure deduplicates normalized names and reuses existing tag',
				);
				let postCount = 0;
				window.fetch = (url, options) => {
					if (options?.method === 'POST' && String(url).endsWith('/tags')) {
						postCount += 1;
					}
					return original(url, options);
				};
				let rejectedNames = false;
				try {
					await tags.ensure(['must not create', ' ']);
				} catch {
					rejectedNames = true;
				}
				check(rejectedNames && postCount === 0, 'complete ensure input rejected before any create', controlled);
				window.fetch = original;
				const tagConnectionResponse = await original('/api/v1/targets/connections', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						name: 'tag owner',
						type: 'SSH',
						host: 'localhost',
						port: 22,
						username: 'user',
						route: 'direct',
						proxyId: null,
						notes: null,
						rdpRemoteApp: null,
						rdpRemoteAppDirectory: null,
						rdpRemoteAppArguments: null,
						tagIds: [],
						jumpIds: [],
					}),
				});
				check(tagConnectionResponse.status === 201, 'real connection created for tag relationships');
				const tagConnection = await tagConnectionResponse.json();
				await tags.setConnections(initialTag.id, [tagConnection.id, tagConnection.id]);
				let associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
				check(
					associated.tagIds.length === 1 &&
						associated.tagIds[0] === initialTag.id &&
						associated.version === tagConnection.version + 1,
					'real tag replacement merges duplicate IDs and advances connection CAS',
				);
				await failure(
					() => tags.setConnections(initialTag.id, [tagConnection.id, Number.MAX_SAFE_INTEGER]),
					'reference_not_found',
				);
				associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
				check(
					associated.tagIds.length === 1 && associated.version === tagConnection.version + 1,
					'real missing relationship refuses complete replacement atomically',
				);
				await tags.setConnections(initialTag.id, []);
				associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
				check(
					associated.tagIds.length === 0 && associated.version === tagConnection.version + 2,
					'real empty tag replacement clears associations',
				);
				await tags.setConnections(initialTag.id, [tagConnection.id]);
				const managerVisible = ref(true);
				let groupChanged = 0;
				const manager = mount(TagManager, {}, () =>
					h(TagManager, {
						visible: managerVisible.value,
						tag: renamedTag,
						connections: [associated],

						onClose: () => {
							managerVisible.value = false;
						},

						onChanged: () => {
							groupChanged += 1;
						},
					}),
				);
				try {
					await nextTick();
					const groupName = document.querySelector(
						'input[aria-label="' + i18n.global.t('workspaceConnectionList.manageTags.tagName') + '"]',
					);
					groupName.value = 'UI renamed tag';
					groupName.dispatchEvent(new Event('input', { bubbles: true }));
					await nextTick();
					[...document.querySelectorAll('button')]
						.find((button) => button.textContent.trim() === i18n.global.t('tags.renameOnly'))
						.click();
					await until(() => tags.items.some((tag) => tag.name === 'UI renamed tag'));
					check(
						groupChanged === 0 && managerVisible.value,
						'real formal tag rename is a separate action from relationship replacement',
					);
					[...document.querySelectorAll('button')]
						.find((button) => button.textContent.trim() === i18n.global.t('tags.saveAssociations'))
						.click();
					await until(() => dialogs.state.visible);
					dialogs.accept();
					await until(() => !managerVisible.value);
					associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
					check(
						groupChanged === 1 && associated.tagIds.length === 0 && !useConnectionsStore(pinia).loaded,
						'real formal group replacement confirms success and invalidates connection cache',
					);
				} finally {
					manager.close();
				}

				const latestTag = tags.items.find((tag) => tag.id === initialTag.id);
				let deleteDispatches = 0;
				window.fetch = (url, options) => {
					if (String(url).endsWith(`/tags/${initialTag.id}`) && options?.method === 'DELETE') {
						deleteDispatches += 1;
					}
					return original(url, options);
				};
				const cancellingManager = mount(TagManager, { visible: true, tag: latestTag, connections: [] });
				await nextTick();
				[...document.querySelectorAll('button')]
					.find((button) => button.classList.contains('footer-action--danger'))
					.click();
				await until(() => dialogs.state.visible);
				cancellingManager.close();
				await nextTick();
				check(
					!dialogs.state.visible && deleteDispatches === 0,
					'tag group unmount cancels own delete confirmation without dispatch',
					controlled,
				);
				window.fetch = original;

				let relationDispatches = 0;
				window.fetch = (url, options) => {
					if (String(url).endsWith(`/tags/${initialTag.id}/connections`) && options?.method === 'PUT') {
						relationDispatches += 1;
						return Promise.resolve(response({ code: 'operation_unknown' }, 503));
					}
					return original(url, options);
				};
				const recoveryManager = mount(TagManager, { visible: true, tag: latestTag, connections: [] });
				try {
					await nextTick();
					[...document.querySelectorAll('button')]
						.find((button) => button.textContent.trim() === i18n.global.t('tags.saveAssociations'))
						.click();
					await until(() => dialogs.state.visible);
					dialogs.accept();
					await until(() => tags.needsRefresh);
					await tags.load(true);
					await nextTick();
					const retryButton = [...document.querySelectorAll('button')].find(
						(button) => button.textContent.trim() === i18n.global.t('tags.saveAssociations'),
					);
					retryButton.click();
					check(
						retryButton.disabled && relationDispatches === 1 && !useConnectionsStore(pinia).loaded,
						'tag-only refresh cannot unlock an unknown relationship write in the old panel',
						controlled,
					);
				} finally {
					recoveryManager.close();
					window.fetch = original;
				}

				for (const mismatch of [
					{ ...latestTag, id: latestTag.id + 1000, version: latestTag.version + 1 },
					{ ...latestTag, version: latestTag.version + 2 },
				]) {
					window.fetch = (url, options) =>
						String(url).endsWith(`/tags/${initialTag.id}`) && options?.method === 'PUT'
							? Promise.resolve(response({ status: 'updated', value: mismatch }))
							: original(url, options);
					await failure(() => tags.rename(latestTag, 'unrelated response'), 'protocol_failure');
					check(
						tags.needsRefresh &&
							tags.items.find((tag) => tag.id === initialTag.id).version === latestTag.version,
						'tag rename rejects unrelated resource or revision',
						controlled,
					);
					window.fetch = original;
					await tags.load(true);
				}

				const selectedTags = ref([]);
				const picker = mount(TagPicker, { modelValue: selectedTags.value }, () =>
					h(TagPicker, {
						modelValue: selectedTags.value,

						'onUpdate:modelValue': (value) => {
							selectedTags.value = value;
						},
					}),
				);
				try {
					await until(
						() => picker.node.querySelector('input') && !picker.node.querySelector('input').disabled,
					);
					const input = picker.node.querySelector('input');
					input.value = 'formal picker tag';
					input.dispatchEvent(new Event('input', { bubbles: true }));
					input.dispatchEvent(
						new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
					);
					await until(() => selectedTags.value.length === 1);
					check(
						tags.items.some((tag) => tag.id === selectedTags.value[0] && tag.name === 'formal picker tag'),
						'real formal picker creates and selects local mapped tag',
					);
					const preservedId = selectedTags.value[0];
					tags.reset();
					await nextTick();
					window.fetch = (url, options) =>
						String(url).endsWith('/tags') && options?.method === 'GET'
							? Promise.resolve(response({ code: 'storage_unavailable' }, 503))
							: original(url, options);
					[...picker.node.querySelectorAll('button')]
						.find((button) => button.textContent.trim() === i18n.global.t('tags.refresh'))
						.click();
					await until(() => picker.node.querySelector('[role="alert"]'));
					check(
						selectedTags.value[0] === preservedId &&
							!picker.node.textContent.includes(i18n.global.t('tags.failures.unknown')),
						'failed or reset tag list preserves selected IDs and uses read failure feedback',
						controlled,
					);
					window.fetch = original;
					await tags.load(true);
					await tags.remove(preservedId);
					await nextTick();
					check(
						selectedTags.value.length === 0,
						'authoritative confirmed tag deletion clears stale picker selection',
					);
				} finally {
					picker.close();
				}

				let tagWrites = 0;
				window.fetch = async (url, options) => {
					if (String(url).endsWith('/tags') && options?.method === 'POST') {
						tagWrites += 1;
						const reply = await original(url, options);
						if (tagWrites === 2) {
							await reply.arrayBuffer();
							throw new TypeError('controlled lost acknowledgement');
						}
						return reply;
					}
					return original(url, options);
				};
				const unknownTags = await failure(
					() => tags.ensure(['partial first', 'partial second', 'never dispatched']),
					'request_failed',
				);
				await failure(() => tags.create('blocked replay'), 'recovery_required');
				check(
					unknownTags.outcome === 'unknown' &&
						tagWrites === 2 &&
						tags.items.some((tag) => tag.name === 'partial first') &&
						!tags.items.some((tag) => tag.name === 'partial second'),
					'partial ensure preserves confirmed items and stops on unknown without replay',
					controlled,
				);
				window.fetch = original;
				await tags.load(true);
				check(
					tags.items.some((tag) => tag.name === 'partial second') &&
						!tags.items.some((tag) => tag.name === 'never dispatched'),
					'real readback resolves partial ensure unknown result',
				);
				const { TagEnsureFailure } = await import('/src/features/tags/model/tag-errors.ts');
				let refusedCreates = 0;
				window.fetch = (url, options) => {
					if (String(url).endsWith('/tags') && options?.method === 'POST') {
						refusedCreates += 1;
						if (refusedCreates === 2) {
							return Promise.resolve(response({ code: 'conflict' }, 409));
						}
					}
					return original(url, options);
				};
				const partialRefusal = await failure(
					() => tags.ensure(['confirmed before refusal', 'refused name', 'skipped name']),
					'conflict',
				);
				check(
					partialRefusal instanceof TagEnsureFailure &&
						partialRefusal.completed === 1 &&
						partialRefusal.outcome === 'confirmed' &&
						refusedCreates === 2 &&
						tags.needsRefresh,
					'known partial creation has typed confirmed count and blocks group replay',
					controlled,
				);
				window.fetch = original;
				await tags.load(true);
				check(
					tags.items.some((tag) => tag.name === 'confirmed before refusal') &&
						!tags.items.some((tag) => tag.name === 'skipped name'),
					'real known partial creation readback preserves prior commit',
				);

				const safeTags = await tagsApi.list();
				for (const invalid of [
					[safeTags[0], safeTags[0]],
					[{ ...safeTags[0], updatedAt: safeTags[0].createdAt - 1 }],
					[{ ...safeTags[0], password: 'not public' }],
				]) {
					window.fetch = (url, options) =>
						String(url).endsWith('/tags') && options?.method === 'GET'
							? Promise.resolve(response(invalid))
							: original(url, options);
					await failure(() => tags.load(true), 'protocol_failure');
				}
				check(
					tags.needsRefresh && tags.items.length === safeTags.length,
					'tag collection rejects duplicate IDs, reversed timestamps and leaked fields without overwriting cache',
					controlled,
				);
				window.fetch = original;
				await tags.load(true);
				await tags.setConnections(initialTag.id, [tagConnection.id]);
				await tags.remove(initialTag.id);
				associated = await (await original(`/api/v1/targets/connections/${tagConnection.id}`)).json();
				check(
					!associated.tagIds.includes(initialTag.id) &&
						!(await tagsApi.list()).some((tag) => tag.id === initialTag.id),
					'real tag delete removes associated references and local cache',
				);
				const deletedTagConnection = await original(`/api/v1/targets/connections/${tagConnection.id}`, {
					method: 'DELETE',
				});
				check(deletedTagConnection.status === 200, 'real tag fixture connection cleanup');
				for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
					check(
						i18n.global.te('tags.failures.unknown', locale) &&
							i18n.global.te('tags.saveAssociations', locale),
						'tag recovery and separate-operation labels translated: ' + locale,
						controlled,
					);
				}

				const { hostKeysApi } = await import('/src/features/connections/api/host-keys-api.ts');
				const { default: HostKeyModal } =
					await import('/src/features/connections/components/HostKeyManagementModal.vue');
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
				check(hostWrites === 0, 'invalid pin inputs are rejected before dispatch', controlled);
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
				check(
					true,
					'pin list rejects duplicate identity, noncanonical host, malformed fingerprint and extra fields',
					controlled,
				);
				window.fetch = (url, options) =>
					String(url).endsWith('/host-keys/confirm')
						? Promise.resolve(response({ ...updatedPin, host: 'other.example' }, 201))
						: original(url, options);
				await failure(() => hostKeysApi.confirm(hostInput), 'protocol_failure');
				check(true, 'pin confirmation rejects an unrelated resource response', controlled);
				window.fetch = original;

				function hostButton(key) {
					return [...document.querySelectorAll('button')].find(
						(button) => button.textContent.trim() === i18n.global.t(key),
					);
				}

				function fillHost(label, value) {
					const input = document.querySelector('input[aria-label="' + i18n.global.t(label) + '"]');
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
						controlled,
					);
					dialogs.accept();
					await until(() => document.body.textContent.includes(i18n.global.t('hostKeys.saved')));
					check(
						(await hostKeysApi.list()).some((pin) => pin.host === 'ui.example'),
						'real formal pin form confirms and stores trust',
					);
					hostButton('hostKeys.remove').click();
					await until(() => dialogs.state.visible);
					dialogs.accept();
					await until(() => document.body.textContent.includes(i18n.global.t('hostKeys.removed')));
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
					await until(() => document.body.textContent.includes(i18n.global.t('hostKeys.failures.unknown')));
					check(
						hostButton('hostKeys.confirm').disabled && unknownWrites === 1,
						'lost pin acknowledgement blocks automatic and manual replay',
						controlled,
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
						controlled,
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
						controlled,
					);
				} finally {
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
						controlled,
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
					check(
						i18n.global.te('hostKeys.warning', locale) &&
							i18n.global.te('hostKeys.failures.unknown', locale),
						'host pin warnings and recovery translated: ' + locale,
						controlled,
					);
				}

				// Connections use the same real Access/SQLite/HTTP owners; only explicitly marked failures use controlled fetch.
				{
					const { connectionsApi } = await import('/src/features/connections/api/connections-api.ts');
					const { useConnectionsStore } =
						await import('/src/features/connections/store/connections.store.ts');
					const { connectionTestApi } = await import('/src/features/connections/api/connection-test-api.ts');
					const { ConnectionTestFailure } =
						await import('/src/features/connections/model/connection-errors.ts');
					const { parseConnectionScript, expandConnectionHosts } =
						await import('/src/features/connections/model/connection-script.ts');
					const { default: Editor } =
						await import('/src/features/connections/components/ConnectionEditorModal.vue');
					const { default: ImportModal } =
						await import('/src/features/connections/components/ConnectionImportModal.vue');
					const { default: TagPicker } =
						await import('/src/features/tags/components/ConnectionTagPicker.vue');
					const { useConnectionManagement } =
						await import('/src/features/connections/composables/use-connection-management.ts');
					const connections = useConnectionsStore(pinia);
					runtimeCapabilities = {
						auth: {
							userId: computed(() => auth.user?.id ?? null),
							authenticated: computed(() => auth.isAuthenticated),
						},
						connections: {
							items: computed(() => connections.connections),
							loaded: computed(() => connections.loaded),
							load: connections.load,
							revalidate: connections.revalidate,
						},
						proxies: { items: computed(() => proxies.items), load: proxies.load },
						sshKeys: { items: computed(() => keys.items), load: keys.load, selector: KeySelector },
						tags: {
							items: computed(() => tags.items),
							load: tags.load,
							revalidate: tags.revalidate,
							ensure: tags.ensure,
							picker: TagPicker,
						},
						remoteDesktop: { open() {} },
						terminal: { loadView: async () => ({ default: {} }) },
					};

					const input = (name) => ({
						name,
						type: 'SSH',
						host: '127.0.0.1',
						port: ssh.port,
						username: ssh.user,
						route: 'direct',
						proxyId: null,
						notes: null,
						rdpRemoteApp: null,
						rdpRemoteAppDirectory: null,
						rdpRemoteAppArguments: null,
						tagIds: [],
						jumpIds: [],
					});

					await connections.load(true);
					const imported = await connections.create({
						connection: input('connection atomic'),
						credential: { kind: 'password', password: '  connection secret  ' },
						tagNames: ['atomic connection tag'],
					});
					check(imported[0].status === 'ok', 'real atomic connection/credential/tag creation');
					await connections.load(true);
					let item = await connectionsApi.get(imported[0].id);
					let state = await connectionsApi.credential(item.id);
					check(
						item.tagIds.length === 1 &&
							state.version === item.version &&
							state.credential.kind === 'password' &&
							Object.keys(state.credential).length === 1,
						'real safe credential summary shares metadata version without secrets',
					);
					const changed = await connections.update(item, { notes: 'metadata only' });
					check(
						(await connectionsApi.credential(item.id)).credential.kind === 'password',
						'real metadata save preserves credential',
					);
					await failure(() => connections.update(item, { notes: 'stale' }), 'version_conflict');
					check(connections.needsRefresh, 'connection conflict requires read recovery');
					await connections.load(true);
					await connections.setCredential(changed, null);
					state = await connectionsApi.credential(item.id);
					check(
						state.credential.kind === 'none' && state.version === changed.version + 1,
						'real explicit credential clear advances metadata CAS',
					);
					await connections.load(true);
					const cloned = await connections.clone(item.id, 'connection clone');
					check(
						cloned.id !== item.id &&
							cloned.version === 1 &&
							(await connectionsApi.credential(cloned.id)).credential.kind === 'none',
						'real clone uses independent identity and credential state',
					);
					await failure(() => connectionsApi.credential(Number.MAX_SAFE_INTEGER), 'not_found');
					check(true, 'real missing credential resource returns not_found');
					const rejected = await connections.importMany([
						{
							connection: input('failed atomic'),
							credential: { kind: 'ssh_key', sshKeyId: Number.MAX_SAFE_INTEGER },
							tagNames: ['must rollback'],
						},
					]);
					await connections.load(true);
					check(
						rejected[0].status === 'error' &&
							!connections.items.some((row) => row.name === 'failed atomic') &&
							!(await tagsApi.list()).some((row) => row.name === 'must rollback'),
						'real import failure rolls back metadata and new tags',
					);
					const testKey = await keys.create({ name: 'connection real SSH key', privateKey: ssh.privateKey });
					const sshResult = await connections.create({
						connection: input('SSH test target'),
						credential: { kind: 'ssh_key', sshKeyId: testKey.id },
					});
					await connections.load(true);
					const sshId = sshResult[0].id;

					async function testFailure(work, code) {
						try {
							await work();
						} catch (cause) {
							if (cause instanceof ConnectionTestFailure && cause.code === code) return;
							throw cause;
						}
						throw Error('Expected connection test failure: ' + code);
					}

					await testFailure(() => connectionTestApi.saved(sshId), 'host_key_untrusted');
					check(true, 'real saved SSH test refuses unknown host key');
					await hostKeysApi.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
					check(
						Number.isFinite(await connectionTestApi.saved(sshId)),
						'real saved SSH handshake and cleanup',
					);
					check(
						Number.isFinite(
							await connectionTestApi.unsaved({
								host: '127.0.0.1',
								port: ssh.port,
								username: ssh.user,
								authentication: { kind: 'ssh_key', sshKeyId: testKey.id },
								route: 'direct',
								proxyId: null,
								jumpIds: [],
							}),
						),
						'real unsaved SSH handshake without database creation',
					);
					const credentialOriginal = await connectionsApi.get(item.id);
					let credentialWrites = 0;
					window.fetch = async (url, options) => {
						if (String(url).endsWith(`/${item.id}/credential`) && options?.method === 'PUT') {
							credentialWrites++;
							const committed = await original(url, options);
							if (committed.status !== 200) throw Error('Credential fixture did not commit');
							await committed.arrayBuffer();
							throw new TypeError('lost credential acknowledgement');
						}
						return original(url, options);
					};
					await failure(
						() =>
							connections.setCredential(credentialOriginal, {
								kind: 'password',
								password: 'retained unknown',
							}),
						'request_failed',
					);
					await failure(() => connections.setCredential(credentialOriginal, null), 'recovery_required');
					check(
						credentialWrites === 1,
						'committed credential acknowledgement loss prevents write replay',
						controlled,
					);
					window.fetch = original;
					await connections.load(true);
					check(
						(await connectionsApi.credential(item.id)).version === credentialOriginal.version + 1,
						'real credential read recovers committed unknown without replay',
					);
					const beforeScript = (await connectionsApi.list()).length;
					const parsed = parseConnectionScript(
						'user@[::1]:22 -name "quoted name" -p " spaced password " -tags "new tag"',
						[],
						[],
					);
					check(
						parsed[0].connection.host === '::1' &&
							parsed[0].credential.password === ' spaced password ' &&
							parsed[0].tagNames[0] === 'new tag' &&
							(await connectionsApi.list()).length === beforeScript,
						'script parsing preserves quotes/IPv6/secrets and has no side effects',
					);
					check(
						expandConnectionHosts('192.168.1.1~192.168.1.3').join(',') ===
							'192.168.1.1,192.168.1.2,192.168.1.3',
						'range expands bounded same-subnet addresses',
					);
					for (const source of ['u@host -k missing', 'u@host -p x -k y', 'u@host -name "unclosed']) {
						let refused = false;
						try {
							parseConnectionScript(source, [], []);
						} catch {
							refused = true;
						}
						check(
							refused,
							'invalid script refused before any creation: ' + source.split(' ')[1],
							controlled,
						);
					}
					item = await connectionsApi.get(item.id);
					for (const invalid of [
						[item, item],
						[{ ...item, password: 'must not leak' }],
						[{ ...item, updatedAt: item.createdAt - 1 }],
					]) {
						window.fetch = (url, options) =>
							String(url).endsWith('/connections')
								? Promise.resolve(response(invalid))
								: original(url, options);
						await failure(() => connectionsApi.list(), 'protocol_failure');
						check(true, 'strict connection collection rejects duplicate/private/invalid time', controlled);
					}
					window.fetch = (url, options) =>
						String(url).endsWith('/credential')
							? Promise.resolve(
									response({
										connectionId: item.id + 1000,
										version: 1,
										credential: { kind: 'none' },
									}),
								)
							: original(url, options);
					await failure(() => connectionsApi.credential(item.id), 'protocol_failure');
					check(true, 'credential read validates request identity', controlled);
					window.fetch = (url, options) =>
						String(url).endsWith('/test')
							? Promise.resolve(response({ code: 'host_key_untrusted' }, 500))
							: original(url, options);
					await testFailure(() => connectionTestApi.saved(sshId), 'protocol_failure');
					check(true, 'SSH test rejects mismatched status and safe error', controlled);
					window.fetch = original;

					function button(label) {
						return [...document.querySelectorAll('button')].find(
							(node) => node.textContent.trim() === i18n.global.t(label),
						);
					}

					const editorVisible = ref(true);
					const editor = mount(Editor, {}, () =>
						h(Editor, {
							visible: editorVisible.value,

							onClose: () => {
								editorVisible.value = false;
							},
						}),
					);
					await until(
						() => document.getElementById('conn-host') && !document.getElementById('conn-host').disabled,
					);
					fill('conn-host', '127.0.0.1');
					fill('conn-username', 'user');
					fill('conn-name', 'formal connection');
					fill('conn-password', 'formal secret');
					await nextTick();
					document
						.querySelector('form.connection-form')
						.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
					await until(() => !editorVisible.value);
					editor.close();
					const formal = (await connectionsApi.list()).find((row) => row.name === 'formal connection');
					check(
						formal && (await connectionsApi.credential(formal.id)).credential.kind === 'password',
						'formal create form writes atomic metadata and credential',
					);
					const editingVisible = ref(true);
					const editingUi = mount(Editor, {}, () =>
						h(Editor, {
							visible: editingVisible.value,
							connection: formal,

							onClose: () => {
								editingVisible.value = false;
							},
						}),
					);
					await until(
						() =>
							document.getElementById('conn-password') &&
							!document.getElementById('conn-password').disabled,
					);
					check(
						document.getElementById('conn-password').value === '',
						'formal editor never populates stored secret',
					);
					fill('conn-password', 'replacement secret');
					await nextTick();
					button('connections.saveCredential').click();
					await until(() => !editingVisible.value);
					editingUi.close();
					check(
						(await connectionsApi.get(formal.id)).version === formal.version + 1,
						'formal credential action independently advances original CAS',
					);
					for (const mode of ['script', 'range']) {
						const visible = ref(true);
						const creation = mount(Editor, {}, () =>
							h(Editor, {
								visible: visible.value,

								onClose: () => {
									visible.value = false;
								},
							}),
						);
						await until(
							() =>
								document.getElementById('conn-host') && !document.getElementById('conn-host').disabled,
						);
						if (mode === 'script') {
							document.querySelector('button[role="switch"]').click();
							await nextTick();
							fill(
								'conn-script-input',
								'user@localhost -name "formal script" -p " secret " -tags "formal script tag"',
							);
						} else {
							fill('conn-host', '192.168.50.1~192.168.50.3');
							fill('conn-name', 'formal range');
							fill('conn-username', 'user');
							fill('conn-password', 'range secret');
						}
						await nextTick();
						document
							.querySelector('form.connection-form')
							.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
						await until(() => !visible.value);
						creation.close();
						const count = (await connectionsApi.list()).filter((row) =>
							row.name.startsWith('formal ' + mode),
						).length;
						check(
							count === (mode === 'script' ? 1 : 3),
							'formal ' + mode + ' creates complete import intents',
						);
					}
					check(
						tags.items.some((row) => row.name === 'formal script tag'),
						'script-created tags refresh their actual cache owner',
					);

					const importVisible = ref(true);
					const importing = mount(ImportModal, {}, () =>
						h(ImportModal, {
							visible: importVisible.value,

							onClose: () => {
								importVisible.value = false;
							},
						}),
					);
					await until(
						() =>
							document.querySelector('input[type="file"]') &&
							!document.querySelector('input[type="file"]').disabled,
					);
					const fileInput = document.querySelector('input[type="file"]');
					const invalidFile = new DataTransfer();
					invalidFile.items.add(new File([new Uint8Array([255])], 'bad.json'));
					fileInput.files = invalidFile.files;
					fileInput.dispatchEvent(new Event('change', { bubbles: true }));
					await until(() =>
						document
							.querySelector('[role="status"]')
							?.textContent.includes(i18n.global.t('connections.failures.invalid_input')),
					);
					check(true, 'formal file import rejects malformed UTF-8 before dispatch', controlled);
					const file = new DataTransfer();
					file.items.add(
						new File(
							[
								JSON.stringify([
									{ connection: input('formal import good') },
									{
										connection: input('formal import bad'),
										credential: { kind: 'ssh_key', sshKeyId: Number.MAX_SAFE_INTEGER },
									},
								]),
							],
							'connections.json',
						),
					);
					fileInput.files = file.files;
					fileInput.dispatchEvent(new Event('change', { bubbles: true }));
					await until(() => document.querySelector('textarea')?.value.includes('formal import good'));
					document
						.querySelector('textarea')
						.closest('form')
						.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
					await until(() => document.querySelectorAll('ol[aria-live] li').length === 2);
					check(
						importVisible.value &&
							document.querySelectorAll('ol[aria-live] li')[0].textContent.includes('#1') &&
							document.querySelectorAll('ol[aria-live] li')[1].textContent.includes('#2') &&
							(await connectionsApi.list()).some((row) => row.name === 'formal import good'),
						'formal import preserves ordered partial-success receipts',
					);
					importing.close();

					let manager;
					const managementUi = mount({
						setup() {
							manager = useConnectionManagement();
							return () => h('div');
						},
					});
					await connections.load(true);
					let writes = 0;
					window.fetch = (url, options) => {
						if (String(url).includes('/connections/') && options?.method === 'PUT') {
							writes++;
							return Promise.reject(new TypeError('controlled lost response'));
						}
						return original(url, options);
					};
					manager.selected.value = new Set([item.id, cloned.id]);
					manager.openBatch();
					await manager.batchSave({ kind: 'metadata', changes: { notes: 'unknown' } });
					check(
						writes === 1 && connections.needsRefresh,
						'batch stops after unknown and does not dispatch remaining mutations',
						controlled,
					);
					await manager.batchSave({ kind: 'metadata', changes: { notes: 'unknown' } });
					check(writes === 1, 'batch unknown cannot be replayed before explicit read recovery', controlled);
					window.fetch = original;
					await connections.load(true);
					manager.selected.value = new Set([item.id, cloned.id]);
					manager.openBatch();
					await manager.batchSave({ kind: 'metadata', changes: { notes: 'batch confirmed' } });
					check(
						(await connectionsApi.get(item.id)).notes === 'batch confirmed' &&
							(await connectionsApi.get(cloned.id)).notes === 'batch confirmed',
						'real serial metadata batch uses captured snapshots',
					);
					const appendTag = (await tags.ensure(['append connection tag']))[0];
					manager.selected.value = new Set([cloned.id]);
					await manager.appendTag(appendTag.id);
					check(
						(await connectionsApi.get(cloned.id)).tagIds.includes(appendTag.id),
						'real append-tag action refreshes full connection cache',
					);
					manager.exportItems([await connectionsApi.get(item.id)]);
					const deleteTarget = await connections.clone(item.id, 'batch delete target');
					const deleting = manager.removeMany([deleteTarget]);
					await until(() => dialogs.state.visible);
					dialogs.accept();
					await deleting;
					await failure(() => connectionsApi.get(deleteTarget.id), 'not_found');
					check(true, 'real confirmed batch deletion removes selected resource');
					manager.selected.value = new Set([item.id]);
					manager.openBatch();
					const credentialWait = manager.batchSave({ kind: 'credential', credential: null });
					await until(() => dialogs.state.visible);
					manager.cancelBatch();
					await credentialWait;
					check(
						!dialogs.state.visible && !manager.loading.value,
						'closing batch cancels its pending credential confirmation',
						controlled,
					);
					const { createRouter, createMemoryHistory } =
						await import('/node_modules/.vite/deps/vue-router.js');
					const router = createRouter({
						history: createMemoryHistory(),
						routes: [{ path: '/', component: { render: () => null } }],
					});
					const { default: ConnectionsView } =
						await import('/src/features/connections/views/ConnectionsView.vue');
					const viewNode = document.createElement('div');
					document.body.append(viewNode);
					const viewApp = createApp({
						setup() {
							provideRuntimeFeatureCapabilities(runtimeCapabilities);
							return () => h(ConnectionsView);
						},
					});
					viewApp.use(pinia);
					viewApp.use(i18n);
					viewApp.use(router);
					viewApp.mount(viewNode);
					await until(() => viewNode.textContent.includes('formal connection'));
					check(
						viewNode.textContent.includes(i18n.global.t('connections.exportHelp')),
						'formal Connections view renders migrated list and safe export scope',
					);
					viewApp.unmount();
					viewNode.remove();
					await tags.load(true);
					const { default: ConnectionTree } =
						await import('/src/runtimes/workspace/components/WorkspaceConnectionList.vue');
					const tree = mount(ConnectionTree);
					await until(
						() =>
							tree.node.textContent.includes('append connection tag') &&
							tree.node.querySelector('[data-connection-id]'),
					);
					check(
						tree.node.textContent.includes('atomic connection tag'),
						'formal Workspace tree consumes migrated connection/tag owners',
					);
					tree.close();
					let lateConnection;
					window.fetch = (url, options) =>
						options?.method === 'GET' && String(url).endsWith('/connections')
							? new Promise((resolve) => {
									lateConnection = () => resolve(response([item]));
								})
							: original(url, options);
					const lateRead = connections.load(true).catch((cause) => cause);
					await until(() => lateConnection);
					connections.reset();
					lateConnection();
					await lateRead;
					check(
						!connections.loaded && !connections.items.length,
						'connection cache reset fences late list delivery',
						controlled,
					);
					window.fetch = original;
					await connections.load(true);
					managementUi.close();
					for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
						check(
							i18n.global.te('connections.separateSaves', locale) &&
								i18n.global.te('connections.testFailures.host_key_untrusted', locale),
							'connection edit and SSH recovery translations: ' + locale,
							controlled,
						);
					}
				}
				const logoutPinVisible = ref(true);
				const logoutPinModal = mount(HostKeyModal, {}, () =>
					h(HostKeyModal, {
						visible: logoutPinVisible.value,

						onClose: () => {
							logoutPinVisible.value = false;
						},
					}),
				);
				await until(() => hostButton('hostKeys.confirm') && !hostButton('hostKeys.confirm').disabled);
				let late;
				window.fetch = (url, options) =>
					options?.method === 'GET' && String(url).endsWith('/proxies')
						? new Promise((resolve) => {
								late = () => resolve(response([]));
							})
						: original(url, options);
				const pending = proxies.load(true).catch((cause) => cause);
				await until(() => late);
				await auth.logout();
				// The production App dispatches this event after Auth changes; this isolated mount drives that boundary explicitly.
				authenticatedSessionLifecycle.logout();
				await nextTick();
				check(
					!logoutPinVisible.value && !hostButton('hostKeys.confirm'),
					'auth loss closes the pin panel and clears its draft/list',
					controlled,
				);
				logoutPinModal.close();
				late();
				await pending;
				check(
					!proxies.loaded &&
						!keys.loaded &&
						!tags.loaded &&
						proxies.items.length === 0 &&
						keys.items.length === 0 &&
						tags.items.length === 0,
					'logout fences old collection delivery',
					controlled,
				);
			} finally {
				window.fetch = original;
			}
			return { real, controlled };
		},
		{ port: ssh.port, user: ssh.user, privateKey: ssh.privateKey, fingerprint: ssh.fingerprint },
	);
	console.log('Targets real checks:', result.real.length, result.real.join('; '));
	console.log('Targets controlled checks:', result.controlled.length, result.controlled.join('; '));
	assert.equal(downloads.length, 1, 'one explicit browser export');
	const exported = JSON.parse(await readFile(await downloads[0].path(), 'utf8'));
	assert.equal(exported.length, 1);
	assert.deepEqual(Object.keys(exported[0]), ['connection']);
	assert.equal(exported[0].connection.name, 'connection atomic');
	console.log('Connections real browser download: 1 PASS (new-format configuration without credentials)');
	await page.close();
} finally {
	const failures = [];
	try {
		if (browser) {
			await browser.close();
		}
	} catch (cause) {
		failures.push(cause);
	}
	try {
		if (frontend) {
			const exited = new Promise((resolve) => frontend.once('exit', resolve));
			frontend.kill('SIGTERM');
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1500))]);
			if (frontend.exitCode === null) {
				frontend.kill('SIGKILL');
				await exited;
			}
		}
	} catch (cause) {
		failures.push(cause);
	}
	try {
		if (app) {
			await app.close();
		}
	} catch (cause) {
		failures.push(cause);
	}
	try {
		if (ssh) await ssh.close();
	} catch (cause) {
		failures.push(cause);
	}
	try {
		await rm(root, { recursive: true, force: true });
	} catch (cause) {
		failures.push(cause);
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Targets browser cleanup failed');
	}
}
