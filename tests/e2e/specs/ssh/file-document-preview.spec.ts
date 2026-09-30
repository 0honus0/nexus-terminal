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
import { slowStep, step } from '../../support/steps';
import { selectUiOption } from '../../support/ui-select';

const row = (page: Page, filename: string) => fileManagerRow(page, filename);
const documentPopup = (page: Page): Locator =>
  page.locator('[data-testid="document-popup"][data-workspace-active="true"]:visible').first();
const pdfScroller = (dialog: Locator): Locator => dialog.getByRole('region', { name: /^PDF · \d+ pages$/ });
const pdfCurrentPage = (dialog: Locator): Locator =>
  dialog.getByRole('spinbutton', { name: 'Current page', exact: true });
const visiblePdfPageCount = (dialog: Locator): Locator => dialog.locator('[data-testid="pdf-page-count"]:visible');
const pdfOutline = (dialog: Locator): Locator => dialog.getByRole('complementary', { name: 'Outline', exact: true });
const previewHorizontalScrollbar = (dialog: Locator): Locator =>
  dialog.getByRole('scrollbar', { name: 'Horizontal scroll', exact: true });
const spreadsheetScroller = (dialog: Locator): Locator =>
  dialog.getByRole('region', { name: 'Spreadsheet', exact: true });
const worksheetTabs = (dialog: Locator): Locator => dialog.getByRole('tablist', { name: 'Worksheet', exact: true });
const worksheetTab = (dialog: Locator, name: string): Locator =>
  worksheetTabs(dialog).getByRole('tab', { name, exact: true });
const docxScroller = (dialog: Locator): Locator => dialog.getByRole('region', { name: 'Word document', exact: true });
const spreadsheetRows = (dialog: Locator): Locator => spreadsheetScroller(dialog).locator('tbody > tr');
const spreadsheetPageRange = (dialog: Locator): Locator => dialog.getByText(/^Rows \d+–\d+ of \d+$/).first();
const previewSearchInput = (dialog: Locator): Locator =>
  dialog.getByRole('searchbox', { name: 'Search document...', exact: true });
const previewSearchControls = (dialog: Locator): Locator => previewSearchInput(dialog).locator('..');
const previewSearchCount = (dialog: Locator, value: string): Locator =>
  previewSearchControls(dialog).getByText(value, { exact: true });
const expectOverlayToCoverWorkspaceRail = async (
  page: Page,
  testId: 'file-manager-modal' | 'document-popup',
  expectedZIndex: number,
): Promise<void> => {
  const overlay = page.getByTestId(testId);
  await expect(overlay).toHaveCSS('z-index', String(expectedZIndex));
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const topmost = document.elementFromPoint(18, 160);
        return Boolean(topmost?.closest(`[data-testid="${id}"]`));
      }, testId),
    )
    .toBe(true);
};

async function closePreview(page: Page, _filename: string): Promise<void> {
  const popup = documentPopup(page);
  await popup.getByTestId('file-preview-view').getByTitle('Close preview', { exact: true }).click();
  await expect(popup).toBeHidden();
}

async function hidePreview(page: Page, _filename: string): Promise<void> {
  const popup = documentPopup(page);
  await popup.click({ position: { x: 2, y: 2 } });
  await expect(popup).toBeHidden();
}

test('PDF preview shows the user-visible 20 MB inline size limit', async ({ page, context }) => {
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
});

test('preview close button clears cached tabs when popup file editing is enabled', async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  expect(
    (
      await context.request.put('/api/v1/settings', {
        data: { showPopupFileEditor: true },
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
    const pdfDialog = documentPopup(page);
    await expect(pdfDialog.getByTestId('pdf-page-count')).toHaveText('3');
    await pdfDialog.click({ position: { x: 2, y: 2 } });
    await expect(pdfDialog).toBeHidden();

    await row(page, 'preview.xlsx').dblclick();
    const xlsxDialog = documentPopup(page);
    await expect(xlsxDialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    await expect(xlsxDialog.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(2);

    await xlsxDialog.getByTitle('Close preview', { exact: true }).click();
    await expect(xlsxDialog).toBeHidden();
    await expect(fileList).toBeFocused();
  });

  await slowStep('reopening after a close-button clear starts a fresh one-tab preview workspace', async () => {
    await row(page, 'preview.pdf').dblclick();
    const dialog = documentPopup(page);
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
        data: { showPopupFileEditor: false },
      })
    ).ok(),
  ).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await slowStep('build a two-tab preview workspace with PDF state', async () => {
    await row(page, 'preview.pdf').dblclick();
    const pdfDialog = documentPopup(page);
    await expect(pdfDialog.getByTestId('pdf-page-count')).toHaveText('3');
    await pdfDialog.getByTestId('pdf-next-page').click();
    await expect(pdfCurrentPage(pdfDialog)).toHaveValue('2');
    await hidePreview(page, 'preview.pdf');

    await row(page, 'preview.xlsx').dblclick();
    const xlsxDialog = documentPopup(page);
    await expect(xlsxDialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    await expect(xlsxDialog.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(2);
    await xlsxDialog.getByTitle('Close preview', { exact: true }).click();
    await expect(xlsxDialog).toBeHidden();
  });

  await slowStep('reopening restores both tabs and the previous PDF page', async () => {
    await row(page, 'preview.pdf').dblclick();
    const pdfDialog = documentPopup(page);
    await expect(pdfDialog.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(2);
    await expect(pdfCurrentPage(pdfDialog)).toHaveValue('2');
  });
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
    const dialog = documentPopup(page);
    await expect(dialog.locator('img')).toBeVisible();
    await hidePreview(page, filename);
  });

  await slowStep('open PDF and preserve page two while opening other previews', async () => {
    const filename = 'preview.pdf';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
    await dialog.getByTestId('pdf-next-page').click();
    await expect(pdfCurrentPage(dialog)).toHaveValue('2');
    await hidePreview(page, filename);
  });

  await slowStep('open XLSX and preserve the selected worksheet while opening DOCX', async () => {
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByTestId('spreadsheet-pagination')).toHaveCount(0);
    await worksheetTab(dialog, 'Second').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await hidePreview(page, filename);
  });

  await slowStep('DOCX opens in the same preview workspace with four switchable tabs', async () => {
    const filename = 'preview.docx';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });

    const tabs = dialog.getByTestId('file-preview-tabs');
    await expect(tabs.getByRole('tab')).toHaveCount(4);
    await expect(tabs.getByRole('tab', { name: '预览-测试.png' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'preview.pdf' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'preview.xlsx' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'preview.docx' })).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Control+f');
    const docxSearch = previewSearchInput(dialog);
    await expect(docxSearch).toBeFocused();
    await docxSearch.fill('Column C');
    await expect(previewSearchCount(dialog, '1/1')).toHaveText('1/1');
    await expect(dialog.locator('mark[data-preview-search-active]')).toHaveText('Column C');
    await page.keyboard.press('Escape');
    await expect(previewSearchInput(dialog)).toHaveCount(0);
    await expect(dialog).toBeVisible();

    await captureFunctionalScreenshot(page, 'file-manager-multi-preview-tabs.png', {
      viewport: { width: 1440, height: 900 },
    });

    await tabs.getByRole('tab', { name: 'preview.pdf' }).click();
    const pdfDialog = documentPopup(page);
    await expect(pdfCurrentPage(pdfDialog)).toHaveValue('2');

    await pdfDialog.getByTestId('file-preview-tabs').getByRole('tab', { name: 'preview.xlsx' }).click();
    const xlsxDialog = documentPopup(page);
    await expect(worksheetTab(xlsxDialog, 'Second')).toHaveAttribute('aria-selected', 'true');
    await expect(xlsxDialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();

    await xlsxDialog.getByTestId('file-preview-tabs').getByRole('tab', { name: '预览-测试.png' }).click();
    const imageDialog = documentPopup(page);
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

  const dragBottomScrollbar = async (scrollbar: Locator, scroller: Locator) => {
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
      const dialog = documentPopup(page);
      await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
      for (let index = 0; index < 5; index += 1) await dialog.getByTestId('pdf-zoom-in').click();
      const { scrollbar, scroller } = await dragBottomScrollbar(
        previewHorizontalScrollbar(dialog),
        pdfScroller(dialog),
      );
      await scrollbar.evaluate((element) => {
        element.scrollLeft = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
      const geometry = await scroller.evaluate((element) => {
        const pageElement = element.querySelector<HTMLElement>('[data-pdf-page]');
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
      await dialog.getByRole('button', { name: 'Fit width', exact: true }).click();
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
        .toBe(true);
      await expect(previewHorizontalScrollbar(dialog)).toBeHidden();
      await closePreview(page, filename);
    },
  );

  await slowStep('XLSX content and worksheet-tab horizontal scrolling remain separate controls', async () => {
    await page.setViewportSize({ width: 760, height: 860 });
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    const { scrollbar, scroller } = await dragBottomScrollbar(
      previewHorizontalScrollbar(dialog),
      spreadsheetScroller(dialog),
    );
    await captureFunctionalScreenshot(page, 'file-manager-preview-horizontal-scroll.png', {
      viewport: { width: 760, height: 860 },
    });

    const sheetTabs = worksheetTabs(dialog);
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
    const dialog = documentPopup(page);
    await expect(dialog.getByText('Compact A1', { exact: true })).toBeVisible();
    const scroller = spreadsheetScroller(dialog);
    await expect.poll(() => scroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(previewHorizontalScrollbar(dialog)).toBeHidden();

    const sheetTabs = worksheetTabs(dialog);
    await expect(sheetTabs.locator('button')).toHaveCount(1);
    await expect.poll(() => sheetTabs.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await closePreview(page, filename);
  });

  await slowStep('DOCX exposes clipped wide table content through the dedicated bottom scrollbar', async () => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const filename = 'preview.docx';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('Wide DOCX Column C', { exact: true })).toBeAttached();
    await dragBottomScrollbar(previewHorizontalScrollbar(dialog), docxScroller(dialog));
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
  await expectOverlayToCoverWorkspaceRail(page, 'file-manager-modal', 50);

  const replaceFixture = async (filename: string) => {
    const response = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(filename)}&variant=refresh`, {
      method: 'POST',
    });
    expect(response.ok).toBeTruthy();
  };

  await slowStep('Markdown keeps stale content until the preview refresh button reloads it', async () => {
    const filename = 'README-e2e.md';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await page.keyboard.press('Control+f');
    const markdownSearch = previewSearchInput(dialog);
    await expect(markdownSearch).toBeFocused();
    await markdownSearch.fill('Nexus Markdown E2E');
    await expect(dialog.locator('mark[data-preview-search-active]')).toHaveText('Nexus Markdown E2E');
    await markdownSearch.fill('Nexus Markdown Refreshed');
    await expect(previewSearchCount(dialog, '0/0')).toBeVisible();
    await replaceFixture(filename);
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown Refreshed' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Refresh preview', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown Refreshed' })).toBeVisible();
    await expect(dialog.locator('mark[data-preview-search-active]')).toHaveText('Nexus Markdown Refreshed');
    await markdownSearch.press('Escape');
    await expect(dialog.locator('mark[data-preview-search-match]')).toHaveCount(0);
    await closePreview(page, filename);
  });

  await slowStep('image refresh bypasses the cached inline URL and reloads changed pixels', async () => {
    const filename = '预览-测试.png';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    const image = dialog.locator('img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    await replaceFixture(filename);
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1);
    await dialog.getByRole('button', { name: 'Refresh preview', exact: true }).click();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(2);
    await closePreview(page, filename);
  });

  await slowStep('PDF refresh replaces the PDF.js document while preserving the current page', async () => {
    const filename = 'preview.pdf';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
    const outline = pdfOutline(dialog);
    await expect(outline).toBeVisible();
    await outline.getByText('Second Chapter', { exact: true }).click();
    await expect(pdfCurrentPage(dialog)).toHaveValue('2');
    await replaceFixture(filename);
    await expect(outline.getByText('Second Chapter', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Refresh preview', exact: true }).click();
    await expect(pdfCurrentPage(dialog)).toHaveValue('2');
    await expect(pdfOutline(dialog).getByText('Second Chapter Refreshed', { exact: true })).toBeVisible();
    await closePreview(page, filename);
  });

  await slowStep('XLSX refresh reparses the workbook while preserving the selected sheet', async () => {
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await worksheetTab(dialog, 'Second').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await replaceFixture(filename);
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Refresh preview', exact: true }).click();
    await expect(worksheetTab(dialog, 'Second')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.getByText('Second Sheet Refreshed', { exact: true })).toBeVisible();
    await closePreview(page, filename);
  });

  await slowStep('DOCX refresh rerenders the changed document in its existing tab', async () => {
    const filename = 'preview.docx';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
    await replaceFixture(filename);
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Refresh preview', exact: true }).click();
    await expect(dialog.getByText('Nexus DOCX Refreshed', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expectOverlayToCoverWorkspaceRail(page, 'document-popup', 1100);
    await expect(documentPopup(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.8)');
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
  const original = (await originalResponse.json()) as {
    language?: string;
    spreadsheetPreviewRowsPerPage?: number;
    spreadsheetPreviewMaxColumns?: number;
  };
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();

  try {
    await step('workspace settings persists spreadsheet rows per page and column limit', async () => {
      await page.goto('/settings');
      await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
      const rowsPerPage = page.locator('#spreadsheetPreviewRowsPerPage');
      const columnLimit = page.locator('#spreadsheetPreviewMaxColumns');
      await expect(rowsPerPage).toBeVisible();
      await expect(columnLimit).toBeVisible();
      await rowsPerPage.fill('24');
      await columnLimit.fill('6');

      const responsePromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
      );
      await page.getByTestId('spreadsheet-preview-pagination-save').click();
      expect((await responsePromise).ok()).toBeTruthy();

      await expect
        .poll(async () => {
          const persisted = await context.request.get('/api/v1/settings');
          const body = (await persisted.json()) as {
            spreadsheetPreviewRowsPerPage?: number;
            spreadsheetPreviewMaxColumns?: number;
          };
          return [body.spreadsheetPreviewRowsPerPage, body.spreadsheetPreviewMaxColumns];
        })
        .toEqual([24, 6]);
    });

    await slowStep('XLSX pagination shows every row page by page while retaining the column safety limit', async () => {
      await connectTestSshFromConnectionsPage(page, connectionId);
      await openConnectedFileManager(page);
      const filename = 'preview.xlsx';
      await row(page, filename).dblclick();
      const dialog = documentPopup(page);
      await expect(dialog).toBeVisible({ timeout: 20_000 });

      const pager = spreadsheetPageRange(dialog).locator('..');
      await expect(pager).toBeVisible();
      await expect(dialog.getByTestId('spreadsheet-current-page')).toHaveText('1');
      await expect(dialog.getByTestId('spreadsheet-page-count')).toHaveText('2');
      await expect(spreadsheetPageRange(dialog)).toContainText('1');
      await expect(spreadsheetPageRange(dialog)).toContainText('24');
      await expect(spreadsheetPageRange(dialog)).toContainText('40');

      await expect(dialog.getByText('E2E-F24', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E-A25', { exact: true })).toHaveCount(0);
      await expect(dialog.getByText('E2E-G1', { exact: true })).toHaveCount(0);
      await expect(spreadsheetRows(dialog)).toHaveCount(24);
      await expect(spreadsheetRows(dialog).first()).toHaveClass(/spreadsheet-header-row/);
      await expect(spreadsheetRows(dialog).first().locator('td')).toHaveCount(6);
      await captureFunctionalScreenshot(page, 'file-manager-spreadsheet-pagination.png', {
        viewport: { width: 1440, height: 900 },
      });

      await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(dialog.getByTestId('spreadsheet-current-page')).toHaveText('2');
      await expect(dialog.getByTestId('spreadsheet-page-count')).toHaveText('2');
      await expect(spreadsheetPageRange(dialog)).toContainText('25');
      await expect(spreadsheetPageRange(dialog)).toContainText('40');
      await expect(dialog.getByText('E2E-A25', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E-F40', { exact: true })).toBeVisible();
      await expect(dialog.getByText('E2E-A24', { exact: true })).toHaveCount(0);
      await expect(spreadsheetRows(dialog)).toHaveCount(16);
      await expect(spreadsheetRows(dialog).first()).not.toHaveClass(/spreadsheet-header-row/);
      const lastPageOverflow = await spreadsheetScroller(dialog).evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      );
      expect(lastPageOverflow).toBeLessThanOrEqual(2);
      await captureFunctionalScreenshot(page, 'file-manager-spreadsheet-compact-last-page.png', {
        viewport: { width: 1440, height: 900 },
      });

      await dialog.getByRole('button', { name: 'Previous page', exact: true }).click();
      await expect(dialog.getByTestId('spreadsheet-current-page')).toHaveText('1');
      await expect(dialog.getByTestId('spreadsheet-page-count')).toHaveText('2');
      await expect(spreadsheetRows(dialog)).toHaveCount(24);
      await closePreview(page, filename);
    });
  } finally {
    const restore: {
      language: string;
      spreadsheetPreviewRowsPerPage?: number;
      spreadsheetPreviewMaxColumns?: number;
    } = { language: original.language ?? 'en-US' };
    if (original.spreadsheetPreviewRowsPerPage !== undefined) {
      restore.spreadsheetPreviewRowsPerPage = original.spreadsheetPreviewRowsPerPage;
    }
    if (original.spreadsheetPreviewMaxColumns !== undefined) {
      restore.spreadsheetPreviewMaxColumns = original.spreadsheetPreviewMaxColumns;
    }
    expect((await context.request.put('/api/v1/settings', { data: restore })).ok()).toBeTruthy();
  }
});
