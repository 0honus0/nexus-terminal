import { expect, test, type Locator, type Page } from '../../support/fixtures';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  E2E_SSH,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  reopenConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { step, slowStep } from '../../support/steps';
import { expectUiSelectValue, selectUiOption } from '../../support/ui-select';

const row = (page: Page, filename: string) => fileManagerRow(page, filename);
const DESKTOP_POPUP_SIZE_STORAGE_KEY = 'nexus.file-editor.desktop-popup-size';

const documentPopup = (page: Page): Locator =>
  page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
const closeFileManagerPopup = async (page: Page): Promise<void> => {
  const modal = page.getByRole('dialog', { name: 'File Manager', exact: true });
  if (!(await modal.isVisible().catch(() => false))) return;
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toBeHidden();
};
const editorView = (page: Page): Locator => documentPopup(page).locator('.file-editor-container');
const previewView = (page: Page): Locator => documentPopup(page).locator('[data-file-preview-dialog]');

const pdfScroller = (dialog: Locator): Locator => dialog.getByRole('region', { name: /^PDF · \d+ pages$/ });
const pdfPage = (dialog: Locator, pageNumber: number): Locator => dialog.locator(`[data-pdf-page="${pageNumber}"]`);
const pdfCurrentPage = (dialog: Locator): Locator =>
  dialog.getByRole('spinbutton', { name: 'Current page', exact: true });
const waitForScrollToSettle = async (scroller: Locator): Promise<void> => {
  await scroller.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let previous = element.scrollTop;
        let stableFrames = 0;
        const check = () => {
          const current = element.scrollTop;
          stableFrames = Math.abs(current - previous) < 0.5 ? stableFrames + 1 : 0;
          previous = current;
          if (stableFrames >= 3) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );
};
const visiblePdfPageCount = (dialog: Locator): Locator =>
  dialog.locator('.pdf-toolbar:visible .pdf-page-input + span > span');
const pdfOutline = (dialog: Locator): Locator => dialog.getByRole('complementary', { name: 'Outline', exact: true });
const pdfZoomLabel = (dialog: Locator): Locator =>
  dialog.getByRole('button', { name: 'Zoom out', exact: true }).locator('xpath=following-sibling::span[1]');
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
  const overlay =
    testId === 'document-popup'
      ? documentPopup(page)
      : page
          .getByRole('dialog', { name: 'File Manager', exact: true })
          .locator('xpath=ancestor::*[@data-ui="overlay"][1]');
  await expect(overlay).toHaveCSS('z-index', String(expectedZIndex));
  await expect
    .poll(() =>
      overlay.evaluate((element) => {
        const topmost = document.elementFromPoint(18, 160);
        return Boolean(topmost && element.contains(topmost));
      }),
    )
    .toBe(true);
};

async function openConnectionFromWorkspacePicker(page: Page, connectionId: number): Promise<void> {
  const tabs = page.locator('.terminal-tab-shell').getByRole('tab');
  const previousTabCount = await tabs.count();
  await page.getByRole('button', { name: 'New Connection Tab', exact: true }).click();
  const picker = page.getByRole('heading', { name: 'Connections & sessions', exact: true });
  await expect(picker).toBeVisible();
  const connection = page.locator(`.workspace-connection-list [data-connection-id="${connectionId}"]`);
  await expect(connection).toBeVisible();
  await connection.click();
  await expect(picker).toBeHidden();

  // Initial Workspace connections are provisional and are only published after the backend
  // confirms the SSH binding. The previous active session remains usable while that happens.
  await expect(tabs).toHaveCount(previousTabCount + 1, { timeout: 20_000 });
  await expect(page.locator('.terminal-tab-shell').getByRole('tab', { selected: true })).toHaveAttribute(
    'data-session-state',
    'connected',
    { timeout: 20_000 },
  );
  await expect(page.locator('.command-bar-command-input:visible')).toBeEnabled();
}

async function ctrlWheel(target: Locator, deltaY: number): Promise<void> {
  await target.dispatchEvent('wheel', { ctrlKey: true, deltaY, deltaMode: 0 });
}

async function closePreview(page: Page, _filename: string): Promise<void> {
  const popup = documentPopup(page);
  await previewView(page).getByTitle('Close preview', { exact: true }).click();
  await expect(popup).toBeHidden();
}

async function hidePreview(page: Page, _filename: string): Promise<void> {
  const popup = documentPopup(page);
  await popup.click({ position: { x: 2, y: 2 } });
  await expect(popup).toBeHidden();
}

for (const shared of [true, false] as const) {
  test(`file editor ${shared ? 'shares tabs across' : 'isolates tabs between'} real SSH workspaces`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    await loginAsInitialAdmin(context.request);
    await configureSshE2eSettings(context.request);
    const setting = await context.request.put('/api/v1/settings', { data: { shareFileEditorTabs: shared } });
    expect(setting.ok()).toBeTruthy();
    await resetTestSshFilesystem();
    const primaryId = await ensureTestSshConnection(context.request);
    const peerName = `E2E Editor ${shared ? 'Shared' : 'Scoped'} Peer`;

    const removePeer = async (): Promise<void> => {
      let list = await context.request.get('/api/v1/connections');
      for (let attempt = 0; attempt < 2 && !list.ok(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        list = await context.request.get('/api/v1/connections');
      }
      expect(list.ok()).toBeTruthy();
      const connections = (await list.json()) as Array<{ id: number; name?: string }>;
      for (const connection of connections.filter((item) => item.name === peerName)) {
        const removed = await context.request.delete(`/api/v1/connections/${connection.id}`);
        expect(removed.ok()).toBeTruthy();
      }
    };

    await removePeer();
    const created = await context.request.post('/api/v1/connections', {
      data: {
        name: peerName,
        type: 'SSH',
        host: E2E_SSH.host,
        port: E2E_SSH.port,
        username: E2E_SSH.username,
        authMethod: 'password',
        password: E2E_SSH.password,
      },
    });
    expect(created.status()).toBe(201);
    const peerId = ((await created.json()) as { connection: { id: number } }).connection.id;

    const terminalTabs = page.locator('.terminal-tab-shell').getByRole('tab');
    const editorTabs = () => editorView(page).locator('.file-editor-tabs').getByRole('tab');

    try {
      await step('open the same real remote file in the first workspace', async () => {
        await connectTestSshFromConnectionsPage(page, primaryId);
        await reopenConnectedFileManager(page);
        await row(page, 'plainfile').dblclick();
        await expect(editorView(page)).toBeVisible();
        await expect(editorTabs()).toHaveCount(1);
        if (shared) await expect(editorTabs().first()).toHaveAttribute('title', `${E2E_SSH.name}: /plainfile`);
        await page.keyboard.press('Escape');
        await expect(documentPopup(page)).toBeHidden();
        await closeFileManagerPopup(page);
      });

      await step('open the same path from a second live SSH workspace', async () => {
        await openConnectionFromWorkspacePicker(page, peerId);
        await reopenConnectedFileManager(page);
        await row(page, 'plainfile').dblclick();
        await expect(editorView(page)).toBeVisible();
        await expect(editorTabs()).toHaveCount(shared ? 2 : 1);
        if (shared) {
          await expect(editorTabs().last()).toHaveAttribute('title', `${peerName}: /plainfile`);
        }
        await page.keyboard.press('Escape');
        await expect(documentPopup(page)).toBeHidden();
        await closeFileManagerPopup(page);
      });

      await step('switch back and preserve the expected shared or session-local tab set', async () => {
        await terminalTabs.filter({ hasText: E2E_SSH.name }).first().click();
        await reopenConnectedFileManager(page);
        await row(page, 'plainfile').dblclick();
        await expect(editorView(page)).toBeVisible();
        await expect(editorTabs()).toHaveCount(shared ? 2 : 1);
      });
    } finally {
      await page.goto('/connections').catch(() => undefined);
      await removePeer();
      const restore = await context.request.put('/api/v1/settings', { data: { shareFileEditorTabs: true } });
      expect(restore.ok()).toBeTruthy();
    }
  });
}

test('SQLite database preview browses tables and searches the active table', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await row(page, 'preview.db').dblclick();
  const dialog = previewView(page);
  const database = dialog.locator('.database-scroll-container').locator('..');
  await expect(database).toBeVisible({ timeout: 20_000 });

  const tableTabs = database.getByRole('tablist', { name: 'Database tables', exact: true });
  await expect(tableTabs.getByRole('tab', { name: 'audit_log', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(database.locator('tbody > tr')).toHaveCount(3);
  await expect(database).toContainText('Alice signed in');

  await tableTabs.getByRole('tab', { name: 'users', exact: true }).click();
  await expect(database.locator('tbody > tr')).toHaveCount(4);
  await expect(database).toContainText('alice@example.com');
  await expect(database).toContainText('Shenzhen');

  await dialog.getByRole('button', { name: 'Search in document', exact: true }).click();
  const search = previewSearchInput(dialog);
  await search.fill('example.com');
  await expect(previewSearchCount(dialog, '1/3')).toBeVisible();
  await expect(database.locator('tbody > tr')).toHaveCount(3);
  await expect(database.locator('.database-search-match')).toHaveCount(3);

  await dialog.getByRole('button', { name: 'Next match', exact: true }).click();
  await expect(previewSearchCount(dialog, '2/3')).toBeVisible();

  await tableTabs.getByRole('tab', { name: 'audit_log', exact: true }).click();
  await expect(database.locator('tbody > tr')).toHaveCount(0);

  await search.fill('Carol');
  await expect(previewSearchCount(dialog, '1/1')).toBeVisible();
  await expect(database.locator('tbody > tr')).toHaveCount(1);
  await expect(database).toContainText('Carol changed profile');
});

test('file editor menus show complete encoding and line-ending choices', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);
  await row(page, 'seed.txt').dblclick();
  const editor = editorView(page);
  await expect(editor).toBeVisible();

  for (const [control, optionValue, selectedValue] of [
    ['.encoding-select:not(.line-ending-select)', 'utf-16le', 'utf-8'],
    ['.line-ending-select', 'crlf', 'lf'],
  ] as const) {
    await editor.locator(control).click();
    const option = page.locator(`[role="option"][data-value="${optionValue}"]`);
    await expect(option).toBeVisible();
    const triggerBox = await editor.locator(control).boundingBox();
    const menuBox = await page.locator('[data-ui="select-panel"][data-state="open"]').boundingBox();
    expect(triggerBox).toBeTruthy();
    expect(menuBox).toBeTruthy();
    expect(Math.abs(menuBox!.width - triggerBox!.width)).toBeLessThanOrEqual(1);
    const labelOverflow = await option
      .locator('.ui-select__item-label')
      .evaluate((label) => Math.max(0, label.scrollWidth - label.clientWidth));
    expect(labelOverflow).toBeLessThanOrEqual(1);
    await page.locator(`[role="option"][data-value="${selectedValue}"]`).click();
    await expectUiSelectValue(editor.locator(control).getByRole('combobox'), selectedValue);
  }
});

test('file previews and text editor protect historical file-opening regressions', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const [longLineFixture, largeTextFixture] = await Promise.all([
    fetch(`${E2E_SSH.controlUrl}/fixture?name=long-line-e2e.txt&size=8192`, { method: 'POST' }),
    fetch(`${E2E_SSH.controlUrl}/fixture?name=large-editor-e2e.txt&variant=large-text&size=${3 * 1024 * 1024}`, {
      method: 'POST',
    }),
  ]);
  expect(longLineFixture.ok).toBeTruthy();
  expect(largeTextFixture.ok).toBeTruthy();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await step('extensionless text opens with a compact legacy loading state and its real remote content', async () => {
    const delayResponse = await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=900`, { method: 'POST' });
    expect(delayResponse.ok).toBeTruthy();
    try {
      await row(page, 'plainfile').dblclick();
      const loading = page.locator('.editor-loading:visible').first();
      await expect(loading).toBeVisible();
      await expect(loading).toContainText(/loading/i);
      await expect(loading.locator('.animate-spin')).toHaveCount(0);
    } finally {
      await fetch(`${E2E_SSH.controlUrl}/sftp/read-delay?ms=0`, { method: 'POST' });
    }
    const editor = editorView(page);
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor).toContainText('plainfile');
    const viewLines = editor.locator('.monaco-editor .view-lines');
    await expect.poll(async () => await viewLines.innerText()).toContain('plain-no-extension');
    await expectOverlayToCoverWorkspaceRail(page, 'document-popup', 1000);
    await captureFunctionalScreenshot(page, 'file-manager-editor.png', { viewport: { width: 1440, height: 900 } });
  });

  await step('desktop text editor exposes Monaco search from the editor toolbar', async () => {
    const editor = editorView(page);
    const searchButton = editor.getByRole('button', { name: 'Search in document', exact: true });
    await expect(searchButton).toBeVisible();
    await searchButton.click();
    const findWidget = editor.locator('.monaco-editor .find-widget');
    await expect(findWidget).toBeVisible();
    const findInput = findWidget.getByRole('textbox').first();
    await findInput.fill('plain-no-extension');
    await expect(findInput).toHaveValue('plain-no-extension');
    await page.keyboard.press('Escape');
    // Monaco keeps the find widget mounted for reuse and marks the closed widget inaccessible
    // instead of removing it from layout. Assert the component's authoritative closed state.
    await expect(findWidget).toHaveAttribute('aria-hidden', 'true');
  });

  await step('editor popup resize keeps Monaco visible and usable', async () => {
    const editor = editorView(page);
    const popup = documentPopup(page).getByRole('dialog');
    const before = await popup.boundingBox();
    expect(before).toBeTruthy();
    const handle = documentPopup(page).getByTitle('Resize editor window', { exact: true });
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

    const resizedWidth = after!.width;
    const resizedHeight = after!.height;
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
    await expect(editor).toBeHidden();
    await row(page, 'plainfile').dblclick();
    await expect(editor).toBeVisible();
    const restored = await popup.boundingBox();
    expect(restored).toBeTruthy();
    expect(restored!.width).toBeCloseTo(resizedWidth, 0);
    expect(restored!.height).toBeCloseTo(resizedHeight, 0);
  });

  await step('editor Ctrl+wheel filters tiny opposing deltas instead of jittering font size', async () => {
    const editor = editorView(page);
    const monaco = editor.locator('.monaco-editor');
    await expect(monaco).toBeVisible();

    const renderedFontSize = async () =>
      monaco.locator('.view-lines').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    const initialFontSize = await renderedFontSize();

    await ctrlWheel(monaco, -20);
    expect(await renderedFontSize()).toBe(initialFontSize);
    await ctrlWheel(monaco, 20);
    expect(await renderedFontSize()).toBe(initialFontSize);

    await ctrlWheel(monaco, -80);
    const increased = await renderedFontSize();
    expect(increased).toBeGreaterThan(initialFontSize);

    await ctrlWheel(monaco, 20);
    await page.waitForTimeout(80);
    expect(await renderedFontSize()).toBe(increased);
  });

  await step(
    'rapid editor Ctrl+wheel zoom applies each step once and stays stable after preference write-back',
    async () => {
      const editor = editorView(page);
      const monaco = editor.locator('.monaco-editor');
      const viewLines = monaco.locator('.view-lines');
      const renderedFontSize = async () =>
        viewLines.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

      const before = await renderedFontSize();
      const observed: number[] = [];
      for (let index = 0; index < 3; index += 1) {
        await ctrlWheel(monaco, -80);
        observed.push(await renderedFontSize());
      }
      expect(observed[0]).toBeGreaterThan(before);
      expect(observed[1]).toBeGreaterThan(observed[0]!);
      expect(observed[2]).toBeGreaterThan(observed[1]!);

      const latest = observed[2]!;
      await page.waitForTimeout(500);
      expect(await renderedFontSize()).toBe(latest);
    },
  );

  await slowStep('editing and saving an extensionless file persists over SFTP', async () => {
    const editor = editorView(page);
    const monaco = editor.locator('.monaco-editor');
    await monaco.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await page.keyboard.insertText('plain-updated-through-editor\n');
    await expect
      .poll(async () => await editor.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    const writeDelayMs = process.env.NEXUS_E2E_EDITOR_SAVE_DELAY === '1' ? 60 : 0;
    expect((await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=${writeDelayMs}`, { method: 'POST' })).ok).toBe(
      true,
    );
    try {
      const started = performance.now();
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await expect
        .poll(() => readFile(path.resolve('.tmp/ssh-root/plainfile'), 'utf8'))
        .toBe('plain-updated-through-editor\n');
      console.log(
        '[editor save profile]',
        JSON.stringify({ writeDelayMs, verifiedSaveMs: performance.now() - started }),
      );
    } finally {
      expect((await fetch(`${E2E_SSH.controlUrl}/sftp/write-delay?ms=0`, { method: 'POST' })).ok).toBe(true);
    }
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
    await expect(editor).toBeHidden();

    await row(page, 'plainfile').dblclick();
    const reopened = editorView(page);
    await expect
      .poll(async () => await reopened.locator('.monaco-editor .view-lines').innerText())
      .toContain('plain-updated-through-editor');
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
  });

  await slowStep('Refresh reloads content changed outside the Nexus editor', async () => {
    await row(page, 'refresh-e2e.txt').dblclick();
    const editor = editorView(page);
    await expect(editor).toBeVisible();
    const viewLines = editor.locator('.monaco-editor .view-lines');
    await expect.poll(async () => viewLines.innerText()).toContain('refresh-original');

    const externalWrite = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent('refresh-e2e.txt')}`, {
      method: 'POST',
    });
    expect(externalWrite.ok).toBeTruthy();
    await editor.getByTitle('Refresh remote file', { exact: true }).click();
    await expect
      .poll(async () => (await viewLines.innerText()).replace(/\u00a0/g, ' '), { timeout: 15_000 })
      .toContain('created outside Nexus for refresh verification');
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
  });

  await step('long logical lines soft-wrap without inventing extra file line numbers', async () => {
    await row(page, 'long-line-e2e.txt').dblclick();
    const editor = editorView(page);
    await expect(editor).toBeVisible();
    const monaco = editor.locator('.monaco-editor');
    await expect
      .poll(() => monaco.locator('.view-lines').evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeLessThanOrEqual(1);
    await expect.poll(async () => monaco.locator('.view-lines .view-line').count()).toBeGreaterThan(1);
    const renderedLineNumbers = (await monaco.locator('.margin-view-overlays .line-numbers').allTextContents())
      .map((value) => value.trim())
      .filter(Boolean);
    expect(renderedLineNumbers).toEqual(['1']);
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
  });

  await slowStep('large text opens in lightweight editor mode without the duplicate raw-file payload', async () => {
    await row(page, 'large-editor-e2e.txt').dblclick();
    const editor = editorView(page);
    await expect(editor).toBeVisible({ timeout: 20_000 });
    const monaco = editor.locator('.monaco-editor');
    await expect(monaco.locator('.minimap')).toBeHidden();
    await expect
      .poll(async () => await monaco.locator('.view-lines').innerText(), { timeout: 20_000 })
      .toContain('large-file-performance-line');
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
  });

  await slowStep('encoding and line-ending controls decode UTF-16, switch previews, and save LF bytes', async () => {
    await row(page, 'utf16-crlf.txt').dblclick();
    const editor = editorView(page);
    await expect(editor).toBeVisible();
    const encoding = editor.locator('.encoding-select:not(.line-ending-select)').getByRole('combobox');
    const lineEnding = editor.locator('.line-ending-select').getByRole('combobox');
    const viewLines = editor.locator('.monaco-editor .view-lines');

    await expect.poll(async () => viewLines.innerText()).toContain('ENCODING_E2E');
    await expectUiSelectValue(encoding, 'utf-16le');
    await expectUiSelectValue(lineEnding, 'crlf');

    await selectUiOption(encoding, 'utf-8');
    await expectUiSelectValue(encoding, 'utf-8');
    await selectUiOption(encoding, 'utf-16le');
    await expect.poll(async () => viewLines.innerText()).toContain('SECOND_LINE');

    await selectUiOption(lineEnding, 'lf');
    await expectUiSelectValue(lineEnding, 'lf');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toContainText('Save successful', { timeout: 15_000 });
    await expect
      .poll(async () => (await readFile(path.resolve('.tmp/ssh-root/utf16-crlf.txt'))).toString('hex'))
      .toBe(Buffer.from('\uFEFFENCODING_E2E\nSECOND_LINE\n', 'utf16le').toString('hex'));

    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
    await row(page, 'utf16-crlf.txt').dblclick();
    const reopened = editorView(page);
    await expect(reopened).toBeVisible();
    await expectUiSelectValue(reopened.locator('.line-ending-select').getByRole('combobox'), 'lf');
    await expect.poll(async () => reopened.locator('.monaco-editor .view-lines').innerText()).toContain('SECOND_LINE');
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
  });

  await slowStep('low-confidence legacy Chinese bytes keep the GB18030 fallback', async () => {
    await row(page, 'gb18030-low-confidence.txt').dblclick();
    const editor = editorView(page);
    await expect(editor).toBeVisible();
    await expectUiSelectValue(
      editor.locator('.encoding-select:not(.line-ending-select)').getByRole('combobox'),
      'gb18030',
    );
    await expect.poll(async () => editor.locator('.monaco-editor .view-lines').innerText()).toContain('中文测试');
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
  });

  await slowStep('Unicode image filename streams and renders inline', async () => {
    const filename = '预览-测试.png';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog).toBeVisible();
    const image = dialog.locator('img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    await expect(image).toHaveAttribute('alt', filename);
    await closePreview(page, filename);
  });

  await slowStep('Markdown preview renders parsed content and exposes text editing', async () => {
    const filename = 'README-e2e.md';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(dialog.locator('strong')).toHaveText('preview-ok');

    const workspaceUrl = page.url();
    await dialog.getByRole('link', { name: 'Open linked Markdown', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Linked Markdown E2E', exact: true })).toBeVisible();
    await expect(dialog).toContainText('linked-preview-ok');
    await expect(
      dialog
        .getByRole('tablist', { name: 'Open previews', exact: true })
        .getByRole('tab', { name: 'linked-e2e.md', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(page.url()).toBe(workspaceUrl);

    await dialog
      .getByRole('tablist', { name: 'Open previews', exact: true })
      .getByRole('tab', { name: filename, exact: true })
      .click();
    await expect(dialog.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'External docs', exact: true })).toHaveAttribute(
      'href',
      'https://example.com/docs.md',
    );

    await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = editorView(page);
    await expect(editor).toBeVisible();
    await expect
      .poll(async () => (await editor.locator('.monaco-editor .view-lines').innerText()).replace(/\u00a0/g, ' '))
      .toContain('Nexus Markdown E2E');
    await documentPopup(page).getByTitle('Close Editor', { exact: true }).first().click();
  });

  await slowStep('PDF.js preview scrolls continuously with a narrow persistent desktop outline', async () => {
    const filename = 'preview.pdf';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    const preview = dialog.locator('.pdf-preview-root');
    const scroller = pdfScroller(dialog);
    await expect(preview).toBeVisible();
    await expect(visiblePdfPageCount(dialog)).toHaveText('3');
    await expect(dialog.locator('[data-pdf-page]')).toHaveCount(3);

    const firstPage = pdfPage(dialog, 1);
    await expect(firstPage).toBeVisible();
    await expect
      .poll(() => firstPage.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width))
      .toBeGreaterThan(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

    await page.keyboard.press('Control+f');
    const pdfSearch = previewSearchInput(dialog);
    await expect(pdfSearch).toBeFocused();
    const searchCornerMetrics = await previewSearchControls(dialog).evaluate((element) => ({
      barRadius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
      inputRadius: Number.parseFloat(
        getComputedStyle(element.querySelector<HTMLInputElement>('input')!).borderTopLeftRadius,
      ),
    }));
    expect(searchCornerMetrics.barRadius).toBeGreaterThan(0);
    expect(searchCornerMetrics.inputRadius).toBeGreaterThan(0);
    await pdfSearch.fill('target');
    await expect(previewSearchCount(dialog, '1/2')).toHaveText('1/2');
    await expect(pdfCurrentPage(dialog)).toHaveValue('2');
    await expect(dialog.locator('mark[data-preview-search-active]')).toHaveText('target');
    await dialog.getByRole('button', { name: 'Next match', exact: true }).click();
    await expect(previewSearchCount(dialog, '2/2')).toHaveText('2/2');
    await expect(pdfCurrentPage(dialog)).toHaveValue('3');
    await dialog.getByTitle('Close search', { exact: true }).click();
    await expect(previewSearchInput(dialog)).toHaveCount(0);
    await waitForScrollToSettle(scroller);

    const secondPage = pdfPage(dialog, 2);
    await secondPage.evaluate((pageElement) => {
      const container = pageElement.closest<HTMLElement>('[data-pdf-scroller]');
      if (!container) throw new Error('PDF scroller is missing');
      const containerRect = container.getBoundingClientRect();
      const pageRect = pageElement.getBoundingClientRect();
      container.scrollTo({
        top: Math.max(0, container.scrollTop + pageRect.top - containerRect.top),
        behavior: 'auto',
      });
    });
    await expect(pdfCurrentPage(dialog)).toHaveValue('2');

    const outlineToggle = dialog.getByTitle('Outline', { exact: true });
    const outlineDrawer = pdfOutline(dialog);
    await expect(outlineDrawer).toBeVisible();
    await expect(outlineToggle).toBeVisible();
    await expect(outlineToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(pdfOutline(dialog).getByRole('button', { name: 'Close', exact: true })).toBeHidden();
    const outlineBox = await outlineDrawer.boundingBox();
    const scrollerBox = await scroller.boundingBox();
    expect(outlineBox).toBeTruthy();
    expect(scrollerBox).toBeTruthy();
    expect(outlineBox!.width).toBeGreaterThanOrEqual(190);
    expect(outlineBox!.width).toBeLessThanOrEqual(224);
    expect(outlineBox!.x + outlineBox!.width).toBeLessThanOrEqual(scrollerBox!.x + 1);

    await outlineToggle.click();
    await expect(outlineDrawer).toBeHidden();
    await expect(outlineToggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await scroller.boundingBox())?.width ?? 0).toBeGreaterThan(scrollerBox!.width + 180);

    await outlineToggle.click();
    await expect(outlineDrawer).toBeVisible();
    await expect(outlineToggle).toHaveAttribute('aria-expanded', 'true');
    const outline = pdfOutline(dialog);
    await expect(outline.getByText('Introduction', { exact: true })).toBeVisible();
    await expect(outline.getByText('Second Chapter', { exact: true })).toBeVisible();
    await expect(outline.getByText('Details', { exact: true })).toBeVisible();
    await outline.getByText('Second Chapter', { exact: true }).click();
    await expect(pdfCurrentPage(dialog)).toHaveValue('2');
    await captureFunctionalScreenshot(page, 'file-manager-pdf-preview.png', { viewport: { width: 1440, height: 900 } });

    const zoom = pdfZoomLabel(dialog);
    const beforeZoom = await zoom.textContent();
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(zoom).not.toHaveText(beforeZoom ?? '');
    await dialog.getByRole('button', { name: 'Fit width', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Fit width', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await closePreview(page, filename);
  });

  await slowStep('XLSX preview supports bottom sheet tabs and keyboard scrolling in both directions', async () => {
    const filename = 'preview.xlsx';
    await row(page, filename).dblclick();
    const dialog = documentPopup(page);
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('Nexus XLSX E2E', { exact: true })).toBeVisible();
    await expect(dialog.getByText('2026', { exact: true })).toBeVisible();

    const preview = spreadsheetScroller(dialog).locator('..');
    const scroller = spreadsheetScroller(dialog);
    const sheetTabs = worksheetTabs(dialog);
    await expect(sheetTabs).toBeVisible();
    await expect(worksheetTab(dialog, 'E2E')).toHaveText('E2E');
    await expect(worksheetTab(dialog, 'Second')).toHaveText('Second');
    await captureFunctionalScreenshot(page, 'file-manager-spreadsheet-preview.png', {
      viewport: { width: 1440, height: 900 },
    });

    await page.keyboard.press('Control+f');
    const spreadsheetSearch = previewSearchInput(dialog);
    await expect(spreadsheetSearch).toBeFocused();
    await spreadsheetSearch.fill('Second Sheet E2E');
    await expect(previewSearchCount(dialog, '1/1')).toHaveText('1/1');
    await expect(worksheetTab(dialog, 'Second')).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.locator('td[data-search-active="true"]')).toHaveText('Second Sheet E2E');
    await dialog.getByTitle('Close search', { exact: true }).click();
    await worksheetTab(dialog, 'E2E').click();
    await expect(worksheetTab(dialog, 'E2E')).toHaveAttribute('aria-selected', 'true');

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

    await worksheetTab(dialog, 'Second').click();
    await expect(dialog.getByText('Second Sheet E2E', { exact: true })).toBeVisible();
    await expect(worksheetTab(dialog, 'Second')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(0);
    await closePreview(page, filename);
  });

  await step('stale symlink reports its own load error instead of reusing stale preview data', async () => {
    await expect(row(page, 'stale-image-link.png')).toBeVisible();
    await row(page, 'stale-image-link.png').dblclick();
    await expect(page.getByText('Failed to read file', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(documentPopup(page)).toBeHidden();
    await expect(row(page, 'seed.txt')).toBeVisible();
  });
});

test('desktop preview popup shares persisted resize geometry across image PDF and DOCX previews', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConnectedFileManager(page);

  const panel = (): Locator => documentPopup(page).getByRole('dialog');
  const resizeHandle = (): Locator => documentPopup(page).getByLabel(/Resize (preview|editor) window/);
  const resizeBy = async (deltaX: number, deltaY: number) => {
    const before = await panel().boundingBox();
    const handleBox = await resizeHandle().boundingBox();
    expect(before).toBeTruthy();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + deltaX, handleBox!.y + deltaY, { steps: 5 });
    await page.mouse.up();
    const after = await panel().boundingBox();
    expect(after).toBeTruthy();
    return { before: before!, after: after! };
  };
  const hidePopup = async () => {
    const overlay = documentPopup(page);
    await overlay.click({ position: { x: 2, y: 2 } });
    await expect(overlay).toBeHidden();
  };
  const reopenWorkspace = async () => {
    await page.goto('/connections');
    await connectTestSshFromConnectionsPage(page, connectionId);
    await openConnectedFileManager(page);
  };

  let imageResizedWidth = 0;
  let imageResizedHeight = 0;
  await step('image preview exposes the shared resize handle and persists a smaller geometry', async () => {
    await row(page, '预览-测试.png').dblclick();
    await expect(documentPopup(page).locator('img')).toBeVisible({ timeout: 20_000 });
    await expect(resizeHandle()).toBeVisible();
    await expect(resizeHandle()).toHaveAttribute('aria-label', 'Resize preview window');

    const { before, after } = await resizeBy(-140, -100);
    expect(after.width).toBeLessThan(before.width - 200);
    expect(after.height).toBeLessThan(before.height - 150);
    imageResizedWidth = after.width;
    imageResizedHeight = after.height;
    await hidePopup();
    await reopenWorkspace();
  });

  let pdfResizedWidth = 0;
  let pdfResizedHeight = 0;
  await slowStep(
    'PDF preview restores the image geometry after workspace recreation and can resize it again',
    async () => {
      await row(page, 'preview.pdf').dblclick();
      const dialog = documentPopup(page);
      await expect(visiblePdfPageCount(dialog)).toHaveText('3', { timeout: 20_000 });
      const restored = await panel().boundingBox();
      expect(restored).toBeTruthy();
      expect(restored!.width).toBeCloseTo(imageResizedWidth, 0);
      expect(restored!.height).toBeCloseTo(imageResizedHeight, 0);

      const { after } = await resizeBy(60, 40);
      pdfResizedWidth = after.width;
      pdfResizedHeight = after.height;
      expect(after.width).toBeGreaterThan(restored!.width + 80);
      expect(after.height).toBeGreaterThan(restored!.height + 50);
      await expect(dialog.locator('.pdf-preview-root')).toBeVisible();
      await expect(visiblePdfPageCount(dialog)).toHaveText('3');
      await hidePopup();
      await reopenWorkspace();
    },
  );

  await slowStep('DOCX preview restores the same geometry and remains scrollable', async () => {
    await row(page, 'preview.docx').dblclick();
    const dialog = documentPopup(page);
    await expect(dialog.getByText('Nexus DOCX E2E', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(docxScroller(dialog)).toBeVisible();
    await expect(resizeHandle()).toBeVisible();
    const restored = await panel().boundingBox();
    expect(restored).toBeTruthy();
    expect(restored!.width).toBeCloseTo(pdfResizedWidth, 0);
    expect(restored!.height).toBeCloseTo(pdfResizedHeight, 0);
    await expect(docxScroller(dialog)).toBeVisible();
  });
});

test('desktop editor rapid zoom does not replay stale scroll state while font metrics change', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const fixture = await fetch(
    `${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent('zoom-lines.txt')}&variant=zoom-lines&lines=1200`,
    { method: 'POST' },
  );
  expect(fixture.ok).toBeTruthy();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);

  await openConnectedFileManager(page);
  await expect(row(page, 'zoom-lines.txt')).toBeVisible({ timeout: 20_000 });
  await row(page, 'zoom-lines.txt').dblclick();

  const editor = editorView(page);
  const monaco = editor.locator('.monaco-editor');
  const viewLines = monaco.locator('.view-lines');
  await expect(monaco).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => viewLines.innerText()).toContain('zoom-line-1');

  const firstRenderedLine = async (): Promise<number> => {
    const text = await viewLines.locator(':scope > .view-line').first().innerText();
    const match = text.match(/zoom-line-(\d+)/);
    return match ? Number.parseInt(match[1]!, 10) : 0;
  };
  const renderedFontSize = async (): Promise<number> =>
    viewLines.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));

  await monaco.hover();
  for (let index = 0; index < 10; index += 1) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(15);
  }
  await expect.poll(firstRenderedLine, { timeout: 10_000 }).toBeGreaterThan(8);

  const lineSamples: number[] = [await firstRenderedLine()];
  const fontSamples: number[] = [await renderedFontSize()];
  for (let index = 0; index < 4; index += 1) {
    await ctrlWheel(monaco, -80);
    await page.waitForTimeout(20);
    lineSamples.push(await firstRenderedLine());
    fontSamples.push(await renderedFontSize());
  }

  for (let index = 1; index < fontSamples.length; index += 1) {
    expect(fontSamples[index]).toBeGreaterThan(fontSamples[index - 1]!);
    expect(Math.abs(lineSamples[index]! - lineSamples[index - 1]!)).toBeLessThanOrEqual(2);
  }

  await page.waitForTimeout(120);
  const settledLine = await firstRenderedLine();
  await page.waitForTimeout(500);
  expect(await firstRenderedLine()).toBe(settledLine);
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
        data: { showPopupFileEditor: true },
      })
    ).ok(),
  ).toBeTruthy();
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await slowStep('hide the first PDF by clicking the preview backdrop rather than closing its tab', async () => {
    const fileList = page
      .getByRole('dialog', { name: 'File Manager', exact: true })
      .locator('.file-table')
      .locator('..');
    await fileList.focus();
    await expect(fileList).toBeFocused();
    await row(page, 'preview.pdf').dblclick();
    const dialog = documentPopup(page);
    await expect(visiblePdfPageCount(dialog)).toHaveText('3');
    await dialog.click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeHidden();
    await expect(fileList).toBeFocused();
  });

  await slowStep('open a PDF in another directory without losing the hidden first preview tab', async () => {
    await row(page, 'folder-seed').click();
    await expect(row(page, 'second-preview.pdf')).toBeVisible();
    await row(page, 'second-preview.pdf').dblclick();
    const secondDialog = documentPopup(page);
    await expect(visiblePdfPageCount(secondDialog)).toHaveText('3');
    const tabs = secondDialog.getByRole('tablist', { name: 'Open previews', exact: true });
    await expect(tabs.getByRole('tab')).toHaveCount(2);
    await expect(tabs.getByRole('tab', { name: 'preview.pdf', exact: true })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'second-preview.pdf', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await tabs.getByRole('tab', { name: 'preview.pdf', exact: true }).click();
    await expect(visiblePdfPageCount(documentPopup(page))).toHaveText('3');
  });
});
