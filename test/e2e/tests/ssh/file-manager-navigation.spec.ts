import { expect, test, type APIRequestContext, type Locator, type Page } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  E2E_SSH,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

const FAVORITE_NAME = 'E2E Folder Seed';
const FAVORITE_PATH = '/folder-seed';
const SPECIAL_PATH = '/  特殊 空格\'"$#`()[]{}!&;=,+测试  ';
const DELETED_CWD_PATH = '/deleted-cwd';

const manager = (page: Page): Locator => page.getByTestId('file-manager-modal');
const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
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

test('common file-manager navigation tools work over real SFTP', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await configureSshE2eSettings(context.request);
  await cleanupFavorite(context.request);
  await resetTestSshFilesystem();
  const connectionId = await ensureTestSshConnection(context.request);
  await connectTestSshFromConnectionsPage(page, connectionId);
  await openConnectedFileManager(page);

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

  await step('Typing an absolute path navigates directly to the remote directory', async () => {
    await navigateViaPathInput(page, FAVORITE_PATH);
    await expect(manager(page).getByTitle('Parent Directory', { exact: true })).toBeVisible();
    await expect(row(page, 'seed.txt')).toHaveCount(0);

    await navigateViaPathInput(page, '/');
    await expect(row(page, 'seed.txt')).toBeVisible();
  });

  await step('Path history records a visited directory and navigates back to it', async () => {
    await pathInput(page).click();
    const folderHistory = manager(page).getByTitle(FAVORITE_PATH, { exact: true });
    await expect(folderHistory).toBeVisible();
    await folderHistory.click();
    await expect(pathInput(page)).toHaveValue(FAVORITE_PATH, { timeout: 20_000 });
    await expect(manager(page).getByTitle('Parent Directory', { exact: true })).toBeVisible();
  });

  await step('Favorite paths can be added, used for navigation, and deleted', async () => {
    const openFavorites = async (): Promise<Locator> => {
      await manager(page).getByRole('button', { name: 'Favorite Paths', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Favorite Paths', exact: true });
      await expect(dialog).toBeVisible();
      return dialog;
    };

    let favorites = await openFavorites();
    await favorites.getByRole('button', { name: 'Add new favorite path', exact: true }).click();

    const addDialog = page.getByRole('dialog', { name: 'Add New Favorite Path', exact: true });
    await expect(addDialog).toBeVisible();
    await addDialog.locator('#favPath-name').fill(FAVORITE_NAME);
    await addDialog.locator('#favPath-path').fill(FAVORITE_PATH);
    await addDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addDialog).toBeHidden();

    let favoriteItem = favorites.getByRole('listitem').filter({ hasText: FAVORITE_NAME });
    await expect(favoriteItem).toBeVisible();
    await manager(page).getByRole('button', { name: 'Favorite Paths', exact: true }).click();
    await expect(favorites).toBeHidden();

    await navigateViaPathInput(page, '/');
    favorites = await openFavorites();
    favoriteItem = favorites.getByRole('listitem').filter({ hasText: FAVORITE_NAME });
    await favoriteItem.getByRole('button', { name: new RegExp(FAVORITE_NAME) }).click();
    await expect(pathInput(page)).toHaveValue(FAVORITE_PATH, { timeout: 20_000 });

    favorites = await openFavorites();
    favoriteItem = favorites.getByRole('listitem').filter({ hasText: FAVORITE_NAME });
    await favoriteItem.getByRole('button', { name: 'Delete', exact: true }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Please confirm', exact: true });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(FAVORITE_NAME);
    await confirmDialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(favoriteItem).toHaveCount(0);
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
