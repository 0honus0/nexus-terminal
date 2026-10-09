import { expect, test, type Page } from '../../support/fixtures';

interface TerminalLifecycleHarness {
	mount(): Promise<void>;
	unmount(): void;
	output(data: string | number[]): void;
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
	await page.evaluate(async () => {
		const componentUrl = '/src/features/terminal/components/TerminalView.vue';
		const source = await fetch(componentUrl).then((response) => response.text());
		const vueUrl = source.match(/from\s+['"]([^'"]*\/vue\.js[^'"]*)['"]/)?.[1];
		if (!vueUrl) throw new Error('Cannot resolve the terminal component Vue runtime.');
		const vue = await import(vueUrl);
		const { default: TerminalView } = await import(componentUrl);
		const i18nUrl = '/src/app/i18n/index.ts';
		const { default: i18n } = await import(i18nUrl);
		const stateUrl = '/src/features/terminal/state/terminalSessionState.ts';
		const { createTerminalSessionState } = await import(stateUrl);
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
								sendInput: (data: string) => harness.inputs.push(data),

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
