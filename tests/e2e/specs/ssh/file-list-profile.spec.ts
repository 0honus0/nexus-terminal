import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  E2E_SSH,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';

test('compare single and repeated refresh requests while retaining new remote entries', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
  await openConnectedFileManager(page);
  const manager = page.getByRole('dialog', { name: 'File Manager', exact: true });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const pending = new Set<string>();
  let requests = 0;
  let peakPending = 0;
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    if (response.opcode !== 1) return;
    const message = JSON.parse(response.payloadData);
    if (message.type === 'filesystem.list') {
      requests++;
      pending.add(message.requestId);
      peakPending = Math.max(peakPending, pending.size);
    }
  });
  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    if (response.opcode !== 1) return;
    const message = JSON.parse(response.payloadData);
    if (message.type === 'response') pending.delete(message.requestId);
  });
  const samples = [];
  try {
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=300`, { method: 'POST' })).ok).toBe(true);
    for (const clicks of [1, 5]) {
      for (let sample = 0; sample < 3; sample++) {
        const filename = `refresh-profile-${clicks}-${sample}.txt`;
        await writeFile(path.resolve('.tmp/ssh-root', filename), 'refresh fixture');
        const baseline = requests;
        peakPending = 0;
        const start = performance.now();
        await manager.getByTitle('Refresh', { exact: true }).evaluate((element, count) => {
          for (let index = 0; index < count; index++) (element as HTMLButtonElement).click();
        }, clicks);
        await expect(activeFileManagerList(page).locator(`tr[data-filename="${filename}"]`)).toBeVisible();
        await expect.poll(() => pending.size).toBe(0);
        expect(requests - baseline).toBeGreaterThan(0);
        // Same-turn queued refreshes may coalesce, but the exact selected contract must hold.
        expect(requests - baseline).toBe(process.env.NEXUS_E2E_SERIAL_REFRESH_BASELINE === '1' ? clicks : 1);
        expect(peakPending).toBe(1);
        await expect(manager.locator('.file-manager-path-input input')).toHaveValue('/');
        samples.push({ clicks, sample, requests: requests - baseline, peakPending, ms: performance.now() - start });
      }
    }
    console.log('[repeated refresh profile]', JSON.stringify(samples));
    if (process.env.NEXUS_E2E_SERIAL_REFRESH_BASELINE !== '1') {
      const baseline = requests;
      await manager.getByTitle('Refresh', { exact: true }).click();
      await expect.poll(() => requests - baseline).toBe(1);
      expect(pending.size).toBe(1);
      const filename = 'refresh-during-active-read.txt';
      await writeFile(path.resolve('.tmp/ssh-root', filename), 'late refresh fixture');
      await manager.getByTitle('Refresh', { exact: true }).click();
      await expect.poll(() => requests - baseline).toBe(2);
      await expect.poll(() => pending.size).toBe(0);
      await expect(activeFileManagerList(page).locator(`tr[data-filename="${filename}"]`)).toBeVisible();
      expect(requests - baseline).toBe(2);
      expect(peakPending).toBe(1);
      await expect(manager.locator('.file-manager-path-input input')).toHaveValue('/');
    }
  } finally {
    try {
      await cdp.detach();
    } finally {
      expect((await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
    }
  }
});

test('profiles real large-directory navigation and sort while retaining bounded accessible rows', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  for (const count of [1000, 5000]) {
    const root = path.resolve(`.tmp/ssh-root/list-profile-${count}`);
    await mkdir(root, { recursive: true });
    // Bound local fixture creation instead of opening thousands of handles.
    for (let offset = 0; offset < count; offset += 32) {
      await Promise.all(
        Array.from({ length: Math.min(32, count - offset) }, (_, index) =>
          writeFile(path.join(root, `文件-${offset + index}.txt`), String(offset + index)),
        ),
      );
    }
  }
  await connectTestSshFromConnectionsPage(page, await ensureTestSshConnection(context.request));
  await openConnectedFileManager(page);
  const manager = page.getByRole('dialog', { name: 'File Manager', exact: true });
  const input = manager.locator('.file-manager-path-input input');
  const list = activeFileManagerList(page);
  const rows = list.locator('tbody tr[data-file-path]');
  const header = manager.getByRole('columnheader').filter({ hasText: 'Name' }).first();
  const samples = [];
  const directoryDelayMs = process.env.NEXUS_E2E_DIRECTORY_OPEN_DELAY === '1' ? 60 : 0;
  const delayResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=${directoryDelayMs}`, {
    method: 'POST',
  });
  expect(delayResponse.ok).toBe(true);
  try {
    for (const count of [1000, 5000]) {
      for (let sample = 0; sample < 3; sample++) {
        await input.fill(`/list-profile-${count}`);
        const start = performance.now();
        await input.press('Enter');
        await expect(rows.first()).toHaveAttribute('data-file-path', `/list-profile-${count}/文件-0.txt`);
        const navigationMs = performance.now() - start;
        const renderedRows = await rows.count();
        expect(renderedRows).toBeLessThan(200);
        const sortMs = await manager.evaluate(async (element, count) => {
          const header = [...element.querySelectorAll('th')].find((item) => item.textContent?.includes('Name'))!;
          const button = header.querySelector('button')!;
          const start = performance.now();
          await new Promise<void>((resolve) => {
            const observer = new MutationObserver(() => {
              const first = element.querySelector('tbody tr[data-file-path]');
              if (first?.getAttribute('data-filename') !== `文件-${count - 1}.txt`) return;
              observer.disconnect();
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            });
            observer.observe(element, { childList: true, subtree: true, attributes: true });
            button.click();
          });
          return performance.now() - start;
        }, count);
        await expect(rows.first()).toHaveAttribute('data-filename', `文件-${count - 1}.txt`);
        await header.locator('button').click();
        await expect(rows.first()).toHaveAttribute('data-filename', '文件-0.txt');
        await list.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(rows.filter({ has: page.getByText(`文件-${count - 1}.txt`, { exact: true }) })).toBeVisible();
        expect(await rows.count()).toBeLessThan(200);
        samples.push({ directoryDelayMs, count, sample, navigationMs, sortMs, renderedRows });
        // Leave the directory to force the next sample through a real list request.
        await input.fill('/');
        await input.press('Enter');
        await expect(input).toHaveValue('/');
        await expect(list.locator('tr[data-filename="seed.txt"]')).toBeVisible();
      }
    }
    console.log('[file-list end-to-end profile]', JSON.stringify(samples));
    const metricsResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay`);
    expect(metricsResponse.ok).toBe(true);
    const metrics = await metricsResponse.json();
    expect(metrics.sftpDelayedDirectoryOpens).toBe(directoryDelayMs ? 12 : 0);
    console.log('[directory open delay profile]', JSON.stringify(metrics));
  } finally {
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/readdir-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
  }
});
