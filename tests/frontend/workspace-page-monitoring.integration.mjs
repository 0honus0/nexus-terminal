import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { openSshd } from '../backend/remote/openssh-fixture.mjs';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-monitoring-page-'));
const checks = [];
let app;
let vite;
let browser;
let ssh;

async function until(read, accepts, description) {
	const deadline = performance.now() + 15000;
	let value;
	do {
		value = await read();
		if (accepts(value)) {
			return value;
		}
		await new Promise((resolve) => setTimeout(resolve, 30));
	} while (performance.now() < deadline);
	assert.fail(description + ': ' + JSON.stringify(value));
}

try {
	ssh = await openSshd(directory);
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve) => net.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'app.db'), {
		encryptionKey: randomBytes(32),

		configuration: () => ({
			ipWhitelist: '',
			ipBlacklistEnabled: false,
			maxLoginAttempts: 10,
			loginBanDuration: 60,
			statusMonitorIntervalSeconds: 1,
			remoteHostRefreshIntervalSeconds: 5,
			passkeys: [],
			captcha: { enabled: false, provider: 'hcaptcha', siteKey: '', secretKey: '', expectedHostname: null },
		}),
	});
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
			proxy: {
				'/api': { target: 'http://' + address, changeOrigin: false },
				'/ws/workspace': { target: 'ws://' + address, ws: true, changeOrigin: false },
				'/ws/uploads': { target: 'ws://' + address, ws: true, changeOrigin: false },
			},
		},
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ acceptDownloads: true });
	const controls = [];
	page.on('websocket', (socket) => {
		if (!socket.url().includes('/ws/workspace')) return;
		socket.on('framesent', ({ payload }) => {
			if (typeof payload === 'string') controls.push(JSON.parse(payload));
		});
	});
	page.setDefaultTimeout(15000);
	await page.goto(origin + '/login');
	await page.evaluate(
		async ({ port, user }) => {
			const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
			const api = createAccessApi();
			await api.setup({
				username: 'admin',
				password: 'Workspace-page-fixture-2026!',
				confirmPassword: 'Workspace-page-fixture-2026!',
			});
			await api.login({ username: 'admin', password: 'Workspace-page-fixture-2026!', rememberMe: false });
			const { connectionsApi } = await import('/src/features/connections/api/connections-api.ts');
			const result = await connectionsApi.importMany([
				{
					connection: {
						name: 'Full page SSH',
						type: 'SSH',
						host: '127.0.0.1',
						port,
						username: user,
						route: 'direct',
						proxyId: null,
						notes: null,
						tagIds: [],
						jumpIds: [],
					},
				},
			]);
			if (result[0].status !== 'ok') {
				throw Error('Fixture target creation failed');
			}
		},
		{ port: ssh.port, user: ssh.user },
	);
	await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
	const key = await app.targets.sshKeys.create({ name: 'Full page key', privateKey: ssh.privateKey });
	const target = (await app.targets.list())[0];
	assert.equal(
		(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: key.id })).status,
		'updated',
	);
	await page.goto(origin + '/workspace?connectionId=' + target.id);
	await page.locator('[data-session-state="connected"]').waitFor();
	await page.evaluate(async () => {
		const { setLocale } = await import('/src/app/i18n/index.ts');
		setLocale('en-US');
	});

	const history = await until(
		() =>
			page.evaluate(async () => {
				const { workspaceRuntimeRegistry } =
					await import('/src/runtimes/workspace/session/workspaceRuntimeRegistry.ts');
				return workspaceRuntimeRegistry.activeSession.value.statusController.history.value.cpu.map((item) => ({
					time: item.time,
					value: item.value,
				}));
			}),
		(items) => items.length >= 3,
		'Formal status samples',
	);
	assert.ok(history.length >= 3);
	for (let index = 1; index < history.length; index++) {
		assert.ok(history[index].time > history[index - 1].time);
		assert.ok(history[index].time - history[index - 1].time >= 800);
	}
	await page.getByRole('button', { name: /^CPU / }).first().waitFor();
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	checks.push(
		'formal Workspace status component drives actual one-second Linux sampling with real millisecond timestamps',
	);

	const resourceResponses = [];
	const pendingResponses = new Set();
	page.on('response', (response) => {
		if (!response.url().includes('/api/v1/system/ssh-resources/')) return;
		const pending = response
			.json()
			.then((value) => resourceResponses.push(value))
			.finally(() => pendingResponses.delete(pending));
		pendingResponses.add(pending);
		void pending.catch(() => undefined);
	});
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Dashboard' });
	});
	await until(
		() => Promise.resolve(resourceResponses),
		(items) => items.length > 0 && items[0].status,
		'Formal dashboard real SSH sample',
	);
	const firstResource = resourceResponses[0];
	assert.ok(firstResource.status.memTotal > 0);
	const remoteCard = page.locator('.dashboard-connection-card').filter({ hasText: 'Full page SSH' });
	await remoteCard.waitFor();
	assert.match(await remoteCard.innerText(), /CPU/);
	const cached = await page.evaluate(async (target) => {
		const { systemOverviewApi } = await import('/src/features/system-overview/api/system-overview-api.ts');
		return systemOverviewApi.ssh(target);
	}, target);
	assert.equal(cached.checkedAt, firstResource.checkedAt);
	await until(
		() => Promise.resolve(resourceResponses),
		(items) => items.some((item) => item.checkedAt > firstResource.checkedAt && item.status),
		'Natural five-second Dashboard TTL and actual recollection',
	);
	checks.push(
		'formal Dashboard renders actual SSH metrics, reuses a live cache and naturally recollects after its five-second TTL',
	);

	const pausedHistory = await page.evaluate(async () => {
		const { workspaceRuntimeRegistry } =
			await import('/src/runtimes/workspace/session/workspaceRuntimeRegistry.ts');
		const session = workspaceRuntimeRegistry.activeSession.value;
		return { sessionId: session.id, count: session.statusController.history.value.cpu.length };
	});
	await new Promise((resolve) => setTimeout(resolve, 2200));
	const afterPause = await page.evaluate(async () => {
		const { workspaceRuntimeRegistry } =
			await import('/src/runtimes/workspace/session/workspaceRuntimeRegistry.ts');
		const session = workspaceRuntimeRegistry.activeSession.value;
		return { sessionId: session.id, count: session.statusController.history.value.cpu.length };
	});
	assert.deepEqual(afterPause, pausedHistory);
	assert.ok(controls.some((item) => item.type === 'status.stop'));
	checks.push('KeepAlive leaving Workspace stops its real status subscription while preserving the original session');

	let projection = 'missing';
	await page.route('**/api/v1/system/ssh-resources/*', (route) =>
		route.fulfill({
			json: {
				key: firstResource.key,
				connectionId: target.id,
				name: 'Full page SSH',
				username: target.username,
				host: target.host,
				port: target.port,
				checkedAt: Date.now(),
				status:
					projection === 'missing'
						? { timestamp: Date.now() }
						: {
								timestamp: Date.now(),
								cpuPercent: 0,
								memPercent: 0,
								memUsed: 0,
								memTotal: 100,
								diskPercent: 0,
								diskUsed: 0,
								diskTotal: 100,
							},
			},
		}),
	);

	async function revisitDashboard() {
		await page.evaluate(async () => {
			const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router;
			await router.push({ name: 'Settings' });
			await router.push({ name: 'Dashboard' });
		});
	}

	await revisitDashboard();
	await until(
		() => remoteCard.innerText(),
		(value) => value.includes('—'),
		'Missing metric displayed as absent',
	);
	assert.equal((await remoteCard.innerText()).includes('0%'), false);
	projection = 'zero';
	await revisitDashboard();
	await until(
		() => remoteCard.innerText(),
		(value) => value.includes('0%'),
		'Actual zero rendered separately',
	);
	assert.equal((await remoteCard.innerText()).includes('—'), false);
	checks.push(
		'controlled formal Dashboard metric projection distinguishes missing measurements from explicit zero values',
	);
	await page.unroute('**/api/v1/system/ssh-resources/*');
	await Promise.allSettled([...pendingResponses]);
	console.log('Formal monitoring: ' + checks.length + ' checks PASS\n' + checks.join('\n'));
} catch (cause) {
	console.error('Completed checks', checks);
	console.error(cause);
	throw cause;
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() => ssh?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Workspace formal files fixture cleanup failed');
	}
}
