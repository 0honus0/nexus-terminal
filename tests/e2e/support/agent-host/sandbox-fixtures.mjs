import { test as base } from '@playwright/test';

// Framework fixture owns the app and bridge; each test gets an isolated browser context.
export const test = base.extend({
	registerCleanup: async ({ context }, use) => {
		const releases = [];
		try {
			await use((close) => releases.push(close));
		} finally {
			const failures = [];
			for (const close of releases.reverse()) {
				try {
					await close();
				} catch (error) {
					failures.push(error);
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Sandbox fixture cleanup failed');
		}
	},
});
