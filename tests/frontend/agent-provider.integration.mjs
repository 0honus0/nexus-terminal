import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-agent-provider-'));
let app;
let vite;
let browser;
let vendor;
let modelRequests = 0;

try {
	vendor = createHttpServer(async (request, response) => {
		for await (const _chunk of request) {
			/* Drain the local request before replying. */
		}
		if (request.url === '/v1/models') {
			response.writeHead(200, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					data: [
						{
							id: 'fixture-model',
							owned_by: 'local-fixture',
							nexus_capabilities: {
								schema_version: 1,
								context_window: 4096,
								max_output_tokens: 512,
								supports_tools: true,
								supports_image_input: true,
							},
						},
						{ id: 'unknown-capabilities' },
					],
				}),
			);
		} else if (request.url === '/v1/chat/completions') {
			modelRequests += 1;
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.write(
				'data: ' +
					JSON.stringify({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }] }) +
					'\n\n',
			);
			response.write(
				'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }) + '\n\n',
			);
			response.write(
				'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
			);
			response.end('data: [DONE]\n\n');
		} else response.writeHead(404).end();
	});
	await new Promise((resolve) => vendor.listen(0, '127.0.0.1', resolve));
	const vendorUrl = 'http://127.0.0.1:' + vendor.address().port + '/v1';
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve, reject) => net.close((cause) => (cause ? reject(cause) : resolve())));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'provider.db'), { encryptionKey: randomBytes(32) });
	const backend = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: { '/api': { target: 'http://' + backend, changeOrigin: false } },
		},
		plugins: [
			{
				name: 'agent-provider-fixture',

				resolveId(id) {
					if (id === 'virtual:agent-provider-fixture') return '\0virtual:agent-provider-fixture';
				},

				load(id) {
					if (id === '\0virtual:agent-provider-fixture')
						return `
					export { createApp, h, nextTick } from 'vue';
					export { createPinia } from 'pinia';
					export { default as AgentSettingsPanel } from '/src/features/agent/settings/AgentSettingsPanel.vue';
					export { default as ProviderSettings } from '/src/features/agent/settings/ModelProviderSettings.vue';
 export { useProviderManagement } from '/src/features/agent/composables/use-provider-management.ts';
					export { default as i18n, setLocale } from '/src/app/i18n/index.ts';
					export { authenticatedSessionLifecycle } from '/src/shared/session/authenticatedSessionLifecycle.ts';
				`;
				},

				configureServer(server) {
					server.middlewares.use('/__provider', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Agent Execution fixture</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto(origin + '/__provider');
	const results = await page.evaluate(
		async ({ vendorUrl }) => {
			const api = await import('/src/features/agent/api/provider-management-api.ts');
			const { createProviderDraft } = await import('/src/features/agent/model/provider-mapper.ts');
			const { AgentManagementFailure } = await import('/src/features/agent/model/management-failure.ts');
			const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
			const {
				createApp,
				h,
				nextTick,
				createPinia,
				ProviderSettings,
				AgentSettingsPanel,
				useProviderManagement,
				i18n,
				setLocale,
				authenticatedSessionLifecycle,
			} = await import('/@id/__x00__virtual:agent-provider-fixture');
			const nativeFetch = window.fetch;
			const checks = [];
			let mounted;
			let node;
			let controller;

			const check = (value, name) => {
				if (!value) throw Error(name);
				checks.push(name);
			};

			const json = (value, status = 200) =>
				new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

			async function failure(work, code, outcome) {
				try {
					await work();
				} catch (cause) {
					check(
						cause instanceof AgentManagementFailure && cause.code === code && cause.outcome === outcome,
						code + '/' + outcome,
					);
					return;
				}
				throw Error('Expected ' + code);
			}

			async function until(predicate) {
				for (let i = 0; i < 300; i++) {
					if (predicate()) return;
					await new Promise((resolve) => setTimeout(resolve, 10));
				}
				throw Error('Provider UI did not converge: ' + node?.textContent?.slice(0, 400));
			}

			const { useNotificationStore } = await import('/src/shared/feedback/store/notification.store.ts');
			let notifications;

			const hasFeedback = (message) => notifications.notifications.some((item) => item.message.includes(message));

			function mount(component) {
				mounted?.unmount();
				node?.remove();
				node = document.createElement('div');
				document.body.append(node);
				mounted = createApp(component);
				const pinia = createPinia();
				notifications = useNotificationStore(pinia);
				mounted.use(pinia);
				mounted.use(i18n);
				mounted.mount(node);
			}

			function model() {
				return { id: 'fixture-model', contextWindow: 8192, maxOutputTokens: 512, supportsTools: true };
			}

			function draft() {
				const value = createProviderDraft(null);
				value.name = 'Local provider';
				value.baseUrl = vendorUrl + '/';
				value.models = [model()];
				return value;
			}

			try {
				await failure(() => api.listManagedProviders(), 'unauthenticated', 'confirmed');
				const access = createAccessApi();
				await access.setup({
					username: 'admin',
					password: 'provider-fixture-password',
					confirmPassword: 'provider-fixture-password',
				});
				await access.login({ username: 'admin', password: 'provider-fixture-password' });
				check((await api.listManagedProviders()).length === 0, 'real authenticated empty provider list');
				let provider = await api.saveManagedProvider(draft());
				check(
					provider.version === 1 && provider.baseUrl === vendorUrl && !provider.hasCredential,
					'real create 201, normalized endpoint, no invented credential',
				);
				check(
					provider.models[0].supportsImageInput === undefined &&
						provider.models[0].supportsFileInput === undefined,
					'unknown optional capabilities stay unknown',
				);
				check(
					provider.models[0].sources.contextWindow === 'manual' && !('protectedCredential' in provider),
					'safe application projection and capability provenance',
				);
				const edit = createProviderDraft(provider);
				edit.name = 'Renamed';
				provider = await api.saveManagedProvider(edit);
				check(provider.version === 2 && provider.name === 'Renamed', 'real PATCH retains original CAS version');
				await failure(() => api.saveManagedProvider(edit), 'version_conflict', 'confirmed');
				const credentialDraft = createProviderDraft(provider);
				credentialDraft.credential = { action: 'replace', value: 'fixture-secret' };
				provider = await api.saveManagedProvider(credentialDraft);
				check(
					provider.hasCredential && !JSON.stringify(provider).includes('fixture-secret'),
					'real credential replace never returns secret',
				);
				const keep = createProviderDraft(provider);
				keep.enabled = false;
				provider = await api.saveManagedProvider(keep);
				check(provider.hasCredential && !provider.enabled, 'keep credential and explicit enabled state');
				const clear = createProviderDraft(provider);
				clear.credential = { action: 'clear' };
				clear.enabled = true;
				provider = await api.saveManagedProvider(clear);
				check(!provider.hasCredential && provider.enabled, 'real credential clear and enable');
				const found = await api.discoverProviderEndpoint(vendorUrl, undefined);
				check(
					found.length === 2 &&
						found[0].capabilities.supportsImageInput === true &&
						found[1].capabilities === undefined,
					'real loopback endpoint discovery preserves absent observations',
				);
				await api.discoverManagedProvider(provider.id);
				provider = (await api.listManagedProviders())[0];
				check(
					provider.models[0].observation.observedAt > 1e12 &&
						provider.models[0].observation.capabilities.contextWindow === 4096 &&
						provider.models[0].conflicts.includes('contextWindow'),
					'real observation milliseconds and manual conflict',
				);
				const test = await api.testManagedProvider(provider.id, 'fixture-model');
				check(
					test.ok &&
						test.usage.inputTokens === 3 &&
						test.usage.outputTokens === 1 &&
						!('cached' in test.usage),
					'real loopback SSE connection test and exact usage',
				);
				const wire = await (await nativeFetch('/api/v1/agent/ai/providers')).json();
				window.fetch = async () => json({ ...wire[0], protectedCredential: 'private' });
				await failure(
					() => api.saveManagedProvider(createProviderDraft(provider)),
					'protocol_failure',
					'unknown',
				);
				window.fetch = async () => json({ deleted: true, extra: 'private' });
				await failure(() => api.deleteManagedProvider(provider), 'protocol_failure', 'unknown');
				window.fetch = async () => json([{ id: 'duplicate' }, { id: 'duplicate' }]);
				await failure(() => api.discoverProviderEndpoint(vendorUrl, undefined), 'protocol_failure', 'unknown');
				window.fetch = async () => json(wire[0], 200);
				await failure(() => api.saveManagedProvider(draft()), 'protocol_failure', 'unknown');
				let calls = 0;
				window.fetch = async () => {
					calls++;
					return json(wire[0], 201);
				};
				const invalid = draft();
				invalid.models[0].id = '超'.repeat(200);
				await failure(() => api.saveManagedProvider(invalid), 'invalid_input', 'not_dispatched');
				check(calls === 0, 'UTF-8 model capacity rejected before dispatch');
				const duplicate = draft();
				duplicate.models.push(model());
				await failure(() => api.saveManagedProvider(duplicate), 'invalid_input', 'not_dispatched');
				check(calls === 0, 'duplicate model IDs rejected before dispatch');
				let captured;
				window.fetch = async (_url, options) => {
					captured = JSON.parse(options.body);
					return json({ ...wire[0], version: provider.version + 1, hasCredential: true });
				};
				const secret = createProviderDraft(provider);
				secret.credential = { action: 'replace', value: '  private value  ' };
				await api.saveManagedProvider(secret);
				check(
					captured.credential === '  private value  ' &&
						!('id' in captured) &&
						!('sources' in captured.models[0]),
					'write mapper preserves secret bytes and excludes read-only fields',
				);
				window.fetch = nativeFetch;
				authenticatedSessionLifecycle.attach(1);
				mount({
					setup() {
						controller = useProviderManagement();
						return () => h('div');
					},
				});
				await until(() => !controller.busy.value && !controller.refreshRequired.value);
				let mutationCalls = 0;
				window.fetch = async (url, options) => {
					if (options.method === 'PATCH') {
						mutationCalls++;
						await nativeFetch(url, options);
						return new Response(
							new ReadableStream({
								start(stream) {
									stream.enqueue(new TextEncoder().encode('{'));
									stream.error(Error('controlled response cut'));
								},
							}),
							{ headers: { 'Content-Type': 'application/json' } },
						);
					}
					return nativeFetch(url, options);
				};
				controller.edit(controller.providers.value[0]);
				controller.draft.value.name = 'Committed then cut';
				controller.draft.value.credential = { action: 'replace', value: 'transient-secret' };
				await controller.save();
				check(
					controller.refreshRequired.value &&
						controller.notice.value === 'unknown' &&
						controller.draft.value.credential.action === 'keep',
					'write committed but response cut retains fence and clears local secret',
				);
				await controller.save();
				check(mutationCalls === 1, 'unknown does not replay provider mutation');
				window.fetch = async () => json({ code: 'storage_unavailable' }, 503);
				await controller.load();
				check(controller.refreshRequired.value, 'failed read cannot clear unknown fence');
				window.fetch = nativeFetch;
				await controller.load();
				check(
					!controller.refreshRequired.value &&
						controller.providers.value[0].name === 'Committed then cut' &&
						controller.draft.value === null,
					'explicit read recovers actual committed result without replay',
				);
				controller.edit(controller.providers.value[0]);
				controller.draft.value.name = 'Stale local draft';
				const concurrent = createProviderDraft(controller.providers.value[0]);
				concurrent.name = 'Concurrent update';
				await api.saveManagedProvider(concurrent);
				await controller.save();
				check(
					controller.notice.value === 'conflict' &&
						controller.refreshRequired.value &&
						controller.draft.value.name === 'Stale local draft',
					'CAS conflict preserves old draft and requires read',
				);
				await controller.load();
				await controller.discover(controller.providers.value[0]);
				check(
					controller.draft.value.version === controller.providers.value[0].version &&
						controller.discovered.value.length === 2 &&
						!controller.refreshRequired.value,
					'discover refreshes observations before opening an editable versioned draft',
				);
				controller.cancel();
				let release;
				window.fetch = () =>
					new Promise((resolve) => {
						release = () => resolve(json(wire));
					});
				const old = controller.load();
				await until(() => release !== undefined);
				authenticatedSessionLifecycle.logout();
				release();
				await old;
				check(
					controller.providers.value.length === 0 &&
						controller.draft.value === null &&
						!controller.busy.value,
					'revoked scope rejects late read and old finally',
				);
				window.fetch = nativeFetch;
				authenticatedSessionLifecycle.attach(1);
				await setLocale('en-US');
				mount({ render: () => h(ProviderSettings) });
				await until(
					() =>
						!Array.from(node.querySelectorAll('button')).find((b) => b.textContent === 'Add provider')
							?.disabled,
				);
				const add = Array.from(node.querySelectorAll('button')).find((b) => b.textContent === 'Add provider');
				add.click();
				await nextTick();
				const form = document.querySelector('#provider-editor');
				check(form?.closest('[role=dialog]'), 'provider creation uses the modal interaction');

				function input(label, value) {
					const el = Array.from(form.querySelectorAll('label'))
						.find((el) => el.textContent.trim().startsWith(label))
						?.querySelector('input');
					if (!el) throw Error('Missing ' + label);
					el.value = value;
					el.dispatchEvent(new Event('input', { bubbles: true }));
				}

				input('Name', 'Created from actual card');
				input('API endpoint', vendorUrl);
				Array.from(form.querySelectorAll('button'))
					.find((b) => b.textContent === 'Add model manually')
					.click();
				await nextTick();
				input('Model ID', 'ui-model');
				input('Context window', 8192);
				input('Maximum output tokens', 128);
				form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
				await nextTick();
				await until(() => hasFeedback('Provider saved.'));
				check(
					(await api.listManagedProviders()).some(
						(item) => item.name === 'Created from actual card' && item.models[0].id === 'ui-model',
					),
					'actual provider card creates persisted configuration',
				);
				for (const [locale, expected] of [
					['zh-CN', '请求失败'],
					['en-US', 'Request failed'],
					['ja-JP', 'リクエスト失敗'],
				]) {
					await setLocale(locale);
					window.fetch = async () => json({ code: 'internal_failure' }, 500);
					// Reopening mounts the real automatic read, exposing recovery only after failure.
					mount({ render: () => h(ProviderSettings) });
					await until(() => hasFeedback(expected));
					const read = Array.from(node.querySelectorAll('button')).find((b) =>
						b.textContent.includes(
							locale === 'zh-CN' ? '重新读取' : locale === 'ja-JP' ? '再読み込み' : 'Read again',
						),
					);
					read.click();
					await nextTick();
					await until(() => hasFeedback(expected));
					check(!node.textContent.includes('internal_failure'), 'localized provider safe failure ' + locale);
				}
				window.fetch = nativeFetch;
				await setLocale('en-US');
				mount({ render: () => h(AgentSettingsPanel) });
				await until(() => node.textContent.includes('Model providers') && hasFeedback('Concurrent update'));
				check(
					node.querySelector('section[aria-label="Model providers"]') &&
						node.querySelectorAll('nav button').length === 4,
					'formal panel installs provider card independently from legacy aggregate',
				);
				mounted.unmount();
				mounted = null;
				for (const item of await api.listManagedProviders()) await api.deleteManagedProvider(item);
				check((await api.listManagedProviders()).length === 0, 'real delete and empty persisted list');
				await access.logout();
				await failure(() => api.listManagedProviders(), 'unauthenticated', 'confirmed');
				return checks;
			} finally {
				window.fetch = nativeFetch;
				mounted?.unmount();
				node?.remove();
				authenticatedSessionLifecycle.dispose();
			}
		},
		{ vendorUrl },
	);
	for (const result of results) console.log('PASS ' + result);
	assert.ok(results.length >= 30);
	assert.equal(modelRequests, 1, 'only the explicitly requested loopback model test is dispatched');
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() =>
			new Promise((resolve, reject) =>
				vendor ? vendor.close((cause) => (cause ? reject(cause) : resolve())) : resolve(),
			),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) throw new AggregateError(failures, 'Provider fixture cleanup failed');
}
