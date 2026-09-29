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
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
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

const pdfScroller = (dialog: Locator): Locator => dialog.getByRole('region', { name: /^PDF · \d+ pages$/ });
const pdfPage = (dialog: Locator, pageNumber: number): Locator => dialog.locator(`[data-pdf-page="${pageNumber}"]`);
const pdfCurrentPage = (dialog: Locator): Locator =>
  dialog.getByRole('spinbutton', { name: 'Current page', exact: true });
const pdfOutline = (dialog: Locator): Locator => dialog.getByRole('complementary', { name: 'Outline', exact: true });
const pdfZoomLabel = (dialog: Locator): Locator => dialog.getByTestId('pdf-zoom-label');
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

  const zoomInButton = dialog.getByTestId('pdf-zoom-in');
  const nextPageButton = dialog.getByTestId('pdf-next-page');
  const outlineToggle = dialog.getByTestId('pdf-outline-toggle');
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

  const outlineDrawer = dialog.getByTestId('pdf-outline-drawer');
  await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'true');
  await outlineToggle.click();
  await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'false');
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
  await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'true');
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
  await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'false');
  const scrollerBoxWithDrawer = await scroller.boundingBox();
  expect(scrollerBoxWithDrawer).toBeTruthy();
  expect(Math.abs(scrollerBoxWithDrawer!.width - scrollerBoxBeforeDrawer!.width)).toBeLessThanOrEqual(1);
  await pdfOutline(dialog).getByText('Second Chapter', { exact: true }).click();
  await expect(pdfCurrentPage(dialog)).toHaveValue('2');
  await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');

  await outlineToggle.click();
  await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'false');
  await expect(pdfOutline(dialog).getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await pdfOutline(dialog).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(outlineDrawer).toHaveAttribute('aria-hidden', 'true');
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
  // Keep both writes alive across screenshot capture, resize/drag, hide, and restore.
  // A one-second delay let screenshot-enabled CI finish the uploads before Cancel All.
  await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=15000`, { method: 'POST' });

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
        await expect(popup).toContainText('E2E SSH · Upload Tasks');
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

        const resizeHandle = popup.getByTestId('transfer-progress-resize');
        const resizeBox = await resizeHandle.boundingBox();
        expect(resizeBox).toBeTruthy();
        const resizeStart = { x: resizeBox!.x + resizeBox!.width / 2, y: resizeBox!.y + resizeBox!.height / 2 };
        await resizeHandle.dispatchEvent('pointerdown', {
          pointerId: 71,
          isPrimary: true,
          clientX: resizeStart.x,
          clientY: resizeStart.y,
          button: 0,
          bubbles: true,
        });
        await page.evaluate(
          ({ x, y }) =>
            window.dispatchEvent(
              new PointerEvent('pointermove', {
                pointerId: 71,
                isPrimary: true,
                clientX: x,
                clientY: y,
                bubbles: true,
              }),
            ),
          { x: resizeStart.x - 48, y: resizeStart.y - 56 },
        );
        await page.evaluate(() =>
          window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 71, isPrimary: true, bubbles: true })),
        );
        const resizedBox = await popup.boundingBox();
        expect(resizedBox).toBeTruthy();
        expectBoxInsideViewport(resizedBox!, viewport!);
        expect(resizedBox!.width).toBeLessThan(popupBox!.width);
        expect(resizedBox!.height).toBeLessThan(popupBox!.height);

        const header = popup.locator('.transfer-progress-header');
        const headerBox = await header.boundingBox();
        expect(headerBox).toBeTruthy();
        const dragStart = { x: headerBox!.x + 18, y: headerBox!.y + 18 };
        await header.dispatchEvent('pointerdown', {
          pointerId: 72,
          isPrimary: true,
          clientX: dragStart.x,
          clientY: dragStart.y,
          button: 0,
          bubbles: true,
        });
        await page.evaluate(() =>
          window.dispatchEvent(
            new PointerEvent('pointermove', { pointerId: 72, isPrimary: true, clientX: 0, clientY: 0, bubbles: true }),
          ),
        );
        await page.evaluate(() =>
          window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 72, isPrimary: true, bubbles: true })),
        );
        const draggedBox = await popup.boundingBox();
        expect(draggedBox).toBeTruthy();
        expectBoxInsideViewport(draggedBox!, viewport!);
        expect(draggedBox!.x).toBeGreaterThanOrEqual(7);
        expect(draggedBox!.x).toBeLessThanOrEqual(9);
        expect(draggedBox!.y).toBeGreaterThanOrEqual(7);
        expect(draggedBox!.y).toBeLessThanOrEqual(9);

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
      await captureFunctionalScreenshot(page, 'mobile-progress-display.png');

      await source.getByTestId('hidden-progress-restore').click();
      await expect(progressDisplay).toBeHidden();
      const popup = page.getByTestId('transfer-progress-center').filter({ visible: true }).first();
      await expect(popup).toBeVisible();
      const uploadTasks = popup.locator('[data-testid="transfer-progress-task"][data-task-kind="upload"]');
      await expect(uploadTasks).toHaveCount(filenames.length);
      await popup.getByTestId('transfer-progress-cancel-all').click();
      // Cancellation is two-phase while an in-flight SFTP WRITE is deliberately stalled.
      // Terminal rows may be retained as `cancelled` or pruned by the progress center before
      // this poll samples them, so accept either settled UI representation. The remote-file
      // assertions below remain the authoritative side-effect check.
      await expect
        .poll(
          async () => {
            const statuses = await uploadTasks.evaluateAll((tasks) =>
              tasks.map((task) => task.getAttribute('data-task-status')),
            );
            return statuses.length === 0 || statuses.every((status) => status === 'cancelled');
          },
          { timeout: 20_000 },
        )
        .toBe(true);

      await reopenConnectedFileManager(page);
      const fileManager = page.getByTestId('file-manager-modal').filter({ visible: true }).first();
      await fileManager.getByRole('button', { name: 'Refresh', exact: true }).click();
      for (const filename of filenames) {
        await expect(fileManagerRow(page, filename)).toHaveCount(0);
      }
    });
  } finally {
    await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' });
  }
});
