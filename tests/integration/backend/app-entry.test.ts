import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import fixture from '../../fixtures/plugins/test/package.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = ['--import', 'tsx', 'src/app/node/main.ts'];

test('后端启动入口加载开发目录，SIGTERM 正常退出后保留账户', { timeout: 20000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-app-entry-'));
	const pluginDirectory = fileURLToPath(new URL('../../fixtures/plugins/test/', import.meta.url));
	const resources = new AsyncDisposableStack();

	resources.defer(() => rm(directory, { recursive: true, force: true }));
	t.after(() => resources.disposeAsync());

	async function start() {
		const child = spawn(process.execPath, args, {
			cwd: root,
			env: {
				...process.env,
				DATA_DIRECTORY: directory,
				PORT: '0',
				PLUGIN_DIRECTORIES: JSON.stringify([pluginDirectory]),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const exit = once(child, 'close');
		void exit.catch(() => undefined);
		resources.defer(async () => {
			if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
			await exit;
		});

		let stderr = '';
		child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
			stderr += chunk;
		});
		const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
		let origin: string | undefined;
		let stopped = false;
		const ready = Promise.withResolvers<string>();
		output.on('line', (line) => {
			if (!line.startsWith('{')) return;
			const { code, params, pluginId } = JSON.parse(line);
			if (code === 'HTTP_LISTENING') origin = params.origin;
			if (code === 'PLUGIN_STARTED' && pluginId === fixture.name && origin) ready.resolve(origin);
			if (code === 'APP_STOPPED') stopped = true;
		});
		const earlyExit = exit.then(([code]) => {
			throw new Error(`App exited before plugin startup (${code}): ${stderr}`);
		});

		return {
			origin: await Promise.race([ready.promise, earlyExit]),

			async stop() {
				assert.ok(child.kill('SIGTERM'));
				assert.deepEqual(await exit, [0, null], stderr);
				assert.equal(stopped, true);
			},
		};
	}

	const first = await start();
	const initialize = await fetch(first.origin + '/api/auth/initialize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ username: 'owner', password: 'entry-test-password' }),
	});
	assert.equal(initialize.status, 201);
	const cookie = initialize.headers.get('set-cookie')?.split(';')[0];
	assert.ok(cookie);
	await initialize.body?.cancel();
	await first.stop();
	await assert.rejects(fetch(first.origin + '/api/auth/state'));

	const restarted = await start();
	const response = await fetch(restarted.origin + '/api/auth/state', { headers: { cookie } });
	assert.equal(response.status, 200);
	assert.deepEqual((await response.json()).account, { id: 'owner', username: 'owner' });

	const plugin = await fetch(restarted.origin + '/api/plugins/' + encodeURIComponent(fixture.name) + '/items', {
		headers: { cookie },
	});
	assert.equal(plugin.status, 200);
	assert.deepEqual(await plugin.json(), { items: [{ id: 'sample', label: 'sample' }] });
	await restarted.stop();
});

test('启动入口拒绝无效的端口和开发插件目录配置', async () => {
	const run = promisify(execFile);
	for (const [env, code] of [
		[{ PORT: '65536' }, 'HTTP_PORT_INVALID'],
		[{ PLUGIN_DIRECTORIES: '{"directory":"plugins"}' }, 'PLUGIN_DIRECTORIES_INVALID'],
	] as const) {
		await assert.rejects(
			run(process.execPath, args, {
				cwd: root,
				env: { ...process.env, PORT: '0', PLUGIN_DIRECTORIES: '[]', ...env },
				timeout: 5000,
			}),
			{ code: 1, stderr: new RegExp(code) },
		);
	}
});
