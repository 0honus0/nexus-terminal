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
