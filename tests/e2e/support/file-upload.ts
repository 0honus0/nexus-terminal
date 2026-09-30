import { expect, type BrowserContext, type Page } from '@playwright/test';
import { loginAsInitialAdmin } from './auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from './ssh';

export interface DragFileDescriptor {
  name: string;
  text?: string;
  size?: number;
  fill?: number;
}

export async function openFileManager(page: Page, context: BrowserContext): Promise<void> {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
}

export async function dragLocalFiles(page: Page, files: DragFileDescriptor[]): Promise<void> {
  const dataTransfer = await page.evaluateHandle((descriptors: DragFileDescriptor[]) => {
    const transfer = new DataTransfer();
    for (const descriptor of descriptors) {
      const content =
        descriptor.text !== undefined
          ? new TextEncoder().encode(descriptor.text)
          : new Uint8Array(descriptor.size ?? 0).fill(descriptor.fill ?? 0x61);
      transfer.items.add(new File([content], descriptor.name, { type: 'application/octet-stream' }));
    }
    return transfer;
  }, files);

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

export function uploadProgressTask(page: Page, name?: string) {
  const progressCenter = page.locator('.transfer-progress-window:visible').first();
  const tasks = progressCenter.locator('[data-task-kind="upload"]');
  return name ? tasks.filter({ hasText: name }).first() : tasks.first();
}
