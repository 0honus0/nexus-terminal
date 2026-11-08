import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

export async function waitFor(read, accept, description, timeout = 10000) {
	const deadline = performance.now() + timeout;
	let value;
	do {
		value = await read();
		if (accept(value)) {
			return value;
		}
		await delay(40);
	} while (performance.now() < deadline);
	assert.fail(description + ': ' + JSON.stringify(value));
}

export function desktopPeer(fixture, ticket, headers = {}) {
	const socket = fixture.socket('/ws/remote-desktop?ticket=' + ticket, headers);
	const events = [];
	const errors = [];
	let closeResult;
	let upgradeStatus;
	const closed = new Promise((resolve) =>
		socket.once('close', (code, reason) => {
			closeResult = { code, reason: reason.toString() };
			resolve(closeResult);
		}),
	);
	socket.on('error', (error) => errors.push(error));
	socket.on('message', () => events.push({ kind: 'data' }));
	socket.on('unexpected-response', (_request, response) => {
		upgradeStatus = response.statusCode;
		response.resume();
		socket.terminate();
	});
	return {
		socket,
		events,
		errors,
		closed,

		get closeResult() {
			return closeResult;
		},

		get upgradeStatus() {
			return upgradeStatus;
		},

		async close() {
			if (socket.readyState !== socket.CLOSED) socket.terminate();
			await closed;
		},
	};
}
