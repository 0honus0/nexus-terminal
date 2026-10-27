import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createWebSocketChannel } from '../../../packages/backend/dist/platform/http/websocket-channel.js';
import { WORKSPACE_FILES_MAX_LIST_RESPONSE_BYTES } from '../../../packages/shared/dist/remote/files/values.js';

class SocketStub extends EventEmitter {
	readyState = 1;
	bufferedAmount = 0;
	messages = [];

	send(value, options, callback) {
		this.messages.push(value);
		(typeof options === 'function' ? options : callback)?.();
	}

	terminate() {}
}

function channel(maxBufferedTextBytes) {
	const socket = new SocketStub();
	return {
		socket,
		channel: createWebSocketChannel(socket, {
			isAccepting: () => true,

			maxBufferedTextBytes,

			trackTask: () => undefined,

			onClosed: () => undefined,
		}),
	};
}

test('the Workspace file list uses a route-scoped bounded buffer without weakening default WS or binary limits', () => {
	const metadata = {
		size: 1,
		uid: 1000,
		gid: 1000,
		mode: 0o100644,
		accessedAt: 1792419000000,
		modifiedAt: 1792419000000,
		isFile: true,
		isDirectory: false,
		isSymbolicLink: false,
	};
	const entries = Array.from({ length: 5000 }, (_, index) => ({
		name: `文件-${index}.txt`,
		path: `/list-profile-5000/文件-${index}.txt`,
		metadata,
	}));
	const response = JSON.stringify({
		type: 'response',
		requestId: 'list-profile',
		payload: { ok: true, data: { path: '/list-profile-5000', entries } },
	});
	assert.ok(Buffer.byteLength(response) > 1024 * 1024, 'realistic 5k listing exceeds default WS budget');
	assert.ok(Buffer.byteLength(response) < WORKSPACE_FILES_MAX_LIST_RESPONSE_BYTES);

	const ordinary = channel();
	assert.equal(ordinary.channel.send(response), false);
	assert.equal(ordinary.socket.messages.length, 0);

	const workspace = channel(WORKSPACE_FILES_MAX_LIST_RESPONSE_BYTES);
	assert.equal(workspace.channel.send(response), true);
	assert.equal(workspace.socket.messages[0], response);
	assert.equal(workspace.channel.send('x'.repeat(WORKSPACE_FILES_MAX_LIST_RESPONSE_BYTES + 1)), false);
	assert.equal(workspace.channel.sendBinary(new Uint8Array(1024 * 1024 + 1)), false);
	assert.equal(workspace.socket.messages.length, 1);
});
