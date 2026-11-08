import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { test } from 'vitest';
import { waitForResponse } from '../../../../../packages/backend/src/platform/http/http-lifecycle.ts';

for (const event of ['finish', 'close', 'aborted', 'socket-close']) {
	test('HTTP response observers share one completion and release all owned listeners after ' + event, async (t) => {
		const socket = new Socket();
		const request = new IncomingMessage(socket);
		const response = new ServerResponse(request);
		response.assignSocket(socket);
		t.onTestFinished(() => {
			response.destroy();
			socket.destroy();
		});
		const responseEvents = ['finish', 'close', 'error'];
		const baseline = responseEvents.map((name) => response.listenerCount(name));
		const socketBaseline = socket.listenerCount('close');
		const abortedBaseline = request.listenerCount('aborted');
		const completion = waitForResponse(response, request);
		for (let index = 0; index < 20; index++) assert.equal(waitForResponse(response, request), completion);
		assert.deepEqual(
			responseEvents.map((name) => response.listenerCount(name)),
			baseline.map((count) => count + 1),
		);
		assert.equal(socket.listenerCount('close'), socketBaseline + 1);
		let completed = false;
		void completion.then(() => {
			completed = true;
		});
		await Promise.resolve();
		assert.equal(completed, false, 'Returned handlers do not prove transport completion');
		if (event === 'aborted') request.emit('aborted');
		else if (event === 'socket-close') socket.emit('close');
		else response.emit(event);
		await completion;
		assert.deepEqual(
			responseEvents.map((name) => response.listenerCount(name)),
			baseline,
		);
		assert.equal(socket.listenerCount('close'), socketBaseline);
		assert.equal(request.listenerCount('aborted'), abortedBaseline);
	});
}
