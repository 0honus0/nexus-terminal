import { expect, type Locator, type Page } from '@playwright/test';

export function networkFailureToast(page: Page): Locator {
	return page.getByRole('alert').filter({ hasText: 'The connection is unstable or the service is unavailable.' });
}

export async function dismissToasts(page: Page): Promise<void> {
	const notifications = page.locator('.ui-notification');
	while (await notifications.count()) {
		const notification = notifications.last();
		const original = await notification.elementHandle();
		if (!original) continue;
		await notification.getByRole('button', { name: 'Close', exact: true }).click();
		await expect.poll(() => original.evaluate((element) => element.isConnected)).toBe(false);
		await original.dispose();
	}
}
