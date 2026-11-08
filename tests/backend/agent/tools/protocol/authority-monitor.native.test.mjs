import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { currentOperation } from '../../../../../packages/backend/dist/modules/agent/operations/adapters/sqlite/current-operation-sql.js';
import { RunChanges } from '../../../../../packages/backend/dist/modules/agent/runs/model/run-changes.js';
import { PluginServiceTransportOwner } from '../../../../../packages/backend/dist/modules/agent/plugins/service/plugin-service-transport.js';
import { ToolJobService } from '../../../../../packages/backend/dist/modules/agent/tools/service/tool-job-service.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
} from '../../../../../packages/backend/dist/modules/agent/agent-failure.js';

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

await test(
	'Shell Job authority reuses only the current completed effect and its committed dispatch proof',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'effect-authority-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd, { discover: 'file_write' });
		t.after(() => f.close());
		const run = await f.start('Retain the original dispatch authority', (results) =>
			results.length
				? { hold: true }
				: {
						name: 'file_write',
						input: {
							connectionId: f.connectionId,
							items: [
								{
									path: join(directory, 'effect.txt'),
									content: 'confirmed effect',
									expectedSha256: 'absent',
								},
							],
						},
					},
		);
		await f.approve(await f.approval(run, 'file_write'));
		await until(
			() => f.heldModelCount,
			(count) => count === 1,
			'The App is active after the confirmed effect',
		);
		const db = new DatabaseSync(f.database);
		try {
			const effect = db
				.prepare("SELECT * FROM agent_operations WHERE run_id=? AND label='remote.write'")
				.get(run.id);
			assert.equal(effect.state, 'completed');
			const identity = {
				userId: effect.user_id,
				appId: effect.app_id,
				runId: effect.run_id,
				operationId: effect.id,
				operationHash: effect.request_hash,
			};
			const tx = { one: async (sql, values) => db.prepare(sql).get(...values) ?? null };
			const original = await currentOperation(tx, identity, { labels: ['remote.write'], allowCompleted: true });
			assert.equal(original.operation.id, effect.id);
			assert.equal(original.operation.scope.executionGeneration, effect.execution_generation);
			assert.equal(await currentOperation(tx, identity, { labels: ['remote.write'] }), null);
			assert.equal(
				await currentOperation(
					tx,
					{ ...identity, operationHash: '0'.repeat(64) },
					{ labels: ['remote.write'], allowCompleted: true },
				),
				null,
			);
			for (const [name, sql, values] of [
				[
					'policy revoked',
					'UPDATE agent_governance_policies SET policy_revision=policy_revision+1 WHERE app_id=?',
					[f.appId],
				],
				[
					'effect hash changed',
					'UPDATE agent_operations SET request_hash=? WHERE id=?',
					['0'.repeat(64), effect.id],
				],
				[
					'effect failed',
					"UPDATE agent_operations SET state='failed',result_json=NULL,failure_code='forbidden' WHERE id=?",
					[effect.id],
				],
				['target changed', 'UPDATE connections SET version=version+1 WHERE id=?', [f.connectionId]],
				['execution closed', "UPDATE agent_run_executions SET state='closed' WHERE run_id=?", [run.id]],
				[
					'parent failed',
					"UPDATE agent_operations SET state='failed',result_json=NULL,failure_code='forbidden' WHERE id=?",
					[effect.parent_id],
				],
				['App disabled', 'UPDATE agent_apps SET enabled=0 WHERE id=?', [f.appId]],
				[
					'approval superseded',
					"UPDATE agent_operation_approvals SET status='superseded' WHERE operation_id=?",
					[effect.id],
				],
			]) {
				db.exec('SAVEPOINT authority_test');
				try {
					assert.equal(db.prepare(sql).run(...values).changes, 1, name);
					assert.equal(
						await currentOperation(tx, identity, { labels: ['remote.write'], allowCompleted: true }),
						null,
						name,
					);
				} finally {
					db.exec('ROLLBACK TO authority_test');
					db.exec('RELEASE authority_test');
				}
			}
		} finally {
			db.close();
		}
		f.finishModels();
		await f.wait(run, 'completed');
	},
);

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
	const first = await service.control(
		scope,
		target,
		{ action: 'list', jobIds: [], waitSeconds: 0, offset: 0 },
		new AbortController().signal,
		async () => {},
		1000,
	);
	assert.equal(first.jobs.length, 64);
	assert.equal(first.nextOffset, 64);
	const second = await service.control(
		scope,
		target,
		{ action: 'list', jobIds: [], waitSeconds: 0, offset: first.nextOffset },
		new AbortController().signal,
		async () => {},
		1000,
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

for (const mode of ['success', 'late-storage-failure', 'cancellation', 'cleanup-failure']) {
	await test('Service transport closes only after its in-flight authority check: ' + mode, async (t) => {
		const entered = gate();
		const release = gate();
		const external = new AbortController();
		const authorityFailure = new AgentFailure('storage_unavailable');
		const cleanupFailure = new ToolCleanupFailure();
		let armed = false;
		let validations = 0;
		let closed = 0;
		const owner = new PluginServiceTransportOwner(
			{
				signal: external.signal,

				async validate() {
					if (!armed) return;
					validations++;
					if (validations === 2) {
						entered.resolve();
						await release.promise;
						if (mode === 'late-storage-failure') throw authorityFailure;
					}
				},

				transport: {
					kind: 'http',
					options: {
						url: 'https://example.test/',
						headers: [],
						privateAuthorities: [],
						maxResponseBytes: 1024,
					},
				},
			},
			() => ({
				async close() {
					if (mode === 'cleanup-failure') throw cleanupFailure;
				},

				async request() {
					return {
						status: 200,
						statusText: 'OK',
						headers: [],
						hasBody: true,

						async read() {
							return { bytes: Buffer.from('confirmed response'), eof: true };
						},

						async close() {
							closed++;
						},
					};
				},
			}),
		);
		t.after(async () => {
			release.resolve();
			await owner.close().catch((error) => {
				if (mode !== 'cleanup-failure') throw error;
			});
		});
		const opened = await owner.dispatch({ method: 'transport.http.open', params: { grant: owner.facts.grant } });
		const response = await owner.dispatch({
			method: 'transport.http.request',
			params: { leaseId: opened.value.leaseId, method: 'GET', headers: [], bodyUtf8: null },
		});
		armed = true;
		let settled = false;
		const reading = owner
			.dispatch({ method: 'transport.http.read', params: { requestId: response.value.requestId } })
			.then(
				(value) => ({ value }),
				(error) => ({ error }),
			)
			.then((result) => {
				settled = true;
				return result;
			});
		await entered.promise;
		assert.equal(settled, false, 'Received bytes cannot bypass the pending authority check');
		let closing = null;
		let drained = false;
		if (mode === 'cancellation' || mode === 'cleanup-failure') {
			if (mode === 'cancellation') external.abort();
			closing = owner.close().then(
				() => {
					drained = true;
					return null;
				},
				(error) => {
					drained = true;
					return error;
				},
			);
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(drained, false, 'The owner must join the in-flight request before reporting closure');
		}
		release.resolve();
		const outcome = await reading;
		if (mode === 'success') {
			assert.equal(Buffer.from(outcome.value.value.bytesBase64, 'base64').toString(), 'confirmed response');
		} else if (mode === 'late-storage-failure') {
			assert.ok(contains(outcome.error, authorityFailure));
		} else {
			assert.ok(outcome.error instanceof AgentFailure && outcome.error.code === 'forbidden');
		}
		if (closing) {
			const error = await closing;
			if (mode === 'cleanup-failure') assert.ok(contains(error, cleanupFailure));
			else assert.equal(error, null);
		}
		assert.ok(closed > 0);
	});
}

for (const mode of ['success', 'late-storage-failure', 'execution-and-storage-failure']) {
	await test('Job settlement waits for its in-flight event authority check: ' + mode, async (t) => {
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
		const events = new RunChanges();
		const service = new ToolJobService(
			{
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
			},
			events,
		);
		let validations = 0;
		const accepted = await service.prepare({
			background: true,
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
		});
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
