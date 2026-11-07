import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { pinnedExecutionFixture } from '../../support/pinned-plugin-package.mjs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openPlugins } from './plugin-management-fixture.mjs';
import { listAgentApprovalHistory } from './agent-approval-fixture.mjs';
import { packageTool } from '../../support/package-tool-catalog.mjs';
import { expectStatus, until } from '../remote/openssh-fixture.mjs';

const base = '/api/v1/agent/plugins';

const reference = ({ packageId, version, packageHash, publisherKeyId }) => ({
	packageId,
	version,
	packageHash,
	publisherKeyId,
});

const execution = await pinnedExecutionFixture();
const sdk = await readFile(new URL('../../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url));
const toolDefinition = {
	kind: 'tool',
	key: 'test.lifecycle.namespace_write',
	contract: 'nexus.model-tool',
	apiVersion: 1,
	summary: 'Write this instance namespace through the actual SDK.',
	instructions: '',
	inputSchemaJson: JSON.stringify({
		type: 'object',
		properties: { action: { type: 'string', enum: ['write', 'read'] } },
		additionalProperties: false,
	}),
	resultSchemaJson: '{"type":"object"}',
	capabilities: [],
	tags: ['initial'],
	execution: 'managed',
};
const storageBackend = `import { definePlugin } from './sdk.mjs';
export default definePlugin((plugin) => plugin.register(${JSON.stringify(toolDefinition)}, async (input, context) => {
 if (input.action !== 'read') {
  const result = await context.storage.write({namespace:'test.lifecycle',key:'shared',expectedRevision:0,operationKey:'initial-write',documentJson:'{"owner":"tool"}'});
  if(result.kind !== 'completed') throw new Error(JSON.stringify(result));
 }
 const value = await context.storage.read('test.lifecycle','shared');
 return { content: await context.content.put('result', JSON.stringify({value: {valueJson:value.documentJson}}), 'application/json') };
}));`;

const contributions = (_dependencies = [], tools = [], ui = false, app = true) => ({
	app: app ? { ...execution.contribution.app, uiContract: 'test.lifecycle.ui', uiApiVersion: 1 } : null,
	tools: tools.length > 0,
	services: false,
	ui: ui ? { contract: 'test.lifecycle.ui', apiVersion: 1 } : null,
	settings: app ? execution.contribution.settings : null,
	skills: app ? execution.contribution.skills : [],
});

const toolOptions = () => ({
	frontend: false,
	backend: storageBackend,
	backendAssets: { 'sdk.mjs': sdk },
	namespaces: ['test.lifecycle', 'nexus.model-tool'],
	capabilities: ['plugin.invoke'],
	contributions: contributions([], [toolDefinition], false, false),
});

const dependency = (f, packageId) => ({
	packageId,
	publisherKeyId: f.publisher.keyId,
	minVersion: '1.0.0',
	maxVersion: '9.0.0',
});

async function stage(f, id, version, options = {}) {
	const artifact = await f.upload(f.source.id, await f.build(id, { definitionId: id, version, ...options }));
	const staged = expectStatus(
		await f.api('POST', base + '/stage', {
			artifactAppId: f.source.id,
			artifactId: artifact.id,
			expectedVersion: artifact.version,
		}),
		200,
	);
	return expectStatus(
		await f.api('POST', base + '/verify', { stageId: staged.id, expectedVersion: staged.version }),
		200,
	);
}

async function installPackage(f, id, options) {
	const verified = await stage(f, id, '1.0.0', options);
	return expectStatus(
		await f.api('POST', base + '/packages/install', { stageId: verified.id, expectedVersion: verified.version }),
		200,
	).installation;
}

async function binding(f, appId) {
	const value = expectStatus(await f.api('GET', base + '/apps/bindings'), 200).bindings.find(
		(value) => value.appId === appId,
	);
	assert.ok(value);
	return value;
}

async function prepare(f, id, verified) {
	return expectStatus(
		await f.api('POST', base + '/packages/' + id + '/prepare-update', {
			expectedRevision: (await f.packageInstallation(id)).revision,
			stageId: verified.id,
			expectedStageVersion: verified.version,
		}),
		200,
	);
}

function updateInput(preparation, verified) {
	return {
		expectedRevision: preparation.installation.revision,
		stageId: verified.id,
		expectedStageVersion: verified.version,
		dependencies: preparation.dependencies,
	};
}

async function descriptor(f, appId) {
	return expectStatus(await f.api('GET', base + '/installations/' + appId + '/descriptor'), 200);
}

function rpc(f, appId, descriptor, request) {
	return f.api('POST', base + '/installations/' + appId + '/frontend/rpc', {
		grant: descriptor.url.split('/')[4],
		envelope: { type: 'nexus.plugin.request', protocol: 4, nonce: randomUUID(), id: randomUUID(), seq: 1, request },
	});
}

async function provider(t, f) {
	const programs = new Map();
	const failures = [];
	const server = createServer(async (request, response) => {
		try {
			const chunks = [];
			for await (const chunk of request) chunks.push(chunk);
			const body = JSON.parse(Buffer.concat(chunks).toString());
			const prompt = body.messages.findLast((entry) => entry.role === 'user').content;
			const results = body.messages.filter((entry) => entry.role === 'tool');
			const program = programs.get(prompt);
			assert.ok(program);
			if (results.length) program.results = results.map((entry) => JSON.parse(entry.content));
			const call =
				program.toolPackage && !results.length
					? {
							tool_calls: [
								{
									index: 0,
									id: 'namespace_call',
									type: 'function',
									function: {
										name: packageTool(body, program.toolPackage, 'namespace_write').name,
										arguments: JSON.stringify(program.toolInput),
									},
								},
							],
						}
					: { content: 'lifecycle history retained' };
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.end(
				'data: ' +
					JSON.stringify({ choices: [{ index: 0, delta: call, finish_reason: null }] }) +
					'\n\ndata: ' +
					JSON.stringify({
						choices: [{ index: 0, delta: {}, finish_reason: call.tool_calls ? 'tool_calls' : 'stop' }],
						usage: { prompt_tokens: 20, completion_tokens: 10 },
					}) +
					'\n\ndata: [DONE]\n\n',
			);
		} catch (error) {
			failures.push(error);
			response.destroy(error);
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(async () => {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		assert.deepEqual(failures, []);
	});
	const model = expectStatus(
		await f.api('POST', '/api/v1/agent/ai/providers', {
			kind: 'openai-compatible',
			displayName: 'composition lifecycle model',
			baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
			protocol: 'chat-completions',
			models: [{ id: 'fixture', contextWindow: 131072, maxOutputTokens: 128, supportsTools: true }],
			enabled: true,
			credential: 'isolated-lifecycle',
		}),
		201,
	);
	const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
	expectStatus(
		await f.api('PUT', '/api/v1/agent/execution-settings', {
			expectedVersion: settings.version,
			enabled: true,
			limits: settings.limits,
		}),
		200,
	);
	return async (plugin, toolPackage = null, toolInput = {}) => {
		const prompt = randomUUID();
		programs.set(prompt, { toolPackage, toolInput });
		const thread = expectStatus(
			await f.api('POST', plugin.appPath + '/threads', { title: 'retained lifecycle history' }),
			201,
		);
		const { run } = expectStatus(
			await f.api(
				'POST',
				plugin.appPath + '/threads/' + thread.id + '/runs',
				{
					prompt,
					approvalMode: 'ask',
					connectionIds: [],
					inputJson: JSON.stringify({
						model: {
							providerId: model.id,
							modelId: 'fixture',
							configurationVersion: model.version,
							reasoningEffort: null,
						},
						artifacts: [],
					}),
				},
				{ 'Idempotency-Key': randomUUID() },
			),
			201,
		);
		const completed = await until(
			async () => {
				for (const approval of await listAgentApprovalHistory(f.api, plugin.appId, run.id)) {
					if (approval.status !== 'requested') continue;
					expectStatus(
						await f.api(
							'POST',
							'/api/v1/apps/' + plugin.appId + '/approvals/' + approval.id + '/resolve',
							{
								decision: 'approved',
								operationHash: approval.operationHash,
								expectedVersion: approval.version,
							},
							{ 'Idempotency-Key': randomUUID() },
						),
						200,
					);
				}
				return expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200);
			},
			(value) => ['completed', 'failed', 'cancelled', 'unknown'].includes(value.status),
			'actual retained Run settles',
		);
		assert.equal(completed.status, 'completed', JSON.stringify(completed));

		return { thread, run: completed, results: programs.get(prompt).results ?? [] };
	};
}

await test(
	'Plugin composition lifecycle: removed App restoration preserves identity, completed history and data without regranting',
	{ timeout: 90000 },
	async (t) => {
		const f = await openPlugins(t);
		const plugin = await f.install('restore-identity', {
			modelApp: true,
			capabilities: ['context.read', 'plugin.invoke'],
		});
		await plugin.grants(['context.read', 'plugin.invoke']);
		const complete = await provider(t, f);
		const history = await complete(plugin);
		await plugin.grants([]);
		const path = base + '/installations/' + plugin.appId;
		const stored = expectStatus(
			await f.api('PUT', path + '/data/retained', {
				expectedRevision: plugin.installation.revision,
				expectedVersion: 0,
				operationId: randomUUID(),
				valueJson: '{"retained":true}',
			}),
			200,
		);
		const before = await binding(f, plugin.appId);
		const old = await descriptor(f, plugin.appId);
		const removed = expectStatus(
			await f.api('DELETE', path, { expectedRevision: plugin.installation.revision }),
			200,
		);
		assert.equal(removed.status, 'removed');
		assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).enabled, false);
		assert.ok(
			!expectStatus(await f.api('GET', '/api/v1/agent/apps'), 200).some((item) => item.id === plugin.appId),
		);
		const packageId = plugin.installation.definitionId;
		const packageBeforeRemoval = await f.packageInstallation(packageId);
		const removedPackage = expectStatus(
			await f.api('DELETE', base + '/packages/' + packageId, {
				expectedRevision: packageBeforeRemoval.revision,
				clearData: false,
			}),
			200,
		).installation;
		assert.equal(removedPackage.status, 'removed');
		const installedStage = expectStatus(await f.api('GET', base + '/stages/' + plugin.stage.id), 200);
		const reinstalled = expectStatus(
			await f.api('POST', base + '/packages/install', {
				stageId: installedStage.id,
				expectedVersion: installedStage.version,
			}),
			200,
		).installation;
		assert.deepEqual(reference(reinstalled), reference(packageBeforeRemoval));
		const restored = expectStatus(
			await f.api('POST', base + '/apps/' + plugin.appId + '/restore', {
				packageId: plugin.installation.definitionId,
				selectedRootIds: before.selectedRootIds,
				uiPackageId: before.ui?.packageId ?? null,
			}),
			200,
		).binding;
		assert.equal(restored.appId, plugin.appId);
		assert.deepEqual(restored.app, before.app);
		assert.ok(restored.executionRevision > before.executionRevision && restored.uiRevision > before.uiRevision);
		assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).enabled, false);
		assert.deepEqual(expectStatus(await f.api('GET', plugin.appPath + '/grants'), 200).grants, []);
		expectStatus(await f.anonymous('GET', old.url), 403);
		await plugin.enabled(true);
		assert.deepEqual(expectStatus(await f.api('GET', plugin.appPath + '/grants'), 200).grants, []);
		assert.deepEqual(expectStatus(await f.api('GET', path + '/data/retained'), 200).value, stored);
		assert.deepEqual(
			expectStatus(await f.api('GET', plugin.appPath + '/runs/' + history.run.id), 200),
			history.run,
		);
		const currentApp = expectStatus(await f.api('GET', plugin.appPath), 200);
		const threads = expectStatus(
			await f.api('POST', plugin.appPath + '/workspace', {
				appVersion: currentApp.version,
				request: { method: 'agent.threads.list', params: { after: null, limit: 50 } },
			}),
			200,
		).result.value.items;
		const retainedThread = threads.find((thread) => thread.id === history.thread.id);
		assert.ok(retainedThread);
		assert.equal(retainedThread.title, history.thread.title);
		assert.equal(retainedThread.createdAt, history.thread.createdAt);
		expectStatus(await f.anonymous('GET', old.url), 403);
		const restoredAgain = expectStatus(
			await f.api('POST', base + '/apps/' + plugin.appId + '/restore', {
				packageId: plugin.installation.definitionId,
				selectedRootIds: before.selectedRootIds,
				uiPackageId: before.ui?.packageId ?? null,
			}),
			200,
		).binding;
		assert.deepEqual(restoredAgain, restored, 'retry does not create another App or advance the binding');
	},
);

await test(
	'Plugin composition lifecycle: UI and tool namespaces retain same keys through full CAS migration and fence old RPC',
	{ timeout: 90000 },
	async (t) => {
		const f = await openPlugins(t);
		const toolId = 'test.lifecycle-tool';
		const uiId = 'test.lifecycle-ui';
		await installPackage(f, toolId, toolOptions());
		await installPackage(f, uiId, { contributions: contributions([], [], true, false) });
		const plugin = await f.install('namespace-owner', {
			modelApp: true,
			selectedRootIds: [toolId],
			uiPackageId: uiId,
			dependencies: [dependency(f, toolId), dependency(f, uiId)],
			frontend: false,
			capabilities: ['plugin.invoke'],
			contributions: contributions([dependency(f, toolId), dependency(f, uiId)]),
		});
		await plugin.grants(['plugin.invoke']);
		const complete = await provider(t, f);
		await complete(plugin, toolId);
		const legacy = new DatabaseSync(f.database);
		try {
			legacy
				.prepare(
					'INSERT INTO agent_plugin_extension_data(user_id,app_id,package_id,key,version,value_json,updated_at) VALUES(1,?,?,?,?,?,0)',
				)
				.run(plugin.appId, toolId, 'shared', 1, '{"owner":"tool"}');
		} finally {
			legacy.close();
		}
		const old = await descriptor(f, plugin.appId);
		const written = expectStatus(
			await rpc(f, plugin.appId, old, {
				method: 'storage.put',
				params: { key: 'shared', expectedVersion: 0, operationId: randomUUID(), valueJson: '{"owner":"ui"}' },
			}),
			200,
		);
		assert.equal(written.ok, true);
		assert.equal(
			expectStatus(
				await rpc(f, plugin.appId, old, {
					method: 'storage.put',
					params: {
						key: 'second',
						expectedVersion: 0,
						operationId: randomUUID(),
						valueJson: '{"owner":"ui-second"}',
					},
				}),
				200,
			).ok,
			true,
		);
		const path = base + '/installations/' + plugin.appId;
		assert.deepEqual(
			expectStatus(await f.api('GET', path + '/data/shared'), 200).value,
			written.result.value,
			'ordinary HTTP reads the same current UI namespace as its signed SDK grant',
		);
		expectStatus(
			await rpc(f, plugin.appId, old, {
				method: 'storage.get',
				params: { key: 'shared', packageId: toolId },
			}),
			400,
		);
		const httpWritten = expectStatus(
			await f.api('PUT', path + '/data/shared', {
				expectedRevision: old.uiRevision,
				expectedVersion: written.result.value.version,
				operationId: randomUUID(),
				valueJson: '{"owner":"http-ui"}',
			}),
			200,
		);
		assert.deepEqual(
			expectStatus(await rpc(f, plugin.appId, old, { method: 'storage.get', params: { key: 'shared' } }), 200)
				.result.value,
			httpWritten,
		);
		expectStatus(
			await f.api('PUT', path + '/data/shared', {
				expectedRevision: old.uiRevision + 1,
				expectedVersion: httpWritten.version,
				operationId: randomUUID(),
				valueJson: '{"stale":true}',
			}),
			409,
		);
		const deleted = expectStatus(
			await f.api('DELETE', path + '/data/shared', {
				expectedRevision: old.uiRevision,
				expectedVersion: httpWritten.version,
				operationId: randomUUID(),
			}),
			200,
		);
		assert.equal(deleted.valueJson, null);
		const restoredUi = expectStatus(
			await rpc(f, plugin.appId, old, {
				method: 'storage.put',
				params: {
					key: 'shared',
					expectedVersion: deleted.version,
					operationId: randomUUID(),
					valueJson: '{"owner":"ui"}',
				},
			}),
			200,
		);
		assert.equal(restoredUi.ok, true);
		assert.deepEqual(expectStatus(await f.api('GET', path + '/data/shared'), 200).value, restoredUi.result.value);
		const persisted = new DatabaseSync(f.database, { readOnly: true });
		try {
			assert.equal(
				persisted.prepare('SELECT COUNT(*) AS n FROM agent_plugin_data WHERE app_id=?').get(plugin.appId).n,
				0,
				'UI HTTP and SDK operations never create an App primary KV bridge',
			);
			assert.equal(
				persisted
					.prepare(
						'SELECT value_json FROM agent_plugin_extension_data WHERE app_id=? AND package_id=? AND key=?',
					)
					.get(plugin.appId, toolId, 'shared').value_json,
				'{"owner":"tool"}',
				'UI HTTP writes and deletes preserve the independent execution package namespace',
			);
		} finally {
			persisted.close();
		}
		const next = await stage(f, toolId, '1.1.0', toolOptions());
		const preparation = await prepare(f, toolId, next);
		const snapshot = expectStatus(await f.api('GET', path + '/data-snapshot'), 200);
		assert.deepEqual(
			snapshot.items
				.map(({ packageId, key, valueJson }) => ({ packageId, key, valueJson }))
				.sort((a, b) => a.packageId.localeCompare(b.packageId) || a.key.localeCompare(b.key)),
			[
				{ packageId: toolId, key: 'shared', valueJson: '{"owner":"tool"}' },
				{ packageId: uiId, key: 'shared', valueJson: '{"owner":"ui"}' },
				{ packageId: uiId, key: 'second', valueJson: '{"owner":"ui-second"}' },
			].sort((a, b) => a.packageId.localeCompare(b.packageId) || a.key.localeCompare(b.key)),
		);
		const input = {
			expectedRevision: snapshot.revision,
			operationId: randomUUID(),
			items: snapshot.items.map((item) => ({
				packageId: item.packageId,
				key: item.key,
				expectedVersion: item.version,
				valueJson: JSON.stringify({ migrated: item.packageId }),
			})),
		};
		expectStatus(
			await f.api('POST', path + '/migrate-data', {
				...input,
				operationId: randomUUID(),
				items: input.items.filter((item) => item.packageId === uiId && item.key === 'shared'),
			}),
			409,
		);
		expectStatus(
			await f.api('POST', path + '/migrate-data', {
				...input,
				operationId: randomUUID(),
				items: input.items.map((item, index) => ({
					...item,
					expectedVersion: item.expectedVersion + (index === 0 ? 1 : 0),
				})),
			}),
			409,
		);
		assert.deepEqual(expectStatus(await f.api('GET', path + '/data-snapshot'), 200), snapshot);
		for (const packageId of [toolId, uiId]) {
			const scoped = expectStatus(await f.api('GET', path + '/packages/' + packageId + '/data-snapshot'), 200);
			assert.deepEqual(
				scoped.items,
				snapshot.items.filter((item) => item.packageId === packageId),
			);
		}
		const beforeMigrationGrant = await descriptor(f, plugin.appId);
		assert.equal(
			expectStatus(
				await rpc(f, plugin.appId, beforeMigrationGrant, { method: 'storage.get', params: { key: 'shared' } }),
				200,
			).ok,
			true,
		);
		const before = await binding(f, plugin.appId);
		const migrated = expectStatus(await f.api('POST', path + '/migrate-data', input), 200);
		assert.deepEqual(
			expectStatus(await f.api('POST', path + '/migrate-data', input), 200),
			migrated,
			'same migration operation replays without advancing namespace CAS',
		);
		const after = await binding(f, plugin.appId);
		assert.equal(after.executionRevision, before.executionRevision + 1);
		assert.equal(after.uiRevision, before.uiRevision + 1);
		expectStatus(
			await rpc(f, plugin.appId, beforeMigrationGrant, { method: 'storage.get', params: { key: 'shared' } }),
			403,
		);
		const current = expectStatus(await f.api('GET', path + '/data-snapshot'), 200);
		for (const item of current.items) {
			const previous = snapshot.items.find(
				(value) => value.packageId === item.packageId && value.key === item.key,
			);
			assert.equal(item.version, previous.version + 1);
			assert.deepEqual(JSON.parse(item.valueJson), { migrated: item.packageId });
		}
		expectStatus(
			await f.api('POST', base + '/packages/' + toolId + '/cancel-update', {
				expectedRevision: preparation.installation.revision,
			}),
			409,
		);
		assert.equal(
			(await f.packageInstallation(toolId)).status,
			'draining',
			'migrated pending data cannot be exposed to old package code',
		);
		expectStatus(
			await f.api('POST', base + '/packages/' + toolId + '/update', updateInput(preparation, next)),
			200,
		);
		await plugin.enabled(true);
		const fresh = await descriptor(f, plugin.appId);
		const uiRead = expectStatus(
			await rpc(f, plugin.appId, fresh, { method: 'storage.get', params: { key: 'shared' } }),
			200,
		);
		assert.equal(uiRead.ok, true);
		assert.deepEqual(JSON.parse(uiRead.result.value.valueJson), { migrated: uiId });
		const toolRead = await complete(plugin, toolId, { action: 'read' });
		assert.deepEqual(
			JSON.parse(toolRead.results[0].value.valueJson),
			{ owner: 'tool' },
			'Legacy data migration does not rewrite instance-owned SDK4 storage',
		);
	},
);

await test(
	'Plugin composition lifecycle: App updates bind exact added and removed dependencies and unmigrated cancellation restores the old package',
	{ timeout: 90000 },
	async (t) => {
		const f = await openPlugins(t);
		const toolA = await installPackage(f, 'test.tool-a', toolOptions());
		const toolB = await installPackage(f, 'test.tool-b', toolOptions());
		const uiA = await installPackage(f, 'test.ui-a', { contributions: contributions([], [], true, false) });
		const uiB = await installPackage(f, 'test.ui-b', { contributions: contributions([], [], true, false) });
		const appId = 'test.dependency-app';

		const appOptions = (ids) => ({
			definitionId: appId,
			frontend: false,
			modelApp: true,
			uiPackageId: uiA.packageId,
			dependencies: ids.map((id) => dependency(f, id)),
			capabilities: ['plugin.invoke'],
			contributions: contributions(),
		});

		const plugin = await f.install('dependency-app', appOptions([toolA.packageId, uiA.packageId]));
		await plugin.grants(['plugin.invoke']);

		const before = await binding(f, plugin.appId);
		assert.deepEqual(before.dependencies, [reference(toolA), reference(uiA)]);
		assert.deepEqual(before.ui, reference(uiA));
		const next = await stage(f, appId, '1.1.0', appOptions([toolB.packageId, uiB.packageId]));
		const preparation = await prepare(f, appId, next);
		assert.deepEqual(
			preparation.dependencies,
			[toolB, uiA, uiB]
				.map((value) => ({ package: reference(value), installationRevision: value.revision }))
				.sort((a, b) => a.package.packageId.localeCompare(b.package.packageId)),
		);
		const command = updateInput(preparation, next);
		for (const dependencies of [
			[],
			command.dependencies.map((item, index) => ({
				...item,
				installationRevision: item.installationRevision + (index === 0 ? 1 : 0),
			})),
			command.dependencies.map((item, index) => ({
				...item,
				package: { ...item.package, packageHash: index === 0 ? '0'.repeat(64) : item.package.packageHash },
			})),
		]) {
			expectStatus(
				await f.api('POST', base + '/packages/' + appId + '/update', { ...command, dependencies }),
				409,
			);
			assert.deepEqual(
				await binding(f, plugin.appId),
				before,
				'failed exact dependency admission never partially replaces references',
			);
		}
		const updated = expectStatus(
			await f.api('POST', base + '/packages/' + appId + '/update', command),
			200,
		).installation;
		const after = await binding(f, plugin.appId);
		assert.deepEqual(after.app, reference(updated));
		assert.deepEqual(after.dependencies, [reference(toolB), reference(uiB)]);
		assert.deepEqual(after.ui, reference(uiA));
		assert.equal(after.executionRevision, before.executionRevision + 1);
		assert.equal(after.uiRevision, before.uiRevision + 1);
		const removed = await stage(f, appId, '1.2.0', appOptions([uiA.packageId]));
		const removePreparation = await prepare(f, appId, removed);
		expectStatus(
			await f.api('POST', base + '/packages/' + appId + '/update', updateInput(removePreparation, removed)),
			200,
		);
		const withoutTool = await binding(f, plugin.appId);
		assert.deepEqual(withoutTool.dependencies, [reference(uiA)]);
		assert.deepEqual(withoutTool.ui, reference(uiA));
		assert.equal(withoutTool.executionRevision, after.executionRevision + 1);
		assert.equal(withoutTool.uiRevision, after.uiRevision + 1);
		const grants = expectStatus(await f.api('GET', plugin.appPath + '/grants'), 200);
		const installed = await f.packageInstallation(appId);
		const pending = await stage(f, appId, '1.3.0', appOptions([toolA.packageId, uiB.packageId]));
		const cancellable = await prepare(f, appId, pending);
		const cancelled = expectStatus(
			await f.api('POST', base + '/packages/' + appId + '/cancel-update', {
				expectedRevision: cancellable.installation.revision,
			}),
			200,
		).installation;
		assert.equal(cancelled.status, 'installed');
		assert.deepEqual(reference(cancelled), reference(installed));
		assert.deepEqual(await binding(f, plugin.appId), withoutTool);
		assert.deepEqual(expectStatus(await f.api('GET', plugin.appPath + '/grants'), 200), grants);
		expectStatus(
			await f.api('POST', base + '/packages/' + appId + '/update', updateInput(cancellable, pending)),
			409,
		);
	},
);

await test(
	'Plugin composition lifecycle: marketplace App and Tools upgrades use the draining preparation revision on their first attempt',
	{ timeout: 90000 },
	async (t) => {
		const f = await openPlugins(t);
		const repositoryUrl = 'http://127.0.0.1:12345/lifecycle-catalog.json';
		const initial = expectStatus(await f.api('GET', base + '/repositories'), 200);
		const repositories = expectStatus(
			await f.api('PUT', base + '/repositories', {
				expectedVersion: initial.version,
				repositories: [...initial.repositories.map((entry) => ({ url: entry.url })), { url: repositoryUrl }],
			}),
			200,
		);
		for (const kind of ['app', 'tools']) {
			const id = 'test.market-revision-' + kind;
			const options =
				kind === 'app'
					? {
							modelApp: true,
							frontend: false,
							contributions: {
								...contributions(),
								app: { ...execution.contribution.app, uiContract: null, uiApiVersion: null },
							},
						}
					: toolOptions();
			const before = await installPackage(f, id, options);

			const next = await stage(f, id, '1.1.0', options);
			const result = expectStatus(
				await f.api('POST', base + '/install-plan', {
					initialization: 'disabled',
					repositoryVersion: repositories.version,
					target: {
						repositoryUrl,
						stageId: next.id,
						expectedVersion: next.version,
						expectedInstallationRevision: before.revision,
						package: {
							packageId: id,
							version: next.manifest.version,
							packageHash: next.packageHash,
							publisherKeyId: next.publisherKeyId,
						},
					},
					dependencies: [],
				}),
				200,
			);
			assert.equal(result.installation.version, '1.1.0');
			assert.equal(result.installation.status, 'installed');
			assert.equal(
				result.installation.revision,
				before.revision + 2,
				'actual execution package preparation increments revision before commit',
			);
			assert.equal((await f.packageInstallation(id)).packageHash, next.packageHash);
			assert.equal(result.binding === null, kind === 'tools');
		}
	},
);

await test(
	'Plugin composition lifecycle: immutable version conflicts reject preparation before draining or admitting data migration',
	{ timeout: 90000 },
	async (t) => {
		const f = await openPlugins(t);
		const id = 'test.immutable-prepare';
		const options = {
			definitionId: id,
			modelApp: true,
			capabilities: ['plugin.invoke'],
			contributions: contributions([], [], true),
		};
		const plugin = await f.install('immutable-prepare', options);
		const path = base + '/installations/' + plugin.appId;
		expectStatus(
			await f.api('PUT', path + '/data/retained', {
				expectedRevision: plugin.installation.revision,
				expectedVersion: 0,
				operationId: randomUUID(),
				valueJson: '{"before":true}',
			}),
			200,
		);
		const conflicting = await stage(f, id, '1.0.0', {
			...options,
			backend: execution.backend + '\n// Different signed bytes cannot replace this immutable version.\n',
		});
		const current = await f.packageInstallation(id);
		assert.notEqual(conflicting.packageHash, current.packageHash);

		const readFacts = () => {
			const db = new DatabaseSync(f.database, { readOnly: true });
			try {
				return {
					package: db.prepare('SELECT * FROM agent_plugin_packages WHERE package_id=?').get(id),
					pending: db.prepare('SELECT * FROM agent_plugin_package_updates WHERE package_id=?').get(id),
					app: db.prepare('SELECT * FROM agent_plugin_installations WHERE app_id=?').get(plugin.appId),
					binding: db.prepare('SELECT * FROM agent_plugin_app_bindings WHERE app_id=?').get(plugin.appId),
					references: db
						.prepare('SELECT * FROM agent_plugin_app_packages WHERE app_id=? ORDER BY kind,package_id')
						.all(plugin.appId),
					data: db.prepare('SELECT * FROM agent_plugin_data WHERE app_id=? ORDER BY key').all(plugin.appId),
					candidate: db.prepare('SELECT * FROM agent_plugin_stages WHERE id=?').get(conflicting.id),
				};
			} finally {
				db.close();
			}
		};

		const before = readFacts();
		expectStatus(
			await f.api('POST', base + '/packages/' + id + '/prepare-update', {
				expectedRevision: current.revision,
				stageId: conflicting.id,
				expectedStageVersion: conflicting.version,
			}),
			409,
		);
		assert.deepEqual(
			readFacts(),
			before,
			'an uncommittable signed candidate cannot drain or replace persisted facts',
		);
		expectStatus(await f.api('GET', path + '/data-snapshot'), 409);
		assert.deepEqual(readFacts(), before, 'a rejected preparation does not grant data migration authority');
		const next = await stage(f, id, '1.1.0', options);
		const preparation = await prepare(f, id, next);
		assert.equal(preparation.installation.status, 'draining');
		assert.equal(preparation.installation.revision, current.revision + 1);
		expectStatus(
			await f.api('POST', base + '/packages/' + id + '/cancel-update', {
				expectedRevision: preparation.installation.revision,
			}),
			200,
		);
	},
);

await test(
	'Plugin composition lifecycle: ordinary install cannot bypass a pending draining update after every referencing App is removed',
	{ timeout: 90000 },
	async (t) => {
		for (const migrate of [false, true])
			await t.test('data migrated=' + migrate, async (caseTest) => {
				const f = await openPlugins(caseTest);
				const id = 'test.pending-install-fence-' + migrate;
				const options = {
					definitionId: id,
					modelApp: true,
					capabilities: ['plugin.invoke'],
					contributions: contributions([], [], true),
				};
				const plugin = await f.install('pending-install-fence', options);
				const path = base + '/installations/' + plugin.appId;
				if (migrate)
					expectStatus(
						await f.api('PUT', path + '/data/pending', {
							expectedRevision: plugin.installation.revision,
							expectedVersion: 0,
							operationId: randomUUID(),
							valueJson: '{"before":true}',
						}),
						200,
					);
				const next = await stage(f, id, '1.1.0', options);
				const preparation = await prepare(f, id, next);
				assert.equal(preparation.installation.status, 'draining');
				if (migrate) {
					const snapshot = expectStatus(await f.api('GET', path + '/data-snapshot'), 200);
					expectStatus(
						await f.api('POST', path + '/migrate-data', {
							expectedRevision: snapshot.revision,
							operationId: randomUUID(),
							items: snapshot.items.map((item) => ({
								packageId: item.packageId,
								key: item.key,
								expectedVersion: item.version,
								valueJson: '{"after":true}',
							})),
						}),
						200,
					);
				}
				const app = expectStatus(await f.api('GET', base + '/installations'), 200).items.find(
					(item) => item.appId === plugin.appId,
				);
				assert.ok(app);
				expectStatus(await f.api('DELETE', path, { expectedRevision: app.revision }), 200);

				const readFacts = () => {
					const db = new DatabaseSync(f.database, { readOnly: true });
					try {
						return {
							current: db.prepare('SELECT * FROM agent_plugin_packages WHERE package_id=?').get(id),
							pending: db
								.prepare('SELECT * FROM agent_plugin_package_updates WHERE package_id=?')
								.get(id),
						};
					} finally {
						db.close();
					}
				};

				const before = readFacts();
				assert.ok(before.pending);
				assert.equal(before.pending.data_migrated, Number(migrate));
				for (const stageId of [plugin.stage.id, next.id]) {
					const candidate = expectStatus(await f.api('GET', base + '/stages/' + stageId), 200);
					expectStatus(
						await f.api('POST', base + '/packages/install', {
							stageId,
							expectedVersion: candidate.version,
						}),
						409,
					);
					assert.deepEqual(
						readFacts(),
						before,
						'rejected install preserves exact current and pending migration evidence',
					);
				}
				if (migrate) {
					expectStatus(
						await f.api('POST', base + '/packages/' + id + '/cancel-update', {
							expectedRevision: preparation.installation.revision,
						}),
						409,
					);
					expectStatus(
						await f.api('DELETE', base + '/packages/' + id, {
							expectedRevision: preparation.installation.revision,
							clearData: true,
						}),
						200,
					);
					const candidate = expectStatus(await f.api('GET', base + '/stages/' + next.id), 200);
					const installed = expectStatus(
						await f.api('POST', base + '/packages/install', {
							stageId: next.id,
							expectedVersion: candidate.version,
						}),
						200,
					).installation;
					assert.equal(installed.version, '1.1.0');
					assert.equal(readFacts().pending, undefined);
				} else {
					const cancelled = expectStatus(
						await f.api('POST', base + '/packages/' + id + '/cancel-update', {
							expectedRevision: preparation.installation.revision,
						}),
						200,
					).installation;
					assert.equal(cancelled.status, 'installed');
					assert.equal(readFacts().pending, undefined);
				}
			});
	},
);

await test(
	'Plugin composition lifecycle: removed configuration-only package stays discoverable and clearData preserves another App and shared tool namespace',
	{ timeout: 90000 },
	async (t) => {
		const f = await openPlugins(t);
		const toolId = 'test.retained-shared-tool';
		await installPackage(f, toolId, toolOptions());
		const options = {
			modelApp: true,
			selectedRootIds: [toolId],
			dependencies: [dependency(f, toolId)],
			capabilities: ['plugin.invoke', 'integration.mcp.read'],
			contributions: contributions([dependency(f, toolId)], [], true),
		};
		const removed = await f.install('configuration-only', options);
		const other = await f.install('configuration-survivor', options);
		await other.grants(['plugin.invoke']);

		const policy = async (plugin, maximum) => {
			const current = expectStatus(await f.api('GET', plugin.appPath + '/execution-policy'), 200);
			return expectStatus(
				await f.api('PUT', plugin.appPath + '/execution-policy', {
					expectedVersion: current.version,
					overrides: { maxModelRequests: maximum },
				}),
				200,
			);
		};

		await policy(removed, 7);
		const otherPolicy = await policy(other, 9);

		const instance = async (plugin) =>
			expectStatus(await f.api('GET', base + '/apps/' + plugin.appId + '/instances'), 200).instances.find(
				(value) => value.packageId === plugin.installation.definitionId,
			);

		const settingsPath = async (plugin) =>
			base + '/apps/' + plugin.appId + '/instances/' + (await instance(plugin)).id + '/configuration';

		const configure = async (plugin) => {
			const path = await settingsPath(plugin);
			const current = expectStatus(await f.api('GET', path), 200);
			return expectStatus(
				await f.api('PUT', path, {
					operationKey: randomUUID(),
					expectedRevision: current.configuration.revision,
					expectedPackageRevision: current.packageRevision,
					schemaRevision: current.configuration.schemaRevision,
					documentJson: JSON.stringify({ instructions: '', compactionMode: 'conservative' }),
				}),
				200,
			);
		};

		await configure(removed);
		const otherSettings = await configure(other);

		const complete = await provider(t, f);
		await complete(other, toolId);
		const ui = await descriptor(f, other.appId);
		assert.equal(
			expectStatus(
				await rpc(f, other.appId, ui, {
					method: 'storage.put',
					params: {
						key: 'survivor',
						expectedVersion: 0,
						operationId: randomUUID(),
						valueJson: '{"keep":true}',
					},
				}),
				200,
			).ok,
			true,
		);
		const db = new DatabaseSync(f.database, { readOnly: true });
		try {
			assert.equal(
				db
					.prepare(
						'SELECT COUNT(*) AS n FROM agent_plugin_extension_data WHERE app_id=? AND value_json IS NOT NULL',
					)
					.get(removed.appId).n,
				0,
			);
			assert.equal(
				db
					.prepare('SELECT COUNT(*) AS n FROM agent_plugin_data WHERE app_id=? AND value_json IS NOT NULL')
					.get(removed.appId).n,
				0,
			);
		} finally {
			db.close();
		}
		const removedPackageId = removed.installation.definitionId;
		expectStatus(
			await f.api('DELETE', base + '/installations/' + removed.appId, {
				expectedRevision: removed.installation.revision,
			}),
			200,
		);
		let current = await f.packageInstallation(removedPackageId);
		expectStatus(
			await f.api('DELETE', base + '/packages/' + removedPackageId, {
				expectedRevision: current.revision,
				clearData: false,
			}),
			200,
		);
		assert.ok(
			expectStatus(await f.api('GET', base + '/packages'), 200).retainedPackageIds.includes(removedPackageId),
			'configuration alone remains explicitly discoverable',
		);
		current = await f.packageInstallation(removedPackageId);
		expectStatus(
			await f.api('DELETE', base + '/packages/' + removedPackageId, {
				expectedRevision: current.revision,
				clearData: true,
			}),
			200,
		);
		assert.ok(
			!expectStatus(await f.api('GET', base + '/packages'), 200).retainedPackageIds.includes(removedPackageId),
		);
		const after = new DatabaseSync(f.database, { readOnly: true });
		try {
			assert.equal(
				after
					.prepare('SELECT execution_overrides_json FROM agent_governance_policies WHERE app_id=?')
					.get(removed.appId).execution_overrides_json,
				'{}',
			);
		} finally {
			after.close();
		}
		assert.deepEqual(expectStatus(await f.api('GET', other.appPath + '/execution-policy'), 200), otherPolicy);
		assert.deepEqual(
			expectStatus(await f.api('GET', await settingsPath(other)), 200).configuration,
			otherSettings.configuration,
		);
		assert.equal(
			expectStatus(
				await rpc(f, other.appId, await descriptor(f, other.appId), {
					method: 'storage.get',
					params: { key: 'survivor' },
				}),
				200,
			).result.value.valueJson,
			'{"keep":true}',
		);
		const shared = await complete(other, toolId, { action: 'read' });
		assert.deepEqual(JSON.parse(shared.results[0].value.valueJson), { owner: 'tool' });
	},
);
