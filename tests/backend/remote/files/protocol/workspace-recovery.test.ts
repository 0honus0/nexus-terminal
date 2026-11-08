import { test, expect, loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';
import {
	closeWebSocket,
	requestWorkspace,
	requestWorkspaceBinary,
	waitForFilesystemReady,
	WorkspaceRequestFailure,
} from '../../../../support/protocols/workspace-client';
import {
	createFixtures,
	directoryUrl,
	setReadDelay,
	expectHandlesClosed,
	waitForPendingRead,
	expectWorkspaceUsable,
} from '../support/workspace-recovery';
import { join } from 'node:path';
import { get } from 'node:http';

test('Cancelling an in-flight binary read preserves the original Workspace for editing and folder downloads', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	await createFixtures(ssh);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId);
	let pending: Promise<unknown> | undefined;
	try {
		await waitForFilesystemReady(workspace.socket);
		await setReadDelay(ssh, 3000);
		const requestId = crypto.randomUUID();
		pending = requestWorkspaceBinary(
			workspace.socket,
			'filesystem.readBinary',
			{ path: '/regression.html', maxBytes: 1024 },
			requestId,
		).then(
			() => ({ completed: true }),
			(error: unknown) => {
				if (!(error instanceof WorkspaceRequestFailure)) throw error;
				return { error: error.code };
			},
		);
		await waitForPendingRead(ssh);
		expect(await requestWorkspace(workspace.socket, 'filesystem.cancelRead', { requestId })).toBe(true);
		expect(await pending).toEqual({ error: 'remote_unavailable' });
		await expectHandlesClosed(ssh);
		await setReadDelay(ssh, 0);
		await expectWorkspaceUsable(request, workspace, connectionId, join(ssh.directory, 'after-cancel.zip'));
		await expectHandlesClosed(ssh);
	} finally {
		try {
			await setReadDelay(ssh, 0);
		} finally {
			await closeWebSocket(workspace.socket);
			if (pending) await pending;
		}
	}
});

test('Aborting a directory ZIP during remote READ preserves the original Workspace and closes transfer handles', async ({
	request,
	ssh,
	httpClients,
}) => {
	await loginAsAdmin(request);
	await createFixtures(ssh);
	const connectionId = await createSshConnection(request, ssh);
	const workspace = await httpClients.openWorkspace(connectionId);
	const controller = new AbortController();
	let pending: Promise<string> | undefined;
	try {
		await waitForFilesystemReady(workspace.socket);
		await setReadDelay(ssh, 3000);
		const cookie = (await request.storageState()).cookies.map((entry) => entry.name + '=' + entry.value).join('; ');
		pending = new Promise<string>((resolve, reject) => {
			const req = get(
				httpClients.url(directoryUrl(connectionId, workspace.workspaceId)),
				{ headers: { ...httpClients.headers, Cookie: cookie }, signal: controller.signal },
				(response) => {
					if (response.statusCode !== 200) {
						response.resume();
						reject(new Error('Unexpected directory download status: ' + response.statusCode));
						return;
					}
					response.on('data', () => {});
					response.once('error', reject);
					response.once('end', () => resolve('completed'));
				},
			);
			req.once('error', reject);
		}).catch((error: unknown) => {
			if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
			return error.name;
		});
		await waitForPendingRead(ssh);
		controller.abort();
		expect(await pending).toBe('AbortError');
		await expectHandlesClosed(ssh);
		await setReadDelay(ssh, 0);
		await expectWorkspaceUsable(request, workspace, connectionId, join(ssh.directory, 'after-abort.zip'));
		await expectHandlesClosed(ssh);
	} finally {
		controller.abort();
		try {
			await setReadDelay(ssh, 0);
		} finally {
			await closeWebSocket(workspace.socket);
			if (pending) await pending;
		}
	}
});
