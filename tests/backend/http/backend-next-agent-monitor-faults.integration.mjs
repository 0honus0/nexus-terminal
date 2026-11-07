import { posixCommand } from '../../support/posix-command.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SqliteGovernanceStorage } from '../../../packages/backend/dist/modules/agent/governance/adapters/sqlite/governance-sql.js';
import { RunChanges } from '../../../packages/backend/dist/modules/agent/runs/model/run-changes.js';
import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import { configureProtocol } from './agent-protocol-fixture.mjs';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../remote/openssh-fixture.mjs';

function contains(error, target) {
	return (
		error === target ||
		(error instanceof AggregateError && error.errors.some((item) => contains(item, target))) ||
		(error instanceof Error && error.cause !== undefined && contains(error.cause, target))
	);
}

for (const mode of ['acp', 'job']) {
	await test(
		'Actual SSH ' + mode + ' process failure waits for its persistent in-flight authority monitor',
		async (t) => {
			let release;
			const gate = new Promise((resolve) => {
				release = resolve;
			});
			const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-agent-monitor-'));
			let f;
			let sshd;
			let pid;
			let processStart;
			const failure = new SqliteFailure('unavailable');
			try {
				sshd = await openSshd(directory);
				f = await openAgentExecution(
					directory,
					sshd,
					mode === 'acp'
						? {
								discover: 'acp_execute',
								plugin: {
									selectedRootIds: [
										'nexus.tools.agent',
										'nexus.tools.integrations',
										'nexus.services.acp',
									],
								},
							}
						: { discover: 'shell_execute' },
				);
				if (mode === 'acp') {
					await f.grants(['integration.acp.invoke', 'service.transport.process', 'context.read']);
				}
				const pidPath = join(directory, 'original.pid');
				const script = join(directory, 'external.mjs');
				await writeFile(
					script,
					mode === 'job'
						? `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));setInterval(()=>{},1000);`
						: `
import fs from 'node:fs';
import {createInterface} from 'node:readline';
for await (const line of createInterface({input:process.stdin})) {
 const msg=JSON.parse(line);
 if(msg.method==='session/prompt') fs.writeFileSync(${JSON.stringify(pidPath)},String(process.pid));
 else if(msg.method==='initialize'||msg.method==='session/new') process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:msg.method==='initialize'?{protocolVersion:1}:{sessionId:'real-monitor'}})+'\\n');
}
`,
				);
				const authority = SqliteGovernanceStorage.prototype.toolCatalog;
				let events;
				const subscribe = RunChanges.prototype.subscribe;
				t.mock.method(RunChanges.prototype, 'subscribe', function (...args) {
					if (args[0].appId === f.appId) events = this;
					return subscribe.apply(this, args);
				});
				let instance;
				if (mode === 'acp') {
					({ instance } = await configureProtocol(f, 'nexus.services.acp', {
						kind: 'remoteProcess',
						connectionId: f.connectionId,
						argv: [process.execPath, script],
						cwd: directory,
					}));
				}
				let entered = false;
				t.mock.method(SqliteGovernanceStorage.prototype, 'toolCatalog', async function (...args) {
					const result = await authority.apply(this, args);
					if (pid && !entered) {
						assert.ok(result, 'The original durable authority query actually succeeded');
						entered = true;
						await gate;
						throw failure;
					}
					return result;
				});
				const run = await f.start('mixed-monitor-' + mode, (results) =>
					results.length
						? { hold: true }
						: {
								name: mode === 'acp' ? 'acp_execute' : 'shell_execute',
								input:
									mode === 'acp'
										? {
												instanceId: instance.id,
												prompt: 'Wait for actual failure',
											}
										: {
												connectionId: f.connectionId,
												mode: 'background',
												commands: [posixCommand([process.execPath, script])],
											},
							},
				);
				if (mode === 'job') {
					await f.approve(await f.approval(run, 'shell_execute'));
				}
				pid = await until(
					async () => {
						if (mode === 'acp') {
							for (const approval of await listAgentApprovalHistory(f.api, f.appId, run.id)) {
								if (approval.status === 'requested') {
									assert.ok(
										['transport.session', 'transport.stdio.write'].includes(approval.operationName),
									);
									await f.approve(approval);
								}
							}
						}
						return readFile(pidPath, 'utf8')
							.then(Number)
							.catch((error) => {
								if (error.code === 'ENOENT') {
									return null;
								}
								throw error;
							});
					},
					(value) => Number.isSafeInteger(value) && value > 1,
					'Real remote process wrote its original PID',
				);
				const identity = await readFile('/proc/' + pid + '/stat', 'utf8');
				processStart = identity.slice(identity.lastIndexOf(')') + 2).split(' ')[19];
				assert.ok(events, 'Actual resource owner subscribed to Run invalidations');
				events.notify({ userId: 1, appId: f.appId, runId: run.id });
				await until(() => entered, Boolean, 'Event-triggered monitor reached real durable governance');
				process.kill(pid, 'SIGTERM');
				await until(
					async () => {
						try {
							const status = await readFile('/proc/' + pid + '/stat', 'utf8');
							return status.slice(status.lastIndexOf(')') + 2).startsWith('Z');
						} catch (error) {
							if (['ENOENT', 'ESRCH'].includes(error.code)) {
								return true;
							}
							throw error;
						}
					},
					Boolean,
					'Original SSH executable actually terminated before authority returned',
				);
				const before =
					mode === 'job'
						? f.rows('agent_tool_jobs', run)[0]
						: f.operations(run).find((row) => row.label === 'transport.session');
				assert.equal(before.state, 'dispatched', 'Actual process exit does not bypass the in-flight monitor');
				const restarting = f.restart({ verifyCloseFailure: (error) => contains(error, failure) });
				void restarting.catch(() => undefined);
				let finished = false;
				void restarting.then(
					() => {
						finished = true;
					},
					() => {
						finished = true;
					},
				);
				await new Promise((resolve) => setImmediate(resolve));
				assert.equal(finished, false);
				release();
				await restarting;
				t.mock.restoreAll();
				assert.equal(
					(mode === 'job'
						? f.rows('agent_tool_jobs', run)[0]
						: f.operations(run).find((row) => row.label === 'transport.session')
					).state,
					'unknown',
				);
				assert.equal(f.calls.length, 2, 'Recovery never repeats the original external operation');
				const claims = expectStatus(await f.api('GET', '/api/v1/remote/mutations'), 200).items;
				if (mode === 'job') {
					assert.equal(claims.length, 1, 'The actual SSH mutation retains its original durable claim');
				} else {
					assert.equal(claims.length, 0, 'Raw protocol resources use the original generic Operation fence');
					assert.equal((await f.wait(run, 'unknown')).status, 'unknown');
					const original = f.operations(run).find((row) => row.id === before.id);
					assert.equal(original.state, 'unknown', 'Restart preserves the exact original session fence');
				}
				assert.ok(
					claims.every((claim) => claim.state === 'blocked'),
					'Original mutation evidence is never automatically released',
				);
			} finally {
				release();
				t.mock.restoreAll();
				const failures = [];
				if (pid && processStart) {
					try {
						const identity = await readFile('/proc/' + pid + '/stat', 'utf8');
						if (identity.slice(identity.lastIndexOf(')') + 2).split(' ')[19] === processStart) {
							process.kill(pid, 'SIGKILL');
						}
					} catch (error) {
						if (!['ENOENT', 'ESRCH'].includes(error.code)) {
							failures.push(error);
						}
					}
				}
				for (const close of [
					() => f?.close(),
					() => sshd?.close(),
					() => rm(directory, { recursive: true, force: true }),
				]) {
					try {
						await close();
					} catch (error) {
						failures.push(error);
					}
				}
				if (failures.length) {
					throw new AggregateError(failures, 'Mixed monitor fixture cleanup failed');
				}
			}
		},
	);
}
