import { test, expect, loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';
import { closeWebSocket, waitForFilesystemReady } from '../../../../support/protocols/workspace-client';
import { createFixtures, expectHandlesClosed, expectWorkspaceUsable } from '../support/workspace-recovery';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test(
	'A Workspace idle beyond two minutes still lists, opens HTML, saves, issues tickets and downloads folders',
	{ timeout: 180_000 },
	async ({ request, ssh, httpClients }) => {
		await loginAsAdmin(request);
		await createFixtures(ssh);
		const connectionId = await createSshConnection(request, ssh);
		const workspace = await httpClients.openWorkspace(connectionId);
		try {
			await waitForFilesystemReady(workspace.socket);
			const started = performance.now();
			await delay(125_000);
			expect(performance.now() - started).toBeGreaterThan(120_000);
			expect(workspace.socket.readyState).toBe(1);
			await expectWorkspaceUsable(request, workspace, connectionId, join(ssh.directory, 'idle.zip'));
			await expectHandlesClosed(ssh);
		} finally {
			await closeWebSocket(workspace.socket);
		}
	},
);
