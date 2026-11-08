import assert from 'node:assert/strict';
import { test } from 'vitest';

function gate() {
	return Promise.withResolvers();
}

test('Browser session lanes isolate pending snapshots and plugin retirement waits for admitted sessions', async () => {
	const { BrowserService } =
		await import('../../../../../packages/backend/src/modules/agent/integrations/service/browser-service.ts');
	const firstEntered = gate(),
		releaseFirst = gate(),
		secondDone = gate();
	const sessions = [];
	let retired = false;
	const service = new BrowserService(
		{
			configuration: async () => ({
				version: 1,
				targets: [
					{
						id: 'target',
						endpoints: [{ url: 'http://fixture', verifyTls: true, priority: 0 }],
						allowedUrlPatterns: [],
					},
				],
			}),

			connect: async () => {
				const index = sessions.length;
				const session = {
					closed: false,

					snapshot: async () => {
						if (index === 0) {
							firstEntered.resolve();
							await releaseFirst.promise;
						} else secondDone.resolve();
						return {
							snapshotId: 'snapshot',
							url: 'about:blank',
							title: 'lane',
							nodes: [],
							truncated: false,
						};
					},

					close: async () => {
						session.closed = true;
					},
				};
				sessions.push(session);
				return session;
			},
		},
		null,
	);
	const owner = { userId: 1, appId: 'app', runId: 'run', operationId: 'first', operationHash: 'a'.repeat(64) };
	const source = {
		instanceId: 'browser-instance',
		generation: 'browser-generation',

		read: async () => ({ revision: 1, documentJson: '{}' }),
	};
	const signal = new AbortController().signal;

	const validate = async () => {};

	const outputArtifactIds = [];

	const recordOutputArtifacts = (ids) => outputArtifactIds.push(...ids);

	try {
		const first = await service.perform(
			owner,
			source,
			{ action: 'open', targetId: 'target', expectedVersion: 1 },
			signal,
			validate,
			recordOutputArtifacts,
		);
		const second = await service.perform(
			{ ...owner, operationId: 'second' },
			source,
			{ action: 'open', targetId: 'target', expectedVersion: 1 },
			signal,
			validate,
			recordOutputArtifacts,
		);

		assert.equal(first.action, 'open');
		assert.equal(second.action, 'open');

		const snapshot = (sessionId) => ({
			action: 'snapshot',
			sessionId,
			maxNodes: 100,
		});

		const held = service.perform(
			owner,
			source,
			snapshot(first.value.sessionId),
			signal,
			validate,
			recordOutputArtifacts,
		);
		await firstEntered.promise;
		const independent = service.perform(
			owner,
			source,
			snapshot(second.value.sessionId),
			signal,
			validate,
			recordOutputArtifacts,
		);
		await independent;
		await secondDone.promise;
		const update = service
			.retireInstance({ userId: 1, appId: 'app', instanceId: source.instanceId, generation: source.generation })
			.then(() => {
				retired = true;
			});
		const stale = assert.rejects(
			service.perform(owner, source, snapshot(second.value.sessionId), signal, validate, recordOutputArtifacts),
			(error) => error.code === 'not_found',
		);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(retired, false, 'configuration cannot retire a context with an admitted snapshot');
		const independentCatalog = await service.catalog({ ...source, instanceId: 'other-instance' }, signal, validate);
		assert.equal(
			independentCatalog.targets[0].targetId,
			'target',
			'Retiring one instance does not stall another instance behind its pending snapshot',
		);
		releaseFirst.resolve();
		await held;
		await update;
		await stale;
		assert.equal(retired, true);
		assert.ok(sessions.every((session) => session.closed));
		assert.deepEqual(outputArtifactIds, [], 'open and snapshot do not publish artifacts');
	} finally {
		releaseFirst.resolve();
		await service.close();
	}
});

test('Browser plugin configuration isolates instances, fences stale revisions and retires only the exact generation', async () => {
	const { BrowserService } =
		await import('../../../../../packages/backend/src/modules/agent/integrations/service/browser-service.ts');
	const { BrowserModel } =
		await import('../../../../../packages/backend/src/modules/agent/integrations/model/browser-model.ts');
	const { AgentFailure } = await import('../../../../../packages/backend/src/modules/agent/agent-failure.ts');
	const connections = [];
	const model = new BrowserModel({
		connect: async (input) => {
			const connection = {
				endpoint: input.endpoint,
				closed: false,

				close: async () => {
					connection.closed = true;
				},
			};
			connections.push(connection);
			return connection;
		},
	});
	const service = new BrowserService(model, null);
	let revision = 1;

	const source = (instanceId, generation = 'generation') => ({
		instanceId,
		generation,

		read: async () => ({
			revision,
			documentJson: JSON.stringify({
				targets: [
					{
						id: instanceId,
						endpoints: [
							{
								url: 'wss://' + instanceId + '.example/cdp',
								priority: 800,
								allowPlaintext: false,
								verifyTls: true,
							},
						],
						allowedUrlPatterns: ['https://' + instanceId + '.example/*'],
					},
				],
			}),
		}),
	});

	const firstSource = source('first'),
		secondSource = source('second');
	const owner = { userId: 1, appId: 'app', runId: 'run', operationId: 'operation', operationHash: 'a'.repeat(64) };
	const signal = new AbortController().signal;

	const validate = async () => {};

	const open = (config, targetId) =>
		service.perform(
			owner,
			config,
			{ action: 'open', targetId, expectedVersion: revision },
			signal,
			validate,
			() => {},
		);

	try {
		assert.deepEqual(
			(await service.catalog(firstSource, signal, validate)).targets.map((target) => target.targetId),
			['first'],
		);
		assert.deepEqual(
			(await service.catalog(secondSource, signal, validate)).targets.map((target) => target.targetId),
			['second'],
		);
		await assert.rejects(open(firstSource, 'second'), (error) => error.code === 'not_found');
		const first = await open(firstSource, 'first'),
			second = await open(secondSource, 'second');
		await assert.rejects(
			service.perform(
				owner,
				secondSource,
				{ action: 'close', sessionId: first.value.sessionId },
				signal,
				validate,
				() => {},
			),
			(error) => error.code === 'not_found',
		);
		await service.retireInstance({ userId: 1, appId: 'app', instanceId: 'first', generation: 'other' });
		assert.equal(connections[0].closed, false);
		await service.retireInstance({
			userId: 1,
			appId: 'app',
			instanceId: 'first',
			generation: firstSource.generation,
		});
		assert.equal(connections[0].closed, true);
		assert.equal(connections[1].closed, false);
		revision++;
		await assert.rejects(
			service.perform(
				owner,
				secondSource,
				{ action: 'console', sessionId: second.value.sessionId, after: 0, limit: 1 },
				signal,
				validate,
				() => {},
			),
			(error) => error.code === 'version_conflict',
		);
		const revoked = {
			instanceId: 'revoked',
			generation: 'old',

			read: async () => {
				throw new AgentFailure('version_conflict');
			},
		};
		await assert.rejects(service.catalog(revoked, signal, validate), (error) => error.code === 'version_conflict');
		service.quiesce();
		await service.retireInstance({
			userId: 1,
			appId: 'app',
			instanceId: 'second',
			generation: secondSource.generation,
		});
		assert.equal(connections[1].closed, true, 'Global shutdown and instance retirement share real cleanup');
	} finally {
		await service.close();
	}
});
