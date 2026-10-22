import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
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
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-ssh-'));
let app;
let ssh;
let vite;
let browser;
try {
	ssh = await openSshd(directory);
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
			},
		},
		plugins: [
			{
				name: 'workspace-ssh-page',

				resolveId(id) {
					if (id === '/__c2_ssh_imports.js') return id;
				},

				load(id) {
					if (id === '/__c2_ssh_imports.js') return 'export {createPinia,setActivePinia} from "pinia";';
				},

				configureServer(server) {
					server.middlewares.use('/__c2_ssh', (_request, response) => {
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
	await page.goto(origin + '/__c2_ssh');
	const results = await page.evaluate(async (target) => {
		const { createPinia, setActivePinia } = await import('/__c2_ssh_imports.js');
		setActivePinia(createPinia());
		const { useAuthStore } = await import('/src/features/auth/store/auth.store.ts');
		const { WorkspaceRuntimeSession } = await import('/src/runtimes/workspace/session/workspaceRuntimeSession.ts');
		const password = 'c2-isolated-password-123';
		await useAuthStore().login({ username: 'admin', password });
		const session = new WorkspaceRuntimeSession(target);
		const result = [];
		let output = '';
		const decoder = new TextDecoder();
		const off = session.adapters.terminal.onOutput(({ data, consumed }) => {
			output += decoder.decode(data, { stream: true });
			consumed?.();
		});

		const expect = (condition, name) => {
			if (!condition) throw Error(name);
			result.push(name);
		};

		const until = async (check, name) => {
			const deadline = performance.now() + 12000;
			while (!check()) {
				if (performance.now() > deadline)
					throw Error(name + ': ' + session.state.value + ' ' + session.statusMessage.value);
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
		};

		try {
			await session.adapters.terminal.resize({ columns: 100, rows: 30 });
			const first = await session.connect();
			expect(
				session.state.value === 'connected' && first.lastConnectedAt > 1700000000000,
				'formal connect with real SSH and seconds mapping',
			);
			// Wait for shell initialization, then record a shell-local value and PID.
			await new Promise((resolve) => setTimeout(resolve, 700));
			const previousDirectory = await session.adapters.terminalDirectory.readCurrentDirectory();
			expect(previousDirectory.startsWith('/'), 'formal current directory reads real interactive shell');
			let directoryTimer;
			try {
				const changed = await Promise.race([
					session.adapters.terminalDirectory.changeDirectory('/tmp'),
					new Promise((_, reject) => {
						directoryTimer = setTimeout(() => reject(Error('Real directory change deadline')), 12000);
					}),
				]);
				expect(changed.path === '/tmp', 'formal directory change confirms actual shell event');
			} finally {
				clearTimeout(directoryTimer);
			}
			expect(
				(await session.adapters.terminalDirectory.readCurrentDirectory()) === '/tmp',
				'real directory reread confirms shell effect',
			);
			await session.adapters.terminal.sendInput(
				'C2_OWNER_PID=$$; printf \'\\nC2_INITIAL_%s\\n\' "$C2_OWNER_PID"\n',
			);
			await until(() => /C2_INITIAL_[0-9]+/.test(output), 'initial shell marker');
			const pid = output.match(/C2_INITIAL_([0-9]+)/)[1];
			const before = output.length;
			await session.adapters.terminal.sendInput(
				"(sleep 1; printf '\\nC2_OFFLINE_%s\\n' \"$C2_OWNER_PID\") & printf '\\n%s%s\\n' 'C2_' 'BACKGROUND_READY'\n",
			);
			await until(
				() => output.slice(before).includes('C2_BACKGROUND_READY'),
				'background command accepted before detach',
			);
			session.socket.close('controlled browser transport detach');
			await new Promise((resolve) => setTimeout(resolve, 1500));
			const resumed = await session.connect();
			expect(
				resumed.attachmentGeneration === first.attachmentGeneration + 1 &&
					resumed.resumeToken !== first.resumeToken,
				'formal resume commits next ownership generation',
			);
			await until(
				() => output.slice(before).includes('C2_OFFLINE_' + pid),
				'offline/live output preserved on same shell',
			);
			await session.adapters.terminal.sendInput('printf \'\\nC2_RESUMED_%s_%s\\n\' "$C2_OWNER_PID" "$$"\n');
			await until(
				() => output.includes('C2_RESUMED_' + pid + '_' + pid),
				'same shell remains writable after explicit ACK',
			);
			expect(
				output.includes('C2_RESUMED_' + pid + '_' + pid),
				'same remote PID and shell variable survive formal resume',
			);
			await session.adapters.terminal.resize({ columns: 111, rows: 35 });
			await session.adapters.terminal.sendInput("printf '\\nC2_SIZE_'; stty size\n");
			await until(() => /C2_SIZE_35 111/.test(output), 'remote viewport applied');
			expect(/C2_SIZE_35 111/.test(output), 'formal resize changes actual remote PTY dimensions');
			expect(
				(await session.adapters.terminalDirectory.readCurrentDirectory()) === '/tmp',
				'directory integration survives normal resume',
			);
			expect(
				(await session.close()) === 'closed',
				'formal close is acknowledged on attached real backend socket',
			);
			expect(!session.socket.connected, 'formal close detaches transport');
			return result;
		} finally {
			off();
			await session.dispose();
		}
	}, target);
	console.log('Formal Workspace Session / real Access, Backend-next, OpenSSH: ' + results.length + ' checks PASS');
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
