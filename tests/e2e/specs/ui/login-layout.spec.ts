import { expect, test } from '../../support/fixtures';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';

for (const theme of ['light', 'dark']) {
	test(`login controls remain reachable in ${theme} wide, narrow and short layouts`, async ({ page }) => {
		await page.addInitScript((value) => localStorage.setItem('nexus-login-theme', value), theme);
		await page.goto('/login');
		await expect(page.locator('.auth-page')).toHaveAttribute('data-auth-theme', theme);
		for (const viewport of [
			{ width: 1440, height: 900 },
			{ width: 768, height: 600 },
			{ width: 812, height: 375 },
			{ width: 390, height: 844 },
			{ width: 320, height: 667 },
			{ width: 390, height: 400 },
		]) {
			await page.setViewportSize(viewport);
			await page.evaluate(() => window.scrollTo(0, 0));
			const geometry = await page.evaluate(() => ({
				width: document.documentElement.clientWidth,
				scrollWidth: document.documentElement.scrollWidth,
				formWidth: document.querySelector('form')?.getBoundingClientRect().width ?? 0,
				controlHeights: ['.login-input', '.login-submit', '.login-passkey'].map(
					(selector) => document.querySelector(selector)?.getBoundingClientRect().height ?? 0,
				),
			}));
			expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
			expect(geometry.controlHeights).toEqual(Array(3).fill(viewport.height <= 760 ? 46 : 52));
			expect(geometry.formWidth).toBeGreaterThanOrEqual(viewport.width > 900 ? 360 : 260);
			for (const selector of [
				'#username',
				'#password',
				'.login-submit',
				'.login-passkey',
				'.auth-theme-toggle',
			]) {
				const control = page.locator(selector);
				await control.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
				await control.click({ trial: true });
				await expect(control).toBeVisible();
				const reachable = await control.evaluate((element) => {
					const box = element.getBoundingClientRect();
					const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
					return {
						rect: box.toJSON(),
						hit: hit?.tagName,
						reachable:
							box.left >= 0 &&
							box.right <= innerWidth &&
							box.top >= 0 &&
							box.bottom <= innerHeight &&
							hit !== null &&
							(element === hit || element.contains(hit)),
					};
				});
				expect(
					reachable.reachable,
					`${selector} at ${viewport.width}x${viewport.height}: ${JSON.stringify(reachable)}`,
				).toBe(true);
			}
			await page.evaluate(() => window.scrollTo(0, 0));
			await captureFunctionalScreenshot(page, `login-layout-${theme}-${viewport.width}x${viewport.height}.png`);
		}
	});
}
