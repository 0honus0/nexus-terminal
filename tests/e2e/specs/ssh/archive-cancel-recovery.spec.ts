import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import {
  closeWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  waitForFilesystemReady,
  waitForJson,
} from '../../support/ws';

test('archive cancellation settles after remote exit and permits a subsequent compression', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const id = crypto.randomUUID();
  const destination = `/cancelled-${id}.zip`;
  const processes = async () => {
    const response = await fetch(`${E2E_SSH.controlUrl}/archive/processes`);
    expect(response.ok).toBeTruthy();
    return response.json() as Promise<{ started: number; exited: number }>;
  };
  try {
    await waitForFilesystemReady(workspace.socket);
    const baseline = await processes();
    expect((await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=1`, { method: 'POST' })).ok).toBeTruthy();
    const terminal = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.archive' &&
        message.payload?.requestId === id &&
        ['completed', 'cancelled', 'failed'].includes(message.payload?.type),
    );
    const outcome = terminal.then(
      (message) => message.payload,
      () => ({ type: 'timeout' }),
    );
    expect(
      await requestWorkspace(
        workspace.socket,
        'transfer.compress',
        {
          sources: ['/archive-source.txt'],
          destination,
          format: 'zip',
        },
        id,
      ),
    ).toEqual({ started: true });
    await expect.poll(async () => (await processes()).started).toBe(baseline.started + 1);
    expect(await requestWorkspace(workspace.socket, 'transfer.cancelArchive', { taskId: id })).toBe(true);
    expect(await outcome).toMatchObject({ type: 'cancelled', requestId: id });
    expect(await processes()).toEqual({ started: baseline.started + 1, exited: baseline.exited + 1 });
    await expect.poll(() => requestWorkspace(workspace.socket, 'transfer.cancelArchive', { taskId: id })).toBe(false);
    expect((await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=0`, { method: 'POST' })).ok).toBeTruthy();
    await expect(requestWorkspace(workspace.socket, 'filesystem.stat', { path: destination })).rejects.toThrow();
    const nextId = crypto.randomUUID();
    const nextPath = `/recovered-${nextId}.zip`;
    const completed = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.archive' &&
        message.payload?.requestId === nextId &&
        ['completed', 'cancelled', 'failed'].includes(message.payload?.type),
    );
    const recovered = completed.then(
      (message) => message.payload,
      () => ({ type: 'timeout' }),
    );
    await requestWorkspace(
      workspace.socket,
      'transfer.compress',
      {
        sources: ['/archive-source.txt'],
        destination: nextPath,
        format: 'zip',
      },
      nextId,
    );
    expect(await recovered).toMatchObject({ type: 'completed', path: nextPath });
    expect(await requestWorkspace(workspace.socket, 'filesystem.stat', { path: nextPath })).toBeTruthy();
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=0`, { method: 'POST' });
    await closeWebSocket(workspace.socket);
  }
});
