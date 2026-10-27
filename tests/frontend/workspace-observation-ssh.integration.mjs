import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer as createPortServer } from 'node:net';
import { once } from 'node:events';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { openSshd, send, expectStatus } from '../backend/remote/openssh-fixture.mjs';

const requirePlaywright = createRequire(new URL('../e2e/package.json', import.meta.url));
const { chromium } = requirePlaywright('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-observation-ssh-'));
let app;
let ssh;
let vite;
let browser;
let containerId;

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 20000 }).trim();

try {
	docker('info', '--format', '{{.ServerVersion}}');
	containerId = docker(
		'create',
		'--name',
		'nexus-f1-observation-' + Date.now(),
		'--label',
		'nexus.f1=observation',
		'--stop-timeout',
		'1',
		'alpine:latest',
		'sh',
		'-c',
		'trap "exit 0" TERM; while :; do sleep 0.1; done',
	);
	ssh = await openSshd(directory);
	await mkdir(join(directory, 'files'));
	const reservation = createPortServer();
	reservation.listen(0, '127.0.0.1');
	await once(reservation, 'listening');
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'state.db'), { encryptionKey: randomBytes(32) });
	const address = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	expectStatus(
		await send(
			address,
			'',
			'POST',
			'/api/v1/auth/setup',
			{
				username: 'admin',
				password: 'c2-isolated-password-123',
				confirmPassword: 'c2-isolated-password-123',
			},
			{ Host: new URL(origin).host, Origin: origin },
		),
		201,
	);
	await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
	const key = await app.targets.sshKeys.create({ name: 'C2 browser key', privateKey: ssh.privateKey });
	const targetInput = {
		name: 'C2 browser SSH',
		type: 'SSH',
		host: '127.0.0.1',
		port: ssh.port,
		username: ssh.user,
		route: 'direct',
		proxyId: null,
		tagIds: [],
		jumpIds: [],
		notes: null,
	};
	const unavailableTarget = await app.targets.create({
		...targetInput,
		name: 'C2 unavailable same-host identity',
		username: 'nexus-invalid-fixture',
	});
	assert.equal(
		(
			await app.targets.credentials.set(unavailableTarget.id, unavailableTarget.version, {
				kind: 'ssh_key',
				sshKeyId: key.id,
			})
		).status,
		'updated',
	);
	const target = await app.targets.create(targetInput);
	assert.equal(
		(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: key.id })).status,
		'updated',
	);
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
				'/api': { target: 'http://' + address },
				'/ws/workspace': { target: 'ws://' + address, ws: true },
				'/ws/uploads': { target: 'ws://' + address, ws: true },
			},
		},
		plugins: [
			{
				name: 'workspace-files-page',

				resolveId(id) {
					if (id === '/__c2_files_imports.js') {
						return id;
					}
				},

				load(id) {
					if (id === '/__c2_files_imports.js') {
						return 'export {createPinia,setActivePinia} from "pinia";';
					}
				},

				configureServer(server) {
					server.middlewares.use('/__c2_files', (_request, response) => {
						response.setHeader('Content-Type', 'text/html');
						response.end('<!doctype html><title>Workspace SSH</title>');
					});
				},
			},
		],
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage();
	await page.goto(origin + '/__c2_files');

	const results = await page.evaluate(
		async ({ target, unavailableTarget, containerId }) => {
			const { createPinia, setActivePinia } = await import('/__c2_files_imports.js');
			setActivePinia(createPinia());
			const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
			const { WorkspaceRuntimeSession } =
				await import('/src/runtimes/workspace/session/workspaceRuntimeSession.ts');
			await useAuthStore().login({ username: 'admin', password: 'c2-isolated-password-123' });
			const session = new WorkspaceRuntimeSession(target);
			session.adapters.terminal.onOutput(({ consumed }) => consumed?.());
			const checks = [];

			const expect = (value, name) => {
				if (!value) {
					throw Error(name);
				}
				checks.push(name);
			};

			const wait = async (check) => {
				const end = performance.now() + 60000;
				while (!check()) {
					if (performance.now() > end) {
						throw Error('Real observation condition timeout');
					}
					await new Promise((resolve) => setTimeout(resolve, 30));
				}
			};

			const find = () => session.dockerController.containers.value.find((row) => row.id === containerId);

			try {
				const { systemOverviewApi } = await import('/src/features/system-overview/api/system-overview-api.ts');
				const { connectionsApi } = await import('/src/features/connections/api/connections-api.ts');
				const beforeOverview = await connectionsApi.get(target.id);
				const snapshot = await systemOverviewApi.ssh(unavailableTarget);
				expect(
					snapshot.state === 'ready' &&
						snapshot.connectionId === target.id &&
						snapshot.username === target.username,
					'real resource HTTP falls back from rejected SSH identity to same-host connection',
				);
				expect(
					snapshot.status.cpuPercent !== undefined &&
						snapshot.status.memTotal > 0 &&
						snapshot.checkedAt > 1700000000000,
					'real resource HTTP returns actual Linux metrics and millisecond sample time',
				);
				const cached = await systemOverviewApi.ssh(target);
				expect(cached.checkedAt === snapshot.checkedAt, 'same-host resource HTTP reuses current server cache');
				expect(
					(await connectionsApi.get(target.id)).lastConnectedAt === beforeOverview.lastConnectedAt,
					'background resource collection does not change recent connection time',
				);
				session.statusController.activate();
				session.dockerController.setIntervalSeconds(86400);
				session.dockerController.activate();
				await session.connect();
				await wait(() => session.statusController.current.value !== null);
				const sample = session.statusController.current.value;
				expect(
					Number.isFinite(sample.timestamp) && sample.timestamp > 1700000000000,
					'real status timestamp is Unix milliseconds',
				);
				expect(
					sample.cpuPercent !== undefined && sample.memUsed !== undefined,
					'real Linux sample traverses Shared to application state',
				);
				expect(
					session.statusController.history.value.cpu.length > 0,
					'real subscription updates bounded history',
				);
				await session.dockerController.refresh();
				expect(
					session.dockerController.available.value && find()?.state === 'created',
					'real Docker list reaches formal controller',
				);
				expect(
					typeof find()?.labels === 'string' && find().labels.includes('nexus.f1=observation'),
					'real Docker labels preserve native representation',
				);
				await session.dockerController.command(containerId, 'start');
				expect(
					find()?.state === 'running' && !session.dockerController.commandPending.value,
					'real start confirmed and current state refreshed',
				);
				const stats = await session.adapters.docker.getStats(containerId);
				expect(
					stats !== null && (stats.id === containerId || stats.id === containerId.slice(0, 12)),
					'real stats verifies requested full/short identifier',
				);
				await session.dockerController.command(containerId, 'restart');
				expect(find()?.state === 'running', 'real restart confirmed');
				await session.dockerController.command(containerId, 'stop');
				expect(find()?.state === 'exited', 'real stop confirmed');
				await session.dockerController.command(containerId, 'remove');
				expect(
					!find() && !session.dockerController.commandBlocked.value,
					'real remove confirmed without unknown',
				);
				session.statusController.deactivate();
				await new Promise((resolve) => setTimeout(resolve, 100));
				const sequence = session.statusController.history.value.cpu.length;
				await new Promise((resolve) => setTimeout(resolve, 3500));
				expect(
					session.statusController.history.value.cpu.length === sequence,
					'deactivation stops original status delivery',
				);
				expect((await session.close()) === 'closed', 'real workspace closes after observation cleanup');
				return checks;
			} finally {
				await session.dispose();
			}
		},
		{ target, unavailableTarget, containerId },
	);
	const remaining = docker('ps', '-a', '--filter', 'id=' + containerId, '--format', '{{.ID}}');
	assert.equal(remaining, '', 'real container removed on daemon');
	containerId = undefined;
	console.log(
		'Formal observation / real Access, Backend-next, OpenSSH and Docker: ' +
			results.length +
			' browser checks and daemon removal PASS',
	);
	console.log(results.join('\n'));
} finally {
	const failures = [];
	// Close consumers before producers and their owned directories.
	for (const close of [() => browser?.close(), () => vite?.close(), () => app?.close(), () => ssh?.close()]) {
		try {
			await close();
		} catch (error) {
			failures.push(error);
		}
	}
	if (containerId) {
		try {
			docker('rm', '-f', containerId);
		} catch (error) {
			failures.push(error);
		}
	}
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (error) {
		failures.push(error);
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Workspace SSH fixture cleanup failed');
	}
}
