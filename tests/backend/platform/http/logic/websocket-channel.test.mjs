import assert from 'node:assert/strict';
import { test } from 'vitest';
import { EventEmitter } from 'node:events';
import { createWebSocketChannel } from '../../../../../packages/backend/src/platform/http/websocket-channel.ts';
import { MAX_WEBSOCKET_INPUT_MESSAGES } from '../../../../../packages/backend/src/platform/http/http-limits.ts';

function fixture() {
	const socket = new EventEmitter();
	socket.readyState = 1;
	socket.bufferedAmount = 0;
	let terminated = 0;
	let paused = 0;
	let resumed = 0;
	let accepting = true;
	const tasks = [];
	socket.terminate = () => {
		terminated++;
		socket.readyState = 3;
	};
	socket.pause = () => {
		paused++;
	};
	socket.resume = () => {
		resumed++;
	};
	const channel = createWebSocketChannel(socket, {
		isAccepting: () => accepting,

		maxBinaryMessageBytes: 2 * 1024 * 1024,

		trackTask: (task) => tasks.push(task),

		onClosed() {},
	});
	return {
		channel,
		tasks,

		text: (value) => socket.emit('message', Buffer.from(value), false),

		binary: (value) => socket.emit('message', value, true),

		closing() {
			socket.readyState = 2;
		},

		stop() {
			accepting = false;
		},

		get terminated() {
			return terminated;
		},

		get paused() {
			return paused;
		},

		get resumed() {
			return resumed;
		},
	};
}

function gate() {
	let release;
	const promise = new Promise((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

test('synchronous admission consumes every frame in a burst without artificial queue occupancy', () => {
	const f = fixture();
	const received = [];
	f.channel.onMessage((value) => {
		received.push(value);
	});
	for (let index = 0; index < MAX_WEBSOCKET_INPUT_MESSAGES * 3; index++) f.text(String(index));
	assert.deepEqual(
		received,
		Array.from({ length: MAX_WEBSOCKET_INPUT_MESSAGES * 3 }, (_, index) => String(index)),
	);
	assert.equal(f.terminated, 0);
	assert.equal(f.tasks.length, 0);
});

test('asynchronous handlers still serialize text and binary input and retain the active slot', async () => {
	const f = fixture();
	const pending = gate();
	const received = [];
	f.channel.onMessage(async (value) => {
		received.push(value);
		await pending.promise;
	});
	f.channel.onBinary(async (value) => {
		received.push(Buffer.from(value).toString());
	});
	f.text('first');
	f.binary(Buffer.from('second'));
	f.text('third');
	assert.deepEqual(received, ['first']);
	pending.release();
	for (const task of f.tasks) await task;
	assert.deepEqual(received, ['first', 'second', 'third']);
	assert.equal(f.terminated, 0);
});

test('real asynchronous queue occupancy still enforces the original message budget', async () => {
	const f = fixture();
	const pending = gate();
	let dispatched = 0;
	f.channel.onMessage(async () => {
		dispatched++;
		await pending.promise;
	});
	for (let index = 0; index <= MAX_WEBSOCKET_INPUT_MESSAGES; index++) f.text('queued');
	assert.equal(dispatched, 1);
	assert.equal(f.terminated, 1);
	pending.release();
	for (const task of f.tasks) await task;
	assert.equal(dispatched, 1);
});

test('async rejection closes before any queued message can start', async () => {
	const f = fixture();
	const pending = gate();
	const received = [];
	f.channel.onMessage(async (value) => {
		received.push(value);
		await pending.promise;
		throw new Error('fixture rejection');
	});
	f.text('first');
	f.text('must-not-run');
	pending.release();
	for (const task of f.tasks) await task;
	assert.deepEqual(received, ['first']);
	assert.equal(f.terminated, 1);
});

test('binary high-water pause resumes in CLOSING after the original async work drains', async () => {
	const f = fixture();
	const pending = gate();
	f.channel.onBinary(async () => {
		await pending.promise;
	});
	f.binary(Buffer.alloc(1024 * 1024));
	assert.equal(f.paused, 1);
	assert.equal(f.resumed, 0);
	f.closing();
	pending.release();
	await Promise.all(f.tasks);
	assert.equal(f.resumed, 1);
	assert.equal(f.terminated, 0);
});

test('sync errors and shutdown prevent subsequent dispatch', () => {
	const failed = fixture();
	failed.channel.onMessage(() => {
		throw new Error('sync fixture rejection');
	});
	failed.text('first');
	assert.equal(failed.terminated, 1);
	const stopped = fixture();
	let dispatched = false;
	stopped.channel.onMessage(() => {
		dispatched = true;
	});
	stopped.stop();
	stopped.text('after-shutdown');
	assert.equal(dispatched, false);
	assert.equal(stopped.terminated, 1);
});

test('reentrant synchronous delivery waits for the current callback to return', () => {
	const f = fixture();
	const order = [];
	f.channel.onMessage((value) => {
		order.push('start:' + value);
		if (value === 'first') f.text('second');
		order.push('end:' + value);
	});
	f.text('first');
	assert.deepEqual(order, ['start:first', 'end:first', 'start:second', 'end:second']);
	assert.equal(f.terminated, 0);
});
