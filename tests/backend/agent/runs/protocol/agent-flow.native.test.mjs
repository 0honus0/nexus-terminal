import assert from 'node:assert/strict';
import { pinnedExecutionFixture } from '../../../../support/pinned-plugin-package.mjs';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openAgentExecution } from '../support/agent-execution-fixture.mjs';
import { expectStatus, openSshd } from '../../../../support/protocols/openssh-fixture.mjs';

const executionFixture = await pinnedExecutionFixture();
const contribution = {
	...executionFixture.contribution,
	app: { ...executionFixture.contribution.app, uiContract: null, uiApiVersion: null },
	skills: [],
};

function stored(fixture, sql, run) {
	const db = new DatabaseSync(fixture.database, { readOnly: true });
	try {
		return db.prepare(sql).all(run.id);
	} finally {
		db.close();
	}
}

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
		const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'nexus-agent-extension-'));
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
