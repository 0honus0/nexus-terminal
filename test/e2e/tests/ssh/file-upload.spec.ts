import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  closeConnectedFileManager,
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
    const overlay = page.getByTestId('file-upload-drop-overlay');
    await expect(overlay).toBeVisible();
    await overlay.dispatchEvent('drop', { dataTransfer });
    await expect(overlay).toBeHidden();
  } finally {
    await dataTransfer.dispose();
  }
}

async function waitForVisibleFiles(page: Page, names: string[], timeout = 45_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const visible: string[] = [];
        for (const name of names) {
          if (
            await fileManagerRow(page, name)
              .isVisible()
              .catch(() => false)
          )
            visible.push(name);
        }
        return visible;
      },
      { timeout },
    )
    .toEqual(names);
}

async function downloadRemoteFile(page: Page, name: string): Promise<Buffer> {
  const target = fileManagerRow(page, name);
  await expect(target).toBeVisible();
  await target.click({ button: 'right' });
  const contextMenu = page.getByTestId('file-manager-context-menu');
  await expect(contextMenu).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await contextMenu.getByText('Download', { exact: true }).first().click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  return readFile(downloadPath!);
}

async function readRemoteText(page: Page, name: string): Promise<string> {
  return (await downloadRemoteFile(page, name)).toString('utf8');
}

function visibleProgressCenter(page: Page) {
  return page.getByTestId('transfer-progress-center').filter({ visible: true }).first();
}

function uploadProgressTask(page: Page, name?: string) {
  const tasks = visibleProgressCenter(page).locator('[data-testid="transfer-progress-task"][data-task-kind="upload"]');
  return name ? tasks.filter({ hasText: name }).first() : tasks.first();
}

test('file browsing and recursive search remain responsive while upload writes are delayed', async ({
  page,
  context,
}) => {
  await openFileManager(page, context);

  const fileName = 'concurrent-file-operations.bin';
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=1500`, { method: 'POST' });
  try {
    await slowStep('File Manager stays usable while an upload is waiting on remote writes', async () => {
      await dragLocalFiles(page, [{ name: fileName, size: 256 * 1024, fill: 0x6e }]);
      const progressPopup = visibleProgressCenter(page);
      await expect(progressPopup).toBeVisible({ timeout: 10_000 });
      await expect(uploadProgressTask(page, fileName)).toBeVisible();

      await fileManagerRow(page, 'folder-seed').dblclick();
      await expect(fileManagerRow(page, 'nested.txt')).toBeVisible({ timeout: 5_000 });
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }

  await page.getByTestId('file-manager-modal').getByTitle('Parent Directory', { exact: true }).click();
  await expect(fileManagerRow(page, fileName)).toBeVisible({ timeout: 30_000 });

  await step('recursive search returns the real nested remote file after the concurrent upload', async () => {
    const fileManagerModal = page.getByTestId('file-manager-modal');
    const search = fileManagerModal.getByTestId('file-manager-search-input');
    await search.fill('nested');
    await expect(activeFileManagerList(page).locator('tr[data-file-path="/folder-seed/nested.txt"]')).toBeVisible({
      timeout: 10_000,
    });
  });

  await page.goto('/connections');
  await expect(page.getByTestId('connections-add-button')).toBeVisible({ timeout: 10_000 });
});

test('Windows-style multi-file drag uploads every file and applies one conflict choice to the remaining batch', async ({
  page,
  context,
}) => {
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

    const conflictModal = page.getByRole('dialog', { name: 'File already exists', exact: true });
    await expect(conflictModal).toBeVisible({ timeout: 20_000 });
    await conflictModal
      .getByRole('checkbox', { name: 'Use this choice for all remaining conflicts in this upload', exact: true })
      .check();
    await conflictModal.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect(conflictModal).toBeHidden();

    await waitForVisibleFiles(page, freshNames);
    await expect(fileManagerRow(page, freshNames.at(-1)!)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => readRemoteText(page, 'seed.txt')).toBe(firstSeed);
    await expect.poll(() => readRemoteText(page, 'copy-source.txt')).toBe(firstCopy);
  });

  await slowStep(
    'skip plus apply-to-all aborts only later conflicting files while new files still upload',
    async () => {
      const skippedSeedBody = 'this-must-not-replace-seed\n';
      const skippedCopyBody = 'this-must-not-replace-copy\n';
      const nonConflictName = 'skip-policy-new-file.txt';

      await dragLocalFiles(page, [
        { name: 'seed.txt', text: skippedSeedBody },
        { name: 'copy-source.txt', text: skippedCopyBody },
        { name: nonConflictName, text: 'new-file-still-uploads\n' },
      ]);

      const conflictModal = page.getByRole('dialog', { name: 'File already exists', exact: true });
      await expect(conflictModal).toBeVisible({ timeout: 20_000 });
      await conflictModal
        .getByRole('checkbox', { name: 'Use this choice for all remaining conflicts in this upload', exact: true })
        .check();
      await conflictModal.getByRole('button', { name: 'Skip this file', exact: true }).click();
      await expect(conflictModal).toBeHidden();

      await waitForVisibleFiles(page, [nonConflictName]);
      await expect.poll(() => readRemoteText(page, 'seed.txt')).toBe(firstSeed);
      await expect.poll(() => readRemoteText(page, 'copy-source.txt')).toBe(firstCopy);
      await expect.poll(() => readRemoteText(page, nonConflictName)).toBe('new-file-still-uploads\n');
    },
  );
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

      const progressPopup = visibleProgressCenter(page);
      await expect(progressPopup).toBeVisible({ timeout: 10_000 });
      const uploadTasks = progressPopup.locator('[data-testid="transfer-progress-task"][data-task-kind="upload"]');
      await expect(uploadTasks).toHaveCount(largeFiles.length);
      const progressBody = progressPopup.locator('ul');
      await expect(progressBody).toBeVisible();

      await expect
        .poll(() =>
          progressPopup.evaluate((element) => {
            const zIndex = Number.parseInt(window.getComputedStyle(element).zIndex, 10);
            return Number.isFinite(zIndex) ? zIndex : 0;
          }),
        )
        .toBeLessThan(50);

      await closeConnectedFileManager(page);
      await progressPopup.getByTestId('transfer-progress-hide').click();
      await expect(progressPopup).toBeHidden();

      const progressModal = await openInlineProgressDisplay(page);
      const hiddenSource = progressModal.getByTestId('hidden-progress-source').first();
      const hiddenTask = hiddenSource.getByTestId('hidden-progress-task').first();
      await expect(hiddenSource).toBeVisible();
      await expect(hiddenTask).toBeVisible();
      await expect(hiddenTask.getByRole('progressbar')).toBeVisible();
      await hiddenSource.getByTestId('hidden-progress-restore').click();
      await expect(progressModal).toBeHidden();
      await reopenConnectedFileManager(page);
      await expect(progressPopup).toBeVisible();
      await expect(progressBody).toBeVisible();
    });

    await slowStep('all uploaded files arrive with their declared byte sizes', async () => {
      await waitForVisibleFiles(
        page,
        largeFiles.map((file) => file.name),
        60_000,
      );
      for (const file of largeFiles) {
        expect((await downloadRemoteFile(page, file.name)).byteLength).toBe(file.size);
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
      const progressPopup = visibleProgressCenter(page);
      await expect(progressPopup).toBeVisible({ timeout: 10_000 });
      await expect(
        progressPopup.locator('[data-testid="transfer-progress-task"][data-task-kind="upload"]'),
      ).toHaveCount(weakFiles.length);
      await waitForVisibleFiles(
        page,
        weakFiles.map((file) => file.name),
        60_000,
      );
    });

    await step('all uploaded files download with their declared byte sizes', async () => {
      for (const file of weakFiles) {
        expect((await downloadRemoteFile(page, file.name)).byteLength).toBe(file.size);
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

  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=900`, { method: 'POST' });
  try {
    await dragLocalFiles(page, files);

    const popup = visibleProgressCenter(page);
    const uploadSpeed = popup.getByTestId('transfer-progress-speed');
    const cancelAll = popup.getByTestId('transfer-progress-cancel-all');
    const hideButton = popup.getByTestId('transfer-progress-hide');
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await expect(cancelAll).toBeVisible();
    await expect(uploadSpeed).toBeVisible();
    await expect(hideButton).toBeVisible();

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
    expect(cancelAllBox!.x).toBeGreaterThanOrEqual(speedBox!.x + speedBox!.width - 1);
    expect(hideBox!.x).toBeGreaterThanOrEqual(cancelAllBox!.x + cancelAllBox!.width - 1);
    expect(hideBox!.x + hideBox!.width).toBeLessThanOrEqual(popupBox!.x + popupBox!.width + 1);
    const headerCenterY = speedBox!.y + speedBox!.height / 2;
    expect(Math.abs(hideBox!.y + hideBox!.height / 2 - headerCenterY)).toBeLessThanOrEqual(2);
    expect(Math.abs(cancelAllBox!.y + cancelAllBox!.height / 2 - headerCenterY)).toBeLessThanOrEqual(2);
    await captureFunctionalScreenshot(page, 'upload-progress.png', { viewport: { width: 1440, height: 900 } });
    const progressBars = popup.getByTestId('transfer-progress-bar');
    await expect(progressBars.first()).toBeVisible();
    const progressBarBoxes = await progressBars.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, width: rect.width };
      }),
    );
    expect(progressBarBoxes.length).toBeGreaterThan(1);
    expect(
      Math.max(...progressBarBoxes.map((box) => box.x)) - Math.min(...progressBarBoxes.map((box) => box.x)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.max(...progressBarBoxes.map((box) => box.width)) - Math.min(...progressBarBoxes.map((box) => box.width)),
    ).toBeLessThanOrEqual(1);

    await closeConnectedFileManager(page);
    const resizeHandle = popup.getByTestId('transfer-progress-resize');
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
    const [sourceCardBox, hiddenListBox, hiddenListPaddingRight] = await Promise.all([
      sourceCard.boundingBox(),
      hiddenList.boundingBox(),
      hiddenList.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingRight) || 0),
    ]);
    expect(sourceCardBox).not.toBeNull();
    expect(hiddenListBox).not.toBeNull();
    expect(sourceCardBox!.width).toBeGreaterThanOrEqual(hiddenListBox!.width - hiddenListPaddingRight - 1);
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
    await expect
      .poll(
        async () => ((await sourceCard.isVisible()) ? sourceCard.getByTestId('hidden-progress-cancel').count() : 0),
        {
          timeout: 10_000,
        },
      )
      .toBe(0);
    if (await sourceCard.isVisible()) {
      await expect(sourceCard).toContainText(/Completed|Failed|Partially completed|Cancelled/);
    } else {
      await expect(modal.getByTestId('progress-display-empty')).toBeVisible();
    }
    await modal.getByTestId('progress-display-close').click();
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
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
    await dragLocalFiles(
      page,
      uploadNames.map((name, index) => ({
        name,
        size: 24 * 1024 * 1024,
        fill: 0x50 + index,
      })),
    );

    const popup = visibleProgressCenter(page);
    await expect(popup).toBeVisible({ timeout: 10_000 });
    await closeConnectedFileManager(page);
    await popup.getByTestId('transfer-progress-hide').click();
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
    await page.getByTestId('file-manager-modal').getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(fileManagerRow(page, refreshMarker)).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - refreshStartedAt).toBeLessThan(2_000);
    for (const name of uploadNames) {
      await expect(fileManagerRow(page, name)).toHaveCount(0);
    }
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

test('repeated cancelled-upload teardown keeps fresh Workspace WebSockets reconnectable', async ({
  page,
  context,
  request,
}) => {
  test.slow();
  const stressCycles = 32;
  let activePage = page;
  await openFileManager(activePage, context);

  try {
    for (let cycle = 1; cycle <= stressCycles; cycle += 1) {
      const filename = `cancel-reset-reconnect-${String(cycle).padStart(2, '0')}.bin`;
      const delayResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=900`, { method: 'POST' });
      expect(delayResponse.ok).toBeTruthy();

      await dragLocalFiles(activePage, [{ name: filename, size: 2 * 1024 * 1024, fill: 0x40 + (cycle % 32) }]);
      const task = uploadProgressTask(activePage, filename);
      await expect(task, `cycle ${cycle}: upload task should start before teardown`).toBeVisible({ timeout: 10_000 });
      await closeConnectedFileManager(activePage);
      await task.getByTestId('transfer-progress-cancel').click();

      // Deliberately overlap browser transport loss, upload cancellation, Backend runtime teardown,
      // session clearing, and SSH-server reset. This is the churn that previously made a later
      // /ws/workspace upgrade intermittently fall through the shared dev/E2E WebSocket proxy.
      await context.setOffline(true);
      const resetResponse = await request.post('/api/v1/__e2e/reset', {
        data: { mode: 'seed' },
      });
      expect(
        resetResponse.ok(),
        `cycle ${cycle}: Backend E2E reset failed: ${await resetResponse.text()}`,
      ).toBeTruthy();
      await resetTestSshFilesystem();

      // A new browser page models the next E2E case: old Workspace/upload sockets are gone, while
      // the same long-lived Vite ingress must accept a brand-new Workspace control upgrade.
      await activePage.close();
      await context.setOffline(false);
      await loginAsInitialAdmin(context.request);
      await configureSshE2eSettings(context.request);
      const connectionId = await ensureTestSshConnection(context.request);
      activePage = await context.newPage();
      await connectTestSshFromConnectionsPage(activePage, connectionId);
      await openConnectedFileManager(activePage);
      await expect(
        activePage.getByTestId('command-input'),
        `cycle ${cycle}: fresh Workspace control socket should reconnect after teardown`,
      ).toBeEnabled();
    }
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
    if (!activePage.isClosed()) await activePage.close();
  }
});
