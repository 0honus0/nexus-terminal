import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ArtifactService } from '../../../packages/backend/dist/modules/agent/artifacts/service/artifact-service.js';
import { ProviderImageService } from '../../../packages/backend/dist/modules/agent/providers/service/provider-image-service.js';
import { ToolContentService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-content-service.js';
import { ToolRemoteService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-remote-service.js';
import { AgentFailure, ToolCleanupFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { ToolRemoteModel } from '../../../packages/backend/dist/modules/agent/tools/model/tool-remote-model.js';
import { RemoteMachineOperationError } from '../../../packages/backend/dist/modules/remote/public-errors.js';
import {
	ToolBatchExecutionUnknown,
	ToolBatchCleanupFailure,
} from '../../../packages/backend/dist/modules/agent/tools/model/tool-batch-failure.js';

const bytes = Buffer.from('confirmed artifact');
const signal = new AbortController().signal;
const actor = {
	kind: 'tool',
	userId: 1,
	appId: randomUUID(),
	runId: randomUUID(),
	operationId: randomUUID(),
	operationHash: 'a'.repeat(64),
};
const operation = { ...actor, id: actor.operationId };
const facts = { identityUserId: 1, appExists: true, appEnabled: true, settingsVersion: 1, totalBytes: 0 };

async function* source() {
	yield bytes;
}

// Inject faults at storage/event boundaries while exercising the real domain owners.
function fixture({ publicationFailure, settlementFailure, detectedCleanupFailure } = {}) {
	const rows = new Map();
	const order = [];
	const model = {
		freeBytes: async () => 1024 * 1024 * 1024,

		summary: async () => ({ totalBytes: 0 }),

		create: async (_actor, id, input, kind, expiresAt, now, admit) => {
			admit(facts);
			const row = {
				id,
				...input,
				kind,
				appId: actor.appId,
				version: 1,
				status: 'staging',
				sizeBytes: input.declaredBytes,
				sha256: null,
				retained: false,
				expiresAt,
				createdAt: now,
			};
			rows.set(id, row);
			return row;
		},

		mutate: async (_actor, id, expectedVersion, now, _action, _value, admit, inspect) => {
			admit(facts);
			const row = rows.get(id);
			assert.equal(row.version, expectedVersion);
			inspect(row, 0, now());
			const claimed = { ...row, version: row.version + 1, status: 'uploading' };
			rows.set(id, claimed);
			return claimed;
		},

		write: async (_id, input) => {
			const chunks = [];
			for await (const chunk of input) chunks.push(chunk);
			return { sha256: createHash('sha256').update(Buffer.concat(chunks)).digest('hex') };
		},

		settle: async (_actor, id, _version, status, sha256) => {
			if (status === 'ready' && settlementFailure) throw settlementFailure;
			const row = { ...rows.get(id), status, sha256, version: rows.get(id).version + 1 };
			rows.set(id, row);
			order.push(status);
			return row;
		},

		getAccessible: async (_actor, id, admit, inspect) => {
			admit(facts);
			const row = rows.get(id);
			inspect(row, true);
			return row;
		},

		useDetectedContent: async (input, _signal, consume) => {
			const value = await consume('text/plain', input);
			if (detectedCleanupFailure) throw detectedCleanupFailure;
			return value;
		},
	};
	const artifacts = new ArtifactService(
		model,
		{
			frozen: async () => ({ version: 1, limits: { maxArtifactBytes: 1024 * 1024, artifactTtlSeconds: 3600 } }),
		},
		{
			publish: async () => {
				order.push('publish');
				if (publicationFailure) throw publicationFailure;
			},
		},
	);
	const captured = [];

	const record = (ids) => {
		order.push('record');
		captured.push(...ids);
	};

	return { artifacts, rows, order, captured, record };
}

await test('Artifact ready evidence precedes failing publication; uncertain ready commit records no ID', async (t) => {
	for (const phase of ['publication', 'settlement']) {
		await t.test(phase, async () => {
			const failure = new Error(phase);
			const f = fixture({ [phase + 'Failure']: failure });
			const pending = await f.artifacts.begin(actor, {
				name: 'evidence.txt',
				mediaType: 'text/plain',
				declaredBytes: bytes.length,
			});
			await assert.rejects(
				f.artifacts.upload(actor, pending.id, pending.version, source(), signal, f.record),
				(error) =>
					error instanceof AgentFailure && error.code === 'operation_unknown' && error.cause === failure,
			);
			assert.deepEqual(f.captured, phase === 'publication' ? [pending.id] : []);
			assert.deepEqual(f.order, phase === 'publication' ? ['ready', 'record', 'publish'] : []);
			await f.artifacts.close();
		});
	}
});

await test('Content image/create/present keep ready IDs and the original definite post-ready denial', async (t) => {
	for (const action of ['image', 'create', 'present']) {
		await t.test(action, async () => {
			const f = fixture();
			const providers = { generateImage: async () => ({ mediaType: 'image/png', bytes }) };
			const images = new ProviderImageService(providers, f.artifacts);
			const content = new ToolContentService(null, null, f.artifacts, providers, images);
			let input;
			if (action === 'present') {
				const pending = await f.artifacts.begin(actor, {
					name: 'existing.txt',
					mediaType: 'text/plain',
					declaredBytes: bytes.length,
				});
				const saved = await f.artifacts.upload(actor, pending.id, pending.version, source(), signal);
				input = { kind: 'artifact', action: 'present', artifactId: saved.id };
			} else if (action === 'create') {
				input = {
					kind: 'artifact',
					action: 'create',
					name: 'created.txt',
					mediaType: 'text/plain',
					base64: bytes.toString('base64'),
				};
			} else
				input = {
					kind: 'image_generate',
					input: { providerId: randomUUID(), configurationVersion: 1, modelId: 'image', prompt: 'draw' },
				};
			const denied = new AgentFailure('forbidden');
			await assert.rejects(
				content.perform(
					input,
					operation,
					1,
					signal,
					4096,
					async () => {
						if (f.captured.length) throw denied;
					},
					f.record,
				),
				(error) => error === denied,
			);
			assert.equal(f.captured.length, 1);
			assert.equal(f.rows.get(f.captured[0]).status, 'ready');
			await f.artifacts.close();
		});
	}
});

await test('Deliver retains ready evidence across detector and remote cleanup without changing cleanup category', async (t) => {
	for (const phase of ['detected', 'remote']) {
		await t.test(phase, async () => {
			const cleanup = new ToolCleanupFailure({ cause: new Error(phase) });
			const f = fixture({ detectedCleanupFailure: phase === 'detected' ? cleanup : undefined });
			const target = { id: 7, version: 1, fingerprint: 'b'.repeat(64) };
			const model = {
				remote: () => ({
					fileInfo: async () => ({ sizeBytes: bytes.length }),

					consumeFile: async (_path, _capacity, _scope, consume) => {
						await consume({ name: 'remote.txt', sizeBytes: bytes.length }, source());
						throw cleanup;
					},
				}),

				validateTarget: async () => {},
			};
			const service = new ToolRemoteService(model, null, null, f.artifacts);
			await assert.rejects(
				service.perform({ kind: 'deliver', connectionId: 7, paths: ['/remote.txt'] }, target, {
					operation,
					revision: 1,
					signal,
					limits: { toolTimeoutSeconds: 30 },

					validate: async () => {},

					recordOutputArtifacts: f.record,
				}),
				(error) => error instanceof ToolBatchCleanupFailure && error.cause === cleanup,
			);
			assert.equal(f.captured.length, 1);
			assert.equal(f.rows.get(f.captured[0]).status, 'ready');
			await f.artifacts.close();
		});
	}
});

await test('Typed batch extraction preserves complete preflight, onError and unknown cleanup progress', async (t) => {
	for (const mode of ['preflight', 'stop', 'continue', 'unknown', 'cleanup']) {
		await t.test(mode, async () => {
			const effects = [];
			const checked = [];
			const failureCode =
				mode === 'cleanup' ? 'cleanup_failed' : mode === 'unknown' ? 'operation_unknown' : 'not_found';
			const remote = new ToolRemoteModel({
				assertMissingPath: async (_scope, path) => {
					checked.push(path);
					if (mode === 'preflight' && path === '/b') throw new RemoteMachineOperationError('not_found');
				},

				writeText: async (_scope, item) => {
					assert.deepEqual(checked, ['/a', '/b', '/c']);
					effects.push(item.path);
					if (item.path === '/b') throw new RemoteMachineOperationError(failureCode);
					return { path: item.path, status: 'created', bytes: 1, sha256: 'c'.repeat(64) };
				},
			});
			const work = remote.perform(
				{
					kind: 'write',
					connectionId: 7,
					onError: mode === 'continue' ? 'continue' : 'stop',
					items: ['/a', '/b', '/c'].map((path) => ({ path, content: 'x', expectedSha256: 'absent' })),
				},
				{
					operationId: randomUUID(),
					target: { id: 7, version: 1, fingerprint: 'b'.repeat(64) },
					signal,
					timeoutMs: 30000,

					validate: async () => {},
				},
			);
			if (mode === 'unknown' || mode === 'cleanup') {
				await assert.rejects(work, (error) => {
					assert.ok(
						mode === 'cleanup'
							? error instanceof ToolBatchCleanupFailure
							: error instanceof ToolBatchExecutionUnknown,
					);
					assert.deepEqual(
						JSON.parse(error.resultText).items.map((item) => item.status),
						['completed', 'unknown', 'not_started'],
					);
					return true;
				});
			} else {
				const result = await work;
				assert.equal(result.operation, 'remote.write');
				assert.deepEqual(
					result.value.items.map((item) => item.status),
					mode === 'preflight'
						? ['not_started', 'failed', 'not_started']
						: mode === 'continue'
							? ['completed', 'failed', 'completed']
							: ['completed', 'failed', 'not_started'],
				);
			}
			assert.deepEqual(
				effects,
				mode === 'preflight' ? [] : mode === 'continue' ? ['/a', '/b', '/c'] : ['/a', '/b'],
			);
		});
	}
});
