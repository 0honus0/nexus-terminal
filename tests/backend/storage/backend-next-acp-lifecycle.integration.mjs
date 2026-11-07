import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { PluginServiceTransportOwner } from '../../../packages/backend/dist/modules/agent/plugins/service/plugin-service-transport.js';
import { MachineCommandDuplex } from '../../../packages/backend/dist/platform/ssh/command-duplex.js';
import { MachineCommandModel } from '../../../packages/backend/dist/modules/remote/machines/model/command-model.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend/dist/modules/remote/resource-errors.js';
import { AgentFailure, ToolCleanupFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';

function contains(error, expected) {
	return (
		error === expected ||
		(error instanceof AggregateError && error.errors.some((value) => contains(value, expected))) ||
		(error instanceof Error && error.cause !== undefined && contains(error.cause, expected))
	);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const mode of ['normal', 'channel', 'permission', 'both']) {
	await test(
		'ACP Host lifecycle: cancellation owns pending reads and late permissions with ' + mode + ' cleanup',
		async (t) => {
			const read = Promise.withResolvers();
			const permission = Promise.withResolvers();
			const entered = Promise.withResolvers();
			const channelClosed = Promise.withResolvers();
			const stop = new AbortController();
			const closeError = new Error('Controlled channel cleanup failure');
			const permissionError = new Error('Controlled permission abandonment failure');
			const state = { closed: 0, released: 0, delivered: 0, abandoned: 0, writes: 0 };
			const channel = {
				read: () => read.promise,

				write: async () => {
					state.writes++;
				},

				end: async () => {},

				outcome: async () => ({ kind: 'exit', exitCode: 0 }),

				cancel() {},

				async close() {
					state.closed++;
					await channelClosed.promise;
					if (mode === 'channel' || mode === 'both') throw closeError;
				},
			};
			const owner = new PluginServiceTransportOwner({
				signal: stop.signal,

				validate: async () => {},

				transport: {
					kind: 'remoteProcess',
					cwd: '/',

					async run(_signal, consume) {
						await consume(channel);
						state.released++;
					},

					async permission() {
						entered.resolve();
						await permission.promise;
						return {
							decision: 'allow_once',

							delivered: async () => {
								state.delivered++;
							},

							async abandon(_cause, dispatched) {
								assert.equal(dispatched, false);
								state.abandoned++;
								if (mode === 'permission' || mode === 'both') throw permissionError;
							},
						};
					},
				},
			});
			t.after(async () => {
				permission.resolve();
				channelClosed.resolve();
				read.resolve({ bytes: new Uint8Array(), eof: true });
				await owner.close().catch(() => undefined);
			});
			const { channelId } = (
				await owner.dispatch({ method: 'transport.stdio.open', params: { grant: owner.facts.grant } })
			).value;
			const reading = owner.dispatch({ method: 'transport.stdio.read', params: { channelId, stream: 'stdout' } });
			const approving = owner
				.dispatch({
					method: 'transport.permission.request',
					params: {
						channelId,
						sessionId: 'original-session',
						toolCallId: 'original-tool',
						requestId: 'original-request',
						title: 'Read',
						kind: 'read',
						inputJson: '{}',
					},
				})
				.then(
					(value) => ({ value }),
					(error) => ({ error }),
				);
			await entered.promise;
			stop.abort();
			let settled = false;
			const closing = owner
				.close()
				.then(
					() => ({ ok: true }),
					(error) => ({ error }),
				)
				.finally(() => {
					settled = true;
				});
			await tick();
			permission.resolve();
			assert.ok((await approving).error instanceof AgentFailure);
			await tick();
			assert.equal(settled, false, 'A late permission response does not release an open channel');
			channelClosed.resolve();
			await tick();
			assert.equal(settled, false, 'Closing the channel still waits for the original read');
			read.resolve({ bytes: Buffer.from('late bytes'), eof: false });
			assert.equal((await reading).value.bytesBase64, '', 'Cancelled read never publishes late bytes');
			const result = await closing;
			if (mode === 'normal') assert.equal(result.ok, true);
			else {
				assert.ok(result.error instanceof ToolCleanupFailure);
				if (mode === 'channel' || mode === 'both') assert.ok(contains(result.error, closeError));
				if (mode === 'permission' || mode === 'both') assert.ok(contains(result.error, permissionError));
			}
			assert.deepEqual(state, { closed: 1, released: 1, delivered: 0, abandoned: 1, writes: 0 });
			await assert.rejects(
				owner.dispatch({ method: 'transport.stdio.open', params: { grant: owner.facts.grant } }),
				AgentFailure,
			);
		},
	);
}

await test('ACP byte channel lifecycle: close waits for the actual pending writer despite synchronous close failure', async (t) => {
	const readable = new PassThrough();
	const stderrReadable = new PassThrough();
	const entered = Promise.withResolvers();
	const stop = new AbortController();
	const closed = new Set();
	const closeError = new Error('Controlled synchronous channel close failure');
	const writeError = new Error('Controlled late writer callback failure');
	let completeWrite;
	let cancelled = 0;
	const writable = new Writable({
		write(_bytes, _encoding, done) {
			completeWrite = done;
			entered.resolve();
		},
	});
	writable.on('error', () => {});
	const io = new MachineCommandDuplex(
		{
			readable,
			stderrReadable,
			writable,
			outcome: Promise.resolve({ status: 'unknown', reason: 'cancelled' }),

			onClose(listener) {
				closed.add(listener);
				return () => closed.delete(listener);
			},

			cancel() {
				cancelled++;
			},

			close() {
				throw closeError;
			},
		},
		stop.signal,
		2048,
	);
	t.after(async () => {
		completeWrite?.();
		readable.end();
		stderrReadable.end();
		for (const listener of closed) listener();
		await io.close().catch(() => undefined);
		writable.destroy();
	});
	const writing = assert.rejects(io.write(Buffer.from('pending')), (error) => contains(error, writeError));
	await entered.promise;
	stop.abort();
	let settled = false;
	const closing = io
		.close()
		.then(
			() => ({ ok: true }),
			(error) => ({ error }),
		)
		.finally(() => {
			settled = true;
		});
	await tick();
	assert.equal(settled, false, 'A synchronous close failure cannot release the still-active writer');
	readable.end();
	stderrReadable.end();
	for (const listener of closed) listener();
	await tick();
	assert.equal(settled, false, 'Channel close confirmation cannot release the pending write callback');
	completeWrite(writeError);
	completeWrite = undefined;
	await writing;
	assert.ok(contains((await closing).error, closeError));
	assert.equal(cancelled, 1);
});

await test('ACP byte channel lifecycle: Machine Model retains invocation and machine release failures', async () => {
	const primary = new Error('Controlled process consumer failure');
	const releaseError = new Error('Controlled machine release failure');
	const readable = new PassThrough(),
		stderrReadable = new PassThrough(),
		writable = new PassThrough();
	const closed = new Set();
	let released = 0;
	const model = new MachineCommandModel(
		{
			open: async () => ({ machine: { openRawCommand() {} } }),

			async release() {
				released++;
				throw releaseError;
			},
		},
		{
			open: async () => ({
				readable,
				stderrReadable,
				writable,
				outcome: Promise.resolve({ status: 'exit', exitCode: 0 }),

				onClose(listener) {
					closed.add(listener);
					return () => closed.delete(listener);
				},

				cancel() {},

				close() {
					readable.end();
					stderrReadable.end();
					for (const listener of closed) listener();
				},
			}),
		},
	);
	await assert.rejects(
		model.withProcess(
			{
				operationId: randomUUID(),
				targetId: 1,
				fingerprint: 'f'.repeat(64),
				timeoutMs: 30000,
				signal: new AbortController().signal,

				validate: async () => {},
			},
			{ argv: ['fixture-acp'], cwd: '/', maxReadBytes: 2048 },
			async () => {
				throw primary;
			},
		),
		(error) =>
			error instanceof RemoteResourceCleanupFailure && contains(error, primary) && contains(error, releaseError),
	);
	assert.equal(released, 1);
	writable.destroy();
});
