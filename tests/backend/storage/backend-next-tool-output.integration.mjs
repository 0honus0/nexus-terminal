import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunChanges } from '../../../packages/backend/dist/modules/agent/runs/model/run-changes.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, open, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeTextLogStore } from '../../../packages/backend/dist/platform/blobs/adapters/native-text-log-store.js';
import { TextLogFailure } from '../../../packages/backend/dist/platform/blobs/text-log-store.js';

const signal = () => new AbortController().signal;

await test('Tool output: complete indexed UTF-8 reads survive reopening and protect active logs', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-tool-output-'));
	const store = await NativeTextLogStore.open(directory);
	const id = randomUUID();
	const writer = await store.create(id);
	const first = 'first中🙂\t\u0000\n\ufeff'.repeat(10000);
	const last = 'stderr尾🙂'.repeat(1000);
	await writer.append({ tag: 0, text: first }, signal(), () => {});
	await writer.append({ tag: 3, text: last }, signal(), () => {});
	await store.remove(id);
	assert.equal((await stat(join(directory, id + '.log'))).mode & 0o777, 0o600);
	await writer.close();
	const reopened = await NativeTextLogStore.open(directory);
	let offset = 0;
	const restored = new Map();
	for (;;) {
		const page = await reopened.read(id, offset, 1031);
		for (const record of page.records) restored.set(record.tag, (restored.get(record.tag) ?? '') + record.text);
		assert.ok(page.nextOffset > offset);
		offset = page.nextOffset;
		if (offset === page.totalBytes) break;
	}
	assert.equal(restored.get(0), first);
	assert.equal(restored.get(3), last);
	await assert.rejects(
		reopened.read(id, 6, 100),
		(e) => e instanceof TextLogFailure && e.reason === 'invalid_offset',
	);
	assert.deepEqual(await Array.fromAsync(reopened.keys()), [id]);
	await reopened.remove(id);
	await assert.rejects(reopened.read(id, 0, 100), (e) => e.reason === 'not_found');
});

await test('Tool output: partial writes and full disk wait without replay, then resume exactly', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-tool-output-space-'));
	const store = await NativeTextLogStore.open(directory);
	const probe = await open(join(directory, 'probe'), 'w');
	const prototype = Object.getPrototypeOf(probe);
	const original = prototype.write;
	await probe.close();
	const id = randomUUID();
	const writer = await store.create(id);
	await writer.append({ tag: 0, text: 'saved-prefix' }, signal(), () => {});
	let full = true,
		partial = true;
	const blocked = Promise.withResolvers();
	t.mock.method(prototype, 'write', async function (bytes, offset, length, position) {
		if (partial) {
			partial = false;
			return original.call(this, bytes, offset, Math.min(3, length), position);
		}
		if (full) throw Object.assign(new Error('controlled full disk'), { code: 'ENOSPC' });
		return original.call(this, bytes, offset, length, position);
	});
	let done = false;
	const text = '完整🙂'.repeat(10000);
	const append = writer
		.append({ tag: 1, text }, signal(), (waiting) => {
			if (waiting) blocked.resolve();
		})
		.then(() => {
			done = true;
		});
	await blocked.promise;
	assert.equal(done, false);
	assert.equal((await store.read(id, 0, 4096)).records[0].text, 'saved-prefix');
	full = false;
	await append;
	await writer.close();
	assert.equal(await readFile(join(directory, id + '.log'), 'utf8'), 'saved-prefix' + text);
});

await test('Tool output: cancellation interrupts disk-space wait and preserves committed prefix', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-tool-output-cancel-'));
	const store = await NativeTextLogStore.open(directory);
	const id = randomUUID();
	const writer = await store.create(id);
	await writer.append({ tag: 0, text: 'keep🙂' }, signal(), () => {});
	const probe = await open(join(directory, 'probe'), 'w');
	const prototype = Object.getPrototypeOf(probe);
	await probe.close();
	t.mock.method(prototype, 'write', async () => {
		throw Object.assign(new Error('quota'), { code: 'EDQUOT' });
	});
	const blocked = Promise.withResolvers();
	const abort = new AbortController();
	const pending = writer.append({ tag: 0, text: 'pending' }, abort.signal, (waiting) => {
		if (waiting) blocked.resolve();
	});
	const rejection = assert.rejects(pending, (e) => e instanceof TextLogFailure);
	await blocked.promise;
	abort.abort();
	await rejection;
	await writer.close();
	assert.equal((await store.read(id, 0, 100)).records[0].text, 'keep🙂');
});

await test('Tool output: unknown execution keeps readable evidence without relaxing ownership or the execution fence', async () => {
	const { ToolJobModel } = await import('../../../packages/backend/dist/modules/agent/tools/model/tool-job-model.js');
	const { ToolJobService } =
		await import('../../../packages/backend/dist/modules/agent/tools/service/tool-job-service.js');
	const { ToolExecutionUnknown, AgentFailure } =
		await import('../../../packages/backend/dist/modules/agent/agent-failure.js');
	const directory = await mkdtemp(join(tmpdir(), 'nexus-tool-output-owner-'));
	const store = await NativeTextLogStore.open(directory);
	const scope = { userId: 1, appId: randomUUID(), runId: randomUUID() };
	const target = { id: 1, version: 2, fingerprint: 'a'.repeat(64) };
	const job = {
		...scope,
		id: randomUUID(),
		connectionId: 1,
		targetVersion: 2,
		fingerprint: target.fingerprint,
		policyRevision: 1,
		state: 'unknown',
		revision: 3,
		result: null,
		createdAt: 1,
		updatedAt: 2,
	};
	let exists = true;
	const model = new ToolJobModel(
		{
			get: async (input, id) =>
				exists &&
				input.userId === scope.userId &&
				input.appId === scope.appId &&
				input.runId === scope.runId &&
				id === job.id
					? job
					: null,

			exists: async () => exists,
		},
		store,
	);
	const writer = await model.openOutput(job.id);
	await writer.append({ commandIndex: 1, stream: 'stderr', text: '\ufeffsaved evidence🙂' }, signal(), () => {});
	await writer.close();
	const service = new ToolJobService(model, new RunChanges());
	const input = { action: 'output', jobIds: [job.id], offset: 0 };
	const page = (await service.control(scope, target, input, signal(), async () => {}, 1000)).jobs[0];
	assert.equal(page.state, 'unknown');
	assert.equal(page.available, true);
	assert.deepEqual(page.output, [{ commandIndex: 1, stream: 'stderr', text: '\ufeffsaved evidence🙂' }]);
	await assert.rejects(
		service.control(scope, target, { ...input, action: 'status' }, signal(), async () => {}, 1000),
		ToolExecutionUnknown,
	);
	await assert.rejects(
		service.control({ ...scope, userId: 2 }, target, input, signal(), async () => {}, 1000),
		(e) => e instanceof AgentFailure && e.code === 'not_found',
	);
	await assert.rejects(
		service.control(scope, { ...target, version: 3 }, input, signal(), async () => {}, 1000),
		(e) => e instanceof AgentFailure && e.code === 'version_conflict',
	);
	await assert.rejects(
		service.control(
			scope,
			target,
			input,
			signal(),
			async () => {
				throw new AgentFailure('forbidden');
			},
			1000,
		),
		(e) => e.code === 'forbidden',
	);
	await service.collectOutput();
	assert.equal((await store.read(job.id, 0, 100)).totalBytes, Buffer.byteLength('\ufeffsaved evidence🙂'));
	exists = false;
	await service.collectOutput();
	await assert.rejects(store.read(job.id, 0, 100), (e) => e.reason === 'not_found');
});

await test('Tool output: Job exposes space waiting, resumes the original work and closes its writer', async (t) => {
	const { ToolJobModel } = await import('../../../packages/backend/dist/modules/agent/tools/model/tool-job-model.js');
	const { ToolJobService } =
		await import('../../../packages/backend/dist/modules/agent/tools/service/tool-job-service.js');
	const directory = await mkdtemp(join(tmpdir(), 'nexus-tool-output-state-'));
	const store = await NativeTextLogStore.open(directory);
	const scope = { userId: 1, appId: randomUUID(), runId: randomUUID() };
	const target = { id: 1, version: 1, fingerprint: 'b'.repeat(64) };
	let job = {
		...scope,
		id: randomUUID(),
		connectionId: 1,
		targetVersion: 1,
		fingerprint: target.fingerprint,
		policyRevision: 1,
		state: 'queued',
		revision: 1,
		result: null,
		createdAt: 1,
		updatedAt: 1,
	};
	const model = new ToolJobModel(
		{
			create: async () => job,

			get: async () => job,

			change: async (input) => {
				job = { ...job, state: input.state, result: input.result, revision: job.revision + 1 };
				return job;
			},
		},
		store,
	);
	const waiting = Promise.withResolvers();
	const failures = [];
	const service = new ToolJobService(model, new RunChanges(), undefined, () => {
		if (service.waitingOutputCount(scope)) waiting.resolve();
	});
	const probe = await open(join(directory, 'probe'), 'w');
	const prototype = Object.getPrototypeOf(probe);
	const original = prototype.write;
	await probe.close();
	let full = true,
		calls = 0;
	t.mock.method(prototype, 'write', async function (...args) {
		if (full) throw Object.assign(new Error('space'), { code: 'ENOSPC' });
		return original.apply(this, args);
	});
	await service.prepare({
		operation: { ...scope, id: job.id },
		target,
		policyRevision: 1,
		signal: signal(),
		background: true,
		deadlineAt: Date.now() + 10000,
		maxHistory: 10,

		validate: async () => {},

		onFailure: (error) => failures.push(error),

		work: async (signal, _timeout, output) => {
			calls++;
			await output(0, 'stdout', 'retained', signal);
			return {
				status: 'completed',
				commands: [
					{
						index: 0,
						status: 'completed',
						exitCode: 0,
						signal: null,
						stdout: 'retained',
						stderr: '',
						truncated: false,
					},
				],
			};
		},
	});
	service.launch(job.id);
	await waiting.promise;
	assert.equal(service.waitingOutputCount(scope), 1);
	const status = await service.control(
		scope,
		target,
		{ action: 'status', jobIds: [job.id] },
		signal(),
		async () => {},
		1000,
	);
	assert.equal(status.jobs[0].waitingForSpace, true);
	full = false;
	const result = await service.foreground(scope, target, job.id, 5000, signal(), async () => {});
	assert.equal(result.result.status, 'completed');
	assert.equal(result.jobId, job.id);
	assert.equal(service.waitingOutputCount(scope), 0);
	assert.equal(calls, 1);
	assert.deepEqual(failures, []);
	await service.drain(scope);
	assert.equal((await store.read(job.id, 0, 100)).records[0].text, 'retained');
});

await test('Tool output: delayed allocation errors during flush wait for space before completion', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-tool-output-flush-'));
	const store = await NativeTextLogStore.open(directory);
	const id = randomUUID();
	const writer = await store.create(id);
	await writer.append({ tag: 0, text: 'flush🙂' }, signal(), () => {});
	const probe = await open(join(directory, 'probe'), 'w');
	const prototype = Object.getPrototypeOf(probe),
		original = prototype.sync;
	await probe.close();
	let full = true,
		done = false;
	const blocked = Promise.withResolvers();
	t.mock.method(prototype, 'sync', async function () {
		if (full) throw Object.assign(new Error('delayed allocation'), { code: 'ENOSPC' });
		return original.call(this);
	});
	const pending = writer
		.flush(signal(), (waiting) => {
			if (waiting) blocked.resolve();
		})
		.then(() => {
			done = true;
		});
	await blocked.promise;
	assert.equal(done, false);
	full = false;
	await pending;
	await writer.close();
	const reading = store.read(id, 0, 100);
	await store.remove(id);
	assert.equal((await reading).records[0].text, 'flush🙂');
	assert.ok(await stat(join(directory, id + '.log')));
	await store.remove(id);
});

await test('Tool output: cancelled Job stays active until its log writer actually closes', async (t) => {
	const { ToolJobService } =
		await import('../../../packages/backend/dist/modules/agent/tools/service/tool-job-service.js');
	const { ToolExecutionUnknown } = await import('../../../packages/backend/dist/modules/agent/agent-failure.js');
	const scope = { userId: 1, appId: randomUUID(), runId: randomUUID() };
	const target = { id: 1, version: 1, fingerprint: 'a'.repeat(64) };
	const job = {
		...scope,
		id: randomUUID(),
		connectionId: 1,
		targetVersion: 1,
		fingerprint: target.fingerprint,
		state: 'queued',
		revision: 1,
		result: null,
	};
	const closing = Promise.withResolvers(),
		release = Promise.withResolvers();
	t.after(() => release.resolve());
	const failures = [];
	const service = new ToolJobService(
		{
			create: async () => job,

			change: async (previous, state, result) => ({
				...previous,
				state,
				result,
				revision: previous.revision + 1,
			}),

			openOutput: async () => ({
				append: async () => {},

				flush: async () => {},

				close: async () => {
					closing.resolve();
					await release.promise;
				},
			}),
		},
		new RunChanges(),
	);
	await service.prepare({
		operation: { ...scope, id: job.id },
		target,
		policyRevision: 1,
		signal: signal(),
		background: true,
		deadlineAt: Date.now() + 10000,
		maxHistory: 10,

		validate: async () => {},

		onFailure: (error) => failures.push(error),

		work: async () => {
			throw new ToolExecutionUnknown();
		},
	});
	service.launch(job.id);
	await closing.promise;
	assert.equal(service.backgroundCount(scope), 1);
	assert.deepEqual(failures, []);
	const drained = assert.rejects(service.drain(scope), ToolExecutionUnknown);
	release.resolve();
	await drained;
	assert.equal(service.backgroundCount(scope), 0);
	assert.equal(failures.length, 1);
});
