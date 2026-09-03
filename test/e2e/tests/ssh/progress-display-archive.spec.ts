import { expect, test } from '../../support/fixtures';
import {
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
  menu,
  openFileManager,
  openProgressDisplay,
  refreshFileManager,
  rightClickRow,
  row,
} from './progress-display.helpers';

test('registered archive progress supports hide, restore, and real cancel for compress and decompress', async ({
  page,
  context,
}) => {
  await openFileManager(page, context);

  try {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=4500`, { method: 'POST' });
    await slowStep('compress task can hide, restore, hide again, and cancel from the shared list', async () => {
      await rightClickRow(page, 'archive-source.txt');
      const compress = menu(page)
        .locator('li')
        .filter({ hasText: /^Compress/ })
        .first();
      await expect(compress).toBeVisible();
      await compress.hover();
      await page.getByText('Compress to zip', { exact: true }).click();

      const popup = page.getByTestId('archive-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await popup.getByTestId('archive-progress-hide').click();
      await expect(popup).toBeHidden();

      const modal = await openProgressDisplay(page);
      let task = hiddenTask(modal, 'archive-source.zip');
      await expect(task).toContainText('Compress');
      await hiddenSource(modal, 'archive-source.zip').getByTestId('hidden-progress-restore').click();
      await expect(modal).toBeHidden();
      await reopenConnectedFileManager(page);
      await expect(popup).toBeVisible();
      await popup.getByTestId('archive-progress-hide').click();
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
      await rightClickRow(page, 'archive-source.txt');
      const compress = menu(page)
        .locator('li')
        .filter({ hasText: /^Compress/ })
        .first();
      await compress.hover();
      await page.getByText('Compress to zip', { exact: true }).click();
      await expect(row(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });

      await rightClickRow(page, 'archive-source.txt');
      await clickMenuItem(page, 'Delete');
      const actionModal = page.getByTestId('file-manager-action-modal');
      await actionModal.getByTestId('file-manager-action-confirm').click();
      await expect(row(page, 'archive-source.txt')).toHaveCount(0);
    });

    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=1`, { method: 'POST' });
    await slowStep(
      'decompress task registers a real cancel callback and does not extract after cancellation',
      async () => {
        await rightClickRow(page, 'archive-source.zip');
        await clickMenuItem(page, 'Decompress');
        const popup = page.getByTestId('archive-progress-popup');
        await expect(popup).toBeVisible({ timeout: 10_000 });
        await popup.getByTestId('archive-progress-hide').click();
        await expect(popup).toBeHidden();

        const modal = await openProgressDisplay(page);
        const task = hiddenTask(modal, 'archive-source.zip');
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

    await step('Progress Display reopens with no hidden provider tasks', async () => {
      const modal = await openProgressDisplay(page);
      await expect(modal.getByTestId('progress-display-empty')).toBeVisible();
      await closeProgressDisplay(modal);
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-hold?enabled=0`, { method: 'POST' });
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});

test('overlapping archive requests are rejected without retargeting the active task', async ({ page, context }) => {
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
    await slowStep('second archive request is rejected while the active task keeps ownership', async () => {
      await rightClickRow(page, 'archive-source.txt');
      let compress = menu(page)
        .locator('li')
        .filter({ hasText: /^Compress/ })
        .first();
      await compress.hover();
      await page.getByText('Compress to zip', { exact: true }).click();

      const popup = page.getByTestId('archive-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup).toContainText('archive-source.zip');

      await page.waitForTimeout(700);
      await rightClickRow(page, secondSource);
      compress = menu(page)
        .locator('li')
        .filter({ hasText: /^Compress/ })
        .first();
      await compress.hover();
      await page.getByText('Compress to zip', { exact: true }).click();

      // The active request remains the owner of the single archive progress state.
      await expect(popup).toBeVisible();
      await expect(popup).toContainText('archive-source.zip');
      await expect(page.getByText('Another archive operation is already running.', { exact: true })).toBeVisible();

      await expect(popup).toBeHidden({ timeout: 15_000 });
      await refreshFileManager(page);
      await expect(row(page, 'archive-source.zip')).toBeVisible();
      await expect(row(page, 'archive-second.zip')).toHaveCount(0);
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});

test('closing and reopening the file manager preserves an in-flight archive task', async ({ page, context }) => {
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=2500`, { method: 'POST' });

  try {
    await rightClickRow(page, 'archive-source.txt');
    const compress = menu(page)
      .locator('li')
      .filter({ hasText: /^Compress/ })
      .first();
    await compress.hover();
    await page.getByText('Compress to zip', { exact: true }).click();

    const popup = page.getByTestId('archive-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });

    const fileManagerModal = page.getByTestId('file-manager-modal');
    await fileManagerModal.locator(':scope > div > div').first().locator('button').last().click();
    await expect(fileManagerModal).toBeHidden();

    await page.getByTestId('open-file-manager-button').click();
    await expect(fileManagerModal).toBeVisible();
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('archive-source.zip');
    await expect(popup).toBeHidden({ timeout: 15_000 });
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
    const compress = menu(page)
      .locator('li')
      .filter({ hasText: /^Compress/ })
      .first();
    await compress.hover();
    await page.getByText('Compress to zip', { exact: true }).click();

    const popup = page.getByTestId('archive-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });

    // This closes the sidebar's v-if component, unlike the modal FileManager's v-show close.
    // Use the panel close control: the opened panel intentionally overlays its launcher.
    // The task was not manually hidden: provider detachment itself must surface it globally.
    await sidebar.locator('button[title="Close Sidebar"]').click();
    await expect(sidebarList).toHaveCount(0);

    const modal = await openProgressDisplay(page);
    const task = hiddenTask(modal, 'archive-source.zip');
    await expect(task).toBeVisible();
    await expect(task.getByTestId('hidden-progress-cancel')).toBeEnabled();
    await task.getByTestId('hidden-progress-cancel').click();
    await expect(task).toBeHidden({ timeout: 10_000 });
    await closeProgressDisplay(modal);
    await reopenConnectedFileManager(page);
    await refreshFileManager(page);
    await expect(row(page, 'archive-source.zip')).toHaveCount(0);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
    await context.request.put('/api/v1/settings/sidebar', { data: originalSidebar });
  }
});
