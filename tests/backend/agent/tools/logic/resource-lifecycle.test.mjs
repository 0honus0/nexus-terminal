import assert from 'node:assert/strict';
import { afterEach, onTestFinished, test, vi } from 'vitest';

afterEach(() => vi.useRealTimers());
import { randomUUID } from 'node:crypto';
import { ToolModel } from '../../../../../packages/backend/dist/modules/agent/tools/model/tool-model.js';
import { RunToolResources } from '../../../../../packages/backend/dist/modules/agent/tools/service/run-tool-resources.js';
import { DefaultToolResources } from '../../../../../packages/backend/dist/modules/agent/tools/service/default-tool-resources.js';
import { RunResourceService } from '../../../../../packages/backend/dist/modules/agent/runs/service/run-resource-service.js';
import { RunChanges } from '../../../../../packages/backend/dist/modules/agent/runs/model/run-changes.js';
import { RemoteMachineOperationError } from '../../../../../packages/backend/dist/modules/remote/public-errors.js';
import { ToolCleanupFailure } from '../../../../../packages/backend/dist/modules/agent/agent-failure.js';

function resourceFixture({ cleanupFails = false } = {}) {
	const scope = { userId: 1, appId: randomUUID(), runId: randomUUID() };
	let resources;
	let closes = 0;
	let cancellations = 0;
	let jobs = 0;
	let waitingOutputJobs = 0;
	const model = new ToolModel(
		null,
		null,
		{
			create: () => ({
				snapshot: () => ({
					sshConnections: 1,
					sftpChannels: 1,
					activeOperations: 0,
					targetIds: [1],
					closing: false,
					cleanupFailed: false,
				}),

				close: async () => {
					closes++;
					if (cleanupFails) throw new RemoteMachineOperationError('cleanup_failed');
				},
			}),
		},
		null,
		(owner) => resources?.changed(owner),
	);
	const runtimeResources = new DefaultToolResources(
		model,
		{
			drain: async () => {},

			backgroundCount: () => jobs,

			waitingOutputCount: () => waitingOutputJobs,
		},
		{
			drainRun: async () => {},

			count: () => 1,
		},
		{
			drainRun: async () => {},

			sessionCount: () => 1,
		},
	);
	const tools = new RunToolResources(runtimeResources);
	const run = { id: scope.runId, status: 'running', version: 9 };
	const runs = {
		get: async () => run,

		cancelResource: async () => {
			cancellations++;
			run.status = 'cancelled';
			return { status: 'cancelled', run };
		},
	};
	resources = new RunResourceService(
		runs,
		{
			activeRoots: () => [scope.runId],

			waitChildren: async () => {},
		},
		tools,
		{ listChildren: async () => [] },
		new RunChanges(),
	);
	onTestFinished(() =>
		resources.close().catch((error) => {
			if (!cleanupFails) throw error;
		}),
	);
	return {
		scope,
		resources,
		model,
		tools,

		counts: () => ({ closes, cancellations }),

		waitingOutput: (count) => {
			waitingOutputJobs = count;
		},

		jobs: (count) => {
			jobs = count;
			model.touch(scope);
		},
	};
}

test('Resource lifecycle: tool activity renews ten-minute idle expiration and never cancels model thinking', async () => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout'], now: 1000 });
	const f = resourceFixture();
	const release = f.model.activity(f.scope);
	vi.advanceTimersByTime(700000);
	assert.equal(f.counts().closes, 0, 'active work cannot expire');
	release();
	const first = f.resources.read(f.scope, [])[0];
	assert.equal(first.expiresAt, Date.now() + 600000);
	assert.equal(first.resource.protocolSessions, 1);
	assert.equal(first.waitingOutputJobs, 0);
	f.waitingOutput(1);
	assert.equal(f.resources.read(f.scope, [])[0].waitingOutputJobs, 1);
	f.waitingOutput(0);
	assert.equal(f.resources.read(f.scope, [])[0].waitingOutputJobs, 0);
	vi.advanceTimersByTime(599999);
	assert.equal(f.counts().closes, 0);
	f.model.touch(f.scope);
	vi.advanceTimersByTime(599999);
	assert.equal(f.counts().closes, 0, 'a later tool extends the full fixed period');
	vi.advanceTimersByTime(1);
	await new Promise(setImmediate);
	assert.equal(f.counts().closes, 1);
	assert.equal(f.counts().cancellations, 0);
	assert.equal(f.tools.resource(f.scope), null);
	const oldId = first.resource.id;
	const next = f.model.activity(f.scope);
	next();
	assert.notEqual(f.tools.resource(f.scope).id, oldId, 'later tools receive a new exact resource owner');
	await f.tools.drainRun(f.scope);
});

test('Resource lifecycle: background jobs protect resources and completion renews the idle period', async () => {
	vi.useFakeTimers({ toFake: ['Date', 'setTimeout'], now: 1000 });
	const f = resourceFixture();
	const release = f.model.activity(f.scope);
	release();
	f.jobs(1);
	vi.advanceTimersByTime(1200000);
	assert.equal(f.counts().closes, 0);
	assert.equal(f.resources.read(f.scope, [])[0].expiresAt, null);
	f.jobs(0);
	vi.advanceTimersByTime(599999);
	assert.equal(f.counts().closes, 0);
	vi.advanceTimersByTime(1);
	await new Promise(setImmediate);
	assert.equal(f.counts().closes, 1);
});

test('Resource lifecycle: stale resource closure cannot cancel or close a replacement; current closure requires confirmation', async () => {
	const f = resourceFixture();
	const release = f.model.activity(f.scope);
	release();
	const id = f.tools.resource(f.scope).id;
	assert.equal(
		(
			await f.resources.closeResources(1, f.scope.appId, {
				target: { kind: 'session', runId: f.scope.runId, sessionId: randomUUID() },
				confirmed: true,
			})
		).status,
		'closed',
	);
	assert.deepEqual(f.counts(), { closes: 0, cancellations: 0 });
	const request = { target: { kind: 'session', runId: f.scope.runId, sessionId: id }, confirmed: false };
	assert.equal((await f.resources.closeResources(1, f.scope.appId, request)).status, 'confirmation_required');
	assert.deepEqual(f.counts(), { closes: 0, cancellations: 0 });
	assert.equal(
		(await f.resources.closeResources(1, f.scope.appId, { ...request, confirmed: true })).status,
		'closed',
	);
	assert.deepEqual(f.counts(), { closes: 1, cancellations: 1 });
});

test('Resource lifecycle: cleanup failure retains the owner and concurrent closes share the same failure', async () => {
	const f = resourceFixture({ cleanupFails: true });
	const release = f.model.activity(f.scope);
	release();
	const first = f.tools.drainRun(f.scope);
	assert.strictEqual(f.tools.drainRun(f.scope), first);
	await assert.rejects(first, (error) => error instanceof ToolCleanupFailure);
	assert.equal(f.tools.resource(f.scope).phase, 'cleanup_failed');
	assert.throws(() => f.model.activity(f.scope));
	assert.equal(f.counts().closes, 1);
});
