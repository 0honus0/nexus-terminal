import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';
// Fixture size exercises backpressure independently of the configurable storage ceiling.
const STREAM_FIXTURE_BYTES = 16 * 1024 * 1024;

// Observe the actual server file handle, rather than infer backpressure from a paused client alone.
async function openBlobHandles(f, artifact) {
	const path = join(dirname(f.database), 'artifacts', artifact.id + '.blob');
	const targets = await Promise.all(
		(await readdir('/proc/self/fd')).map(async (fd) => {
			try {
				return await readlink(join('/proc/self/fd', fd));
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
				return null;
			}
		}),
	);
	return targets.filter((value) => value === path).length;
}

async function heldRead(t, f, path, artifact) {
	const stream = await f.stream(path);
	t.after(async () => {
		stream.cancel();
		await stream.finished;
	});
	assert.equal(stream.status, 200);
	assert.equal(Number(stream.headers['content-length']), artifact.sizeBytes);
	await until(
		() => openBlobHandles(f, artifact),
		(value) => value > 0,
		'real blob read remains open',
	);
	return stream;
}

async function interrupted(f, artifact, stream, content) {
	stream.resume();
	const result = await stream.finished;
	assert.equal(result.complete, false, 'revoked/closed response must not complete');
	assert.ok(result.bytes.length < content.length);
	assert.deepEqual(result.bytes, content.subarray(0, result.bytes.length));
	await until(
		() => openBlobHandles(f, artifact),
		(value) => value === 0,
		'original blob handle released',
	);
}

await test(
	'B10 in-flight direct Artifact reads, session revocation and real lease release',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const app = expectStatus(await f.api('POST', '/api/v1/agent/apps', { name: 'stream owner' }), 201);
		const content = randomBytes(STREAM_FIXTURE_BYTES);
		let artifact = await f.upload(app.id, content, 'bounded-stream.bin');
		const path = '/api/v1/agent/apps/' + app.id + '/artifacts/' + artifact.id;

		await t.test('active read lease refuses deletion; client disconnect releases the actual handle', async (t) => {
			const stream = await heldRead(t, f, path + '/content', artifact);
			expectStatus(await f.api('DELETE', path, { expectedVersion: artifact.version }), 409);
			stream.cancel();
			assert.equal((await stream.finished).complete, false);
			await until(
				() => openBlobHandles(f, artifact),
				(value) => value === 0,
				'cancelled read handle released',
			);
			const range = await f.api('GET', path + '/content', undefined, { Range: 'bytes=1-127' });
			expectStatus(range, 206);
			assert.deepEqual(range.bytes, content.subarray(1, 128));
		});
		await t.test(
			'logout interrupts an already open read; fresh login can read the same unchanged blob',
			async (t) => {
				const stream = await heldRead(t, f, path + '/content', artifact);
				expectStatus(await f.api('POST', '/api/v1/auth/logout', {}), 200);
				await interrupted(f, artifact, stream, content);
				expectStatus(await f.api('GET', path + '/content'), 401);
				await f.login();
				const full = await f.api('GET', path + '/content');
				expectStatus(full, 200);
				assert.deepEqual(full.bytes, content);
			},
		);
		await t.test('Artifact version change interrupts original read without changing stored content', async (t) => {
			const stream = await heldRead(t, f, path + '/content', artifact);
			const previous = artifact;
			artifact = expectStatus(
				await f.api('PATCH', path + '/retain', {
					expectedVersion: artifact.version,
					retained: true,
				}),
				200,
			).artifact;
			assert.ok(artifact.version > previous.version);
			assert.equal(artifact.sha256, previous.sha256);
			await interrupted(f, artifact, stream, content);
			artifact = expectStatus(
				await f.api('PATCH', path + '/retain', {
					expectedVersion: artifact.version,
					retained: false,
				}),
				200,
			).artifact;
		});
		await t.test('server shutdown aborts an open response and restart has no retained lease', async (t) => {
			const stream = await heldRead(t, f, path + '/content', artifact);
			await f.restart();
			await interrupted(f, artifact, stream, content);
			const full = await f.api('GET', path + '/content');
			expectStatus(full, 200);
			assert.deepEqual(full.bytes, content);
			expectStatus(await f.api('DELETE', path, { expectedVersion: artifact.version }), 200);
			assert.equal(expectStatus(await f.api('GET', path), 200).artifact.status, 'deleted');
			expectStatus(await f.api('GET', path + '/content'), 404);
		});
	},
);

await test(
	'B10 in-flight intent Artifact authority changes and upgrade delivery fence',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const capabilities = ['app.intents.exchange', 'artifacts.read'];
		const sender = await f.install('stream-sender', { capabilities });
		const receiver = await f.install('stream-receiver', {
			capabilities,
			intents: [{ id: 'inspect', schemaVersion: 1 }],
		});
		await sender.grants(capabilities);
		await receiver.grants(capabilities);
		const content = randomBytes(STREAM_FIXTURE_BYTES);
		const artifact = await f.upload(sender.appId, content, 'cross-app-stream.bin');
		const senderPath = sender.appPath + '/plugin-intents';
		const receipts = [];
		let receipt;
		let path;

		async function create() {
			receipt = expectStatus(
				await f.api('POST', senderPath, {
					operationId: randomUUID(),
					receiverAppId: receiver.appId,
					intentId: 'inspect',
					inputJson: '{}',
					artifactIds: [artifact.id],
					confirmed: true,
				}),
				201,
			).receipt;
			receipts.push(receipt);
			path = receiver.appPath + '/plugin-intents/' + receipt.id + '/artifacts/' + artifact.id + '/content';
		}

		await t.test(
			'client disconnect releases actual intent read while receipt still permits a new Range',
			async (t) => {
				await create();
				const stream = await heldRead(t, f, path, artifact);
				stream.cancel();
				assert.equal((await stream.finished).complete, false);
				await until(
					() => openBlobHandles(f, artifact),
					(value) => value === 0,
					'intent read handle released',
				);
				const range = await f.api('GET', path, undefined, { Range: 'bytes=3-127' });
				expectStatus(range, 206);
				assert.deepEqual(range.bytes, content.subarray(3, 128));
			},
		);
		await t.test(
			'logout interrupts open cross-app content; fresh session can use an otherwise valid receipt',
			async (t) => {
				await create();
				const stream = await heldRead(t, f, path, artifact);
				expectStatus(await f.api('POST', '/api/v1/auth/logout', {}), 200);
				await interrupted(f, artifact, stream, content);
				expectStatus(await f.api('GET', path), 401);
				await f.login();
				const full = await f.api('GET', path);
				expectStatus(full, 200);
				assert.deepEqual(full.bytes, content);
			},
		);
		await t.test(
			'shutdown releases the original intent stream and restart retains only durable receipt',
			async (t) => {
				await create();
				const stream = await heldRead(t, f, path, artifact);
				await f.restart();
				await interrupted(f, artifact, stream, content);
				const full = await f.api('GET', path);
				expectStatus(full, 200);
				assert.deepEqual(full.bytes, content);
			},
		);

		for (const [label, change, restore] of [
			[
				'sender receipt revocation',
				() => f.api('DELETE', senderPath + '/' + receipt.id, {}).then((value) => expectStatus(value, 200)),
				async () => {},
			],
			['sender grant revision', () => sender.grants([]), () => sender.grants(capabilities)],
			['receiver grant revision', () => receiver.grants([]), () => receiver.grants(capabilities)],
			['sender disabled', () => sender.enabled(false), () => sender.enabled(true)],
			['receiver disabled', () => receiver.enabled(false), () => receiver.enabled(true)],
		]) {
			await t.test(
				label + ' interrupts actual read and restored authority cannot revive old receipt',
				async (t) => {
					await create();
					const stream = await heldRead(t, f, path, artifact);
					await change();
					await interrupted(f, artifact, stream, content);
					expectStatus(await f.api('GET', path), 404);
					await restore();
					expectStatus(await f.api('GET', path), 404);
					const range = await f.api(
						'GET',
						sender.appPath + '/artifacts/' + artifact.id + '/content',
						undefined,
						{ Range: 'bytes=0-127' },
					);
					expectStatus(range, 206);
					assert.deepEqual(range.bytes, content.subarray(0, 128));
				},
			);
		}

		await t.test('prepare-upgrade fences active content; new version cannot reuse the old receipt', async (t) => {
			const packageArtifact = await f.upload(
				sender.appId,
				await f.build('stream-receiver', {
					version: '1.1.0',
					capabilities,
					intents: [{ id: 'inspect', schemaVersion: 1 }],
				}),
			);
			const stage = expectStatus(
				await f.api('POST', '/api/v1/agent/plugins/stage', {
					artifactAppId: sender.appId,
					artifactId: packageArtifact.id,
					expectedVersion: packageArtifact.version,
				}),
				200,
			);
			const verified = expectStatus(
				await f.api('POST', '/api/v1/agent/plugins/verify', {
					stageId: stage.id,
					expectedVersion: stage.version,
				}),
				200,
			);
			await create();
			const oldPath = path;
			const stream = await heldRead(t, f, oldPath, artifact);
			const installPath = '/api/v1/agent/plugins/installations/' + receiver.appId;
			const command = {
				expectedRevision: receiver.installation.revision,
				stageId: verified.id,
				expectedStageVersion: verified.version,
			};
			const prepared = expectStatus(await f.api('POST', installPath + '/prepare-upgrade', command), 200);
			assert.equal(prepared.status, 'draining');
			await interrupted(f, artifact, stream, content);
			const upgraded = expectStatus(
				await f.api('POST', installPath + '/upgrade', { ...command, expectedRevision: prepared.revision }),
				200,
			);
			assert.equal(upgraded.version, '1.1.0');
			await receiver.grants(capabilities);
			await receiver.enabled(true);
			expectStatus(await f.api('GET', oldPath), 404);
			await create();
			const full = await f.api('GET', path);
			expectStatus(full, 200);
			assert.deepEqual(full.bytes, content);
		});
		await t.test('after receipt revocation all read leases permit actual source deletion', async () => {
			// Invisible receipts still retain their explicit grant until revoke/expiry.
			expectStatus(
				await f.api('DELETE', sender.appPath + '/artifacts/' + artifact.id, {
					expectedVersion: artifact.version,
				}),
				409,
			);
			for (const value of receipts) expectStatus(await f.api('DELETE', senderPath + '/' + value.id, {}), 200);
			expectStatus(
				await f.api('DELETE', sender.appPath + '/artifacts/' + artifact.id, {
					expectedVersion: artifact.version,
				}),
				200,
			);
			assert.equal(await openBlobHandles(f, artifact), 0);
		});
	},
);
