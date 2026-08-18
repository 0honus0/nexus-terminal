import { expect, test } from '@playwright/test';
import { loginAsInitialAdmin } from '../../support/auth';
import { step } from '../../support/steps';

async function appBackground(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--app-bg-color').trim());
}

test('UI theme switches to dark mode, persists across reload, and resets to default', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();
  await page.goto('/');

  await step('Dark Mode applies immediately and is persisted by the appearance API', async () => {
    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    await expect(customizer).toBeVisible();
    await customizer.getByTestId('theme-dark-mode').click();
    await expect.poll(() => appBackground(page)).toBe('#212529');

    const response = await context.request.get('/api/v1/appearance');
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { customUiTheme?: string };
    expect(JSON.parse(body.customUiTheme || '{}')['--app-bg-color']).toBe('#212529');
  });

  await step('Dark Mode survives a full page reload', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => appBackground(page), { timeout: 15_000 }).toBe('#212529');
  });

  await step('Default Mode restores the default theme and persists the reset', async () => {
    await page.getByTitle('Customize Style').click();
    const customizer = page.getByTestId('style-customizer');
    await customizer.getByTestId('theme-default-mode').click();
    await expect.poll(() => appBackground(page)).toBe('#ffffff');

    const response = await context.request.get('/api/v1/appearance');
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { customUiTheme?: string };
    expect(JSON.parse(body.customUiTheme || '{}')['--app-bg-color']).toBe('#ffffff');
  });
});

test('terminal preset themes load from the API, switch through the UI, and persist across reload', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  const language = await context.request.put('/api/v1/settings', { data: { language: 'en-US' } });
  expect(language.ok()).toBeTruthy();

  const originalAppearanceResponse = await context.request.get('/api/v1/appearance');
  expect(originalAppearanceResponse.ok()).toBeTruthy();
  const originalAppearance = await originalAppearanceResponse.json() as { activeTerminalThemeId?: number | null };

  const themesResponse = await context.request.get('/api/v1/terminal-themes');
  expect(themesResponse.ok()).toBeTruthy();
  const themes = await themesResponse.json() as Array<{ _id?: string; name: string; isPreset?: boolean }>;

  // Pick a preset that is intentionally not part of the compact frontend sample list.
  // Its presence proves the UI is using the backend seed/API as the runtime source of truth.
  const targetTheme = themes.find((theme) => theme.name === 'zenwritten_light' && theme.isPreset);
  expect(targetTheme?._id).toBeTruthy();
  const targetThemeId = Number(targetTheme!._id);
  expect(Number.isInteger(targetThemeId) && targetThemeId > 0).toBeTruthy();

  try {
    await page.goto('/');

    await step('backend-only preset is discoverable and can be applied through the style customizer', async () => {
      await page.getByTitle('Customize Style').click();
      const customizer = page.getByTestId('style-customizer');
      await expect(customizer).toBeVisible();
      await customizer.getByRole('button', { name: 'Terminal Styles', exact: true }).click();

      const search = customizer.getByPlaceholder('Search theme name...');
      await search.fill(targetTheme!.name);
      const themeRow = customizer.locator('li').filter({ hasText: targetTheme!.name });
      await expect(themeRow).toHaveCount(1);
      await expect(themeRow).toBeVisible();

      const savePromise = page.waitForResponse((response) =>
        response.url().endsWith('/api/v1/appearance') && response.request().method() === 'PUT',
      );
      await themeRow.getByRole('button', { name: 'Apply', exact: true }).click();
      expect((await savePromise).ok()).toBeTruthy();

      await expect.poll(async () => {
        const response = await context.request.get('/api/v1/appearance');
        expect(response.ok()).toBeTruthy();
        return (await response.json() as { activeTerminalThemeId?: number | null }).activeTerminalThemeId;
      }).toBe(targetThemeId);

      const activeThemeName = customizer
        .getByText('Active Theme:', { exact: true })
        .locator('xpath=following-sibling::strong');
      await expect(activeThemeName).toHaveText(targetTheme!.name);
    });

    await step('selected terminal preset survives a full page reload', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByTitle('Customize Style').click();
      const customizer = page.getByTestId('style-customizer');
      await customizer.getByRole('button', { name: 'Terminal Styles', exact: true }).click();

      const activeThemeName = customizer
        .getByText('Active Theme:', { exact: true })
        .locator('xpath=following-sibling::strong');
      await expect(activeThemeName).toHaveText(targetTheme!.name);

      const response = await context.request.get('/api/v1/appearance');
      expect(response.ok()).toBeTruthy();
      expect((await response.json() as { activeTerminalThemeId?: number | null }).activeTerminalThemeId).toBe(targetThemeId);
    });
  } finally {
    const restore = await context.request.put('/api/v1/appearance', {
      data: { activeTerminalThemeId: originalAppearance.activeTerminalThemeId ?? null },
    });
    expect(restore.ok()).toBeTruthy();
  }
});
