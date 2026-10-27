import { expect, test, type Page } from '../../support/fixtures';

interface TerminalLifecycleHarness {
	mount(): Promise<void>;
	unmount(): void;
	output(data: string | number[]): void;
	input(data: string): void;
	active(value: boolean): Promise<void>;
	paste(): Promise<boolean>;
	releaseClipboard(value: string): void;
	delayClipboard(): void;
	serialize(): Promise<string>;
	scrollToBottom(): void;
	discardRemotePty(): void;
	delayHistory(): void;
	releaseHistory(data: string): void;
	delayCursorReset(): void;
	releaseCursorReset(): void;
	deferAnimationFrames(): void;
	animationFrameRequests: number;
	cursorResets: number;
	historyRequests: number;
	inputs: string[];
	readonly columns: number;
	consumed: number;
	listeners: number;
}

declare global {
	interface Window {
		__terminalLifecycle: TerminalLifecycleHarness;
	}
}

async function mountTerminalHarness(page: Page): Promise<void> {
	await page.goto('/login');
	await page.addStyleTag({ url: '/__e2e__/browser-terminal.css' });
	await page.evaluate(async () => {
		const modulePath = '/__e2e__/browser-terminal.js';
		const { vue, TerminalView, i18n, createTerminalSessionState } = await import(modulePath);
		const state = createTerminalSessionState();
		const properties = vue.reactive({ active: true });
		const host = document.createElement('div');
		host.id = 'terminal-lifecycle-host';
		Object.assign(host.style, {
			position: 'fixed',
			inset: '20px',
			width: '800px',
			height: '400px',
			zIndex: '9999',
		});
		document.body.appendChild(host);
		let app: { mount(host: HTMLElement): void; unmount(): void } | null = null;
		let terminalApi: { paste(): Promise<boolean>; serialize(): Promise<string>; scrollToBottom(): void } | null =
			null;
		const inputHandlers = new Set<(data: string) => void>();
		const outputHandlers = new Set<(output: { data: string | Uint8Array; consumed(): void }) => void>();
		let resolveClipboard: ((value: string) => void) | null = null;
		let resolveHistory: ((value: { data: Uint8Array; hasMore: boolean }) => void) | null = null;
		let historyAvailable = false;
		let delayReset = false;
		let resolveCursorReset: ((available: boolean) => void) | null = null;
		const harness: TerminalLifecycleHarness = {
			inputs: [],
			consumed: 0,
			historyRequests: 0,
			cursorResets: 0,
			animationFrameRequests: 0,

			deferAnimationFrames() {
				window.requestAnimationFrame = () => -++harness.animationFrameRequests;
			},

			get columns() {
				return state.geometry.value?.columns ?? 0;
			},

			get listeners() {
				return outputHandlers.size;
			},

			async mount() {
				let resolveReady: () => void = () => undefined;

				const ready = new Promise<void>((resolve) => (resolveReady = resolve));
				app = vue.createApp({
					setup: () => () =>
						vue.h(TerminalView, {
							state,
							active: properties.active,

							onReady: () => resolveReady(),

							channel: {
								sendInput: (data: string) => harness.input(data),

								onInputSent(handler: (data: string) => void) {
									inputHandlers.add(handler);
									return () => inputHandlers.delete(handler);
								},

								resize: () => undefined,

								onOutput(handler: (output: { data: string | Uint8Array; consumed(): void }) => void) {
									outputHandlers.add(handler);
									return () => outputHandlers.delete(handler);
								},

								onClose: () => () => undefined,

								onError: () => () => undefined,

								hasPreviousOutput: () => historyAvailable,

								loadPreviousOutput: () => {
									harness.historyRequests++;
									return new Promise<{ data: Uint8Array; hasMore: boolean }>(
										(resolve) => (resolveHistory = resolve),
									);
								},

								resetPreviousOutput: () => {
									harness.cursorResets++;
									if (!delayReset) return Promise.resolve(false);
									return new Promise<boolean>((resolve) => (resolveCursorReset = resolve));
								},
							},

							ref: (value: typeof terminalApi) => {
								terminalApi = value;
							},
						}),
				});
				(app as typeof app & { use(plugin: unknown): void }).use(i18n);
				app!.mount(host);
				await ready;
			},

			unmount() {
				app?.unmount();
				app = null;
			},

			input(data) {
				harness.inputs.push(data);
				for (const handler of inputHandlers) handler(data);
			},

			output(data) {
				for (const handler of outputHandlers)
					handler({
						data: Array.isArray(data) ? new Uint8Array(data) : data,

						consumed: () => harness.consumed++,
					});
			},

			async active(value) {
				properties.active = value;
				await vue.nextTick();
			},

			paste: () => terminalApi!.paste(),

			delayClipboard() {
				Object.defineProperty(navigator.clipboard, 'readText', {
					configurable: true,

					value: () => new Promise<string>((resolve) => (resolveClipboard = resolve)),
				});
			},

			releaseClipboard(value) {
				resolveClipboard?.(value);
				resolveClipboard = null;
			},

			serialize: () => terminalApi!.serialize(),

			scrollToBottom: () => terminalApi!.scrollToBottom(),

			discardRemotePty: () => state.discardRemotePty(),

			delayHistory() {
				historyAvailable = true;
			},

			releaseHistory(data) {
				historyAvailable = false;
				resolveHistory?.({ data: new TextEncoder().encode(data), hasMore: false });
				resolveHistory = null;
			},

			delayCursorReset() {
				delayReset = true;
			},

			releaseCursorReset() {
				delayReset = false;
				resolveCursorReset?.(false);
				resolveCursorReset = null;
			},
		};
		window.__terminalLifecycle = harness;
		await harness.mount();
	});
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.listeners)).toBe(1);
}

for (const background of [false, true]) {
	test(`terminal remount drains ${background ? 'background' : 'foreground'} output and acknowledges each chunk exactly once`, async ({
		page,
	}) => {
		await mountTerminalHarness(page);
		await page.evaluate(async (background) => {
			const harness = window.__terminalLifecycle;
			await harness.active(!background);
			harness.output('FIRST_PENDING_CHUNK\r\n');
			harness.output('SECOND_PENDING_CHUNK\r\n');
			harness.unmount();
			if (harness.listeners !== 0) throw new Error('Unmounted terminal retained its output subscription.');
			await harness.mount();
		}, background);
		const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
		await expect(rows).toContainText('FIRST_PENDING_CHUNK');
		await expect(rows).toContainText('SECOND_PENDING_CHUNK');
		await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.consumed)).toBe(2);
		const snapshot = await page.evaluate(() => window.__terminalLifecycle.serialize());
		expect(snapshot.match(/FIRST_PENDING_CHUNK/g)).toHaveLength(1);
		expect(snapshot.match(/SECOND_PENDING_CHUNK/g)).toHaveLength(1);
		await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.listeners)).toBe(1);
	});
}

test('terminal cancels delayed clipboard input after switching away and back', async ({ page }) => {
	await mountTerminalHarness(page);
	const pasted = await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.delayClipboard();
		const pending = harness.paste();
		await harness.active(false);
		await harness.active(true);
		harness.releaseClipboard('STALE_CLIPBOARD_INPUT');
		return pending;
	});
	expect(pasted).toBe(false);
	expect(await page.evaluate(() => window.__terminalLifecycle.inputs)).toEqual([]);
});

test('terminal cancels delayed clipboard input after its remote PTY is replaced', async ({ page }) => {
	await mountTerminalHarness(page);
	const pasted = await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.delayClipboard();
		const pending = harness.paste();
		harness.discardRemotePty();
		harness.releaseClipboard('STALE_PTY_INPUT');
		return pending;
	});
	expect(pasted).toBe(false);
	expect(await page.evaluate(() => window.__terminalLifecycle.inputs)).toEqual([]);
});

test('a remote terminal reset does not resurrect mouse encoding when the pane remounts', async ({ page }) => {
	await mountTerminalHarness(page);
	const snapshot = await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.output('\x1b[?1000h\x1b[?1006h\x1bcRESET_TERMINAL\r\n');
		await harness.serialize();
		harness.unmount();
		await harness.mount();
		return harness.serialize();
	});
	expect(snapshot).toContain('RESET_TERMINAL');
	expect(snapshot).not.toContain('\x1b[?1006h');
	await expect(page.locator('#terminal-lifecycle-host .xterm')).not.toHaveClass(/enable-mouse-events/);
});

test('terminal preserves an incomplete UTF-8 character across pane remounts', async ({ page }) => {
	await mountTerminalHarness(page);
	const snapshot = await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		const bytes = new TextEncoder().encode('中文输出\r\n');
		harness.output([...bytes.slice(0, 2)]);
		await harness.serialize();
		harness.unmount();
		await harness.mount();
		harness.output([...bytes.slice(2)]);
		return harness.serialize();
	});
	expect(snapshot).toContain('中文输出');
	expect(snapshot).not.toContain('\ufffd');
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.consumed)).toBe(2);
});

test('a discarded PTY cannot restore its pending snapshot into the replacement pane', async ({ page }) => {
	await mountTerminalHarness(page);
	const snapshot = await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.output('DISCARDED_PTY_OUTPUT\r\n');
		harness.unmount();
		harness.discardRemotePty();
		await harness.mount();
		harness.output('REPLACEMENT_PTY_OUTPUT\r\n');
		return harness.serialize();
	});
	expect(snapshot).toContain('REPLACEMENT_PTY_OUTPUT');
	expect(snapshot).not.toContain('DISCARDED_PTY_OUTPUT');
});

test('terminal cancels clipboard reads when the pane is destroyed', async ({ page }) => {
	await mountTerminalHarness(page);
	const pasted = await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.delayClipboard();
		const pending = harness.paste();
		harness.unmount();
		harness.releaseClipboard('DESTROYED_PANE_INPUT');
		return pending;
	});
	expect(pasted).toBe(false);
	expect(await page.evaluate(() => window.__terminalLifecycle.inputs)).toEqual([]);
	expect(await page.evaluate(() => window.__terminalLifecycle.listeners)).toBe(0);
});

test('late history pages do not write into an unmounted terminal', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await mountTerminalHarness(page);
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.output('LIVE_PANE_OUTPUT\r\n');
		await harness.serialize();
		harness.delayHistory();
	});
	await page.locator('#terminal-lifecycle-host .terminal-inner-container').dispatchEvent('wheel', { deltaY: -100 });
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.historyRequests)).toBe(1);
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.unmount();
		await harness.mount();
		harness.releaseHistory('OBSOLETE_HISTORY_PAGE\r\n');
	});
	const snapshot = await page.evaluate(() => window.__terminalLifecycle.serialize());
	expect(snapshot).toContain('LIVE_PANE_OUTPUT');
	expect(snapshot).not.toContain('OBSOLETE_HISTORY_PAGE');
	expect(errors).toEqual([]);
});

test('scrolling into history drains pending live output before capturing the live snapshot', async ({ page }) => {
	await mountTerminalHarness(page);
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.output('LIVE_BEFORE_HISTORY\r\n');
		await harness.serialize();
		harness.delayHistory();
	});
	await page.locator('#terminal-lifecycle-host .terminal-inner-container').dispatchEvent('wheel', { deltaY: -100 });
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.historyRequests)).toBe(1);
	await page.evaluate(() => {
		const harness = window.__terminalLifecycle;
		harness.output('PENDING_LIVE_DURING_HISTORY\r\n');
		harness.releaseHistory(Array.from({ length: 100 }, (_, index) => `OLD_HISTORY_${index}\r\n`).join(''));
	});
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await expect(rows).toContainText('OLD_HISTORY_');
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.consumed)).toBe(2);
	await page.evaluate(() => window.__terminalLifecycle.scrollToBottom());
	await expect(rows).toContainText('LIVE_BEFORE_HISTORY');
	await expect(rows).toContainText('PENDING_LIVE_DURING_HISTORY');
	const snapshot = await page.evaluate(() => window.__terminalLifecycle.serialize());
	expect(snapshot.match(/PENDING_LIVE_DURING_HISTORY/g)).toHaveLength(1);
});

test('returning to live output invalidates an outstanding history page', async ({ page }) => {
	await mountTerminalHarness(page);
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.output('CURRENT_LIVE_SCREEN\r\n');
		await harness.serialize();
		harness.delayHistory();
	});
	await page.locator('#terminal-lifecycle-host .terminal-inner-container').dispatchEvent('wheel', { deltaY: -100 });
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.historyRequests)).toBe(1);
	await page.evaluate(() => {
		const harness = window.__terminalLifecycle;
		harness.scrollToBottom();
		harness.releaseHistory('STALE_HISTORY_AFTER_RETURN\r\n');
	});
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.cursorResets)).toBe(1);
	const snapshot = await page.evaluate(() => window.__terminalLifecycle.serialize());
	expect(snapshot).toContain('CURRENT_LIVE_SCREEN');
	expect(snapshot).not.toContain('STALE_HISTORY_AFTER_RETURN');
});

test('slow history cursor reset does not block live output or keyboard input', async ({ page }) => {
	await mountTerminalHarness(page);
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.output('LIVE_BEFORE_SLOW_RESET\r\n');
		await harness.serialize();
		harness.delayHistory();
	});
	await page.locator('#terminal-lifecycle-host .terminal-inner-container').dispatchEvent('wheel', { deltaY: -100 });
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.historyRequests)).toBe(1);
	await page.evaluate(() => {
		const harness = window.__terminalLifecycle;
		harness.releaseHistory(Array.from({ length: 100 }, (_, index) => `OLDER_ROW_${index}\r\n`).join(''));
		harness.delayCursorReset();
	});
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await expect(rows).toContainText('OLDER_ROW_');
	await page.evaluate(() => window.__terminalLifecycle.output('DEFERRED_REALTIME_OUTPUT\r\n'));
	await page.locator('#terminal-lifecycle-host .xterm-helper-textarea').press('x');
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.cursorResets)).toBe(1);
	await expect(rows).toContainText('DEFERRED_REALTIME_OUTPUT');
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.inputs)).toContain('x');
	await page.evaluate(() => window.__terminalLifecycle.releaseCursorReset());
});

test('background output batching preserves order when the terminal becomes active', async ({ page }) => {
	await mountTerminalHarness(page);
	const snapshot = await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		await harness.active(false);
		harness.output('BACKGROUND_FIRST\r\n');
		harness.output('BACKGROUND_SECOND\r\n');
		await harness.active(true);
		harness.output('FOREGROUND_THIRD\r\n');
		return harness.serialize();
	});
	expect(snapshot.indexOf('BACKGROUND_FIRST')).toBeLessThan(snapshot.indexOf('BACKGROUND_SECOND'));
	expect(snapshot.indexOf('BACKGROUND_SECOND')).toBeLessThan(snapshot.indexOf('FOREGROUND_THIRD'));
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.consumed)).toBe(3);
});

test('synchronized TUI updates remain atomic without animation frames', async ({ page }) => {
	await mountTerminalHarness(page);
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await page.evaluate(() => window.__terminalLifecycle.output('PREVIOUS_COMPLETE_FRAME\r\n'));
	await expect(rows).toContainText('PREVIOUS_COMPLETE_FRAME');
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.deferAnimationFrames();
		harness.output('\x1b[?2026h\x1b[2J\x1b[HNEW_COMPLETE_FRAME');
		await harness.serialize();
	});
	await page.waitForTimeout(150);
	await expect(rows).not.toContainText('NEW_COMPLETE_FRAME');
	await page.evaluate(() => window.__terminalLifecycle.output('\x1b[?2026l'));
	await expect(rows).toContainText('NEW_COMPLETE_FRAME');
});

test('terminal output and viewport recover while animation frames are deferred', async ({ page }) => {
	await mountTerminalHarness(page);
	await page.evaluate(async () => {
		window.__terminalLifecycle.output('INITIAL_OUTPUT\r\n');
		await window.__terminalLifecycle.serialize();
	});
	await expect(page.locator('#terminal-lifecycle-host .xterm-rows')).toContainText('INITIAL_OUTPUT');
	await page.waitForTimeout(100);
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.deferAnimationFrames();
		harness.output(Array.from({ length: 100 }, (_, index) => `STREAM_ROW_${index}\r\n`).join(''));
		await harness.serialize();
	});
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await expect(rows).toContainText('STREAM_ROW_99');
	await expect(rows).not.toContainText('INITIAL_OUTPUT');
	expect(await page.evaluate(() => window.__terminalLifecycle.animationFrameRequests)).toBeGreaterThan(0);
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.consumed)).toBe(2);
});

test('a completed synchronized frame renders before the next frame opens', async ({ page }) => {
	await mountTerminalHarness(page);
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await page.evaluate(() => window.__terminalLifecycle.output('INITIAL_COMPLETE_FRAME'));
	await expect(rows).toContainText('INITIAL_COMPLETE_FRAME');
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		harness.deferAnimationFrames();
		harness.output('\x1b[?2026h\x1b[2J\x1b[HCOMPLETED_SYNC_FRAME');
		await harness.serialize();
		harness.output('\x1b[?2026l');
		await harness.serialize();
		harness.output('\x1b[?2026h\x1b[2J\x1b[HNEXT_UNFINISHED_FRAME');
		await harness.serialize();
	});
	// Check before xterm's existing 1s synchronization safety timeout can force a paint.
	await expect(rows).toContainText('COMPLETED_SYNC_FRAME', { timeout: 400 });
	await expect(rows).not.toContainText('NEXT_UNFINISHED_FRAME');
	await page.evaluate(() => window.__terminalLifecycle.output('\x1b[?2026l'));
	await expect(rows).toContainText('NEXT_UNFINISHED_FRAME');
});

async function trainTerminalEcho(page: Page): Promise<void> {
	await mountTerminalHarness(page);
	await page.evaluate(() => window.__terminalLifecycle.output('$ '));
	await expect(page.locator('#terminal-lifecycle-host .xterm-rows')).toContainText('$ ');
	// Each sample represents a genuine transport delay, not a forced predictor flag.
	await page.evaluate(async () => {
		const harness = window.__terminalLifecycle;
		for (const char of 'abcdefgh') {
			harness.input(char);
			await new Promise((resolve) => setTimeout(resolve, char === 'a' ? 650 : 70));
			harness.output(char);
			await new Promise((resolve) => setTimeout(resolve, 30));
		}
	});
	await expect(page.locator('#terminal-lifecycle-host .xterm-rows')).toContainText('$ abcdefgh');
}

test('slow terminal echo predicts typed characters and corrects a different remote result', async ({ page }) => {
	await trainTerminalEcho(page);
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await page.evaluate(() => window.__terminalLifecycle.input('i'));
	await expect(rows).toContainText('$ abcdefghi');
	await page.evaluate(() => window.__terminalLifecycle.output('X'));
	await expect(rows).toContainText('$ abcdefghX');
	await expect(rows).not.toContainText('$ abcdefghi');
	expect(await page.evaluate(() => window.__terminalLifecycle.inputs.join(''))).toBe('abcdefghi');
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.consumed)).toBe(10);
});

async function waitForEchoFrame(page: Page, consumed: number): Promise<void> {
	await expect.poll(() => page.evaluate(() => window.__terminalLifecycle.consumed)).toBe(consumed);
	// Inspect a painted state after parsing, not the old DOM or an intermediate key.
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
}

test('fragmented terminal controls and repeated backspace preserve pending local echo', async ({ page }) => {
	await trainTerminalEcho(page);
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await page.evaluate(() => {
		for (const char of 'ijkl') window.__terminalLifecycle.input(char);
	});
	await expect(rows).toContainText('$ abcdefghijkl');
	await page.evaluate(() => window.__terminalLifecycle.output('\x1b[3'));
	await waitForEchoFrame(page, 10);
	await expect(rows).toContainText('$ abcdefghijkl');
	await page.evaluate(() => window.__terminalLifecycle.output('2mij\x1b[?2'));
	await waitForEchoFrame(page, 11);
	await expect(rows).toContainText('$ abcdefghijkl');
	await page.evaluate(() => window.__terminalLifecycle.output('5hkl'));
	await waitForEchoFrame(page, 12);
	await expect(rows).toContainText('$ abcdefghijkl');
	// One accepted keyboard event can contain repeated DEL; it is still sent only once.
	await page.evaluate(() => window.__terminalLifecycle.input('\x7f\x7f\x7f'));
	await expect(rows).toContainText('$ abcdefghi');
	await expect(rows).not.toContainText('abcdefghij');
	await page.evaluate(() => window.__terminalLifecycle.output('\x1b[?25h'));
	await waitForEchoFrame(page, 13);
	await expect(rows).not.toContainText('abcdefghij');
	await page.evaluate(() => window.__terminalLifecycle.output('\b \b\b \b\b \b'));
	await waitForEchoFrame(page, 14);
	await expect(rows).toContainText('$ abcdefghi');
	await expect(rows).not.toContainText('abcdefghij');
	expect(await page.evaluate(() => window.__terminalLifecycle.inputs)).toEqual([...'abcdefghijkl', '\x7f\x7f\x7f']);
	// The serialized text contains legitimate SGR between differently colored cells.
	// Restore it through xterm and check the visible content instead of comparing raw ANSI.
	await page.evaluate(async () => {
		await window.__terminalLifecycle.serialize();
		window.__terminalLifecycle.unmount();
		await window.__terminalLifecycle.mount();
	});
	await expect(rows).toContainText('$ abcdefghi');
	await expect(rows).not.toContainText('abcdefghij');
});

test('terminal line edge keeps accepted predictions and permits deletion toward the prompt', async ({ page }) => {
	await trainTerminalEcho(page);
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	const columns = await page.evaluate(() => window.__terminalLifecycle.columns);
	expect(columns).toBeGreaterThan(12);
	const fill = 'x'.repeat(columns - 12);
	const prefix = '$ abcdefgh' + fill;
	await page.evaluate((fill) => {
		for (const char of fill) window.__terminalLifecycle.input(char);
	}, fill);
	await expect(rows).toContainText(prefix);
	await page.evaluate(async (fill) => {
		// Keep this bulk sample on the same delayed link as training. An immediate
		// echo legitimately disables prediction once it replaces the latency window.
		await new Promise((resolve) => setTimeout(resolve, 70));
		window.__terminalLifecycle.output(fill);
	}, fill);
	await waitForEchoFrame(page, 10);
	await page.evaluate(() => window.__terminalLifecycle.input('z'));
	await expect(rows).toContainText(prefix + 'z');
	await page.evaluate(() => window.__terminalLifecycle.output('z'));
	await waitForEchoFrame(page, 11);
	// At columns - 1 a leftward edit must not hit the forward-wrap guard.
	await page.evaluate(() => window.__terminalLifecycle.input('\x7f'));
	await expect(rows).not.toContainText(prefix + 'z');
	await expect(rows).toContainText(prefix);
	await page.evaluate(() => window.__terminalLifecycle.output('\b \b'));
	await waitForEchoFrame(page, 12);
	// Reaching the unpredicted wrap must keep the already displayed z.
	await page.evaluate(() => {
		window.__terminalLifecycle.input('z');
		window.__terminalLifecycle.input('y');
		window.__terminalLifecycle.output('');
	});
	// Drain both local keys without matching/clearing the prediction timeline.
	await waitForEchoFrame(page, 13);
	await expect(rows).toContainText(prefix + 'z');
	await page.evaluate(() => window.__terminalLifecycle.output('zy'));
	await waitForEchoFrame(page, 14);
	await expect(rows).toContainText(prefix + 'zy');
	const snapshot = await page.evaluate(() => window.__terminalLifecycle.serialize());
	expect(snapshot).toContain(prefix + 'zy');
	expect(await page.evaluate(() => window.__terminalLifecycle.inputs.join(''))).toBe('abcdefgh' + fill + 'z\x7fzy');
});

test('terminal snapshot and remount exclude unconfirmed local echo', async ({ page }) => {
	await trainTerminalEcho(page);
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await page.evaluate(() => window.__terminalLifecycle.input('i'));
	await expect(rows).toContainText('$ abcdefghi');
	const snapshot = await page.evaluate(() => window.__terminalLifecycle.serialize());
	expect(snapshot).toContain('$ abcdefgh');
	expect(snapshot).not.toContain('abcdefghi');
	await page.evaluate(async () => {
		window.__terminalLifecycle.unmount();
		await window.__terminalLifecycle.mount();
		window.__terminalLifecycle.output('i');
	});
	await expect(rows).toContainText('$ abcdefghi');
	await expect(rows).not.toContainText('abcdefghii');
});

test('a password prompt and paste never display unconfirmed terminal input', async ({ page }) => {
	await trainTerminalEcho(page);
	const rows = page.locator('#terminal-lifecycle-host .xterm-rows');
	await page.evaluate(() => window.__terminalLifecycle.output('\r\nPassword: '));
	await expect(rows).toContainText('Password: ');
	await page.evaluate(() => {
		for (const char of 'secret') window.__terminalLifecycle.input(char);
	});
	const snapshot = await page.evaluate(() => window.__terminalLifecycle.serialize());
	expect(snapshot).toContain('Password: ');
	expect(snapshot).not.toContain('secret');
	await page.evaluate(() => window.__terminalLifecycle.input('PASTED_CONTENT'));
	expect(await page.evaluate(() => window.__terminalLifecycle.serialize())).not.toContain('PASTED_CONTENT');
	await page.evaluate(() => window.__terminalLifecycle.output('PASTED_CONTENT'));
	await expect(rows).toContainText('PASTED_CONTENT');
});
