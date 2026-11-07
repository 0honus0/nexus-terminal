import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
	readAgentPluginDataValue,
	readAgentPluginDataView,
} from '../../../packages/shared/dist/agent/plugins/http-codec.js';
import { readAgentPluginDataMigration } from '../../../packages/shared/dist/agent/plugins/migration-http-codec.js';
import {
	chatModelRequest,
	responseModelRequest,
} from '../../../packages/backend/dist/platform/ai/adapters/model-request.js';
import { ModelToolStream } from '../../../packages/backend/dist/platform/ai/adapters/model-tool-stream.js';
import { ModelNetworkFailure } from '../../../packages/backend/dist/platform/ai/model-port.js';
import { RunExecutionOwner } from '../../../packages/backend/dist/modules/agent/runs/service/run-execution-owner.js';
import { parsePluginSkills } from '../../../packages/backend/dist/modules/agent/plugins/plugin-skill-rules.js';
import { readStepProposals } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-step-proposals.js';
import { readRepositorySettings } from '../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-repository-sql.js';
import { resultPage } from '../../../packages/backend/dist/modules/agent/context/result-rules.js';
import { readAgentCreateRunRequest } from '../../../packages/shared/dist/agent/runs/http-codec.js';
import { readAgentPluginHostOperationRequest } from '../../../packages/shared/dist/agent/plugins/host-operations-codec.js';
import {
	readAgentPluginRepositoryUpdate,
	readAgentPluginRepositorySettings,
} from '../../../packages/shared/dist/agent/plugins/repository-http-codec.js';

await test('Model adapters accept large tool catalogs and call groups while rejecting duplicate identities', () => {
	const tools = Array.from({ length: 160 }, (_, index) => ({
		name: 'tool_' + index,
		description: 'fixture',
		parameters: { schemaJson: '{"type":"object","properties":{},"required":[],"additionalProperties":false}' },
	}));
	const calls = Array.from({ length: 48 }, (_, index) => ({
		id: 'call_' + index,
		name: tools[index].name,
		argumentsJson: '{}',
	}));
	const messages = [
		{ role: 'user', content: 'do work' },
		{ role: 'assistant', content: '', reasoning: [], toolCalls: calls },
		...calls.map((call) => ({ role: 'tool', callId: call.id, content: '{}' })),
	];
	for (const [protocol, encode] of [
		['chat-completions', chatModelRequest],
		['responses', responseModelRequest],
	]) {
		const input = {
			protocol,
			baseUrl: 'https://model.invalid/v1',
			modelId: 'fixture',
			credential: null,
			usesReasoning: false,
			maxOutputTokens: 256,
			tools,
			messages,
		};
		assert.equal(encode(input).tools.length, 160);
		assert.throws(
			() => encode({ ...input, tools: [...tools, tools[0]] }),
			(error) => error instanceof ModelNetworkFailure && error.kind === 'response_invalid',
		);
	}
	for (const protocol of ['chat', 'responses']) {
		const stream = new ModelToolStream(true);
		for (const [index, call] of calls.entries()) {
			if (protocol === 'chat') {
				stream.chat([{ index, id: call.id, type: 'function', function: { name: call.name, arguments: '{}' } }]);
			} else {
				stream.response({
					type: 'response.output_item.added',
					output_index: index,
					item: {
						type: 'function_call',
						status: 'in_progress',
						arguments: '',
						call_id: call.id,
						name: call.name,
						id: 'item_' + index,
					},
				});
				stream.response({
					type: 'response.function_call_arguments.delta',
					output_index: index,
					item_id: 'item_' + index,
					delta: '{}',
				});
				stream.response({
					type: 'response.function_call_arguments.done',
					output_index: index,
					item_id: 'item_' + index,
					arguments: '{}',
				});
			}
		}
		assert.deepEqual(stream.finish(), calls);
	}
	assert.equal(
		readStepProposals(
			JSON.stringify(
				calls.map((call) => ({
					providerCallId: call.id,
					toolName: call.name,
					argumentsJson: call.argumentsJson,
				})),
			),
		).length,
		48,
	);
});

await test('Run shutdown drains more than 64 admitted writes and fences new admissions', async () => {
	const owner = new RunExecutionOwner({}, {}, {});
	const releases = [];
	const pending = Array.from({ length: 96 }, (_, index) =>
		owner.admitWrite(() => new Promise((resolve) => releases.push(() => resolve(index)))),
	);
	await Promise.resolve();
	assert.equal(owner.getPendingWriteCount(), 96);
	let closed = false;
	const close = owner.close().then(() => {
		closed = true;
	});
	await assert.rejects(
		owner.admitWrite(async () => assert.fail('closed owner dispatched')),
		(error) => error.code === 'provider_unavailable',
	);
	await Promise.resolve();
	assert.equal(closed, false);
	for (const release of releases) release();
	assert.deepEqual(
		await Promise.all(pending),
		Array.from({ length: 96 }, (_, index) => index),
	);
	await close;
	assert.equal(owner.getPendingWriteCount(), 0);
});

await test('Shared requests and storage consumers accept larger complete inputs without independent item quotas', () => {
	const connectionIds = Array.from({ length: 120 }, (_, index) => index + 1);
	assert.equal(
		readAgentCreateRunRequest({ prompt: 'x'.repeat(64000), inputJson: '{}', connectionIds, approvalMode: 'ask' })
			.connectionIds.length,
		120,
	);
	const repositories = Array.from({ length: 40 }, (_, index) => ({
		url: 'https://repository.invalid/' + index + '/' + 'x'.repeat(3600),
	}));
	const repositoriesJson = JSON.stringify(repositories);
	assert.ok(Buffer.byteLength(repositoriesJson) > 128 * 1024);
	assert.equal(readAgentPluginRepositoryUpdate({ expectedVersion: 0, repositories }).repositories.length, 40);
	assert.equal(
		readRepositorySettings({ version: 1, updated_at: 1, repositories_json: repositoriesJson }).repositories.length,
		40,
	);
	assert.equal(readAgentPluginRepositorySettings({ version: 1, updatedAt: 1, repositories }).repositories.length, 40);
	const path = '/' + 'segment/'.repeat(40) + 'file';
	const write = {
		operation: 'remote.write',
		connectionId: 1,
		items: [{ path, content: 'x'.repeat(70000), expectedSha256: 'absent' }],
		onError: 'stop',
	};
	assert.equal(readAgentPluginHostOperationRequest(write).items[0].content.length, 70000);
	assert.equal(
		readAgentPluginHostOperationRequest({
			operation: 'shell.execute',
			connectionId: 1,
			commands: ['echo ' + 'x'.repeat(20000)],
			onError: 'stop',
			cwd: null,
			mode: 'foreground',
			yieldSeconds: null,
		}).commands.length,
		1,
	);
	const id = randomUUID();
	assert.equal(
		readAgentPluginHostOperationRequest({
			operation: 'browser.type',
			sessionId: id,
			snapshotId: randomUUID(),
			nodeRef: '1',
			settleMs: 0,
			text: 'x'.repeat(20000),
		}).text.length,
		20000,
	);
	assert.equal(
		readAgentPluginHostOperationRequest({
			operation: 'browser.select',
			sessionId: id,
			snapshotId: randomUUID(),
			nodeRef: '1',
			settleMs: 0,
			values: Array.from({ length: 100 }, (_, index) => 'option' + index),
		}).values.length,
		100,
	);
	assert.equal(
		readAgentPluginHostOperationRequest({
			operation: 'browser.scroll',
			sessionId: id,
			settleMs: 0,
			deltaX: 0,
			deltaY: 50000,
		}).deltaY,
		50000,
	);
	assert.equal(
		readAgentPluginHostOperationRequest({ operation: 'browser.snapshot', sessionId: id, maxNodes: 2048 }).maxNodes,
		2048,
	);
});

await test('Result continuation returns large pages with exact Unicode offsets and JSON escaping budgets', () => {
	const text = 'a\n😀"\\'.repeat(15000);
	const sha256 = createHash('sha256').update(text).digest('hex');
	const toolCallId = randomUUID();
	let offset = 0;
	let result = '';
	let count = 0;
	do {
		const page = resultPage(text, { toolCallId, sha256, offset, maxBytes: 65536 }, 100000);
		assert.ok(Buffer.byteLength(JSON.stringify(page.text)) <= 65536);
		if (count === 0) assert.ok(Buffer.byteLength(page.text) > 4096);
		result += page.text;
		offset = page.nextOffset;
		count++;
	} while (offset !== null);
	assert.equal(result, text);
	assert.ok(count > 1);
});

await test('Skills use encoded RPC capacity rather than document count or a 12 KiB body quota', () => {
	const metadata = Array.from({ length: 80 }, (_, index) => '  key' + index + ': value').join('\n');
	const body = 'guidance '.repeat(6000);
	const documents = Array.from({ length: 70 }, (_, index) => {
		const name = 'skill-' + index;
		const content = '---\nname: ' + name + '\ndescription: guidance\nmetadata:\n' + metadata + '\n---\n' + body;
		return {
			path: 'skills/' + name + '/SKILL.md',
			content,
			sha256: createHash('sha256').update(content).digest('hex'),
		};
	});
	const skills = parsePluginSkills(documents, '4.0.0');
	assert.equal(skills.length, 70);
	assert.equal(skills[0].body, body);
});

await test('Model streamed argument capacity counts Unicode pairs split across provider deltas exactly', () => {
	const stream = new ModelToolStream(true);
	stream.chat([{ index: 0, id: 'unicode', type: 'function', function: { name: 'write', arguments: '{"text":"' } }]);
	for (let index = 0; index < 100000; index++) {
		stream.chat([{ index: 0, function: { arguments: '\ud83d' } }]);
		stream.chat([{ index: 0, function: { arguments: '\ude00' } }]);
	}
	stream.chat([{ index: 0, function: { arguments: '"}' } }]);
	assert.equal(JSON.parse(stream.finish()[0].argumentsJson).text, '😀'.repeat(100000));
});

await test('Plugin KV encoded value capacity remains readable through RPC and migration routes', () => {
	const valueJson = JSON.stringify('x'.repeat(300000));
	assert.equal(readAgentPluginDataValue(valueJson), valueJson);
	assert.equal(readAgentPluginDataView({ key: 'large', version: 1, valueJson, updatedAt: 1 }).valueJson, valueJson);
	const escaped = JSON.stringify('\n'.repeat(200000));
	assert.ok(Buffer.byteLength(escaped) < 512 * 1024);
	assert.throws(() => readAgentPluginDataValue(escaped));
	assert.throws(() =>
		readAgentPluginDataMigration({
			expectedRevision: 1,
			operationId: randomUUID(),
			items: [{ packageId: 'fixture.capacity', key: 'bad', expectedVersion: 0, valueJson: escaped }],
		}),
	);
});

await test('Tool content capacity follows actual encoded transports and accepts long ranking scores', async () => {
	const { readAgentMemoryProposal, readAgentMemoryResponse } =
		await import('../../../packages/shared/dist/agent/memory/http-codec.js');
	const content = 'memory '.repeat(12000);
	const input = { content, confidence: 1, expiresAt: null, sourceRunId: null };
	assert.equal(readAgentMemoryProposal(input).content, content);
	assert.equal(
		readAgentPluginHostOperationRequest({ operation: 'memory.propose', content, confidence: 1, expiresAt: null })
			.content,
		content,
	);
	const selection = readAgentPluginHostOperationRequest({
		operation: 'memory.retrieve',
		action: 'select',
		limit: 1,
		candidatesSha256: 'a'.repeat(64),
		items: [{ id: randomUUID(), version: 1, score: 80 }],
	});
	assert.equal(selection.items[0].score, 80);
	assert.equal(
		readAgentPluginHostOperationRequest({
			operation: 'images.generate',
			providerId: randomUUID(),
			configurationVersion: 1,
			modelId: 'fixture',
			prompt: content,
		}).prompt,
		content,
	);
	const oversized = '\u0001'.repeat(23000);
	assert.throws(() => readAgentMemoryProposal({ ...input, content: oversized }));
	assert.throws(() =>
		readAgentPluginHostOperationRequest({
			operation: 'memory.propose',
			content: oversized,
			confidence: 1,
			expiresAt: null,
		}),
	);
	assert.throws(() => readAgentMemoryResponse({ memory: {} }));
});

await test('Provider tool-call events may exceed the text delivery batching target', async () => {
	const { ModelStreamProjection } =
		await import('../../../packages/backend/dist/platform/ai/adapters/model-stream.js');
	const input = JSON.stringify({ body: 'message '.repeat(40000) });
	const stream = new ModelStreamProjection('chat-completions', true);
	stream.accept({
		event: null,
		data: {
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{ index: 0, id: 'large', type: 'function', function: { name: 'send', arguments: input } },
						],
					},
					finish_reason: null,
				},
			],
		},
	});
	stream.accept({ event: null, data: { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] } });
	assert.equal(stream.finish().at(-1).toolCalls[0].argumentsJson, input);
});

await test('SDK4 data records and complete Run info use their plugin envelope budget', async () => {
	const { readAgentPluginDataWrite, readAgentPluginDataRecord, readAgentPluginDataPage } =
		await import('../../../packages/shared/dist/agent/plugins/data.js');
	const { readAgentPluginRunInfo } = await import('../../../packages/shared/dist/agent/plugins/run-context.js');
	const documentJson = JSON.stringify({ text: 'x'.repeat(100000) });
	assert.equal(
		readAgentPluginDataWrite({
			operationKey: 'write',
			namespace: 'owned',
			key: 'large',
			expectedRevision: 0,
			documentJson,
		}).documentJson,
		documentJson,
	);
	assert.equal(readAgentPluginDataRecord({ key: 'large', revision: 1, documentJson }).documentJson, documentJson);
	const items = Array.from({ length: 500 }, (_, index) => ({
		key: 'key' + index + 'x'.repeat(64),
		revision: 1,
		deleted: false,
	}));
	assert.equal(readAgentPluginDataPage({ items, nextCursor: null }).items.length, 500);
	const info = {
		runId: randomUUID(),
		threadId: randomUUID(),
		prompt: 'x'.repeat(60000),
		inputJson: documentJson,
		resumeInputJson: null,
		threadVersion: 1,
		autoTitle: true,
		sequence: 1,
		deadlineUnixMs: Date.now() + 60000,
		outputPreviewBytes: 65536,
	};
	assert.equal(readAgentPluginRunInfo(info).prompt, info.prompt);
});

await test('App, model, grant and intent capacities follow encoded envelopes without duplicate count or depth policies', async () => {
	const { readAgentAppDefinitionListResponse } =
		await import('../../../packages/shared/dist/agent/scope/http-codec.js');
	const { readAgentWorkspaceResult } =
		await import('../../../packages/shared/dist/agent/scope/workspace-http-codec.js');
	const { readAgentGrantReplaceRequest } =
		await import('../../../packages/shared/dist/agent/governance/http-codec.js');
	const { validGrant } = await import('../../../packages/backend/dist/modules/agent/governance/governance-rules.js');
	const { readAgentPluginIntentCreate, readAgentPluginIntentJson } =
		await import('../../../packages/shared/dist/agent/plugins/intent-http-codec.js');
	const declarations = Array.from({ length: 1100 }, (_, index) => ({
		id: 'fixture.app-' + index,
		version: '1.0.0',
		displayName: 'Fixture ' + index,
		capabilities: [],
	}));
	assert.equal(readAgentAppDefinitionListResponse(declarations).length, 1100);
	const models = Array.from({ length: 1100 }, (_, index) => ({
		providerId: randomUUID(),
		providerDisplayName: 'Fixture',
		configurationVersion: 1,
		modelId: 'model-' + index,
		protocol: 'chat-completions',
		reasoningEfforts: [],
		reasoningMandatory: false,
	}));
	const result = readAgentWorkspaceResult(
		{ method: 'agent.providers.list', value: models },
		{ method: 'agent.providers.list', params: {} },
	);
	assert.equal(result.value.length, 1100);
	const scope = {
		kind: 'targets',
		targets: { ssh: { mode: 'ids', ids: Array.from({ length: 1100 }, (_, index) => String(index + 1)) } },
	};
	const replacement = readAgentGrantReplaceRequest({
		expectedPolicyRevision: 1,
		grants: [{ capability: 'file.read', scope }],
	});
	assert.equal(replacement.grants[0].scope.targets.ssh.ids.length, 1100);
	assert.ok(validGrant('file.read', scope));
	assert.equal(validGrant('file.read', { ...scope, targets: { ssh: { mode: 'ids', ids: ['1', '1'] } } }), false);
	const inputJson = '['.repeat(256) + '{"payload":"fixture"}' + ']'.repeat(256);
	const intent = readAgentPluginIntentCreate({
		operationId: randomUUID(),
		receiverAppId: randomUUID(),
		intentId: 'fixture',
		inputJson,
		artifactIds: Array.from({ length: 80 }, () => randomUUID()),
		confirmed: true,
	});
	assert.equal(intent.artifactIds.length, 80);
	assert.equal(intent.inputJson, inputJson);
	assert.throws(() => readAgentPluginIntentJson('['.repeat(256) + '{"access_token":"blocked"}' + ']'.repeat(256)));
});

await test('Browser configuration accepts larger target, endpoint and pattern sets while preserving URL policy', async () => {
	const { readAgentBrowserTargets } =
		await import('../../../packages/shared/dist/agent/integrations/browser-http-codec.js');
	const { readBrowserConfiguration } =
		await import('../../../packages/backend/dist/modules/agent/integrations/adapters/sqlite/browser-sql.js');
	const endpoint = {
		url: 'wss://browser.example.test/devtools/browser/fixture',
		priority: 0,
		allowPlaintext: false,
		verifyTls: true,
	};
	for (const targets of [
		Array.from({ length: 40 }, (_, index) => ({
			id: 'fixture-' + index,
			endpoints: [endpoint],
			allowedUrlPatterns: ['https://example.test/*'],
		})),
		[
			{
				id: 'fixture',
				endpoints: Array.from({ length: 12 }, (_, index) => ({ ...endpoint, url: endpoint.url + '-' + index })),
				allowedUrlPatterns: Array.from(
					{ length: 40 },
					(_, index) => 'https://example.test/path-' + index + '/*',
				),
			},
		],
	]) {
		const decoded = readAgentBrowserTargets(targets);
		const reader = { one: async () => ({ version: 1, targets_json: JSON.stringify(decoded) }) };
		assert.deepEqual((await readBrowserConfiguration(reader, 1)).targets, decoded);
	}
	assert.throws(() =>
		readAgentBrowserTargets([
			{
				id: 'fixture',
				endpoints: [{ ...endpoint, url: 'ws://browser.example.test/' }],
				allowedUrlPatterns: ['https://example.test/*'],
			},
		]),
	);
});

await test('Integration configuration keeps complete transport and path budgets without separate argv or host-count policies', async () => {
	const { readAgentIntegrationConfiguration } =
		await import('../../../packages/shared/dist/agent/integrations/http-codec.js');
	const { AGENT_MCP_PROTOCOL_VERSION } = await import('../../../packages/shared/dist/agent/integrations/values.js');
	const acp = readAgentIntegrationConfiguration({
		kind: 'acp',
		displayName: 'Large invocation',
		connectionId: 1,
		argv: ['node', '-e', 'x'.repeat(10000), ...Array.from({ length: 160 }, (_, index) => String(index))],
		cwd: '/' + 'a/'.repeat(200) + 'work',
		protocolVersion: '1',
	});
	assert.equal(acp.argv.length, 163);
	assert.ok(acp.cwd.length > 256);
	const mcp = readAgentIntegrationConfiguration({
		kind: 'mcp',
		displayName: 'Many explicit authorities',
		endpoint: 'https://mcp.example.test/',
		privateHostExceptions: Array.from({ length: 40 }, (_, index) => 'host-' + index + '.example.test:443'),
		protocolVersion: AGENT_MCP_PROTOCOL_VERSION,
	});
	assert.equal(mcp.privateHostExceptions.length, 40);
	assert.throws(() => readAgentIntegrationConfiguration({ ...acp, argv: ['node', '\0'] }));
});

await test('Denylist and context snapshots do not add target/source count policies inside their existing encoded capacities', async () => {
	const { readAgentTargetDenylistReplaceRequest, readAgentTargetDenylistResponse } =
		await import('../../../packages/shared/dist/agent/governance/http-codec.js');
	const { currentDenylist } =
		await import('../../../packages/backend/dist/modules/agent/governance/adapters/sqlite/denylist-sql.js');
	const { decodeContextSnapshot } =
		await import('../../../packages/backend/dist/modules/agent/context/adapters/sqlite/context-row.js');
	const connectionIds = Array.from({ length: 300 }, (_, index) => index + 1);
	assert.deepEqual(
		readAgentTargetDenylistReplaceRequest({ connectionIds, expectedRevision: 1, reason: 'capacity fixture' })
			.connectionIds,
		connectionIds,
	);
	const rows = connectionIds.map((connection_id) => ({
		connection_id,
		reason: 'capacity fixture',
		changed_by: 1,
		changed_at: Date.now(),
	}));
	const stored = await currentDenylist({
		one: async () => ({ revision: 1 }),

		all: async () => rows,
	});
	assert.equal(readAgentTargetDenylistResponse(stored).entries.length, 300);
	const snapshot = {
		systemPrompt: 'fixture',
		messages: [{ role: 'user', content: 'fixture' }],
		sources: Array.from({ length: 5000 }, (_, index) => ({
			runId: randomUUID(),
			version: 1,
			sequence: index + 1,
			status: 'completed',
		})),
	};
	assert.equal(decodeContextSnapshot(JSON.stringify(snapshot)).sources.length, 5000);
	assert.throws(() =>
		decodeContextSnapshot(JSON.stringify({ ...snapshot, sources: [snapshot.sources[0], snapshot.sources[0]] })),
	);
});
