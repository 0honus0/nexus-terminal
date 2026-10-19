import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AcpPermissionService } from '../../../packages/backend/dist/modules/agent/tools/service/acp-permission-service.js';
import { ToolJobService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-job-service.js';
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
				timeoutMs: 30000,

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
					return result;
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
		} else {
			assert.deepEqual(changes, ['dispatched'], 'no guessed follow-up settlement after storage failure');
			assert.ok(contains(outcome, authorityFailure));
			if (mode === 'execution-and-storage-failure') {
				assert.ok(contains(outcome, operationFailure));
			}
		}
	});
}
