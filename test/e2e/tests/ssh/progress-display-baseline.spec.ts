import { expect, test, type BrowserContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  closeConnectedFileManager,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  openInlineProgressDisplay,
  reopenConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';
import { hideVisibleProgressCenter, visibleProgressCenter, visibleProgressTask } from './progress-display.helpers';

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
  const target = row(page, folder);
  const targetPath = await target.getAttribute('data-file-path');
  expect(targetPath).toBeTruthy();
  await target.click();
  await expect(page.getByTestId('file-manager-modal').getByTestId('file-manager-path-input')).toHaveValue(targetPath!);
}

async function refreshFileManager(page: Page): Promise<void> {
  await openCurrentDirectoryContextMenu(page);
  await clickMenuItem(page, 'Refresh');
}

async function openProgressDisplayAndRestorePopup(page: Page, popup: Locator, taskText: string): Promise<void> {
  const modal = await openInlineProgressDisplay(page);
  const source = modal.getByTestId('hidden-progress-source').filter({ hasText: taskText });
  const task = source.getByTestId('hidden-progress-task').filter({ hasText: taskText });
  await expect(source).toBeVisible();
  await expect(task).toBeVisible();
  await expect(task.getByTestId('hidden-progress-bar')).toBeVisible();
  await source.getByTestId('hidden-progress-restore').click();
  await expect(modal).toBeHidden();
  await reopenConnectedFileManager(page);
  await expect(popup).toBeVisible();
}

async function expectPopupBelowApplicationModals(popup: Locator): Promise<void> {
  await expect
    .poll(() =>
      popup.evaluate((element) => {
        const zIndex = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
        return Number.isFinite(zIndex) ? zIndex : 0;
      }),
    )
    .toBeLessThan(50);
}

test('existing copy progress popup hides and restores through Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);

  const sourceName = 'baseline-copy-progress.bin';
  await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(sourceName)}&size=${4 * 1024 * 1024}`, {
    method: 'POST',
  });
  await refreshFileManager(page);
  await expect(row(page, sourceName)).toBeVisible();

  // Keep at least one SFTP WRITE round-trip alive while the popup is hidden and
  // Progress Display is opened. A tiny delay is ineffective when writes are
  // pipelined and made this assertion depend on runner timing.
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=3000`, { method: 'POST' });
  try {
    await slowStep('copy creates the existing floating progress popup', async () => {
      await rightClickRow(page, sourceName);
      await clickMenuItem(page, 'Copy');
      await goIntoFolder(page, 'folder-seed');
      await openCurrentDirectoryContextMenu(page);
      await clickMenuItem(page, 'Paste');

      const center = visibleProgressCenter(page);
      await expect(center).toBeVisible({ timeout: 10_000 });
      const task = visibleProgressTask(page, sourceName);
      await expect(task).toContainText('Copy');
      await expectPopupBelowApplicationModals(center);
    });

    await step('the minimize-style action hides the popup and Progress Display restores it', async () => {
      const center = visibleProgressCenter(page);
      await expect(center.getByTestId('transfer-progress-task')).toBeVisible();
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
      await openProgressDisplayAndRestorePopup(page, center, sourceName);
    });

    await expect(row(page, sourceName)).toBeVisible({ timeout: 30_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('existing archive progress popup hides and restores through Progress Display', async ({ page, context }) => {
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=1800`, { method: 'POST' });

  try {
    await slowStep('compress creates the existing archive progress popup', async () => {
      await rightClickRow(page, 'archive-source.txt');
      const compress = menu(page).getByRole('button', { name: 'Compress', exact: true });
      await expect(compress).toBeVisible();
      await compress.hover();
      await page
        .getByTestId('file-manager-context-submenu')
        .getByRole('button', { name: 'Compress to zip', exact: true })
        .click();

      const center = visibleProgressCenter(page);
      await expect(center).toBeVisible({ timeout: 10_000 });
      await expect(visibleProgressTask(page, 'archive-source.zip')).toContainText('Compress');
      await expectPopupBelowApplicationModals(center);
    });

    await step('the minimize-style action hides the archive popup and Progress Display restores it', async () => {
      const center = visibleProgressCenter(page);
      await expect(visibleProgressTask(page, 'archive-source.zip')).toBeVisible();
      await closeConnectedFileManager(page);
      await hideVisibleProgressCenter(page);
      await openProgressDisplayAndRestorePopup(page, center, 'archive-source.zip');
    });

    await expect(row(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});
