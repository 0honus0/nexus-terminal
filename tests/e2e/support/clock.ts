import type { Page } from '@playwright/test';

/** Pause without racing the browser clock against the controller's wall time. */
export async function pausePageClock(page: Page): Promise<void> {
	const now = new Date();
	await page.clock.setFixedTime(now);
	await page.clock.pauseAt(now);
	// Advance Date and timers together again, while timer execution remains paused.
	await page.clock.setSystemTime(now);
}
