import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import {
  activeFileManagerList,
  configureSshE2eSettings,
  connectTestSshFromConnectionsPage,
  ensureTestSshConnection,
  fileManagerRow,
  openConnectedFileManager,
  resetTestSshFilesystem,
} from '../../support/ssh';
import { step } from '../../support/steps';

const FAVORITE_NAME = 'E2E Folder Seed';
const FAVORITE_PATH = '/folder-seed';

const manager = (page: Page): Locator => page.getByTestId('file-manager-modal');
const row = (page: Page, filename: string): Locator => fileManagerRow(page, filename);
const currentPath = (page: Page): Locator => manager(page).locator('.file-manager-path-input strong');
const pathInput = (page: Page): Locator => manager(page).locator('input[data-focus-id="fileManagerPathInput"]');
const favoriteSlot = (page: Page): Locator => manager(page).locator('.file-manager-favorite-slot');

async function cleanupFavorite(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/favorite-paths');
  if (!response.ok()) return;
  const favorites = await response.json() as Array<{ id: string; name?: string; path?: string }>;
  for (const favorite of favorites.filter((item) => item.name === FAVORITE_NAME || item.path === FAVORITE_PATH)) {
    await request.delete(`/api/v1/favorite-paths/${favorite.id}`);
  }
}

async function navigateViaPathInput(page: Page, path: string): Promise<void> {
  await currentPath(page).click();
  const input = pathInput(page);
  await expect(input).toBeVisible();
  await input.fill(path);
  await input.press('Enter');
  await expect(currentPath(page)).toHaveText(path, { timeout: 20_000 });
}

async function visibleFilenames(page: Page): Promise<string[]> {
  return activeFileManagerList(page).locator('tbody tr[data-filename]').evaluateAll((rows) =>
    rows.map((element) => element.getAttribute('data-filename') || ''),
  );
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
    await fileManager.getByTitle('Search files...').click();
    const search = fileManager.getByPlaceholder('Search files...');
    await expect(search).toBeVisible();
    await search.fill('plain');
    await expect(row(page, 'plainfile')).toBeVisible();
    await expect(row(page, 'seed.txt')).toHaveCount(0);

    await search.fill('definitely-no-e2e-match');
    await expect(fileManager.getByText('No search results found', { exact: true })).toBeVisible();

    await search.press('Escape');
    await expect(search).toBeHidden();
    await expect(row(page, 'seed.txt')).toBeVisible();
  });

  await step('Name sorting toggles between ascending and descending order', async () => {
    const nameHeader = manager(page).getByRole('columnheader').filter({ hasText: 'Name' }).first();
    await expect(nameHeader).toContainText('▲');
    const ascending = await visibleFilenames(page);
    expect(ascending.indexOf('copy-source.txt')).toBeLessThan(ascending.indexOf('seed.txt'));

    await nameHeader.click();
    await expect(nameHeader).toContainText('▼');
    const descending = await visibleFilenames(page);
    expect(descending.indexOf('seed.txt')).toBeLessThan(descending.indexOf('copy-source.txt'));
  });

  await step('Typing an absolute path navigates directly to the remote directory', async () => {
    await navigateViaPathInput(page, FAVORITE_PATH);
    await expect(row(page, '..')).toBeVisible();
    await expect(row(page, 'seed.txt')).toHaveCount(0);

    await navigateViaPathInput(page, '/');
    await expect(row(page, 'seed.txt')).toBeVisible();
  });

  await step('Path history records a visited directory and navigates back to it', async () => {
    await currentPath(page).click();
    const history = manager(page).locator('.path-history-dropdown');
    await expect(history).toBeVisible();
    const folderHistory = history.locator(`li[title="${FAVORITE_PATH}"]`);
    await expect(folderHistory).toBeVisible();
    await folderHistory.click();
    await expect(currentPath(page)).toHaveText(FAVORITE_PATH, { timeout: 20_000 });
    await expect(row(page, '..')).toBeVisible();
  });

  await step('Favorite paths can be added, used for navigation, and deleted', async () => {
    const favorites = favoriteSlot(page);
    const trigger = favorites.locator('button').first();
    await trigger.click();
    await favorites.getByTitle('Add new favorite path').click();

    const addHeading = page.getByRole('heading', { name: 'Add New Favorite Path' });
    await expect(addHeading).toBeVisible();
    await page.locator('#favPath-name').fill(FAVORITE_NAME);
    await page.locator('#favPath-path').fill(FAVORITE_PATH);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addHeading).toBeHidden();

    let favoriteItem = favorites.locator(`li[title="${FAVORITE_PATH}"]`).filter({ hasText: FAVORITE_NAME });
    await expect(favoriteItem).toBeVisible();
    await trigger.click();

    await navigateViaPathInput(page, '/');
    await trigger.click();
    favoriteItem = favorites.locator(`li[title="${FAVORITE_PATH}"]`).filter({ hasText: FAVORITE_NAME });
    await favoriteItem.click();
    await expect(currentPath(page)).toHaveText(FAVORITE_PATH, { timeout: 20_000 });

    await trigger.click();
    favoriteItem = favorites.locator(`li[title="${FAVORITE_PATH}"]`).filter({ hasText: FAVORITE_NAME });
    await favoriteItem.hover();
    await favoriteItem.getByTitle('Delete').click();
    const confirmDialog = page.getByRole('dialog').filter({ hasText: FAVORITE_NAME });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(favoriteItem).toHaveCount(0);
  });
});
