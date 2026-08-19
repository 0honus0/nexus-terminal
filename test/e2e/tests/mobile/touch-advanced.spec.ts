import { expect, test, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { slowStep, step } from '../../support/steps';

async function connectMobileSsh(
  page: Page,
  request: Parameters<typeof loginAsInitialAdmin>[0],
): Promise<void> {
  await loginAsInitialAdmin(request);
  await configureSshE2eSettings(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 20_000 });
}

async function longPressFile(page: Page, filename: string): Promise<Locator> {
  const row = fileManagerRow(page, filename);
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box).toBeTruthy();
  const point = {
    x: box!.x + Math.min(box!.width - 8, Math.max(8, box!.width / 2)),
    y: box!.y + box!.height / 2,
  };

  await row.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: point.x,
    clientY: point.y,
  });
  await page.waitForTimeout(620);
  await row.dispatchEvent('pointerup', {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: point.x,
    clientY: point.y,
  });

  const menu = page.getByTestId('file-manager-context-menu');
  await expect(menu).toBeVisible();
  return menu;
}

function expectBoxInsideViewport(box: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }): void {
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('mobile long-press menu flattens archive actions and creates a real ZIP', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);

  await step('archive submenu items are flattened into the touch menu', async () => {
    const menu = await longPressFile(page, 'archive-source.txt');
    for (const label of [
      'Compress to zip',
      'Compress to tar.gz',
      'Compress to tar.bz2',
      'Password-protected ZIP...',
      'Send to...',
    ]) {
      await expect(menu.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('file-manager-context-submenu')).toHaveCount(0);
  });

  await slowStep('tapping the flattened ZIP action writes the archive over SFTP', async () => {
    await page.getByTestId('file-manager-context-menu').getByText('Compress to zip', { exact: true }).click();
    await expect(fileManagerRow(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });
  });
});

test('mobile CodeMirror search opens from the editor header and highlights remote text', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);

  await slowStep('single tap opens README in the mobile editor', async () => {
    await fileManagerRow(page, 'README-e2e.md').click();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
    await expect.poll(async () => editor.locator('.cm-content').innerText(), { timeout: 15_000 })
      .toContain('Nexus Markdown E2E');
  });

  await step('Search opens CodeMirror search UI and decorates the matching text', async () => {
    const editor = page.getByTestId('file-editor-overlay');
    await editor.getByTitle('Search').click();
    const searchPanel = editor.locator('.cm-panel.cm-search');
    await expect(searchPanel).toBeVisible();
    const searchInput = searchPanel.locator('input[name="search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Nexus Markdown E2E');
    await expect(searchInput).toHaveValue('Nexus Markdown E2E');
    await expect.poll(async () => editor.locator('.cm-searchMatch').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });
});

test('mobile upload progress stays inside the viewport and restores from Progress Display', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);
  const filename = 'mobile-progress-upload.bin';
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=260`, { method: 'POST' });

  try {
    await slowStep('a throttled upload exposes all floating controls without overflowing the Pixel viewport', async () => {
      const fileInput = page.getByTestId('file-manager-modal').getByTestId('file-upload-input');
      await fileInput.setInputFiles({
        name: filename,
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(12 * 1024 * 1024, 0x5a),
      });

      const popup = page.getByTestId('file-upload-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup).toContainText(filename);
      await expect(popup.getByTestId('file-upload-speed')).toBeVisible();
      await expect(popup.getByTestId('file-upload-progress-hide')).toBeVisible();
      await expect(popup.getByTestId('file-upload-cancel-all')).toBeVisible();
      await expect(popup.getByTestId('file-upload-resize-handle')).toBeVisible();

      const [popupBox, viewport] = await Promise.all([popup.boundingBox(), Promise.resolve(page.viewportSize())]);
      expect(popupBox).toBeTruthy();
      expect(viewport).toBeTruthy();
      expectBoxInsideViewport(popupBox!, viewport!);

      await popup.getByTestId('file-upload-progress-hide').click();
      await expect(popup).toBeHidden();
    });

    await step('Progress Display restores the hidden mobile upload window', async () => {
      const fileManagerModal = page.getByTestId('file-manager-modal');
      await fileManagerModal.click({ position: { x: 8, y: 8 } });
      await expect(fileManagerModal).toBeHidden();

      await page.getByTestId('transfer-progress-toggle').click();
      const progressDisplay = page.getByTestId('progress-display-modal');
      await expect(progressDisplay).toBeVisible();
      const source = progressDisplay.getByTestId('hidden-progress-source').filter({ hasText: filename });
      await expect(source).toBeVisible();
      await expect(source.getByTestId('hidden-progress-restore')).toBeEnabled();

      const progressPanel = progressDisplay.locator('.transfer-progress-panel');
      const [displayBox, viewport] = await Promise.all([progressPanel.boundingBox(), Promise.resolve(page.viewportSize())]);
      expect(displayBox).toBeTruthy();
      expect(viewport).toBeTruthy();
      expectBoxInsideViewport(displayBox!, viewport!);

      await source.getByTestId('hidden-progress-restore').click();
      await expect(progressDisplay).toBeHidden();
      const popup = page.getByTestId('file-upload-progress-popup');
      await expect(popup).toBeVisible();
      await popup.getByTestId('file-upload-cancel-all').click();
      await expect(popup).toBeHidden({ timeout: 10_000 });
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
