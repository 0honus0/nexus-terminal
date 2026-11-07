import assert from 'node:assert/strict';
import { test } from 'node:test';
import imageData from '../../e2e/fixtures/agent/image-data.json' with { type: 'json' };
import { NativeContentInspector } from '../../../packages/backend/dist/platform/blobs/adapters/native-content-inspector.js';
import { consumeInspectedFile } from '../../../packages/backend/dist/modules/remote/files/service/file-inspection.js';
import { RemoteFileFailure } from '../../../packages/backend/dist/modules/remote/files/model/file-types.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend/dist/modules/remote/resource-errors.js';
import { RemoteMachineOperationService } from '../../../packages/backend/dist/modules/remote/machines/service/operation-service.js';
import { remoteOperations } from '../../../packages/backend/dist/modules/remote/operation-mapper.js';
import { ToolRemoteModel } from '../../../packages/backend/dist/modules/agent/tools/model/tool-remote-model.js';
import {
	AgentFailure,
	ToolCleanupFailure,
	ToolOperationRefusal,
	isAgentDrainFailure,
} from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { ArtifactModel } from '../../../packages/backend/dist/modules/agent/artifacts/model/artifact-model.js';
import { authorizationFact } from '../../../packages/backend/dist/modules/agent/governance/governance-rules.js';

import { effectiveHostOperationPolicy } from '../../../packages/backend/dist/modules/agent/tools/host-operation-rules.js';

function fixture(
	bytes,
	{ short = false, long = false, changed = false, readCleanup = false, resourceCleanup = false } = {},
) {
	const state = { opened: 0, readersClosed: 0, resourcesClosed: 0, stats: 0, valid: true };
	const context = {
		signal: new AbortController().signal,

		remaining: () => 10000,

		validate: async () => {
			if (!state.valid) throw new RemoteFileFailure('forbidden');
		},

		resource: {
			isOpen: true,

			realpath: async ({ path }) => path,

			stat: async () => ({ kind: 'file', size: bytes.length, modifiedAt: changed && ++state.stats > 1 ? 2 : 1 }),

			openRead: async () => {
				state.opened++;
				return (async function* () {
					try {
						if (!short) {
							for (let offset = 0; offset < bytes.length; offset += 1024)
								yield bytes.subarray(offset, offset + 1024);
						}
						if (long) yield new Uint8Array([1]);
					} finally {
						state.readersClosed++;
						if (readCleanup)
							throw new RemoteResourceCleanupFailure([new Error('controlled read close failure')]);
					}
				})();
			},

			close: async () => {
				state.resourcesClosed++;
				if (resourceCleanup) throw new Error('controlled resource close failure');
			},
		},
	};
	return { context, state };
}

async function collect(source) {
	const chunks = [];
	for await (const bytes of source) chunks.push(bytes);
	return Buffer.concat(chunks);
}

await test('File delivery stream lifecycle and compound authority', async (t) => {
	for (const [label, bytes, mime] of [
		['animated GIF', Buffer.from(imageData.animatedGifBase64, 'base64'), 'image/gif'],
		['large binary', Buffer.alloc(1024 * 1024, 0xa5), 'application/octet-stream'],
		['empty file', Buffer.alloc(0), 'application/octet-stream'],
	]) {
		await t.test(label + ' preserves exact bytes and closes its source', async () => {
			const { context, state } = fixture(bytes);
			const result = await consumeInspectedFile(context, '/output/file', bytes.length, (file, source) => {
				assert.equal(file.sizeBytes, bytes.length);
				return new NativeContentInspector().use(source, context.signal, async (mediaType, content) => {
					assert.equal(mediaType, mime);
					return collect(content);
				});
			});
			assert.deepEqual(result, bytes);
			assert.equal(state.readersClosed, bytes.length ? 1 : 0);
		});
	}

	for (const options of [{ short: true }, { long: true }, { changed: true }]) {
		await t.test(JSON.stringify(options) + ' rejects before the consumer can commit', async () => {
			const { context, state } = fixture(Buffer.alloc(8192), options);
			let committed = false;
			await assert.rejects(
				consumeInspectedFile(context, '/output/file', 8192, async (_file, source) => {
					await collect(source);
					committed = true;
				}),
				(error) => error instanceof RemoteFileFailure && error.code === 'conflict',
			);
			assert.equal(committed, false);
			assert.equal(state.readersClosed, 1);
		});
	}

	await t.test('revocation between chunks closes the original read without publishing', async () => {
		const { context, state } = fixture(Buffer.alloc(8192));
		await assert.rejects(
			consumeInspectedFile(context, '/output/file', 8192, async (_file, source) => {
				for await (const _chunk of source) state.valid = false;
			}),
			(error) => error instanceof RemoteFileFailure && error.code === 'forbidden',
		);
		assert.equal(state.readersClosed, 1);
	});

	await t.test('a consumer failure closes a partially consumed source', async () => {
		const { context, state } = fixture(Buffer.alloc(8192));
		const expected = new Error('consumer failed');
		await assert.rejects(
			consumeInspectedFile(context, '/output/file', 8192, async (_file, source) => {
				await source[Symbol.asyncIterator]().next();
				throw expected;
			}),
			(error) => error === expected,
		);
		assert.equal(state.readersClosed, 1);
	});

	await t.test('source cleanup failure retains both causes', async () => {
		const { context, state } = fixture(Buffer.alloc(8192), { readCleanup: true });
		const expected = new Error('consumer failed');
		await assert.rejects(
			consumeInspectedFile(context, '/output/file', 8192, async (_file, source) => {
				await source[Symbol.asyncIterator]().next();
				throw expected;
			}),
			(error) => error instanceof RemoteResourceCleanupFailure && error.errors.includes(expected),
		);
		assert.equal(state.readersClosed, 1);
	});

	for (const cleanup of [false, true]) {
		await t.test(`cross-module import error survives Remote mapping (cleanup=${cleanup})`, async () => {
			const { context, state } = fixture(Buffer.alloc(8192), { resourceCleanup: cleanup });
			const service = new RemoteMachineOperationService(
				{ open: async () => context.resource },
				null,
				null,
				null,
				{
					key: async () => 'fixture',

					quiesce() {},

					async close() {},
				},
			);
			const model = new ToolRemoteModel(remoteOperations(service, () => service.close()));
			const scope = {
				operationId: 'delivery',
				timeoutMs: 10000,
				target: { id: 1, version: 1, fingerprint: 'current' },
				signal: context.signal,
				validate: context.validate,
			};
			const expected = new AgentFailure('operation_unknown');
			await assert.rejects(
				model.consumeFile('/output/file', 8192, scope, async (_file, source) => {
					await source[Symbol.asyncIterator]().next();
					throw expected;
				}),
				(error) => (cleanup ? error instanceof ToolCleanupFailure : error === expected),
			);
			assert.equal(state.readersClosed, 1);
			assert.equal(state.resourcesClosed, 1);
			if (cleanup) await assert.rejects(service.close(), RemoteResourceCleanupFailure);
			else await service.close();
		});
	}

	await t.test('a wrapped EOF cleanup failure remains a cleanup failure across the importer', async () => {
		const { context, state } = fixture(Buffer.alloc(8192), { readCleanup: true });
		const service = new RemoteMachineOperationService({ open: async () => context.resource }, null, null, null, {
			key: async () => 'fixture',

			quiesce() {},

			async close() {},
		});
		const model = new ToolRemoteModel(remoteOperations(service, () => service.close()));
		const scope = {
			operationId: 'delivery',
			timeoutMs: 10000,
			target: { id: 1, version: 1, fingerprint: 'current' },
			signal: context.signal,
			validate: context.validate,
		};
		await assert.rejects(
			model.consumeFile('/output/file', 8192, scope, async (_file, source) => {
				try {
					await collect(source);
				} catch (cause) {
					throw new AgentFailure('operation_unknown', { cause });
				}
			}),
			ToolCleanupFailure,
		);
		assert.equal(state.readersClosed, 1);
		assert.equal(state.resourcesClosed, 1);
		await assert.rejects(service.close(), RemoteResourceCleanupFailure);
	});

	await t.test('an importer cannot skip consuming the replayed prefix or leak its reader', async () => {
		const { context, state } = fixture(Buffer.alloc(8192));
		await assert.rejects(
			consumeInspectedFile(context, '/output/file', 8192, (_file, source) =>
				new NativeContentInspector().use(source, context.signal, async () => 'not consumed'),
			),
		);
		assert.equal(state.readersClosed, 1);
	});

	await t.test(
		'source interruption during MIME sampling stays an expected refusal through ArtifactModel',
		async () => {
			const { context, state } = fixture(Buffer.alloc(8192));
			context.resource.openRead = async () =>
				(async function* () {
					throw new RemoteFileFailure('remote_unavailable');
				})();
			const service = new RemoteMachineOperationService(
				{ open: async () => context.resource },
				null,
				null,
				null,
				{
					key: async () => 'fixture',

					quiesce() {},

					async close() {},
				},
			);
			const model = new ToolRemoteModel(remoteOperations(service, () => service.close()));
			const artifacts = new ArtifactModel(null, null, null, new NativeContentInspector());
			const scope = {
				operationId: 'delivery',
				timeoutMs: 10000,
				target: { id: 1, version: 1, fingerprint: 'current' },
				signal: context.signal,
				validate: context.validate,
			};
			let consumerStarted = false;
			await assert.rejects(
				model.consumeFile('/output/file', 8192, scope, (_file, source) =>
					artifacts.useDetectedContent(source, context.signal, async (_mediaType, bytes) => {
						consumerStarted = true;
						return collect(bytes);
					}),
				),
				(error) =>
					error instanceof ToolOperationRefusal &&
					error.code === 'remote_unavailable' &&
					!isAgentDrainFailure(error),
			);
			assert.equal(consumerStarted, false);
			assert.equal(state.resourcesClosed, 1);
			await service.close();
		},
	);

	await t.test('authority storage failure during sampling is not hidden by its source refusal', async () => {
		const { context, state } = fixture(Buffer.alloc(8192));
		const service = new RemoteMachineOperationService({ open: async () => context.resource }, null, null, null, {
			key: async () => 'fixture',

			quiesce() {},

			async close() {},
		});
		const model = new ToolRemoteModel(remoteOperations(service, () => service.close()));
		const artifacts = new ArtifactModel(null, null, null, new NativeContentInspector());
		const expected = new AgentFailure('storage_unavailable');
		const scope = {
			operationId: 'delivery',
			timeoutMs: 10000,
			target: { id: 1, version: 1, fingerprint: 'current' },
			signal: context.signal,

			validate: async () => {
				if (state.opened) throw expected;
			},
		};
		await assert.rejects(
			model.consumeFile('/output/file', 8192, scope, (_file, source) =>
				artifacts.useDetectedContent(source, context.signal, async (_mediaType, bytes) => collect(bytes)),
			),
			(error) =>
				isAgentDrainFailure(error) &&
				error instanceof AggregateError &&
				error.errors.length === 2 &&
				error.errors.includes(expected) &&
				error.errors.some(
					(cause) => cause instanceof ToolOperationRefusal && cause.code === 'remote_unavailable',
				),
		);
		assert.equal(state.readersClosed, 1);
		assert.equal(state.resourcesClosed, 1);
		await service.close();
	});

	await t.test('native delivery policy requires both declared capabilities and both current grants', () => {
		const request = { operation: 'remote.deliver', connectionId: 7, paths: ['/output/file'] };
		const operation = effectiveHostOperationPolicy(request.operation, JSON.stringify(request));
		assert.ok(operation);
		assert.equal(operation.capability, 'file.read');
		assert.deepEqual(operation.requirements.capabilities, ['artifacts.write']);
		const policy = {
			userId: 1,
			appId: 'app',
			revision: 1,
			app: { declared: true, enabled: true, capabilities: ['file.read', 'artifacts.write'], deniedTargetIds: [] },
			grants: [
				{ capability: 'file.read', scope: { kind: 'targets', targets: { ssh: { mode: 'ids', ids: ['7'] } } } },
				{ capability: 'artifacts.write', scope: { kind: 'global' } },
			],
		};
		for (const capability of [operation.capability, ...operation.requirements.capabilities]) {
			assert.equal(authorizationFact(policy, capability, 7).allowed, true);
			assert.equal(
				authorizationFact(
					{ ...policy, grants: policy.grants.filter((grant) => grant.capability !== capability) },
					capability,
					7,
				).allowed,
				false,
			);
			assert.equal(
				authorizationFact(
					{
						...policy,
						app: {
							...policy.app,
							capabilities: policy.app.capabilities.filter((item) => item !== capability),
						},
					},
					capability,
					7,
				).allowed,
				false,
			);
			assert.equal(
				authorizationFact({ ...policy, app: { ...policy.app, deniedTargetIds: [7] } }, capability, 7).allowed,
				false,
			);
		}
		assert.equal(authorizationFact(policy, operation.capability, 8).allowed, false);
	});
});
