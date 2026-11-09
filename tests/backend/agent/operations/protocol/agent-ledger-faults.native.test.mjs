import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SqliteOperationStorage } from '../../../../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-sql.js';
import { SqliteFailure } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, until } from '../../../../support/protocols/openssh-fixture.mjs';

function causes(error) {
	const pending = [error];
	const found = new Set();
	for (const item of pending) {
		if (found.has(item)) {
			continue;
		}
		found.add(item);
		if (item instanceof AggregateError) {
			pending.push(...item.errors);
		}
		if (item instanceof Error && item.cause) {
			pending.push(item.cause);
		}
	}
	return found;
}

for (const phase of ['read-dispatch', 'approval-dispatch', 'completion']) {
	await test(
		'Actual Tool ledger ' + phase + ' commit with lost acknowledgement never repeats the original operation',
		async (t) => {
			const directory = await mkdtemp(
				join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-b10-tool-ledger-'),
			);
			let sshd;
			let f;
			const lost = new SqliteFailure('commit_unknown');
			let primaryFailure;
			try {
				sshd = await openSshd(directory);
				f = await openAgentExecution(directory, sshd, {
					discover: 'file_inspect file_write',
					plugin: { selectedRootIds: ['nexus.tools.remote', 'nexus.tools.agent'], uiPackageId: null },
				});
				const path = join(directory, 'effect.txt');
				let commits = 0;
				let compensations = 0;
				const finish = SqliteOperationStorage.prototype.finish;
				t.mock.method(SqliteOperationStorage.prototype, 'finish', function (...args) {
					if (
						f.operations({ id: args[0].runId }).find((row) => row.id === args[1])?.label ===
						(phase === 'read-dispatch' ? 'remote.inspect' : 'remote.write')
					)
						compensations++;
					return finish.apply(this, args);
				});
				const method = phase === 'completion' ? 'finish' : 'dispatch';
				const original = SqliteOperationStorage.prototype[method];
				t.mock.method(SqliteOperationStorage.prototype, method, async function (...args) {
					const result = await original.apply(this, args);
					if (
						result.status === 'ok' &&
						result.operation.label === (phase === 'read-dispatch' ? 'remote.inspect' : 'remote.write')
					) {
						commits++;
						throw lost;
					}
					return result;
				});
				const run = await f.start('ledger-' + phase, (results) =>
					results.length
						? {}
						: {
								name: phase === 'read-dispatch' ? 'file_inspect' : 'file_write',
								input:
									phase === 'read-dispatch'
										? { connectionId: f.connectionId, paths: [directory] }
										: {
												connectionId: f.connectionId,
												items: [{ path, content: 'committed once', expectedSha256: 'absent' }],
											},
							},
				);
				if (phase !== 'read-dispatch') {
					await f.approve(await f.approval(run, 'file_write'));
				}
				await until(
					() => commits,
					(value) => value === 1,
					'Original SQLite transaction completed before acknowledgement was lost',
				);
				await f.wait(run, 'unknown');
				await f.restart({ verifyCloseFailure: (error) => causes(error).has(lost) });
				assert.equal(
					compensations,
					phase === 'completion' ? 1 : 0,
					'Unknown durable commit cannot trigger another native settlement',
				);
				assert.equal(f.calls.length, 2, 'Discovery followed by the original domain call; no automatic replay');
				const stored = f
					.operations(run)
					.filter((row) => row.label === (phase === 'read-dispatch' ? 'remote.inspect' : 'remote.write'));
				assert.equal(stored.length, 1);
				assert.equal(stored[0].state, phase === 'completion' ? 'completed' : 'unknown');
				await f.wait(run, 'unknown');
				if (phase === 'completion') {
					assert.equal(await readFile(path, 'utf8'), 'committed once');
					assert.ok(stored[0].result_json);
				} else {
					await assert.rejects(stat(path), { code: 'ENOENT' });
				}
				t.mock.restoreAll();
			} catch (error) {
				primaryFailure = error;
				throw error;
			} finally {
				t.mock.restoreAll();
				const failures = [];
				for (const close of [() => f?.close(), () => sshd?.close()]) {
					try {
						await close();
					} catch (error) {
						failures.push(error);
					}
				}
				if (failures.length) {
					throw new AggregateError(
						primaryFailure ? [primaryFailure, ...failures] : failures,
						'Tool ledger fixture cleanup failed',
					);
				}
			}
		},
	);
}
