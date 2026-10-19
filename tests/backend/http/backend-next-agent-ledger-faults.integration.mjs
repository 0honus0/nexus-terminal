import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SqliteGovernanceStorage } from '../../../packages/backend/dist/modules/agent/governance/adapters/sqlite/governance-sql.js';
import { SqliteRunToolStorage } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-sql.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until } from '../remote/openssh-fixture.mjs';

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
			const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-tool-ledger-'));
			let sshd;
			let f;
			const lost = new SqliteFailure('commit_unknown');
			try {
				sshd = await openSshd(directory);
				f = await openAgentExecution(directory, sshd);
				const path = join(directory, 'effect.txt');
				let commits = 0;
				let compensations = 0;
				const finish = SqliteRunToolStorage.prototype.finish;
				t.mock.method(SqliteRunToolStorage.prototype, 'finish', function (...args) {
					compensations += 1;
					return finish.apply(this, args);
				});
				const method = phase === 'approval-dispatch' ? 'consumeApproval' : 'toolAuthority';
				const original = SqliteGovernanceStorage.prototype[method];
				t.mock.method(SqliteGovernanceStorage.prototype, method, async function (...args) {
					const result = await original.apply(this, args);
					if (
						result &&
						(phase === 'approval-dispatch' ||
							args[1].kind === (phase === 'completion' ? 'complete' : 'dispatch'))
					) {
						commits += 1;
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
										? { connectionId: f.connectionId, path: directory }
										: {
												connectionId: f.connectionId,
												path,
												content: 'committed once',
												expectedSha256: 'absent',
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
				await f.restart({ verifyCloseFailure: (error) => causes(error).has(lost) });
				assert.equal(compensations, 0, 'Unknown durable commit cannot trigger speculative Tool settlement');
				assert.equal(f.calls.length, 1, 'No next model step or automatic operation replay');
				const stored = f.rows('agent_run_tools', run);
				assert.equal(stored.length, 1);
				assert.equal(stored[0].state, phase === 'completion' ? 'completed' : 'unknown');
				await f.wait(run, 'unknown');
				if (phase === 'completion') {
					assert.equal(await readFile(path, 'utf8'), 'committed once');
					assert.ok(stored[0].result_text);
				} else {
					await assert.rejects(stat(path), { code: 'ENOENT' });
				}
				t.mock.restoreAll();
			} finally {
				t.mock.restoreAll();
				const failures = [];
				if (f) {
					try {
						await f.close();
					} catch (error) {
						failures.push(error);
					}
				}
				for (const close of [() => sshd?.close(), () => rm(directory, { recursive: true, force: true })]) {
					try {
						await close();
					} catch (error) {
						failures.push(error);
					}
				}
				if (failures.length) {
					throw new AggregateError(failures, 'Tool ledger fixture cleanup failed');
				}
			}
		},
	);
}
