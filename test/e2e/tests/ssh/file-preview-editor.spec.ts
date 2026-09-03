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

async function hidePreview(page: Page, filename: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: filename });
  await dialog.click({ position: { x: 2, y: 2 } });
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
      return raw ? (JSON.parse(raw) as { width: number; height: number }) : null;
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
    await expect
      .poll(async () => await editor.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.getByTestId('file-editor-close').click();
    await expect(editor).toBeHidden();

    await row(page, 'plainfile').dblclick();
    const reopened = page.getByTestId('file-editor-overlay');
    await expect
      .poll(async () => await reopened.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    await reopened.getByTestId('file-editor-close').click();
  });

  await slowStep('Refresh reloads content changed outside the Nexus editor', async () => {
    await row(page, 'refresh-e2e.txt').dblclick();
    const editor = page.getByTestId('file-editor-overlay');
    await expect(editor).toBeVisible();
    const viewLines = editor.locator('.monaco-editor .view-lines');
    await expect.poll(async () => viewLines.innerText()).toContain('refresh-original');

    const externalWrite = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent('refresh-e2e.txt')}`, {
      method: 'POST',
    });
    expect(externalWrite.ok).toBeTruthy();
    await editor.getByTestId('file-editor-refresh').click();
    await expect
      .poll(async () => (await viewLines.innerText()).replace(/\u00a0/g, ' '), { timeout: 15_000 })
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
    const body = (await remoteRead.json()) as { base64: string };
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
    await expect
      .poll(async () => (await editor.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' '))
      .toContain('Nexus Markdown E2E');
    await editor.getByTestId('file-editor-close').click();
  });

  await slowStep('PDF.js preview scrolls continuously with a narrow persistent desktop outline', async () => {
    const filename = 'preview.pdf';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    const preview = dialog.getByTestId('pdf-preview');
    const scroller = dialog.getByTestId('pdf-page-scroller');
    await expect(preview).toBeVisible();
    await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
    await expect(dialog.getByTestId('pdf-continuous-pages').locator('[data-pdf-page-number]')).toHaveCount(3);

    const firstPage = dialog.getByTestId('pdf-page-1');
    await expect(firstPage).toBeVisible();
    await expect
      .poll(() => firstPage.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width))
      .toBeGreaterThan(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    await page.keyboard.press('Control+f');
    const pdfSearch = dialog.getByTestId('preview-search-input');
    await expect(pdfSearch).toBeFocused();
    await pdfSearch.fill('target');
    await expect(dialog.getByTestId('preview-search-count')).toHaveText('1/2');
    await expect(dialog.getByTestId('pdf-current-page')).toHaveValue('2');
    await expect(dialog.locator('mark[data-preview-search-active]')).toHaveText('target');
    await dialog.getByTestId('preview-search-next').click();
    await expect(dialog.getByTestId('preview-search-count')).toHaveText('2/2');
    await expect(dialog.getByTestId('pdf-current-page')).toHaveValue('3');
    await dialog.getByTestId('preview-search-close').click();
    await expect(dialog.getByTestId('preview-search-bar')).toHaveCount(0);

    const secondPage = dialog.getByTestId('pdf-page-2');
    await scroller.evaluate(
      (element, top) => element.scrollTo({ top, behavior: 'auto' }),
      await secondPage.evaluate((element) => element.offsetTop),
    );
    await expect(dialog.getByTestId('pdf-current-page')).toHaveValue('2');

    const outlineToggle = dialog.getByTestId('pdf-outline-toggle');
    const outlineDrawer = dialog.getByTestId('pdf-outline-drawer');
    await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'false');
    await expect(outlineDrawer).toBeVisible();
    await expect(outlineToggle).toBeVisible();
    await expect(outlineToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByTestId('pdf-outline-close')).toBeHidden();
    const outlineBox = await outlineDrawer.boundingBox();
    const scrollerBox = await scroller.boundingBox();
    expect(outlineBox).toBeTruthy();
    expect(scrollerBox).toBeTruthy();
    expect(outlineBox!.width).toBeGreaterThanOrEqual(190);
    expect(outlineBox!.width).toBeLessThanOrEqual(224);
    expect(outlineBox!.x + outlineBox!.width).toBeLessThanOrEqual(scrollerBox!.x + 1);

    await outlineToggle.click();
    await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'true');
    await expect(outlineDrawer).toBeHidden();
    await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await scroller.boundingBox())?.width ?? 0).toBeGreaterThan(scrollerBox!.width + 180);

    await outlineToggle.click();
    await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'false');
    await expect(outlineDrawer).toBeVisible();
    await expect(outlineToggle).toHaveAttribute('aria-expanded', 'true');
    const outline = dialog.getByTestId('pdf-outline');
    await expect(outline.getByText('Introduction', { exact: true })).toBeVisible();
    await expect(outline.getByText('Second Chapter', { exact: true })).toBeVisible();
    await expect(outline.getByText('Details', { exact: true })).toBeVisible();
    await expect(dialog.getByTestId('pdf-sidebar-thumbnails-tab')).toHaveCount(0);
    await expect(dialog.locator('[data-testid^="pdf-thumbnail-"]')).toHaveCount(0);
    await outline.getByText('Second Chapter', { exact: true }).click();
    await expect(dialog.getByTestId('pdf-current-page')).toHaveValue('2');
    await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'false');
    await captureFunctionalScreenshot(page, 'file-manager-pdf-preview.png', { viewport: { width: 1440, height: 900 } });

    const zoom = dialog.getByTestId('pdf-zoom-label');
    const beforeZoom = await zoom.textContent();
    await dialog.getByTestId('pdf-zoom-in').click();
    await expect(zoom).not.toHaveText(beforeZoom ?? '');
    await dialog.getByTestId('pdf-fit-width').click();
    await expect(dialog.getByTestId('pdf-fit-width')).toHaveAttribute('aria-pressed', 'true');

    await closePreview(page, filename);
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
    await captureFunctionalScreenshot(page, 'file-manager-spreadsheet-preview.png', {
      viewport: { width: 1440, height: 900 },
    });

    await page.keyboard.press('Control+f');
    const spreadsheetSearch = dialog.getByTestId('preview-search-input');
    await expect(spreadsheetSearch).toBeFocused();
    await spreadsheetSearch.fill('Second Sheet E2E');
    await expect(dialog.getByTestId('preview-search-count')).toHaveText('1/1');
    await expect(dialog.getByTestId('spreadsheet-sheet-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('td.spreadsheet-search-active')).toHaveText('Second Sheet E2E');
    await dialog.getByTestId('preview-search-close').click();
    await dialog.getByTestId('spreadsheet-sheet-0').click();
    await expect(dialog.getByTestId('spreadsheet-sheet-0')).toHaveAttribute('aria-pressed', 'true');

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

test('preview workspace backdrop hiding preserves tabs across directories when popup file editing is enabled', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { showPopupFileEditor: 'true' },
      })
    ).ok(),
  ).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await slowStep('hide the first PDF by clicking the preview backdrop rather than closing its tab', async () => {
    const fileList = page.getByTestId('file-manager-modal').getByTestId('file-manager-list');
    await fileList.focus();
    await expect(fileList).toBeFocused();
    await row(page, 'preview.pdf').dblclick();
    const dialog = page.getByRole('dialog', { name: 'preview.pdf' });
    await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
    await dialog.click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeHidden();
    await expect(fileList).toBeFocused();
  });

  await slowStep('open a PDF in another directory without losing the hidden first preview tab', async () => {
    await row(page, 'folder-seed').click();
    await expect(row(page, 'second-preview.pdf')).toBeVisible();
    await row(page, 'second-preview.pdf').dblclick();
    const secondDialog = page.getByRole('dialog', { name: 'second-preview.pdf' });
    await expect(secondDialog.getByTestId('pdf-page-count')).toHaveText('3');
    const tabs = secondDialog.getByTestId('file-preview-tabs');
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(tabs.getByRole('tab', { name: 'preview.pdf', exact: true })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'second-preview.pdf', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await tabs.getByRole('tab', { name: 'preview.pdf', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'preview.pdf', exact: true }).getByTestId('pdf-page-count'),
    ).toHaveText('3');
  });
});

test('PDF preview rejects files above the shared 20 MB inline limit before downloading them', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const oversizedPdf = 'oversized-preview.pdf';
  const createFixture = await fetch(
    `${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(oversizedPdf)}&size=${21 * 1024 * 1024}`,
    { method: 'POST' },
  );
  expect(createFixture.ok).toBeTruthy();

  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
  await expect(row(page, oversizedPdf)).toBeVisible();

  const inlineRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/sftp/download?')) inlineRequests.push(request.url());
  });
  await row(page, oversizedPdf).dblclick();
  await expect(
    page.getByText('File is too large for inline preview (maximum 20.0 MB).', { exact: true }),
  ).toBeVisible();
  expect(inlineRequests).toEqual([]);
});

test('preview close button clears cached tabs when popup file editing is enabled', async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { showPopupFileEditor: 'true' },
      })
    ).ok(),
  ).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await slowStep('open two special-file previews and clear both with the workspace close button', async () => {
    const fileList = page.getByTestId('file-manager-modal').getByTestId('file-manager-list');
    await fileList.focus();
    await row(page, 'preview.pdf').dblclick();
    const pdfDialog = page.getByRole('dialog', { name: 'preview.pdf', exact: true });
    await expect(pdfDialog.getByTestId('pdf-page-count')).toHaveText('3');
    await pdfDialog.click({ position: { x: 2, y: 2 } });
    await expect(pdfDialog).toBeHidden();

    await row(page, 'preview.xlsx').dblclick();
    const xlsxDialog = page.getByRole('dialog', { name: 'preview.xlsx', exact: true });
    await expect(xlsxDialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    await expect(xlsxDialog.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(2);

    await xlsxDialog.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(xlsxDialog).toBeHidden();
    await expect(fileList).toBeFocused();
  });

  await slowStep('reopening after a close-button clear starts a fresh one-tab preview workspace', async () => {
    await row(page, 'preview.pdf').dblclick();
    const dialog = page.getByRole('dialog', { name: 'preview.pdf', exact: true });
    await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
    await expect(dialog.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(1);
    await expect(
      dialog.getByTestId('file-preview-tabs').getByRole('tab', { name: 'preview.pdf', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
  });
});

test('preview close button preserves cached tabs when popup file editing is disabled', async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { showPopupFileEditor: 'false' },
      })
    ).ok(),
  ).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await slowStep('build a two-tab preview workspace with PDF state', async () => {
    await row(page, 'preview.pdf').dblclick();
    const pdfDialog = page.getByRole('dialog', { name: 'preview.pdf', exact: true });
    await expect(pdfDialog.getByTestId('pdf-page-count')).toHaveText('3');
    await pdfDialog.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(pdfDialog.getByTestId('pdf-current-page')).toHaveValue('2');
    await hidePreview(page, 'preview.pdf');

    await row(page, 'preview.xlsx').dblclick();
    const xlsxDialog = page.getByRole('dialog', { name: 'preview.xlsx', exact: true });
    await expect(xlsxDialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    await expect(xlsxDialog.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(2);
    await xlsxDialog.getByRole('button', { name: 'Close preview', exact: true }).click();
    await expect(xlsxDialog).toBeHidden();
  });

  await slowStep('reopening restores both tabs and the previous PDF page', async () => {
    await row(page, 'preview.pdf').dblclick();
    const pdfDialog = page.getByRole('dialog', { name: 'preview.pdf', exact: true });
    await expect(pdfDialog.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(2);
    await expect(pdfDialog.getByTestId('pdf-current-page')).toHaveValue('2');
  });
});

test('hovering lazy preview formats prewarms their code without downloading remote file content', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  const remotePreviewRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/api/v1/sftp/download?')) remotePreviewRequests.push(url);
  });

  await page.evaluate(() => performance.clearResourceTimings());
  await openConnectedFileManager(page);

  const expectWarmResource = async (filename: string, resourcePattern: string) => {
    await row(page, filename).hover();
    await expect
      .poll(
        async () =>
          page.evaluate((patternSource) => {
            const pattern = new RegExp(patternSource, 'i');
            return performance.getEntriesByType('resource').some((entry) => pattern.test(entry.name));
          }, resourcePattern),
        { timeout: 8_000 },
      )
      .toBe(true);
  };

  await step('PDF runtime and component begin loading on row hover', async () => {
    await expectWarmResource('preview.pdf', '(?:PdfPreview|pdfjs-dist|/pdf-[^/]+\\.js)');
  });

  await step('XLSX parser begins loading on row hover', async () => {
    await expectWarmResource('preview.xlsx', 'xlsxPreviewParser');
  });

  await step('DOCX renderer begins loading on row hover', async () => {
    await expectWarmResource('preview.docx', 'DocxPreview');
  });

  await step('Markdown parser begins loading on row hover', async () => {
    await expectWarmResource('README-e2e.md', '(?:/marked\\.js|/dompurify\\.js|marked\\.esm|purify\\.es)');
  });

  expect(remotePreviewRequests).toEqual([]);
});

test('preview tabs keep image PDF XLSX and DOCX files open together and preserve per-file state', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await slowStep('open an image preview and hide the preview workspace without closing its tab', async () => {
    const filename = '预览-测试.png';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.locator('img')).toBeVisible();
    await hidePreview(page, filename);
  });

  await slowStep('open PDF and preserve page two while opening other previews', async () => {
    const filename = 'preview.pdf';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
    await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(dialog.getByTestId('pdf-current-page')).toHaveValue('2');
    await hidePreview(page, filename);
  });

  await slowStep('open XLSX and preserve the selected worksheet while opening DOCX', async () => {
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await dialog.getByTestId('spreadsheet-sheet-1').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await hidePreview(page, filename);
  });

  await slowStep('DOCX opens in the same preview workspace with four switchable tabs', async () => {
    const filename = 'preview.docx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });

    const tabs = dialog.getByTestId('file-preview-tabs');
    await expect(tabs.getByRole('tab')).toHaveCount(4);
    await expect(tabs.getByRole('tab', { name: '预览-测试.png' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'preview.pdf' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'preview.xlsx' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'preview.docx' })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Control+f');
    const docxSearch = dialog.getByTestId('preview-search-input');
    await expect(docxSearch).toBeFocused();
    await docxSearch.fill('Column C');
    await expect(dialog.getByTestId('preview-search-count')).toHaveText('1/1');
    await expect(dialog.locator('mark[data-preview-search-active]')).toHaveText('Column C');
    await page.keyboard.press('Escape');
    await expect(dialog.getByTestId('preview-search-bar')).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await captureFunctionalScreenshot(page, 'file-manager-multi-preview-tabs.png', {
      viewport: { width: 1440, height: 900 },
    });

    await tabs.getByRole('tab', { name: 'preview.pdf' }).click();
    const pdfDialog = page.getByRole('dialog', { name: 'preview.pdf' });
    await expect(pdfDialog.getByTestId('pdf-current-page')).toHaveValue('2');

    await pdfDialog.getByTestId('file-preview-tabs').getByRole('tab', { name: 'preview.xlsx' }).click();
    const xlsxDialog = page.getByRole('dialog', { name: 'preview.xlsx' });
    await expect(xlsxDialog.getByTestId('spreadsheet-sheet-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(xlsxDialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();

    await xlsxDialog.getByTestId('file-preview-tabs').getByRole('tab', { name: '预览-测试.png' }).click();
    const imageDialog = page.getByRole('dialog', { name: '预览-测试.png' });
    await expect(imageDialog.locator('img')).toBeVisible();
  });
});

test('PDF XLSX and DOCX previews use one content scrollbar while XLSX sheet tabs stay independent', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  const dragBottomScrollbar = async (dialog: Locator, scrollbarTestId: string, scrollerTestId: string) => {
    const scrollbar = dialog.getByTestId(scrollbarTestId);
    const scroller = dialog.getByTestId(scrollerTestId);
    await expect(scrollbar).toBeVisible();
    await expect.poll(() => scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect.soft(await scroller.evaluate((element) => getComputedStyle(element).overflowX)).toBe('hidden');
    await scrollbar.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    return { scrollbar, scroller };
  };

  await slowStep(
    'PDF exposes only the dedicated bottom content scrollbar when zoomed wider than the viewport',
    async () => {
      await page.setViewportSize({ width: 760, height: 860 });
      const filename = 'preview.pdf';
      await row(page, filename).dblclick();
      const dialog = page.getByRole('dialog', { name: filename });
      await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
      for (let index = 0; index < 5; index += 1) await dialog.getByTestId('pdf-zoom-in').click();
      const { scroller } = await dragBottomScrollbar(dialog, 'pdf-horizontal-scrollbar', 'pdf-page-scroller');
      await scroller.evaluate((element) => {
        element.scrollLeft = 0;
      });
      const geometry = await scroller.evaluate((element) => {
        const pageElement = element.querySelector<HTMLElement>('[data-testid^="pdf-page-"]');
        if (!pageElement) throw new Error('PDF page element is missing');
        const scrollerStyle = getComputedStyle(element);
        const scrollerRect = element.getBoundingClientRect();
        const pageRect = pageElement.getBoundingClientRect();
        return {
          scrollWidth: element.scrollWidth,
          pageWidth: pageRect.width,
          horizontalPadding:
            Number.parseFloat(scrollerStyle.paddingLeft) + Number.parseFloat(scrollerStyle.paddingRight),
          pageLeft: pageRect.left,
          scrollerLeft: scrollerRect.left,
        };
      });
      expect(geometry.scrollWidth).toBeGreaterThanOrEqual(
        Math.floor(geometry.pageWidth + geometry.horizontalPadding) - 2,
      );
      expect(geometry.pageLeft).toBeGreaterThanOrEqual(geometry.scrollerLeft - 1);
      await dialog.getByTestId('pdf-fit-width').click();
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
        .toBe(true);
      await expect(dialog.getByTestId('pdf-horizontal-scrollbar')).toBeHidden();
      await closePreview(page, filename);
    },
  );

  await slowStep('XLSX content and worksheet-tab horizontal scrolling remain separate controls', async () => {
    await page.setViewportSize({ width: 760, height: 860 });
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    const { scrollbar, scroller } = await dragBottomScrollbar(
      dialog,
      'spreadsheet-horizontal-scrollbar',
      'spreadsheet-scroll-container',
    );
    await captureFunctionalScreenshot(page, 'file-manager-preview-horizontal-scroll.png', {
      viewport: { width: 760, height: 860 },
    });

    const sheetTabs = dialog.getByTestId('spreadsheet-sheet-tabs');
    expect(await sheetTabs.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto');
    await sheetTabs.evaluate((element) => {
      element.style.width = '120px';
      element.style.maxWidth = '120px';
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => sheetTabs.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const tabsScrollLeft = await sheetTabs.evaluate((element) => element.scrollLeft);

    await scrollbar.evaluate((element) => {
      element.scrollLeft = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => sheetTabs.evaluate((element) => element.scrollLeft)).toBe(tabsScrollLeft);
    await closePreview(page, filename);
  });

  await slowStep('compact one-sheet XLSX hides horizontal controls when nothing exceeds the viewport', async () => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const filename = 'compact-preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByText('Compact A1', { exact: true })).toBeVisible();
    const scroller = dialog.getByTestId('spreadsheet-scroll-container');
    await expect.poll(() => scroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(dialog.getByTestId('spreadsheet-horizontal-scrollbar')).toBeHidden();

    const sheetTabs = dialog.getByTestId('spreadsheet-sheet-tabs');
    await expect(sheetTabs.locator('button')).toHaveCount(1);
    await expect.poll(() => sheetTabs.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await closePreview(page, filename);
  });

  await slowStep('DOCX exposes clipped wide table content through the dedicated bottom scrollbar', async () => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const filename = 'preview.docx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('Wide DOCX Column C', { exact: true })).toBeAttached();
    await dragBottomScrollbar(dialog, 'docx-horizontal-scrollbar', 'docx-preview-scroller');
  });
});

test('preview tabs force refresh externally changed Markdown image PDF XLSX and DOCX files', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  const replaceFixture = async (filename: string) => {
    const response = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(filename)}&variant=refresh`, {
      method: 'POST',
    });
    expect(response.ok).toBeTruthy();
  };

  await slowStep('Markdown keeps stale content until the preview refresh button reloads it', async () => {
    const filename = 'README-e2e.md';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await replaceFixture(filename);
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown Refreshed' })).toHaveCount(0);
    await dialog.getByTestId('file-preview-refresh').click();
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown Refreshed' })).toBeVisible();
    await closePreview(page, filename);
  });

  await slowStep('image refresh bypasses the cached inline URL and reloads changed pixels', async () => {
    const filename = '预览-测试.png';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    const image = dialog.locator('img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    await replaceFixture(filename);
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    await dialog.getByTestId('file-preview-refresh').click();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(2);
    await closePreview(page, filename);
  });

  await slowStep('PDF refresh replaces the PDF.js document while preserving the current page', async () => {
    const filename = 'preview.pdf';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
    const outline = dialog.getByTestId('pdf-outline');
    await expect(outline).toBeVisible();
    await outline.getByText('Second Chapter', { exact: true }).click();
    await expect(dialog.getByTestId('pdf-current-page')).toHaveValue('2');
    await replaceFixture(filename);
    await expect(outline.getByText('Second Chapter', { exact: true })).toBeVisible();
    await dialog.getByTestId('file-preview-refresh').click();
    await expect(dialog.getByTestId('pdf-current-page')).toHaveValue('2');
    await expect(
      dialog.getByTestId('pdf-outline').getByText('Second Chapter Refreshed', { exact: true }),
    ).toBeVisible();
    await closePreview(page, filename);
  });

  await slowStep('XLSX refresh reparses the workbook while preserving the selected sheet', async () => {
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await dialog.getByTestId('spreadsheet-sheet-1').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await replaceFixture(filename);
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await dialog.getByTestId('file-preview-refresh').click();
    await expect(dialog.getByTestId('spreadsheet-sheet-1')).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByText('Second Sheet Refreshed', { exact: true })).toBeVisible();
    await closePreview(page, filename);
  });

  await slowStep('DOCX refresh rerenders the changed document in its existing tab', async () => {
    const filename = 'preview.docx';
    await row(page, filename).dblclick();
    const dialog = page.getByRole('dialog', { name: filename });
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
    await replaceFixture(filename);
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible();
    await dialog.getByTestId('file-preview-refresh').click();
    await expect(dialog.getByText('Nexus DOCX Refreshed', { exact: true })).toBeVisible({ timeout: 20_000 });
    await captureFunctionalScreenshot(page, 'file-manager-preview-refresh.png', {
      viewport: { width: 1440, height: 900 },
    });
  });
});

test('spreadsheet preview rows per page are configurable and pagination exposes every row', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);

  const originalResponse = await context.request.get('/api/v1/settings');
  expect(originalResponse.ok()).toBeTruthy();
  const original = (await originalResponse.json()) as Record<string, string | undefined>;
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();

  try {
    await step('workspace settings persists spreadsheet rows per page and column limit', async () => {
      await page.goto('/settings');
      await page.getByTestId('settings-tab-workspace').click();
      const setting = page.getByTestId('spreadsheet-preview-pagination-setting');
      await expect(setting).toBeVisible();

      const rowsPerPage = setting.getByTestId('spreadsheet-preview-rows-per-page');
      const columnLimit = setting.getByTestId('spreadsheet-preview-column-limit');
      await rowsPerPage.fill('24');
      await columnLimit.fill('6');

      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await setting.getByTestId('spreadsheet-preview-pagination-save').click();
      expect((await responsePromise).ok()).toBeTruthy();

      await expect
        .poll(async () => {
          const persisted = await context.request.get('/api/v1/settings');
          const body = (await persisted.json()) as Record<string, string>;
          return [body.spreadsheetPreviewRowsPerPage, body.spreadsheetPreviewMaxColumns];
        })
        .toEqual(['24', '6']);
    });

    await slowStep('XLSX pagination shows every row page by page while retaining the column safety limit', async () => {
      await connectTestSshFromConnectionsPage(page, connectionId);
      await openConnectedFileManager(page);
      const filename = 'preview.xlsx';
      await row(page, filename).dblclick();
      const dialog = page.getByRole('dialog', { name: filename });
      await expect(dialog).toBeVisible({ timeout: 20_000 });

      const pager = dialog.getByTestId('spreadsheet-pagination');
      await expect(pager).toBeVisible();
      await expect(dialog.getByTestId('spreadsheet-current-page')).toHaveText('1');
      await expect(dialog.getByTestId('spreadsheet-page-count')).toHaveText('2');
      await expect(dialog.getByTestId('spreadsheet-page-range')).toContainText('1');
      await expect(dialog.getByTestId('spreadsheet-page-range')).toContainText('24');
      await expect(dialog.getByTestId('spreadsheet-page-range')).toContainText('40');

      await expect(dialog.getByText('E2E-F24', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E-A25', { exact: true })).toHaveCount(0);
      await expect(dialog.getByText('E2E-G1', { exact: true })).toHaveCount(0);
      await expect(dialog.getByTestId('spreadsheet-data-row')).toHaveCount(24);
      await expect(dialog.locator('.spreadsheet-header-row')).toHaveCount(1);
      await captureFunctionalScreenshot(page, 'file-manager-spreadsheet-pagination.png', {
        viewport: { width: 1440, height: 900 },
      });

      await dialog.getByTestId('spreadsheet-next-page').click();
      await expect(dialog.getByTestId('spreadsheet-current-page')).toHaveText('2');
      await expect(dialog.getByTestId('spreadsheet-page-range')).toContainText('25');
      await expect(dialog.getByTestId('spreadsheet-page-range')).toContainText('40');
      await expect(dialog.getByText('E2E-A25', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E-F40', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E-A24', { exact: true })).toHaveCount(0);
      await expect(dialog.getByTestId('spreadsheet-data-row')).toHaveCount(16);
      await expect(dialog.locator('.spreadsheet-header-row')).toHaveCount(0);
      await expect(dialog.getByTestId('spreadsheet-placeholder-row')).toHaveCount(0);
      const lastPageOverflow = await dialog
        .getByTestId('spreadsheet-scroll-container')
        .evaluate((element) => element.scrollHeight - element.clientHeight);
      expect(lastPageOverflow).toBeLessThanOrEqual(2);
      await captureFunctionalScreenshot(page, 'file-manager-spreadsheet-compact-last-page.png', {
        viewport: { width: 1440, height: 900 },
      });

      await dialog.getByTestId('spreadsheet-previous-page').click();
      await expect(dialog.getByTestId('spreadsheet-current-page')).toHaveText('1');
      await expect(dialog.getByTestId('spreadsheet-data-row')).toHaveCount(24);
      await closePreview(page, filename);
    });
  } finally {
    const restore: Record<string, string> = { language: original.language ?? 'en-US' };
    if (original.spreadsheetPreviewRowsPerPage !== undefined) {
      restore.spreadsheetPreviewRowsPerPage = original.spreadsheetPreviewRowsPerPage;
    }
    if (original.spreadsheetPreviewMaxColumns !== undefined) {
      restore.spreadsheetPreviewMaxColumns = original.spreadsheetPreviewMaxColumns;
    }
    expect((await context.request.put('/api/v1/settings', { data: restore })).ok()).toBeTruthy();
  }
});
