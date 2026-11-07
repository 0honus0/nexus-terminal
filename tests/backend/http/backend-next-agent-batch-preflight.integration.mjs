import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureToolName } from '../../support/package-tool-catalog.mjs';
import { discoverTools, openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd } from '../remote/openssh-fixture.mjs';

await test(
	'Agent mutation batches check every missing destination parent before any effect',
	{ timeout: 60000 },
	async (t) => {
		const root = await mkdtemp(
			join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-agent-batch-preflight-'),
		);
		let sshd;
		try {
			sshd = await openSshd(root);
			for (const action of ['write', 'move']) {
				await t.test(
					`${action} rejects a later symlink parent while preserving the earlier item`,
					async (scenario) => {
						const directory = join(root, action);
						await mkdir(directory);
						const fixture = await openAgentExecution(directory, sshd);
						scenario.after(() => fixture.close());
						const canonical = join(directory, 'canonical');
						const alias = join(directory, 'alias');
						await mkdir(canonical);
						await symlink(canonical, alias);
						const firstSource = join(directory, 'first-source');
						const secondSource = join(directory, 'second-source');
						const firstDestination = join(directory, 'first-destination');
						const secondDestination = join(alias, 'second-destination');
						if (action === 'move') {
							await writeFile(firstSource, 'first source remains');
							await writeFile(secondSource, 'second source remains');
						}
						let observed;

						const call = (name, input) => ({
							name: fixtureToolName(fixture.calls.at(-1).body, name),
							input: { connectionId: fixture.connectionId, ...input },
						});

						const run = await fixture.start(
							`${action} full plan preflight`,
							discoverTools('file_inspect file_move file_write', (results) => {
								if (action === 'move' && results.length === 0) {
									return call('file_inspect', { paths: [firstSource, secondSource] });
								}
								if (results.length === (action === 'move' ? 1 : 0)) {
									return action === 'write'
										? call('file_write', {
												onError: 'continue',
												items: [firstDestination, secondDestination].map((path) => ({
													path,
													content: 'must not be written',
													expectedSha256: 'absent',
												})),
											})
										: call('file_move', {
												onError: 'continue',
												items: [firstSource, secondSource].map((path, index) => ({
													path,
													destinationPath: index === 0 ? firstDestination : secondDestination,
													expectedFingerprint: results[0].items[index].value.fingerprint,
												})),
											});
								}
								observed = results.at(-1);
								return {};
							}),
						);
						await fixture.approve(
							await fixture.approval(run, action === 'write' ? 'file_write' : 'file_move'),
						);
						await fixture.wait(run, 'completed');
						assert.deepEqual(observed, {
							items: [
								{ index: 0, status: 'not_started' },
								{ index: 1, status: 'failed', failureCode: 'invalid_input' },
							],
						});
						await assert.rejects(readFile(firstDestination), { code: 'ENOENT' });
						await assert.rejects(readFile(join(canonical, 'second-destination')), { code: 'ENOENT' });
						if (action === 'move') {
							assert.equal(await readFile(firstSource, 'utf8'), 'first source remains');
							assert.equal(await readFile(secondSource, 'utf8'), 'second source remains');
						}
					},
				);
			}
		} finally {
			await sshd?.close();
		}
	},
);
