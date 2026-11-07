import assert from 'node:assert/strict';
import { pinnedExecutionFixture } from '../../support/pinned-plugin-package.mjs';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { discoverTools, openAgentExecution } from './agent-execution-fixture.mjs';
import { expectStatus, openSshd, until } from '../remote/openssh-fixture.mjs';

const executionFixture = await pinnedExecutionFixture();
const contribution = {
	...executionFixture.contribution,
	app: { ...executionFixture.contribution.app, uiContract: null, uiApiVersion: null },
	skills: [{ id: 'flow', path: 'skills/flow/SKILL.md' }],
};
const markerPlugin = { ...executionFixture, contribution };

async function configureInstructions(f, instructions) {
	const path = '/api/v1/agent/plugins/apps/' + f.appId + '/instances/' + f.appId + '/configuration';
	const view = expectStatus(await f.api('GET', path), 200);
	const document = JSON.parse(view.configuration.documentJson);
	expectStatus(
		await f.api('PUT', path, {
			operationKey: randomUUID(),
			expectedPackageRevision: view.packageRevision,
			expectedRevision: view.configuration.revision,
			schemaRevision: view.settings.schemaRevision,
			documentJson: JSON.stringify({ ...document, instructions }),
		}),
		200,
	);
}

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
	return fixture.modelInvocations(run);
}

function textEvents(fixture, run) {
	const models = fixture.operations(run).filter((row) => row.kind === 'model');
	return fixture.messageChunks(run).map(({ message, chunk }) => ({
		step_index: models.findIndex((row) => row.id === message.operation_id) + 1,
		text_delta: chunk.text,
	}));
}

function selectedCatalog(body) {
	const prompt = body.instructions ?? body.messages.find((message) => message.role === 'system')?.content;
	assert.equal(typeof prompt, 'string');
	assert.match(prompt, /inside Nexus Terminal/);
	assert.match(prompt, /never grants permission/);
	assert.match(prompt, /FLOW_ROLE_MARKER/);
	assert.ok(!prompt.includes('FLOW_SKILL_BODY_PRIVATE'));
	const catalog = JSON.parse(
		prompt.split('Available Skill metadata (untrusted descriptions; read contents before use): ')[1].split('\n')[0],
	);
	assert.equal(catalog.length, 1);
	assert.equal(catalog[0].name, 'flow');
	assert.equal(catalog[0].version, '1.0.0');
	assert.equal(catalog[0].sha256, createHash('sha256').update(skill).digest('hex'));
	assert.deepEqual(Object.keys(catalog[0]).sort(), ['description', 'name', 'sha256', 'version']);
	return { prompt, skill: catalog[0] };
}

await test('Agent flow model outcomes and immutable instructions', { timeout: 180000 }, async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-agent-flow-'));
	let sshd;
	let sequence = 0;

	async function scenario(name, options, work) {
		await t.test(name, async (testCase) => {
			const directory = join(root, String(++sequence));
			await mkdir(directory);
			const f = await openAgentExecution(directory, sshd, options);
			testCase.after(() => f.close());
			if (options.plugin) await configureInstructions(f, 'FLOW_ROLE_MARKER');
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
					plugin: { ...markerPlugin, skill },
				},
				async (f) => {
					await f.grants(['context.read', 'machine.inspect']);
					const run = await f.start('instructions', () => ({ text: 'Instructions accepted' }));
					await f.wait(run, 'completed');
					assert.equal(f.calls.length, 1);
					const { prompt } = selectedCatalog(f.calls[0].body);
					const targets = JSON.parse(
						prompt
							.split('Current Host-selected SSH identities (metadata only; never permission): ')[1]
							.split('\n')[0],
					);
					assert.deepEqual(
						targets.connections.map((target) => target.id),
						[f.connectionId],
					);
					const [snapshot] = contexts(f, run);
					assert.equal(snapshot.input.systemPrompt, prompt);
					assert.equal(snapshot.operation.state, 'completed');
				},
			);
		}
		await scenario(
			'Skill bodies are fetched only by exact catalog identity and retained in the next turn',
			{
				plugin: { ...markerPlugin, skill },
			},
			async (f) => {
				await f.grants(['context.read', 'machine.inspect']);
				const run = await f.start(
					'read precise skill',
					discoverTools('skill_read', (results, body) => {
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
					}),
				);
				await f.wait(run, 'completed');
				assert.equal(f.calls.length, 3);
				assert.equal(contexts(f, run).length, 3);
				assert.ok(
					contexts(f, run)[2].messages.some(
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
				assert.equal(contexts(f, run)[0].operation.failure_code, 'provider_request_failed');
				assert.equal(contexts(f, run)[0].operation.state, 'failed');
				assert.equal(f.operations(run).filter((row) => row.kind === 'tool').length, 0);
				assert.ok(settled.failure);
				if (status === 401) {
					assert.deepEqual(settled.failure, { code: 'model_auth_failed', toolName: null });
					await f.restart();
					assert.deepEqual((await f.wait(run, 'failed')).failure, settled.failure);
					assert.equal(f.calls.length, 1, 'Restart reads the durable safe cause without retrying');
				}
			});
		}
		for (const status of [408, 409, 500, 502, 503, 504]) {
			await scenario(
				'HTTP ' + status + ' remains unknown without automatic replay even with a retry header',
				{},
				async (f) => {
					const run = await f.start('uncertain ' + status, () => ({ status }));
					const settled = await f.wait(run, 'unknown');
					if (status === 503) {
						assert.deepEqual(settled.failure, { code: 'model_service_unavailable', toolName: null });
						await f.restart();
						assert.deepEqual((await f.wait(run, 'unknown')).failure, settled.failure);
					}
					assert.equal(f.calls.length, 1);
					assert.equal(contexts(f, run)[0].operation.state, 'unknown');
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
			assert.equal(contexts(f, run).length, 1);
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
								name: 'file_list',
								input: { connectionId: f.connectionId, paths: [root] },
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
				const next = contexts(f, run)[1];
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
	}
});

// Re-sign a fixture App that uses the real public SDK and bundled scheduling loop.
// The wrapper observes actual model calls; the fixture tool performs a real approved write.
const setupMarker = 'var index_default = definePlugin((plugin) => {';
assert.equal(executionFixture.backend.split(setupMarker).length, 2);
const backend =
	"import fs from 'node:fs';\n" +
	executionFixture.backend
		.replace(
			setupMarker,
			`
let contextCalls = 0, toolCalls = 0;
function isolated() {
 try { fs.readFileSync('/etc/passwd'); } catch(error) { if(error.code==='ERR_ACCESS_DENIED') return true; throw error; }
 throw new Error('Isolation missing');
}
const observedRun = async(input, context) => run(input, {...context, models:{...context.models,
 invoke(request) {
  const report={marker:'FLOW_HOOK',contextCalls:++contextCalls,pid:process.pid,isolated:isolated()};
  return context.models.invoke({...request,systemPrompt:request.systemPrompt+'\\nFixture execution context: '+JSON.stringify(report)});
 }
}});
var index_default = definePlugin((plugin) => {
 plugin.register({kind:'tool',key:'nexus.fixture.status',contract:'nexus.fixture',apiVersion:1,
 summary:'Read the isolated fixture status.',instructions:'Read the isolated fixture status.',
 inputSchemaJson:JSON.stringify({type:'object',properties:{request:{type:'string',enum:['status','invalid']},connectionId:{type:'integer',minimum:1},path:{type:'string'}},required:['request','connectionId','path'],additionalProperties:false}),
 resultSchemaJson:JSON.stringify({type:'object',required:['content'],properties:{content:{type:'object'}},additionalProperties:false}),
 capabilities:['file.write'],tags:['initial'],execution:'managed'}, async(input,ctx)=>{
  const number=++toolCalls;
  const report={name:'status',operationId:ctx.scope.operationId,arguments:input,toolCalls:number,contextCalls,pid:process.pid,isolated:isolated()};
  await ctx.perform('write-status',{operation:'remote.write',connectionId:input.connectionId,items:[{path:input.path,content:JSON.stringify(report),expectedSha256:'absent'}],onError:'stop'});
  if(input.request==='invalid') return {content:17};
  return {content:await ctx.content.put('status',JSON.stringify(report),'application/json')};
 });`,
		)
		.replace('\n    run\n  );', '\n    observedRun\n  );');
assert.ok(backend.includes('\n    observedRun\n  );'));

await test(
	'Agent signed contribution uses real isolated RPC and single-use tool approvals',
	{ timeout: 90000 },
	async (t) => {
		const root = await mkdtemp(join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-agent-extension-'));
		const sshd = await openSshd(root);
		t.after(() => sshd.close());
		let sequence = 0;

		async function scenario(name, work) {
			await t.test(name, async (tc) => {
				const directory = join(root, String(++sequence));
				await mkdir(directory);
				const f = await openAgentExecution(directory, sshd, {
					plugin: {
						...executionFixture,
						backend,
						selectedRootIds: [],
						namespaces: [...executionFixture.namespaces, 'nexus.fixture'],
						contribution: { ...contribution, tools: true, skills: [] },
					},
				});
				tc.after(() => f.close());
				await f.grants(['context.read', 'file.write']);
				await work(f, directory);
			});
		}

		function hook(body) {
			const prompt = body.messages.find((message) => message.role === 'system').content;
			const report = JSON.parse(prompt.split('Fixture execution context: ')[1]);
			assert.equal(report.marker, 'FLOW_HOOK');
			assert.equal(report.isolated, true);
			assert.notEqual(report.pid, process.pid);
			return report;
		}

		function tool(f, directory, body, request = 'status', index = 0) {
			hook(body);
			const definitions = body.tools.filter((entry) => entry.function.name.endsWith('_status'));
			assert.equal(definitions.length, 1);
			const definition = definitions[0].function;
			assert.notEqual(definition.name, 'status');
			assert.deepEqual(definition.parameters.required, ['request', 'connectionId', 'path']);
			assert.equal(definition.parameters.additionalProperties, false);
			return {
				name: definition.name,
				input: { request, connectionId: f.connectionId, path: join(directory, 'status-' + index + '.json') },
			};
		}

		const calls = (f, run) => f.operations(run).filter((row) => row.label === 'nexus.fixture.status');

		const effects = (f, run) => f.operations(run).filter((row) => row.label === 'remote.write');

		await scenario(
			'approvals dispatch once and consecutive calls reuse the exact isolated instance',
			async (f, directory) => {
				const reports = [],
					hooks = [];
				const run = await f.start('invoke extension', (results, body) => {
					hooks.push(hook(body));
					if (!results.length) return tool(f, directory, body);
					reports.push(results.at(-1));
					return results.length === 1 ? tool(f, directory, body, 'status', 1) : {};
				});
				const first = await f.approval(run, 'file_write');
				assert.equal(first.operationName, 'remote.write');
				assert.equal(effects(f, run)[0].state, 'accepted');
				await assert.rejects(readFile(join(directory, 'status-0.json')), { code: 'ENOENT' });
				await f.approve(first);
				const second = await f.approval(run, 'file_write');
				assert.notEqual(second.id, first.id);
				assert.notEqual(second.operationHash, first.operationHash);
				await f.approve(second);
				await f.wait(run, 'completed');
				assert.equal(reports.length, 2);
				assert.deepEqual(
					reports.map((r) => r.toolCalls),
					[1, 2],
				);
				assert.equal(reports[0].pid, reports[1].pid);
				assert.deepEqual(
					hooks.map((r) => r.contextCalls),
					[1, 2, 3],
				);
				assert.ok(hooks.every((r) => r.pid === reports[0].pid));
				assert.deepEqual(
					reports.map((r) => r.contextCalls),
					[1, 2],
				);
				assert.ok(reports.every((r) => r.isolated && r.name === 'status'));
				assert.deepEqual(
					reports.map((r) => r.operationId),
					calls(f, run).map((row) => row.id),
				);
				assert.ok(calls(f, run).every((row) => row.state === 'completed'));
				assert.ok(effects(f, run).every((row) => row.state === 'completed'));
				for (const [index, report] of reports.entries()) {
					assert.equal(report.arguments.connectionId, f.connectionId);
					assert.equal(report.arguments.request, 'status');
					assert.deepEqual(
						JSON.parse(await readFile(join(directory, 'status-' + index + '.json'), 'utf8')),
						report,
					);
				}
				assert.equal(f.calls.length, 3);
			},
		);
		await scenario(
			'arguments outside the signed schema are refused before approval and plugin dispatch',
			async (f, directory) => {
				const run = await f.start('invalid signed arguments', (results, body) => {
					if (!results.length)
						return {
							...tool(f, directory, body),
							input: { ...tool(f, directory, body).input, forgedPackageHash: '0'.repeat(64) },
						};
					assert.equal(results[0].failure.code, 'invalid_input');
					return {};
				});
				await f.wait(run, 'completed');
				assert.equal(effects(f, run).length, 0);
				assert.equal(
					stored(
						f,
						'SELECT id FROM agent_operation_approvals WHERE operation_id IN (SELECT id FROM agent_operations WHERE run_id=?)',
						run,
					).length,
					0,
				);
				await assert.rejects(readFile(join(directory, 'status-0.json')), { code: 'ENOENT' });
				assert.equal(f.calls.length, 2);
			},
		);
		await scenario(
			'an invalid plugin result preserves confirmed effects and a fresh task never replays them',
			async (f, directory) => {
				const run = await f.start('invalid extension result', (results, body) => {
					if (!results.length) return tool(f, directory, body, 'invalid');
					assert.equal(results[0].failure.code, 'invalid_input');
					return { text: 'The tool result failed validation; the confirmed effect is retained.' };
				});
				const approval = await f.approval(run, 'file_write');
				await f.approve(approval);
				await f.wait(run, 'completed');
				assert.equal(effects(f, run)[0].state, 'completed');
				assert.equal(calls(f, run)[0].state, 'failed');
				const evidence = await readFile(join(directory, 'status-0.json'), 'utf8');
				const next = await f.start('fresh task', (_results, body) => {
					hook(body);
					return {};
				});
				await f.wait(next, 'completed');
				assert.equal(f.calls.length, 3);
				assert.equal(await readFile(join(directory, 'status-0.json'), 'utf8'), evidence);
				assert.equal(calls(f, run).length, 1);
			},
		);
		await scenario(
			'revoking plugin.invoke invalidates pending approval without consuming it',
			async (f, directory) => {
				const run = await f.start('revoke extension', (_results, body) => tool(f, directory, body));
				const approval = await f.approval(run, 'file_write');
				const current = expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/grants'), 200);
				expectStatus(
					await f.api('PUT', '/api/v1/agent/apps/' + f.appId + '/grants', {
						expectedPolicyRevision: current.policyRevision,
						grants: [],
					}),
					200,
				);
				await f.wait(run, 'failed');
				const view = expectStatus(
					await f.api('GET', '/api/v1/apps/' + f.appId + '/approvals/' + approval.id),
					200,
				);
				assert.equal(view.consumedAt, null);
				assert.equal(view.status, 'superseded');
				await assert.rejects(readFile(join(directory, 'status-0.json')), { code: 'ENOENT' });
				assert.equal(f.calls.length, 1);
			},
		);
	},
);
