import { expect, test, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  openMobileProgressDisplay,
  reopenConnectedFileManager,
  resetTestSshFilesystem,
  E2E_SSH,
} from '../../support/ssh';
import { captureFunctionalScreenshot, functionalScreenshotsEnabled } from '../../support/functional-screenshots';
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
    await captureFunctionalScreenshot(page, 'mobile-context-menu.png');
  });

  await slowStep('tapping the flattened ZIP action writes the archive over SFTP', async () => {
    await page.getByTestId('file-manager-context-menu').getByText('Compress to zip', { exact: true }).click();
    await expect(fileManagerRow(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });
  });
});

test('mobile CodeMirror search opens from the editor header and highlights remote text', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);

  await slowStep('single tap opens a plain remote file in the mobile editor', async () => {
    await fileManagerRow(page, 'plainfile').click();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
    await expect.poll(async () => editor.locator('.cm-content').innerText(), { timeout: 15_000 })
      .toContain('plain-no-extension');
  });

  await step('Search opens CodeMirror search UI and decorates the matching text', async () => {
    const editor = page.getByTestId('file-editor-overlay');
    await editor.getByTitle('Search').click();
    const searchPanel = editor.locator('.cm-panel.cm-search');
    await expect(searchPanel).toBeVisible();
    const searchInput = searchPanel.locator('input[name="search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('plain-no-extension');
    await searchInput.press('End');
    await expect(searchInput).toHaveValue('plain-no-extension');
    await expect.poll(async () => editor.locator('.cm-searchMatch').count(), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await captureFunctionalScreenshot(page, 'mobile-editor-search.png');
  });
});

test('mobile Markdown preview edits and saves through CodeMirror', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);
  const filename = 'README-e2e.md';

  await slowStep('single tap keeps Markdown preview-first behavior on mobile', async () => {
    await fileManagerRow(page, filename).click();
    const preview = page.getByRole('dialog', { name: filename });
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(preview.locator('strong')).toHaveText('preview-ok');
    await expect(page.getByTestId('file-editor-overlay')).toHaveCount(0);
    await captureFunctionalScreenshot(page, 'mobile-markdown-preview.png');
  });

  await slowStep('Edit switches the preview to mobile CodeMirror and Save persists real SFTP bytes', async () => {
    const preview = page.getByRole('dialog', { name: filename });
    await preview.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(preview).toBeHidden();

    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
    await expect(editor.locator('.monaco-editor')).toHaveCount(0);

    const content = editor.locator('.cm-content');
    await expect.poll(async () => content.innerText(), { timeout: 15_000 }).toContain('Nexus Markdown E2E');
    await content.click();
    await content.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText('# Mobile Markdown E2E\n\n**mobile-save-ok**\n');
    await expect.poll(async () => content.innerText()).toContain('Mobile Markdown E2E');

    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toContainText('Save successful', { timeout: 15_000 });

    const remoteRead = await fetch(`${E2E_SSH.controlUrl}/read?name=${encodeURIComponent(filename)}`);
    expect(remoteRead.ok).toBeTruthy();
    const body = await remoteRead.json() as { base64: string };
    expect(Buffer.from(body.base64, 'base64').toString('utf8'))
      .toBe('# Mobile Markdown E2E\n\n**mobile-save-ok**\n');

    await editor.getByTestId('file-editor-close').click();
    await expect(editor).toBeHidden();
  });

  await step('reopening the file renders the just-saved Markdown preview', async () => {
    await fileManagerRow(page, filename).click();
    const preview = page.getByRole('dialog', { name: filename });
    await expect(preview.getByRole('heading', { name: 'Mobile Markdown E2E' })).toBeVisible({ timeout: 20_000 });
    await expect(preview.locator('strong')).toHaveText('mobile-save-ok');
  });
});

test('mobile virtual keyboard sends modified navigation escape sequences and consumes modifiers', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);

  const commandBar = page.getByTestId('command-input-bar');
  const commandInput = page.getByTestId('command-input');
  const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');
  await commandBar.locator('button:has(i.fa-keyboard)').click();
  const keyboard = page.locator('.mobile-virtual-keyboard.virtual-keyboard-bar');
  await expect(keyboard).toBeVisible();

  if (functionalScreenshotsEnabled()) {
    await commandInput.fill('clear');
    await commandInput.press('Enter');
    await commandInput.fill("printf 'Nexus mobile virtual keyboard\\n'");
    await commandInput.press('Enter');
    await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
      .toContain('Nexus mobile virtual keyboard');
    await captureFunctionalScreenshot(page, 'mobile-virtual-keyboard.png');

    const screenshotCtrl = keyboard.getByRole('button', { name: 'Ctrl', exact: true });
    const screenshotAlt = keyboard.getByRole('button', { name: 'Alt', exact: true });
    await screenshotCtrl.click();
    await screenshotAlt.click();
    await expect(screenshotCtrl).toHaveClass(/bg-primary/);
    await expect(screenshotAlt).toHaveClass(/bg-primary/);
    await captureFunctionalScreenshot(page, 'mobile-virtual-modifiers.png');
    await screenshotCtrl.click();
    await screenshotAlt.click();
    await expect(screenshotCtrl).not.toHaveClass(/bg-primary/);
    await expect(screenshotAlt).not.toHaveClass(/bg-primary/);
  }

  await slowStep('Alt+Left sends the xterm Alt cursor sequence and clears Alt after one key', async () => {
    await commandInput.fill("bytes=$(dd bs=1 count=6 2>/dev/null | od -An -t u1); printf 'ALT_LEFT_BYTES=%s\\n' \"$bytes\"");
    await commandInput.press('Enter');

    const alt = keyboard.getByRole('button', { name: 'Alt', exact: true });
    await alt.click();
    await expect(alt).toHaveClass(/bg-primary/);
    await keyboard.getByRole('button', { name: '←', exact: true }).click();
    await expect(alt).not.toHaveClass(/bg-primary/);
    await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
      .toMatch(/ALT_LEFT_BYTES=\s*27\s+91\s+49\s+59\s+51\s+68/);
  });

  await slowStep('Ctrl+Alt+Del sends the modified Delete sequence and clears both modifiers', async () => {
    await commandInput.fill("bytes=$(dd bs=1 count=6 2>/dev/null | od -An -t u1); printf 'CTRL_ALT_DEL_BYTES=%s\\n' \"$bytes\"");
    await commandInput.press('Enter');

    const ctrl = keyboard.getByRole('button', { name: 'Ctrl', exact: true });
    const alt = keyboard.getByRole('button', { name: 'Alt', exact: true });
    await ctrl.click();
    await alt.click();
    await expect(ctrl).toHaveClass(/bg-primary/);
    await expect(alt).toHaveClass(/bg-primary/);
    await keyboard.getByRole('button', { name: 'Del', exact: true }).click();
    await expect(ctrl).not.toHaveClass(/bg-primary/);
    await expect(alt).not.toHaveClass(/bg-primary/);
    await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
      .toMatch(/CTRL_ALT_DEL_BYTES=\s*27\s+91\s+51\s+59\s+55\s+126/);
  });
});

test('mobile spreadsheet preview keeps sheet controls inside the narrow viewport', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);
  const filename = 'preview.xlsx';

  await slowStep('single tap opens the spreadsheet preview with both sheet tabs visible', async () => {
    await fileManagerRow(page, filename).click();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const preview = dialog.getByTestId('spreadsheet-preview');
    const tabs = dialog.getByTestId('spreadsheet-sheet-tabs');
    await expect(preview).toBeVisible();
    await expect(tabs).toBeVisible();
    await expect(dialog.getByTestId('spreadsheet-sheet-0')).toHaveText('E2E');
    await expect(dialog.getByTestId('spreadsheet-sheet-1')).toHaveText('Second');

    const [panelBox, tabsBox, viewport] = await Promise.all([
      dialog.locator('section').boundingBox(),
      tabs.boundingBox(),
      Promise.resolve(page.viewportSize()),
    ]);
    expect(panelBox).toBeTruthy();
    expect(tabsBox).toBeTruthy();
    expect(viewport).toBeTruthy();
    expectBoxInsideViewport(panelBox!, viewport!);
    expectBoxInsideViewport(tabsBox!, viewport!);
  });

  await step('tapping the second sheet replaces the narrow-grid content and resets scroll offsets', async () => {
    const dialog = page.getByRole('dialog', { name: filename });
    const scroller = dialog.getByTestId('spreadsheet-scroll-container');
    const dimensions = await scroller.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await dialog.getByTestId('spreadsheet-sheet-1').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('spreadsheet-sheet-1')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await captureFunctionalScreenshot(page, 'mobile-spreadsheet-preview.png');
  });
});

test('mobile upload progress stays inside the viewport and restores from Progress Display', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);
  const filenames = ['mobile-progress-upload-a.bin', 'mobile-progress-upload-b.bin'];
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=1000`, { method: 'POST' });

  try {
    await slowStep('throttled uploads expose all floating controls without overflowing the Pixel viewport', async () => {
      const fileInput = page.getByTestId('file-manager-modal').getByTestId('file-upload-input');
      await fileInput.setInputFiles(filenames.map((name, index) => ({
        name,
        mimeType: 'application/octet-stream',
        buffer: Buffer.alloc(8 * 1024 * 1024, 0x5a + index),
      })));

      const popup = page.getByTestId('file-upload-progress-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup).toContainText(filenames[0]);
      await expect(popup).toContainText(filenames[1]);
      await expect(popup.getByTestId('file-upload-speed')).toBeVisible();
      await expect(popup.getByTestId('file-upload-progress-hide')).toBeVisible();
      await expect(popup.getByTestId('file-upload-cancel-all')).toBeVisible();
      await expect(popup.getByTestId('file-upload-resize-handle')).toBeVisible();

      const [popupBox, viewport] = await Promise.all([popup.boundingBox(), Promise.resolve(page.viewportSize())]);
      expect(popupBox).toBeTruthy();
      expect(viewport).toBeTruthy();
      expectBoxInsideViewport(popupBox!, viewport!);
      await captureFunctionalScreenshot(page, 'mobile-upload-progress.png');

      await popup.getByTestId('file-upload-progress-hide').click();
      await expect(popup).toBeHidden();
    });

    await step('Progress Display restores the hidden mobile upload window', async () => {
      // Close File Manager so the workspace toggle is accessible. The FileManager
      // instance remains mounted via v-show while Progress Display opens as an overlay.
      const progressDisplay = await openMobileProgressDisplay(page);
      const source = progressDisplay.getByTestId('hidden-progress-source').filter({ hasText: filenames[0] });
      await expect(source).toBeVisible();
      await expect(source.getByTestId('hidden-progress-restore')).toBeEnabled();

      const progressPanel = progressDisplay.locator('.transfer-progress-panel');
      const [displayBox, viewport] = await Promise.all([progressPanel.boundingBox(), Promise.resolve(page.viewportSize())]);
      expect(displayBox).toBeTruthy();
      expect(viewport).toBeTruthy();
      expectBoxInsideViewport(displayBox!, viewport!);

      await source.getByTestId('hidden-progress-restore').click();
      await expect(progressDisplay).toBeHidden();
      await reopenConnectedFileManager(page);
      const popup = page.getByTestId('file-upload-progress-popup');
      await expect(popup).toBeVisible();
      await popup.getByTestId('file-upload-cancel-all').click();
      await expect(popup).toBeHidden({ timeout: 10_000 });
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
