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
      await center.evaluate((element) => {
        // Deliberately translucent theme colors must not leak the terminal through
        // either the progress body or its header.
        (element as HTMLElement).style.setProperty('--card-bg-color', 'rgb(20 30 40 / 0.2)');
        (element as HTMLElement).style.setProperty('--header-bg-color', 'rgb(40 50 60 / 0.3)');
      });
      const fills = await center.evaluate((element) =>
        [element, element.querySelector('.transfer-progress-header')!].map((surface) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          context.fillStyle = getComputedStyle(surface).backgroundColor;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        }),
      );
      expect(fills).toEqual([
        [20, 30, 40, 255],
        [40, 50, 60, 255],
      ]);
      await center.evaluate((element) => {
        (element as HTMLElement).style.removeProperty('--card-bg-color');
        (element as HTMLElement).style.removeProperty('--header-bg-color');
      });
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
    });

    await step('the small hidden-progress button itself drags freely and remembers its position', async () => {
      const button = page.getByRole('button', { name: /^Progress Display \(/ });
      await expect(button).toBeVisible();
      const before = await button.boundingBox();
      expect(before).toBeTruthy();

      await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
      await page.mouse.down();
      await page.mouse.move(before!.x + before!.width / 2 - 650, before!.y + before!.height / 2 - 180, { steps: 10 });
      await page.mouse.up();

      const moved = await button.boundingBox();
      expect(moved).toBeTruthy();
      expect(Math.abs(moved!.x - before!.x)).toBeGreaterThan(180);
      expect(Math.abs(moved!.y - before!.y)).toBeGreaterThan(120);
      await expect(visibleProgressCenter(page)).toBeHidden();
      await page.screenshot({ path: '.tmp/progress-display-small-button-moved.png', fullPage: true });

      await button.click();
      await expect(visibleProgressCenter(page)).toBeVisible();
      await hideVisibleProgressCenter(page);
      const restored = await button.boundingBox();
      expect(restored).toBeTruthy();
      expect(Math.abs(restored!.x - moved!.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(restored!.y - moved!.y)).toBeLessThanOrEqual(2);
    });

    await step(
      'Progress Display lists a compact hidden task with progress and Restore returns the window',
      async () => {
        const modal = await openProgressDisplay(page);
        const task = hiddenTask(modal, filename);
        await expect(task).toBeVisible();
        await expect(task).toContainText('Upload');
        await expect(task.getByRole('progressbar')).toBeVisible();
        const percent = task.getByRole('progressbar').locator('..').locator('span');
        await expect(percent).toBeVisible();
        await expect.poll(async () => (await percent.innerText()).trim()).toMatch(/^\d+\.\d%$/);
        await expect(task.locator('[data-progress-session]')).toHaveCount(0);
        const source = hiddenSource(modal, filename);
        await expect(source).toBeVisible();
        await expect(source.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
        await expect(task.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();

        await source.getByRole('button', { name: 'Restore', exact: true }).click();
        await expect(modal).toBeHidden();
        await expect(visibleProgressCenter(page)).toBeVisible();
        await hideVisibleProgressCenter(page);
        await reopenConnectedFileManager(page);

        await closeConnectedFileManager(page);
        const reopenedModal = await openProgressDisplay(page);
        await expect(hiddenTask(reopenedModal, filename)).toBeVisible();
      },
    );

    await slowStep('Cancel invokes the upload provider cancel callback and removes the hidden task', async () => {
      const modal = page.getByRole('dialog', { name: 'Progress Display', exact: true });
      const task = hiddenTask(modal, filename);
      await task.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(task).toBeHidden({ timeout: 10_000 });
      await expect(page.locator('.transfer-progress-window')).toBeHidden();
      await expect(modal.getByText('There are no hidden progress tasks.', { exact: true })).toBeVisible();

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
      await expect(task.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
      await task.getByRole('button', { name: 'Cancel', exact: true }).click();
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

test('completed upload row has no per-item hide placeholder before automatic cleanup', async ({ page, context }) => {
  await openFileManager(page, context);
  const filename = 'progress-completed-row.bin';
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=60`, { method: 'POST' });

  try {
    await dragLocalFile(page, filename, 1024 * 1024, 0x4d);
    const center = visibleProgressCenter(page);
    const task = visibleProgressTask(page, filename);
    await expect(center).toBeVisible({ timeout: 10_000 });
    await expect(task).toHaveAttribute('data-task-status', 'completed', { timeout: 15_000 });
    await expect(task).not.toContainText('—');
    await expect(center).toBeHidden({ timeout: 4_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('successful hidden upload auto-cleans its completed task from Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);
  const filename = 'progress-auto-clean-upload.bin';
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=80`, { method: 'POST' });

  try {
    await dragLocalFile(page, filename, 2 * 1024 * 1024, 0x5a);
    const center = visibleProgressCenter(page);
    await expect(center).toBeVisible({ timeout: 10_000 });
    await hideVisibleProgressCenter(page);

    const display = await openProgressDisplay(page);
    const hidden = hiddenTask(display, filename);
    await expect(hidden).toBeVisible();
    await expect(hidden).toContainText('Completed', { timeout: 15_000 });
    await expect(hidden).toBeHidden({ timeout: 4_000 });
    await expect(display.getByText('There are no hidden progress tasks.', { exact: true })).toBeVisible();

    await closeProgressDisplay(display);
    await reopenConnectedFileManager(page);
    await refreshFileManager(page);
    await expect(row(page, filename)).toBeVisible({ timeout: 10_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('successful pasted copy auto-cleans its completed task and closes the floating progress window', async ({
  page,
  context,
}) => {
  await openFileManager(page, context);
  const sourceName = 'progress-auto-clean-copy.bin';
  const fixture = await fetch(
    `${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(sourceName)}&size=${6 * 1024 * 1024}`,
    { method: 'POST' },
  );
  expect(fixture.ok).toBeTruthy();
  await refreshFileManager(page);
  await expect(row(page, sourceName)).toBeVisible();
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=120`, { method: 'POST' });

  try {
    await rightClickRow(page, sourceName);
    await clickMenuItem(page, 'Copy');
    await goIntoFolder(page, 'folder-seed');
    await openCurrentDirectoryContextMenu(page);
    await clickMenuItem(page, 'Paste');

    const center = visibleProgressCenter(page);
    const task = visibleProgressTask(page, sourceName);
    await expect(center).toBeVisible({ timeout: 10_000 });
    await expect(task).toHaveAttribute('data-task-status', 'completed', { timeout: 20_000 });
    await expect(center).toBeHidden({ timeout: 4_000 });

    await refreshFileManager(page);
    await expect(row(page, sourceName)).toBeVisible({ timeout: 10_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
