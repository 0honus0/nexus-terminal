import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openSshd, until } from '../remote/openssh-fixture.mjs';
import { AGENT_CAPABILITIES } from '../../../packages/shared/dist/agent/governance/values.js';
import { ToolService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-service.js';

const names = (body) => body.tools.map((tool) => tool.function?.name ?? tool.name);

const search = (query) => ({ name: 'tool_search', input: { query } });

const inspect = (fixture, path) => ({
	name: 'file_inspect',
	input: { connectionId: fixture.connectionId, paths: [path] },
});

for (const protocol of ['chat-completions', 'responses']) {
	await test('Agent tool loading: ' + protocol, { timeout: 90000 }, async (t) => {
		const root = await mkdtemp(join(tmpdir(), 'nexus-agent-tool-loading-'));
		let sshd;
		let sequence = 0;
		const path = join(root, 'sample.txt');

		async function scenario(name, work, plugin) {
			await t.test(name, async (scenario) => {
				const directory = join(root, String(++sequence));
				await mkdir(directory);
				const fixture = await openAgentExecution(directory, sshd, { protocol, plugin });
				scenario.after(() => fixture.close());
				await fixture.grants(['context.read', 'file.read', 'browser.read']);
				await work(fixture);
			});
		}

		try {
			sshd = await openSshd(root);
			await writeFile(path, 'tool discovery evidence');
			await scenario('exact discovery supplies schemas next turn and reuses stable definitions', async (f) => {
				let initialBytes;
				let loadedNames;
				const run = await f.start('exact discovery', (results, body) => {
					const offered = names(body);
					if (!results.length) {
						assert.ok(offered.includes('tool_search') && offered.includes('file_read'));
						assert.ok(!offered.includes('file_inspect') && !offered.includes('browser_screenshot'));
						initialBytes = Buffer.byteLength(JSON.stringify(body.tools));
						return search('file_inspect');
					}
					assert.equal(results[0].availableNextTurn, true);
					assert.deepEqual(
						results[0].matches.map((tool) => tool.name),
						['file_inspect'],
					);
					assert.deepEqual(Object.keys(results[0].matches[0]).sort(), ['name', 'summary']);
					assert.ok(results[0].matches[0].summary.length > 0);
					const definition = body.tools.find((tool) => (tool.function?.name ?? tool.name) === 'file_inspect');
					assert.ok((definition.function ?? definition).parameters.properties.paths);
					if (results.length === 1) {
						loadedNames = offered;
						assert.ok(Buffer.byteLength(JSON.stringify(body.tools)) > initialBytes);
						return inspect(f, path);
					}
					assert.deepEqual(offered, loadedNames);
					assert.equal(results[1].items[0].value.path, path);
					return results.length === 2 ? inspect(f, path) : {};
				});
				await f.wait(run, 'completed');
				assert.equal(f.calls.length, 4);
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((tool) => [tool.tool_name, tool.state]),
					[
						['tool_search', 'completed'],
						['file_inspect', 'completed'],
						['file_inspect', 'completed'],
					],
				);
				// A fresh Run does not inherit the previous Run's loaded set.
				const next = await f.start('fresh discovery', (_results, body) => {
					assert.ok(!names(body).includes('file_inspect'));
					return {};
				});
				await f.wait(next, 'completed');
			});
			await scenario(
				'unknown names return no matches and Chinese keywords load only the requested capability',
				async (f) => {
					const run = await f.start('bilingual discovery', (results, body) => {
						if (!results.length) return search('nonexistent_tool');
						assert.deepEqual(results[0].matches, []);
						if (results.length === 1) return search('浏览器截图');
						assert.deepEqual(
							results[1].matches.map((tool) => tool.name),
							['browser_screenshot'],
						);
						assert.ok(names(body).includes('browser_screenshot'));
						assert.ok(!names(body).includes('browser_click'));
						return {};
					});
					await f.wait(run, 'completed');
				},
			);
			await scenario(
				'overlapping parallel searches and repeated discovery keep schemas unique and stable',
				async (f) => {
					let loadedNames;
					const run = await f.start('parallel discovery', (results, body) => {
						const offered = names(body);
						assert.equal(new Set(offered).size, offered.length);
						if (!results.length)
							return { calls: [search('file_inspect'), search('file_inspect browser_screenshot')] };
						assert.deepEqual(
							results[0].matches.map((tool) => tool.name),
							['file_inspect'],
						);
						assert.deepEqual(results[1].matches.map((tool) => tool.name).sort(), [
							'browser_screenshot',
							'file_inspect',
						]);
						assert.ok(offered.includes('file_inspect') && offered.includes('browser_screenshot'));
						if (results.length === 2) {
							loadedNames = offered;
							return search('file_inspect');
						}
						assert.deepEqual(offered, loadedNames);
						if (results.length === 3) return inspect(f, path);
						assert.equal(results[3].items[0].value.path, path);
						return {};
					});
					await f.wait(run, 'completed');
					assert.deepEqual(
						f.rows('agent_run_tools', run).map((tool) => [tool.tool_name, tool.state]),
						[
							['tool_search', 'completed'],
							['tool_search', 'completed'],
							['tool_search', 'completed'],
							['file_inspect', 'completed'],
						],
					);
				},
			);
			await scenario('invalid discovery parameters recover without exposing schemas', async (f) => {
				let initialNames;
				const run = await f.start('discovery parameter recovery', (results, body) => {
					if (!results.length) {
						initialNames = names(body);
						return search(' ');
					}
					assert.equal(results[0].failureCode, 'tool_invalid_input');
					if (results.length === 1) {
						assert.deepEqual(names(body), initialNames);
						return search('file_inspect');
					}
					assert.ok(names(body).includes('file_inspect'));
					if (results.length === 2) return inspect(f, path);
					assert.equal(results[2].items[0].value.path, path);
					return {};
				});
				await f.wait(run, 'completed');
				assert.deepEqual(
					f.rows('agent_run_tools', run).map((tool) => [tool.tool_name, tool.state]),
					[
						['tool_search', 'failed'],
						['tool_search', 'completed'],
						['file_inspect', 'completed'],
					],
				);
			});
			await scenario(
				'a plugin with discovery cannot search outside its explicit allowlist',
				async (f) => {
					const run = await f.start('restricted plugin discovery', (results, body) => {
						if (!results.length) {
							assert.deepEqual(names(body), ['tool_search']);
							return search('*');
						}
						assert.deepEqual(
							results[0].matches.map((tool) => tool.name),
							['file_inspect'],
						);
						assert.deepEqual(names(body), ['tool_search', 'file_inspect']);
						if (results.length === 1) return inspect(f, path);
						assert.equal(results[1].items[0].value.path, path);
						return {};
					});
					await f.wait(run, 'completed');
				},
				{
					contribution: {
						schemaVersion: 1,
						role: 'Limited discovery',
						toolNames: ['tool_search', 'file_inspect'],
						beforeStep: false,
						tools: [],
					},
				},
			);
			await scenario('same-turn search cannot authorize an unloaded call in its batch', async (f) => {
				const run = await f.start('same turn rejection', () => ({
					calls: [search('file_inspect'), inspect(f, path)],
				}));
				assert.equal((await f.wait(run, 'unknown')).failure.code, 'model_response_invalid');
				assert.equal(f.calls.length, 1);
				assert.deepEqual(f.rows('agent_run_tools', run), []);
			});
			await scenario(
				'discovery excludes denied capabilities and SSH tools without selected targets',
				async (f) => {
					await f.grants([
						'context.read',
						'file.read',
						'file.write',
						'browser.read',
						'integration.acp.invoke',
					]);
					const run = await f.start(
						'target and permission filtering',
						(results, body) => {
							if (!results.length)
								return search(
									'file_inspect file_write browser_click browser_screenshot acp_integration_list',
								);
							assert.deepEqual(
								results[0].matches.map((tool) => tool.name),
								['browser_screenshot'],
							);
							assert.ok(!names(body).includes('file_read'));
							return {};
						},
						{ connectionIds: [] },
					);
					await f.wait(run, 'completed');
				},
			);
			await scenario(
				'live revocation removes a loaded tool while its completed history remains valid',
				async (f) => {
					const run = await f.start('revoked discovery', async (results, body) => {
						if (!results.length) return search('file_inspect');
						if (results.length === 1) {
							assert.ok(names(body).includes('file_inspect'));
							await f.grants(['context.read']);
							return search('file_inspect');
						}
						assert.deepEqual(results[1].matches, []);
						assert.ok(!names(body).includes('file_inspect'));
						return {};
					});
					await f.wait(run, 'completed');
					assert.equal(f.rows('agent_run_tools', run).length, 2);
				},
			);
			await scenario('a stale offered schema cannot execute after revocation', async (f) => {
				const run = await f.start('revoke before execution', async (results) => {
					if (!results.length) return search('file_inspect');
					await f.grants(['context.read']);
					return inspect(f, path);
				});
				await f.wait(run, 'failed');
				assert.equal(f.calls.length, 2);
				assert.ok(
					!f
						.rows('agent_run_tools', run)
						.some((tool) => tool.tool_name === 'file_inspect' && tool.state === 'completed'),
				);
			});
			await scenario(
				'a plugin without a search entry retains its complete authorized allowlist',
				async (f) => {
					const run = await f.start('plugin allowlist', (results, body) => {
						assert.deepEqual(names(body), ['file_inspect']);
						return results.length ? {} : inspect(f, path);
					});
					await f.wait(run, 'completed');
				},
				{
					contribution: {
						schemaVersion: 1,
						role: 'Limited inspector',
						toolNames: ['file_inspect'],
						beforeStep: false,
						tools: [],
					},
				},
			);
			await scenario('explicit full-catalog discovery exposes all authorized schemas', async (f) => {
				await f.grants(AGENT_CAPABILITIES);
				let initialBytes;
				let initialCount;
				const run = await f.start('full catalog discovery', (results, body) => {
					if (!results.length) {
						initialBytes = Buffer.byteLength(JSON.stringify(body.tools));
						initialCount = body.tools.length;
						return search('*');
					}
					assert.deepEqual(
						results[0].matches.map((tool) => tool.name).sort(),
						names(body)
							.filter((name) => name !== 'tool_search')
							.sort(),
					);
					assert.ok(body.tools.length > initialCount);
					console.info(
						'TOOL_LOADING_WIRE_MEASUREMENT ' +
							JSON.stringify({
								protocol,
								initialCount,
								fullCount: body.tools.length,
								initialBytes,
								fullBytes: Buffer.byteLength(JSON.stringify(body.tools)),
							}),
					);
					return {};
				});
				await f.wait(run, 'completed');
			});
			await scenario(
				'Child loading is independent and cannot discover delegation outside its inherited bound',
				async (f) => {
					await f.grants(['context.read', 'file.read', 'app.intents.exchange']);
					const childObjective = f.program('child discovery', (results, body) => {
						if (!results.length) {
							assert.ok(!names(body).includes('file_inspect'));
							return search('file_inspect collaboration_delegate');
						}
						assert.deepEqual(
							results[0].matches.map((tool) => tool.name),
							['file_inspect'],
						);
						assert.ok(!names(body).includes('collaboration_delegate'));
						return results.length === 1 ? inspect(f, path) : {};
					});
					const run = await f.start('parent discovery', (results) => {
						if (!results.length) return search('collaboration_delegate collaboration_join file_inspect');
						if (results.length === 1)
							return {
								name: 'collaboration_delegate',
								input: {
									profile: 'explore',
									objective: childObjective,
									targets: [String(f.connectionId)],
									dependencyMode: 'success',
								},
							};
						if (results.length === 2)
							return {
								name: 'collaboration_join',
								input: {
									childIds: [results[1].id],
									mode: 'all',
									waitSeconds: 5,
								},
							};
						assert.equal(results[2].ready, true);
						assert.equal(results[2].children[0].status, 'completed');
						return {};
					});
					await f.approve(await f.approval(run, 'collaboration_delegate'));
					await f.wait(run, 'completed');
					assert.equal(f.calls.filter((call) => call.key === childObjective).length, 3);
				},
			);
			await scenario('cancelled in-flight search cannot cause a later model dispatch', async (f) => {
				const original = ToolService.prototype.perform;
				let searching = false;
				ToolService.prototype.perform = async function (...args) {
					const result = await original.apply(this, args);
					if (args[0].kind === 'tool_search') {
						searching = true;
						const signal = args[4];
						await new Promise((resolve) => {
							if (signal.aborted) resolve();
							else signal.addEventListener('abort', resolve, { once: true });
						});
					}
					return result;
				};
				try {
					const run = await f.start('cancel discovery', () => search('file_inspect'));
					await until(() => searching, Boolean, 'Real search reached delivery fence');
					await f.cancel(run);
					await f.wait(run, 'cancelled');
					assert.equal(f.calls.length, 1);
					assert.ok(!f.rows('agent_run_tools', run).some((tool) => tool.state === 'completed'));
				} finally {
					ToolService.prototype.perform = original;
				}
			});
		} finally {
			if (sshd) await sshd.close();
			await rm(root, { recursive: true, force: true });
		}
	});
}
