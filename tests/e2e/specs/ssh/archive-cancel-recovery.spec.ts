import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { E2E_SSH, ensureTestSshConnection } from '../../support/ssh';
import {
  closeWebSocket,
  openWorkspaceSession,
  requestWorkspace,
  requestWorkspaceBinary,
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

test('cancelling one concurrent archive leaves the other archive able to complete', async ({ request }) => {
  await loginAsInitialAdmin(request);
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const paths = ids.map((id) => `/concurrent-${id}.zip`);
  const source = `/source-${crypto.randomUUID()}.txt`;
  const content = `archive recovery ${crypto.randomUUID()}\n`;
  try {
    await waitForFilesystemReady(workspace.socket);
    await requestWorkspace(workspace.socket, 'filesystem.writeText', { path: source, content });
    const baselineResponse = await fetch(`${E2E_SSH.controlUrl}/archive/processes`);
    expect(baselineResponse.ok).toBeTruthy();
    const baseline = await baselineResponse.json();
    expect((await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=1`, { method: 'POST' })).ok).toBeTruthy();
    const outcomes = ids.map((id) =>
      waitForJson(
        workspace.socket,
        (message) =>
          message.type === 'transfer.archive' &&
          message.payload?.requestId === id &&
          ['completed', 'cancelled', 'failed'].includes(message.payload?.type),
      ).then(
        (message) => message.payload,
        () => ({ type: 'timeout' }),
      ),
    );
    await Promise.all(
      ids.map((id, index) =>
        requestWorkspace(
          workspace.socket,
          'transfer.compress',
          {
            sources: [source],
            destination: paths[index],
            format: 'zip',
          },
          id,
        ),
      ),
    );
    await expect
      .poll(async () => {
        const response = await fetch(`${E2E_SSH.controlUrl}/archive/processes`);
        return (await response.json()).started;
      })
      .toBe(baseline.started + 2);
    expect(await requestWorkspace(workspace.socket, 'transfer.cancelArchive', { taskId: ids[0] })).toBe(true);
    expect(await outcomes[0]).toMatchObject({ type: 'cancelled', requestId: ids[0] });
    const afterCancel = await fetch(`${E2E_SSH.controlUrl}/archive/processes`);
    expect(afterCancel.ok).toBeTruthy();
    expect(await afterCancel.json()).toEqual({ started: baseline.started + 2, exited: baseline.exited + 1 });
    expect((await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=0`, { method: 'POST' })).ok).toBeTruthy();
    expect(await outcomes[1]).toMatchObject({ type: 'completed', requestId: ids[1], path: paths[1] });
    await expect(requestWorkspace(workspace.socket, 'filesystem.stat', { path: paths[0] })).rejects.toThrow();
    expect(await requestWorkspace(workspace.socket, 'filesystem.stat', { path: paths[1] })).toBeTruthy();
    await requestWorkspace(workspace.socket, 'filesystem.remove', { paths: [source] });
    const extractId = crypto.randomUUID();
    const extracted = waitForJson(
      workspace.socket,
      (message) =>
        message.type === 'transfer.archive' &&
        message.payload?.requestId === extractId &&
        ['completed', 'cancelled', 'failed'].includes(message.payload?.type),
    ).then(
      (message) => message.payload,
      () => ({ type: 'timeout' }),
    );
    await requestWorkspace(workspace.socket, 'transfer.decompress', { source: paths[1] }, extractId);
    expect(await extracted).toMatchObject({ type: 'completed', requestId: extractId });
    const restored = await requestWorkspaceBinary(workspace.socket, 'filesystem.readBinary', {
      path: source,
      maxBytes: Buffer.byteLength(content),
    });
    expect(restored.bytes).toEqual(Buffer.from(content));
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=0`, { method: 'POST' });
    await closeWebSocket(workspace.socket);
  }
});
