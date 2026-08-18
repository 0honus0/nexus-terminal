import { expect, test, type BrowserContext, type Page } from '../../support/fixtures';
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

test('upload popup keeps Hide visible when batch actions crowd the header', async ({ page, context }) => {
  await openFileManager(page, context);

  const files = Array.from({ length: 4 }, (_, index) => ({
    name: `hide-button-${index + 1}.bin`,
    size: 4 * 1024 * 1024,
    fill: 0x60 + index,
  }));

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=220`, { method: 'POST' });
  try {
    await dragLocalFiles(page, files);

    const popup = page.getByTestId('file-upload-progress-popup');
    const hideButton = popup.getByTestId('file-upload-progress-hide');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup.getByTestId('file-upload-cancel-all')).toBeVisible();
    await expect(hideButton).toBeVisible();

    const [popupBox, hideBox] = await Promise.all([popup.boundingBox(), hideButton.boundingBox()]);
    expect(popupBox).not.toBeNull();
    expect(hideBox).not.toBeNull();
    expect(hideBox!.width).toBeGreaterThanOrEqual(20);
    expect(hideBox!.x).toBeGreaterThanOrEqual(popupBox!.x - 1);
    expect(hideBox!.x + hideBox!.width).toBeLessThanOrEqual(popupBox!.x + popupBox!.width + 1);

    await hideButton.click();
    await expect(popup).toBeHidden();
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('cancelling a throttled upload keeps immediate file-manager refresh responsive', async ({ page, context }) => {
  await openFileManager(page, context);

  const refreshMarker = 'refresh-after-upload-cancel.txt';
  const fixtureResponse = await fetch(
    `${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(refreshMarker)}&size=32`,
    { method: 'POST' },
  );
  expect(fixtureResponse.ok).toBeTruthy();
  await expect(fileManagerRow(page, refreshMarker)).toBeHidden();

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 256 * 1024,
  });

  try {
    await dragLocalFiles(page, [{
      name: 'cancel-then-refresh.bin',
      size: 24 * 1024 * 1024,
      fill: 0x73,
    }]);

    const popup = page.getByTestId('file-upload-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    await popup.getByTestId('file-upload-cancel').click();
    await expect(popup).toBeHidden({ timeout: 2_000 });

    const refreshStartedAt = Date.now();
    await page.getByTestId('file-manager-modal').locator('button:has(i.fa-sync-alt)').click();
    await expect(fileManagerRow(page, refreshMarker)).toBeVisible({ timeout: 5_000 });
    expect(Date.now() - refreshStartedAt).toBeLessThan(5_000);
  } finally {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
  }
});


test('cancelled upload stays cancelled when the browser transport drops during a queued binary send', async ({ page, context }) => {
  await openFileManager(page, context);
  const filename = 'cancel-during-transport-drop.bin';
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 128 * 1024,
  });

  try {
    await dragLocalFiles(page, [{ name: filename, size: 32 * 1024 * 1024, fill: 0x4d }]);
    const popup = page.getByTestId('file-upload-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toContainText(filename);
    await page.waitForTimeout(400);

    await popup.getByTestId('file-upload-cancel').click();
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await page.waitForTimeout(350);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    // A rejected in-flight send must not resurrect a user-cancelled upload as paused/error.
    await page.waitForTimeout(3_500);
    await expect(popup).toBeHidden();
    const response = await fetch(`${E2E_SSH.controlUrl}/files`);
    expect(response.ok).toBeTruthy();
    const body = await response.json() as { files: string[] };
    expect(body.files).not.toContain(filename);
  } finally {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
  }
});


test('cancelled upload cannot be resurrected by a rejected binary send that was already waiting on backpressure', async ({ page, context }) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'bufferedAmount');
    if (!descriptor?.get || descriptor.configurable === false) return;
    Object.defineProperty(WebSocket.prototype, 'bufferedAmount', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        const socket = this as WebSocket;
        if ((globalThis as any).__NEXUS_E2E_BREAK_BUFFERED_WS__ && socket.readyState === WebSocket.OPEN) {
          socket.close(4000, 'e2e buffered send rejection');
        }
        if ((globalThis as any).__NEXUS_E2E_HOLD_BUFFERED_WS__) return 64 * 1024 * 1024;
        return descriptor.get!.call(socket);
      },
    });
  });
  await openFileManager(page, context);
  const filename = 'cancelled-inflight-send.bin';

  await page.evaluate(() => { (globalThis as any).__NEXUS_E2E_HOLD_BUFFERED_WS__ = true; });
  try {
    await dragLocalFiles(page, [{ name: filename, size: 4 * 1024 * 1024, fill: 0x5e }]);
    const popup = page.getByTestId('file-upload-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup).toContainText(filename);
    await page.waitForTimeout(250);

    await popup.getByTestId('file-upload-cancel').click();
    await page.evaluate(() => { (globalThis as any).__NEXUS_E2E_BREAK_BUFFERED_WS__ = true; });

    // cancelUpload schedules removal after three seconds. A stale pump catch must not
    // overwrite cancelled with paused/error and keep a ghost task alive.
    await page.waitForTimeout(3_500);
    await expect(popup).toBeHidden();
    const response = await fetch(`${E2E_SSH.controlUrl}/files`);
    expect(response.ok).toBeTruthy();
    const body = await response.json() as { files: string[] };
    expect(body.files).not.toContain(filename);
  } finally {
    await page.evaluate(() => {
      (globalThis as any).__NEXUS_E2E_HOLD_BUFFERED_WS__ = false;
      (globalThis as any).__NEXUS_E2E_BREAK_BUFFERED_WS__ = false;
    }).catch(() => {});
  }
});
