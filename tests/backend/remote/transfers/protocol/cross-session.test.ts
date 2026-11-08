import type { APIRequestContext } from '@playwright/test';
import type { ControlledSsh } from '../../../../support/protocols/controlled-ssh-fixture.mjs';
import { readTestConnectionImportId } from '../../../../support/http/target-import';
import { expect, test, HTTP_TEST_ORIGIN } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { trustSshHostKey } from '../../../../support/http/ssh-targets.ts';
import {
	closeWebSocket,
	type E2eWebSocket,
	requestWorkspace,
	requestWorkspaceBinary,
	waitForFilesystemReady,
	waitForJson,
} from '../../../../support/protocols/workspace-client';

async function createConnection(request: APIRequestContext, ssh: ControlledSsh, name: string): Promise<number> {
	const response = await request.post('/api/v1/targets/connections/import', {
		headers: { Origin: HTTP_TEST_ORIGIN },
		data: {
			items: [
				{
					connection: {
						name: name,
						type: 'SSH',
						host: ssh.host,
						port: ssh.port,
						username: ssh.username,
						notes: null,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: ssh.password },
				},
			],
		},
	});
	expect(response.status()).toBe(200);
	return readTestConnectionImportId(await response.json());
}

async function readRemoteFile(socket: E2eWebSocket, remotePath: string): Promise<string> {
	const response = await requestWorkspaceBinary(socket, 'filesystem.readBinary', {
		path: remotePath,
		maxBytes: 64 * 1024 * 1024,
	});
	return response.bytes.toString('utf8');
}

async function runTransfer(
	socket: E2eWebSocket,
	requestId: string,
	payload: {
		mode: 'copy' | 'move';
		sourceWorkspaceId: string;
		sources: string[];
		destination: string;
	},
) {
	const progressPromise = waitForJson(
		socket,
		(message) =>
			message.type === 'transfer.copyMove' &&
			message.payload?.requestId === requestId &&
			message.payload?.type === 'progress' &&
			Number(message.payload?.transferredBytes) > 0,
		20000,
	);
	const terminalPromise = waitForJson(
		socket,
		(message) =>
			message.type === 'transfer.copyMove' &&
			message.payload?.requestId === requestId &&
			['completed', 'failed'].includes(String(message.payload?.type)),
		30000,
	);
	await requestWorkspace(socket, 'transfer.copyMove', payload, requestId, 30000);
	const terminal = await terminalPromise;
	expect(terminal.payload?.type, JSON.stringify(terminal.payload)).toBe('completed');
	const progress = await progressPromise;
	if (progress.payload?.totalKnown)
		expect(progress.payload?.totalBytes).toBeGreaterThanOrEqual(progress.payload?.transferredBytes);
	else expect(progress.payload?.totalBytes).toBe(progress.payload?.transferredBytes);
	return progress.payload;
}

test('cross-session relay copy and move transfer data and progress over real SFTP', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	await trustSshHostKey(request, ssh);
	expect((await fetch(`${ssh.controlUrl}/transfer-peer?blocked=1`, { method: 'POST' })).ok).toBe(true);
	const sourceId = await createConnection(request, ssh, 'E2E Cross Source');
	const destinationId = await createConnection(request, ssh, 'E2E Cross Destination');
	const source = await httpClients.openWorkspace(sourceId, `cross-source-${crypto.randomUUID()}`);
	const destination = await httpClients.openWorkspace(destinationId, `cross-destination-${crypto.randomUUID()}`);
	try {
		await Promise.all([waitForFilesystemReady(source.socket), waitForFilesystemReady(destination.socket)]);
		// cross-session copy emits progress and writes the destination
		{
			const progress = await runTransfer(destination.socket, `cross-copy-${crypto.randomUUID()}`, {
				mode: 'copy',
				sourceWorkspaceId: source.workspaceId,
				sources: ['/cross-copy.txt'],
				destination: '/cross-target',
			});
			expect(progress).toMatchObject({ totalKnown: true, totalFiles: 1 });
			expect(Number(progress?.totalBytes)).toBeGreaterThan(0);
			await expect(readRemoteFile(destination.socket, '/cross-target/cross-copy.txt')).resolves.toContain(
				'cross-copy-body',
			);
		}
		// duplicate sessions reject copying a directory onto itself and preserve source content
		{
			const original = await readRemoteFile(source.socket, '/folder-seed/nested.txt');
			const requestId = `cross-same-path-${crypto.randomUUID()}`;
			const terminalPromise = waitForJson(
				destination.socket,
				(message) =>
					message.type === 'transfer.copyMove' &&
					message.payload?.requestId === requestId &&
					['completed', 'failed'].includes(String(message.payload?.type)),
			);
			await requestWorkspace(
				destination.socket,
				'transfer.copyMove',
				{
					mode: 'copy',
					sourceWorkspaceId: source.workspaceId,
					sources: ['/folder-seed'],
					destination: '/',
				},
				requestId,
			);
			expect((await terminalPromise).payload).toMatchObject({ type: 'failed', message: 'conflict' });
			await expect(readRemoteFile(source.socket, '/folder-seed/nested.txt')).resolves.toBe(original);
		}
		// cross-session directory copy reuses READDIR metadata for child entries
		{
			expect(
				(await fetch(ssh.controlUrl + '/sftp/lstat-deny-prefix?path=%2Ffolder-seed%2F', { method: 'POST' })).ok,
			).toBe(true);
			try {
				const progress = await runTransfer(destination.socket, `cross-folder-${crypto.randomUUID()}`, {
					mode: 'copy',
					sourceWorkspaceId: source.workspaceId,
					sources: ['/folder-seed'],
					destination: '/cross-target',
				});
				expect(progress).toMatchObject({ totalKnown: false });
				expect(Number(progress?.totalFiles)).toBeGreaterThan(0);
				expect(Number(progress?.totalBytes)).toBeGreaterThan(0);
				await expect(
					readRemoteFile(destination.socket, '/cross-target/folder-seed/nested.txt'),
				).resolves.toContain('nested');
			} finally {
				expect((await fetch(ssh.controlUrl + '/sftp/lstat-deny-prefix?path=', { method: 'POST' })).ok).toBe(
					true,
				);
			}
		}
		// two-phase cross-session move deletes source only after copy success
		{
			await runTransfer(destination.socket, `cross-move-${crypto.randomUUID()}`, {
				mode: 'move',
				sourceWorkspaceId: source.workspaceId,
				sources: ['/cross-move.txt'],
				destination: '/cross-target',
			});
			await expect(readRemoteFile(destination.socket, '/cross-target/cross-move.txt')).resolves.toContain(
				'cross-move-body',
			);
			const root = await requestWorkspace<{
				entries: Array<{
					name: string;
				}>;
			}>(source.socket, 'filesystem.list', {
				path: '/',
			});
			expect(root.entries.map((item) => item.name)).not.toContain('cross-move.txt');
		}
	} finally {
		await Promise.all([closeWebSocket(source.socket), closeWebSocket(destination.socket)]);
	}
});
