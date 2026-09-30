import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';

test('narrow desktop navigation and settings tabs scroll by dragging without selecting', async ({ page, context }) => {
  await loginAsInitialAdmin(context.request);
  await page.setViewportSize({ width: 700, height: 800 });
  await page.goto('/');
  const navigation = page.locator('.app-nav-links');
  const drag = async (element: typeof navigation) => {
    const box = await element.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width - 20, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 20, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => element.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  };
  await expect(navigation).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await drag(navigation);
  await expect(page).toHaveURL(/\/$/);
  await navigation.locator('a[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings/);
  const tabs = page.locator('.settings-mobile-toolbar [role="tablist"]');
  const selected = await tabs.locator('[aria-selected="true"]').getAttribute('id');
  await drag(tabs);
  await expect(tabs.locator('[aria-selected="true"]')).toHaveAttribute('id', selected!);
  await tabs.getByRole('tab').last().click();
  await expect(tabs.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true');
});
