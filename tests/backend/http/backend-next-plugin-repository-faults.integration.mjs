import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';

const base = '/api/v1/agent/plugins';

await test('B10 real repository admission, download revocation and shutdown', { timeout: 60000 }, async (t) => {
	let catalog;
	let bytes;
	let mode = 'normal';
	const held = new Set();
	const requests = [];
	const server = createServer((request, response) => {
		requests.push(request.url);
		const content = request.url === '/package.tar' ? bytes : Buffer.from(JSON.stringify(catalog));
		if (mode === 'catalog-hold' || (request.url === '/package.tar' && mode === 'package-hold')) {
			response.writeHead(200, { 'Content-Length': content.length });
			response.write(content.subarray(0, 1));
			const entry = { response, content, closed: false };
			held.add(entry);
			response.once('close', () => {
				entry.closed = true;
			});
			return;
		}
		if (request.url === '/package.tar' && mode === 'truncate') {
			response.writeHead(200, { 'Content-Length': content.length });
			response.write(content.subarray(0, 1), () => response.destroy());
			return;
		}
		response.end(content);
	});
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const f = await openPlugins(t);
	const url = 'http://127.0.0.1:' + server.address().port + '/catalog.json';
	bytes = await f.build('repository-faults');
	catalog = {
		schemaVersion: 1,
		publishers: [{ keyId: f.publisher.keyId, label: f.publisher.label, publicKeyPem: f.publisher.publicKeyPem }],
		packages: [
			{
				appId: 'isolated.b10-repository-faults',
				version: '1.0.0',
				sdkVersion: '1',
				nexus: { minVersion: '0.0.0', maxVersion: '999.0.0' },
				displayName: 'faults',
				description: 'isolated streaming source',
				packageUrl: './package.tar',
				sha256: createHash('sha256').update(bytes).digest('hex'),
				sizeBytes: bytes.length,
				publisherKeyId: f.publisher.keyId,
			},
		],
	};
	expectStatus(await f.api('PUT', base + '/repositories', { expectedVersion: 0, repositories: [{ url }] }), 200);

	const read = () => f.api('GET', base + '/remote/catalog?repositoryUrl=' + encodeURIComponent(url));

	const download = () =>
		f.api('POST', base + '/remote/stage', {
			repositoryUrl: url,
			appId: catalog.packages[0].appId,
			version: '1.0.0',
		});

	async function waiting() {
		return until(async () => [...held].find((item) => !item.closed), Boolean, 'actual upstream partial body');
	}

	function release() {
		mode = 'normal';
		for (const entry of held) {
			if (!entry.closed) entry.response.end(entry.content.subarray(1));
		}
		held.clear();
	}

	await t.test('one live and seven queued tasks fill admission; overflow never dispatches', async () => {
		mode = 'catalog-hold';
		const before = requests.length;
		const first = read();
		await waiting();
		const early = [];
		const burst = Array.from({ length: 12 }, () =>
			read().then((result) => {
				early.push(result);
				return result;
			}),
		);
		await until(
			async () => early.length,
			(count) => count === 5,
			'five overflow responses before release',
		);
		for (const result of early) assert.equal(expectStatus(result, 503).code, 'provider_unavailable');
		assert.equal(requests.length, before + 1);
		release();
		expectStatus(await first, 200);
		const results = await Promise.all(burst);
		assert.equal(results.filter((result) => result.status === 200).length, 7);
		assert.equal(results.filter((result) => result.status === 503).length, 5);
		assert.equal(requests.length, before + 8);
	});
	await t.test('settled reads release all admission slots for subsequent work', async () => {
		expectStatus(await read(), 200);
		assert.deepEqual(expectStatus(await f.api('GET', base + '/stages'), 200).items, []);
	});
	await t.test('broken package response refuses publication and next download remains usable', async () => {
		mode = 'truncate';
		assert.equal(expectStatus(await download(), 503).code, 'provider_unavailable');
		assert.deepEqual(expectStatus(await f.api('GET', base + '/stages'), 200).items, []);
		mode = 'normal';
		const staged = expectStatus(await download(), 200);
		assert.equal(staged.status, 'verified');
	});
	await t.test('logout during partial package body rejects the late result without creating a stage', async () => {
		const before = expectStatus(await f.api('GET', base + '/stages'), 200).items;
		mode = 'package-hold';
		const pending = download();
		await waiting();
		expectStatus(await f.api('POST', '/api/v1/auth/logout', {}), 200);
		release();
		assert.equal(expectStatus(await pending, 401).code, 'unauthenticated');
		await f.login();
		assert.deepEqual(expectStatus(await f.api('GET', base + '/stages'), 200).items, before);
	});
	await t.test(
		'publisher revocation queues behind download, then prevents installing its verified stage',
		async () => {
			mode = 'package-hold';
			const pending = download();
			await waiting();
			const revoking = f.api('DELETE', base + '/publishers/' + encodeURIComponent(f.publisher.keyId), {
				expectedVersion: f.publisher.version,
			});
			release();
			const stage = expectStatus(await pending, 200);
			assert.equal(stage.status, 'verified');
			assert.notEqual(expectStatus(await revoking, 200).revokedAt, null);
			assert.equal(
				expectStatus(
					await f.api('POST', base + '/install', {
						stageId: stage.id,
						expectedVersion: stage.version,
					}),
					403,
				).code,
				'forbidden',
			);
			assert.deepEqual(expectStatus(await f.api('GET', base + '/installations'), 200).items, []);
		},
	);
	await t.test(
		'shutdown aborts actual partial download, rejects queued reads and persists no late stage',
		async () => {
			const before = expectStatus(await f.api('GET', base + '/stages'), 200).items;
			mode = 'package-hold';
			const downloading = Promise.allSettled([download()]);
			const upstream = await waiting();
			const early = [];
			const queued = Promise.allSettled(
				Array.from({ length: 8 }, () =>
					read().then((result) => {
						early.push(result);
						return result;
					}),
				),
			);
			await until(
				async () => early.length,
				(count) => count === 1,
				'queue full before shutdown',
			);
			expectStatus(early[0], 503);
			await f.close();
			await until(async () => upstream.closed, Boolean, 'original upstream socket closed');
			for (const result of [...(await downloading), ...(await queued)]) {
				if (result.status === 'fulfilled') {
					assert.equal(expectStatus(result.value, 503).code, 'provider_unavailable');
				} else {
					// HTTP shutdown can close the original connection before a failure response is delivered.
					assert.equal(result.reason.code, 'ECONNRESET');
				}
			}
			release();
			await f.restart();
			assert.deepEqual(expectStatus(await f.api('GET', base + '/stages'), 200).items, before);
			expectStatus(await read(), 200);
		},
	);
});
