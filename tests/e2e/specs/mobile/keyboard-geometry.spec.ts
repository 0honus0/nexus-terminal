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

test('mobile foreground recovery clears interrupted touches and fits a keyboard viewport without waiting for old frames', async ({
	page,
	context,
}) => {
	const sizes: Array<{ columns: number; rows: number }> = [];
	const inputs: string[] = [];
	page.on('websocket', (socket) => {
		socket.on('framesent', ({ payload }) => {
			if (typeof payload !== 'string') return;
			const message = JSON.parse(payload);
			if (message.type === 'terminal.resize') sizes.push(message.payload);
			if (message.type === 'terminal.input') inputs.push(message.payload.data);
		});
	});
	await loginAsInitialAdmin(context.request);
	await configureSshE2eSettings(context.request);
	const connectionId = await ensureTestSshConnection(context.request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	const terminal = page.locator('.terminal-inner-container');
	const textarea = terminal.locator('.xterm-helper-textarea');
	await expect(terminal).toBeVisible();
	await expect.poll(() => sizes.length).toBeGreaterThan(0);
	const originalRows = sizes.at(-1)!.rows;
	await terminal.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const touch = new Touch({ identifier: 1, target: element, clientX: rect.x + 50, clientY: rect.y + 50 });
		// Freeze before touchend/touchcancel, as Android can do when backgrounded.
		element.dispatchEvent(
			new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }),
		);
	});
	await expect(textarea).toHaveAttribute('inputmode', 'none');
	await expect(textarea).toHaveJSProperty('readOnly', true);
	await page.evaluate(() => {
		const viewport = window.visualViewport;
		if (!viewport) throw new Error('VisualViewport unavailable');
		const heightDescriptor = Object.getOwnPropertyDescriptor(viewport, 'height');
		const originalHeight = viewport.height;
		const original = window.requestAnimationFrame;
		const originalCancel = window.cancelAnimationFrame;
		const deferred = new Map<number, FrameRequestCallback>();
		let id = -1;
		window.requestAnimationFrame = (callback) => {
			const handle = id--;
			deferred.set(handle, callback);
			return handle;
		};
		window.cancelAnimationFrame = (handle) => {
			if (handle < 0) deferred.delete(handle);
			else originalCancel.call(window, handle);
		};
		const state = window as typeof window & { restoreMobileRecovery?: () => void };
		state.restoreMobileRecovery = () => {
			if (heightDescriptor) Object.defineProperty(viewport, 'height', heightDescriptor);
			else Reflect.deleteProperty(viewport, 'height');
			window.requestAnimationFrame = original;
			window.cancelAnimationFrame = originalCancel;
			for (const callback of deferred.values()) original.call(window, callback);
			deferred.clear();
			delete state.restoreMobileRecovery;
			viewport.dispatchEvent(new Event('resize'));
			window.dispatchEvent(new Event('pageshow'));
		};
		// Queue both owners' layout frames before the simulated wakeup.
		document.fonts.dispatchEvent(new Event('loadingdone'));
		viewport.dispatchEvent(new Event('scroll'));
		Object.defineProperty(viewport, 'height', {
			configurable: true,

			get: () => originalHeight - 280,
		});
		window.dispatchEvent(new Event('pageshow'));
		viewport.dispatchEvent(new Event('resize'));
	});
	try {
		await expect(textarea).toHaveJSProperty('readOnly', false);
		await expect(textarea).not.toHaveAttribute('inputmode', 'none');
		await expect.poll(() => sizes.at(-1)!.rows).toBeLessThan(originalRows);
		const workspaceHeight = await terminal.evaluate((element) => element.closest('main')?.style.maxHeight);
		expect(parseFloat(workspaceHeight ?? '')).toBeGreaterThan(0);
		// No actionability frames or synthetic composition/keydown are needed to
		// deliver Android-style input to the actual xterm textarea and SSH socket.
		await textarea.focus();
		const before = inputs.length;
		await page.keyboard.insertText("printf 'RECOVERY_%s\\n' INPUT_OK");
		await page.keyboard.press('Enter');
		await expect.poll(() => inputs.slice(before).join('')).toContain('RECOVERY_');
	} finally {
		await page.evaluate(() => {
			const state = window as typeof window & { restoreMobileRecovery?: () => void };
			state.restoreMobileRecovery?.();
		});
	}
	await expect.poll(() => sizes.at(-1)!.rows).toBe(originalRows);
	await expect(terminal.locator('.xterm-rows')).toContainText('RECOVERY_INPUT_OK');
});
