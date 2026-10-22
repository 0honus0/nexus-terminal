import { expect, type Locator, type Page } from '@playwright/test';

export function networkFailureToast(page: Page): Locator {
	return page.getByRole('alert').filter({ hasText: 'The connection is unstable or the service is unavailable.' });
}

export async function dismissToasts(page: Page): Promise<void> {
	const notifications = page.locator('.ui-notification');
	while (await notifications.count()) {
		const notification = notifications.last();
		await notification.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(notification).toBeHidden();
	}
}
