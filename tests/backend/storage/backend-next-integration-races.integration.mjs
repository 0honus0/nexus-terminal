import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { IntegrationService } from '../../../packages/backend/dist/modules/agent/integrations/service/integration-service.js';
import { IntegrationModel } from '../../../packages/backend/dist/modules/agent/integrations/model/integration-model.js';
import { SqliteIntegrationStorage } from '../../../packages/backend/dist/modules/agent/integrations/adapters/sqlite/integration-sql.js';
import { initializeAgentIntegrations } from '../../../packages/backend/dist/modules/agent/integrations/adapters/sqlite/integration-schema.js';
import { ToolService } from '../../../packages/backend/dist/modules/agent/tools/service/tool-service.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
} from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';
import { McpFailure } from '../../../packages/backend/dist/platform/mcp/mcp-client.js';

function gate() {
	let resolve;
	const promise = new Promise((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

const actor = { userId: 1, appId: randomUUID(), runId: randomUUID() };

function input(id = randomUUID(), resume = null) {
	return { id, version: 1, schemaHash: 'a'.repeat(64), kind: 'tool', name: 'echo', argumentsJson: '{}', resume };
}

const waiting = { kind: 'input_required', requestState: 'private-remote-state', inputRequestsJson: '{}' };
const completed = { kind: 'complete', resultJson: '{}' };

async function capacityFixture(t) {
	const calls = [];

	let work = async () => waiting;

	const service = new IntegrationService({
		async invoke(owner, command, signal) {
			calls.push({ owner, command });
			return work(command, signal);
		},

		async close() {},
	});
	t.after(() => service.close());
	return {
		service,
		calls,

		setWork(value) {
			work = value;
		},
	};
}

function invoke(f, command, signal = new AbortController().signal) {
	return f.service.invoke(actor, command, signal, async () => undefined).then(JSON.parse);
}

await test('Continuation admission reserves the final slot across distinct integrations before dispatch', async (t) => {
	const release = gate();
	t.after(() => release.resolve());
	const f = await capacityFixture(t);
	for (let index = 0; index < 127; index += 1) {
		const command = input();
		await invoke(f, command);
	}
	const entered = gate();
	f.setWork(async () => {
		entered.resolve();
		await release.promise;
		return waiting;
	});
	const last = input();
	const final = invoke(f, last);
	await entered.promise;
	assert.equal(f.calls.length, 128);
	await assert.rejects(invoke(f, input()), { code: 'limit_exceeded' });
	assert.equal(f.calls.length, 128, 'overflow must not reach the model');
	release.resolve();
	const state = await final;
	assert.notEqual(state.requestState, waiting.requestState);
	await assert.rejects(invoke(f, input()), { code: 'limit_exceeded' });
	f.setWork(async () => completed);
	assert.equal(
		(await invoke(f, input(last.id, { requestState: state.requestState, inputResponsesJson: '{}' }))).kind,
		'complete',
	);
	assert.equal(f.calls.at(-1).command.resume.requestState, waiting.requestState);
	await assert.rejects(invoke(f, input(last.id, { requestState: state.requestState, inputResponsesJson: '{}' })), {
		code: 'version_conflict',
	});
	f.setWork(async () => waiting);
	await invoke(f, input());
	await assert.rejects(invoke(f, input()), { code: 'limit_exceeded' });
	f.service.drainRun(actor);
	for (let index = 0; index < 128; index += 1) {
		await invoke(f, input());
	}
	await assert.rejects(invoke(f, input()), { code: 'limit_exceeded' });
});

await test('Continuation reservation is released after complete, rejection and post-dispatch cancellation', async (t) => {
	const release = gate();
	t.after(() => release.resolve());
	const f = await capacityFixture(t);
	for (let index = 0; index < 127; index += 1) {
		await invoke(f, input());
	}
	f.setWork(async () => completed);
	await invoke(f, input());
	const refusal = new AgentFailure('version_conflict');
	f.setWork(async () => {
		throw refusal;
	});
	await assert.rejects(invoke(f, input()), (error) => error === refusal);
	const entered = gate();
	f.setWork(async () => {
		entered.resolve();
		await release.promise;
		return waiting;
	});
	const controller = new AbortController();
	const canceled = invoke(f, input(), controller.signal);
	const rejected = assert.rejects(
		canceled,
		(error) => error instanceof ToolExecutionUnknown && !(error instanceof ToolCleanupFailure),
	);
	await entered.promise;
	controller.abort();
	await assert.rejects(invoke(f, input()), { code: 'limit_exceeded' });
	release.resolve();
	await rejected;
	f.setWork(async () => waiting);
	await invoke(f, input());
	await assert.rejects(invoke(f, input()), { code: 'limit_exceeded' });
});

async function modelFixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-integration-races-'));
	const db = SqliteRuntime.open(join(directory, 'state.db'));
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	// Focused adapter fixture: identity is controlled; real transaction ordering and integration SQL are unchanged.
	await db.exec('CREATE TABLE agent_apps(id TEXT,user_id INTEGER,enabled INTEGER,UNIQUE(id,user_id))');
	await db.run('INSERT INTO agent_apps VALUES(?,?,1)', [actor.appId, actor.userId]);
	await initializeAgentIntegrations(db);
	const storage = new SqliteIntegrationStorage(db);
	storage.installTransactionIdentityReader(async () => actor.userId);
	const catalog = {
		serverName: 'B10',
		serverVersion: '1',
		protocolVersion: '2026-07-28',
		tools: [{ name: 'echo', description: '', inputSchemaJson: '{}' }],
		resources: [],
		prompts: [],
	};
	const mcp = {
		async discover() {
			return catalog;
		},

		async invoke() {
			return completed;
		},

		async close() {},

		async closeAll() {},
	};
	const model = new IntegrationModel(storage, null, { digest: () => 'controlled-session-digest' }, mcp, {
		name: 'B10',
		version: '1',
	});
	const record = await model.create(
		{ ...actor, token: 'controlled-session' },
		randomUUID(),
		randomUUID(),
		{
			configuration: {
				kind: 'mcp',
				displayName: 'B10',
				endpoint: 'https://example.com/mcp',
				privateHostExceptions: [],
				protocolVersion: '2026-07-28',
			},
			enabled: true,
			credential: { action: 'clear' },
		},
		() => undefined,
		() => undefined,
	);
	return { db, storage, mcp, model, record };
}

await test('A canceled discovery cannot publish its catalog after waiting for a real SQLite transaction', async (t) => {
	const network = gate();
	const discovered = gate();
	const locked = gate();
	const release = gate();
	t.after(() => {
		network.resolve();
		release.resolve();
	});
	const f = await modelFixture(t);
	t.mock.method(f.mcp, 'discover', async () => {
		discovered.resolve();
		await network.promise;
		return {
			serverName: 'new catalog',
			serverVersion: '2',
			protocolVersion: '2026-07-28',
			tools: [],
			resources: [],
			prompts: [],
		};
	});
	const queued = gate();
	const original = f.storage.discover.bind(f.storage);
	t.mock.method(f.storage, 'discover', (...args) => {
		const task = original(...args);
		queued.resolve();
		return task;
	});
	const controller = new AbortController();
	const refresh = f.model.discover(
		{ ...actor, token: 'controlled-session' },
		f.record.id,
		1,
		controller.signal,
		() => undefined,
	);
	const rejected = assert.rejects(refresh, { code: 'provider_unavailable' });
	await discovered.promise;
	const blocker = f.db.transaction(async () => {
		locked.resolve();
		await release.promise;
	});
	await locked.promise;
	network.resolve();
	await queued.promise;
	controller.abort();
	release.resolve();
	await blocker;
	await rejected;
	const current = await f.storage.get(actor, f.record.id);
	assert.equal(current.version, 1);
	assert.equal(current.schemaHash, null);
	assert.equal(
		(
			await f.model.discover(
				{ ...actor, token: 'controlled-session' },
				f.record.id,
				1,
				new AbortController().signal,
				() => undefined,
			)
		).integration.version,
		2,
	);
});

await test('MCP post-dispatch failures keep storage, cleanup and execution uncertainty distinct', async (t) => {
	for (const [failure, code] of [
		[new SqliteFailure('commit_unknown'), 'operation_unknown'],
		[new SqliteFailure('worker_exit'), 'storage_unavailable'],
		[new Error('controlled storage decode failure'), 'internal_failure'],
	]) {
		await t.test(code, async (t) => {
			const f = await modelFixture(t);
			let dispatched = 0;
			t.mock.method(f.mcp, 'invoke', async () => {
				dispatched += 1;
				return completed;
			});
			const get = f.storage.get.bind(f.storage);
			t.mock.method(f.storage, 'get', (...args) => {
				if (dispatched) {
					throw failure;
				}
				return get(...args);
			});
			await assert.rejects(
				f.model.invoke(
					actor,
					input(f.record.id),
					new AbortController().signal,
					async () => undefined,
					() => undefined,
				),
				(error) =>
					error instanceof AgentFailure &&
					!(error instanceof ToolExecutionUnknown) &&
					error.code === code &&
					error.cause === failure,
			);
			assert.equal(dispatched, 1);
		});
	}
	for (const [kind, Type] of [
		['cleanup_failed', ToolCleanupFailure],
		['unavailable', ToolExecutionUnknown],
	]) {
		await t.test(kind, async (t) => {
			const f = await modelFixture(t);
			const failure = new McpFailure(kind);
			let dispatched = 0;
			t.mock.method(f.mcp, 'invoke', async () => {
				dispatched += 1;
				throw failure;
			});
			await assert.rejects(
				f.model.invoke(
					actor,
					input(f.record.id),
					new AbortController().signal,
					async () => undefined,
					() => undefined,
				),
				(error) => error instanceof Type && error.cause === failure,
			);
			assert.equal(dispatched, 1);
		});
	}
});

await test('An integration synchronous drain failure does not skip independent Job and Browser drainage', async () => {
	const job = gate();
	const browser = gate();
	const integrationFailure = new Error('controlled integration synchronous drain failure');
	const jobFailure = new AgentFailure('storage_unavailable');
	const browserFailure = new ToolCleanupFailure();
	const calls = [];
	const service = new ToolService(
		null,
		null,
		null,
		{
			drain() {
				calls.push('job');
				return job.promise;
			},
		},
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		{
			drainRun() {
				calls.push('integration');
				throw integrationFailure;
			},
		},
		{
			drainRun() {
				calls.push('browser');
				return browser.promise;
			},
		},
		null,
	);
	let settled = false;
	const task = service.drainRun(actor).catch((error) => {
		settled = true;
		return error;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(calls, ['integration', 'job', 'browser']);
	assert.equal(settled, false);
	job.resolve(Promise.reject(jobFailure));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false);
	browser.resolve(Promise.reject(browserFailure));
	const error = await task;
	assert.ok(error instanceof AggregateError);
	assert.ok(
		!(error instanceof ToolExecutionUnknown),
		'mixed internal/storage failures cannot become execution-only unknown',
	);
	assert.deepEqual(error.errors, [integrationFailure, jobFailure, browserFailure]);
});

await test('Integration task admission counts queued same-key work and close drains actual late work', async (t) => {
	const release = gate();
	t.after(() => release.resolve());
	const entered = gate();
	let reads = 0;
	let closes = 0;
	let stopped = false;
	const service = new IntegrationService({
		async get() {
			reads += 1;
			entered.resolve();
			await release.promise;
			return { id: 'controlled-return' };
		},

		async close() {
			closes += 1;
		},
	});
	t.after(() => service.close());
	const tasks = Array.from({ length: 16 }, () =>
		service.get(actor, 'same-integration').then(
			(value) => ({ value }),
			(error) => ({ error }),
		),
	);
	await entered.promise;
	await assert.rejects(service.get(actor, 'other-integration'), { code: 'provider_unavailable' });
	assert.equal(reads, 1, 'fifteen same-key tasks remain queued, consuming admission');
	const firstClose = service.close();
	assert.strictEqual(firstClose, service.close());
	void firstClose.then(() => {
		stopped = true;
	});
	await assert.rejects(service.get(actor, 'same-integration'), { code: 'provider_unavailable' });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(stopped, false);
	assert.equal(closes, 0, 'model must not close ahead of an already-dispatched read');
	release.resolve();
	const outcomes = await Promise.all(tasks);
	assert.equal(outcomes.filter((outcome) => outcome.value).length, 1);
	assert.ok(outcomes.slice(1).every((outcome) => outcome.error?.code === 'provider_unavailable'));
	await firstClose;
	assert.equal(reads, 1, 'queued work is not dispatched after quiesce');
	assert.equal(closes, 1);
});
