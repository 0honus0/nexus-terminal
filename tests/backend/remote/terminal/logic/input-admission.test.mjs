import assert from 'node:assert/strict';
import { bindRequestCookies } from '../../../../../packages/backend/src/platform/http/http-request.ts';
import { test, onTestFinished, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createWorkspaceFilesRoute } from '../../../../../packages/backend/src/modules/remote/interfaces/ws/workspace-files.ts';
import {
	WORKSPACE_MAX_IN_FLIGHT_REQUESTS,
	WORKSPACE_TERMINAL_MAX_INPUT_BYTES,
	WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES,
} from '../../../../../packages/shared/src/remote/workspace/values.ts';

async function fixture(bypassAfterFirst = false) {
	vi.useFakeTimers();
	onTestFinished(() => vi.useRealTimers());
	let receive;
	let onClose;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const messages = [];
	const writes = [];
	let checks = 0;
	let detached = 0;
	let allowed = true;

	let writeHook = () => {};

	const noop = () => () => {};

	const workspaces = {
		onAutoTerminated: noop,

		pause() {},

		resumeOutput() {},

		onOutput: noop,
		onClosed: noop,
		onDirectoryEvent: noop,
		onFileState: noop,
		onSuspensionRevoked: noop,
		onSuspensionUnmarked: noop,

		retainedTail: () => ({ bytes: new Uint8Array(), endOffset: 0 }),

		async open(_token, workspaceId) {
			return {
				workspaceId,
				file: null,
				connectionName: 'input fixture',
				resumeToken: 'fixture',
				attachmentGeneration: 1,
				attachmentId: randomUUID(),
				lastConnectedAt: Date.now(),
			};
		},

		async allowed() {
			checks++;
			if (!bypassAfterFirst || checks === 1) await gate;
			return allowed;
		},

		write(workspaceId, attachmentId, text) {
			writes.push({ workspaceId, attachmentId, text });
			writeHook();
		},

		closeAuthorized() {},

		detach() {
			detached++;
		},
	};
	const channel = {
		onMessage(handler) {
			receive = handler;
		},

		onClose(handler) {
			onClose = handler;
		},

		send(text) {
			messages.push(JSON.parse(text));
			return true;
		},

		sendBinary() {
			return true;
		},

		close() {
			throw new Error('Unexpected protocol close');
		},
	};
	const request = { headers: {} };
	bindRequestCookies(request, {});
	createWorkspaceFilesRoute(null, null, workspaces, null).connected(channel, request);
	onTestFinished(async () => {
		release();
		await onClose();
	});
	const workspaceId = randomUUID();
	await receive(
		JSON.stringify({ type: 'workspace.connect', requestId: 'connect', payload: { workspaceId, connectionId: 1 } }),
	);
	await vi.waitUntil(() => messages.some((message) => message.requestId === 'connect'));
	assert.equal(messages.find((message) => message.requestId === 'connect').payload.ok, true);

	const call = async (type, payload) => {
		const requestId = randomUUID();
		await receive(JSON.stringify({ type, requestId, payload }));
		await vi.waitUntil(() => messages.some((message) => message.requestId === requestId));
		const result = messages.find((message) => message.requestId === requestId).payload;
		assert.equal(result.ok, true, JSON.stringify(result));
	};

	const input = (data) => receive(JSON.stringify({ type: 'terminal.input', payload: { data } }));

	return {
		input,
		call,
		workspaceId,
		writes,
		messages,
		release,

		close: () => onClose(),

		revoke() {
			allowed = false;
		},

		onWrite(hook) {
			writeHook = hook;
		},

		get checks() {
			return checks;
		},

		get detached() {
			return detached;
		},
	};
}

test('burst notifications coalesce in order while authorization is pending', async () => {
	const f = await fixture();
	const text = 'x'.repeat(WORKSPACE_MAX_IN_FLIGHT_REQUESTS * 3);
	for (const character of text) await f.input(character);
	assert.equal(f.writes.length, 0);
	assert.equal(f.checks, 1);
	f.release();
	await vi.waitUntil(() => f.writes.map((item) => item.text).join('') === text);
	assert.ok(f.checks <= 2);
	assert.deepEqual(
		f.messages.filter((message) => message.type === 'protocol.error'),
		[],
	);
});

test('active authorization and pending input share the existing wire byte budget and batch bound', async () => {
	const f = await fixture();
	const data = 'a'.repeat(4096);
	const bytes = Buffer.byteLength(JSON.stringify({ type: 'terminal.input', payload: { data } }));
	const admitted = Math.floor(WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES / bytes);
	for (let index = 0; index <= admitted; index++) await f.input(data);
	assert.deepEqual(
		f.messages.filter((message) => message.type === 'protocol.error').map((message) => message.payload.message),
		['limit_exceeded'],
	);
	f.release();
	await vi.waitUntil(() => f.writes.reduce((sum, item) => sum + item.text.length, 0) === admitted * data.length);
	assert.ok(f.writes.every((item) => Buffer.byteLength(item.text) <= WORKSPACE_TERMINAL_MAX_INPUT_BYTES));
	await f.input('after-budget-release');
	await vi.waitUntil(() => f.writes.at(-1)?.text === 'after-budget-release');
});

test('authorization revoked while queued does not dispatch or replay input', async () => {
	const f = await fixture();
	await f.input('first');
	await f.input('queued');
	f.revoke();
	f.release();
	await vi.waitUntil(() => f.messages.filter((message) => message.type === 'protocol.error').length === 2);
	assert.deepEqual(f.writes, []);
	assert.ok(
		f.messages
			.filter((message) => message.type === 'protocol.error')
			.every((message) => message.payload.message === 'not_found'),
	);
});

test('close drains original authorization and discards queued input', async () => {
	const f = await fixture();
	await f.input('first');
	await f.input('queued');
	let closed = false;
	const closing = f.close().then(() => {
		closed = true;
	});
	await vi.advanceTimersByTimeAsync(0);
	assert.equal(closed, false);
	assert.equal(f.detached, 1);
	f.release();
	await closing;
	assert.deepEqual(f.writes, []);
});

test('a message arriving between worker completion and its observer is not stranded', async () => {
	const f = await fixture();
	let late = false;
	f.onWrite(() => {
		if (late) return;
		late = true;
		queueMicrotask(() => {
			void f.input('late');
		});
	});
	await f.input('first');
	f.release();
	await vi.waitUntil(() => f.writes.map((item) => item.text).join('') === 'firstlate');
	assert.deepEqual(
		f.messages.filter((message) => message.type === 'protocol.error'),
		[],
	);
});

test('empty notifications consume envelope bytes and release the same budget', async () => {
	const f = await fixture();
	const bytes = Buffer.byteLength(JSON.stringify({ type: 'terminal.input', payload: { data: '' } }));
	const admitted = Math.floor(WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES / bytes);
	for (let index = 0; index <= admitted; index++) await f.input('');
	assert.deepEqual(
		f.messages.filter((message) => message.type === 'protocol.error').map((message) => message.payload.message),
		['limit_exceeded'],
	);
	f.release();
	await vi.waitUntil(() => f.writes.length === 2);
	assert.ok(f.writes.every((item) => item.text === ''));
	await f.input('after-empty-burst');
	await vi.waitUntil(() => f.writes.at(-1)?.text === 'after-empty-burst');
});

test('multibyte input keeps exact text and the original per-write byte bound', async () => {
	const f = await fixture();
	const data = '终端😀'.repeat(8192);
	for (let index = 0; index < 5; index++) await f.input(data);
	f.release();
	await vi.waitUntil(() => f.writes.map((item) => item.text).join('') === data.repeat(5));
	assert.ok(f.writes.every((item) => Buffer.byteLength(item.text) <= WORKSPACE_TERMINAL_MAX_INPUT_BYTES));
	assert.deepEqual(
		f.messages.filter((message) => message.type === 'protocol.error'),
		[],
	);
});

test('a late authorization cannot route old input into a successor attachment', async () => {
	const f = await fixture(true);
	await f.input('old-input');
	await f.call('workspace.close', {
		workspaceId: f.workspaceId,
		connectionId: 1,
		resumeToken: 'fixture',
		attachmentGeneration: 1,
	});
	const successor = randomUUID();
	await f.call('workspace.connect', { workspaceId: successor, connectionId: 1 });
	await f.input('new-input');
	f.release();
	await vi.waitUntil(() => f.writes.length === 1);
	assert.equal(f.writes[0].workspaceId, successor);
	assert.equal(f.writes[0].text, 'new-input');
	assert.deepEqual(
		f.messages.filter((message) => message.type === 'protocol.error').map((message) => message.payload.message),
		['not_found'],
	);
});
