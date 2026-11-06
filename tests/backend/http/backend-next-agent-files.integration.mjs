import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, expectStatus } from '../remote/openssh-fixture.mjs';

await test('B10 Agent file operations and HTTP refusal boundaries', { timeout: 60000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-b10-agent-files-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const fixture = await openAgentExecution(directory, sshd);
			scenario.after(() => fixture.close());
			await work(fixture, directory);
		});
	}

	const hash = (text) => createHash('sha256').update(text).digest('hex');

	const tool = (f, name, input) => ({ name, input: { connectionId: f.connectionId, ...input } });

	try {
		sshd = await openSshd(root);
		await scenario('invalid protocol inputs retain 400/413 and never mutate durable state', async (f) => {
			const app = '/api/v1/agent/apps/' + f.appId;
			const grants = expectStatus(await f.api('GET', app + '/grants'), 200);
			const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200);
			const browser = expectStatus(await f.api('GET', '/api/v1/agent/browser/configuration'), 200);
			const routes = [
				[
					'PUT',
					app + '/grants',
					{
						expectedPolicyRevision: grants.policyRevision,
						grants: [{ capability: 'machine.inspect', scope: { kind: 'targets', targets: {} } }],
					},
				],
				['PUT', '/api/v1/agent/execution-settings', {}],
				['PUT', '/api/v1/agent/browser/configuration', {}],
				['POST', app + '/memories', {}],
				['POST', '/api/v1/apps/' + f.appId + '/integrations', {}],
				['POST', app + '/artifacts', {}],
				['GET', app + '/memories?limit=wrong', undefined],
				['GET', '/api/v1/agent/files?limit=wrong', undefined],
			];
			for (const [method, path, input] of routes) {
				assert.deepEqual(expectStatus(await f.api(method, path, input), 400), { code: 'invalid_input' });
			}
			expectStatus(
				await f.api('PUT', '/api/v1/agent/execution-settings', { unexpected: 'x'.repeat(2 * 1024 * 1024) }),
				413,
			);
			assert.deepEqual(expectStatus(await f.api('GET', app + '/grants'), 200), grants);
			assert.deepEqual(expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200), settings);
			assert.deepEqual(expectStatus(await f.api('GET', '/api/v1/agent/browser/configuration'), 200), browser);
			assert.equal(expectStatus(await f.api('GET', app + '/memories'), 200).items.length, 0);
			assert.equal(expectStatus(await f.api('GET', app + '/artifacts'), 200).items.length, 0);
			assert.equal(
				expectStatus(await f.api('GET', '/api/v1/apps/' + f.appId + '/integrations'), 200).items.length,
				0,
			);
		});
		await scenario(
			'write/read/patch/inspect/move/delete use captured hashes and separate approvals',
			async (f, directory) => {
				const source = join(directory, 'source.txt'),
					destination = join(directory, 'destination.txt');
				const initial = 'before literal after',
					updated = 'before replacement after';
				const run = await f.start('file lifecycle', (results) => {
					switch (results.length) {
						case 0:
							return tool(f, 'file_write', {
								items: [{ path: source, content: initial, expectedSha256: 'absent' }],
							});
						case 1:
							return tool(f, 'file_read', { paths: [source] });
						case 2:
							return tool(f, 'file_patch', {
								path: source,
								expectedSha256: results[1].items[0].value.sha256,
								edits: [{ oldText: 'literal', newText: 'replacement' }],
							});
						case 3:
							return tool(f, 'file_inspect', { paths: [source] });
						case 4:
							return tool(f, 'file_move', {
								items: [
									{
										path: source,
										destinationPath: destination,
										expectedFingerprint: results[3].items[0].value.fingerprint,
									},
								],
							});
						case 5:
							return tool(f, 'file_inspect', { paths: [destination] });
						case 6:
							return tool(f, 'file_delete', {
								items: [
									{
										path: destination,
										scope: 'entry',
										expectedFingerprint: results[5].items[0].value.fingerprint,
									},
								],
							});
						default:
							return {};
					}
				});
				await f.approve(await f.approval(run, 'file_write'));
				await f.approve(await f.approval(run, 'file_patch'));
				const move = await f.approval(run, 'file_move');
				assert.equal(await readFile(source, 'utf8'), updated);
				await f.approve(move);
				const deletion = await f.approval(run, 'file_delete');
				assert.equal(deletion.inspection.risk, 'destructive');
				assert.equal(await readFile(destination, 'utf8'), updated);
				await assert.rejects(stat(source), { code: 'ENOENT' });
				await f.approve(deletion);
				await f.wait(run, 'completed');
				await assert.rejects(stat(destination), { code: 'ENOENT' });
				const tools = f.rows('agent_run_tools', run);
				assert.equal(tools.length, 7);
				assert.ok(tools.every((row) => row.state === 'completed'));
				assert.equal(JSON.parse(tools[1].result_text).items[0].value.sha256, hash(initial));
				assert.equal(f.calls.length, 8);
			},
		);
		await scenario(
			'large UTF-8 files and directories page without gaps or duplicate entries',
			async (f, directory) => {
				const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
				expectStatus(
					await f.api('PUT', '/api/v1/agent/execution-settings', {
						expectedVersion: settings.version,
						enabled: true,
						limits: { ...settings.limits, maxToolOutputBytes: 256 * 1024 },
					}),
					200,
				);
				const content = '甲🙂a'.repeat(6000),
					path = join(directory, 'large.txt'),
					folder = join(directory, 'entries');
				await writeFile(path, content);
				await mkdir(folder);
				const names = Array.from({ length: 220 }, (_, i) => 'file-' + String(i).padStart(3, '0'));
				await Promise.all(names.map((name) => writeFile(join(folder, name), name)));
				const pages = [],
					entries = [];
				const run = await f.start('paged files', (results) => {
					if (!results.length) return tool(f, 'file_read', { paths: [path], maxBytes: 4097 });
					const latest = results.at(-1).items[0].value;
					if ('text' in latest) {
						pages.push(latest);
						assert.equal(latest.pageSha256, hash(latest.text));
						assert.equal(latest.sha256, null);
						assert.equal(latest.sizeBytes, Buffer.byteLength(content));
						if (latest.nextOffset !== null)
							return tool(f, 'file_read', { paths: [path], offset: latest.nextOffset, maxBytes: 4097 });
						assert.equal(pages.map((page) => page.text).join(''), content);
						assert.equal(new Set(pages.map((page) => page.fingerprint)).size, 1);
						return tool(f, 'file_list', { paths: [folder] });
					}
					entries.push(...latest.entries.map((entry) => entry.name));
					if (latest.nextAfter !== null)
						return tool(f, 'file_list', { paths: [folder], after: latest.nextAfter });
					assert.deepEqual(entries, names);
					return {};
				});
				await f.wait(run, 'completed');
				assert.ok(pages.length > 1);
				assert.equal(entries.length, 220);
			},
		);
		await scenario(
			'multi-edit patch and multi-query search retain separate query matches',
			async (f, directory) => {
				const path = join(directory, 'multiple.txt'),
					before = 'alpha first\nbeta second\nalpha beta',
					after = 'A first\nB second\nalpha beta';
				await writeFile(path, before);
				const run = await f.start('multi edits', (results) => {
					if (!results.length)
						return tool(f, 'file_patch', {
							path,
							expectedSha256: hash(before),
							edits: [
								{ oldText: 'alpha first', newText: 'A first' },
								{ oldText: 'beta second', newText: 'B second' },
							],
						});
					if (results.length === 1) return tool(f, 'file_search', { path, queries: ['alpha', 'beta'] });
					assert.deepEqual(
						results[1].matches.map((match) => [match.queryIndex, match.line]),
						[
							[0, 3],
							[1, 3],
						],
					);
					return {};
				});
				await f.approve(await f.approval(run, 'file_patch'));
				await f.wait(run, 'completed');
				assert.equal(await readFile(path, 'utf8'), after);
			},
		);
		await scenario(
			'batch delivery, Artifact paging and v1-to-current migration preserve content across repeated startup',
			async (f, directory) => {
				await f.grants(['file.read', 'artifacts.read', 'artifacts.write', 'shell.execute']);
				const paths = [join(directory, 'one.txt'), join(directory, 'two.txt')],
					contents = ['甲🙂alpha'.repeat(20), 'second'];
				await Promise.all(paths.map((path, index) => writeFile(path, contents[index])));
				let received = '';
				const run = await f.start('artifact batches', (results) => {
					if (!results.length) return tool(f, 'file_deliver', { paths });
					const delivered = results[0].items.map((item) => item.value);
					if (results.length === 1)
						return { name: 'artifact_present', input: { artifactIds: delivered.map((item) => item.id) } };
					if (results.length === 2) {
						assert.deepEqual(
							results[1].items.map((item) => item.value.id),
							delivered.map((item) => item.id),
						);
						return {
							name: 'artifact_read',
							input: { artifactId: delivered[0].id, encoding: 'utf8', maxBytes: 17 },
						};
					}
					const page = results.at(-1);
					assert.equal(page.base64, null);
					received += page.text;
					if (page.nextOffset !== null)
						return {
							name: 'artifact_read',
							input: {
								artifactId: delivered[0].id,
								encoding: 'utf8',
								maxBytes: 17,
								offset: page.nextOffset,
							},
						};
					assert.equal(received, contents[0]);
					return {};
				});
				await f.approve(await f.approval(run, 'file_deliver'));
				await f.wait(run, 'completed');
				assert.equal(received, contents[0]);
				const shellRun = await f.start('migration shell', (results) =>
					results.length ? {} : tool(f, 'shell_execute', { commands: ['printf migrated'] }),
				);
				await f.approve(await f.approval(shellRun, 'shell_execute'));
				await f.wait(shellRun, 'completed');
				const job = f.rows('agent_tool_jobs', shellRun)[0],
					original = JSON.parse(job.result_text);
				const outputRows = f
					.rows('agent_run_tools', run)
					.filter((row) => ['file_deliver', 'artifact_present'].includes(row.tool_name));
				const oldOutputs = outputRows.map((row) => JSON.parse(row.result_text).items[0].value);
				await f.restart({
					beforeBoot() {
						// Seed the previous representation only after all application and
						// HTTP audit writers have drained and closed their database handles.
						const db = new DatabaseSync(f.database);
						try {
							db.exec('BEGIN');
							for (const [index, row] of outputRows.entries()) {
								db.prepare('UPDATE agent_run_tools SET result_text=? WHERE id=?').run(
									JSON.stringify(oldOutputs[index]),
									row.id,
								);
							}
							const oldJob = { status: original.status, ...original.commands[0] };
							delete oldJob.index;
							db.prepare('UPDATE agent_tool_jobs SET result_text=? WHERE id=?').run(
								JSON.stringify(oldJob),
								job.id,
							);
							// Restore the actual v1 schema so later DDL migrations run once.
							db.exec(`
								DROP TABLE operations_notification_pending;
								DROP INDEX agent_budget_reservation_root;
								DROP INDEX agent_approval_run_lookup;
								DROP INDEX agent_approval_tool_lookup;
								DROP INDEX agent_resolution_approval_lookup;
								DROP INDEX agent_compaction_run_lookup;
								DROP TABLE access_oidc_sessions;
								DROP TABLE access_oidc_flows;
								DROP TABLE access_oidc_configuration;
								DELETE FROM schema_version WHERE version>=2;
								COMMIT;
							`);
						} finally {
							db.close();
						}
					},
				});
				await f.wait(run, 'completed');
				assert.deepEqual(JSON.parse(f.rows('agent_tool_jobs', shellRun)[0].result_text), original);
				for (const [index, row] of f
					.rows('agent_run_tools', run)
					.filter((row) => ['file_deliver', 'artifact_present'].includes(row.tool_name))
					.entries()) {
					assert.deepEqual(JSON.parse(row.result_text), {
						items: [{ index: 0, status: 'completed', value: oldOutputs[index] }],
					});
				}
				const migrated = f.rows('agent_run_tools', run);
				await f.restart();
				assert.deepEqual(f.rows('agent_run_tools', run), migrated);
			},
		);
		await scenario('captured result batch reads bind source hash and code-point offsets', async (f, directory) => {
			await f.grants(['file.read', 'context.read']);
			const path = join(directory, 'captured.txt');
			await writeFile(path, '甲🙂\n'.repeat(20));
			let original;
			const run = await f.start('result batches', (results) => {
				if (!results.length) return tool(f, 'file_read', { paths: [path] });
				if (results.length === 1) {
					const row = f.rows('agent_run_tools', run)[0];
					original = row.result_text;
					return {
						name: 'tool_result_read',
						input: {
							items: [0, 10].map((offset) => ({
								toolCallId: row.id,
								sha256: hash(original),
								offset,
								maxBytes: 80,
							})),
						},
					};
				}
				assert.equal(results[1].items.length, 2);
				assert.equal(results[1].nextIndex, null);
				for (const item of results[1].items) {
					assert.equal(
						item.text,
						Array.from(original)
							.slice(item.offset, item.nextOffset ?? undefined)
							.join(''),
					);
					assert.equal(item.sha256, hash(original));
				}
				return {};
			});
			await f.wait(run, 'completed');
			assert.ok(original);
		});
		await scenario('stale replacement hash preserves bytes and never retries', async (f, directory) => {
			const path = join(directory, 'stale.txt');
			await writeFile(path, 'current');
			const run = await f.start('stale hash', (results) =>
				results.length
					? {}
					: tool(f, 'file_write', {
							items: [{ path, content: 'replacement', expectedSha256: hash('previous') }],
						}),
			);
			await f.approve(await f.approval(run, 'file_write'));
			await f.wait(run, 'completed');
			assert.equal(await readFile(path, 'utf8'), 'current');
			assert.equal(f.calls.length, 2);
			const operation = f.rows('agent_run_tools', run)[0];
			assert.equal(operation.state, 'completed');
			assert.equal(JSON.parse(operation.result_text).items[0].failureCode, 'conflict');
		});
		await scenario('symbolic-link read refuses without exposing its target', async (f, directory) => {
			const path = join(directory, 'link'),
				target = join(directory, 'private');
			await writeFile(target, 'must-not-be-returned');
			await symlink(target, path);
			const run = await f.start('link rejection', (results) => {
				if (!results.length) return tool(f, 'file_read', { paths: [path] });
				assert.deepEqual(results, [{ failureCode: 'tool_invalid_input' }]);
				return {};
			});
			await f.wait(run, 'completed');
			assert.equal(f.calls.length, 2);
			assert.equal(f.rows('agent_run_tools', run)[0].state, 'failed');
			assert.equal(await readFile(target, 'utf8'), 'must-not-be-returned');
		});
		await scenario('overlapping patch context refuses without editing the file', async (f, directory) => {
			const path = join(directory, 'overlap');
			await writeFile(path, 'aaa');
			const run = await f.start('overlap', () =>
				tool(f, 'file_patch', { path, expectedSha256: hash('aaa'), edits: [{ oldText: 'aa', newText: 'b' }] }),
			);
			await f.approve(await f.approval(run, 'file_patch'));
			await f.wait(run, 'unknown');
			assert.equal(await readFile(path, 'utf8'), 'aaa');
			assert.equal(f.calls.length, 1);
		});
		await scenario('move refuses an existing destination and preserves both files', async (f, directory) => {
			const path = join(directory, 'source'),
				destinationPath = join(directory, 'existing');
			await writeFile(path, 'source');
			await writeFile(destinationPath, 'destination');
			const run = await f.start('existing destination', (results) =>
				results.length
					? results.length > 1
						? {}
						: tool(f, 'file_move', {
								items: [
									{
										path,
										destinationPath,
										expectedFingerprint: results[0].items[0].value.fingerprint,
									},
								],
							})
					: tool(f, 'file_inspect', { paths: [path] }),
			);
			await f.approve(await f.approval(run, 'file_move'));
			await f.wait(run, 'completed');
			assert.equal(await readFile(path, 'utf8'), 'source');
			assert.equal(await readFile(destinationPath, 'utf8'), 'destination');
			assert.equal(f.calls.length, 3);
		});
		await scenario(
			'tree deletion requires explicit scope and leaves neighboring files intact',
			async (f, directory) => {
				const path = join(directory, 'tree'),
					neighbor = join(directory, 'neighbor');
				await mkdir(join(path, 'child'), { recursive: true });
				await writeFile(join(path, 'child', 'data'), 'nested');
				await writeFile(neighbor, 'keep');
				const run = await f.start('tree deletion', (results) =>
					results.length
						? results.length === 1
							? tool(f, 'file_delete', {
									items: [
										{
											path,
											scope: 'tree',
											expectedFingerprint: results[0].items[0].value.fingerprint,
										},
									],
								})
							: {}
						: tool(f, 'file_inspect', { paths: [path] }),
				);
				const approval = await f.approval(run, 'file_delete');
				assert.equal(approval.inspection.risk, 'destructive');
				await f.approve(approval);
				await f.wait(run, 'completed');
				await assert.rejects(stat(path), { code: 'ENOENT' });
				assert.equal(await readFile(neighbor, 'utf8'), 'keep');
			},
		);
	} finally {
		if (sshd) {
			await sshd.close();
		}
		await rm(root, { recursive: true, force: true });
	}
});
