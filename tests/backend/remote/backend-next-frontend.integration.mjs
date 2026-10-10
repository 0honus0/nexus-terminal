import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../../../packages/backend-next/dist/bootstrap/create-app.js';

const requirePlaywright = createRequire(new URL('../../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');

async function unusedPort() {
	const server = createServer();
	server.listen(0, '127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));
	const port = server.address().port;
	await new Promise((resolve) => server.close(resolve));
	return port;
}

async function waitForFrontend(origin, child) {
	for (let attempt = 0; attempt < 120; attempt++) {
		if (child.exitCode !== null) {
			throw new Error('Frontend development server exited: ' + child.exitCode);
		}
		try {
			const response = await fetch(origin);
			if (response.ok) {
				return;
			}
		} catch {
			// The development server has not begun listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error('Frontend development server did not start');
}

const root = await mkdtemp(join(tmpdir(), 'next-browser-remote-'));
const port = await unusedPort();
const origin = 'http://127.0.0.1:' + port;
let app;
let frontend;
let browser;
try {
	app = await createApp(join(root, 'browser.db'), { encryptionKey: randomBytes(32) });
	const backendOrigin = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: [],
	});
	const target = await app.targets.create({
		name: 'Failure-retry fixture',
		type: 'SSH',
		host: '127.0.0.1',
		port: 1,
		username: 'tester',
		route: 'direct',
		proxyId: null,
		tagIds: [],
		jumpIds: [],
		notes: null,
		rdpRemoteApp: null,
		rdpRemoteAppDirectory: null,
		rdpRemoteAppArguments: null,
	});
	await app.targets.credentials.set(target.id, target.version, {
		kind: 'password',
		password: 'fixture-secret',
	});
	// Own the Vite process directly so cleanup does not leave a pnpm child alive.
	frontend = spawn(
		process.execPath,
		['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
		{
			cwd: join(process.cwd(), 'packages/frontend'),
			env: { ...process.env, NEXUS_VITE_BACKEND_NEXT_ORIGIN: 'http://' + backendOrigin },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	const output = [];
	frontend.stdout.on('data', (buffer) => output.push(buffer.toString()));
	frontend.stderr.on('data', (buffer) => output.push(buffer.toString()));
	await waitForFrontend(origin, frontend).catch((error) => {
		console.error('Frontend startup diagnostics:', output.join('').slice(-2500));
		throw error;
	});

	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const context = await browser.newContext();
	await context.addInitScript(() => {
		const NativeObserver = window.ResizeObserver;
		window.__remoteObserverState = { observed: 0 };
		window.ResizeObserver = class extends NativeObserver {
			#observed = false;

			observe(...args) {
				if (!this.#observed) {
					this.#observed = true;
					window.__remoteObserverState.observed += 1;
				}
				return super.observe(...args);
			}

			disconnect() {
				if (this.#observed) {
					this.#observed = false;
					window.__remoteObserverState.observed -= 1;
				}
				return super.disconnect();
			}
		};
	});
	const setup = await context.request.post(origin + '/__next/api/v1/auth/setup', {
		data: { username: 'admin', password: 'fixture-password-123', confirmPassword: 'fixture-password-123' },
	});
	assert.equal(setup.status(), 201, await setup.text());
	const login = await context.request.post(origin + '/__next/api/v1/auth/login', {
		data: { username: 'admin', password: 'fixture-password-123', rememberMe: false },
	});
	assert.equal(login.status(), 200, await login.text());
	const page = await context.newPage();
	await page.goto(origin + '/__targets-next');
	await page.locator('select').selectOption(String(target.id), { timeout: 12000 });
	const open = page.getByRole('button', { name: /Open SSH terminal|打开 SSH 终端|SSH ターミナル/i });
	const baseline = await page.evaluate(() => window.__remoteObserverState.observed);
	for (let attempt = 0; attempt < 2; attempt++) {
		await open.click();
		await page.getByRole('alert').waitFor({ timeout: 18000 });
		await page.waitForFunction(
			(expected) => window.__remoteObserverState.observed === expected && !document.querySelector('.xterm'),
			baseline,
			{ timeout: 12000 },
		);
		const text = await page.getByRole('alert').textContent();
		assert.ok(text && text.length > 4 && !text.includes('remote_unavailable'));
	}
	await page.close();
	await context.close();
	console.log('Real browser failed-open/retry: xterm and ResizeObserver reclaimed PASS');
} finally {
	if (browser) await browser.close();
	if (frontend) {
		frontend.kill('SIGTERM');
		await Promise.race([
			new Promise((resolve) => frontend.once('exit', resolve)),
			new Promise((resolve) => setTimeout(resolve, 1500)),
		]);
		if (frontend.exitCode === null) frontend.kill('SIGKILL');
	}
	if (app) await app.close();
	await rm(root, { recursive: true, force: true });
}
