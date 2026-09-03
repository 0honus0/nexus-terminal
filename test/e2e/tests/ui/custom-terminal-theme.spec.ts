import { expect, test, type APIRequestContext } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

const THEME_NAME = 'E2E Custom Terminal Theme UI';
const EDITED_THEME_NAME = 'E2E Custom Terminal Theme UI Edited';

async function cleanupThemes(request: APIRequestContext): Promise<void> {
  const response = await request.get('/api/v1/terminal-themes');
  expect(response.ok()).toBeTruthy();
  const themes = (await response.json()) as Array<{ _id?: string; name: string; isPreset?: boolean }>;
  for (const theme of themes.filter((item) => !item.isPreset && [THEME_NAME, EDITED_THEME_NAME].includes(item.name))) {
    if (theme._id) expect((await request.delete(`/api/v1/terminal-themes/${theme._id}`)).ok()).toBeTruthy();
  }
}

test('custom terminal theme UI creates, edits, applies, persists, and deletes a theme', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  expect((await context.request.put('/api/v1/settings', { data: { language: 'en-US' } })).ok()).toBeTruthy();
  await cleanupThemes(context.request);

  const originalAppearanceResponse = await context.request.get('/api/v1/appearance');
  expect(originalAppearanceResponse.ok()).toBeTruthy();
  const originalAppearance = (await originalAppearanceResponse.json()) as { activeTerminalThemeId?: number | null };
  let createdThemeId = 0;

  try {
    await page.goto('/');
    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    await expect(customizer).toBeVisible();
    await customizer.getByTestId('style-customizer-terminal-tab').click();
    await expect(customizer.getByTestId('terminal-style-settings')).toBeVisible();

    await step('create a custom terminal theme from the visual editor', async () => {
      await customizer.getByTestId('terminal-theme-add').click();
      const editor = customizer.getByTestId('terminal-theme-editor');
      await expect(editor).toBeVisible();
      await editor.getByTestId('terminal-theme-name').fill(THEME_NAME);
      await editor
        .getByTestId('terminal-theme-json')
        .fill(
          ['background: #101820', 'foreground: #f2f2f2', 'cursor: #ffcc00', 'selectionBackground: #304050'].join('\n'),
        );

      const createPromise = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/terminal-themes') && response.request().method() === 'POST',
      );
      await editor.getByTestId('terminal-theme-save').click();
      const create = await createPromise;
      expect(create.status()).toBe(201);
      createdThemeId = Number(((await create.json()) as { _id?: string })._id);
      expect(createdThemeId).toBeGreaterThan(0);
      await expect(editor).toBeHidden({ timeout: 15_000 });

      await customizer.getByTestId('terminal-theme-search').fill(THEME_NAME);
      await expect(customizer.getByTestId(`terminal-theme-row-${createdThemeId}`)).toBeVisible();
    });

    await step('edit updates both the theme name and colors through the same UI', async () => {
      const row = customizer.getByTestId(`terminal-theme-row-${createdThemeId}`);
      await row.getByTestId('terminal-theme-edit').click();
      const editor = customizer.getByTestId('terminal-theme-editor');
      await expect(editor).toBeVisible();
      await editor.getByTestId('terminal-theme-name').fill(EDITED_THEME_NAME);
      await editor
        .getByTestId('terminal-theme-json')
        .fill(
          ['background: #202830', 'foreground: #fafafa', 'cursor: #44dd88', 'selectionBackground: #405060'].join('\n'),
        );

      const updatePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/terminal-themes/${createdThemeId}`) && response.request().method() === 'PUT',
      );
      await editor.getByTestId('terminal-theme-save').click();
      expect((await updatePromise).ok()).toBeTruthy();
      await expect(editor).toBeHidden({ timeout: 15_000 });

      const theme = await context.request.get(`/api/v1/terminal-themes/${createdThemeId}`);
      expect(theme.ok()).toBeTruthy();
      await expect(theme.json()).resolves.toMatchObject({
        name: EDITED_THEME_NAME,
        themeData: { background: '#202830', foreground: '#fafafa', cursor: '#44dd88' },
      });
    });

    await step('apply persists the custom theme across a full reload', async () => {
      await customizer.getByTestId('terminal-theme-search').fill(EDITED_THEME_NAME);
      const row = customizer.getByTestId(`terminal-theme-row-${createdThemeId}`);
      const appearanceSave = page.waitForResponse(
        (response) => response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
      );
      await row.getByTestId('terminal-theme-apply').click();
      expect((await appearanceSave).ok()).toBeTruthy();

      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/appearance');
          if (!response.ok()) return 0;
          return Number(((await response.json()) as { activeTerminalThemeId?: number }).activeTerminalThemeId ?? 0);
        })
        .toBe(createdThemeId);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTitle('Customize Style').click();
      const reloadedCustomizer = page.getByTestId('style-customizer');
      await reloadedCustomizer.getByTestId('style-customizer-terminal-tab').click();
      await reloadedCustomizer.getByTestId('terminal-theme-search').fill(EDITED_THEME_NAME);
      const reloadedRow = reloadedCustomizer.getByTestId(`terminal-theme-row-${createdThemeId}`);
      await expect(reloadedRow).toBeVisible();
      await expect(reloadedRow.getByTestId('terminal-theme-apply')).toBeDisabled();
    });

    await step('deleting an active custom theme removes it and falls back to another theme', async () => {
      const customizerAfterReload = page.getByTestId('style-customizer');
      const row = customizerAfterReload.getByTestId(`terminal-theme-row-${createdThemeId}`);
      const deletePromise = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/v1/terminal-themes/${createdThemeId}`) &&
          response.request().method() === 'DELETE',
      );
      await row.getByTestId('terminal-theme-delete').click();
      expect((await deletePromise).ok()).toBeTruthy();
      await expect(row).toHaveCount(0, { timeout: 15_000 });
      expect((await context.request.get(`/api/v1/terminal-themes/${createdThemeId}`)).status()).toBe(404);

      await expect
        .poll(async () => {
          const response = await context.request.get('/api/v1/appearance');
          if (!response.ok()) return createdThemeId;
          return Number(((await response.json()) as { activeTerminalThemeId?: number }).activeTerminalThemeId ?? 0);
        })
        .not.toBe(createdThemeId);
    });
  } finally {
    await cleanupThemes(context.request);
    const themes = await context.request.get('/api/v1/terminal-themes');
    const availableIds = themes.ok()
      ? new Set(
          ((await themes.json()) as Array<{ _id?: string }>).map((theme) => Number(theme._id)).filter(Number.isFinite),
        )
      : new Set<number>();
    let restoreId: number | null = originalAppearance.activeTerminalThemeId ?? null;
    if (restoreId !== null && !availableIds.has(restoreId)) restoreId = 1;
    await context.request.put('/api/v1/appearance', { data: { activeTerminalThemeId: restoreId } });
  }
});
