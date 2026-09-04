import { expect, test } from '../../support/fixtures';
import {
  closeConnectedFileManager,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  reopenConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { loginAsInitialAdmin } from '../../support/auth';
import { slowStep, step } from '../../support/steps';
import {
  clickMenuItem,
  closeProgressDisplay,
  hiddenSource,
  hiddenTask,
  hideVisibleProgressCenter,
  menu,
  openFileManager,
  openProgressDisplay,
  refreshFileManager,
  rightClickRow,
  row,
  startZipCompression,
  visibleProgressCenter,
  visibleProgressTask,
} from './progress-display.helpers';

test('registered archive progress supports hide, restore, and real cancel for compress and decompress', async ({
  page,
  context,
}) => {
  await openFileManager(page, context);

  try {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=4500`, { method: 'POST' });
    await slowStep('compress task can hide, restore, hide again, and cancel from the shared list', async () => {
      await startZipCompression(page, 'archive-source.txt');

      const popup = visibleProgressCenter(page);
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(visibleProgressTask(page, 'archive-source.zip')).toHaveAttribute('data-task-kind', 'compress');
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);

      const modal = await openProgressDisplay(page);
      let task = hiddenTask(modal, 'archive-source.zip');
      await expect(task).toContainText('Compress');
      await hiddenSource(modal, 'archive-source.zip').getByTestId('hidden-progress-restore').click();
      await expect(modal).toBeHidden();
      await reopenConnectedFileManager(page);
      await expect(popup).toBeVisible();
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
      const reopenedModal = await openProgressDisplay(page);
      task = hiddenTask(reopenedModal, 'archive-source.zip');
      await expect(task).toBeVisible();
      await task.getByTestId('hidden-progress-cancel').click();
      await expect(task).toBeHidden({ timeout: 10_000 });
      await closeProgressDisplay(reopenedModal);
      await reopenConnectedFileManager(page);
      await expect(row(page, 'archive-source.zip')).toHaveCount(0);
    });

    await step('create a normal ZIP fixture for the decompression cancellation path', async () => {
      await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
      await startZipCompression(page, 'archive-source.txt');
      await expect(row(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });

      await rightClickRow(page, 'archive-source.txt');
      await clickMenuItem(page, 'Delete');
      const confirm = page.getByRole('dialog', { name: 'Please confirm' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
      await expect(row(page, 'archive-source.txt')).toHaveCount(0);
    });

    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=1`, { method: 'POST' });
    await slowStep(
      'decompress task registers a real cancel callback and does not extract after cancellation',
      async () => {
        await rightClickRow(page, 'archive-source.zip');
        await clickMenuItem(page, 'Decompress');
        const popup = visibleProgressCenter(page);
        await expect(popup).toBeVisible({ timeout: 10_000 });
        await expect(visibleProgressTask(page, 'archive-source.zip')).toHaveAttribute('data-task-kind', 'decompress');
        await closeConnectedFileManager(page);
        await hideVisibleProgressCenter(page);

        const modal = await openProgressDisplay(page);
        const task = hiddenTask(modal, 'archive-source.zip').filter({ hasText: 'Decompress' }).first();
        await expect(task).toContainText('Decompress');
        await expect(task.getByTestId('hidden-progress-cancel')).toBeEnabled();
        await task.getByTestId('hidden-progress-cancel').click();
        await expect(task).toBeHidden({ timeout: 10_000 });
        await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=0`, { method: 'POST' });
        await closeProgressDisplay(modal);
        await reopenConnectedFileManager(page);

        await page.waitForTimeout(800);
        await expect(row(page, 'archive-source.txt')).toHaveCount(0);
      },
    );

    await step('Progress Display keeps completed archive history while cancelled work stays removed', async () => {
      const modal = await openProgressDisplay(page);
      const completed = hiddenTask(modal, 'archive-source.zip').filter({ hasText: 'Compress' }).first();
      await expect(completed).toContainText('Completed');
      await expect(hiddenTask(modal, 'archive-source.zip').filter({ hasText: 'Decompress' })).toHaveCount(0);
      await closeProgressDisplay(modal);
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=0`, { method: 'POST' });
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});

test('overlapping archive requests keep independent task ownership', async ({ page, context }) => {
  await openFileManager(page, context);
  const secondSource = 'archive-second.txt';
  const fixture = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(secondSource)}&size=64`, {
    method: 'POST',
  });
  expect(fixture.ok).toBeTruthy();
  await refreshFileManager(page);
  await expect(row(page, secondSource)).toBeVisible();

  await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=2200`, { method: 'POST' });
  try {
    await slowStep('second archive request keeps separate task ownership', async () => {
      await startZipCompression(page, 'archive-source.txt');

      const popup = visibleProgressCenter(page);
      await expect(popup).toBeVisible({ timeout: 10_000 });
      const activeTask = visibleProgressTask(page, 'archive-source.zip');
      await expect(activeTask).toHaveAttribute('data-task-kind', 'compress');

      await page.waitForTimeout(700);
      await startZipCompression(page, secondSource);

      const secondTask = visibleProgressTask(page, 'archive-second.zip');
      await expect(popup).toBeVisible();
      await expect(activeTask).toHaveAttribute('data-task-kind', 'compress');
      await expect(secondTask).toHaveAttribute('data-task-kind', 'compress');
      await expect(activeTask).toContainText('archive-source.zip');
      await expect(secondTask).toContainText('archive-second.zip');

      await expect(activeTask).toHaveAttribute('data-task-status', 'completed', { timeout: 15_000 });
      await expect(secondTask).toHaveAttribute('data-task-status', 'completed', { timeout: 15_000 });
      await refreshFileManager(page);
      await expect(row(page, 'archive-source.zip')).toBeVisible();
      await expect(row(page, 'archive-second.zip')).toBeVisible();
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});

test('closing and reopening the file manager preserves an in-flight archive task', async ({ page, context }) => {
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=2500`, { method: 'POST' });

  try {
    await startZipCompression(page, 'archive-source.txt');

    const popup = visibleProgressCenter(page);
    const task = visibleProgressTask(page, 'archive-source.zip');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(task).toHaveAttribute('data-task-kind', 'compress');

    const fileManagerModal = page.getByTestId('file-manager-modal');
    await closeConnectedFileManager(page);
    await reopenConnectedFileManager(page);
    await expect(fileManagerModal).toBeVisible();
    await expect(popup).toBeVisible();
    await expect(task).toContainText('archive-source.zip');
    await expect(task).toHaveAttribute('data-task-status', 'completed', { timeout: 15_000 });
    await refreshFileManager(page);
    await expect(row(page, 'archive-source.zip')).toBeVisible();
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});

test('a sidebar FileManager can unmount without orphaning its hidden archive task', async ({ page, context }) => {
  test.setTimeout(60_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { showPopupFileManager: false } })).ok()).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  const originalSidebarResponse = await context.request.get('/api/v1/settings/sidebar');
  expect(originalSidebarResponse.ok()).toBeTruthy();
  const originalSidebar = (await originalSidebarResponse.json()) as { left: string[]; right: string[] };

  const sidebarResponse = await context.request.put('/api/v1/settings/sidebar', {
    data: { left: originalSidebar.left, right: ['fileManager'] },
  });
  expect(sidebarResponse.ok()).toBeTruthy();
  await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=3000`, { method: 'POST' });

  try {
    await connectTestSshFromConnectionsPage(page, connectionId);
    const sidebarToggle = page.getByTestId('sidebar-pane-fileManager');
    await sidebarToggle.click();
    const sidebar = page.getByTestId('right-sidebar-panel');
    const sidebarList = sidebar.getByTestId('file-manager-list');
    await expect(sidebarList).toBeVisible();
    const source = sidebarList.locator('tr[data-filename="archive-source.txt"]');
    await expect(source).toBeVisible({ timeout: 20_000 });

    await source.click({ button: 'right' });
    const compress = menu(page).getByRole('button', { name: 'Compress', exact: true });
    await compress.hover();
    await page
      .getByTestId('file-manager-context-submenu')
      .getByRole('button', { name: 'Compress to zip', exact: true })
      .click();

    const popup = visibleProgressCenter(page);
    const task = visibleProgressTask(page, 'archive-source.zip');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(task).toHaveAttribute('data-task-kind', 'compress');

    // FileManager presentation may unmount, but the session-owned transfer task remains in the shared ProgressCenter.
    await sidebarToggle.click();
    await expect(sidebarList).toBeHidden();
    await expect(popup).toBeVisible();
    await expect(task).toBeVisible();
    await task.getByTestId('transfer-progress-cancel').click();
    await expect(task).toHaveAttribute('data-task-status', 'cancelled', { timeout: 10_000 });
    await sidebarToggle.click();
    await expect(sidebarList).toBeVisible();
    await sidebar.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(sidebarList.locator('tr[data-filename="archive-source.zip"]')).toHaveCount(0);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
    await context.request.put('/api/v1/settings/sidebar', { data: originalSidebar });
  }
});
