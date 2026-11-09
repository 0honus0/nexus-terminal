import { test as baseTest, expect, loginAsAdmin } from '../../../../support/http/ssh-protocol-fixture.mjs';
import { createSshConnection } from '../../../../support/http/ssh-targets.ts';
import { closeWebSocket, waitForFilesystemReady } from '../../../../support/protocols/workspace-client';
import { createFixtures, expectHandlesClosed, expectWorkspaceUsable } from '../support/workspace-recovery';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { HttpClients } from '../../../../support/http/protocol-fixture.mjs';
import { useHttpProtocol } from '../../../../support/http/protocol-fixture.mjs';

const test = baseTest.extend<{ httpClients: HttpClients }>({
	httpClients: async ({ ssh }, use) => {
		vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
		try {
			await useHttpProtocol(use);
		} finally {
			vi.useRealTimers();
		}
	},
});

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
			const started = Date.now();
			await vi.advanceTimersByTimeAsync(125_000);
			expect(Date.now() - started).toBeGreaterThan(120_000);
			expect(workspace.socket.readyState).toBe(1);
			await expectWorkspaceUsable(request, workspace, connectionId, join(ssh.directory, 'idle.zip'));
			await expectHandlesClosed(ssh);
		} finally {
			await closeWebSocket(workspace.socket);
		}
	},
);
