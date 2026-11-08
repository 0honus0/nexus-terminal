import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, access } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

async function allocatePort() {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	return address.port;
}

await test(
	'Failed browser fixture evidence survives authenticated reset and normal shutdown without retaining every successful baseline',
	{ timeout: 30000 },
	async (t) => {
		const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
		await mkdir(root, { recursive: true });
		const directory = await mkdtemp(join(root, 'backend-evidence-'));
		const [backendPort, controlPort] = await Promise.all([allocatePort(), allocatePort()]);
		const token = randomUUID();
		const log = createWriteStream(join(directory, 'backend.log'));
		const child = spawn(
			process.execPath,
			[fileURLToPath(new URL('../../../e2e/support/backend-server.mjs', import.meta.url))],
			{
				env: {
					...process.env,
					NEXUS_E2E_BACKEND_PORT: String(backendPort),
					NEXUS_E2E_BACKEND_CONTROL_PORT: String(controlPort),
					NEXUS_PUBLIC_ORIGIN: 'http://localhost:' + backendPort,
					NEXUS_E2E_CONTROL_TOKEN: token,
					NEXUS_E2E_DATA_ROOT: directory,
					NEXUS_E2E_ADMIN_USERNAME: 'fixture-admin',
					NEXUS_E2E_ADMIN_PASSWORD: 'isolated-fixture-password-123',
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		child.stdout.pipe(log, { end: false });
		child.stderr.pipe(log, { end: false });
		let startFailure;
		const exited = new Promise((resolve) => {
			child.once('error', (error) => {
				startFailure = error;
			});
			child.once('close', (code, signal) => resolve({ code, signal }));
		});
		t.after(async () => {
			const failures = [];
			if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
			let timer;
			try {
				const result = await Promise.race([
					exited,
					new Promise((_, reject) => {
						timer = setTimeout(() => reject(Error('Evidence backend did not drain')), 10000);
					}),
				]);
				assert.equal(result.code, 0);
				assert.equal(result.signal, null);
			} catch (error) {
				failures.push(error);
				child.kill('SIGKILL');
				await exited;
			} finally {
				clearTimeout(timer);
			}
			log.end();
			try {
				await finished(log);
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) throw new AggregateError(failures, 'Evidence fixture cleanup failed');
		});
		const origin = 'http://127.0.0.1:' + controlPort;
		let ready = false;
		let lastFailure;
		const deadline = performance.now() + 10000;
		while (performance.now() < deadline) {
			if (startFailure) throw startFailure;
			assert.equal(child.exitCode, null, 'Backend must remain alive during startup');
			try {
				const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(1000) });
				await response.arrayBuffer();
				if (response.status === 200) {
					ready = true;
					break;
				}
			} catch (error) {
				lastFailure = error;
			}
			await delay(20);
		}
		assert.equal(ready, true, String(lastFailure));
		const baseline = (await readdir(directory)).find((name) => name.startsWith('backend-'));
		assert.ok(baseline);
		const denied = await fetch(origin + '/retain', { method: 'POST' });
		assert.equal(denied.status, 403);
		await denied.arrayBuffer();
		const retained = await fetch(origin + '/retain', { method: 'POST', headers: { 'X-Nexus-E2E-Control': token } });
		assert.equal(retained.status, 200);
		assert.deepEqual(await retained.json(), { retained: true });
		const reset = await fetch(origin + '/reset', {
			method: 'POST',
			headers: { 'X-Nexus-E2E-Control': token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode: 'empty' }),
		});
		assert.equal(reset.status, 200);
		assert.deepEqual(await reset.json(), { reset: true, mode: 'empty' });
		await access(join(directory, 'evidence', baseline, 'nexus-terminal.db'));
		const success = (await readdir(directory)).find((name) => name.startsWith('backend-'));
		assert.ok(success && success !== baseline);
		const secondReset = await fetch(origin + '/reset', {
			method: 'POST',
			headers: { 'X-Nexus-E2E-Control': token, 'Content-Type': 'application/json' },
			body: JSON.stringify({ mode: 'empty' }),
		});
		assert.equal(secondReset.status, 200);
		await secondReset.arrayBuffer();
		await assert.rejects(access(join(directory, success)), { code: 'ENOENT' });
		await access(join(directory, 'evidence', baseline, 'nexus-terminal.db'));
	},
);
