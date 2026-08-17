import { expect, test, type BrowserContext, type Page } from '@playwright/test';
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

interface DragFileDescriptor {
  name: string;
  text?: string;
  size?: number;
  fill?: number;
}

async function openFileManager(page: Page, context: BrowserContext): Promise<void> {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
}

async function dragLocalFiles(page: Page, files: DragFileDescriptor[]): Promise<void> {
  const dataTransfer = await page.evaluateHandle((descriptors: DragFileDescriptor[]) => {
    const transfer = new DataTransfer();
    for (const descriptor of descriptors) {
      const content = descriptor.text !== undefined
        ? new TextEncoder().encode(descriptor.text)
        : new Uint8Array(descriptor.size ?? 0).fill(descriptor.fill ?? 0x61);
      transfer.items.add(new File([content], descriptor.name, { type: 'application/octet-stream' }));
    }
    return transfer;
  }, files);

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

async function readRemoteText(name: string): Promise<string> {
  const response = await fetch(`${E2E_SSH.controlUrl}/read?name=${encodeURIComponent(name)}`);
  expect(response.ok).toBeTruthy();
  const body = await response.json() as { base64: string };
  return Buffer.from(body.base64, 'base64').toString('utf8');
}

async function waitForRemoteFiles(names: string[], timeout = 45_000): Promise<void> {
  await expect.poll(async () => {
    const response = await fetch(`${E2E_SSH.controlUrl}/files`);
    if (!response.ok) return [];
    const body = await response.json() as { files: string[] };
    return names.filter(name => body.files.includes(name));
  }, { timeout }).toEqual(names);
}

test('Windows-style multi-file drag uploads every file and applies one conflict choice to the remaining batch', async ({ page, context }) => {
  await openFileManager(page, context);

  const firstSeed = 'seed-overwritten-by-multi-drag\n';
  const firstCopy = 'copy-overwritten-by-multi-drag\n';
  const freshNames = Array.from({ length: 8 }, (_, index) => `windows-drag-${index + 1}.txt`);
  const tenFiles: DragFileDescriptor[] = [
    { name: 'seed.txt', text: firstSeed },
    { name: 'copy-source.txt', text: firstCopy },
    ...freshNames.map((name, index) => ({ name, text: `windows-drag-body-${index + 1}\n` })),
  ];

  await slowStep('dragging ten Windows-style files snapshots and uploads all DataTransfer items', async () => {
    await dragLocalFiles(page, tenFiles);

    const conflictModal = page.getByTestId('upload-conflict-modal');
    await expect(conflictModal).toBeVisible({ timeout: 20_000 });
    await conflictModal.getByTestId('upload-conflict-apply-all').check();
    await conflictModal.getByTestId('upload-conflict-overwrite').click();
    await expect(conflictModal).toBeHidden();

    await waitForRemoteFiles(freshNames);
    await expect(fileManagerRow(page, freshNames.at(-1)!)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => readRemoteText('seed.txt')).toBe(firstSeed);
    await expect.poll(() => readRemoteText('copy-source.txt')).toBe(firstCopy);
  });

  await slowStep('skip plus apply-to-all aborts only later conflicting files while new files still upload', async () => {
    const skippedSeedBody = 'this-must-not-replace-seed\n';
    const skippedCopyBody = 'this-must-not-replace-copy\n';
    const nonConflictName = 'skip-policy-new-file.txt';

    await dragLocalFiles(page, [
      { name: 'seed.txt', text: skippedSeedBody },
      { name: 'copy-source.txt', text: skippedCopyBody },
      { name: nonConflictName, text: 'new-file-still-uploads\n' },
    ]);

    const conflictModal = page.getByTestId('upload-conflict-modal');
    await expect(conflictModal).toBeVisible({ timeout: 20_000 });
    await conflictModal.getByTestId('upload-conflict-apply-all').check();
    await conflictModal.getByTestId('upload-conflict-skip').click();
    await expect(conflictModal).toBeHidden();

    await waitForRemoteFiles([nonConflictName]);
    await expect.poll(() => readRemoteText('seed.txt')).toBe(firstSeed);
    await expect.poll(() => readRemoteText('copy-source.txt')).toBe(firstCopy);
    await expect.poll(() => readRemoteText(nonConflictName)).toBe('new-file-still-uploads\n');
  });
});

test('aggregate committed throughput keeps folder uploads concurrent on moderate-latency links', async ({ page, context }) => {
  await openFileManager(page, context);

  const tuningLogs: string[] = [];
  const schedulerLogs: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('Adaptive upload tuning changed:')) tuningLogs.push(text);
    if (text.includes('Upload scheduler:')) schedulerLogs.push(text);
  });

  const largeFiles = Array.from({ length: 4 }, (_, index) => ({
    name: `moderate-latency-${index + 1}.bin`,
    size: 3 * 1024 * 1024,
    fill: 0x20 + index,
  }));

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=50`, { method: 'POST' });
  try {
    await slowStep('folder upload starts at least two large files while the network profile is still probing', async () => {
      await dragLocalFiles(page, largeFiles);

      const progressPopup = page.getByTestId('file-upload-progress-popup');
      await expect(progressPopup).toBeVisible({ timeout: 10_000 });
      await expect(progressPopup.locator('h4')).toContainText('·');
      const progressBody = progressPopup.locator('ul');
      await expect(progressBody).toBeVisible();
      await progressPopup.getByTestId('file-upload-progress-minimize').click();
      await expect(progressBody).toBeHidden();

      const progressDisplay = page.getByTestId('transfer-progress-toggle');
      await expect(progressDisplay).toBeVisible();
      await expect(progressDisplay).toHaveAttribute('title', 'Progress Display');
      await progressDisplay.click();
      await expect(progressPopup).toBeVisible();
      await expect(progressBody).toBeVisible();
      await expect(page.getByTestId('transfer-progress-minimize')).toBeVisible();

      await expect.poll(
        () => schedulerLogs.some(log => log.includes('profile=probing') && log.includes('activeFiles=2/4')),
        { timeout: 20_000 },
      ).toBe(true);
    });

    await slowStep('aggregate committed throughput avoids the old per-chunk weak-network false positive', async () => {
      await expect.poll(
        () => tuningLogs.some(log => log.includes('profile=normal') && log.includes('largeFileSlots=4')),
        { timeout: 30_000 },
      ).toBe(true);
      await waitForRemoteFiles(largeFiles.map(file => file.name), 60_000);
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('slow SFTP acknowledgements move batch uploads into the weak-network window and concurrency profile', async ({ page, context }) => {
  await openFileManager(page, context);

  const tuningLogs: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('Adaptive upload tuning changed:')) tuningLogs.push(text);
  });

  const weakFiles = Array.from({ length: 10 }, (_, index) => ({
    name: `weak-network-${index + 1}.bin`,
    size: 64 * 1024,
    fill: 0x40 + index,
  }));

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=750`, { method: 'POST' });
  try {
    await slowStep('delayed real SFTP WRITE acknowledgements trigger the weak-link tuning profile', async () => {
      await dragLocalFiles(page, weakFiles);
      await waitForRemoteFiles(weakFiles.map(file => file.name), 60_000);

      await expect.poll(
        () => tuningLogs.some(log => log.includes('profile=weak') && log.includes('maxActiveFiles=2') && log.includes('largeFileSlots=2')),
        { timeout: 20_000 },
      ).toBe(true);
    });

    await step('all files remain byte-complete while the adaptive scheduler changes window sizes', async () => {
      for (const file of weakFiles) {
        const response = await fetch(`${E2E_SSH.controlUrl}/stat?name=${encodeURIComponent(file.name)}`);
        expect(response.ok).toBeTruthy();
        const stats = await response.json() as { size: number };
        expect(stats.size).toBe(file.size);
      }
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
