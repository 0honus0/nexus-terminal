import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPlugins } from './plugin-management-fixture.mjs';
import { openAgentExecution } from './agent-execution-fixture.mjs';
import { openPluginBrowser } from './plugin-browser-fixture.mjs';
import { expectStatus, openSshd, until } from '../remote/openssh-fixture.mjs';
import { InvalidAgentPayload } from '../../../packages/shared/dist/agent/http-codec.js';
import {
	readAgentPluginManifest,
	readAgentPluginAppBinding,
} from '../../../packages/shared/dist/agent/plugins/http-codec.js';
import { readAgentPluginRegistration } from '../../../packages/shared/dist/agent/plugins/registry-codec.js';
import { RegistryModel } from '../../../packages/backend/dist/modules/agent/plugins/registry/model/registry-model.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { readAgentPluginRpcInput } from '../../../packages/shared/dist/agent/plugins/rpc-codec.js';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '../../../packages/shared/dist/agent/scope/values.js';
import { readAgentPluginControl } from '../../../packages/shared/dist/agent/plugins/frontend-rpc-codec.js';
import {
	chatModelRequest,
	responseModelRequest,
} from '../../../packages/backend/dist/platform/ai/adapters/model-request.js';
import { ModelNetworkFailure } from '../../../packages/backend/dist/platform/ai/model-port.js';
import { readAgentRunStreamCommand, readAgentStreamFrame } from '../../../packages/shared/dist/agent/runs/events.js';

await test(
	'Agent modular: UI-only package replacement revokes the old view and preserves an active Run',
	{ timeout: 90000 },
	async (t) => {
		const f = await openPlugins(t);
		const uiId = 'isolated.ui-update';

		async function stageUi(version) {
			const bytes = await f.build('independent-ui', {
				definitionId: uiId,
				version,
				backend: null,
				contributions: {
					app: null,
					tools: false,
					services: false,
					ui: { contract: 'nexus.ui.chat', apiVersion: 1 },
					settings: null,
					skills: [],
				},
				frontendMarkup:
					'<!doctype html><title>UI ' +
					version +
					'</title><script type="module" src="./client.mjs"></script>',
			});
			const artifact = await f.upload(f.source.id, bytes);
			const stage = expectStatus(
				await f.api('POST', '/api/v1/agent/plugins/stage', {
					artifactAppId: f.source.id,
					artifactId: artifact.id,
					expectedVersion: artifact.version,
				}),
				200,
			);
			return expectStatus(
				await f.api('POST', '/api/v1/agent/plugins/verify', {
					stageId: stage.id,
					expectedVersion: stage.version,
				}),
				200,
			);
		}

		const initial = await stageUi('1.0.0');
		const { installation: uiPackage } = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/packages/install', {
				stageId: initial.id,
				expectedVersion: initial.version,
			}),
			200,
		);
		const plugin = await f.install('ui-execution-owner', {
			frontend: false,
			modelApp: true,
			uiPackageId: uiId,
		});
		await plugin.grants(['plugin.invoke']);
		const b = await openPluginBrowser(t, f, plugin, { holdModel: true });
		let frame = await b.frame();
		assert.equal(await frame.title(), 'UI 1.0.0');
		const provider = expectStatus(
			await f.api('POST', '/api/v1/agent/ai/providers', {
				kind: 'openai-compatible',
				displayName: 'UI update provider',
				baseUrl: b.modelUrl,
				protocol: 'chat-completions',
				models: [{ id: 'fixture', contextWindow: 8192, maxOutputTokens: 256, supportsTools: false }],
				enabled: true,
				credential: 'isolated-ui-update-key',
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
		const thread = expectStatus(
			await f.api('POST', plugin.appPath + '/threads', { title: 'UI update active Run' }),
			201,
		);
		const { run } = expectStatus(
			await f.api(
				'POST',
				plugin.appPath + '/threads/' + thread.id + '/runs',
				{
					prompt: 'Continue across UI replacement',
					approvalMode: 'ask',
					connectionIds: [],
					inputJson: JSON.stringify({
						model: {
							providerId: provider.id,
							modelId: 'fixture',
							configurationVersion: provider.version,
							reasoningEffort: null,
						},
						artifacts: [],
					}),
				},
				{ 'Idempotency-Key': randomUUID() },
			),
			201,
		);
		await until(
			() => b.heldModelCount,
			(count) => count === 1,
			'real model response remains active',
		);
		await frame.evaluate((runId) => {
			window.streamFailures = [];
			window.oldSubscription = window.sdk.agent.runs.subscribe(
				runId,
				0,
				() => {},
				(error) => window.streamFailures.push(error.code),
			);
		}, run.id);
		await b.page.waitForFunction(() =>
			window.bridge.requests.some((item) => item.type === 'nexus.plugin.stream' && item.command === 'ack'),
		);
		const appBefore = expectStatus(await f.api('GET', plugin.appPath), 200);

		const binding = async () =>
			expectStatus(await f.api('GET', '/api/v1/agent/plugins/apps/bindings'), 200).bindings.find(
				(item) => item.appId === plugin.appId,
			);

		const before = await binding();
		const descriptorPath = '/api/v1/agent/plugins/installations/' + plugin.appId + '/descriptor';
		const oldDescriptor = expectStatus(await f.api('GET', descriptorPath), 200);
		const next = await stageUi('1.1.0');
		const preparation = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/packages/' + uiId + '/prepare-update', {
				expectedRevision: uiPackage.revision,
				stageId: next.id,
				expectedStageVersion: next.version,
			}),
			200,
		);
		const updated = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/packages/' + uiId + '/update', {
				expectedRevision: preparation.installation.revision,
				dependencies: preparation.dependencies,
				stageId: next.id,
				expectedStageVersion: next.version,
			}),
			200,
		).installation;
		assert.equal(updated.version, '1.1.0');
		const after = await binding();
		assert.equal(after.executionRevision, before.executionRevision);
		assert.ok(after.uiRevision > before.uiRevision);
		assert.equal(after.ui.version, '1.1.0');
		assert.equal(expectStatus(await f.api('GET', plugin.appPath), 200).version, appBefore.version);
		assert.equal(expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200).status, 'running');
		expectStatus(await f.anonymous('GET', oldDescriptor.url), 403);
		await frame.waitForFunction(() => window.streamFailures.length > 0);
		assert.deepEqual(
			await frame.evaluate(() => window.streamFailures),
			['forbidden'],
			'revoking the old UI grant closes an idle active stream',
		);
		frame = await b.frame();
		assert.equal(await frame.title(), 'UI 1.1.0');
		const active = await frame.evaluate(
			(runId) => window.sdk.request({ method: 'agent.runs.get', params: { runId } }),
			run.id,
		);
		assert.equal(active.value.status, 'running');
		b.finishModels();
		await until(
			async () => expectStatus(await f.api('GET', plugin.appPath + '/runs/' + run.id), 200).status,
			(status) => status === 'completed',
			'the original Run completes after the UI replacement',
		);
		const entries = await frame.evaluate(
			({ threadId, limit }) =>
				window.sdk.request({
					method: 'agent.threads.entries',
					params: {
						threadId,
						after: { runSequence: 0, messageOrdinal: 0, chunkIndex: 0, textOffset: 0 },
						limit,
					},
				}),
			{ threadId: thread.id, limit: AGENT_THREAD_ENTRY_MAX_PAGE },
		);
		assert.match(
			entries.value.items
				.filter((item) => item.role === 'assistant')
				.map((item) => item.text)
				.join(''),
			/UI update prefix SDK subscription complete/,
		);
		assert.equal(b.modelCalls.length, 1, 'replacing and reconnecting a view does not replay accepted work');
	},
);

await test(
	'Agent modular: a slow catalog cannot block another source or local package management',
	{ timeout: 60000 },
	async (t) => {
		const catalog = Buffer.from(JSON.stringify({ schemaVersion: 2, publishers: [], packages: [] }));
		let held;
		let slowReads = 0;
		const server = createServer((request, response) => {
			if (request.url === '/slow/catalog.json') {
				slowReads++;
				held = response;
				response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': catalog.length });
				response.write(catalog.subarray(0, 1));
				return;
			}
			if (request.url === '/fast/catalog.json') {
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end(catalog);
				return;
			}
			response.writeHead(404).end();
		});
		t.after(async () => {
			held?.end(catalog.subarray(1));
			server.closeAllConnections();
			await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		});
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const f = await openPlugins(t);
		const origin = 'http://127.0.0.1:' + server.address().port;
		const slowUrl = origin + '/slow/catalog.json',
			fastUrl = origin + '/fast/catalog.json';
		const settings = expectStatus(await f.api('GET', '/api/v1/agent/plugins/repositories'), 200);
		const configured = expectStatus(
			await f.api('PUT', '/api/v1/agent/plugins/repositories', {
				expectedVersion: settings.version,
				repositories: [{ url: slowUrl }, { url: fastUrl }],
			}),
			200,
		);
		const slow = f.api('GET', '/api/v1/agent/plugins/remote/catalog?repositoryUrl=' + encodeURIComponent(slowUrl));
		const observed = Promise.allSettled([slow]);
		await until(
			() => slowReads,
			(count) => count === 1,
			'actual slow source starts its partial response',
		);
		const fast = expectStatus(
			await f.api('GET', '/api/v1/agent/plugins/remote/catalog?repositoryUrl=' + encodeURIComponent(fastUrl)),
			200,
		);
		assert.equal(fast.repositoryUrl, fastUrl);
		assert.deepEqual(fast.packages, []);
		assert.ok(expectStatus(await f.api('GET', '/api/v1/agent/plugins/packages'), 200).installations.length > 0);
		expectStatus(
			await f.api('PUT', '/api/v1/agent/plugins/repositories', {
				expectedVersion: configured.version,
				repositories: [{ url: fastUrl }],
			}),
			200,
		);
		held.end(catalog.subarray(1));
		const [late] = await observed;
		assert.equal(late.status, 'fulfilled');
		assert.equal(
			expectStatus(late.value, 409).code,
			'version_conflict',
			'removed source cannot publish a late successful catalog',
		);
	},
);

await test('Agent modular: signed namespace bounds and dynamic schemas reject inconsistent declarations', () => {
	const manifest = {
		schemaVersion: 4,
		id: 'test.schema',
		version: '1.0.0',
		displayName: 'Schema contract',
		compatibility: { host: { minVersion: '1.0.0', maxVersion: '1.99.99' }, backendSdk: 4, frontendSdk: null },
		capabilities: ['plugin.invoke'],
		intents: [],
		frontendEntry: null,
		backendEntry: 'backend/index.mjs',
		dependencies: [],
		namespaces: ['test.schema'],
		contributions: { app: null, tools: true, services: false, ui: null, settings: null, skills: [] },
	};
	assert.deepEqual(readAgentPluginManifest(manifest), manifest);
	for (const change of [
		(value) => {
			value.schemaVersion = 3;
		},
		(value) => {
			value.sdkVersion = '4';
		},
		(value) => {
			value.compatibility.backendSdk = 3;
		},
		(value) => {
			value.backendEntry = null;
			value.compatibility.backendSdk = null;
		},
		(value) => {
			value.contributions.tools = [];
		},
		(value) => {
			value.contributions.tools = [{ name: 'fixture_status' }];
		},
	]) {
		const invalid = structuredClone(manifest);
		change(invalid);
		assert.throws(() => readAgentPluginManifest(invalid), InvalidAgentPayload);
	}
	const schema = {
		type: 'object',
		properties: { request: { type: 'string', enum: ['status'] } },
		required: ['request'],
		additionalProperties: false,
	};
	const registration = {
		kind: 'tool',
		key: 'test.schema.status',
		contract: 'test.schema',
		apiVersion: 1,
		summary: 'Inspect fixture status',
		instructions: '',
		inputSchemaJson: JSON.stringify(schema),
		resultSchemaJson: '{"type":"object"}',
		capabilities: ['plugin.invoke'],
		tags: [],
		execution: 'managed',
	};
	assert.deepEqual(readAgentPluginRegistration(registration), registration);
	const registry = new RegistryModel((error) => {
		throw error;
	});
	const provider = {
		userId: 1,
		appId: randomUUID(),
		instanceId: randomUUID(),
		generation: randomUUID(),
		configurationRevision: 0,
		packageRevision: 1,
		package: {
			packageId: manifest.id,
			version: manifest.version,
			packageHash: 'a'.repeat(64),
			publisherKeyId: 'ed25519:' + 'b'.repeat(64),
		},
		namespaces: manifest.namespaces,
		appEntry: null,
		tools: true,
		services: false,
		capabilities: manifest.capabilities,
	};
	registry.publish(provider, [registration], null);

	const invalid = (error) =>
		error instanceof AgentFailure && ['invalid_input', 'capability_undeclared'].includes(error.code);

	for (const definition of [
		{ ...registration, contract: 'outside.namespace' },
		{ ...registration, capabilities: ['shell.execute'] },
		...[
			{ ...schema, required: ['missing'] },
			{ ...schema, properties: { request: { $ref: 'https://example.invalid/schema' } } },
			{ ...schema, required: ['request', 'request'] },
			{ ...schema, properties: { request: { type: 'string', enum: ['status', 'status'] } } },
			{ ...schema, properties: { request: { type: 'string', unknownKeyword: true } } },
		].map((value) => ({ ...registration, inputSchemaJson: JSON.stringify(value) })),
	])
		assert.throws(() => registry.publish(provider, [definition], provider.generation), invalid);
	assert.throws(() => registry.publish(provider, [registration, registration], provider.generation), invalid);
	const caller = {
		userId: provider.userId,
		appId: provider.appId,
		ownerId: randomUUID(),
		visibleInstanceIds: [provider.instanceId],
		visibleToolInstanceIds: [provider.instanceId],
		visibleToolKeys: null,
		capabilities: ['plugin.invoke'],
	};
	const entry = registry.discover(caller, { kind: 'tool', contract: null, apiVersion: null, cursor: null })
		.entries[0];
	const bound = registry.bind(caller, entry.id);
	assert.equal(registry.resolve(caller, bound.id, '{"request":"status"}').definition.key, registration.key);
	for (const input of ['{"request":"other"}', '{"extra":true}', '[]', 'null'])
		assert.throws(() => registry.resolve(caller, bound.id, input), invalid);
});

await test('Agent modular: App bindings preserve exact package provenance and plugin calls cannot forge host operation identity', () => {
	const reference = {
		packageId: 'test.package',
		version: '1.0.0',
		packageHash: 'a'.repeat(64),
		publisherKeyId: 'ed25519:' + 'b'.repeat(64),
	};
	const binding = {
		appId: randomUUID(),
		executionRevision: 1,
		uiRevision: 1,
		app: reference,
		dependencies: [],
		selectedRootIds: [],
		ui: structuredClone(reference),
	};
	assert.deepEqual(readAgentPluginAppBinding(binding), binding);
	for (const changed of [
		{ packageHash: 'c'.repeat(64) },
		{ publisherKeyId: 'ed25519:' + 'd'.repeat(64) },
		{ version: '1.0.1' },
	])
		assert.throws(
			() => readAgentPluginAppBinding({ ...binding, ui: { ...reference, ...changed } }),
			InvalidAgentPayload,
		);
	const request = {
		method: 'host.perform',
		params: { operation: 'remote.listPage', connectionId: 1, path: '/', after: '' },
	};
	assert.deepEqual(readAgentPluginRpcInput(request), request);
	assert.throws(
		() =>
			readAgentPluginRpcInput({ method: 'tools.invoke', params: { name: 'shell_execute', argumentsJson: '{}' } }),
		InvalidAgentPayload,
	);
	assert.throws(
		() => readAgentPluginRpcInput({ method: 'remote.listPage', params: { connectionId: 1, path: '/', after: '' } }),
		InvalidAgentPayload,
	);
	for (const changed of [
		{ ...request.params, runId: randomUUID() },
		{ ...request.params, operationId: randomUUID() },
		{ ...request.params, stepIndex: 1 },
		...['[]', 'null', '1', '"status"', '{'].map((argumentsJson) => ({ ...request.params, argumentsJson })),
	])
		assert.throws(() => readAgentPluginRpcInput({ ...request, params: changed }), InvalidAgentPayload);
});

await test('Agent modular: multiplex commands bind identity, generation and exact source shape', () => {
	const cancel = { type: 'nexus.plugin.cancel', protocol: 4, nonce: randomUUID(), seq: 1, id: randomUUID() };
	assert.deepEqual(readAgentPluginControl(cancel), cancel);
	assert.deepEqual(readAgentPluginControl({ type: 'nexus.plugin.close', protocol: 4, nonce: cancel.nonce, seq: 2 }), {
		type: 'nexus.plugin.close',
		protocol: 4,
		nonce: cancel.nonce,
		seq: 2,
	});
	assert.throws(() => readAgentPluginControl({ ...cancel, seq: 0 }), InvalidAgentPayload);
	assert.throws(() => readAgentPluginControl({ ...cancel, grant: randomUUID() }), InvalidAgentPayload);
	const command = {
		type: 'subscribe',
		subscriptionId: randomUUID(),
		generation: 1,
		source: { kind: 'run-events', appId: randomUUID(), grant: randomUUID(), runId: randomUUID(), after: 0 },
	};
	assert.deepEqual(readAgentRunStreamCommand(command), command);
	for (const changed of [
		{ ...command, generation: 0 },
		{ ...command, source: { ...command.source, operationId: randomUUID() } },
		{ ...command, source: { ...command.source, after: -1 } },
		{ ...command, source: { ...command.source, kind: 'write' } },
		{ type: 'ack', subscriptionId: command.subscriptionId, generation: 1, revision: 0 },
	])
		assert.throws(() => readAgentRunStreamCommand(changed), InvalidAgentPayload);
	const frame = {
		type: 'data',
		subscriptionId: command.subscriptionId,
		generation: 1,
		revision: 1,
		value: { items: [], nextCursor: 0 },
	};
	assert.deepEqual(readAgentStreamFrame(frame), frame);
	assert.throws(() => readAgentStreamFrame({ ...frame, generation: 0 }), InvalidAgentPayload);
	assert.throws(
		() =>
			readAgentStreamFrame({
				type: 'rejected',
				subscriptionId: command.subscriptionId,
				generation: 1,
				code: 'secret technical error',
			}),
		InvalidAgentPayload,
	);
});

await test('Agent modular: both actual provider request adapters preserve complete nested signed schemas', () => {
	const parameters = {
		type: 'object',
		description: 'Root description',
		additionalProperties: false,
		required: ['nested'],
		properties: {
			nested: {
				type: 'object',
				additionalProperties: false,
				required: ['flags'],
				properties: {
					flags: {
						type: 'array',
						description: 'Flags',
						items: { type: 'boolean', description: 'Enabled' },
						minItems: 0,
						maxItems: 4,
					},
					count: { type: 'integer', minimum: -2, maximum: 5 },
					ratio: { type: 'number', minimum: 0.25, maximum: 1.75 },
					mode: {
						type: 'string',
						description: 'Selected mode',
						minLength: 1,
						maxLength: 8,
						enum: ['fast', 'safe'],
					},
				},
			},
		},
	};
	const input = {
		baseUrl: 'https://example.test/v1',
		protocol: 'chat-completions',
		modelId: 'test',
		credential: null,
		maxOutputTokens: 128,
		usesReasoning: false,
		messages: [{ role: 'user', content: 'hello' }],
		tools: [{ name: 'sample', description: 'Sample tool', parameters }],
	};
	const chat = chatModelRequest(input);
	const responses = responseModelRequest({ ...input, protocol: 'responses' });
	assert.deepEqual(chat.tools[0].function.parameters, parameters);
	assert.deepEqual(responses.tools[0].parameters, parameters);
	assert.notEqual(chat.tools[0].function.parameters, parameters, 'the SDK boundary owns its white-list projection');
	assert.notEqual(responses.tools[0].parameters.properties.nested, parameters.properties.nested);
	for (const changed of [
		{ ...parameters, $ref: '#/$defs/root' },
		{ ...parameters, required: ['missing'] },
		{ ...parameters, required: [], properties: { ratio: { type: 'number', minimum: 2, maximum: 1 } } },
		{ ...parameters, required: [], properties: { mode: { type: 'string', pattern: '.*' } } },
		{ type: 'array', items: { type: 'string' } },
	]) {
		const invalid = { ...input, tools: [{ ...input.tools[0], parameters: changed }] };
		assert.throws(() => chatModelRequest(invalid), ModelNetworkFailure);
		assert.throws(() => responseModelRequest({ ...invalid, protocol: 'responses' }), ModelNetworkFailure);
	}
});

await test(
	'Agent modular: two Apps share one installed package and isolate data, grants and disable',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const first = await f.install('shared-package', { capabilities: ['artifacts.read'] });
		const { binding } = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/apps/compose', {
				packageId: first.installation.definitionId,
				selectedRootIds: [],
				uiPackageId: first.installation.definitionId,
			}),
			200,
		);
		assert.notEqual(binding.appId, first.appId);
		assert.equal(binding.app.packageHash, first.installation.packageHash);
		const secondPath = '/api/v1/agent/apps/' + binding.appId;
		const second = expectStatus(await f.api('GET', secondPath), 200);
		assert.equal(second.enabled, false, 'composition does not implicitly enable an App');
		assert.deepEqual(expectStatus(await f.api('GET', secondPath + '/grants'), 200).grants, []);
		await first.grants(['artifacts.read']);
		assert.deepEqual(expectStatus(await f.api('GET', secondPath + '/grants'), 200).grants, []);
		const enabledSecond = expectStatus(
			await f.api('PATCH', secondPath, { expectedVersion: second.version, enabled: true }),
			200,
		);
		const firstData = '/api/v1/agent/plugins/installations/' + first.appId + '/data/shared';
		const secondInstallationPath = '/api/v1/agent/plugins/installations/' + binding.appId;
		const secondInstallation = expectStatus(
			await f.api('GET', '/api/v1/agent/plugins/installations'),
			200,
		).items.find((item) => item.appId === binding.appId);
		const secondData = secondInstallationPath + '/data/shared';

		const write = (path, revision, valueJson) =>
			f.api('PUT', path, {
				expectedRevision: revision,
				expectedVersion: 0,
				operationId: randomUUID(),
				valueJson,
			});

		expectStatus(await write(firstData, first.installation.revision, '{"owner":"first"}'), 200);
		assert.equal(expectStatus(await f.api('GET', secondData), 200).value, null);
		expectStatus(await write(secondData, secondInstallation.revision, '{"owner":"second"}'), 200);
		assert.equal(expectStatus(await f.api('GET', firstData), 200).value.valueJson, '{"owner":"first"}');
		assert.equal(expectStatus(await f.api('GET', secondData), 200).value.valueJson, '{"owner":"second"}');
		await first.enabled(false);
		assert.equal(expectStatus(await f.api('GET', secondPath), 200).version, enabledSecond.version);
		expectStatus(await f.api('GET', firstData), 403);
		assert.equal(expectStatus(await f.api('GET', secondData), 200).value.valueJson, '{"owner":"second"}');
		await first.enabled(true);
		assert.equal(expectStatus(await f.api('GET', firstData), 200).value.valueJson, '{"owner":"first"}');
		const packages = expectStatus(await f.api('GET', '/api/v1/agent/plugins/packages'), 200).installations;
		assert.equal(packages.filter((item) => item.packageId === binding.app.packageId).length, 1);
	},
);

await test(
	'Agent modular: one WS isolates subscription credit and reconnect reads without replaying Runs',
	{ timeout: 90000 },
	async (t) => {
		const directory = await mkdtemp(
			join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-modular-stream-'),
		);
		const sshd = await openSshd(directory);
		let f;
		const sockets = new Set();
		t.after(async () => {
			const failures = [];
			for (const close of [
				async () => {
					await Promise.all(
						[...sockets].map(async (socket) => {
							if (socket.readyState === 3) return;
							const closed = once(socket, 'close');
							socket.terminate();
							await closed;
						}),
					);
				},
				() => f?.close(),
				() => sshd.close(),
				() =>
					process.env.NEXUS_AGENT_ACCEPTANCE_ROOT
						? undefined
						: rm(directory, { recursive: true, force: true }),
			]) {
				try {
					await close();
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Multiplex fixture cleanup failed');
		});
		f = await openAgentExecution(directory, sshd);
		const first = await f.start('first multiplex run', () => ({ chunks: ['first prefix'], hold: true }));
		const second = await f.start('second multiplex run', () => ({ chunks: ['second prefix'], hold: true }));
		await until(
			() => f.heldModelCount,
			(count) => count === 2,
			'both real Provider responses remain open',
		);
		const app = expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId), 200);

		const source = (run) => ({
			kind: 'run',
			appId: f.appId,
			access: { kind: 'session', appVersion: app.version },
			runId: run.id,
			cursor: {
				threadId: run.threadId,
				entries: { runSequence: 0, messageOrdinal: 0, chunkIndex: 0, textOffset: 0 },
				events: 0,
				approvals: null,
			},
		});

		async function connect() {
			const socket = f.openRunStream();
			sockets.add(socket);
			const messages = [];
			socket.on('message', (bytes) => messages.push(readAgentStreamFrame(JSON.parse(bytes.toString()))));
			await once(socket, 'open');
			return {
				socket,
				messages,

				send: (command) => socket.send(JSON.stringify(command)),
			};
		}

		const channel = await connect();
		const firstId = randomUUID(),
			secondId = randomUUID();
		channel.send({ type: 'subscribe', subscriptionId: firstId, generation: 1, source: source(first) });
		channel.send({ type: 'subscribe', subscriptionId: secondId, generation: 1, source: source(second) });
		const firstFrame = await until(
			() => channel.messages.find((frame) => frame.type === 'data' && frame.subscriptionId === firstId),
			Boolean,
			'first subscription snapshot',
		);
		const secondFrame = await until(
			() => channel.messages.find((frame) => frame.type === 'data' && frame.subscriptionId === secondId),
			Boolean,
			'second subscription snapshot',
		);
		assert.equal(firstFrame.value.state.run.id, first.id);
		assert.equal(secondFrame.value.state.run.id, second.id);
		f.finishModels();
		await f.wait(first, 'completed');
		await f.wait(second, 'completed');
		let terminal;
		let cursor = source(second).cursor;
		let body = '';
		for (let index = 0; !terminal; index++) {
			const frame = await until(
				() =>
					channel.messages.filter((item) => item.type === 'data' && item.subscriptionId === secondId)[index],
				Boolean,
				'second subscription continues while first is unacknowledged',
			);
			body += frame.value.body.items.map((item) => item.text).join('');
			cursor = {
				threadId: second.threadId,
				entries: frame.value.body.nextCursor,
				events: frame.value.state?.events.nextCursor ?? cursor.events,
				approvals: frame.value.state?.approvals.nextCursor ?? cursor.approvals,
			};
			terminal = frame.value.state?.run.status === 'completed' ? frame : null;
			channel.send({ type: 'ack', subscriptionId: secondId, generation: 1, revision: frame.revision });
		}
		assert.match(body, /second prefix/);
		assert.match(body, /Fixture released/);
		assert.equal(
			channel.messages.filter((frame) => frame.type === 'data' && frame.subscriptionId === firstId).length,
			1,
		);
		const closed = once(channel.socket, 'close');
		channel.socket.terminate();
		await closed;
		const resumed = await connect();
		resumed.send({
			type: 'subscribe',
			subscriptionId: secondId,
			generation: 2,
			source: { ...source(second), cursor },
		});
		const restored = await until(
			() => resumed.messages.find((frame) => frame.type === 'data'),
			Boolean,
			'reconnected authoritative snapshot',
		);
		assert.equal(restored.generation, 2);
		assert.equal(restored.value.state.run.status, 'completed');
		assert.deepEqual(restored.value.body.items, [], 'applied text is not duplicated on reconnect');
		assert.equal(f.calls.length, 2, 'read-only subscription recovery never replays model execution');
		resumed.send({ type: 'unsubscribe', subscriptionId: secondId, generation: 2 });
		assert.equal(
			(await f.wait(second, 'completed')).status,
			'completed',
			'view unsubscribe does not cancel an accepted Run',
		);
	},
);
