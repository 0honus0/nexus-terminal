import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-notifications-'));
const checks = [];
const calls = [];
const webhook = createHttpServer(async (request, response) => {
	const chunks = [];
	for await (const chunk of request) {
		chunks.push(chunk);
	}
	calls.push({
		path: request.url,
		header: request.headers['x-fixture-secret'],
		body: Buffer.concat(chunks).toString('utf8'),
	});
	response.writeHead(200, { 'Content-Type': 'application/json' });
	response.end('{"ok":true}');
});
let app;
let vite;
let browser;
let releaseUnknown;
let releaseRead;
try {
	await new Promise((resolve) => webhook.listen(0, '127.0.0.1', resolve));
	const webhookOrigin = 'http://127.0.0.1:' + webhook.address().port;
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve) => net.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'app.db'), { encryptionKey: randomBytes(32) });
	const address = await app.listenHttp({
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
			proxy: { '/api': { target: 'http://' + address, changeOrigin: false } },
		},
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	page.setDefaultTimeout(15000);
	await page.goto(origin + '/login');
	await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const api = createAccessApi();
		await api.setup({
			username: 'admin',
			password: 'Notification-fixture-2026!',
			confirmPassword: 'Notification-fixture-2026!',
		});
		await api.login({ username: 'admin', password: 'Notification-fixture-2026!', rememberMe: false });
	});
	await page.reload();
	await page.locator('.app-header a.nav-link[href="/"]').waitFor();
	const apiChecks = await page.evaluate(async (webhookOrigin) => {
		const { notificationsApi: api } = await import('/src/features/notifications/api/notifications-api.ts');
		const { useNotificationsStore } = await import('/src/features/notifications/store/notifications.store.ts');
		const { OperationsRequestFailure } = await import('/src/client/operations/operations-request.ts');
		const checks = [];

		const fail = (message) => {
			throw Error(message);
		};

		async function rejects(work, code, outcome) {
			try {
				await work();
			} catch (cause) {
				if (cause instanceof OperationsRequestFailure && cause.code === code && cause.outcome === outcome) {
					return;
				}
				throw cause;
			}
			fail('Expected failure ' + code);
		}

		const store = useNotificationsStore();
		await store.load(true);
		const change = {
			name: 'API webhook',
			enabled: false,
			events: ['LOGIN_SUCCESS'],
			config: {
				kind: 'webhook',
				url: webhookOrigin + '/saved',
				method: 'POST',
				headers: [{ name: 'X-Fixture-Secret', value: { action: 'replace', value: 'local-fixture-value' } }],
				bodyTemplate: null,
			},
		};
		const initial = await store.save(change, null);
		if (
			initial.version !== 1 ||
			initial.config.kind !== 'webhook' ||
			initial.config.headers[0]?.hasValue !== true ||
			'value' in initial.config.headers[0]
		) {
			fail('Unsafe webhook view');
		}
		change.name = 'API webhook kept';
		change.config.headers[0].value = { action: 'keep' };
		const kept = await store.save(change, { id: initial.id, version: initial.version });
		if (kept.version !== 2 || !kept.config.headers[0]?.hasValue) {
			fail('Keep secret failed');
		}
		await rejects(
			() => store.save(change, { id: initial.id, version: initial.version }),
			'version_conflict',
			'confirmed',
		);
		if (!store.needsRefresh) {
			fail('CAS fence missing');
		}
		await rejects(() => store.save(change, null), 'refresh_required', 'not_dispatched');
		await store.load(true);
		checks.push('real Shared notification CRUD uses UUID/original CAS and explicit keep without returning secrets');
		checks.push('stale CAS fences later writes until explicit read; no cached version replaces the edit version');

		const email = {
			name: 'API email',
			enabled: false,
			events: [],
			config: {
				kind: 'email',
				to: 'to@fixture.invalid',
				from: 'from@fixture.invalid',
				host: '127.0.0.1',
				port: 2525,
				secure: false,
				username: 'fixture',
				password: { action: 'replace', value: 'fixture-password' },
				bodyTemplate: null,
			},
		};
		const savedEmail = await api.create(email);
		if (savedEmail.config.kind !== 'email' || !savedEmail.config.hasPassword || 'password' in savedEmail.config) {
			fail('Unsafe email view');
		}
		email.config.password = { action: 'clear' };
		const cleared = await api.update(savedEmail.id, savedEmail.version, email);
		if (cleared.config.hasPassword) {
			fail('Clear password failed');
		}
		await rejects(() => api.remove(savedEmail.id, savedEmail.version), 'version_conflict', 'confirmed');
		await api.remove(cleared.id, cleared.version);
		checks.push('email secrets replace/clear explicitly, safe views hide values and DELETE preserves original CAS');

		const telegram = await api.create({
			name: 'API Telegram',
			enabled: false,
			events: [],
			config: {
				kind: 'telegram',
				origin: webhookOrigin,
				chatId: 'fixture-chat',
				botToken: { action: 'replace', value: '123:fixture_token' },
				bodyTemplate: '{event}/{subjectId}/{time}',
			},
		});
		if (telegram.config.kind !== 'telegram' || !telegram.config.hasBotToken || 'botToken' in telegram.config) {
			fail('Unsafe Telegram view');
		}
		await api.remove(telegram.id, telegram.version);
		checks.push('Telegram uses explicit origin/chat/token actions and returns only the token presence flag');

		await rejects(() => api.remove('1', 1), 'invalid_input', 'not_dispatched');
		await rejects(() => api.deliveries(0, 201), 'invalid_input', 'not_dispatched');
		const savedTest = await api.testSaved(kept.id);
		const unsavedTest = await api.testUnsaved({
			kind: 'webhook',
			url: webhookOrigin + '/unsaved',
			method: 'POST',
			headers: [],
			bodyTemplate: '{event}',
		});
		if (
			savedTest.status !== 'queued' ||
			unsavedTest.status !== 'queued' ||
			savedTest.settingId !== kept.id ||
			unsavedTest.settingId !== null
		) {
			fail('Test acceptance correlation');
		}
		const deadline = Date.now() + 10000;
		let delivered = [];
		while (Date.now() < deadline) {
			delivered = (await api.deliveries(0, 200)).items.filter(
				(item) => item.id === savedTest.id || item.id === unsavedTest.id,
			);
			if (delivered.length === 2 && delivered.every((item) => item.status === 'sent')) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		if (delivered.length !== 2 || !delivered.every((item) => item.status === 'sent')) {
			fail('Local webhook not delivered');
		}
		const first = await api.deliveries(0, 1);
		if (first.items.length !== 1 || first.nextOffset !== 1) {
			fail('Delivery first page');
		}
		const second = await api.deliveries(first.nextOffset, 1);
		if (second.items.length !== 1 || second.items[0].id === first.items[0].id) {
			fail('Delivery cursor');
		}
		checks.push(
			'saved/unsaved tests return correlated queued receipts; real local webhook completion is read separately',
		);
		checks.push(
			'delivery pagination consumes server nextOffset; invalid UUID/capacity are rejected before dispatch',
		);
		return checks;
	}, webhookOrigin);
	checks.push(...apiChecks);
	assert.equal(calls.filter((call) => call.path === '/saved').length, 1);
	assert.equal(calls.find((call) => call.path === '/saved').header, 'local-fixture-value');
	assert.equal(calls.filter((call) => call.path === '/unsaved').length, 1);

	let writes = 0;
	let unknownStarted;
	const unknownReady = new Promise((resolve) => {
		unknownStarted = resolve;
	});
	await page.route('**/api/v1/settings/notifications', async (route) => {
		if (route.request().method() !== 'POST') {
			return route.fallback();
		}
		writes++;
		await route.fetch();
		unknownStarted();
		await new Promise((resolve) => {
			releaseUnknown = resolve;
		});
		await route.abort().catch(() => undefined);
	});
	await page.evaluate(async (webhookOrigin) => {
		const { useNotificationsStore } = await import('/src/features/notifications/store/notifications.store.ts');
		const store = useNotificationsStore();
		await store.load(true);
		const write = store
			.save(
				{
					name: 'Lost response fixture',
					enabled: false,
					events: [],
					config: {
						kind: 'webhook',
						url: webhookOrigin + '/unknown',
						method: 'POST',
						headers: [],
						bodyTemplate: null,
					},
				},
				null,
			)
			.catch((error) => error);
		const prematureRecovery = store.load(true).catch((error) => error);
		window.notificationUnknown = Promise.all([write, prematureRecovery]);
	}, webhookOrigin);
	await unknownReady;
	releaseUnknown();
	const unknown = await page.evaluate(async () => {
		const { OperationsRequestFailure } = await import('/src/client/operations/operations-request.ts');
		const { useNotificationsStore } = await import('/src/features/notifications/store/notifications.store.ts');
		const store = useNotificationsStore();
		const [write, read] = await window.notificationUnknown;
		let blocked;
		try {
			await store.testSaved(store.items[0].id);
		} catch (cause) {
			blocked = cause;
		}
		const correct =
			write instanceof OperationsRequestFailure &&
			write.outcome === 'unknown' &&
			read instanceof OperationsRequestFailure &&
			read.code === 'refresh_required' &&
			blocked instanceof OperationsRequestFailure &&
			blocked.outcome === 'not_dispatched' &&
			store.needsRefresh;
		await store.load(true);
		return { correct, count: store.items.filter((item) => item.name === 'Lost response fixture').length };
	});
	assert.deepEqual(unknown, { correct: true, count: 1 });
	assert.equal(writes, 1);
	checks.push(
		'real commit with lost response retains unknown, blocks resend and rejects recovery requested before the fault',
	);
	await page.unroute('**/api/v1/settings/notifications');

	let readStarted;
	const readReady = new Promise((resolve) => {
		readStarted = resolve;
	});
	let cancelledWrites = 0;
	await page.route('**/api/v1/settings/notifications', async (route) => {
		if (route.request().method() === 'POST') {
			cancelledWrites++;
			return route.fallback();
		}
		if (route.request().method() !== 'GET') {
			return route.fallback();
		}
		const response = await route.fetch();
		readStarted();
		await new Promise((resolve) => {
			releaseRead = resolve;
		});
		await route.fulfill({ response }).catch(() => undefined);
	});
	await page.evaluate((webhookOrigin) => {
		return import('/src/features/notifications/store/notifications.store.ts').then(({ useNotificationsStore }) => {
			const store = useNotificationsStore();
			const controller = new AbortController();
			const read = store.load(true);
			const write = store
				.save(
					{
						name: 'Never dispatched',
						enabled: false,
						events: [],
						config: {
							kind: 'webhook',
							url: webhookOrigin,
							method: 'POST',
							headers: [],
							bodyTemplate: null,
						},
					},
					null,
					controller.signal,
				)
				.catch((error) => error);
			controller.abort();
			window.notificationQueued = Promise.all([read, write]);
		});
	}, webhookOrigin);
	await readReady;
	releaseRead();
	const cancelled = await page.evaluate(async () => {
		const { OperationsRequestFailure } = await import('/src/client/operations/operations-request.ts');
		const [, error] = await window.notificationQueued;
		return (
			error instanceof OperationsRequestFailure &&
			error.code === 'cancelled' &&
			error.outcome === 'not_dispatched'
		);
	});
	assert.equal(cancelled, true);
	assert.equal(cancelledWrites, 0);
	checks.push('cancelled view intent behind a real settings read never dispatches its queued side effect');
	await page.unroute('**/api/v1/settings/notifications');

	await page.route('**/api/v1/settings/notifications', (route) => route.fulfill({ json: [] }), { times: 1 });
	const oldResponse = await page.evaluate(async () => {
		const { notificationsApi } = await import('/src/features/notifications/api/notifications-api.ts');
		const { OperationsRequestFailure } = await import('/src/client/operations/operations-request.ts');
		try {
			await notificationsApi.list();
		} catch (cause) {
			return cause instanceof OperationsRequestFailure && cause.code === 'protocol_failure';
		}
		return false;
	});
	assert.equal(oldResponse, true);
	checks.push('legacy bare notification arrays are protocol errors, with no compatibility branch');

	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/notifications');
	});
	await page.getByRole('button', { name: 'Add Notification Channel', exact: true }).waitFor();
	await page.waitForFunction(async () => {
		const { useNotificationsStore } = await import('/src/features/notifications/store/notifications.store.ts');
		const store = useNotificationsStore();
		return !store.loading && !store.needsRefresh;
	});
	await page.getByRole('button', { name: 'Add Notification Channel', exact: true }).click();
	await page.locator('#setting-name').fill('Formal UI webhook');
	await page.locator('#webhook-url').fill(webhookOrigin + '/formal');
	await page.locator('form button[type=submit]').click();
	await page.getByText('Formal UI webhook', { exact: true }).waitFor();
	assert.equal(await page.locator('#setting-name').count(), 0);
	checks.push(
		'formal Notifications route creates a Shared webhook through the actual form and closes confirmed drafts',
	);

	const card = page.locator('[data-notification-id]').filter({ hasText: 'API webhook kept' });
	await card.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.getByText('Saved value exists', { exact: true }).waitFor();
	assert.equal(await page.locator('form input[type=password]').count(), 0);
	await page.locator('form').getByRole('button', { name: 'Test saved configuration', exact: true }).click();
	await page.locator('.ui-notification[data-kind="info"]').filter({ hasText: 'Queued' }).waitFor();
	await page.locator('form').getByRole('button', { name: 'Cancel', exact: true }).click();
	checks.push('formal edit shows presence only; saved test reports queued rather than falsely reporting sent');

	await page.evaluate(async () => {
		const { default: i18n } = await import('/src/app/i18n/index.ts');
		for (const locale of ['en-US', 'zh-CN', 'ja-JP']) {
			for (const key of [
				'settings.notifications.unknown',
				'settings.notifications.refresh',
				'settings.notifications.form.keepSecret',
				'settings.notifications.deliveryStatus.unknown',
			]) {
				if (!i18n.global.te(key, locale)) {
					throw Error('Missing notification translation ' + locale + '/' + key);
				}
			}
		}
		const { useNotificationsStore } = await import('/src/features/notifications/store/notifications.store.ts');
		useNotificationsStore().reset();
	});
	assert.equal(await page.locator('[data-notification-id]').count(), 0);
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	checks.push('three locales expose safe recovery/delivery text and auth reset clears the configuration cache');
	console.log('Notifications: ' + checks.length + ' checks PASS\n' + checks.join('\n'));
} finally {
	releaseUnknown?.();
	releaseRead?.();
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() =>
			new Promise((resolve, reject) => {
				webhook.close((error) => (error ? reject(error) : resolve()));
				webhook.closeAllConnections();
			}),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Notification fixture cleanup failed');
	}
}
