import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	closeConnectedFileManager,
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	openConnectedFileManager,
	reopenConnectedFileManager,
	resetTestSshFilesystem,
} from '../../support/ssh';

test('file manager width follows the pointer across toolbar wrapping and preserves its minimum', async ({
	page,
	context,
}) => {
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	await resetTestSshFilesystem();
	await page.setViewportSize({ width: 1440, height: 900 });
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	await openConnectedFileManager(page);
	const panel = page.getByRole('dialog', { name: 'File Manager', exact: true });
	const root = panel.locator('.file-manager-root');
	const actions = panel.locator('.file-manager-actions');
	await expect(actions.locator('button')).toHaveCount(8);
	const initial = await panel.boundingBox();
	const handle = await panel.getByLabel('Resize file manager window', { exact: true }).boundingBox();
	if (!initial || !handle) throw new Error('File manager resize geometry is missing');
	const startX = handle.x + handle.width / 2;
	const startY = handle.y + handle.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	try {
		// Use one uninterrupted drag in both directions. Checking only mouseup
		// misses the live snap plateau around the single-row and minimum widths.
		for (const requestedWidth of [
			310, 292, 282, 272, 264, 254, 238, 220, 198, 180, 170, 158, 176, 206, 250, 282, 310,
		]) {
			await page.mouse.move(startX + (requestedWidth - initial.width) / 2, startY);
			const expectedWidth = Math.max(170, requestedWidth);
			await expect
				.poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - expectedWidth))
				.toBeLessThanOrEqual(1);
			const availableWidth = await root.evaluate((element) => element.clientWidth);
			const expectedRows = availableWidth >= 262 ? [8] : [4, 4];
			await expect
				.poll(() =>
					actions.evaluate((element) => {
						const rows = new Map<number, number>();
						for (const button of element.querySelectorAll('button')) {
							const top = Math.round(button.getBoundingClientRect().top);
							rows.set(top, (rows.get(top) ?? 0) + 1);
						}
						return [...rows.values()];
					}),
				)
				.toEqual(expectedRows);
			const geometry = await actions.evaluate((element) => ({
				overflow: element.scrollWidth - element.clientWidth,
				minimumButtonWidth: Math.min(
					...Array.from(element.querySelectorAll('button'), (button) => button.getBoundingClientRect().width),
				),
			}));
			expect(geometry.overflow).toBeLessThanOrEqual(1);
			expect(geometry.minimumButtonWidth).toBeGreaterThanOrEqual(28);
		}
	} finally {
		await page.mouse.up();
	}
	await expect.poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - 310)).toBeLessThanOrEqual(1);
	await closeConnectedFileManager(page);
	await reopenConnectedFileManager(page);
	await expect.poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - 310)).toBeLessThanOrEqual(1);
});
