import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
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
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-suspend-ssh-'));
let app;
let ssh;
let vite;
let browser;
try {
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
	const target = await app.targets.create({
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
	});
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
					if (id === '/__c2_files_imports.js') return id;
				},

				load(id) {
					if (id === '/__c2_files_imports.js') return 'export {createPinia,setActivePinia} from "pinia";';
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
		async ({ target, root }) => {
			const { createPinia, setActivePinia } = await import('/__c2_files_imports.js');
			setActivePinia(createPinia());
			const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
			const { WorkspaceRuntimeSession } =
				await import('/src/runtimes/workspace/session/workspaceRuntimeSession.ts');
			await useAuthStore().login({ username: 'admin', password: 'c2-isolated-password-123' });
			const sessions = [],
				checks = [];

			const expect = (condition, name) => {
				if (!condition) throw Error(name);
				checks.push(name);
			};

			const wait = async (check) => {
				const end = performance.now() + 20000;
				while (!(await check())) {
					if (performance.now() > end) throw Error('SSH condition timed out');
					await new Promise((resolve) => setTimeout(resolve, 30));
				}
			};

			const make = () => {
				const session = new WorkspaceRuntimeSession(target);
				session.adapters.terminal.onOutput(({ consumed }) => consumed?.());
				sessions.push(session);
				return session;
			};

			const read = async (session, path) => {
				try {
					return (await session.adapters.documents.load(path, 'utf8')).content;
				} catch {
					return undefined;
				}
			};

			try {
				const original = make();
				await original.connect();
				await wait(async () => {
					try {
						await original.adapters.filesystem.stat(root);
						return true;
					} catch {
						return false;
					}
				});
				const id = await original.markForSuspend(async () => 'saved terminal snapshot');
				await wait(() => original.ownershipGeneration !== undefined);
				expect(original.markedForSuspend.value, 'real prepare/commit marks existing PTY');
				original.adapters.terminal.sendInput(
					"echo $$ > '" +
						root +
						"/before.pid'; head -c 786432 /dev/zero | tr '\\000' 'H'; echo done > '" +
						root +
						"/output.done'\n",
				);
				await wait(async () => (await read(original, root + '/output.done')) === 'done\n');
				const before = await read(original, root + '/before.pid');
				expect(
					(await original.close()) === 'detached',
					'closing marked tab detaches instead of terminating PTY',
				);
				await original.dispose();
				const restored = make();
				const result = await restored.resume(id);
				expect(
					restored.state.value === 'connected' && result.suspendedSessionId === id,
					'formal Session restores through explicit ACK against real Backend',
				);
				await wait(async () => {
					try {
						await restored.adapters.filesystem.stat(root);
						return true;
					} catch {
						return false;
					}
				});
				restored.adapters.terminal.sendInput("echo $$ > '" + root + "/after.pid'\n");
				await wait(async () => Boolean(await read(restored, root + '/after.pid')));
				expect(
					(await read(restored, root + '/after.pid')) === before,
					'restored terminal preserves original SSH shell PID',
				);
				const reset = await restored.adapters.terminal.resetPreviousOutput();
				expect(reset, 'real history reset reports retained previous bytes');
				const history = await restored.adapters.terminal.loadPreviousOutput(4096);
				expect(
					history !== null && history.data.length > 0 && history.data.length <= 4096,
					'formal terminal consumes bounded NXW1 history page',
				);
				const takeover = make();
				await takeover.resume(id, undefined, { takeover: true });
				await wait(() => !restored.socket.connected);
				expect(
					restored.recoveryRequired.value && takeover.state.value === 'connected',
					'real takeover revokes original attachment and activates only new owner',
				);
				await wait(() => takeover.ownershipGeneration !== undefined);
				await takeover.unmarkSuspend();
				expect(!takeover.markedForSuspend.value, 'real unmark clears retained ownership');
				expect((await takeover.close()) === 'closed', 'unmarked close confirms remote workspace termination');
				return checks;
			} finally {
				await Promise.all(sessions.map((session) => session.dispose()));
			}
		},
		{ target, root: join(directory, 'files') },
	);
	assert.equal(
		await readFile(join(directory, 'files', 'before.pid'), 'utf8'),
		await readFile(join(directory, 'files', 'after.pid'), 'utf8'),
	);
	console.log(
		'Formal Suspend / real Access, Backend-next, OpenSSH: ' +
			results.length +
			' browser checks and shell PID check PASS',
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
	try {
		await rm(directory, { recursive: true, force: true });
	} catch (error) {
		failures.push(error);
	}
	if (failures.length) throw new AggregateError(failures, 'Workspace SSH fixture cleanup failed');
}
