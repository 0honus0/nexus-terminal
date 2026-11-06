import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AcpPermissionService } from '../../../packages/backend/dist/modules/agent/tools/service/acp-permission-service.js';
import { ToolJobService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-job-service.js';
import { ToolService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-service.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
} from '../../../packages/backend/dist/modules/agent/agent-failure.js';

function gate() {
	let resolve;
	const promise = new Promise((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

const scope = { userId: 1, appId: randomUUID(), runId: randomUUID() };
const target = { id: 1, version: 1, fingerprint: 'controlled-target' };
const result = { status: 'completed', exitCode: 0, signal: null, stdout: 'done', stderr: '', truncated: false };

await test('Shell Job authority tolerates only its own dispatched-to-delivered revision race', async () => {
	const original = { ...scope, id: randomUUID(), state: 'dispatched', revision: 2, operationHash: 'a'.repeat(64) };
	for (const mode of [
		'delivered',
		'policy-revoked',
		'hash-changed',
		'unexpected-revision',
		'terminal-failed',
		'storage-failed',
	]) {
		let checks = 0;
		const storageFailure = new AgentFailure('storage_unavailable');
		const delivered = {
			...original,
			state: mode === 'terminal-failed' ? 'failed' : 'completed',
			revision: mode === 'unexpected-revision' ? 4 : 3,
			operationHash: mode === 'hash-changed' ? 'b'.repeat(64) : original.operationHash,
		};
		const service = {
			verify: ToolService.prototype.verify,
			journal: {
				async get() {
					if (mode === 'storage-failed') {
						throw storageFailure;
					}
					return delivered;
				},
			},
			governance: {
				async toolAuthority(identity, task) {
					checks++;
					assert.equal(task.policyRevision, 1);
					return checks === 1 || mode === 'policy-revoked' ? null : { operation: delivered };
				},
			},
		};
		const work = ToolService.prototype.verifyJob.call(service, original, 1, new AbortController().signal);
		if (mode === 'delivered') {
			await work;
			assert.equal(checks, 2);
		} else {
			await assert.rejects(work, (error) =>
				mode === 'storage-failed'
					? error === storageFailure
					: error instanceof AgentFailure && error.code === 'version_conflict',
			);
			assert.equal(checks, mode === 'policy-revoked' ? 2 : 1);
		}
	}
});

await test('Shell Job list paginates beyond the former history cap without losing a continuation', async () => {
	const jobs = Array.from({ length: 65 }, (_, index) => ({
		...scope,
		id: randomUUID(),
		connectionId: target.id,
		targetVersion: target.version,
		fingerprint: target.fingerprint,
		state: 'completed',
		revision: 1,
		createdAt: index,
		updatedAt: index,
	}));
	const service = new ToolJobService({
		async list(_scope, _target, limit, offset) {
			return jobs.slice(offset, offset + limit + 1);
		},
	});
	const first = JSON.parse(
		await service.control(
			scope,
			target,
			{ action: 'list', jobIds: [], waitSeconds: 0, offset: 0 },
			new AbortController().signal,
			async () => {},
			1000,
		),
	);
	assert.equal(first.jobs.length, 64);
	assert.equal(first.nextOffset, 64);
	const second = JSON.parse(
		await service.control(
			scope,
			target,
			{ action: 'list', jobIds: [], waitSeconds: 0, offset: first.nextOffset },
			new AbortController().signal,
			async () => {},
			1000,
		),
	);
	assert.equal(second.jobs.length, 1);
	assert.equal(second.jobs[0].jobId, jobs[64].id);
	assert.equal(second.nextOffset, null);
});

function contains(value, failure) {
	return (
		value === failure ||
		(value instanceof AggregateError && value.errors.some((item) => contains(item, failure))) ||
		(value instanceof Error && value.cause !== undefined && contains(value.cause, failure))
	);
}

for (const mode of [
	'success',
	'late-storage-failure',
	'execution-and-storage-failure',
	'cancellation-and-permission-failure',
]) {
	await test('ACP waits for its in-flight real-interval authority monitor: ' + mode, async (t) => {
		const release = gate();
		const work = gate();
		t.after(() => {
			release.resolve();
			work.resolve();
		});
		const entered = gate();
		const final = gate();
		const external = new AbortController();
		const authorityFailure = new AgentFailure(
			mode === 'cancellation-and-permission-failure' ? 'approval_stale' : 'storage_unavailable',
		);
		const operationFailure =
			mode === 'cancellation-and-permission-failure' ? new ToolExecutionUnknown() : new ToolCleanupFailure();
		let validations = 0;
		let settled = false;
		const task = new AcpPermissionService(null, null)
			.execute(
				scope,
				target,
				1,
				external.signal,
				30000,
				async () => {
					validations += 1;
					if (validations === 2) {
						entered.resolve();
						await release.promise;
						if (mode !== 'success') {
							throw authorityFailure;
						}
					}
					if (validations >= 3) {
						final.resolve();
					}
				},
				async () => {
					await work.promise;
					if (mode.endsWith('permission-failure') || mode === 'execution-and-storage-failure') {
						throw operationFailure;
					}
					return 'actual operation complete';
				},
			)
			.then(
				(value) => ({ value }),
				(error) => ({ error }),
			)
			.then((outcome) => {
				settled = true;
				return outcome;
			});
		await entered.promise;
		if (mode === 'cancellation-and-permission-failure') {
			external.abort();
		}
		work.resolve();
		if (mode === 'success' || mode === 'late-storage-failure') {
			await final.promise;
		}
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, false, 'work completion does not bypass the already-running authority check');
		release.resolve();
		const outcome = await task;
		if (mode === 'success') {
			assert.equal(outcome.value, 'actual operation complete');
		} else {
			assert.ok(contains(outcome.error, authorityFailure));
			if (mode === 'execution-and-storage-failure' || mode === 'cancellation-and-permission-failure') {
				assert.ok(contains(outcome.error, operationFailure));
			}
			if (mode === 'execution-and-storage-failure') {
				assert.ok(outcome.error instanceof AggregateError);
			}
			if (mode === 'cancellation-and-permission-failure') {
				assert.ok(outcome.error instanceof ToolExecutionUnknown);
			}
		}
	});
}

for (const mode of ['success', 'late-storage-failure', 'execution-and-storage-failure']) {
	await test('Job settlement waits for its in-flight real-interval authority monitor: ' + mode, async (t) => {
		const release = gate();
		const work = gate();
		t.after(() => {
			release.resolve();
			work.resolve();
		});
		const entered = gate();
		const final = gate();
		const authorityFailure = new AgentFailure('storage_unavailable');
		const operationFailure = new ToolCleanupFailure();
		const changes = [];
		const notifications = [];
		const job = {
			...scope,
			id: randomUUID(),
			connectionId: 1,
			targetVersion: 1,
			fingerprint: target.fingerprint,
			policyRevision: 1,
			state: 'queued',
			revision: 1,
			result: null,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		const service = new ToolJobService({
			async openOutput() {
				return {
					append: async () => {},

					flush: async () => {},

					close: async () => {},
				};
			},

			async create() {
				return job;
			},

			async change(previous, state, value) {
				changes.push(state);
				return { ...previous, state, result: value, revision: previous.revision + 1 };
			},
		});
		let validations = 0;
		const accepted = JSON.parse(
			await service.prepare({
				operation: { ...scope, id: job.id },
				target,
				policyRevision: 1,
				signal: new AbortController().signal,
				deadlineAt: Date.now() + 30000,
				maxHistory: 64,

				onFailure(error) {
					notifications.push(error);
				},

				async validate() {
					validations += 1;
					if (validations === 3) {
						entered.resolve();
						await release.promise;
						if (mode !== 'success') {
							throw authorityFailure;
						}
					}
					if (validations >= 4) {
						final.resolve();
					}
				},

				async work() {
					await work.promise;
					if (mode === 'execution-and-storage-failure') {
						throw operationFailure;
					}
					return { status: result.status, commands: [{ index: 0, ...result }] };
				},
			}),
		);
		service.launch(accepted.jobId);
		await entered.promise;
		work.resolve();
		if (mode !== 'execution-and-storage-failure') {
			await final.promise;
		}
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(changes, ['dispatched'], 'no durable terminal state while authority remains in flight');
		assert.deepEqual(notifications, [], 'No failure is delivered before monitor and cleanup settle');
		let drained = false;
		const drain = service.drain(scope).then(
			() => (drained = true),
			(error) => {
				drained = true;
				return error;
			},
		);
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(drained, false);
		release.resolve();
		const outcome = await drain;
		if (mode === 'success') {
			assert.deepEqual(changes, ['dispatched', 'completed']);
			assert.deepEqual(notifications, []);
		} else {
			assert.deepEqual(changes, ['dispatched'], 'no guessed follow-up settlement after storage failure');
			assert.ok(contains(outcome, authorityFailure));
			assert.equal(notifications.length, 1);
			assert.ok(contains(notifications[0], authorityFailure));
			if (mode === 'execution-and-storage-failure') {
				assert.ok(contains(outcome, operationFailure));
			}
		}
	});
}

for (const action of ['list', 'status', 'wait', 'cancel']) {
	await test('Unknown Job ' + action + ' stops observation instead of returning a pollable result', async () => {
		const job = {
			...scope,
			id: randomUUID(),
			connectionId: target.id,
			targetVersion: target.version,
			fingerprint: target.fingerprint,
			state: 'unknown',
		};
		const service = new ToolJobService({
			async get() {
				return job;
			},

			async list() {
				return [job];
			},
		});
		await assert.rejects(
			service.control(
				scope,
				target,
				{ action, jobIds: [job.id], waitSeconds: 30, offset: 0 },
				new AbortController().signal,
				async () => {},
				1000,
			),
			ToolExecutionUnknown,
		);
	});
}
