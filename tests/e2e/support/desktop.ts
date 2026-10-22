import { expect, type Page } from './fixtures';
import { E2E_URLS } from './test-env';

export async function authenticateTestRdp(page: Page): Promise<void> {
	const endpoint = E2E_URLS.desktopControlOrigin + '/e2e/desktop/rdp-authentication';

	const readAuthenticatedSessions = async () => {
		const response = await page.request.get(endpoint);
		expect(response.ok()).toBe(true);
		const value: unknown = await response.json();
		if (
			!value ||
			typeof value !== 'object' ||
			!('authenticatedSessions' in value) ||
			typeof value.authenticatedSessions !== 'number'
		) {
			throw new Error('Invalid desktop authentication evidence');
		}
		return value.authenticatedSessions;
	};

	const before = await readAuthenticatedSessions();
	const display = page.locator('.remote-display-container');
	const canvas = display.locator('canvas');
	await expect
		.poll(() =>
			canvas.evaluate((element) => {
				if (!(element instanceof HTMLCanvasElement)) return false;
				const context = element.getContext('2d');
				return Boolean(
					context &&
					context.getImageData(Math.floor(element.width / 2), Math.floor(element.height / 2), 1, 1).data[3],
				);
			}),
		)
		.toBe(true);
	const keyboard = page.locator('.remote-desktop-panel textarea');
	await keyboard.dispatchEvent('keydown', { key: 'Enter', code: 'Enter' });
	await keyboard.dispatchEvent('keyup', { key: 'Enter', code: 'Enter' });
	await expect.poll(readAuthenticatedSessions).toBe(before + 1);
}
