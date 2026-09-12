import { expect, test, type APIRequestContext, type Locator, type Page } from '../../support/fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  closeConnectedFileManager,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  E2E_SSH,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  reopenConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';
import { closeWebSocket, openWorkspaceSession, requestWorkspace, waitForBinaryText } from '../../support/ws';

const FAVORITE_NAME = 'E2E Folder Seed';
const FAVORITE_PATH = '/folder-seed';
const SPECIAL_PATH = '/  特殊 空格\'"$#`()[]{}!&;=,+测试  ';
const DELETED_CWD_PATH = '/deleted-cwd';
const LONG_LIST_COUNT = 260;
const LONG_FILENAME = `zz-m11-long-name-${'x'.repeat(180)}.txt`;
const M11_03A_EVIDENCE_DIR = process.env.M11_03A_EVIDENCE_DIR || '/tmp/nexus-m11-03a';

const manager = (page: Page): Locator => page.getByTestId('file-manager-modal');
const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
const parentRow = (page: Page): Locator => manager(page).locator('[data-file-parent]');
const pathInput = (page: Page): Locator => manager(page).getByTestId('file-manager-path-input');

async function openSearchInput(page: Page): Promise<Locator> {
  const fileManager = manager(page);
  const input = fileManager.getByTestId('file-manager-search-input');
  if (!(await input.isVisible())) {
    await fileManager.getByTestId('file-manager-search-toggle').click();
  }
  await expect(input).toBeVisible();
  return input;
}

async function cleanupFavorite(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/favorite-paths');
  if (!response.ok()) return;
  const favorites = (await response.json()) as Array<{ id: string; name?: string; path?: string }>;
  for (const favorite of favorites.filter((item) => item.name === FAVORITE_NAME || item.path === FAVORITE_PATH)) {
    await request.delete(`/api/v1/favorite-paths/${favorite.id}`);
  }
}

async function navigateViaPathInput(page: Page, path: string): Promise<void> {
  const input = pathInput(page);
  await expect(input).toBeVisible();
  await input.fill(path);
  await input.press('Enter');
  await expect(input).toHaveValue(path, { timeout: 20_000 });
}

async function visibleFilenames(page: Page): Promise<string[]> {
  return activeFileManagerList(page)
    .locator('tbody tr[data-filename]')
    .evaluateAll((rows) => rows.map((element) => element.getAttribute('data-filename') || ''));
}

async function createLongListFixture(): Promise<void> {
  const names = Array.from(
    { length: LONG_LIST_COUNT },
    (_, index) => `m11-long-list-${index.toString().padStart(3, '0')}.txt`,
  );
  for (const name of [...names, LONG_FILENAME]) {
    const response = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent(name)}`, { method: 'POST' });
    expect(response.ok).toBeTruthy();
  }
}

async function fileListMetrics(page: Page, filename?: string): Promise<Record<string, number | string | null>> {
  const list = activeFileManagerList(page);
  return list.evaluate((element, targetFilename) => {
    const target = targetFilename
      ? element.querySelector<HTMLTableRowElement>(`tr[data-filename="${targetFilename}"]`)
      : null;
    const nameButton = target?.querySelector<HTMLButtonElement>('.file-row-name button');
    const rowBox = target?.getBoundingClientRect();
    const nameBox = nameButton?.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      rowTop: rowBox?.top ?? null,
      rowBottom: rowBox ? rowBox.bottom : null,
      rowText: target?.textContent ?? null,
      nameClientWidth: nameButton?.clientWidth ?? null,
      nameScrollWidth: nameButton?.scrollWidth ?? null,
      nameTop: nameBox?.top ?? null,
      nameBottom: nameBox ? nameBox.bottom : null,
    };
  }, filename);
}

test('common file-manager navigation tools work over real SFTP', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await cleanupFavorite(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  await step('desktop File Manager popup resizes from the bottom-right and restores its saved size', async () => {
    const panel = page.getByTestId('file-manager-modal-panel');
    const resizeHandle = page.getByTestId('file-manager-resize-handle');
    await expect(panel).toBeVisible();
    await expect(resizeHandle).toBeVisible();
    const before = await panel.boundingBox();
    const handleBox = await resizeHandle.boundingBox();
    expect(before).toBeTruthy();
    expect(handleBox).toBeTruthy();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x - 70, handleBox!.y - 55, { steps: 6 });
    await page.mouse.up();

    const resized = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(resized).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(resized!.width).toBeLessThan(before!.width - 40);
    expect(resized!.height).toBeLessThan(before!.height - 40);
    expect(resized!.x).toBeGreaterThanOrEqual(15);
    expect(resized!.y).toBeGreaterThanOrEqual(15);
    expect(resized!.x + resized!.width).toBeLessThanOrEqual(viewport!.width - 15);
    expect(resized!.y + resized!.height).toBeLessThanOrEqual(viewport!.height - 15);

    await closeConnectedFileManager(page);
    await reopenConnectedFileManager(page);
    const restored = await panel.boundingBox();
    expect(restored).toBeTruthy();
    expect(Math.abs(restored!.width - resized!.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(restored!.height - resized!.height)).toBeLessThanOrEqual(2);

    const restoredHandleBox = await resizeHandle.boundingBox();
    expect(restoredHandleBox).toBeTruthy();
    const restoredHandleX = restoredHandleBox!.x + restoredHandleBox!.width / 2;
    const restoredHandleY = restoredHandleBox!.y + restoredHandleBox!.height / 2;
    await page.mouse.move(restoredHandleX, restoredHandleY);
    await page.mouse.down();
    await page.mouse.move(
      restoredHandleX + (before!.width - restored!.width) / 2,
      restoredHandleY + (before!.height - restored!.height) / 2,
      { steps: 6 },
    );
    await page.mouse.up();
    const reset = await panel.boundingBox();
    expect(reset).toBeTruthy();
    expect(Math.abs(reset!.width - before!.width)).toBeLessThanOrEqual(3);
    expect(Math.abs(reset!.height - before!.height)).toBeLessThanOrEqual(3);
  });

  await step('Search filters the visible remote file list and Escape restores it', async () => {
    const fileManager = manager(page);
    const search = await openSearchInput(page);
    await search.fill('plain');
    await expect(row(page, 'plainfile')).toBeVisible();
    await expect(row(page, 'seed.txt')).toHaveCount(0);

    await search.fill('nested');
    const recursiveResult = fileManager.locator('tr[data-file-path="/folder-seed/nested.txt"]');
    await expect(recursiveResult).toBeVisible();
    await expect(recursiveResult).toContainText('folder-seed/nested.txt');
    await expect(fileManager.locator('tr[data-file-path="/nested.txt"]')).toHaveCount(0);

    await recursiveResult.click({ button: 'right' });
    const contextMenu = page.getByTestId('file-manager-context-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByText('Rename', { exact: true }).first().click();
    const renameModal = page.getByRole('dialog', { name: /Rename / });
    await renameModal.getByLabel('New name:', { exact: true }).fill('nested-renamed.txt');
    await renameModal.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(fileManager.locator('tr[data-file-path="/folder-seed/nested.txt"]')).toHaveCount(0);
    await expect(fileManager.locator('tr[data-file-path="/folder-seed/nested-renamed.txt"]')).toBeVisible();

    const reopenedAfterRename = await openSearchInput(page);
    await reopenedAfterRename.fill('definitely-no-e2e-match');
    await expect(fileManager.getByText('No search results found', { exact: true })).toBeVisible();
    const clearSearch = fileManager.getByTestId('file-manager-search-clear');
    await expect(clearSearch).toBeVisible();
    await clearSearch.click();
    await expect(reopenedAfterRename).toHaveValue('');
    await expect(reopenedAfterRename).toBeVisible();
    await expect(clearSearch).toHaveCount(0);
    await expect(row(page, 'seed.txt')).toBeVisible();

    await reopenedAfterRename.fill('second-preview');
    const recursivePdf = fileManager.locator('tr[data-file-path="/folder-seed/second-preview.pdf"]');
    await expect(recursivePdf).toBeVisible();
    await recursivePdf.dblclick();
    const preview = page.getByTestId('document-popup');
    await expect(preview).toHaveAttribute('data-document-mode', 'preview');
    await expect(preview.getByTestId('pdf-page-count')).toHaveText('3');
    await expect(pathInput(page)).toHaveValue('/');
    await preview.click({ position: { x: 2, y: 2 } });
    await expect(preview).toBeHidden();
    await expect(fileManager).toBeVisible();

    const reopenedSearch = await openSearchInput(page);
    await reopenedSearch.press('Escape');
    await expect(fileManager.getByTestId('file-manager-search-input')).toHaveCount(0);
    await expect(fileManager.getByTestId('file-manager-search-toggle')).toBeVisible();
    await expect(row(page, 'seed.txt')).toBeVisible();
  });

  await step('New File rejects an existing name without truncating the remote file', async () => {
    const fileManager = manager(page);
    await fileManager.getByTitle('New File', { exact: true }).click();
    const createDialog = page.getByRole('dialog', { name: 'Create New File', exact: true });
    await expect(createDialog).toBeVisible();
    const input = createDialog.getByLabel('File name:', { exact: true });
    await input.fill('seed.txt');
    await expect(createDialog.getByTestId('file-manager-create-conflict')).toHaveText(
      'Entry "seed.txt" already exists.',
    );
    await expect(createDialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();

    await input.press('Enter');
    await expect(createDialog).toBeVisible();
    await createDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(createDialog).toBeHidden();

    await row(page, 'seed.txt').dblclick();
    const editor = page.getByTestId('document-popup').getByTestId('file-editor-view');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => await editor.locator('.monaco-editor .view-lines').innerText())
      .toContain('nexus-e2e-seed');
    await page.getByTestId('document-popup').getByTitle('Close Editor', { exact: true }).first().click();
    await expect(editor).toBeHidden();
  });

  await step('directory delete preserves rm -rf with sudo fallback instead of SFTP-only removal', async () => {
    const target = row(page, 'force-delete-e2e');
    await expect(target).toBeVisible();
    await target.click({ button: 'right' });
    const contextMenu = page.getByTestId('file-manager-context-menu');
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByText('Delete', { exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm', exact: true });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(target).toHaveCount(0, { timeout: 20_000 });

    await manager(page).getByTitle('Refresh', { exact: true }).click();
    await expect(row(page, 'force-delete-e2e')).toHaveCount(0);
  });

  await step('Name sorting toggles between ascending and descending order', async () => {
    const nameHeader = manager(page).getByRole('columnheader').filter({ hasText: 'Name' }).first();
    const nameSortButton = nameHeader.locator('button');
    if (!(await nameHeader.innerText()).includes('▲')) await nameSortButton.click();
    await expect(nameHeader).toContainText('▲');
    const ascending = await visibleFilenames(page);
    expect(ascending.indexOf('copy-source.txt')).toBeLessThan(ascending.indexOf('seed.txt'));

    await nameSortButton.click();
    await expect(nameHeader).toContainText('▼');
    const descending = await visibleFilenames(page);
    expect(descending.indexOf('seed.txt')).toBeLessThan(descending.indexOf('copy-source.txt'));
  });

  await step('narrow file-manager layout prioritizes filenames and stacks secondary metadata', async () => {
    await page.setViewportSize({ width: 600, height: 780 });
    const seed = row(page, 'seed.txt');
    const cells = seed.locator('td');
    await expect(seed).toBeVisible();
    await expect(seed.locator('.file-row-compact-meta')).toBeHidden();
    await expect(cells.nth(2)).toBeVisible();
    await expect(cells.nth(3)).toBeHidden();
    await expect(cells.nth(4)).toBeVisible();

    const intermediateLayout = await activeFileManagerList(page).evaluate((element) => {
      const listRect = element.getBoundingClientRect();
      const modifiedRect = element
        .querySelector<HTMLTableCellElement>('thead th:nth-child(5)')!
        .getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        modifiedWidth: modifiedRect.width,
        modifiedRightGap: listRect.left + element.clientWidth - modifiedRect.right,
      };
    });
    expect(intermediateLayout.scrollWidth).toBeLessThanOrEqual(intermediateLayout.clientWidth + 1);
    expect(intermediateLayout.modifiedWidth).toBeGreaterThan(80);
    expect(Math.abs(intermediateLayout.modifiedRightGap)).toBeLessThanOrEqual(1.5);

    await page.setViewportSize({ width: 500, height: 780 });
    await expect(seed.locator('.file-row-compact-meta')).toBeVisible();
    await expect(seed.locator('.file-row-compact-meta')).toContainText(/B/);
    await expect(seed.locator('.file-row-compact-meta')).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    await expect(cells.nth(2)).toBeHidden();
    await expect(cells.nth(3)).toBeHidden();
    await expect(cells.nth(4)).toBeHidden();

    const compactLayout = await activeFileManagerList(page).evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(compactLayout.scrollWidth).toBeLessThanOrEqual(compactLayout.clientWidth + 1);

    await page.setViewportSize({ width: 1440, height: 900 });
    // The desktop popup owns a persisted size. Expanding only the browser viewport must not be
    // treated as if the popup itself was resized. Reopen it so the saved wide geometry is restored,
    // then verify the File Manager switches back from its compact container presentation.
    await closeConnectedFileManager(page);
    await reopenConnectedFileManager(page);
    await expect(seed.locator('.file-row-compact-meta')).toBeHidden();
    await expect(cells.nth(2)).toBeVisible();
    await expect(cells.nth(3)).toBeVisible();
    await expect(cells.nth(4)).toBeVisible();
  });

  await step('Typing an absolute path navigates directly to the remote directory', async () => {
    await navigateViaPathInput(page, FAVORITE_PATH);
    await expect(parentRow(page)).toBeVisible();
    await expect(row(page, 'seed.txt')).toHaveCount(0);

    await navigateViaPathInput(page, '/');
    await expect(row(page, 'seed.txt')).toBeVisible();
  });

  await step('Path history records, copies, deletes, and navigates through visited directories', async () => {
    await navigateViaPathInput(page, SPECIAL_PATH);
    await pathInput(page).click();
    const historyDropdown = manager(page).getByTestId('path-history-dropdown');
    await expect(historyDropdown).toBeVisible();
    const pathBox = await pathInput(page).boundingBox();
    expect(pathBox).toBeTruthy();
    const historyMetrics = await historyDropdown.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const probeX = Math.min(rect.right - 2, rect.left + Math.max(2, rect.width / 2));
      const probeY = Math.min(rect.bottom - 2, rect.top + Math.min(12, Math.max(2, rect.height / 2)));
      return {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        borderRadius: Number.parseFloat(style.borderTopLeftRadius),
        hitTestVisible:
          document.elementFromPoint(probeX, probeY)?.closest('[data-testid="path-history-dropdown"]') === element,
      };
    });
    expect(historyMetrics.width).toBeGreaterThanOrEqual(280);
    expect(historyMetrics.height).toBeGreaterThan(0);
    expect(historyMetrics.top).toBeGreaterThanOrEqual(pathBox!.y + pathBox!.height - 1);
    expect(historyMetrics.borderRadius).toBeGreaterThan(0);
    expect(historyMetrics.hitTestVisible).toBeTruthy();

    const specialHistory = manager(page).getByTitle(SPECIAL_PATH, { exact: true });
    await expect(specialHistory).toBeVisible();
    const specialPathMetrics = await specialHistory.locator('.path-history-path').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(specialPathMetrics.scrollWidth).toBeLessThanOrEqual(specialPathMetrics.clientWidth + 1);

    // The dropdown filters history by the current path-input text. Return to `/` so
    // the previously visited favorite path is part of the visible history set.
    await navigateViaPathInput(page, '/');
    await pathInput(page).click();
    let folderHistory = manager(page).getByTitle(FAVORITE_PATH, { exact: true });
    await expect(folderHistory).toBeVisible();
    await folderHistory.click();
    await expect(pathInput(page)).toHaveValue(FAVORITE_PATH, { timeout: 20_000 });
    await expect(parentRow(page)).toBeVisible();

    await pathInput(page).click();
    folderHistory = manager(page).getByTitle(FAVORITE_PATH, { exact: true });
    await expect(folderHistory).toBeVisible();
    await expect(folderHistory.getByRole('button')).toHaveCount(0);
    await folderHistory.click({ button: 'right' });
    let historyContext = page.getByTestId('path-history-context-menu');
    await expect(historyContext).toBeVisible();
    await historyContext.getByRole('button', { name: 'Copy path', exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(FAVORITE_PATH);

    await folderHistory.click({ button: 'right' });
    historyContext = page.getByTestId('path-history-context-menu');
    await expect(historyContext).toBeVisible();
    await historyContext.getByRole('button', { name: 'Delete this history entry', exact: true }).click();
    await expect(folderHistory).toHaveCount(0);
  });

  await step('Favorite paths can be added, used for navigation, and deleted', async () => {
    const openFavorites = async (): Promise<Locator> => {
      await manager(page).getByRole('button', { name: 'Favorite Paths', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Favorite Paths', exact: true });
      await expect(dialog).toBeVisible();
      return dialog;
    };

    let favorites = await openFavorites();
    const wideFavoriteBox = await favorites.boundingBox();
    expect(wideFavoriteBox).toBeTruthy();
    expect(wideFavoriteBox!.width).toBeGreaterThanOrEqual(318);
    expect(wideFavoriteBox!.width).toBeLessThanOrEqual(322);
    expect(wideFavoriteBox!.height).toBeLessThanOrEqual(320);
    const favoritePresentation = await favorites.evaluate((element) => {
      const style = getComputedStyle(element);
      return { radius: Number.parseFloat(style.borderTopLeftRadius), maxHeight: style.maxHeight };
    });
    expect(favoritePresentation.radius).toBeGreaterThan(0);

    await page.setViewportSize({ width: 960, height: 760 });
    await expect.poll(async () => (await favorites.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(318);
    const compactFavoriteBox = await favorites.boundingBox();
    expect(compactFavoriteBox).toBeTruthy();
    expect(compactFavoriteBox!.width).toBeLessThanOrEqual(322);
    expect(compactFavoriteBox!.x).toBeGreaterThanOrEqual(8);
    expect(compactFavoriteBox!.x + compactFavoriteBox!.width).toBeLessThanOrEqual(952);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(favorites).toBeVisible();

    await favorites.getByRole('button', { name: 'Add new favorite path', exact: true }).click();

    const addDialog = page.getByRole('dialog', { name: 'Add New Favorite Path', exact: true });
    await expect(addDialog).toBeVisible();
    await addDialog.locator('#favPath-name').fill(FAVORITE_NAME);
    await addDialog.locator('#favPath-path').fill(FAVORITE_PATH);
    await addDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addDialog).toBeHidden();

    let favoriteItem = favorites.getByRole('listitem').filter({ hasText: FAVORITE_NAME });
    await expect(favoriteItem).toBeVisible();
    await expect(favoriteItem.getByRole('button')).toHaveCount(1);
    const [favoriteItemBox, favoritePathButtonBox] = await Promise.all([
      favoriteItem.boundingBox(),
      favoriteItem.getByRole('button').boundingBox(),
    ]);
    expect(favoriteItemBox).toBeTruthy();
    expect(favoritePathButtonBox).toBeTruthy();
    expect(favoritePathButtonBox!.width).toBeGreaterThan(favoriteItemBox!.width - 20);

    await favoriteItem.click({ button: 'right' });
    let favoriteContext = page.getByTestId('favorite-path-context-menu');
    await expect(favoriteContext).toBeVisible();
    await expect(favoriteContext.getByRole('button')).toHaveCount(3);
    await expect(favoriteContext.getByRole('button', { name: 'Change terminal directory', exact: true })).toBeVisible();
    await expect(favoriteContext.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(favoriteContext.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

    await favoriteContext.getByRole('button', { name: 'Edit', exact: true }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit Favorite Path', exact: true });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.locator('#favPath-name')).toHaveValue(FAVORITE_NAME);
    await expect(editDialog.locator('#favPath-path')).toHaveValue(FAVORITE_PATH);
    await editDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editDialog).toBeHidden();

    await favoriteItem.click({ button: 'right' });
    favoriteContext = page.getByTestId('favorite-path-context-menu');
    await favoriteContext.getByRole('button', { name: 'Change terminal directory', exact: true }).click();
    await expect(favorites).toBeHidden();
    await manager(page).getByRole('button', { name: 'Sync current path from terminal', exact: true }).click();
    await expect(pathInput(page)).toHaveValue(FAVORITE_PATH, { timeout: 20_000 });

    await navigateViaPathInput(page, '/');
    favorites = await openFavorites();
    favoriteItem = favorites.getByRole('listitem').filter({ hasText: FAVORITE_NAME });
    await favoriteItem.getByRole('button', { name: new RegExp(FAVORITE_NAME) }).click();
    await expect(pathInput(page)).toHaveValue(FAVORITE_PATH, { timeout: 20_000 });

    favorites = await openFavorites();
    favoriteItem = favorites.getByRole('listitem').filter({ hasText: FAVORITE_NAME });
    await favoriteItem.click({ button: 'right' });
    favoriteContext = page.getByTestId('favorite-path-context-menu');
    await favoriteContext.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Please confirm', exact: true });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(FAVORITE_NAME);
    await confirmDialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(favoriteItem).toHaveCount(0);
  });
});

test('entry context Paste always targets the current File Manager directory', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  const contextMenu = page.getByTestId('file-manager-context-menu');

  await step('a normal file row exposes Paste and pastes into the directory being viewed', async () => {
    await row(page, 'copy-source.txt').click({ button: 'right' });
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByText('Copy', { exact: true }).first().click();

    await navigateViaPathInput(page, '/folder-seed');
    await row(page, 'second-preview.pdf').click({ button: 'right' });
    await expect(contextMenu.getByText('Paste', { exact: true })).toBeVisible();
    await contextMenu.getByText('Paste', { exact: true }).click();
    await expect(row(page, 'copy-source.txt')).toBeVisible({ timeout: 20_000 });
  });

  await step('right-clicking a directory row still pastes beside it, not inside it', async () => {
    await row(page, 'second-preview.pdf').click({ button: 'right' });
    await expect(contextMenu).toBeVisible();
    await contextMenu.getByText('Copy', { exact: true }).first().click();

    await navigateViaPathInput(page, '/');
    await row(page, 'cross-target').click({ button: 'right' });
    await expect(contextMenu.getByText('Paste', { exact: true })).toBeVisible();
    await contextMenu.getByText('Paste', { exact: true }).click();
    await expect(row(page, 'second-preview.pdf')).toBeVisible({ timeout: 20_000 });
  });
});

test('refreshes and sorts a long remote list while keeping a long filename actionable', async ({ page, context }) => {
  await mkdir(M11_03A_EVIDENCE_DIR, { recursive: true });
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  const fileManager = manager(page);
  const list = activeFileManagerList(page);
  const nameHeader = fileManager.getByRole('columnheader').filter({ hasText: 'Name' }).first();
  const nameSortButton = nameHeader.locator('button');

  await step('real directory navigation returns to the root before refreshing external changes', async () => {
    await row(page, 'folder-seed').click();
    await expect(pathInput(page)).toHaveValue('/folder-seed', { timeout: 20_000 });
    await expect(row(page, 'nested.txt')).toBeVisible();
    await parentRow(page).click();
    await expect(pathInput(page)).toHaveValue('/', { timeout: 20_000 });
    await expect(row(page, 'seed.txt')).toBeVisible();
  });

  await createLongListFixture();
  const beforeMetrics = await fileListMetrics(page);
  await page.screenshot({ path: path.join(M11_03A_EVIDENCE_DIR, 'm11-03a-before-refresh.png') });
  expect(beforeMetrics.rowText).toBeNull();

  await step('refresh loads the long remote list and sorting preserves the target row', async () => {
    await fileManager.getByTitle('Refresh', { exact: true }).click();
    await expect.poll(() => list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await nameSortButton.click();
    await nameSortButton.click();
    await expect(nameHeader).toContainText('▲');

    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const target = row(page, LONG_FILENAME);
    await expect(target).toBeVisible({ timeout: 20_000 });
    const afterMetrics = await fileListMetrics(page, LONG_FILENAME);
    const viewport = page.viewportSize();
    expect(viewport).toBeTruthy();
    expect(afterMetrics.scrollHeight).toBeGreaterThan(afterMetrics.clientHeight as number);
    expect(afterMetrics.scrollWidth).toBeLessThanOrEqual((afterMetrics.clientWidth as number) + 1);
    expect(afterMetrics.rowText).toContain(LONG_FILENAME);
    expect(afterMetrics.nameScrollWidth).toBeGreaterThan(afterMetrics.nameClientWidth as number);
    expect(afterMetrics.rowTop).toBeGreaterThanOrEqual(0);
    expect(afterMetrics.rowBottom).toBeLessThanOrEqual(viewport!.height);

    await target.click({ button: 'right' });
    const contextMenu = page.getByTestId('file-manager-context-menu');
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.getByText('Rename', { exact: true })).toBeVisible();
    const menuBox = await contextMenu.boundingBox();
    expect(menuBox).toBeTruthy();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height);
    await page.screenshot({ path: path.join(M11_03A_EVIDENCE_DIR, 'm11-03a-after-menu.png') });
    await page.keyboard.press('Escape');
    await writeFile(
      path.join(M11_03A_EVIDENCE_DIR, 'm11-03a-metrics.json'),
      JSON.stringify({ before: beforeMetrics, after: afterMetrics, viewport }, null, 2),
      'utf8',
    );
  });
});

test('file-manager and terminal path sync survive shell metacharacters and a deleted terminal cwd', async ({
  page,
  context,
}) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

  const fileManager = manager(page);
  const cdToTerminal = fileManager.getByTitle('Change terminal directory to current path');
  const syncFromTerminal = fileManager.getByTitle('Sync current path from terminal');

  await step('common shell metacharacters round-trip through file manager and terminal path sync', async () => {
    await navigateViaPathInput(page, SPECIAL_PATH);
    await expect(row(page, 'inside.txt')).toBeVisible();

    await cdToTerminal.click();
    await expect(page.getByText(`Terminal directory changed to ${SPECIAL_PATH}`, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await navigateViaPathInput(page, '/');
    await syncFromTerminal.click();
    await expect(pathInput(page)).toHaveValue(SPECIAL_PATH, { timeout: 10_000 });
    await expect(row(page, 'inside.txt')).toBeVisible();
  });

  await step('following the terminal recovers when its current directory was deleted externally', async () => {
    await navigateViaPathInput(page, DELETED_CWD_PATH);
    await expect(row(page, 'inside.txt')).toBeVisible();
    await cdToTerminal.click();
    await expect(page.getByText(`Terminal directory changed to ${DELETED_CWD_PATH}`, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const removeResponse = await fetch(
      `${E2E_SSH.controlUrl}/remove-path?path=${encodeURIComponent(DELETED_CWD_PATH)}`,
      {
        method: 'POST',
      },
    );
    expect(removeResponse.ok).toBeTruthy();

    await syncFromTerminal.click();
    await expect(pathInput(page)).toHaveValue('/', { timeout: 10_000 });
    await expect(row(page, 'seed.txt')).toBeVisible();
  });

  await step('refresh recovers when the file manager current directory was deleted externally', async () => {
    const recreateResponse = await fetch(
      `${E2E_SSH.controlUrl}/fixture-directory?name=${encodeURIComponent(DELETED_CWD_PATH.slice(1))}&size=1`,
      { method: 'POST' },
    );
    expect(recreateResponse.ok).toBeTruthy();

    await navigateViaPathInput(page, DELETED_CWD_PATH);
    const removeResponse = await fetch(
      `${E2E_SSH.controlUrl}/remove-path?path=${encodeURIComponent(DELETED_CWD_PATH)}`,
      {
        method: 'POST',
      },
    );
    expect(removeResponse.ok).toBeTruthy();

    await fileManager.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(pathInput(page)).toHaveValue('/', { timeout: 10_000 });
    await expect(row(page, 'seed.txt')).toBeVisible();
  });
});

test.describe('remote drag move on touch-capable desktop', () => {
  test.use({ hasTouch: true });

  test('embedded File Manager moves a remote file into a folder and back through the parent row', async ({
    page,
    context,
  }) => {
    await loginAsInitialAdmin(context.request);
    await configureSshE2eSettings(context.request);
    const embeddedSettings = await context.request.put('/api/v1/settings', {
      data: { showPopupFileManager: false, showPopupFileEditor: false },
    });
    expect(embeddedSettings.ok()).toBeTruthy();
    await resetTestSshFilesystem();

    const sourceFixture = await fetch(`${E2E_SSH.controlUrl}/fixture?name=${encodeURIComponent('.hermes.zip')}`, {
      method: 'POST',
    });
    expect(sourceFixture.ok).toBeTruthy();
    const destinationFixture = await fetch(`${E2E_SSH.controlUrl}/fixture-directory?name=Temp&size=1`, {
      method: 'POST',
    });
    expect(destinationFixture.ok).toBeTruthy();

    const connectionId = await ensureTestSshConnection(context.request);
    await connectTestSshFromConnectionsPage(page, connectionId);

    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);

    const list = page.locator('[data-testid="file-manager-list"]:visible').first();
    const embeddedRow = (filename: string) => list.locator(`tr[data-filename="${filename}"]`);
    const embeddedPathInput = page.locator('[data-testid="file-manager-path-input"]:visible').first();
    const source = embeddedRow('.hermes.zip');
    const destination = embeddedRow('Temp');
    await expect(list).toBeVisible();
    await expect(source).toBeVisible({ timeout: 20_000 });
    await expect(source).toHaveAttribute('draggable', 'true');
    await expect(destination).toBeVisible();

    await source.dragTo(destination);
    await expect(source).toHaveCount(0, { timeout: 20_000 });

    await embeddedPathInput.fill('/Temp');
    await embeddedPathInput.press('Enter');
    await expect(embeddedPathInput).toHaveValue('/Temp', { timeout: 20_000 });
    const moved = embeddedRow('.hermes.zip');
    const parent = list.locator('[data-file-parent]');
    await expect(moved).toBeVisible({ timeout: 20_000 });
    await expect(moved).toHaveAttribute('draggable', 'true');
    await expect(parent).toBeVisible();

    await moved.dragTo(parent);
    await expect(moved).toHaveCount(0, { timeout: 20_000 });

    await embeddedPathInput.fill('/');
    await embeddedPathInput.press('Enter');
    await expect(embeddedPathInput).toHaveValue('/', { timeout: 20_000 });
    await expect(embeddedRow('.hermes.zip')).toBeVisible({ timeout: 20_000 });
  });
});
test('file-manager terminal path sync does not pollute bash command history with Nexus control commands', async ({
  request,
}) => {
  await loginAsInitialAdmin(request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(request);
  const workspace = await openWorkspaceSession(request, connectionId, `history-clean-${crypto.randomUUID()}`);

  try {
    const sentinelOutput = waitForBinaryText(workspace.socket, 'USER_HISTORY_SENTINEL', 10_000);
    await requestWorkspace(workspace.socket, 'terminal.input', { data: "HISTIGNORE='cd *'\r" });
    await requestWorkspace(workspace.socket, 'terminal.input', { data: 'echo USER_HISTORY_SENTINEL\r' });
    await sentinelOutput;

    await requestWorkspace(workspace.socket, 'terminal.changeDirectory', { path: FAVORITE_PATH });
    await expect
      .poll(async () => {
        try {
          return await requestWorkspace<string>(workspace.socket, 'terminal.currentDirectory');
        } catch {
          return '';
        }
      })
      .toBe(FAVORITE_PATH);

    const token = crypto.randomUUID().replace(/-/g, '');
    const begin = `NEXUS_HISTORY_TEST_BEGIN_${token}`;
    const end = `NEXUS_HISTORY_TEST_END_${token}`;
    const outputPromise = waitForBinaryText(workspace.socket, end, 10_000);
    await requestWorkspace(workspace.socket, 'terminal.input', {
      // Split each marker across printf arguments so the terminal's input echo does not
      // contain the completed marker and resolve waitForBinaryText before history prints.
      data: `printf '\\n%s%s\\n' 'NEXUS_HISTORY_TEST_BEGIN_' '${token}'; history; printf '%s%s\\n' 'NEXUS_HISTORY_TEST_END_' '${token}'\r`,
    });
    const output = await outputPromise;
    const historyOutput = output.slice(output.lastIndexOf(begin), output.lastIndexOf(end));

    expect(historyOutput).not.toContain('__NEXUS_SHELL_BEGIN_');
    expect(historyOutput).not.toContain('__NEXUS_SHELL_END_');
    expect(historyOutput).not.toContain('__NEXUS_HOOK_BEGIN_');
    expect(historyOutput).not.toContain('__NEXUS_HOOK_END_');
    expect(historyOutput).not.toContain('__nexus_prompt_marker');
    expect(historyOutput).not.toContain(`cd '${FAVORITE_PATH}'`);
    expect(historyOutput).toContain('echo USER_HISTORY_SENTINEL');
  } finally {
    await closeWebSocket(workspace.socket);
  }
});
