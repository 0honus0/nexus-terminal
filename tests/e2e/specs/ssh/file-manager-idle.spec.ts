import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection } from '../../support/ssh';
import { closeWebSocket, openWorkspaceSession, waitForFilesystemReady } from '../../support/ws';
import { createFixtures, expectWorkspaceUsable, expectHandlesClosed } from './file-manager-regressions.helpers';

test('a Workspace idle beyond two minutes still lists, opens HTML, saves, issues tickets and downloads folders', async ({
	request,
}, testInfo) => {
	test.setTimeout(180_000);
	await loginAsInitialAdmin(request);
	await createFixtures();
	const connectionId = await ensureTestSshConnection(request);
	const workspace = await openWorkspaceSession(request, connectionId);
	try {
		await waitForFilesystemReady(workspace.socket);
		const idleStarted = performance.now();
		await new Promise((resolve) => setTimeout(resolve, 125_000));
		expect(performance.now() - idleStarted).toBeGreaterThan(120_000);
		expect(workspace.socket.readyState).toBe(1);
		await expectWorkspaceUsable(request, workspace, connectionId, testInfo.outputPath('idle.zip'));
		await expectHandlesClosed();
	} finally {
		await closeWebSocket(workspace.socket);
	}
});
