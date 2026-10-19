import assert from 'node:assert/strict';
import { test } from 'node:test';
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
							return tool(f, 'file_write', { path: source, content: initial, expectedSha256: 'absent' });
						case 1:
							return tool(f, 'file_read', { path: source });
						case 2:
							return tool(f, 'file_patch', {
								path: source,
								expectedSha256: results[1].sha256,
								oldText: 'literal',
								newText: 'replacement',
							});
						case 3:
							return tool(f, 'file_inspect', { path: source });
						case 4:
							return tool(f, 'file_move', {
								path: source,
								destinationPath: destination,
								expectedFingerprint: results[3].fingerprint,
							});
						case 5:
							return tool(f, 'file_inspect', { path: destination });
						case 6:
							return tool(f, 'file_delete', {
								path: destination,
								scope: 'entry',
								expectedFingerprint: results[5].fingerprint,
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
				assert.equal(JSON.parse(tools[1].result_text).sha256, hash(initial));
				assert.equal(f.calls.length, 8);
			},
		);
		await scenario('stale replacement hash preserves bytes and never retries', async (f, directory) => {
			const path = join(directory, 'stale.txt');
			await writeFile(path, 'current');
			const run = await f.start('stale hash', () =>
				tool(f, 'file_write', { path, content: 'replacement', expectedSha256: hash('previous') }),
			);
			await f.approve(await f.approval(run, 'file_write'));
			await f.wait(run, 'unknown');
			assert.equal(await readFile(path, 'utf8'), 'current');
			assert.equal(f.calls.length, 1);
			assert.equal(f.rows('agent_run_tools', run)[0].state, 'unknown');
		});
		await scenario('symbolic-link read refuses without exposing its target', async (f, directory) => {
			const path = join(directory, 'link'),
				target = join(directory, 'private');
			await writeFile(target, 'must-not-be-returned');
			await symlink(target, path);
			const run = await f.start('link rejection', () => tool(f, 'file_read', { path }));
			await f.wait(run, 'unknown');
			assert.equal(f.calls.length, 1);
			assert.equal(f.rows('agent_run_tools', run)[0].state, 'unknown');
			assert.equal(await readFile(target, 'utf8'), 'must-not-be-returned');
		});
		await scenario('overlapping patch context refuses without editing the file', async (f, directory) => {
			const path = join(directory, 'overlap');
			await writeFile(path, 'aaa');
			const run = await f.start('overlap', () =>
				tool(f, 'file_patch', { path, expectedSha256: hash('aaa'), oldText: 'aa', newText: 'b' }),
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
					? tool(f, 'file_move', { path, destinationPath, expectedFingerprint: results[0].fingerprint })
					: tool(f, 'file_inspect', { path }),
			);
			await f.approve(await f.approval(run, 'file_move'));
			await f.wait(run, 'unknown');
			assert.equal(await readFile(path, 'utf8'), 'source');
			assert.equal(await readFile(destinationPath, 'utf8'), 'destination');
			assert.equal(f.calls.length, 2);
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
									path,
									scope: 'tree',
									expectedFingerprint: results[0].fingerprint,
								})
							: {}
						: tool(f, 'file_inspect', { path }),
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
