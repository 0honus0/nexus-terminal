import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { runAppStorageFixture } from '../../support/run-app-storage-fixture.mjs';
import { ModelStreamProjection } from '../../../packages/backend/dist/platform/ai/adapters/model-stream.js';
import { currentRunAppExecution } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-app-execution-sql.js';
import { readRunAppExecution } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-app-execution-row.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import {
	readAgentPluginContentPage,
	AGENT_PLUGIN_CONTENT_CHUNK_BYTES,
} from '../../../packages/shared/dist/agent/plugins/content.js';
import {
	readAgentPluginCheckpoint,
	readAgentPluginRunHistory,
} from '../../../packages/shared/dist/agent/plugins/run-context.js';
import { InvalidAgentPayload } from '../../../packages/shared/dist/agent/http-codec.js';

const reasoning = [
	{ id: 'rs_saved', encryptedContent: 'encrypted-original-中文', summary: ['first summary', 'second summary'] },
];

const failure = (code) => (error) => error instanceof AgentFailure && error.code === code;

const checkpointInput = (state, consumedOperationIds = [], pendingIntents = []) => ({
	state,
	consumedOperationIds,
	pendingIntents,
});

await test('App phase ledger: full Unicode and escaped chunks use the declared content budget', () => {
	const reference = {
		id: randomUUID(),
		sha256: 'a'.repeat(64),
		sizeBytes: AGENT_PLUGIN_CONTENT_CHUNK_BYTES,
		mediaType: 'text/plain',
	};
	for (const text of [
		'中'.repeat(Math.floor(AGENT_PLUGIN_CONTENT_CHUNK_BYTES / 3)),
		'\u0000'.repeat(AGENT_PLUGIN_CONTENT_CHUNK_BYTES),
		'🙂'.repeat(AGENT_PLUGIN_CONTENT_CHUNK_BYTES / 4),
	]) {
		const page = { reference, index: 0, text, nextIndex: null };
		assert.ok(Buffer.byteLength(JSON.stringify(page)) > 32768);
		assert.deepEqual(readAgentPluginContentPage(page), page);
	}
	assert.throws(
		() =>
			readAgentPluginContentPage({
				reference,
				index: 0,
				text: 'a'.repeat(AGENT_PLUGIN_CONTENT_CHUNK_BYTES + 1),
				nextIndex: null,
			}),
		InvalidAgentPayload,
	);
	assert.throws(
		() => readAgentPluginContentPage({ reference, index: 0, text: '\ud800', nextIndex: null }),
		InvalidAgentPayload,
	);
});

await test('App phase ledger: checkpoint and history codecs accept complete receipt pages beyond the HTTP default', () => {
	const checkpoint = {
		version: 1,
		state: { id: randomUUID(), sha256: 'a'.repeat(64), sizeBytes: 1, mediaType: 'application/json' },
		consumedOperationIds: Array.from({ length: 1000 }, () => randomUUID()),
		pendingIntents: [],
	};
	assert.ok(Buffer.byteLength(JSON.stringify(checkpoint)) > 32768);
	assert.deepEqual(readAgentPluginCheckpoint(checkpoint), checkpoint);
	const history = { items: [{ runId: randomUUID(), sequence: 1, checkpoint }], nextBefore: null };
	assert.deepEqual(readAgentPluginRunHistory(history), history);
});

// SDK4 replaces Host-owned finishRoot/compaction wrappers with App-owned private
// state and a generic receipt boundary. These tests retain the original integrity,
// family drainage and reasoning assertions at their current authoritative owners.
await test('App phase ledger: sealed private state, consumed receipts and pending intents survive exact checkpoint replay', async (t) => {
	const f = await runAppStorageFixture(t);
	const scope = await f.create();
	const privateState = JSON.stringify({
		phase: 'exchange',
		messages: [{ role: 'assistant', content: 'response', reasoning }],
		exactRequest: { source: 'original prefix', cut: 2, tail: 'retained user input' },
	});
	const reference = await f.put(scope, privateState);
	const completed = await f.receipt(scope);
	const pending = [{ operationKey: 'model:next', requestSha256: 'a'.repeat(64) }];
	const input = checkpointInput(reference, [completed], pending);
	const saved = await f.states.checkpoint(scope, 0, input);
	assert.deepEqual(saved, { version: 1, ...input });
	assert.deepEqual(await f.states.checkpoint(scope, 0, structuredClone(input)), saved);
	assert.equal(await f.contents.text(scope, saved.state, new AbortController().signal), privateState);
	pending[0].operationKey = 'mutated-caller';
	input.consumedOperationIds.length = 0;
	assert.deepEqual((await f.states.read(scope)).pendingIntents, [
		{ operationKey: 'model:next', requestSha256: 'a'.repeat(64) },
	]);
	assert.deepEqual((await f.states.read(scope)).consumedOperationIds, [completed]);
	assert.equal(
		(await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status,
		'running',
		'Checkpointing does not end an App run',
	);
	assert.equal(
		(await f.db.one('SELECT COUNT(*) AS count FROM agent_operations')).count,
		1,
		'Checkpoint replay never dispatches the saved intent',
	);
});

await test('App phase ledger: same visible summary cannot replace exact state, content hash, media type or source ownership', async (t) => {
	const f = await runAppStorageFixture(t);
	const scope = await f.create();
	const original = await f.put(
		scope,
		JSON.stringify({ summary: 'same text', source: 'original prefix', cut: 2, tail: 'original tail' }),
	);
	const other = await f.put(
		scope,
		JSON.stringify({ summary: 'same text', source: 'different prefix', cut: 1, tail: 'different tail' }),
	);
	const first = await f.states.checkpoint(scope, 0, checkpointInput(original));
	await assert.rejects(f.states.checkpoint(scope, 0, checkpointInput(other)), failure('version_conflict'));
	for (const state of [
		{ ...original, id: randomUUID() },
		{ ...original, sha256: 'f'.repeat(64) },
		{ ...original, sizeBytes: original.sizeBytes + 1 },
		{ ...original, mediaType: 'text/plain' },
	]) {
		await assert.rejects(f.states.checkpoint(scope, 1, checkpointInput(state)), failure('not_found'));
		assert.deepEqual(await f.states.read(scope), first);
	}
	const foreign = await f.create();
	const foreignReference = await f.put(foreign);
	await assert.rejects(f.states.checkpoint(scope, 1, checkpointInput(foreignReference)), failure('not_found'));
	const draft = await f.contents.open({ ...scope, operationId: null }, scope.appId, 'unsealed', original.mediaType);
	await assert.rejects(
		f.states.checkpoint(scope, 1, checkpointInput({ ...original, id: draft.id })),
		failure('not_found'),
	);
	assert.deepEqual(await f.states.read(scope), first);
});

await test('App phase ledger: checkpoint CAS permits one concurrent writer and keeps earlier immutable content', async (t) => {
	const f = await runAppStorageFixture(t);
	const scope = await f.create();
	const first = await f.put(scope, '{"phase":"prepare"}');
	await f.states.checkpoint(scope, 0, checkpointInput(first));
	const candidates = await Promise.all(
		['next-A', 'next-B'].map((value) => f.put(scope, JSON.stringify({ phase: value }))),
	);
	const outcomes = await Promise.allSettled(
		candidates.map((state) => f.states.checkpoint(scope, 1, checkpointInput(state))),
	);
	assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
	const rejected = outcomes.find((item) => item.status === 'rejected');
	assert.ok(failure('version_conflict')(rejected.reason));
	assert.equal((await f.states.read(scope)).version, 2);
	assert.equal(await f.contents.text(scope, first, new AbortController().signal), '{"phase":"prepare"}');
	for (const expected of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
		assert.throws(() => f.states.checkpoint(scope, expected, checkpointInput(first)), failure('version_conflict'));
	}
});

for (const state of ['accepted', 'dispatched', 'unknown']) {
	await test(`App phase ledger: checkpoint cannot consume ${state} or another Run's receipt`, async (t) => {
		const f = await runAppStorageFixture(t);
		const scope = await f.create();
		const reference = await f.put(scope);
		const unfinished = await f.receipt(scope, { state });
		const other = await f.create();
		const foreign = await f.receipt(other);
		for (const id of [unfinished, foreign, randomUUID()]) {
			await assert.rejects(f.states.checkpoint(scope, 0, checkpointInput(reference, [id])), failure('forbidden'));
			assert.equal(await f.states.read(scope), null, 'A rejected receipt leaves no checkpoint');
		}
	});
}

await test('App phase ledger: completed, failed and cancelled receipts are consumable without inventing successful effects', async (t) => {
	const f = await runAppStorageFixture(t);
	const scope = await f.create();
	const reference = await f.put(scope);
	const ids = await Promise.all(['completed', 'failed', 'cancelled'].map((state) => f.receipt(scope, { state })));
	await f.states.checkpoint(scope, 0, checkpointInput(reference, ids));
	assert.deepEqual((await f.states.read(scope)).consumedOperationIds, ids);
	assert.deepEqual(
		(await f.db.all('SELECT state FROM agent_operations ORDER BY sequence')).map((item) => item.state),
		['completed', 'failed', 'cancelled'],
	);
});

for (const fence of ['generation', 'draining', 'closed', 'disabled', 'deadline', 'user', 'app']) {
	await test(`App phase ledger: ${fence} fence rejects new and replayed checkpoints`, async (t) => {
		const f = await runAppStorageFixture(t);
		const scope = await f.create();
		const reference = await f.put(scope);
		const input = checkpointInput(reference);
		const first = await f.states.checkpoint(scope, 0, input);
		let caller = scope;
		if (fence === 'generation') caller = { ...scope, executionGeneration: randomUUID() };
		if (fence === 'user') caller = { ...scope, userId: 2 };
		if (fence === 'app') caller = { ...scope, appId: randomUUID() };
		if (fence === 'draining' || fence === 'closed')
			await f.db.run('UPDATE agent_run_executions SET state=? WHERE run_id=?', [fence, scope.runId]);
		if (fence === 'disabled') await f.db.run('UPDATE agent_apps SET enabled=0 WHERE id=?', [scope.appId]);
		if (fence === 'deadline') await f.db.run('UPDATE agent_runs SET deadline_at=1 WHERE id=?', [scope.runId]);
		await assert.rejects(f.states.checkpoint(caller, 0, input), failure('forbidden'));
		await assert.rejects(f.states.checkpoint(caller, 1, input), failure('forbidden'));
		assert.deepEqual(await f.states.read(scope), first);
	});
}

await test('App phase ledger: Root history pages retain failed/cancelled checkpoints and exclude private Child and other scopes', async (t) => {
	const f = await runAppStorageFixture(t);
	const first = await f.create();
	const expected = [];
	for (const [index, status] of ['completed', 'failed', 'cancelled'].entries()) {
		const source = index === 0 ? first : await f.create({ threadId: first.threadId, sequence: index + 1 });
		const state = await f.put(
			source,
			JSON.stringify({ phase: status === 'completed' ? 'done' : 'exchange', private: status }),
		);
		const saved = await f.states.checkpoint(source, 0, checkpointInput(state));
		await f.db.run('UPDATE agent_runs SET status=? WHERE id=?', [status, source.runId]);
		expected.unshift({ runId: source.runId, sequence: source.sequence, checkpoint: saved });
	}
	const child = await f.create({ threadId: first.threadId, sequence: 4, parentId: first.runId });
	const privateChild = await f.put(child, '{"private":"Child-only information"}');
	await f.states.checkpoint(child, 0, checkpointInput(privateChild));
	await f.db.run("UPDATE agent_runs SET status='completed' WHERE id=?", [child.runId]);
	for (const options of [{}, { userId: 2, application: randomUUID() }, { application: randomUUID() }]) {
		const foreign = await f.create(options);
		await f.states.checkpoint(foreign, 0, checkpointInput(await f.put(foreign)));
		await f.db.run("UPDATE agent_runs SET status='completed' WHERE id=?", [foreign.runId]);
	}
	const scope = await f.create({ threadId: first.threadId, sequence: 5 });
	const result = await f.states.history(scope, null, 65536);
	assert.deepEqual(result, { items: expected, nextBefore: null });
	const pageBytes = 128 + Buffer.byteLength(JSON.stringify(expected[0])) + 1;
	const collected = [];
	let before = null;
	do {
		const page = await f.states.history(scope, before, pageBytes);
		assert.equal(page.items.length, 1);
		collected.push(...page.items);
		assert.ok(page.nextBefore === null || before === null || page.nextBefore < before);
		before = page.nextBefore;
	} while (before !== null);
	assert.deepEqual(collected, expected);
	assert.deepEqual((await f.states.history(scope, 3, 65536)).items, expected.slice(1));
	assert.deepEqual((await f.states.history(scope, Number.MAX_SAFE_INTEGER, 65536)).items, expected);
	assert.deepEqual(await f.states.history(scope, 1, 65536), { items: [], nextBefore: null });
	await assert.rejects(f.states.history(child, null, 65536), failure('forbidden'));
	assert.equal(
		(await f.contents.read(scope, expected[0].checkpoint.state, 0, true)).text,
		'{"phase":"exchange","private":"cancelled"}',
	);
	await assert.rejects(f.contents.read(scope, privateChild, 0, true), failure('not_found'));
	await assert.rejects(f.states.history({ ...scope, userId: 2 }, null, 65536), failure('not_found'));
});

await test('App phase ledger: retired execution cannot dispatch anew while exact private checkpoint remains readable', async (t) => {
	const f = await runAppStorageFixture(t);
	const scope = await f.create();
	const reference = await f.put(scope, JSON.stringify({ messages: [{ role: 'assistant', reasoning }] }));
	const checkpoint = await f.states.checkpoint(scope, 0, checkpointInput(reference));
	const retired = JSON.stringify({ kind: 'retired' });
	assert.deepEqual(readRunAppExecution(retired), { kind: 'retired' });
	assert.equal(await f.db.transaction((tx) => currentRunAppExecution(tx, scope)), false);
	assert.deepEqual(await f.states.read(scope), checkpoint);
	assert.deepEqual(
		JSON.parse(await f.contents.text(scope, reference, new AbortController().signal)).messages[0].reasoning,
		reasoning,
	);
});

for (const state of ['accepted', 'dispatched', 'unknown', 'completed', 'failed', 'cancelled']) {
	await test(`App phase ledger: ${state} generic receipt gates App completion at the real transaction`, async (t) => {
		const f = await runAppStorageFixture(t);
		const scope = await f.create();
		await f.receipt(scope, { state });
		await f.db.run("UPDATE agent_run_executions SET state='closed' WHERE run_id=?", [scope.runId]);
		const result = await f.finish(scope);
		assert.equal(result.status, state === 'accepted' || state === 'dispatched' ? 'operation_conflict' : 'ok');
		assert.equal(
			(await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status,
			state === 'accepted' || state === 'dispatched' ? 'running' : state === 'unknown' ? 'unknown' : 'completed',
		);
	});
}

for (const status of ['pending', 'running', 'suspended', 'unknown']) {
	await test(`App phase ledger: ${status} Child cannot be hidden by a successful or failed Root`, async (t) => {
		for (const terminal of ['completed', 'failed']) {
			const f = await runAppStorageFixture(t);
			const scope = await f.create();
			const child = await f.create({ threadId: scope.threadId, sequence: 2, parentId: scope.runId });
			await f.db.run('UPDATE agent_runs SET status=? WHERE id=?', [status, child.runId]);
			await f.db.run("UPDATE agent_run_executions SET state='closed' WHERE run_id=?", [scope.runId]);
			assert.equal((await f.finish(scope, terminal === 'failed' ? { state: 'failed' } : undefined)).status, 'ok');
			assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status, 'unknown');
		}
	});
}

for (const state of ['accepted', 'dispatched', 'unknown']) {
	await test(`App phase ledger: failed Child's ${state} receipt or Job remains visible to Root settlement`, async (t) => {
		for (const kind of ['operation', 'job']) {
			const f = await runAppStorageFixture(t);
			const scope = await f.create();
			const child = await f.create({ threadId: scope.threadId, sequence: 2, parentId: scope.runId });
			if (kind === 'operation') await f.receipt(child, { state });
			else
				await f.db.run('INSERT INTO agent_tool_jobs VALUES(?,?,?)', [
					randomUUID(),
					child.runId,
					state === 'accepted' ? 'queued' : state,
				]);
			await f.db.run("UPDATE agent_runs SET status='failed' WHERE id=?", [child.runId]);
			await f.db.run("UPDATE agent_run_executions SET state='closed' WHERE run_id=?", [scope.runId]);
			assert.equal((await f.finish(scope)).status, 'ok');
			assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status, 'unknown');
		}
	});
}

await test('App phase ledger: unclosed generation and unknown optional model/title effects prevent false completion', async (t) => {
	for (const label of [null, 'models.invoke', 'thread.title']) {
		const f = await runAppStorageFixture(t);
		const scope = await f.create();
		if (label !== null) {
			await f.receipt(scope, { state: 'unknown', label });
			await f.db.run("UPDATE agent_run_executions SET state='closed' WHERE run_id=?", [scope.runId]);
		}
		assert.equal((await f.finish(scope)).status, 'ok');
		assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status, 'unknown');
	}
});

await test('App phase ledger: completion validates exact exported content and stale finish cannot overwrite evidence', async (t) => {
	const f = await runAppStorageFixture(t);
	const scope = await f.create();
	const output = await f.put(scope, 'Final answer');
	await f.db.run("UPDATE agent_run_executions SET state='closed' WHERE run_id=?", [scope.runId]);
	for (const reference of [
		{ ...output, sha256: 'f'.repeat(64) },
		{ ...output, sizeBytes: output.sizeBytes + 1 },
	]) {
		assert.equal(
			(
				await f.finish(scope, {
					state: 'completed',
					outputJson: JSON.stringify({ kind: 'complete', outputs: [reference] }),
				})
			).status,
			'version_conflict',
		);
		assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status, 'running');
		assert.equal(
			(await f.db.one('SELECT output_json FROM agent_run_inputs WHERE run_id=?', [scope.runId])).output_json,
			null,
		);
	}
	const outputJson = JSON.stringify({ kind: 'complete', outputs: [output] });
	assert.equal((await f.finish(scope, { state: 'completed', outputJson })).status, 'ok');
	assert.equal(
		(await f.db.one('SELECT output_json FROM agent_run_inputs WHERE run_id=?', [scope.runId])).output_json,
		outputJson,
	);
	assert.equal((await f.finish(scope, { state: 'failed' })).status, 'version_conflict');
	assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status, 'completed');
});

for (const saved of [reasoning, []])
	await test(`App phase ledger: Responses stop preserves ${saved.length ? 'encrypted reasoning and summaries' : 'an empty reasoning array'}`, () => {
		const decoder = new ModelStreamProjection('responses');
		decoder.accept({
			event: 'response.completed',
			data: {
				type: 'response.completed',
				response: {
					status: 'completed',
					output: [
						...saved.map((item) => ({
							type: 'reasoning',
							id: item.id,
							encrypted_content: item.encryptedContent,
							summary: item.summary.map((text) => ({ type: 'summary_text', text })),
						})),
						{
							type: 'message',
							role: 'assistant',
							content: [{ type: 'output_text', text: 'first response' }],
						},
					],
				},
			},
		});
		assert.deepEqual(decoder.finish(), [{ type: 'completed', finishReason: 'stop', reasoning: saved }]);
	});

await test('App phase ledger: Responses tool calls retain encrypted reasoning and exact tool arguments', () => {
	const decoder = new ModelStreamProjection('responses', true);
	decoder.accept({
		event: 'response.completed',
		data: {
			type: 'response.completed',
			response: {
				status: 'completed',
				output: [
					{
						type: 'reasoning',
						id: reasoning[0].id,
						encrypted_content: reasoning[0].encryptedContent,
						summary: reasoning[0].summary.map((text) => ({ type: 'summary_text', text })),
					},
					{
						type: 'function_call',
						id: 'fc_exact',
						call_id: 'call_exact',
						name: 'fixture_tool',
						arguments: '{"path":"/exact"}',
						status: 'completed',
					},
				],
			},
		},
	});
	assert.deepEqual(decoder.finish(), [
		{
			type: 'completed',
			finishReason: 'tool_calls',
			reasoning,
			toolCalls: [{ id: 'call_exact', name: 'fixture_tool', argumentsJson: '{"path":"/exact"}' }],
		},
	]);
});

for (const finishReason of ['stop', 'length', 'content_filter'])
	await test(`App phase ledger: Chat ${finishReason} retains its exact terminal classification`, () => {
		const decoder = new ModelStreamProjection('chat-completions');
		decoder.accept({
			event: null,
			data: { choices: [{ index: 0, delta: { content: 'visible response' }, finish_reason: finishReason }] },
		});
		assert.deepEqual(decoder.finish(), [
			{ type: 'completed', finishReason, ...(finishReason === 'stop' ? { reasoning: [] } : {}) },
		]);
	});

for (const state of ['accepted', 'dispatched']) {
	await test(`App phase ledger: unknown Run preserves an unresolved ${state} receipt for recovery`, async (t) => {
		const f = await runAppStorageFixture(t);
		const scope = await f.create();
		const id = await f.receipt(scope, { state });
		await f.db.run("UPDATE agent_run_executions SET state='draining' WHERE run_id=?", [scope.runId]);
		assert.equal((await f.finish(scope, { state: 'unknown' })).status, 'ok');
		assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [scope.runId])).status, 'unknown');
		assert.equal((await f.db.one('SELECT state FROM agent_operations WHERE id=?', [id])).state, state);
		assert.equal(
			(await f.db.one('SELECT state FROM agent_run_executions WHERE run_id=?', [scope.runId])).state,
			'draining',
		);
	});
}
