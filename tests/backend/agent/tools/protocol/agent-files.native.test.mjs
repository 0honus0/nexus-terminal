import { pluginConfiguration } from '../../plugins/support/plugin-configuration-fixture.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureToolName, hasToolIdentity } from '../../../../support/package-tool-catalog.mjs';
import { migrateToolOutputBatches } from '../../../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-output-migration.js';
import { migrateToolJobBatchResults } from '../../../../../packages/backend/dist/modules/agent/tools/adapters/sqlite/tool-job-batch-migration.js';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

await test('B10 Agent file operations and HTTP refusal boundaries', { timeout: 120000 }, async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-b10-agent-files-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, work) {
		await t.test(name, async (scenario) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const fixture = await openAgentExecution(directory, sshd, {
				discover:
					'file_write file_read file_patch file_inspect file_move file_delete file_list file_search file_deliver artifact_present artifact_read shell_execute tool_result_read',
			});
			scenario.after(() => fixture.close());
			await work(fixture, directory);
		});
	}

	const hash = (text) => createHash('sha256').update(text).digest('hex');

	const tool = (f, name, input) => ({
		name: fixtureToolName(f.calls.at(-1).body, name),
		input: { connectionId: f.connectionId, ...input },
	});

	try {
		sshd = await openSshd(root);
		await scenario('invalid protocol inputs retain 400/413 and never mutate durable state', async (f) => {
			const app = '/api/v1/agent/apps/' + f.appId;
			const grants = expectStatus(await f.api('GET', app + '/grants'), 200);
			const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200);
			const browser = await pluginConfiguration(f.api, f.appId, 'nexus.tools.browser');
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
				['PUT', browser.path, {}],
				['POST', app + '/memories', {}],
				['PUT', '/api/v1/agent/plugins/apps/' + f.appId + '/composition', {}],
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
			assert.deepEqual(expectStatus(await f.api('GET', browser.path), 200), browser.current);
			assert.equal(expectStatus(await f.api('GET', app + '/memories'), 200).items.length, 0);
			assert.equal(expectStatus(await f.api('GET', app + '/artifacts'), 200).items.length, 0);
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
				assert.equal(deletion.risk, 'destructive');
				assert.equal(await readFile(destination, 'utf8'), updated);
				await assert.rejects(stat(source), { code: 'ENOENT' });
				await f.approve(deletion);
				await f.wait(run, 'completed');
				await assert.rejects(stat(destination), { code: 'ENOENT' });
				const tools = (await f.toolHistory(run)).filter((item) => !hasToolIdentity(item, 'tool_search'));
				assert.equal(tools.length, 7);
				assert.ok(tools.every((row) => row.state === 'completed'));
				const effects = f.operations(run).filter((row) => row.kind === 'effect');
				assert.equal(effects.length, 7, 'Each native operation retains its own governed receipt');
				assert.ok(effects.every((row) => row.state === 'completed'));
				const read = f.operations(run).find((row) => row.label === 'nexus.tools.remote.file_read');
				const payload = JSON.parse(f.content(JSON.parse(read.result_json).content));
				assert.equal(payload.items[0].value.sha256, hash(initial));
				assert.equal(f.calls.length, 9, 'One discovery plus seven tools plus final answer');
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
				const content = '甲🙂a'.repeat(2000),
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
			'batch delivery, Artifact paging and immutable content survive repeated startup',
			async (f, directory) => {
				await f.grants(['file.read', 'artifacts.read', 'artifacts.write', 'shell.execute']);
				const paths = [join(directory, 'one.txt'), join(directory, 'two.txt')],
					contents = ['甲🙂alpha'.repeat(6), 'second'];
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
				const tools = f.operations(run);
				const shell = f.operations(shellRun);
				const captured = tools
					.filter((row) => row.kind === 'tool')
					.map((row) => ({
						id: row.id,
						label: row.label,
						result: row.result_json,
						text: f.content(JSON.parse(row.result_json).content),
					}));
				for (let startup = 0; startup < 2; startup++) {
					await f.restart();
					await f.wait(run, 'completed');
					assert.deepEqual(f.operations(run), tools);
					assert.deepEqual(f.operations(shellRun), shell);
					for (const row of captured) {
						assert.equal(f.content(JSON.parse(row.result).content), row.text);
					}
				}
				const delivery = captured.find((row) => row.label === 'nexus.tools.remote.file_deliver');
				assert.ok(delivery);
				const delivered = JSON.parse(delivery.text).items;
				for (const [index, item] of delivered.entries()) {
					const download = await f.api(
						'GET',
						'/api/v1/agent/apps/' + f.appId + '/artifacts/' + item.value.id + '/content',
					);
					expectStatus(download, 200);
					assert.equal(download.bytes.toString(), contents[index]);
					assert.equal(item.value.sizeBytes, Buffer.byteLength(contents[index]));
				}
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
					const row = f.operations(run).find((item) => item.label === 'nexus.tools.remote.file_read');
					original = f.content(JSON.parse(row.result_json).content);
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
			assert.equal(f.calls.length, 3);
			const operation = f.operations(run).find((item) => item.label === 'nexus.tools.remote.file_write');
			assert.equal(operation.state, 'completed');
			assert.equal(
				JSON.parse(f.content(JSON.parse(operation.result_json).content)).items[0].failureCode,
				'conflict',
			);
		});
		await scenario('symbolic-link read refuses without exposing its target', async (f, directory) => {
			const path = join(directory, 'link'),
				target = join(directory, 'private');
			await writeFile(target, 'must-not-be-returned');
			await symlink(target, path);
			const run = await f.start('link rejection', (results) => {
				if (!results.length) return tool(f, 'file_read', { paths: [path] });
				assert.ok(results[0].failure, JSON.stringify(results));
				return {};
			});
			await f.wait(run, 'completed');
			assert.equal(f.calls.length, 3);
			assert.ok(
				(await f.toolHistory(run)).some(
					(item) => hasToolIdentity(item, 'file_read') && item.state === 'failed',
				),
			);
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
			assert.equal(f.calls.length, 2);
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
			assert.equal(f.calls.length, 4);
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
				assert.equal(approval.risk, 'destructive');
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
	}
});

await test('B10 historical file delivery and shell batch migrations retain legacy content', async () => {
	const db = new DatabaseSync(':memory:');
	try {
		db.exec(
			'CREATE TABLE agent_run_tools(id TEXT,tool_name TEXT,state TEXT,result_text TEXT); CREATE TABLE agent_tool_jobs(id TEXT,result_text TEXT);',
		);
		const artifact = { id: 'historical-artifact', name: 'legacy.txt', sizeBytes: 7 };
		db.prepare("INSERT INTO agent_run_tools VALUES('file','file_deliver','completed',?)").run(
			JSON.stringify(artifact),
		);
		db.prepare("INSERT INTO agent_tool_jobs VALUES('job',?)").run(
			JSON.stringify({ status: 'completed', exitCode: 0, stdout: 'kept', stderr: '' }),
		);
		const tx = { run: async (sql, args = []) => db.prepare(sql).run(...args) };
		await migrateToolOutputBatches(tx);
		await migrateToolJobBatchResults(tx);
		assert.deepEqual(
			JSON.parse(db.prepare("SELECT result_text FROM agent_run_tools WHERE id='file'").get().result_text),
			{ items: [{ index: 0, status: 'completed', value: artifact }] },
		);
		const job = JSON.parse(db.prepare("SELECT result_text FROM agent_tool_jobs WHERE id='job'").get().result_text);
		assert.equal(job.commands[0].stdout, 'kept');
		assert.equal(job.commands[0].index, 0);
	} finally {
		db.close();
	}
});
