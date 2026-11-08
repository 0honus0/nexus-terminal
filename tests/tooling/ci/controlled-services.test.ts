import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Worker protocol peers start only on demand, share their lifetime, retain logs and fail on premature exit', async (t) => {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const root = await mkdtemp(join(artifactRoot, 'controlled-service-contract-'));
	const originalPort = process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT;
	process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT = String(address.port);
	t.onTestFinished(() => {
		if (originalPort === undefined) delete process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT;
		else process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT = originalPort;
	});
	const { ControlledServices } = await import('../../e2e/support/controlled-services');
	const empty = new ControlledServices(join(root, 'empty'));
	const firstClose = empty.close();
	assert.equal(empty.close(), firstClose);
	await firstClose;
	assert.deepEqual(JSON.parse(await readFile(join(root, 'empty/timings.json'), 'utf8')), []);
	await assert.rejects(empty.ensure(['provider']));
	const normal = new ControlledServices(join(root, 'normal'));
	t.onTestFinished(() => normal.close());
	await Promise.all([normal.ensure(['provider']), normal.ensure(['provider'])]);
	const health = await fetch('http://127.0.0.1:' + address.port + '/health');
	assert.equal(health.status, 200);
	await health.arrayBuffer();
	await normal.close();
	const timings: unknown = JSON.parse(await readFile(join(root, 'normal/timings.json'), 'utf8'));
	assert.ok(Array.isArray(timings) && timings.length === 1);
	assert.equal(timings[0].name, 'provider');
	assert.equal(timings[0].exitCode, 0);
	assert.equal(timings[0].signal, null);
	assert.ok(timings[0].readyMs >= 0 && timings[0].drainMs >= 0);
	assert.match(await readFile(join(root, 'normal/provider.log'), 'utf8'), /listening/);
	const failed = new ControlledServices(join(root, 'failed-start'));
	// A real invalid listen argument rejects in the child; no simulated process or exit result.
	process.env.NEXUS_E2E_OPENAI_PROVIDER_PORT = 'invalid-port';
	await assert.rejects(failed.ensure(['provider']), AggregateError);
	await assert.rejects(failed.close(), AggregateError);
	assert.match(await readFile(join(root, 'failed-start/provider.log'), 'utf8'), /ERR_SOCKET_BAD_PORT/);
	const failedTimings: unknown = JSON.parse(await readFile(join(root, 'failed-start/timings.json'), 'utf8'));
	assert.ok(Array.isArray(failedTimings) && failedTimings.length === 1);
	assert.notEqual(failedTimings[0].exitCode, 0);
});
