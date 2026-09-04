import { expect, test, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  closeConnectedFileManager,
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

async function connectMobileSsh(page: Page, request: Parameters<typeof loginAsInitialAdmin>[0]): Promise<void> {
  await loginAsInitialAdmin(request);
  await configureSshE2eSettings(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await expect(page.getByTestId('terminal')).toBeVisible({ timeout: 20_000 });
}

async function tapFileManagerRow(page: Page, filename: string): Promise<void> {
  const row = fileManagerRow(page, filename);
  await expect(row).toBeVisible();
  await row.locator('button[data-file-path]').click();
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

const pdfScroller = (dialog: Locator): Locator => dialog.getByRole('region', { name: /^PDF · \d+ pages$/ });
const pdfPage = (dialog: Locator, pageNumber: number): Locator => dialog.locator(`[data-pdf-page="${pageNumber}"]`);
const pdfCurrentPage = (dialog: Locator): Locator =>
  dialog.getByRole('spinbutton', { name: 'Current page', exact: true });
const pdfOutline = (dialog: Locator): Locator => dialog.getByRole('complementary', { name: 'Outline', exact: true });
const pdfZoomLabel = (dialog: Locator): Locator =>
  dialog
    .locator('.pdf-toolbar')
    .getByText(/^\d+%$/)
    .first();
const previewHorizontalScrollbar = (dialog: Locator): Locator =>
  dialog.getByRole('scrollbar', { name: 'Horizontal scroll', exact: true });
const spreadsheetScroller = (dialog: Locator): Locator =>
  dialog.getByRole('region', { name: 'Spreadsheet', exact: true });
const worksheetTabs = (dialog: Locator): Locator => dialog.getByRole('tablist', { name: 'Worksheet', exact: true });
const worksheetTab = (dialog: Locator, name: string): Locator =>
  worksheetTabs(dialog).getByRole('tab', { name, exact: true });
const docxScroller = (dialog: Locator): Locator => dialog.getByRole('region', { name: 'Word document', exact: true });

function expectBoxInsideViewport(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): void {
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function dragPreviewWithTouch(
  target: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await target.evaluate(
    (element, points) => {
      const makeTouch = (point: { x: number; y: number }) =>
        new Touch({
          identifier: 1,
          target: element,
          clientX: point.x,
          clientY: point.y,
          screenX: point.x,
          screenY: point.y,
          pageX: point.x,
          pageY: point.y,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        });

      const startTouch = makeTouch(points.from);
      element.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [startTouch],
          targetTouches: [startTouch],
          changedTouches: [startTouch],
        }),
      );

      const moveTouch = makeTouch(points.to);
      element.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [moveTouch],
          targetTouches: [moveTouch],
          changedTouches: [moveTouch],
        }),
      );

      element.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: [moveTouch],
        }),
      );
    },
    { from, to },
  );
}

async function pinchPreviewWithTouch(
  target: Locator,
  start: [{ x: number; y: number }, { x: number; y: number }],
  end: [{ x: number; y: number }, { x: number; y: number }],
): Promise<void> {
  await target.evaluate(
    (element, points) => {
      const makeTouch = (identifier: number, point: { x: number; y: number }) =>
        new Touch({
          identifier,
          target: element,
          clientX: point.x,
          clientY: point.y,
          screenX: point.x,
          screenY: point.y,
          pageX: point.x,
          pageY: point.y,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        });

      const startTouches = [makeTouch(1, points.start[0]), makeTouch(2, points.start[1])];
      element.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: startTouches,
          targetTouches: startTouches,
          changedTouches: startTouches,
        }),
      );

      const endTouches = [makeTouch(1, points.end[0]), makeTouch(2, points.end[1])];
      element.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: endTouches,
          targetTouches: endTouches,
          changedTouches: endTouches,
        }),
      );

      element.dispatchEvent(
        new TouchEvent('touchend', {
          bubbles: true,
          cancelable: true,
          touches: [],
          targetTouches: [],
          changedTouches: endTouches,
        }),
      );
    },
    { start, end },
  );
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
      'Compress to zip with password...',
      'Send to servers',
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

  await slowStep('single tap opens a full-screen mobile editor', async () => {
    await tapFileManagerRow(page, 'plainfile');
    const documentPopup = page.getByTestId('document-popup');
    const editor = documentPopup.getByTestId('file-editor-view');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
    await expect(documentPopup.getByTitle('Resize editor window', { exact: true })).toHaveCount(0);
    const popupBox = await documentPopup.getByRole('dialog').boundingBox();
    const viewport = page.viewportSize();
    expect(popupBox).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(Math.abs(popupBox!.width - viewport!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(popupBox!.height - viewport!.height)).toBeLessThanOrEqual(2);
    await expect
      .poll(async () => editor.locator('.cm-content').innerText(), { timeout: 15_000 })
      .toContain('plain-no-extension');
  });

  await step('Search opens CodeMirror search UI and decorates the matching text', async () => {
    const editor = page.getByTestId('document-popup').getByTestId('file-editor-view');
    await editor.getByTitle('Search').click();
    const searchPanel = editor.locator('.cm-panel.cm-search');
    await expect(searchPanel).toBeVisible();
    const searchInput = searchPanel.locator('input[name="search"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('plain-no-extension');
    await searchInput.press('End');
    await expect(searchInput).toHaveValue('plain-no-extension');
    await expect.poll(async () => editor.locator('.cm-searchMatch').count(), { timeout: 10_000 }).toBeGreaterThan(0);
    await captureFunctionalScreenshot(page, 'mobile-editor-search.png');
  });
});

test('mobile Markdown preview edits and saves through CodeMirror', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);
  const filename = 'README-e2e.md';

  await slowStep('single tap keeps Markdown preview-first behavior on mobile', async () => {
    await tapFileManagerRow(page, filename);
    const preview = page.getByTestId('document-popup');
    await expect(preview).toBeVisible({ timeout: 20_000 });
    await expect(preview.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(preview.locator('strong')).toHaveText('preview-ok');
    const editBox = await preview.getByRole('button', { name: 'Edit', exact: true }).boundingBox();
    expect(editBox).toBeTruthy();
    expect(editBox!.height).toBeGreaterThanOrEqual(40);
    await expect(page.getByTestId('document-popup').getByTestId('file-editor-view')).toBeHidden();
    await captureFunctionalScreenshot(page, 'mobile-markdown-preview.png');
  });

  await slowStep('Edit switches the preview to mobile CodeMirror and Save persists real SFTP bytes', async () => {
    const preview = page.getByTestId('document-popup');
    await preview.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(preview).toHaveAttribute('data-document-mode', 'editor');

    const editor = preview.getByTestId('file-editor-view');
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

    await preview.getByTitle('Close', { exact: true }).click();
    await expect(editor).toBeHidden();
  });

  await step('reopening the file renders the just-saved Markdown preview', async () => {
    await tapFileManagerRow(page, filename);
    const preview = page.getByTestId('document-popup');
    await expect(preview.getByRole('heading', { name: 'Mobile Markdown E2E' })).toBeVisible({ timeout: 20_000 });
    await expect(preview.locator('strong')).toHaveText('mobile-save-ok');
  });
});

test('mobile virtual keyboard sends modified navigation escape sequences and consumes modifiers', async ({
  page,
  context,
}) => {
  await connectMobileSsh(page, context.request);

  const commandInput = page.getByTestId('command-input');
  const terminalRows = page.getByTestId('terminal').locator('.xterm-rows');
  await page.getByRole('button', { name: '⌨', exact: true }).click();
  const keyboard = page.locator('.mobile-virtual-keyboard.virtual-keyboard-bar');
  await expect(keyboard).toBeVisible();

  if (functionalScreenshotsEnabled()) {
    await commandInput.fill('clear');
    await commandInput.press('Enter');
    await commandInput.fill("printf 'Nexus mobile virtual keyboard\\n'");
    await commandInput.press('Enter');
    await expect
      .poll(async () => terminalRows.innerText(), { timeout: 15_000 })
      .toContain('Nexus mobile virtual keyboard');
    await captureFunctionalScreenshot(page, 'mobile-virtual-keyboard.png');

    const screenshotCtrl = keyboard.getByRole('button', { name: 'Ctrl', exact: true });
    const screenshotAlt = keyboard.getByRole('button', { name: 'Alt', exact: true });
    await screenshotCtrl.click();
    await screenshotAlt.click();
    await expect(screenshotCtrl).toHaveAttribute('aria-pressed', 'true');
    await expect(screenshotAlt).toHaveAttribute('aria-pressed', 'true');
    await captureFunctionalScreenshot(page, 'mobile-virtual-modifiers.png');
    await screenshotCtrl.click();
    await screenshotAlt.click();
    await expect(screenshotCtrl).toHaveAttribute('aria-pressed', 'false');
    await expect(screenshotAlt).toHaveAttribute('aria-pressed', 'false');
  }

  await slowStep('Alt+Left sends the xterm Alt cursor sequence and clears Alt after one key', async () => {
    await commandInput.fill(
      'bytes=$(dd bs=1 count=6 2>/dev/null | od -An -t u1); printf \'ALT_LEFT_BYTES=%s\\n\' "$bytes"',
    );
    await commandInput.press('Enter');

    const alt = keyboard.getByRole('button', { name: 'Alt', exact: true });
    await alt.click();
    await expect(alt).toHaveAttribute('aria-pressed', 'true');
    await keyboard.getByRole('button', { name: '←', exact: true }).click();
    await expect(alt).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => terminalRows.innerText(), { timeout: 15_000 })
      .toMatch(/ALT_LEFT_BYTES=\s*27\s+91\s+49\s+59\s+51\s+68/);
  });

  await slowStep('Ctrl+Alt+Del sends the modified Delete sequence and clears both modifiers', async () => {
    await commandInput.fill(
      'bytes=$(dd bs=1 count=6 2>/dev/null | od -An -t u1); printf \'CTRL_ALT_DEL_BYTES=%s\\n\' "$bytes"',
    );
    await commandInput.press('Enter');

    const ctrl = keyboard.getByRole('button', { name: 'Ctrl', exact: true });
    const alt = keyboard.getByRole('button', { name: 'Alt', exact: true });
    await ctrl.click();
    await alt.click();
    await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
    await expect(alt).toHaveAttribute('aria-pressed', 'true');
    await keyboard.getByRole('button', { name: 'Del', exact: true }).click();
    await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
    await expect(alt).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => terminalRows.innerText(), { timeout: 15_000 })
      .toMatch(/CTRL_ALT_DEL_BYTES=\s*27\s+91\s+51\s+59\s+55\s+126/);
  });
});

test('mobile spreadsheet preview keeps sheet controls inside the narrow viewport', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);
  const filename = 'preview.xlsx';

  await slowStep('single tap opens the spreadsheet preview with both sheet tabs visible', async () => {
    await tapFileManagerRow(page, filename);
    const dialog = page.getByTestId('document-popup');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const preview = spreadsheetScroller(dialog).locator('..');
    const tabs = worksheetTabs(dialog);
    await expect(preview).toBeVisible();
    await expect(tabs).toBeVisible();
    await expect(worksheetTab(dialog, 'E2E')).toHaveText('E2E');
    await expect(worksheetTab(dialog, 'Second')).toHaveText('Second');
    await expect(previewHorizontalScrollbar(dialog)).toBeHidden();

    const [panelBox, tabsBox, viewport] = await Promise.all([
      dialog.getByRole('dialog').boundingBox(),
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
    const dialog = page.getByTestId('document-popup');
    const scroller = spreadsheetScroller(dialog);
    const dimensions = await scroller.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

    await scroller.evaluate((element) => {
      element.scrollLeft = 0;
      element.scrollTop = 0;
    });
    await dragPreviewWithTouch(scroller, { x: 280, y: 180 }, { x: 90, y: 170 });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    await scroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await worksheetTab(dialog, 'Second').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await expect(worksheetTab(dialog, 'Second')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await captureFunctionalScreenshot(page, 'mobile-spreadsheet-preview.png');
  });
});

test('mobile PDF continuously scrolls with an overlay outline drawer, pinch zoom, and content panning', async ({
  page,
  context,
}) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);

  const filename = 'preview.pdf';
  await tapFileManagerRow(page, filename);
  const dialog = page.getByTestId('document-popup');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByTestId('pdf-page-count')).toHaveText('3');
  await expect(dialog.locator('[data-pdf-page]')).toHaveCount(3);

  const closeButton = dialog.getByTitle('Close preview', { exact: true });
  const closeBox = await closeButton.boundingBox();
  expect(closeBox).toBeTruthy();
  expect(closeBox!.width).toBeGreaterThanOrEqual(40);
  expect(closeBox!.height).toBeGreaterThanOrEqual(40);

  const zoomInButton = dialog.getByTitle('Zoom in', { exact: true });
  const nextPageButton = dialog.getByTitle('Next page', { exact: true });
  const outlineToggle = dialog.getByTitle('Outline', { exact: true });
  await expect(zoomInButton).toBeVisible();
  await expect(nextPageButton).toBeVisible();
  await expect(outlineToggle).toBeVisible();
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');
  const closedOutlineToggleStyle = await outlineToggle.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  await expect(previewHorizontalScrollbar(dialog)).toBeHidden();

  const scroller = pdfScroller(dialog);
  await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const scrollerBoxBeforeDrawer = await scroller.boundingBox();
  expect(scrollerBoxBeforeDrawer).toBeTruthy();

  const outlineDrawer = pdfOutline(dialog);
  await expect(outlineDrawer).toBeHidden();
  await outlineToggle.click();
  await expect(outlineDrawer).toBeVisible();
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'true');
  await expect
    .poll(() =>
      outlineToggle.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, backgroundColor: style.backgroundColor };
      }),
    )
    .not.toEqual(closedOutlineToggleStyle);

  // Tapping the same toolbar button to hide the drawer must also clear its
  // visual active state. Touch browsers can otherwise leave :hover stuck.
  await outlineToggle.click();
  await expect(outlineDrawer).toBeHidden();
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(() =>
      outlineToggle.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, backgroundColor: style.backgroundColor };
      }),
    )
    .toEqual(closedOutlineToggleStyle);

  await outlineToggle.click();
  await expect(outlineDrawer).toBeVisible();
  const scrollerBoxWithDrawer = await scroller.boundingBox();
  expect(scrollerBoxWithDrawer).toBeTruthy();
  expect(Math.abs(scrollerBoxWithDrawer!.width - scrollerBoxBeforeDrawer!.width)).toBeLessThanOrEqual(1);
  await pdfOutline(dialog).getByText('Second Chapter', { exact: true }).click();
  await expect(pdfCurrentPage(dialog)).toHaveValue('2');
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');

  await outlineToggle.click();
  await expect(outlineDrawer).toBeVisible();
  await expect(pdfOutline(dialog).getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await pdfOutline(dialog).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(outlineDrawer).toBeHidden();
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');

  const thirdPage = pdfPage(dialog, 3);
  await scroller.evaluate(
    (element, top) => element.scrollTo({ top, behavior: 'auto' }),
    await thirdPage.evaluate((element) => element.offsetTop),
  );
  await expect(pdfCurrentPage(dialog)).toHaveValue('3');

  await zoomInButton.click();
  await expect.poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
  await scroller.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await dragPreviewWithTouch(scroller, { x: 185, y: 220 }, { x: 75, y: 212 });
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const zoomBeforePinch = Number((await pdfZoomLabel(dialog).innerText()).replace('%', ''));
  await pinchPreviewWithTouch(
    scroller,
    [
      { x: 130, y: 250 },
      { x: 220, y: 250 },
    ],
    [
      { x: 90, y: 250 },
      { x: 270, y: 250 },
    ],
  );
  await expect
    .poll(async () => Number((await pdfZoomLabel(dialog).innerText()).replace('%', '')))
    .toBeGreaterThan(zoomBeforePinch);
  await expect(dialog.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('mobile DOCX touch-pans wide content without a desktop scrollbar track', async ({ page, context }) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);

  const filename = 'preview.docx';
  await tapFileManagerRow(page, filename);
  const dialog = page.getByTestId('document-popup');
  await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
  const scroller = docxScroller(dialog);
  await expect.poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
  await expect(previewHorizontalScrollbar(dialog)).toBeHidden();
  await scroller.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await dragPreviewWithTouch(scroller, { x: 300, y: 220 }, { x: 90, y: 215 });
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test('mobile preview close button clears cached state when popup file editing is enabled', async ({
  page,
  context,
}) => {
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

  const filename = 'preview.xlsx';
  await tapFileManagerRow(page, filename);
  const dialog = page.getByTestId('document-popup');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const tabCloseButton = dialog.getByRole('button', { name: 'Close tab preview.xlsx', exact: true });
  const tabCloseBox = await tabCloseButton.boundingBox();
  expect(tabCloseBox).toBeTruthy();
  expect(tabCloseBox!.width).toBeGreaterThanOrEqual(40);
  expect(tabCloseBox!.height).toBeGreaterThanOrEqual(40);
  await worksheetTab(dialog, 'Second').click();
  await expect(worksheetTab(dialog, 'Second')).toHaveAttribute('aria-selected', 'true');

  await dialog.getByTitle('Close preview', { exact: true }).click();
  await expect(dialog).toBeHidden();

  await tapFileManagerRow(page, filename);
  const reopened = page.getByTestId('document-popup');
  await expect(reopened).toBeVisible({ timeout: 20_000 });
  await expect(reopened.getByTestId('file-preview-tabs').getByRole('tab')).toHaveCount(1);
  await expect(worksheetTab(reopened, 'E2E')).toHaveAttribute('aria-selected', 'true');
  await expect(worksheetTab(reopened, 'Second')).toHaveAttribute('aria-selected', 'false');
});

test('mobile upload progress stays inside the viewport and restores from Progress Display', async ({
  page,
  context,
}) => {
  await connectMobileSsh(page, context.request);
  await openConnectedFileManager(page);
  const filenames = ['mobile-progress-upload-a.bin', 'mobile-progress-upload-b.bin'];
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=1000`, { method: 'POST' });

  try {
    await slowStep(
      'throttled uploads expose all floating controls without overflowing the Pixel viewport',
      async () => {
        const fileInput = page.locator('input[type="file"][multiple]').filter({ visible: false }).last();
        await fileInput.setInputFiles(
          filenames.map((name, index) => ({
            name,
            mimeType: 'application/octet-stream',
            buffer: Buffer.alloc(8 * 1024 * 1024, 0x5a + index),
          })),
        );

        const popup = page.getByTestId('transfer-progress-center').filter({ visible: true }).first();
        await expect(popup).toBeVisible({ timeout: 10_000 });
        await expect(popup).toContainText(filenames[0]);
        await expect(popup).toContainText(filenames[1]);
        await expect(popup.getByTestId('transfer-progress-speed')).toBeVisible();
        await expect(popup.getByTestId('transfer-progress-hide')).toBeVisible();
        await expect(popup.getByTestId('transfer-progress-cancel-all')).toBeVisible();
        await expect(popup.getByTestId('transfer-progress-resize')).toBeVisible();

        const [popupBox, viewport] = await Promise.all([popup.boundingBox(), Promise.resolve(page.viewportSize())]);
        expect(popupBox).toBeTruthy();
        expect(viewport).toBeTruthy();
        expectBoxInsideViewport(popupBox!, viewport!);
        await captureFunctionalScreenshot(page, 'mobile-upload-progress.png');

        await closeConnectedFileManager(page);
        await popup.getByTestId('transfer-progress-hide').click();
        await expect(popup).toBeHidden();
      },
    );

    await step('Progress Display restores the hidden mobile upload window', async () => {
      // Close File Manager so the workspace toggle is accessible. The FileManager
      // instance remains mounted via v-show while Progress Display opens as an overlay.
      const progressDisplay = await openMobileProgressDisplay(page);
      const source = progressDisplay.getByTestId('hidden-progress-source').filter({ hasText: filenames[0] });
      await expect(source).toBeVisible();
      await expect(source.getByTestId('hidden-progress-restore')).toBeEnabled();

      const progressPanel = progressDisplay;
      const [displayBox, viewport] = await Promise.all([
        progressPanel.boundingBox(),
        Promise.resolve(page.viewportSize()),
      ]);
      expect(displayBox).toBeTruthy();
      expect(viewport).toBeTruthy();
      expectBoxInsideViewport(displayBox!, viewport!);

      await source.getByTestId('hidden-progress-restore').click();
      await expect(progressDisplay).toBeHidden();
      const popup = page.getByTestId('transfer-progress-center').filter({ visible: true }).first();
      await expect(popup).toBeVisible();
      await popup.getByTestId('transfer-progress-cancel-all').click();
      await expect
        .poll(() =>
          popup
            .locator('[data-testid="transfer-progress-task"][data-task-kind="upload"]')
            .evaluateAll((tasks) => tasks.map((task) => task.getAttribute('data-task-status'))),
        )
        .toEqual(filenames.map(() => 'cancelled'));
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
