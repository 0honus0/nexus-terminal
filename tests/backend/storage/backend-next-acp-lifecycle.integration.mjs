import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough, Writable } from 'node:stream';
import { NdjsonAcpAdapter } from '../../../packages/backend/dist/platform/acp/adapters/ndjson-acp.js';
import { AcpFailure } from '../../../packages/backend/dist/platform/acp/acp-port.js';
import { MachineAcpModel } from '../../../packages/backend/dist/modules/remote/machines/model/acp-model.js';
import { RemoteResourceCleanupFailure } from '../../../packages/backend/dist/modules/remote/resource-errors.js';

function gate() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function contains(error, expected) {
	return (
		error === expected ||
		(error instanceof AggregateError && error.errors.some((value) => contains(value, expected))) ||
		(error instanceof Error && error.cause !== undefined && contains(error.cause, expected))
	);
}

function fixture(t, mode) {
	const readable = new PassThrough();
	const entered = gate();
	const permission = gate();
	const controller = new AbortController();
	const unsubscribeError = new Error('controlled ACP unsubscribe failure');
	const cancelError = new Error('controlled ACP cancel failure');
	const state = { writes: [], cancelled: 0, unsubscribed: 0, delivered: 0, permissionFinished: false };
	const writable = new Writable({
		write(bytes, _encoding, done) {
			const message = JSON.parse(bytes.toString());
			state.writes.push(message);
			if (message.method === 'initialize') {
				readable.write(
					JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } }) + '\n',
				);
			} else if (message.method === 'session/new') {
				readable.write(
					JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'controlled-session' } }) +
						'\n',
				);
			} else if (message.method === 'session/prompt') {
				readable.write(
					JSON.stringify({
						jsonrpc: '2.0',
						id: 'permission:1',
						method: 'session/request_permission',
						params: {
							sessionId: 'controlled-session',
							toolCall: { toolCallId: 'tool-call', rawInput: { path: '/example' } },
							options: [
								{ optionId: 'allow', kind: 'allow_once' },
								{ optionId: 'reject', kind: 'reject_once' },
							],
						},
					}) + '\n',
				);
			}
			done();
		},
	});
	const channel = {
		readable,
		writable,

		onStderr: () => () => {
			state.unsubscribed += 1;
			if (mode === 'unsubscribe' || mode === 'both') {
				throw unsubscribeError;
			}
		},

		cancel() {
			state.cancelled += 1;
			if (mode === 'cancel' || mode === 'both') {
				throw cancelError;
			}
		},
	};
	const input = {
		cwd: '/',
		prompt: 'controlled ACP request',
		maxOutputBytes: 2048,
		clientName: 'B10',
		clientVersion: '1',
	};
	const callbacks = {
		signal: controller.signal,

		async permission() {
			entered.resolve();
			await permission.promise;
			state.permissionFinished = true;
			return {
				decision: 'allow_once',

				delivered: async () => {
					state.delivered += 1;
				},
			};
		},
	};
	t.after(() => {
		permission.resolve();
		readable.destroy();
		writable.destroy();
	});
	return {
		readable,
		entered,
		permission,
		controller,
		channel,
		input,
		callbacks,
		state,
		unsubscribeError,
		cancelError,
	};
}

await test('ACP cancellation waits for readers and permission work despite independent cleanup failures', async (t) => {
	for (const mode of ['normal', 'unsubscribe', 'cancel', 'both']) {
		await t.test(mode, async (t) => {
			const f = fixture(t, mode);
			let settled = false;
			const result = new NdjsonAcpAdapter().execute(f.channel, f.input, f.callbacks).then(
				(value) => {
					settled = true;
					return { value };
				},
				(error) => {
					settled = true;
					return { error };
				},
			);
			await f.entered.promise;
			f.controller.abort();
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(settled, false, 'cancellation is not evidence of reader or permission cleanup');
			assert.equal(f.state.cancelled, 1);
			f.permission.resolve();
			await new Promise((resolve) => setImmediate(resolve));
			assert.equal(f.state.permissionFinished, true);
			assert.equal(settled, false, 'the still-open reader remains owned');
			f.readable.end();
			const outcome = await result;
			assert.ok(outcome.error instanceof AcpFailure);
			assert.equal(outcome.error.code, mode === 'normal' ? 'transport_closed' : 'cleanup_failed');
			assert.equal(f.state.unsubscribed, 1);
			assert.equal(f.state.cancelled, 1);
			assert.equal(f.state.delivered, 0);
			assert.equal(f.state.writes.filter((message) => message.id === 'permission:1').length, 0);
			if (mode === 'unsubscribe' || mode === 'both') {
				assert.ok(contains(outcome.error, f.unsubscribeError));
			}
			if (mode === 'cancel' || mode === 'both') {
				assert.ok(contains(outcome.error, f.cancelError));
			}
			if (mode !== 'normal') {
				assert.ok(
					outcome.error.cause.errors.some(
						(error) => error instanceof AcpFailure && error.code === 'transport_closed',
					),
				);
			}
		});
	}

	await t.test(
		'the original Machine Model retains ACP and machine-close failures across its application conversion',
		async (t) => {
			const f = fixture(t, 'both');
			const machineError = new Error('controlled machine close failure');
			let closed = 0;
			const model = new MachineAcpModel(
				{
					open: async () => ({
						machine: {
							close: async () => {
								closed += 1;
								throw machineError;
							},
						},
					}),
				},
				{ open: async () => f.channel },
				new NdjsonAcpAdapter(),
			);
			const result = model
				.execute(
					{
						targetId: 1,
						fingerprint: 'f'.repeat(64),
						timeoutMs: 30000,
						signal: f.controller.signal,

						validate: async () => undefined,
					},
					{ cwd: '/', argv: ['fixture-acp'], prompt: 'controlled ACP', permission: f.callbacks.permission },
					2048,
					{ name: 'B10', version: '1' },
				)
				.then(
					(value) => ({ value }),
					(error) => ({ error }),
				);
			await f.entered.promise;
			f.controller.abort();
			f.permission.resolve();
			f.readable.end();
			const outcome = await result;
			assert.ok(outcome.error instanceof RemoteResourceCleanupFailure);
			for (const error of [f.unsubscribeError, f.cancelError, machineError]) {
				assert.ok(contains(outcome.error, error));
			}
			assert.equal(closed, 1);
			assert.equal(f.state.delivered, 0);
		},
	);

	await t.test('cancellation does not finish while an actual writer callback is still pending', async (t) => {
		const entered = gate();
		const readable = new PassThrough();
		const controller = new AbortController();
		let completeWrite;
		let cancelled = 0;
		let unsubscribed = 0;
		let settled = false;
		const writable = new Writable({
			write(_bytes, _encoding, done) {
				completeWrite = done;
				entered.resolve();
			},
		});
		t.after(() => {
			completeWrite?.();
			readable.destroy();
			writable.destroy();
		});
		const result = new NdjsonAcpAdapter()
			.execute(
				{
					readable,
					writable,

					onStderr: () => () => {
						unsubscribed += 1;
					},

					cancel: () => {
						cancelled += 1;
					},
				},
				{ cwd: '/', prompt: 'writer waiting', maxOutputBytes: 1024, clientName: 'B10', clientVersion: '1' },
				{
					signal: controller.signal,

					permission: async () => {
						assert.fail('initialize is not a permission request');
					},
				},
			)
			.then(
				(value) => ({ value }),
				(error) => ({ error }),
			)
			.then((outcome) => {
				settled = true;
				return outcome;
			});
		await entered.promise;
		controller.abort();
		readable.end();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(cancelled, 1);
		assert.equal(settled, false, 'reader end cannot release the still-active writer');
		const writeFailure = new Error('controlled write completion failure after cancellation');
		// The stream owns its late write error even though the canceled request cannot publish success.
		writable.on('error', () => undefined);
		completeWrite(writeFailure);
		completeWrite = undefined;
		const outcome = await result;
		assert.ok(outcome.error instanceof AcpFailure);
		assert.equal(cancelled, 1);
		assert.equal(unsubscribed, 1);
		assert.ok(contains(outcome.error, writeFailure));
	});
});
