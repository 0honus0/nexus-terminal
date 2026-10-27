import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin } from '../../support/auth';
import { configureSshE2eSettings, connectTestSshFromConnectionsPage, ensureTestSshConnection } from '../../support/ssh';

test('mobile terminal restores fitted rows and sends geometry after keyboard-sized viewport changes', async ({
	page,
	context,
}) => {
	const sizes: Array<{ columns: number; rows: number }> = [];
	page.on('websocket', (socket) => {
		socket.on('framesent', ({ payload }) => {
			if (typeof payload !== 'string') return;
			const message = JSON.parse(payload);
			if (message.type === 'terminal.resize') sizes.push(message.payload);
		});
	});
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	const terminal = page.locator('.terminal-inner-container');
	await expect(terminal).toBeVisible();
	await expect.poll(() => sizes.length).toBeGreaterThan(0);
	const originalViewport = page.viewportSize()!;
	const originalRows = sizes.at(-1)!.rows;
	for (let cycle = 0; cycle < 2; cycle++) {
		await page.setViewportSize({ ...originalViewport, height: originalViewport.height - 280 });
		await expect.poll(() => sizes.at(-1)!.rows).toBeLessThan(originalRows);
		await page.setViewportSize(originalViewport);
		await expect.poll(() => sizes.at(-1)!.rows).toBe(originalRows);
		await expect
			.poll(() =>
				terminal.evaluate((element) => {
					const screen = element.querySelector('.xterm-screen')!;
					const rows = element.querySelectorAll('.xterm-rows > div').length;
					return { rows, gap: element.clientHeight - screen.getBoundingClientRect().height };
				}),
			)
			.toMatchObject({ rows: originalRows });
		const gap = await terminal.evaluate(
			(element) => element.clientHeight - element.querySelector('.xterm-screen')!.getBoundingClientRect().height,
		);
		expect(gap).toBeLessThan(30);
		// Exercise xterm's own textarea, rather than the separate command bar.
		// insertText models an input event without a desktop keydown sequence;
		// it is not a real Android/iOS IME or system keyboard.
		await terminal.tap();
		const textarea = terminal.locator('.xterm-helper-textarea');
		await expect(textarea).toBeFocused();
		await expect(textarea).not.toHaveAttribute('readonly', '');
		await page.keyboard.insertText(`printf 'KEYBOARD_%s_%s\\n' INPUT_OK ${cycle}`);
		await page.keyboard.press('Enter');
		await expect(terminal.locator('.xterm-rows')).toContainText(`KEYBOARD_INPUT_OK_${cycle}`);
	}
});
