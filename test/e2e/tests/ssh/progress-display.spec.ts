import { expect, test, type BrowserContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
const menu = (page: Page): Locator => page.getByTestId('file-manager-context-menu');

async function openFileManager(page: Page, context: BrowserContext): Promise<void> {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
}

async function rightClickRow(page: Page, filename: string): Promise<void> {
  const target = row(page, filename);
  await expect(target).toBeVisible();
  await target.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}

async function clickMenuItem(page: Page, label: string): Promise<void> {
  await menu(page).getByText(label, { exact: true }).first().click();
}

async function openCurrentDirectoryContextMenu(page: Page): Promise<void> {
  await activeFileManagerList(page).dispatchEvent('contextmenu', { clientX: 120, clientY: 120 });
  await expect(menu(page)).toBeVisible();
}

async function goIntoFolder(page: Page, folder: string): Promise<void> {
  await row(page, folder).click();
  await expect(row(page, '..')).toBeVisible();
}

async function goToParent(page: Page): Promise<void> {
  await row(page, '..').click();
  await expect(row(page, 'seed.txt')).toBeVisible();
}

async function refreshFileManager(page: Page): Promise<void> {
  await rightClickRow(page, 'seed.txt');
  await clickMenuItem(page, 'Refresh');
}

async function dragLocalFile(page: Page, name: string, size: number, fill: number): Promise<void> {
  const dataTransfer = await page.evaluateHandle(({ fileName, fileSize, fillByte }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(fileSize).fill(fillByte)], fileName, {
      type: 'application/octet-stream',
    }));
    return transfer;
  }, { fileName: name, fileSize: size, fillByte: fill });

  try {
    const list = activeFileManagerList(page);
    await list.dispatchEvent('dragenter', { dataTransfer });
    const overlay = page.getByTestId('file-upload-drop-overlay');
    await expect(overlay).toBeVisible();
    await overlay.dispatchEvent('drop', { dataTransfer });
    await expect(overlay).toBeHidden();
  } finally {
    await dataTransfer.dispose();
  }
}

async function openProgressDisplay(page: Page): Promise<Locator> {
  await page.getByTestId('transfer-progress-toggle').click();
  const modal = page.getByTestId('progress-display-modal');
  await expect(modal).toBeVisible();
  return modal;
}

function hiddenTask(modal: Locator, text: string): Locator {
  return modal.getByTestId('hidden-progress-task').filter({ hasText: text });
}

async function closeProgressDisplay(modal: Locator): Promise<void> {
  await modal.getByTestId('progress-display-close').click();
  await expect(modal).toBeHidden();
}

async function remoteFileExists(name: string): Promise<boolean> {
  const response = await fetch(`${E2E_SSH.controlUrl}/files`);
  if (!response.ok) return false;
  const body = await response.json() as { files: string[] };
  return body.files.includes(name);
}

test('registered upload progress can hide, restore, and cancel from Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);
  const filename = 'progress-center-upload.bin';
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=220`, { method: 'POST' });

  try {
    await slowStep('upload starts in a floating window and Hide removes the whole window', async () => {
      await dragLocalFile(page, filename, 12 * 1024 * 1024, 0x51);
      const popup = page.getByTestId('file-upload-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup).toContainText(filename);
      await expect(popup.locator('h4')).toContainText('·');
      await popup.getByTestId('file-upload-progress-hide').click();
      await expect(popup).toBeHidden();
    });

    await step('Progress Display lists the hidden task with session name and Restore returns the window', async () => {
      const modal = await openProgressDisplay(page);
      const task = hiddenTask(modal, filename);
      await expect(task).toBeVisible();
      await expect(task).toContainText('Upload');
      await expect(task.locator('[data-progress-session]')).not.toHaveText('');
      await expect(task.getByTestId('hidden-progress-restore')).toBeEnabled();
      await expect(task.getByTestId('hidden-progress-cancel')).toBeEnabled();

      await task.getByTestId('hidden-progress-restore').click();
      const popup = page.getByTestId('file-upload-progress-popup');
      await expect(modal).toBeHidden();
      await expect(popup).toBeVisible();

      await popup.getByTestId('file-upload-progress-hide').click();
      await expect(popup).toBeHidden();
      const reopenedModal = await openProgressDisplay(page);
      await expect(hiddenTask(reopenedModal, filename)).toBeVisible();
    });

    await slowStep('Cancel invokes the upload provider cancel callback and removes the hidden task', async () => {
      const modal = page.getByTestId('progress-display-modal');
      const task = hiddenTask(modal, filename);
      await task.getByTestId('hidden-progress-cancel').click();
      await expect(task).toBeHidden({ timeout: 10_000 });
      await expect(page.getByTestId('file-upload-progress-popup')).toBeHidden();
      await expect(modal.getByTestId('progress-display-empty')).toBeVisible();

      await page.waitForTimeout(1_000);
      await expect.poll(() => remoteFileExists(filename), { timeout: 10_000 }).toBe(false);
      await closeProgressDisplay(modal);
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('registered copy progress hides and cancels through the shared Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);
  const sourceName = 'progress-center-copy.bin';
  await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(sourceName)}&size=${10 * 1024 * 1024}`, { method: 'POST' });
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

      const popup = page.getByTestId('file-transfer-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup).toContainText(sourceName);
      await popup.getByTestId('file-transfer-progress-hide').click();
      await expect(popup).toBeHidden();
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

      await goToParent(page);
      await expect(row(page, sourceName)).toBeVisible();
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('registered archive progress supports hide, restore, and real cancel for compress and decompress', async ({ page, context }) => {
  await openFileManager(page, context);

  try {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=4500`, { method: 'POST' });
    await slowStep('compress task can hide, restore, hide again, and cancel from the shared list', async () => {
      await rightClickRow(page, 'archive-source.txt');
      const compress = menu(page).locator('li').filter({ hasText: /^Compress/ }).first();
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
      await task.getByTestId('hidden-progress-restore').click();
      await expect(modal).toBeHidden();
      await expect(popup).toBeVisible();
      await popup.getByTestId('archive-progress-hide').click();
      const reopenedModal = await openProgressDisplay(page);
      task = hiddenTask(reopenedModal, 'archive-source.zip');
      await expect(task).toBeVisible();
      await task.getByTestId('hidden-progress-cancel').click();
      await expect(task).toBeHidden({ timeout: 10_000 });
      await closeProgressDisplay(reopenedModal);
      await expect(row(page, 'archive-source.zip')).toHaveCount(0);
    });

    await step('create a normal ZIP fixture for the decompression cancellation path', async () => {
      await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
      await rightClickRow(page, 'archive-source.txt');
      const compress = menu(page).locator('li').filter({ hasText: /^Compress/ }).first();
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
    await slowStep('decompress task registers a real cancel callback and does not extract after cancellation', async () => {
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

      await page.waitForTimeout(800);
      await expect(row(page, 'archive-source.txt')).toHaveCount(0);
    });

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
