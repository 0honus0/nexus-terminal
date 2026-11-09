import { EventEmitter } from 'node:events';
import { expect, onTestFinished, test, vi } from 'vitest';
import { requestWorkspace, requestWorkspaceBinary } from '../../../support/protocols/workspace-client.ts';

test('Workspace helpers reject unusable sockets before sending or waiting for a response deadline', async () => {
	vi.useFakeTimers();
	onTestFinished(() => vi.useRealTimers());
	for (const readyState of [0, 2, 3]) {
		const socket = new EventEmitter();
		socket.readyState = readyState;
		socket.send = vi.fn();
		await expect(requestWorkspace(socket, 'terminal.input', { data: 'forbidden\r' })).rejects.toThrow(
			'WebSocket is not open',
		);
		await expect(requestWorkspaceBinary(socket, 'filesystem.read')).rejects.toThrow('WebSocket is not open');
		expect(socket.send).not.toHaveBeenCalled();
		expect(socket.eventNames()).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	}
});
