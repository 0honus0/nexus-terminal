import { expect, type Locator, type Page } from '@playwright/test';

export function networkFailureToast(page: Page): Locator {
	return page.getByRole('alert').filter({ hasText: 'The connection is unstable or the service is unavailable.' });
}

/** Observe the real client failure before advancing its recovery timer. */
export async function waitForFailedRead(page: Page, path: string): Promise<void> {
	await page.waitForEvent('console', async (message) => {
		const first = message.args()[0];
		if (!first) return false;
		const entry: unknown = await first.jsonValue();
		return (
			typeof entry === 'object' &&
			entry !== null &&
			'method' in entry &&
			entry.method === 'GET' &&
			'path' in entry &&
			entry.path === path &&
			'code' in entry &&
			entry.code === 'request_failed'
		);
	});
}

/** The caller pauses the page clock before dispatching the failed read. */
export async function expectReadRecoveryFeedback(page: Page): Promise<void> {
	await page.clock.runFor(9_999);
	await expect(networkFailureToast(page)).toBeHidden();
	await page.clock.runFor(1);
	await expect(networkFailureToast(page)).toBeVisible();
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
