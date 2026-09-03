import { expect, test, type BrowserContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  openInlineProgressDisplay,
  reopenConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
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

test('file browsing and recursive search remain responsive while upload writes are delayed', async ({ page, context }) => {
  await openFileManager(page, context);

  const fileName = 'concurrent-file-operations.bin';
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=1500`, { method: 'POST' });
  try {
    await slowStep('File Manager stays usable while an upload is waiting on remote writes', async () => {
      await dragLocalFiles(page, [{ name: fileName, size: 256 * 1024, fill: 0x6e }]);
      const progressPopup = page.getByTestId('file-upload-progress-popup');
      await expect(progressPopup).toBeVisible({ timeout: 10_000 });

      await fileManagerRow(page, 'folder-seed').dblclick();
      await expect(fileManagerRow(page, 'nested.txt')).toBeVisible({ timeout: 5_000 });
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }

  await waitForRemoteFiles([fileName], 30_000);

  await step('recursive search returns the real remote file after the concurrent upload', async () => {
    const fileManagerModal = page.getByTestId('file-manager-modal');
    await fileManagerModal.getByTitle('Search files...').click();
    const search = fileManagerModal.getByPlaceholder('Search files...');
    await search.fill('nested');
    await expect(activeFileManagerList(page).locator('tr[data-file-path="/folder-seed/nested.txt"]')).toBeVisible({ timeout: 10_000 });
  });

  await page.goto('/connections');
  await expect(page.getByTestId('connections-add-button')).toBeVisible({ timeout: 10_000 });
});

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

test('multi-file upload remains usable and byte-complete on moderate-latency links', async ({ page, context }) => {
  await openFileManager(page, context);

  const largeFiles = Array.from({ length: 4 }, (_, index) => ({
    name: `moderate-latency-${index + 1}.bin`,
    size: 3 * 1024 * 1024,
    fill: 0x20 + index,
  }));

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=50`, { method: 'POST' });
  try {
    await slowStep('progress can hide and restore while several real files upload', async () => {
      await dragLocalFiles(page, largeFiles);

      const progressPopup = page.getByTestId('file-upload-progress-popup');
      await expect(progressPopup).toBeVisible({ timeout: 10_000 });
      await expect(progressPopup.locator('h4')).toContainText('·');
      const progressBody = progressPopup.locator('ul');
      await expect(progressBody).toBeVisible();

      await expect.poll(() => progressPopup.evaluate((element) => {
        const zIndex = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
        return Number.isFinite(zIndex) ? zIndex : 0;
      })).toBeLessThan(50);

      await progressPopup.getByTestId('file-upload-progress-hide').click();
      await expect(progressPopup).toBeHidden();

      const progressModal = await openInlineProgressDisplay(page);
      const hiddenSource = progressModal.getByTestId('hidden-progress-source').first();
      const hiddenTask = hiddenSource.getByTestId('hidden-progress-task').first();
      await expect(hiddenSource).toBeVisible();
      await expect(hiddenTask).toBeVisible();
      await expect(hiddenTask.getByTestId('hidden-progress-bar')).toBeVisible();
      await hiddenSource.getByTestId('hidden-progress-restore').click();
      await expect(progressModal).toBeHidden();
      await reopenConnectedFileManager(page);
      await expect(progressPopup).toBeVisible();
      await expect(progressBody).toBeVisible();
    });

    await slowStep('all uploaded files arrive with their declared byte sizes', async () => {
      await waitForRemoteFiles(largeFiles.map(file => file.name), 60_000);
      for (const file of largeFiles) {
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

test('batch upload completes every file under slow SFTP acknowledgements', async ({ page, context }) => {
  await openFileManager(page, context);

  const weakFiles = Array.from({ length: 10 }, (_, index) => ({
    name: `weak-network-${index + 1}.bin`,
    size: 64 * 1024,
    fill: 0x40 + index,
  }));

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=750`, { method: 'POST' });
  try {
    await slowStep('the user-visible upload batch completes despite slow remote acknowledgements', async () => {
      await dragLocalFiles(page, weakFiles);
      const progressPopup = page.getByTestId('file-upload-progress-popup');
      await expect(progressPopup).toBeVisible({ timeout: 10_000 });
      await waitForRemoteFiles(weakFiles.map(file => file.name), 60_000);
    });

    await step('all remote files are byte-complete', async () => {
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

test('upload popup resizes and a hidden batch becomes one scrollable source card', async ({ page, context }) => {
  await openFileManager(page, context);

  const files = Array.from({ length: 8 }, (_, index) => ({
    name: `hide-button-${index + 1}.bin`,
    size: 4 * 1024 * 1024,
    fill: 0x60 + index,
  }));

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=220`, { method: 'POST' });
  try {
    await dragLocalFiles(page, files);

    const popup = page.getByTestId('file-upload-progress-popup');
    const uploadSpeed = popup.getByTestId('file-upload-speed');
    const cancelAll = popup.getByTestId('file-upload-cancel-all');
    const hideButton = popup.getByTestId('file-upload-progress-hide');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(cancelAll).toBeVisible();
    await expect(uploadSpeed).toBeVisible();
    await expect(hideButton).toBeVisible();
    await expect(hideButton.locator('i')).toHaveClass(/fa-minus/);
    await expect(popup.getByTestId('file-upload-progress-minimize')).toHaveCount(0);

    const [popupBox, speedBox, cancelAllBox, hideBox, speedMetrics] = await Promise.all([
      popup.boundingBox(),
      uploadSpeed.boundingBox(),
      cancelAll.boundingBox(),
      hideButton.boundingBox(),
      uploadSpeed.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })),
    ]);
    expect(popupBox).not.toBeNull();
    expect(speedBox).not.toBeNull();
    expect(cancelAllBox).not.toBeNull();
    expect(hideBox).not.toBeNull();
    expect(speedMetrics.scrollWidth).toBeLessThanOrEqual(speedMetrics.clientWidth + 1);
    expect(speedMetrics.scrollHeight).toBeLessThanOrEqual(speedMetrics.clientHeight + 1);
    expect(speedBox!.x).toBeGreaterThanOrEqual(popupBox!.x - 1);
    expect(speedBox!.x + speedBox!.width).toBeLessThanOrEqual(popupBox!.x + popupBox!.width + 1);
    expect(hideBox!.width).toBeGreaterThanOrEqual(20);
    expect(hideBox!.x).toBeGreaterThanOrEqual(speedBox!.x + speedBox!.width - 1);
    expect(cancelAllBox!.x).toBeGreaterThanOrEqual(hideBox!.x + hideBox!.width - 1);
    expect(cancelAllBox!.x + cancelAllBox!.width).toBeLessThanOrEqual(popupBox!.x + popupBox!.width + 1);
    const headerCenterY = speedBox!.y + speedBox!.height / 2;
    expect(Math.abs((hideBox!.y + hideBox!.height / 2) - headerCenterY)).toBeLessThanOrEqual(2);
    expect(Math.abs((cancelAllBox!.y + cancelAllBox!.height / 2) - headerCenterY)).toBeLessThanOrEqual(2);
    const headerOrder = await popup.getByTestId('file-upload-header-meta').evaluate((header) =>
      [...header.children].map(element => element.getAttribute('data-testid')).filter(Boolean),
    );
    expect(headerOrder.slice(-3)).toEqual([
      'file-upload-speed',
      'file-upload-progress-hide',
      'file-upload-cancel-all',
    ]);
    await captureFunctionalScreenshot(page, 'upload-progress.png', { viewport: { width: 1440, height: 900 } });
    const progressBars = popup.getByTestId('file-upload-progress-bar');
    await expect(progressBars.first()).toBeVisible();
    const progressBarBoxes = await progressBars.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    }));
    expect(progressBarBoxes.length).toBeGreaterThan(1);
    expect(Math.max(...progressBarBoxes.map(box => box.x)) - Math.min(...progressBarBoxes.map(box => box.x))).toBeLessThanOrEqual(1);
    expect(Math.max(...progressBarBoxes.map(box => box.width)) - Math.min(...progressBarBoxes.map(box => box.width))).toBeLessThanOrEqual(1);

    const resizeHandle = popup.getByTestId('file-upload-resize-handle');
    await expect(resizeHandle).toBeVisible();
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + resizeBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox!.x + 90, resizeBox!.y + 70, { steps: 5 });
    await page.mouse.up();
    const resizedPopupBox = await popup.boundingBox();
    expect(resizedPopupBox).not.toBeNull();
    expect(resizedPopupBox!.width).toBeGreaterThan(popupBox!.width + 40);
    expect(resizedPopupBox!.height).toBeGreaterThan(popupBox!.height + 30);

    await hideButton.click();
    await expect(popup).toBeHidden();

    const modal = await openInlineProgressDisplay(page);
    const hiddenSources = modal.getByTestId('hidden-progress-source');
    await expect(hiddenSources).toHaveCount(1);
    const sourceCard = hiddenSources.first();
    const hiddenList = modal.getByTestId('hidden-progress-list');
    const [sourceCardBox, hiddenListBox] = await Promise.all([
      sourceCard.boundingBox(),
      hiddenList.boundingBox(),
    ]);
    expect(sourceCardBox).not.toBeNull();
    expect(hiddenListBox).not.toBeNull();
    expect(sourceCardBox!.width).toBeGreaterThanOrEqual(hiddenListBox!.width - 2);
    const sourceTasks = sourceCard.getByTestId('hidden-progress-task');
    await expect(sourceTasks.first()).toBeVisible();
    expect(await sourceTasks.count()).toBeGreaterThan(1);
    const listMetrics = await sourceCard.getByTestId('hidden-progress-source-list').evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);
    const cancelAllHidden = sourceCard.getByTestId('hidden-progress-cancel-all');
    await expect(cancelAllHidden).toBeVisible();
    await captureFunctionalScreenshot(page, 'hidden-upload-progress.png', { viewport: { width: 1440, height: 900 } });
    await cancelAllHidden.click();
    await expect(sourceCard).toBeHidden({ timeout: 10_000 });
    await expect(modal.getByTestId('progress-display-empty')).toBeVisible();
    await modal.getByTestId('progress-display-close').click();
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});

test('cancel all stays responsive with a buffered isolated upload transport', async ({ page, context }) => {
  await page.addInitScript(() => {
    const originalSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function patchedSend(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      originalSend.call(this, data);
      try {
        if (new URL(this.url).pathname !== '/ws/upload') return;
        const state = globalThis as typeof globalThis & { __NEXUS_E2E_MAX_UPLOAD_BUFFERED_AMOUNT__?: number };
        state.__NEXUS_E2E_MAX_UPLOAD_BUFFERED_AMOUNT__ = Math.max(
          state.__NEXUS_E2E_MAX_UPLOAD_BUFFERED_AMOUNT__ ?? 0,
          this.bufferedAmount,
        );
      } catch {
        // Ignore malformed/empty URLs while instrumenting browser sockets for this test.
      }
    };
  });

  await openFileManager(page, context);

  const uploadSocketUrls: string[] = [];
  page.on('websocket', socket => uploadSocketUrls.push(socket.url()));

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
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=900`, { method: 'POST' });

  const uploadNames = Array.from({ length: 4 }, (_, index) => `cancel-all-refresh-${index + 1}.bin`);
  try {
    await dragLocalFiles(page, uploadNames.map((name, index) => ({
      name,
      size: 24 * 1024 * 1024,
      fill: 0x70 + index,
    })));

    const popup = page.getByTestId('file-upload-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(popup.getByTestId('file-upload-cancel-all')).toBeVisible();
    await expect.poll(
      () => uploadSocketUrls.some(socketUrl => new URL(socketUrl).pathname === '/ws/upload'),
      { timeout: 5_000 },
    ).toBe(true);

    // Prove this regression is exercising a browser upload backlog larger than the old
    // 512 KiB responsiveness cap. Control traffic must stay responsive even when the
    // dedicated upload transport has substantially more data already queued.
    await expect.poll(
      () => page.evaluate(() => (globalThis as typeof globalThis & {
        __NEXUS_E2E_MAX_UPLOAD_BUFFERED_AMOUNT__?: number;
      }).__NEXUS_E2E_MAX_UPLOAD_BUFFERED_AMOUNT__ ?? 0),
      { timeout: 5_000 },
    ).toBeGreaterThan(512 * 1024);

    await popup.getByTestId('file-upload-cancel-all').click();
    await expect(popup).toBeHidden({ timeout: 2_000 });

    const refreshStartedAt = Date.now();
    await page.getByTestId('file-manager-modal').locator('button:has(i.fa-sync-alt)').click();
    await expect(fileManagerRow(page, refreshMarker)).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - refreshStartedAt).toBeLessThan(2_000);

    await expect.poll(async () => {
      const response = await fetch(`${E2E_SSH.controlUrl}/files`);
      if (!response.ok) return uploadNames;
      const body = await response.json() as { files: string[] };
      return body.files.filter(name =>
        uploadNames.includes(name) || /^\.nexus-upload-.*\.part(?:\.previous)?$/.test(name),
      );
    }, { timeout: 10_000 }).toEqual([]);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
  }
});


test('Progress Display cancel all keeps immediate file-manager refresh responsive', async ({ page, context }) => {
  await openFileManager(page, context);

  const refreshMarker = 'refresh-after-progress-cancel-all.txt';
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
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=900`, { method: 'POST' });

  const uploadNames = Array.from({ length: 4 }, (_, index) => `progress-cancel-all-refresh-${index + 1}.bin`);
  try {
    await dragLocalFiles(page, uploadNames.map((name, index) => ({
      name,
      size: 24 * 1024 * 1024,
      fill: 0x50 + index,
    })));

    const popup = page.getByTestId('file-upload-progress-popup');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await popup.getByTestId('file-upload-progress-hide').click();
    await expect(popup).toBeHidden();

    const modal = await openInlineProgressDisplay(page);
    const sourceCard = modal.getByTestId('hidden-progress-source').filter({ hasText: 'upload' }).first();
    await expect(sourceCard).toBeVisible();
    await expect(sourceCard.getByTestId('hidden-progress-task').first()).toBeVisible();

    await sourceCard.getByTestId('hidden-progress-cancel-all').click();
    await expect(sourceCard).toBeHidden({ timeout: 2_000 });
    await modal.getByTestId('progress-display-close').click();
    await reopenConnectedFileManager(page);

    const refreshStartedAt = Date.now();
    await page.getByTestId('file-manager-modal').locator('button:has(i.fa-sync-alt)').click();
    await expect(fileManagerRow(page, refreshMarker)).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - refreshStartedAt).toBeLessThan(2_000);

    await expect.poll(async () => {
      const response = await fetch(`${E2E_SSH.controlUrl}/files`);
      if (!response.ok) return uploadNames;
      const body = await response.json() as { files: string[] };
      return body.files.filter(name =>
        uploadNames.includes(name) || /^\.nexus-upload-.*\.part(?:\.previous)?$/.test(name),
      );
    }, { timeout: 10_000 }).toEqual([]);
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
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
  test.setTimeout(60_000);
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
