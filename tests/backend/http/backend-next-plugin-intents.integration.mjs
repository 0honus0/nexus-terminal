import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';
import {
	readAgentPluginIntentResponse,
	readAgentPluginIntentListResponse,
} from '../../../packages/shared/dist/agent/plugins/intent-http-codec.js';

await test(
	'B10 signed app intents, durable receipts and actual cross-app Artifact authorization',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const capabilities = ['app.intents.exchange', 'artifacts.read'];
		const sender = await f.install('sender', { capabilities });
		const receiver = await f.install('receiver', { capabilities, intents: [{ id: 'inspect', schemaVersion: 1 }] });
		const outsider = await f.install('outsider', { capabilities });
		const senderPath = sender.appPath + '/plugin-intents';
		const receiverPath = receiver.appPath + '/plugin-intents';
		const outsiderPath = outsider.appPath + '/plugin-intents';
		const content = Buffer.concat([Buffer.from('cross-app\0共享'), randomBytes(4096)]);
		const artifact = await f.upload(sender.appId, content, 'attachment.bin');
		const unrelated = await f.upload(sender.appId, Buffer.from('not granted'), 'other.bin');
		const input = {
			operationId: randomUUID(),
			receiverAppId: receiver.appId,
			intentId: 'inspect',
			inputJson: '{"question":"read attachment"}',
			artifactIds: [artifact.id],
			confirmed: true,
		};
		let receipt;

		const create = (body = input) => f.api('POST', senderPath, body);

		const list = async (path = receiverPath) =>
			readAgentPluginIntentListResponse(expectStatus(await f.api('GET', path), 200)).items;

		const metadata = (appPath = receiverPath, artifactId = artifact.id) =>
			appPath + '/' + receipt.id + '/artifacts/' + artifactId;

		await t.test('anonymous intents cannot be created or read', async () => {
			expectStatus(await f.anonymous('POST', senderPath, input), 401);
			expectStatus(await f.anonymous('GET', receiverPath), 401);
		});
		await t.test('declaration without grants cannot send, including sender-only authorization', async () => {
			expectStatus(await create(), 403);
			await sender.grants(capabilities);
			expectStatus(await create(), 403);
			await receiver.grants(capabilities);
			await outsider.grants(capabilities);
		});
		for (const [label, changed] of [
			['unconfirmed input', { confirmed: false }],
			['self receiver', { receiverAppId: sender.appId }],
			['undeclared intent', { intentId: 'missing' }],
			['duplicate artifact IDs', { artifactIds: [artifact.id, artifact.id] }],
			['reserved secret field', { inputJson: '{"nested":{"access_token":"must-not-transfer"}}' }],
		]) {
			await t.test(label + ' rejects without recording a received message', async () => {
				expectStatus(await create({ ...input, ...changed, operationId: randomUUID() }), 400);
				assert.deepEqual(await list(), []);
			});
		}
		await t.test('foreign Artifact cannot be attached by another sender App', async () => {
			expectStatus(await f.api('POST', outsiderPath, { ...input, operationId: randomUUID() }), 404);
			assert.deepEqual(await list(), []);
		});
		await t.test(
			'actual create persists exact receipt and immutable replay without duplicate delivery',
			async () => {
				receipt = readAgentPluginIntentResponse(expectStatus(await create(), 201)).receipt;
				assert.equal(receipt.id, input.operationId);
				assert.equal(receipt.senderAppId, sender.appId);
				assert.equal(receipt.receiverAppId, receiver.appId);
				assert.equal(receipt.schemaVersion, 1);
				assert.equal(receipt.expiresAt - receipt.createdAt, 600000);
				assert.deepEqual(readAgentPluginIntentResponse(expectStatus(await create(), 201)).receipt, receipt);
				assert.deepEqual(await list(), [receipt]);
				expectStatus(await create({ ...input, inputJson: '"different"' }), 409);
				assert.deepEqual(await list(), [receipt]);
			},
		);
		await t.test('received-only visibility and direct Artifact owner isolation remain separate', async () => {
			assert.deepEqual(await list(senderPath), []);
			assert.deepEqual(await list(outsiderPath), []);
			expectStatus(await f.api('GET', metadata(outsiderPath)), 404);
			expectStatus(await f.api('GET', metadata(receiverPath, unrelated.id)), 404);
			expectStatus(await f.api('GET', receiver.appPath + '/artifacts/' + artifact.id + '/content'), 404);
		});
		await t.test('list limit counts visible receipts rather than newer revoked-authority candidates', async () => {
			const extra = await f.install('hidden-sender', { capabilities });
			await extra.grants(capabilities);
			for (const [path, count] of [
				[outsiderPath, 100],
				[extra.appPath + '/plugin-intents', 40],
			]) {
				for (let index = 0; index < count; index += 1) {
					const newer = { ...input, operationId: randomUUID(), artifactIds: [] };
					expectStatus(await f.api('POST', path, newer), 201);
				}
			}
			await outsider.enabled(false);
			await extra.enabled(false);
			const visible = readAgentPluginIntentListResponse(
				expectStatus(await f.api('GET', receiverPath + '?limit=1'), 200),
			).items;
			assert.deepEqual(visible, [receipt]);
			assert.deepEqual(await list(), [receipt]);
		});
		await t.test('granted metadata, full bytes and explicit Range are read from the real source blob', async () => {
			assert.equal(
				expectStatus(await f.api('GET', metadata()), 200).artifact.sha256,
				createHash('sha256').update(content).digest('hex'),
			);
			const full = await f.api('GET', metadata() + '/content');
			expectStatus(full, 200);
			assert.deepEqual(full.bytes, content);
			assert.equal(full.headers['cache-control'], 'no-store');
			const partial = await f.api('GET', metadata() + '/content', undefined, { Range: 'bytes=3-63' });
			expectStatus(partial, 206);
			assert.deepEqual(partial.bytes, content.subarray(3, 64));
			assert.equal(partial.headers['content-range'], 'bytes 3-63/' + content.length);
		});
		await t.test('frontend RPC range preserves exact receipt, Artifact and byte encoding', async () => {
			const descriptor = expectStatus(
				await f.api('GET', '/api/v1/agent/plugins/installations/' + receiver.appId + '/descriptor'),
				200,
			);
			const envelope = {
				type: 'nexus.plugin.request',
				protocol: 1,
				nonce: randomUUID(),
				id: randomUUID(),
				seq: 1,
				request: {
					method: 'intents.artifacts.readRange',
					params: { receiptId: receipt.id, artifactId: artifact.id, start: 1, endInclusive: 127 },
				},
			};
			const response = expectStatus(
				await f.api('POST', '/api/v1/agent/plugins/installations/' + receiver.appId + '/frontend/rpc', {
					grant: descriptor.url.split('/')[4],
					envelope,
				}),
				200,
			);
			assert.equal(response.ok, true);
			assert.equal(response.id, envelope.id);
			assert.equal(response.result.value.receiptId, receipt.id);
			assert.equal(response.result.value.artifactId, artifact.id);
			assert.deepEqual(Buffer.from(response.result.value.dataBase64, 'base64'), content.subarray(1, 128));
		});
		await t.test('active receipt protects actual source Artifact from deletion', async () => {
			expectStatus(
				await f.api('DELETE', sender.appPath + '/artifacts/' + artifact.id, {
					expectedVersion: artifact.version,
				}),
				409,
			);
			assert.deepEqual((await f.api('GET', metadata() + '/content')).bytes, content);
		});
		await t.test(
			'controlled app restart preserves receipt and source bytes without duplicate delivery',
			async () => {
				await f.restart();
				assert.deepEqual(await list(), [receipt]);
				assert.deepEqual((await f.api('GET', metadata() + '/content')).bytes, content);
			},
		);
		await t.test('receiver cannot revoke sender receipt; sender revoke immediately removes access', async () => {
			expectStatus(await f.api('DELETE', receiverPath + '/' + receipt.id, {}), 404);
			expectStatus(await f.api('DELETE', senderPath + '/' + receipt.id, {}), 200);
			assert.deepEqual(await list(), []);
			expectStatus(await f.api('GET', metadata()), 404);
			expectStatus(await f.api('GET', metadata() + '/content'), 404);
			expectStatus(await create(), 404);
		});
		await t.test('revoked receipt releases delete protection without granting replay', async () => {
			expectStatus(
				await f.api('DELETE', sender.appPath + '/artifacts/' + artifact.id, {
					expectedVersion: artifact.version,
				}),
				200,
			);
			expectStatus(await create(), 404);
		});
		await t.test(
			'sender grant revocation invalidates another receipt; management revoke still works when disabled',
			async () => {
				const next = { ...input, operationId: randomUUID(), artifactIds: [unrelated.id] };
				const current = readAgentPluginIntentResponse(expectStatus(await create(next), 201)).receipt;
				await sender.grants([]);
				assert.deepEqual(await list(), []);
				expectStatus(await f.api('GET', receiverPath + '/' + current.id + '/artifacts/' + unrelated.id), 404);
				await sender.enabled(false);
				expectStatus(await f.api('DELETE', senderPath + '/' + current.id, {}), 200);
				await sender.grants(capabilities);
				await sender.enabled(true);
				assert.deepEqual(await list(), []);
				expectStatus(await create(next), 404);
			},
		);
		const saturated = [];
		await t.test(
			'exactly 100 live messages fit sender quota and valid replay still works at capacity',
			async () => {
				for (let index = 0; index < 100; index++) {
					const command = {
						...input,
						operationId: randomUUID(),
						artifactIds: [],
						inputJson: JSON.stringify({ index }),
					};
					const value = readAgentPluginIntentResponse(expectStatus(await create(command), 201)).receipt;
					saturated.push({ command, receipt: value });
				}
				const listed = readAgentPluginIntentListResponse(
					expectStatus(await f.api('GET', receiverPath + '?limit=100'), 200),
				).items;
				assert.equal(listed.length, 100);
				assert.equal(new Set(listed.map((item) => item.id)).size, 100);
				assert.deepEqual(
					readAgentPluginIntentResponse(expectStatus(await create(saturated[0].command), 201)).receipt,
					saturated[0].receipt,
				);
			},
		);
		await t.test(
			'101st message refuses without consuming the intent and can be created after explicit revocation',
			async () => {
				const next = { ...input, operationId: randomUUID(), artifactIds: [] };
				assert.equal(expectStatus(await create(next), 413).code, 'limit_exceeded');
				expectStatus(await f.api('DELETE', senderPath + '/' + saturated[0].receipt.id, {}), 200);
				const value = readAgentPluginIntentResponse(expectStatus(await create(next), 201)).receipt;
				assert.equal(value.id, next.operationId);
				const listed = readAgentPluginIntentListResponse(
					expectStatus(await f.api('GET', receiverPath + '?limit=100'), 200),
				).items;
				assert.equal(listed.length, 100);
				assert.equal(listed.filter((item) => item.id === next.operationId).length, 1);
			},
		);
		await t.test('intent list rejects duplicate, unknown and out-of-range queries', async () => {
			for (const query of ['limit=0', 'limit=101', 'limit=1&limit=2', 'unknown=1']) {
				expectStatus(await f.api('GET', receiverPath + '?' + query), 400);
			}
		});
	},
);
