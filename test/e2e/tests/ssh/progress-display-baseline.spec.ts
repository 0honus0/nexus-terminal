import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
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

async function refreshFileManager(page: Page): Promise<void> {
  await rightClickRow(page, 'seed.txt');
  await clickMenuItem(page, 'Refresh');
}

async function openProgressDisplayAndRestoreBody(page: Page, body: Locator): Promise<void> {
  const progressDisplay = page.getByTestId('transfer-progress-toggle');
  await expect(progressDisplay).toHaveAttribute('title', 'Progress Display');
  await progressDisplay.click();
  await expect(body).toBeVisible();

  const legacyPanel = page.locator('.transfer-progress-panel');
  await expect(legacyPanel).toBeVisible();
  await legacyPanel.getByRole('button', { name: 'Close' }).click();
  await expect(legacyPanel).toBeHidden();
}

test('existing copy progress popup minimizes and restores through the global progress button', async ({ page, context }) => {
  await openFileManager(page, context);

  const sourceName = 'baseline-copy-progress.bin';
  await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(sourceName)}&size=${4 * 1024 * 1024}`, { method: 'POST' });
  await refreshFileManager(page);
  await expect(row(page, sourceName)).toBeVisible();

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=80`, { method: 'POST' });
  try {
    await slowStep('copy creates the existing floating progress popup', async () => {
      await rightClickRow(page, sourceName);
      await clickMenuItem(page, 'Copy');
      await goIntoFolder(page, 'folder-seed');
      await openCurrentDirectoryContextMenu(page);
      await clickMenuItem(page, 'Paste');

      const popup = page.getByTestId('file-transfer-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup.locator('h4')).toContainText('·');
      await expect(popup).toContainText(sourceName);
    });

    await step('minimize hides the popup body and the global button restores it', async () => {
      const popup = page.getByTestId('file-transfer-progress-popup');
      const body = popup.locator('ul');
      await expect(body).toBeVisible();
      await popup.getByTestId('file-transfer-progress-minimize').click();
      await expect(body).toBeHidden();
      await openProgressDisplayAndRestoreBody(page, body);
    });

    await expect(row(page, sourceName)).toBeVisible({ timeout: 30_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('existing archive progress popup minimizes and restores through the global progress button', async ({ page, context }) => {
  await openFileManager(page, context);
  await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=1800`, { method: 'POST' });

  try {
    await slowStep('compress creates the existing archive progress popup', async () => {
      await rightClickRow(page, 'archive-source.txt');
      const compress = menu(page).locator('li').filter({ hasText: /^Compress/ }).first();
      await expect(compress).toBeVisible();
      await compress.hover();
      await page.getByText('Compress to zip', { exact: true }).click();

      const popup = page.getByTestId('archive-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup).toContainText('archive-source.zip');
    });

    await step('minimize hides the archive body and the global button restores it', async () => {
      const popup = page.getByTestId('archive-progress-popup');
      const body = popup.locator('.archive-progress-body');
      await expect(body).toBeVisible();
      await popup.getByTestId('archive-progress-minimize').click();
      await expect(body).toBeHidden();
      await openProgressDisplayAndRestoreBody(page, body);
    });

    await expect(row(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/archive/exec-delay?ms=0`, { method: 'POST' });
  }
});
