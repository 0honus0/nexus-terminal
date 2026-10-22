import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	WORKSPACE_BINARY_MAX_PAYLOAD_BYTES,
	WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES,
} from '../../../../packages/shared/src/remote/workspace/values';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
	closeWebSocket,
	decodeWorkspaceBinaryFrame,
	openAuthenticatedWebSocket,
	openWorkspaceSession,
	requestWorkspace,
	sendJson,
	waitForJson,
} from '../../support/ws';

test('terminal consumption window pauses output and drains without missing bytes after acknowledgement', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	const connectionId = await ensureTestSshConnection(request);
	const socket = await openAuthenticatedWebSocket(request);
	let receivedBytes = 0;
	let consume = false;
	const chunks: Buffer[] = [];
	socket.on('message', (raw: Buffer, binary: boolean) => {
		if (!binary) return;
		const frame = decodeWorkspaceBinaryFrame(raw);
		if (frame.kind !== 'terminal') return;
		receivedBytes += frame.data.byteLength;
		chunks.push(Buffer.from(frame.data));
		if (consume) sendJson(socket, { type: 'terminal.flow', payload: { consumedBytes: receivedBytes } });
	});
	try {
		await requestWorkspace(socket, 'terminal.flow', { consumedBytes: 0 });
		await requestWorkspace(socket, 'workspace.connect', {
			connectionId,
			workspaceId: `flow-${crypto.randomUUID()}`,
			viewport: { columns: 100, rows: 30 },
		});
		await requestWorkspace(socket, 'terminal.input', {
			data: "head -c 3145728 /dev/zero | tr '\\0' 'Z'; printf '\\nFLOW_WINDOW_DONE\\n'\r",
		});
		// Flow control reserves room for the next complete terminal frame;
		// the in-flight budget is a maximum, not a mandated minimum payload.
		await expect
			.poll(() => receivedBytes)
			.toBeGreaterThanOrEqual(WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES - WORKSPACE_BINARY_MAX_PAYLOAD_BYTES);
		// Reach the actual backpressure plateau, not merely an intermediate
		// buffered frame. No additional data may escape after a ping completes.
		await expect
			.poll(async () => {
				const before = receivedBytes;
				await requestWorkspace(socket, 'workspace.ping');
				return receivedBytes - before;
			})
			.toBe(0);
		expect(receivedBytes).toBeLessThanOrEqual(WORKSPACE_TERMINAL_MAX_IN_FLIGHT_BYTES);
		expect(Buffer.concat(chunks).toString()).not.toMatch(/\nFLOW_WINDOW_DONE\r?\n/);
		await expect(requestWorkspace(socket, 'terminal.flow', { consumedBytes: receivedBytes + 1 })).rejects.toThrow();
		consume = true;
		await requestWorkspace(socket, 'terminal.flow', { consumedBytes: receivedBytes });
		await expect
			.poll(() => /\nFLOW_WINDOW_DONE\r?\n/.test(Buffer.concat(chunks).toString()), { timeout: 15_000 })
			.toBe(true);
		const output = Buffer.concat(chunks).toString();
		expect(output.split('Z').length - 1).toBe(3145729); // payload plus the echoed command's 'Z'
	} finally {
		await closeWebSocket(socket);
	}
});

test('the first directory change waits for a real shell prompt instead of reporting foreground activity', async ({
	request,
}) => {
	await loginAsInitialAdmin(request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(request);
	const targetPath = '/folder-seed';
	const workspace = await openWorkspaceSession(request, connectionId, `cwd-${crypto.randomUUID()}`);
	const chunks: Buffer[] = [];
	workspace.socket.on('message', (raw: Buffer, binary: boolean) => {
		if (!binary) return;
		const frame = decodeWorkspaceBinaryFrame(raw);
		if (frame.kind === 'terminal') chunks.push(Buffer.from(frame.data));
	});

	try {
		// Historical race: issue the first cwd change immediately after workspace.connect completes.
		const requestId = `cwd-${crypto.randomUUID()}`;
		const changedPromise = waitForJson(
			workspace.socket,
			(message) => message.type === 'terminal.directoryChanged' && message.payload?.requestId === requestId,
			20_000,
		);
		const failedPromise = waitForJson(
			workspace.socket,
			(message) => message.type === 'terminal.directoryChangeFailed' && message.payload?.requestId === requestId,
			1_000,
		).catch(() => null);
		await expect(
			requestWorkspace(workspace.socket, 'terminal.changeDirectory', { path: targetPath }, requestId),
		).resolves.toMatchObject({ queued: true });
		const changed = await changedPromise;
		expect(changed.payload).toMatchObject({ path: targetPath });
		expect(await failedPromise).toBeNull();
		const output = Buffer.concat(chunks).toString('utf8');
		expect(output).toMatch(/cd '\/folder-seed'\r?\n/);
		expect(output).not.toContain('__NEXUS_INTERNAL_CD_');
	} finally {
		await closeWebSocket(workspace.socket);
	}
});

test('directory changes reject terminal control characters before writing to the PTY', async ({ request }) => {
	await loginAsInitialAdmin(request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId, `cwd-control-${crypto.randomUUID()}`);

	try {
		const requestId = `cwd-control-${crypto.randomUUID()}`;
		const before = await requestWorkspace(workspace.socket, 'terminal.currentDirectory');
		await expect(
			requestWorkspace(
				workspace.socket,
				'terminal.changeDirectory',
				{ path: '/folder-seed\nsecond-command' },
				requestId,
			),
		).rejects.toThrow(/invalid_input/);
		await expect(requestWorkspace(workspace.socket, 'terminal.currentDirectory')).resolves.toEqual(before);
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
