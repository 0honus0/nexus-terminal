import { expect, type BrowserContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  openInlineProgressDisplay,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';

export const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
export const menu = (page: Page): Locator => page.getByTestId('file-manager-context-menu');

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

export async function clickMenuItem(page: Page, label: string): Promise<void> {
  await menu(page).getByText(label, { exact: true }).first().click();
}

export async function openCurrentDirectoryContextMenu(page: Page): Promise<void> {
  await activeFileManagerList(page).dispatchEvent('contextmenu', { clientX: 120, clientY: 120 });
  await expect(menu(page)).toBeVisible();
}

export async function goIntoFolder(page: Page, folder: string): Promise<void> {
  await row(page, folder).click();
  await expect(row(page, '..')).toBeVisible();
}

export async function goToParent(page: Page): Promise<void> {
  await row(page, '..').click();
  await expect(row(page, 'seed.txt')).toBeVisible();
}

export async function refreshFileManager(page: Page): Promise<void> {
  await rightClickRow(page, 'seed.txt');
  await clickMenuItem(page, 'Refresh');
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
    const overlay = page.getByTestId('file-upload-drop-overlay');
    await expect(overlay).toBeVisible();
    await overlay.dispatchEvent('drop', { dataTransfer });
    await expect(overlay).toBeHidden();
  } finally {
    await dataTransfer.dispose();
  }
}

export async function openProgressDisplay(page: Page): Promise<Locator> {
  return openInlineProgressDisplay(page);
}

export function hiddenSource(modal: Locator, text: string): Locator {
  return modal.getByTestId('hidden-progress-source').filter({ hasText: text });
}

export function hiddenTask(modal: Locator, text: string): Locator {
  return modal.getByTestId('hidden-progress-task').filter({ hasText: text });
}

export async function closeProgressDisplay(modal: Locator): Promise<void> {
  await modal.getByTestId('progress-display-close').click();
  await expect(modal).toBeHidden();
}

export async function remoteFileExists(name: string): Promise<boolean> {
  const response = await fetch(`${E2E_SSH.controlUrl}/files`);
  if (!response.ok) return false;
  const body = (await response.json()) as { files: string[] };
  return body.files.includes(name);
}
