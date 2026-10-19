import assert from 'node:assert/strict';
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
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-agent-registry-'));
let app;
let vite;
let browser;

try {
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve, reject) => net.close((cause) => (cause ? reject(cause) : resolve())));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'registry.db'), { encryptionKey: randomBytes(32) });
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
				name: 'agent-registry-fixture',

				resolveId(id) {
					if (id === 'virtual:agent-registry-fixture') return '\0virtual:agent-registry-fixture';
				},

				load(id) {
					if (id === '\0virtual:agent-registry-fixture')
						return `
					export { createApp, h, nextTick } from 'vue';
					export { default as RegistrySettings } from '/src/features/agent/settings/ModelRegistrySettings.vue';
					export { default as i18n, setLocale } from '/src/app/i18n/index.ts';
					export { authenticatedSessionLifecycle } from '/src/shared/session/authenticatedSessionLifecycle.ts';
				`;
				},

				configureServer(server) {
					server.middlewares.use('/__registry', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Agent Registry fixture</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto(origin + '/__registry');
	const results = await page.evaluate(async () => {
		const { getModelRegistryStatus, refreshModelRegistry, resolveModelRegistry } =
			await import('/src/features/agent/api/registry-api.ts');
		const { AgentManagementFailure } = await import('/src/features/agent/model/management-failure.ts');
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const { createApp, h, nextTick, RegistrySettings, i18n, setLocale, authenticatedSessionLifecycle } =
			await import('/@id/__x00__virtual:agent-registry-fixture');
		const nativeFetch = window.fetch;
		const checks = [];
		let mounted;
		let node;

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
			throw Error('Registry UI did not converge');
		}

		try {
			await failure(() => getModelRegistryStatus(), 'unauthenticated', 'confirmed');
			const access = createAccessApi();
			await access.setup({
				username: 'admin',
				password: 'registry-fixture-password',
				confirmPassword: 'registry-fixture-password',
			});
			await access.login({ username: 'admin', password: 'registry-fixture-password' });
			const actual = await getModelRegistryStatus();
			check(
				actual.activeSource === 'unavailable' && actual.entryCount === 0 && actual.generatedAt === null,
				'real empty registry status',
			);
			check((await resolveModelRegistry('fixture/absent')) === null, 'real no-match remains explicit null');
			let dispatched = 0;
			window.fetch = async (...args) => {
				dispatched += 1;
				return nativeFetch(...args);
			};
			await failure(() => resolveModelRegistry('界'.repeat(86)), 'invalid_input', 'not_dispatched');
			await failure(() => resolveModelRegistry('\ud800'), 'invalid_input', 'not_dispatched');
			check(dispatched === 0, 'invalid identifiers rejected before dispatch');
			const wire = {
				sourceUrl: 'https://models.dev/api.json',
				activeSource: 'remote',
				entryCount: 3,
				generatedAt: 1700000000,
				sourceRevision: 'fixture',
				lastAttemptAt: 1700000001,
				lastSuccessAt: 1700000002,
				lastErrorCode: null,
			};
			window.fetch = async () => json(wire);
			const projected = await getModelRegistryStatus();
			check(
				projected.generatedAt === 1700000000000 && projected.lastSuccessAt === 1700000002000,
				'registry seconds become application milliseconds once',
			);
			window.fetch = async () => json({ ...wire, secret: 'private' });
			await failure(() => getModelRegistryStatus(), 'protocol_failure', 'unknown');
			window.fetch = async () => json({ ...wire, lastErrorCode: 'upstream secret' });
			await failure(() => getModelRegistryStatus(), 'protocol_failure', 'unknown');
			window.fetch = async () => json({ ...wire, activeSource: 'unavailable' });
			await failure(() => getModelRegistryStatus(), 'protocol_failure', 'unknown');
			window.fetch = async () => json({ modelId: 'other', defaults: null });
			await failure(() => resolveModelRegistry('expected'), 'protocol_failure', 'unknown');
			window.fetch = async () =>
				json({
					modelId: 'expected',
					defaults: { contextWindow: 8000, maxOutputTokens: 1000, reasoningEfforts: ['high', 'high'] },
				});
			await failure(() => resolveModelRegistry('expected'), 'protocol_failure', 'unknown');
			window.fetch = async () =>
				json({ modelId: 'expected', defaults: { contextWindow: 8000, maxOutputTokens: 1000 } });
			const defaults = await resolveModelRegistry('expected');
			check(
				defaults?.contextWindow === 8000 && defaults.supportsTools === undefined,
				'missing vendor capability remains unknown',
			);
			window.fetch = async () => json({ code: 'forbidden' }, 500);
			await failure(() => refreshModelRegistry(), 'protocol_failure', 'unknown');
			window.fetch = async () => json({ code: 'operation_unknown' }, 503);
			await failure(() => refreshModelRegistry(), 'operation_unknown', 'unknown');
			window.fetch = async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('{'));
							controller.error(Error('fixture stream failure'));
						},
					}),
					{ headers: { 'Content-Type': 'application/json' } },
				);
			await failure(() => refreshModelRegistry(), 'request_failed', 'unknown');
			authenticatedSessionLifecycle.attach(1);
			setLocale('en-US');
			let writes = 0;
			window.fetch = async (_url, init) => {
				if (init?.method === 'POST') {
					writes += 1;
					return json({ code: 'operation_unknown' }, 503);
				}
				return json(wire);
			};
			node = document.createElement('div');
			document.body.append(node);
			mounted = createApp({ render: () => h(RegistrySettings) }).use(i18n);
			mounted.mount(node);
			await until(() => node.textContent.includes('3 models'));

			const buttons = () => [...node.querySelectorAll('button')];

			const read = () => buttons().find((button) => button.textContent.includes('Read current status'));

			const refresh = () => buttons().find((button) => button.textContent.includes('Update now'));

			refresh().click();
			await until(() => node.querySelector('[role="alert"]'));
			check(
				refresh().disabled && writes === 1 && !node.textContent.includes('operation_unknown'),
				'unknown refresh blocks replay and uses safe localized message',
			);
			refresh().click();
			await nextTick();
			check(writes === 1, 'disabled refresh does not replay');
			read().click();
			await until(() => !refresh().disabled && !node.querySelector('[role="alert"]'));
			check(writes === 1, 'read-only recovery never repeats mutation');
			for (const locale of ['zh-CN', 'ja-JP']) {
				setLocale(locale);
				await nextTick();
				buttons()[1].click();
				await until(() => node.querySelector('[role="alert"]'));
				check(
					node.querySelector('[role="alert"]').textContent ===
						i18n.global.t('agent.settings.providers.registryUnknown'),
					locale + ' safe unknown message',
				);
				buttons()[0].click();
				await until(() => !node.querySelector('[role="alert"]'));
			}
			setLocale('en-US');
			await nextTick();
			let release;
			let held = false;
			window.fetch = () => {
				held = true;
				return new Promise((resolve) => {
					release = () => resolve(json({ ...wire, entryCount: 99 }));
				});
			};
			read().click();
			await until(() => held);
			authenticatedSessionLifecycle.logout();
			await nextTick();
			release();
			await new Promise((resolve) => setTimeout(resolve, 30));
			check(
				!node.textContent.includes('99 models') &&
					!node.textContent.includes('3 models') &&
					!node.querySelector('[role="alert"]'),
				'late response after identity revocation cannot republish state',
			);
			mounted.unmount();
			mounted = undefined;
			node.remove();
			node = undefined;
			window.fetch = nativeFetch;
			await access.logout();
			await failure(() => getModelRegistryStatus(), 'unauthenticated', 'confirmed');
			return checks;
		} finally {
			window.fetch = nativeFetch;
			mounted?.unmount();
			node?.remove();
			authenticatedSessionLifecycle.dispose();
		}
	});
	for (const result of results) console.log('PASS ' + result);
	assert.ok(results.length >= 20);
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) throw new AggregateError(failures, 'Registry fixture cleanup failed');
}
