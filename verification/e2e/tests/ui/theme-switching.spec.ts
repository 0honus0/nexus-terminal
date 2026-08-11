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
