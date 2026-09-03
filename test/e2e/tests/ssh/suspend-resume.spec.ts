import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { ensureTestSshConnection, resetTestSshFilesystem } from '../../support/ssh';
import {
  closeWebSocket,
  openAuthenticatedWebSocket,
  openSshSession,
  sendJson,
  waitForJson,
  waitForSftpReady,
} from '../../support/ws';

test('a marked live SSH session survives WebSocket disconnect and resumes transactionally', async ({ request }) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const original = await openSshSession(request, connectionId, `suspend-${crypto.randomUUID()}`);

  const markPromise = waitForJson(original.socket, (message) => message.type === 'SSH_MARKED_FOR_SUSPEND_ACK');
  sendJson(original.socket, {
    type: 'SSH_MARK_FOR_SUSPEND',
    payload: { sessionId: original.sessionId },
  });
  const marked = await markPromise;
  expect(marked.payload).toMatchObject({ success: true });
  await closeWebSocket(original.socket);

  const recoverySocket = await openAuthenticatedWebSocket(request);
  try {
    let suspended: any | undefined;
    for (let attempt = 0; attempt < 30 && !suspended; attempt += 1) {
      const listPromise = waitForJson(recoverySocket, (message) => message.type === 'SSH_SUSPEND_LIST_RESPONSE', 3_000);
      sendJson(recoverySocket, { type: 'SSH_SUSPEND_LIST_REQUEST', payload: {} });
      const list = await listPromise;
      suspended = (list.payload?.suspendSessions ?? []).find(
        (session: any) => session.originalSessionId === original.sessionId && session.backendSshStatus === 'hanging',
      );
      if (!suspended) await new Promise((resolve) => setTimeout(resolve, 150));
    }
    expect(suspended).toBeTruthy();
    expect(suspended).toMatchObject({ backendSshStatus: 'hanging' });

    const newFrontendSessionId = `resumed-${crypto.randomUUID()}`;
    const connectedAgain = waitForJson(
      recoverySocket,
      (message) => message.type === 'ssh:connected' && message.payload?.sessionId === newFrontendSessionId,
      20_000,
    );
    const resumedNotification = waitForJson(
      recoverySocket,
      (message) =>
        message.type === 'SSH_SUSPEND_RESUMED_NOTIF' &&
        message.payload?.suspendSessionId === suspended.suspendSessionId,
      20_000,
    );
    sendJson(recoverySocket, {
      type: 'SSH_SUSPEND_RESUME_REQUEST',
      payload: { suspendSessionId: suspended.suspendSessionId, newFrontendSessionId },
    });

    const [reconnected, resumed] = await Promise.all([connectedAgain, resumedNotification]);
    expect(reconnected.payload?.connectionId).toBe(connectionId);
    expect(resumed.payload).toMatchObject({ success: true });
    await waitForSftpReady(recoverySocket);

    const listAfterPromise = waitForJson(recoverySocket, (message) => message.type === 'SSH_SUSPEND_LIST_RESPONSE');
    sendJson(recoverySocket, { type: 'SSH_SUSPEND_LIST_REQUEST', payload: {} });
    const listAfter = await listAfterPromise;
    expect(
      (listAfter.payload?.suspendSessions ?? []).some(
        (session: any) => session.suspendSessionId === suspended.suspendSessionId,
      ),
    ).toBeFalsy();
  } finally {
    await closeWebSocket(recoverySocket);
  }
});
