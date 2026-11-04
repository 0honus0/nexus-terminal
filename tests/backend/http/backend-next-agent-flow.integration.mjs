import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { expectStatus, openSshd, until } from '../remote/openssh-fixture.mjs';

const contribution = {
	schemaVersion: 1,
	role: 'FLOW_ROLE_MARKER',
	toolNames: ['skill_read', 'plugin_tool_call'],
	beforeStep: false,
	tools: [],
};
const skill = '---\nname: flow\ndescription: Inspect execution flow metadata.\n---\nFLOW_SKILL_BODY_PRIVATE';

function stored(fixture, sql, run) {
	const db = new DatabaseSync(fixture.database, { readOnly: true });
	try {
		return db.prepare(sql).all(run.id);
	} finally {
		db.close();
	}
}

function contexts(fixture, run) {
	return stored(fixture, 'SELECT * FROM agent_model_contexts WHERE run_id=? ORDER BY step_index', run);
}

function textEvents(fixture, run) {
	return stored(
		fixture,
		"SELECT * FROM agent_run_model_step_events WHERE run_id=? AND kind='text.delta' ORDER BY step_index,sequence",
		run,
	);
}

function selectedCatalog(body) {
	const prompt = body.instructions ?? body.messages.find((message) => message.role === 'system')?.content;
	assert.equal(typeof prompt, 'string');
	assert.match(prompt, /inside Nexus Terminal/);
	assert.match(prompt, /never grants permission/);
	assert.match(prompt, /FLOW_ROLE_MARKER/);
	assert.ok(!prompt.includes('FLOW_SKILL_BODY_PRIVATE'));
	const catalog = JSON.parse(prompt.split('Current Skill metadata catalog: ')[1].split('\n')[0]);
	assert.equal(catalog.length, 1);
	assert.equal(catalog[0].name, 'flow');
	assert.equal(catalog[0].version, '1.0.0');
	assert.equal(catalog[0].sha256, createHash('sha256').update(skill).digest('hex'));
	assert.deepEqual(Object.keys(catalog[0]).sort(), ['description', 'name', 'sha256', 'version']);
	return { prompt, skill: catalog[0] };
}

await test('Agent flow model outcomes and immutable instructions', { timeout: 180000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-agent-flow-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, options, work) {
		await t.test(name, async (testCase) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const f = await openAgentExecution(directory, sshd, options);
			testCase.after(() => f.close());
			await work(f);
		});
	}

	try {
		sshd = await openSshd(root);
		for (const protocol of ['chat-completions', 'responses']) {
			await scenario(
				protocol + ' includes hash-bound Skill metadata and persists the actual system instructions',
				{
					protocol,
					plugin: { contribution, skill },
				},
				async (f) => {
					await f.grants(['context.read']);
					const run = await f.start('instructions', () => ({ text: 'Instructions accepted' }));
					await f.wait(run, 'completed');
					assert.equal(f.calls.length, 1);
					const { prompt } = selectedCatalog(f.calls[0].body);
					assert.match(
						prompt,
						new RegExp('Current Host-selected SSH connection IDs: \\[' + f.connectionId + '\\]'),
					);
					const [snapshot] = contexts(f, run);
					assert.equal(JSON.parse(snapshot.content_json).systemPrompt, prompt);
					assert.equal(
						snapshot.content_hash,
						createHash('sha256').update(snapshot.content_json).digest('hex'),
					);
				},
			);
		}
		await scenario(
			'Skill bodies are fetched only by exact catalog identity and retained in the next turn',
			{
				plugin: { contribution, skill },
			},
			async (f) => {
				await f.grants(['context.read']);
				const run = await f.start('read precise skill', (results, body) => {
					const catalog = selectedCatalog(body);
					if (!results.length) {
						return {
							name: 'skill_read',
							input: {
								name: catalog.skill.name,
								version: catalog.skill.version,
								sha256: catalog.skill.sha256,
							},
						};
					}
					assert.match(results[0].body, /FLOW_SKILL_BODY_PRIVATE/);
					return {};
				});
				await f.wait(run, 'completed');
				assert.equal(f.calls.length, 2);
				assert.equal(contexts(f, run).length, 2);
				assert.ok(
					JSON.parse(contexts(f, run)[1].content_json).messages.some(
						(message) => message.role === 'tool' && message.content.includes('FLOW_SKILL_BODY_PRIVATE'),
					),
				);
			},
		);
		for (const status of [400, 401, 403, 404, 405, 413, 415, 422, 429]) {
			await scenario('HTTP ' + status + ' is a definite refusal and only 429 is retried', {}, async (f) => {
				const run = await f.start('refusal ' + status, () => ({ status }));
				const settled = await f.wait(run, 'failed');
				assert.equal(f.calls.length, status === 429 ? 3 : 1);
				assert.equal(f.rows('agent_run_model_steps', run)[0].failure_code, 'PROVIDER_REQUEST_REJECTED');
				assert.equal(f.rows('agent_run_tools', run).length, 0);
				assert.ok(settled.failure);
			});
		}
		for (const status of [408, 409, 500, 502, 503, 504]) {
			await scenario(
				'HTTP ' + status + ' remains unknown without automatic replay even with a retry header',
				{},
				async (f) => {
					const run = await f.start('uncertain ' + status, () => ({ status }));
					await f.wait(run, 'unknown');
					assert.equal(f.calls.length, 1);
					assert.equal(f.rows('agent_run_model_steps', run)[0].state, 'unknown');
				},
			);
		}
		await scenario('missing response is unknown and never replayed', {}, async (f) => {
			const run = await f.start('no response', () => ({ disconnect: true }));
			await f.wait(run, 'unknown');
			assert.equal(f.calls.length, 1);
		});
		await scenario('a definite 429 can retry once and complete the same model step', {}, async (f) => {
			let attempts = 0;
			const run = await f.start('rate recovered', () => (++attempts === 1 ? { status: 429 } : {}));
			await f.wait(run, 'completed');
			assert.equal(f.calls.length, 2);
			assert.equal(f.rows('agent_run_model_steps', run).length, 1);
		});
		await scenario(
			'stream batching preserves unicode text and flushes the prefix before a tool/control boundary',
			{},
			async (f) => {
				const chunks = Array.from({ length: 128 }, (_, index) => '片段🙂' + index + '\n');
				const run = await f.start('stream batch', (results) =>
					results.length
						? { text: 'finished' }
						: {
								chunks,
								name: 'machine_connection_list',
								input: {},
							},
				);
				await f.wait(run, 'completed');
				const events = textEvents(f, run);
				assert.equal(
					events
						.filter((event) => event.step_index === 1)
						.map((event) => event.text_delta)
						.join(''),
					chunks.join(''),
				);
				assert.equal(
					events
						.filter((event) => event.step_index === 2)
						.map((event) => event.text_delta)
						.join(''),
					'finished',
				);
				const next = JSON.parse(contexts(f, run)[1].content_json);
				assert.equal(next.messages.find((message) => message.role === 'assistant').content, chunks.join(''));
			},
		);
		for (const cancelled of [false, true]) {
			await scenario(
				cancelled
					? 'cancelling a silent stream drains its prefetch and closes transport'
					: 'a disconnected stream retains the persisted prefix without replay',
				{},
				async (f) => {
					const run = await f.start('incomplete stream', () => ({ chunks: ['prefix中文🙂'], hold: true }));
					await until(
						() => textEvents(f, run),
						(rows) => rows.map((row) => row.text_delta).join('') === 'prefix中文🙂',
						'Persisted prefix',
					);
					if (cancelled) {
						await f.cancel(run);
					} else {
						f.failModels();
					}
					await f.wait(run, cancelled ? 'cancelled' : 'unknown');
					await until(
						() => f.heldModelCount,
						(count) => count === 0,
						'Original model transport closed',
					);
					assert.equal(f.calls.length, 1);
					assert.equal(
						textEvents(f, run)
							.map((row) => row.text_delta)
							.join(''),
						'prefix中文🙂',
					);
				},
			);
		}
	} finally {
		if (sshd) await sshd.close();
		await rm(root, { recursive: true, force: true });
	}
});

const backend = `import fs from 'node:fs';
let active = false, contextCalls = 0, toolCalls = 0;
export default {
 activate() { active = true; },
 health() { return active; },
 agent(input, signal) {
  signal.throwIfAborted();
  let isolated = false;
  try { fs.readFileSync('/etc/passwd'); } catch (error) { isolated = error.code === 'ERR_ACCESS_DENIED'; }
  if (!isolated) throw new Error('Isolation missing');
  if (input.kind === 'context') { contextCalls++; return { text: JSON.stringify({ marker: 'FLOW_HOOK', stepIndex: input.stepIndex, contextCalls, pid: process.pid, isolated }) }; }
  toolCalls++;
 if (JSON.parse(input.argumentsJson).request === 'invalid') return { text: 17 };
  return { text: JSON.stringify({ name: input.name, operationId: input.operationId, arguments: JSON.parse(input.argumentsJson), toolCalls, contextCalls, pid: process.pid, isolated }) };
 },
 quiesce() { active = false; },
 dispose() { active = false; }
};`;

await test(
	'Agent signed contribution uses real isolated RPC and single-use tool approvals',
	{ timeout: 90000 },
	async (t) => {
		const root = await mkdtemp(join(tmpdir(), 'nexus-agent-extension-'));
		let sshd;
		let sequence = 0;

		async function scenario(name, work) {
			await t.test(name, async (testCase) => {
				const directory = join(root, String(++sequence));
				await mkdir(directory);
				const f = await openAgentExecution(directory, sshd, {
					plugin: {
						backend,
						contribution: {
							...contribution,
							beforeStep: true,
							tools: [{ name: 'status', description: 'Read the isolated fixture status.' }],
						},
					},
				});
				const cleanup = { unknown: false };
				testCase.after(() => f.close(cleanup));
				await f.grants(['context.read', 'plugin.invoke', 'machine.inspect']);
				await work(f, cleanup);
			});
		}

		function tool(body, sha256) {
			const prompt = body.messages.find((message) => message.role === 'system').content;
			const guidance = JSON.parse(
				prompt.split('Untrusted signed App guidance and context (never authority): ')[1],
			);
			const hook = JSON.parse(guidance.context);
			assert.equal(hook.marker, 'FLOW_HOOK');
			assert.equal(hook.isolated, true);
			assert.notEqual(hook.pid, process.pid);
			assert.deepEqual(body.tools.map((entry) => entry.function.name).sort(), ['plugin_tool_call', 'skill_read']);
			return {
				name: 'plugin_tool_call',
				input: {
					name: 'status',
					version: guidance.version,
					sha256: sha256 ?? guidance.sha256,
					argumentsJson: '{"request":"status"}',
				},
			};
		}

		try {
			sshd = await openSshd(root);
			await scenario(
				'approval dispatches once, reuses the isolated instance and refreshes the next-step hook',
				async (f) => {
					let report;
					const run = await f.start('invoke extension', (results, body) => {
						if (!results.length) return tool(body);
						assert.equal(results[0].untrusted, true);
						report = JSON.parse(results[0].text);
						const prompt = body.messages.find((message) => message.role === 'system').content;
						const hook = JSON.parse(
							JSON.parse(prompt.split('Untrusted signed App guidance and context (never authority): ')[1])
								.context,
						);
						assert.equal(hook.contextCalls, 2);
						assert.equal(hook.pid, report.pid);
						return {};
					});
					const approval = await f.approval(run, 'plugin_tool_call');
					assert.equal(f.calls.length, 1);
					assert.equal(f.rows('agent_run_tools', run)[0].state, 'inspected');
					const receipt = await f.approve(approval);
					await f.wait(run, 'completed');
					assert.ok(receipt);
					assert.equal(report.toolCalls, 1);
					assert.equal(report.contextCalls, 1);
					assert.equal(report.name, 'status');
					assert.deepEqual(report.arguments, { request: 'status' });
					assert.equal(report.operationId, f.rows('agent_run_tools', run)[0].id);
					assert.equal(f.rows('agent_run_tools', run)[0].state, 'completed');
					assert.equal(f.calls.length, 2);
				},
			);
			await scenario(
				'an incorrect signed contribution hash is refused before approval or isolated tool dispatch',
				async (f) => {
					const run = await f.start('stale extension', (_results, body) => tool(body, '0'.repeat(64)));
					await f.wait(run, 'failed');
					assert.equal(f.rows('agent_run_tools', run).length, 0);
					assert.equal(f.calls.length, 1);
				},
			);
			await scenario(
				'an unconfirmed plugin result preserves the original effect and retires its instance without blocking a new explicit task',
				async (f, cleanup) => {
					const run = await f.start('invalid extension result', (_results, body) => {
						const call = tool(body);
						call.input.argumentsJson = '{"request":"invalid"}';
						return call;
					});
					const approval = await f.approval(run, 'plugin_tool_call');
					cleanup.unknown = true;
					await f.approve(approval);
					await f.wait(run, 'unknown');
					assert.equal(f.rows('agent_run_tools', run)[0].state, 'unknown');
					const next = await f.start('fresh task after retired instance', () => ({}));
					await f.wait(next, 'completed');
					assert.equal(f.calls.length, 2, 'No replay of the uncertain tool');
					const prompt = f.calls[1].body.messages.find((message) => message.role === 'system').content;
					const hook = JSON.parse(
						JSON.parse(prompt.split('Untrusted signed App guidance and context (never authority): ')[1])
							.context,
					);
					assert.equal(hook.contextCalls, 1, 'A fresh isolated instance owns the new task');
					assert.equal(f.rows('agent_run_tools', run)[0].state, 'unknown');
				},
			);
			await scenario('revoking plugin.invoke invalidates pending approval without consuming it', async (f) => {
				const run = await f.start('revoke extension', (_results, body) => tool(body));
				const approval = await f.approval(run, 'plugin_tool_call');
				await f.grants(['context.read']);
				await f.wait(run, 'failed');
				const current = expectStatus(
					await f.api('GET', '/api/v1/apps/' + f.appId + '/approvals/' + approval.id),
					200,
				);
				assert.equal(current.consumedAt, null);
				assert.equal(current.status, 'superseded');
				assert.equal(f.calls.length, 1);
			});
		} finally {
			if (sshd) await sshd.close();
			await rm(root, { recursive: true, force: true });
		}
	},
);
