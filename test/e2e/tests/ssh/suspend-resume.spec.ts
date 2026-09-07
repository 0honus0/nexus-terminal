import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  openAuthenticatedWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  waitForFilesystemReady,
} from '../../support/ws';

test('a marked live SSH session survives WebSocket disconnect and resumes the same shell', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const original = await openWorkspaceSession(request, connectionId, `suspend-${crypto.randomUUID()}`);

  await requestWorkspace(original.socket, 'suspend.mark');
  await closeWebSocket(original.socket);

  const recoverySocket = await openAuthenticatedWebSocket(request);
  try {
    type SuspendedSession = {
      id: string;
      originalWorkspaceId: string;
      connectionId: number;
      connectionName: string;
      status: 'active' | 'disconnected';
    };
    let suspended: SuspendedSession | undefined;
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const list = await requestWorkspace<SuspendedSession[]>(recoverySocket, 'suspend.list');
      suspended = list.find(
        (session) => session.originalWorkspaceId === original.workspaceId && session.status === 'active',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(suspended).toBeTruthy();
    expect(suspended).toMatchObject({
      originalWorkspaceId: original.workspaceId,
      connectionId,
      status: 'active',
    });

    const resumedWorkspaceId = `resumed-${crypto.randomUUID()}`;
    const resumed = await requestWorkspace<{
      workspaceId: string;
      connectionId: number;
      connectionName: string;
      resumedFrom: string;
    }>(recoverySocket, 'suspend.resume', {
      suspendedSessionId: suspended!.id,
      workspaceId: resumedWorkspaceId,
    });
    expect(resumed).toMatchObject({
      workspaceId: resumedWorkspaceId,
      connectionId,
      resumedFrom: suspended!.id,
    });
    await waitForFilesystemReady(recoverySocket);

    const listAfter = await requestWorkspace<SuspendedSession[]>(recoverySocket, 'suspend.list');
    expect(listAfter.some((session) => session.id === suspended!.id)).toBeFalsy();
  } finally {
    await closeWebSocket(recoverySocket);
  }
});
