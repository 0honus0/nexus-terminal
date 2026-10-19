import assert from 'node:assert/strict';
import { ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

/** Interrupt the actual socket after end() queues a response, before finish confirms delivery. */
export function interruptAccessResponse(t, path) {
	const end = ServerResponse.prototype.end;
	const writeHead = ServerResponse.prototype.writeHead;
	const state = { count: 0, cookies: [], body: null, delivered: false };
	t.mock.method(ServerResponse.prototype, 'writeHead', function (status, headers) {
		if (this.req.url === path && state.count === 0) {
			state.cookies = headers['Set-Cookie'] ?? [];
			if (typeof state.cookies === 'string') state.cookies = [state.cookies];
		}
		return writeHead.call(this, status, headers);
	});
	t.mock.method(ServerResponse.prototype, 'end', function (...args) {
		if (this.req.url !== path || state.count !== 0) {
			return end.apply(this, args);
		}
		state.count += 1;
		this.once('finish', () => {
			state.delivered = !this.destroyed && !socket.destroyed;
		});
		state.body = JSON.parse(String(args[0]));
		const socket = this.socket;
		const failure = new Error('Controlled socket write interruption');

		// Stall only the transport write, retaining Node's real writable accounting and close/error delivery.
		const stall = (...values) => {
			setImmediate(() => values.at(-1)(failure));
		};

		t.mock.method(socket, '_write', stall);
		t.mock.method(socket, '_writev', stall);
		const result = end.apply(this, args);
		assert.equal(this.writableFinished, false, 'actual response has not finished');
		socket.destroy(failure);
		return result;
	});
	return state;
}

export function responseTokenDigest(state, name) {
	const cookie = state.cookies.find((value) => value.startsWith(name + '=') && !value.startsWith(name + '=;'));
	assert.ok(cookie, 'the interrupted response had issued the expected credential');
	const token = cookie.split(';')[0].slice(name.length + 1);
	return createHash('sha256').update(token).digest('hex');
}
