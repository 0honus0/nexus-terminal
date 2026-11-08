// @vitest-environment jsdom
import { test, expect, vi, afterEach } from 'vitest';
import { createStatusChannel } from '../../../../../packages/frontend/src/runtimes/workspace/adapters/observation-adapters.ts';
import { createStatusMonitorSession } from '../../../../../packages/frontend/src/features/status-monitor/composables/useStatusMonitor.ts';
import { WorkspaceSocket } from '../../../../../packages/frontend/src/runtimes/workspace/protocol/workspaceSocket.ts';
import { openWorkspacePeer } from '../../../../support/protocols/workspace-peer.mjs';

afterEach(() => vi.unstubAllGlobals());

test('real subscription start/stop refusals retain the original owner until explicit recovery succeeds', async () => {
	const peer = await openWorkspacePeer();
	let starts = 0,
		stops = 0;
	peer.server.on('connection', (connection) =>
		connection.on('message', (raw) => {
			const request = JSON.parse(raw.toString());
			if (!request.requestId) return;
			const refused =
				(request.type === 'status.start' && ++starts === 1) ||
				(request.type === 'status.stop' && ++stops === 1);
			connection.send(
				JSON.stringify({
					type: 'response',
					requestId: request.requestId,
					payload: refused ? { ok: false, error: 'remote_unavailable' } : { ok: true, data: null },
				}),
			);
		}),
	);
	vi.stubGlobal('WebSocket', peer.WebSocket);
	const socket = new WorkspaceSocket();
	const channel = createStatusChannel(socket, () => true);
	const monitor = createStatusMonitorSession(channel);
	try {
		await socket.open();
		monitor.activate();
		await Promise.resolve();
		await monitor.workspaceConnected();
		expect(monitor.error.value).toBe('remote_unavailable');
		await monitor.workspaceConnected();
		expect(starts).toBe(1);
		expect(stops).toBe(1);
		await monitor.workspaceConnected();
		expect(stops).toBe(2);
		expect(starts).toBe(2);
		await Promise.all([channel.stop(), channel.stop()]);
		expect(stops).toBe(3);
	} finally {
		monitor.dispose();
		await channel.stop();
		channel.disconnect();
		socket.close();
		await peer.close();
	}
});
