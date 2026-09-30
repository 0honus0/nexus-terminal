import { expect, type BrowserContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  openDesktopProgressDisplay,
  resetTestSshFilesystem,
} from '../../support/ssh';

export const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
export const menu = (page: Page): Locator => page.getByRole('menu');
export const visibleProgressCenter = (page: Page): Locator => page.locator('.transfer-progress-window:visible').first();
export const visibleProgressTask = (page: Page, text: string): Locator =>
  visibleProgressCenter(page).locator('[data-task-id]').filter({ hasText: text }).first();

export async function hideVisibleProgressCenter(page: Page): Promise<void> {
  const center = visibleProgressCenter(page);
  await expect(center).toBeVisible();
  await center.getByRole('button', { name: 'Hide progress', exact: true }).click();
  await expect(center).toBeHidden();
}

export async function openFileManager(page: Page, context: BrowserContext): Promise<void> {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
}

export async function rightClickRow(page: Page, filename: string): Promise<void> {
  const target = row(page, filename);
  await expect(target).toBeVisible();
  await target.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
}

export async function startZipCompression(page: Page, filename: string): Promise<void> {
  await rightClickRow(page, filename);
  const compress = menu(page).getByRole('button', { name: 'Compress', exact: true });
  await expect(compress).toBeVisible();
  await compress.hover();
  await page.getByRole('menu').getByRole('button', { name: 'Compress to zip', exact: true }).click();
}

export async function clickMenuItem(page: Page, label: string): Promise<void> {
  await menu(page).getByText(label, { exact: true }).first().click();
}

export async function openCurrentDirectoryContextMenu(page: Page): Promise<void> {
  await activeFileManagerList(page).dispatchEvent('contextmenu', { clientX: 120, clientY: 120 });
  await expect(menu(page)).toBeVisible();
}

export async function goIntoFolder(page: Page, folder: string): Promise<void> {
  const target = row(page, folder);
  const targetPath = await target.getAttribute('data-file-path');
  expect(targetPath).toBeTruthy();
  await target.click();
  await expect(
    page.getByRole('dialog', { name: 'File Manager', exact: true }).locator('.file-manager-path-input input'),
  ).toHaveValue(targetPath!);
}

export async function goToParent(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'File Manager', exact: true }).locator('[data-file-parent]').click();
  await expect(row(page, 'seed.txt')).toBeVisible();
}

export async function refreshFileManager(page: Page): Promise<void> {
  const modal = page.getByRole('dialog', { name: 'File Manager', exact: true });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(activeFileManagerList(page)).toBeVisible();
}

export async function dragLocalFile(page: Page, name: string, size: number, fill: number): Promise<void> {
  const dataTransfer = await page.evaluateHandle(
    ({ fileName, fileSize, fillByte }) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(fileSize).fill(fillByte)], fileName, {
          type: 'application/octet-stream',
        }),
      );
      return transfer;
    },
    { fileName: name, fileSize: size, fillByte: fill },
  );

  try {
    const list = activeFileManagerList(page);
    await list.dispatchEvent('dragenter', { dataTransfer });
    const overlay = page.getByText('Drop files here to upload', { exact: true });
    await expect(overlay).toBeVisible();
    await overlay.dispatchEvent('drop', { dataTransfer });
    await expect(overlay).toBeHidden();
  } finally {
    await dataTransfer.dispose();
  }
}

export async function openProgressDisplay(page: Page): Promise<Locator> {
  return openDesktopProgressDisplay(page);
}

export function hiddenSource(modal: Locator, text: string): Locator {
  return modal.locator('.hidden-progress-source-card').filter({ hasText: text });
}

export function hiddenTask(modal: Locator, text: string): Locator {
  return modal.locator('.hidden-progress-task-row').filter({ hasText: text });
}

export async function closeProgressDisplay(modal: Locator): Promise<void> {
  await modal.getByRole('button', { name: 'Hide progress', exact: true }).click();
  await expect(modal).toBeHidden();
}
