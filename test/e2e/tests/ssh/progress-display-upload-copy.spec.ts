import { expect, test } from '../../support/fixtures';
import { closeConnectedFileManager, reopenConnectedFileManager, E2E_SSH } from '../../support/ssh';
import { slowStep, step } from '../../support/steps';
import {
  closeProgressDisplay,
  dragLocalFile,
  goIntoFolder,
  goToParent,
  hiddenSource,
  hiddenTask,
  hideVisibleProgressCenter,
  openCurrentDirectoryContextMenu,
  openFileManager,
  openProgressDisplay,
  refreshFileManager,
  rightClickRow,
  row,
  menu,
  clickMenuItem,
  visibleProgressCenter,
  visibleProgressTask,
} from './progress-display.helpers';

test('registered upload progress can hide, restore, and cancel from Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);
  const filename = 'progress-center-upload.bin';
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=220`, { method: 'POST' });

  try {
    await slowStep('upload starts in a floating window and Hide removes the whole window', async () => {
      await dragLocalFile(page, filename, 12 * 1024 * 1024, 0x51);
      const center = visibleProgressCenter(page);
      await expect(center).toBeVisible({ timeout: 10_000 });
      await expect(center).toContainText(filename);
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
    });

    await step(
      'Progress Display lists a compact hidden task with progress and Restore returns the window',
      async () => {
        const modal = await openProgressDisplay(page);
        const task = hiddenTask(modal, filename);
        await expect(task).toBeVisible();
        await expect(task).toContainText('Upload');
        await expect(task.getByRole('progressbar')).toBeVisible();
        await expect(task.getByTestId('hidden-progress-percent')).toBeVisible();
        await expect(task.locator('[data-progress-session]')).toHaveCount(0);
        const source = hiddenSource(modal, filename);
        await expect(source).toBeVisible();
        await expect(source.getByTestId('hidden-progress-restore')).toBeEnabled();
        await expect(task.getByTestId('hidden-progress-cancel')).toBeEnabled();

        await source.getByTestId('hidden-progress-restore').click();
        await expect(modal).toBeHidden();
        await reopenConnectedFileManager(page);
        await expect(visibleProgressCenter(page)).toBeVisible();

        await closeConnectedFileManager(page);
        await hideVisibleProgressCenter(page);
        const reopenedModal = await openProgressDisplay(page);
        await expect(hiddenTask(reopenedModal, filename)).toBeVisible();
      },
    );

    await slowStep('Cancel invokes the upload provider cancel callback and removes the hidden task', async () => {
      const modal = page.getByTestId('progress-display-modal');
      const task = hiddenTask(modal, filename);
      await task.getByTestId('hidden-progress-cancel').click();
      await expect(task).toBeHidden({ timeout: 10_000 });
      await expect(page.getByTestId('transfer-progress-center')).toBeHidden();
      await expect(modal.getByTestId('progress-display-empty')).toBeVisible();

      await closeProgressDisplay(modal);
      await reopenConnectedFileManager(page);
      await refreshFileManager(page);
      await expect(row(page, filename)).toHaveCount(0);
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('registered copy progress hides and cancels through the shared Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);
  const sourceName = 'progress-center-copy.bin';
  await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(sourceName)}&size=${10 * 1024 * 1024}`, {
    method: 'POST',
  });
  await refreshFileManager(page);
  await expect(row(page, sourceName)).toBeVisible();
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=160`, { method: 'POST' });

  try {
    await slowStep('copy provider publishes its task and can hide the floating window', async () => {
      await rightClickRow(page, sourceName);
      await clickMenuItem(page, 'Copy');
      await goIntoFolder(page, 'folder-seed');
      await openCurrentDirectoryContextMenu(page);
      await clickMenuItem(page, 'Paste');

      const center = visibleProgressCenter(page);
      await expect(center).toBeVisible({ timeout: 10_000 });
      await expect(visibleProgressTask(page, sourceName)).toContainText('Copy');
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
    });

    await slowStep('shared Cancel stops the copy provider without affecting the source file', async () => {
      const modal = await openProgressDisplay(page);
      const task = hiddenTask(modal, sourceName);
      await expect(task).toBeVisible();
      await expect(task).toContainText('Copy');
      await expect(task.getByTestId('hidden-progress-cancel')).toBeEnabled();
      await task.getByTestId('hidden-progress-cancel').click();
      await expect(task).toBeHidden({ timeout: 10_000 });
      await closeProgressDisplay(modal);
      await reopenConnectedFileManager(page);

      await goToParent(page);
      await expect(row(page, sourceName)).toBeVisible();
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
