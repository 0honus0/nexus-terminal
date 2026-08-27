import { expect, test, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  E2E_SSH,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step, slowStep } from '../../support/steps';

const row = (page: Page, filename: string) => fileManagerRow(page, filename);
const DESKTOP_POPUP_SIZE_STORAGE_KEY = 'nexus_fileEditorDesktopPopupSize';

async function ctrlWheel(target: Locator, deltaY: number): Promise<void> {
  await target.dispatchEvent('wheel', { ctrlKey: true, deltaY, deltaMode: 0 });
}

async function closePreview(page: Page, filename: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: filename });
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  await expect(dialog).toBeHidden();
}

test('file previews and text editor protect historical file-opening regressions', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
  await page.evaluate((popupSizeKey) => {
    localStorage.removeItem('monacoEditorFontSize');
    localStorage.removeItem(popupSizeKey);
  }, DESKTOP_POPUP_SIZE_STORAGE_KEY);

  await step('extensionless text opens with its real remote content', async () => {
    await row(page, 'plainfile').dblclick();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor).toContainText('plainfile');
    const viewLines = editor.locator('.monaco-editor .view-lines');
    await expect.poll(async () => await viewLines.innerText()).toContain('plain-no-extension');
    await captureFunctionalScreenshot(page, 'file-manager-editor.png', { viewport: { width: 1440, height: 900 } });
  });

  await step('editor popup resize keeps Monaco visible and usable', async () => {
    const editor = page.getByTestId('file-editor-overlay');
    const popup = editor.locator('.editor-popup');
    const before = await popup.boundingBox();
    expect(before).toBeTruthy();
    const handle = editor.getByTestId('file-editor-resize-handle');
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 120, handleBox!.y + 90, { steps: 5 });
    await page.mouse.up();
    const after = await popup.boundingBox();
    expect(after).toBeTruthy();
    expect(after!.width).toBeGreaterThan(before!.width + 50);
    expect(after!.height).toBeGreaterThan(before!.height + 40);
    await expect(editor.locator('.monaco-editor')).toBeVisible();

    const persisted = await page.evaluate((popupSizeKey) => {
      const raw = localStorage.getItem(popupSizeKey);
      return raw ? JSON.parse(raw) as { width: number; height: number } : null;
    }, DESKTOP_POPUP_SIZE_STORAGE_KEY);
    expect(persisted).toBeTruthy();
    expect(persisted!.width).toBeCloseTo(after!.width, 0);
    expect(persisted!.height).toBeCloseTo(after!.height, 0);

    await editor.getByTestId('file-editor-close').click();
    await expect(editor).toBeHidden();
    await page.evaluate((popupSizeKey) => {
      localStorage.setItem(popupSizeKey, JSON.stringify({ width: 780, height: 520 }));
    }, DESKTOP_POPUP_SIZE_STORAGE_KEY);
    await row(page, 'plainfile').dblclick();
    await expect(editor).toBeVisible();
    const restored = await popup.boundingBox();
    expect(restored).toBeTruthy();
    expect(restored!.width).toBeCloseTo(780, 0);
    expect(restored!.height).toBeCloseTo(520, 0);
  });

  await step('editor Ctrl+wheel filters tiny opposing deltas instead of jittering font size', async () => {
    const editor = page.getByTestId('file-editor-overlay');
    const monaco = editor.locator('.monaco-editor');
    await expect(monaco).toBeVisible();

    await ctrlWheel(monaco, -20);
    expect(await page.evaluate(() => localStorage.getItem('monacoEditorFontSize'))).toBeNull();
    await ctrlWheel(monaco, 20);
    expect(await page.evaluate(() => localStorage.getItem('monacoEditorFontSize'))).toBeNull();

    await ctrlWheel(monaco, -80);
    const increased = Number(await page.evaluate(() => localStorage.getItem('monacoEditorFontSize')));
    expect(increased).toBeGreaterThan(0);

    await ctrlWheel(monaco, 20);
    await page.waitForTimeout(80);
    expect(Number(await page.evaluate(() => localStorage.getItem('monacoEditorFontSize')))).toBe(increased);
  });

  await slowStep('editing and saving an extensionless file persists over SFTP', async () => {
    const editor = page.getByTestId('file-editor-overlay');
    const monaco = editor.getByTestId('monaco-editor');
    await monaco.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText('plain-updated-through-editor\n');
    await expect.poll(async () => await editor.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.getByTestId('file-editor-close').click();
    await expect(editor).toBeHidden();

    await row(page, 'plainfile').dblclick();
    const reopened = page.getByTestId('file-editor-overlay');
    await expect.poll(async () => await reopened.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    await reopened.getByTestId('file-editor-close').click();
  });

  await slowStep('Refresh reloads content changed outside the Nexus editor', async () => {
    await row(page, 'refresh-e2e.txt').dblclick();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible();
    const viewLines = editor.locator('.monaco-editor .view-lines');
    await expect.poll(async () => viewLines.innerText()).toContain('refresh-original');

    const externalWrite = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent('refresh-e2e.txt')}`, { method: 'POST' });
    expect(externalWrite.ok).toBeTruthy();
    await editor.getByTestId('file-editor-refresh').click();
    await expect.poll(async () => (await viewLines.innerText()).replace(/\u00a0/g, ' '), { timeout: 15_000 })
      .toContain('created outside Nexus for refresh verification');
    await editor.getByTestId('file-editor-close').click();
  });

  await slowStep('encoding and line-ending controls decode UTF-16, switch previews, and save LF bytes', async () => {
    await row(page, 'utf16-crlf.txt').dblclick();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible();
    const encoding = editor.getByTestId('file-editor-encoding');
    const lineEnding = editor.getByTestId('file-editor-line-ending');
    const viewLines = editor.locator('.monaco-editor .view-lines');

    await expect.poll(async () => viewLines.innerText()).toContain('ENCODING_E2E');
    await expect(encoding).toHaveValue('utf-16le');
    await expect(lineEnding).toHaveValue('crlf');

    await encoding.selectOption('utf-8');
    await expect(encoding).toHaveValue('utf-8');
    await encoding.selectOption('utf-16le');
    await expect.poll(async () => viewLines.innerText()).toContain('SECOND_LINE');

    await lineEnding.selectOption('lf');
    await expect(lineEnding).toHaveValue('lf');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toContainText('Save successful', { timeout: 15_000 });

    const remoteRead = await fetch(`${E2E_SSH.controlUrl}/read?name=${encodeURIComponent('utf16-crlf.txt')}`);
    expect(remoteRead.ok).toBeTruthy();
    const body = await remoteRead.json() as { base64: string };
    const decoded = Buffer.from(body.base64, 'base64').toString('utf16le');
    expect(decoded).toContain('ENCODING_E2E\nSECOND_LINE\n');
    expect(decoded).not.toContain('\r\n');
    await editor.getByTestId('file-editor-close').click();
  });

  await slowStep('Unicode image filename streams and renders inline', async () => {
    const filename = '预览-测试.png';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog).toBeVisible();
    const image = dialog.locator('img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    const src = await image.getAttribute('src');
    expect(src).toContain(encodeURIComponent(filename));
    await closePreview(page, filename);
  });

  await slowStep('Markdown preview renders parsed content and exposes text editing', async () => {
    const filename = 'README-e2e.md';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(dialog.locator('strong')).toHaveText('preview-ok');
    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible();
    await expect.poll(async () => (await editor.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' '))
      .toContain('Nexus Markdown E2E');
    await editor.getByTestId('file-editor-close').click();
  });

  await slowStep('XLSX preview supports bottom sheet tabs and keyboard scrolling in both directions', async () => {
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    await expect(dialog.getByText('2026', { exact: true })).toBeVisible();

    const preview = dialog.getByTestId('spreadsheet-preview');
    const scroller = dialog.getByTestId('spreadsheet-scroll-container');
    const sheetTabs = dialog.getByTestId('spreadsheet-sheet-tabs');
    await expect(sheetTabs).toBeVisible();
    await expect(dialog.getByTestId('spreadsheet-sheet-0')).toHaveText('E2E');
    await expect(dialog.getByTestId('spreadsheet-sheet-1')).toHaveText('Second');

    const dimensions = await scroller.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

    await preview.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await dialog.getByTestId('spreadsheet-sheet-1').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('spreadsheet-sheet-1')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await closePreview(page, filename);
  });

  await step('stale symlink reports its own load error instead of reusing stale preview data', async () => {
    await expect(row(page, 'stale-image-link.png')).toBeVisible();
    await row(page, 'stale-image-link.png').dblclick();
    await expect(page.getByText('Failed to read file', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('file-editor-overlay')).toHaveCount(0);
    await expect(row(page, 'seed.txt')).toBeVisible();
  });
});

test('spreadsheet preview limits are configurable and clearly disclose truncated data', async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json() as Record<string, string | undefined>;
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();

  try {
    await step('workspace settings persists smaller spreadsheet preview row and column limits', async () => {
      await page.goto('/settings');
      await page.getByTestId('settings-tab-workspace').click();
      const setting = page.getByTestId('spreadsheet-preview-limit-setting');
      await expect(setting).toBeVisible();

      const rowLimit = setting.getByTestId('spreadsheet-preview-row-limit');
      const columnLimit = setting.getByTestId('spreadsheet-preview-column-limit');
      await rowLimit.fill('12');
      await columnLimit.fill('6');

      const responsePromise = page.waitForResponse((response) => (
        response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT'
      ));
      await setting.getByTestId('spreadsheet-preview-limit-save').click();
      expect((await responsePromise).ok()).toBeTruthy();

      await expect.poll(async () => {
        const persisted = await context.request.get('/api/v1/settings');
        const body = await persisted.json() as Record<string, string>;
        return [body.spreadsheetPreviewMaxRows, body.spreadsheetPreviewMaxColumns];
      }).toEqual(['12', '6']);
    });

    await slowStep('truncated XLSX preview identifies the real dimensions and the displayed limits', async () => {
      await connectTestSshFromConnectionsPage(page, connectionId);
      await openConnectedFileManager(page);
      const filename = 'preview.xlsx';
      await row(page, filename).dblclick();
      const dialog = page.getByRole('dialog', { name: filename });
      await expect(dialog).toBeVisible({ timeout: 20_000 });

      const notice = dialog.getByTestId('spreadsheet-preview-limit-notice');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('12');
      await expect(notice).toContainText('40');
      await expect(notice).toContainText('6');
      await expect(notice).toContainText('16');
      await expect(notice).toContainText(/not shown|additional data/i);

      await expect(dialog.getByText('E2E-F12', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E-G1', { exact: true })).toHaveCount(0);
      await expect(dialog.getByText('E2E-A13', { exact: true })).toHaveCount(0);
      await closePreview(page, filename);
    });
  } finally {
    const restore: Record<string, string> = { language: original.language ?? 'en-US' };
    if (original.spreadsheetPreviewMaxRows !== undefined) {
      restore.spreadsheetPreviewMaxRows = original.spreadsheetPreviewMaxRows;
    }
    if (original.spreadsheetPreviewMaxColumns !== undefined) {
      restore.spreadsheetPreviewMaxColumns = original.spreadsheetPreviewMaxColumns;
    }
    expect((await context.request.put('/api/v1/settings', { data: restore })).ok()).toBeTruthy();
  }
});
