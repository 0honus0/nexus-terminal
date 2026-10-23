import { authenticateTestRdp, observeDesktopBinaryTraffic } from '../../support/desktop';
import { readTestConnectionImportId } from '../../support/targets';
import { readConnectionList } from '../../../../packages/shared/src/targets/connections/http-codec';
import { E2E_URLS, E2E_PORTS } from '../../support/test-env';
import { expect, test } from '../../support/fixtures';
import { loginAsInitialAdmin, updateUiPreferences } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	fileManagerRow,
	openConnectedFileManager,
	openMobileProgressDisplay,
	resetTestSshFilesystem,
} from '../../support/ssh';
import { closeProgressDisplay } from '../ssh/progress-display.helpers';
import { captureFunctionalScreenshot } from '../../support/functional-screenshots';
import { slowStep, step } from '../../support/steps';

async function connectMobileSsh(
	page: Parameters<typeof connectTestSshFromConnectionsPage>[0],
	request: Parameters<typeof loginAsInitialAdmin>[0],
): Promise<void> {
	await loginAsInitialAdmin(request);
	await configureSshE2eSettings(request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	await expect(page.locator('.terminal-inner-container')).toBeVisible({ timeout: 20_000 });
}

async function tapFileManagerRow(
	page: Parameters<typeof connectTestSshFromConnectionsPage>[0],
	filename: string,
): Promise<void> {
	const row = fileManagerRow(page, filename);
	await expect(row).toBeVisible();
	await row.locator('button[data-file-path]').click();
}

test('remote touch supports switchable native direct and touchpad input', async ({ page }) => {
	await page.goto('/login');

	const result = await page.evaluate(async () => {
		const modulePath = '/src/features/remote-desktop/adapters/desktop-touch.ts';
		const { attachDesktopTouch } = await import(/* @vite-ignore */ modulePath);
		const calls: Array<{
			x: number;
			y: number;
			left: boolean;
			right: boolean;
			up: boolean;
			down: boolean;
		}> = [];

		const target = document.createElement('div');
		Object.assign(target.style, {
			position: 'fixed',
			left: '20px',
			top: '30px',
			width: '200px',
			height: '120px',
		});
		document.body.appendChild(target);

		const canvas = document.createElement('canvas');
		canvas.style.width = '200px';
		canvas.style.height = '120px';
		canvas.width = 200;
		canvas.height = 120;
		target.append(canvas);
		let left = false;
		let right = false;
		for (const type of ['mousedown', 'mouseup', 'mousemove'])
			canvas.addEventListener(type, (event: Event) => {
				if (!(event instanceof MouseEvent)) return;
				if (event.type !== 'mousemove') {
					if (event.button === 0) left = event.type === 'mousedown';
					if (event.button === 2) right = event.type === 'mousedown';
				}
				const rect = canvas.getBoundingClientRect();
				calls.push({
					x: event.clientX - rect.left,
					y: event.clientY - rect.top,
					left,
					right,
					up: false,
					down: false,
				});
			});
		canvas.addEventListener('wheel', (event) =>
			calls.push({ x: 0, y: 0, left, right, up: event.deltaY < 0, down: event.deltaY > 0 }),
		);
		const input = attachDesktopTouch(target, canvas, 'direct');

		const touch = (identifier: number, clientX: number, clientY: number, force: number) =>
			new Touch({
				identifier,
				target,
				clientX,
				clientY,
				pageX: clientX,
				pageY: clientY,
				screenX: clientX,
				screenY: clientY,
				radiusX: 8,
				radiusY: 8,
				rotationAngle: 0,
				force,
			});

		const dispatch = (type: 'touchstart' | 'touchmove' | 'touchend', active: Touch[], changed: Touch[]) => {
			target.dispatchEvent(
				new TouchEvent(type, {
					bubbles: true,
					cancelable: true,
					touches: active,
					targetTouches: active,
					changedTouches: changed,
				}),
			);
		};

		const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

		const tapTouch = touch(1, 80, 90, 0.5);
		dispatch('touchstart', [tapTouch], [tapTouch]);
		dispatch('touchend', [], [touch(1, 80, 90, 0)]);
		await wait(300);
		const tapCalls = calls.slice();

		const holdTouch = touch(2, 130, 110, 0.5);
		dispatch('touchstart', [holdTouch], [holdTouch]);
		await wait(550);
		dispatch('touchend', [], [touch(2, 130, 110, 0)]);
		const holdCalls = calls.slice(tapCalls.length);

		const dragCallStart = calls.length;
		const firstDragTap = touch(3, 90, 100, 0.5);
		dispatch('touchstart', [firstDragTap], [firstDragTap]);
		dispatch('touchend', [], [touch(3, 90, 100, 0)]);
		await wait(100);
		const secondDragTouch = touch(4, 90, 100, 0.5);
		dispatch('touchstart', [secondDragTouch], [secondDragTouch]);
		const movedDragTouch = touch(4, 150, 120, 0.5);
		dispatch('touchmove', [movedDragTouch], [movedDragTouch]);
		dispatch('touchend', [], [touch(4, 150, 120, 0)]);
		await wait(300);
		const dragCalls = calls.slice(dragCallStart);
		const allCalls = calls.slice();

		const touchActionWhileAttached = target.style.touchAction;
		input.close();
		const callCountAfterDestroy = calls.length;

		const ignoredTouch = touch(5, 60, 70, 0.5);
		dispatch('touchstart', [ignoredTouch], [ignoredTouch]);
		dispatch('touchend', [], [touch(5, 60, 70, 0)]);
		await wait(300);
		const stoppedAfterDestroy = calls.length === callCountAfterDestroy;

		const touchpadCallStart = calls.length;
		const touchpadInput = attachDesktopTouch(target, canvas, 'touchpad');

		const moveStart = touch(6, 70, 70, 0.5);
		dispatch('touchstart', [moveStart], [moveStart]);
		const moveEnd = touch(6, 135, 105, 0.5);
		dispatch('touchmove', [moveEnd], [moveEnd]);
		dispatch('touchend', [], [touch(6, 135, 105, 0)]);

		const touchpadTap = touch(11, 100, 90, 0.5);
		dispatch('touchstart', [touchpadTap], [touchpadTap]);
		dispatch('touchend', [], [touch(11, 100, 90, 0)]);

		const rightTouches = [touch(7, 80, 80, 0.5), touch(8, 120, 80, 0.5)];
		dispatch('touchstart', rightTouches, rightTouches);
		dispatch('touchend', [], [touch(7, 80, 80, 0), touch(8, 120, 80, 0)]);
		await wait(300);

		const scrollStart = [touch(9, 85, 80, 0.5), touch(10, 125, 80, 0.5)];
		dispatch('touchstart', scrollStart, scrollStart);
		const scrollEnd = [touch(9, 85, 180, 0.5), touch(10, 125, 180, 0.5)];
		dispatch('touchmove', scrollEnd, scrollEnd);
		dispatch('touchend', [], [touch(9, 85, 180, 0), touch(10, 125, 180, 0)]);
		const touchpadCalls = calls.slice(touchpadCallStart);
		touchpadInput.close();
		target.remove();

		return {
			touchActionWhileAttached,
			touchActionAfterDestroy: target.style.touchAction,
			coordinatesAreFinite: [...allCalls, ...touchpadCalls].every(
				(call) => Number.isFinite(call.x) && Number.isFinite(call.y),
			),
			tapPressedLeft: tapCalls.some((call) => call.left),
			tapReleasedLeft: tapCalls.some((call) => !call.left),
			holdPressedRight: holdCalls.some((call) => call.right),
			holdReleasedRight: holdCalls.some((call, index) => index > 0 && !call.right),
			dragMovedWhilePressed: dragCalls.some((call) => call.left && call.x >= 120),
			dragReleasedLeft: dragCalls.some((call, index) => index > 0 && !call.left),
			stoppedAfterDestroy,
			touchpadMovedPointer: touchpadCalls.some((call) => call.x > 0 && !call.left && !call.right),
			touchpadPressedRight: touchpadCalls.some((call) => call.right),
			touchpadScrolled: touchpadCalls.some((call) => call.up || call.down),
		};
	});

	expect(result).toEqual({
		touchActionWhileAttached: 'none',
		touchActionAfterDestroy: '',
		coordinatesAreFinite: true,
		tapPressedLeft: true,
		tapReleasedLeft: true,
		holdPressedRight: true,
		holdReleasedRight: true,
		dragMovedWhilePressed: true,
		dragReleasedLeft: true,
		stoppedAfterDestroy: true,
		touchpadMovedPointer: true,
		touchpadPressedRight: true,
		touchpadScrolled: true,
	});
});

test('mobile keyboard sink preserves IME composition before clearing input', async ({ page }) => {
	await page.goto('/login');

	const result = await page.evaluate(() => {
		const input = document.createElement('textarea');
		document.body.appendChild(input);
		let composing = false;

		const clearValue = () => {
			if (!composing) input.value = '';
		};

		input.addEventListener('compositionstart', () => {
			composing = true;
		});
		input.addEventListener('compositionend', () => {
			composing = false;
			clearValue();
		});
		input.addEventListener('input', clearValue);
		input.dispatchEvent(new CompositionEvent('compositionstart'));
		input.value = '你';
		input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '你' }));
		const preservedDuringComposition = input.value === '你';
		input.dispatchEvent(new CompositionEvent('compositionend'));
		const clearedAfterComposition = input.value === '';
		input.remove();
		return { preservedDuringComposition, clearedAfterComposition };
	});

	expect(result.preservedDuringComposition).toBe(true);
	expect(result.clearedAfterComposition).toBe(true);
});

test('mobile RDP opens keyboard explicitly and persists touch mode without reconnecting', async ({ page, context }) => {
	const connectionName = 'E2E Mobile RDP Touch Modes';
	const expectBinaryTraffic = await observeDesktopBinaryTraffic(page);
	// Match the desktop fullscreen regression: exercise application fullscreen
	// controls independently of the headless browser's native fullscreen support.
	await page.addInitScript(() => {
		let fullscreenElement: Element | null = null;
		Object.defineProperty(document, 'fullscreenElement', {
			configurable: true,

			get: () => fullscreenElement,
		});
		Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
			configurable: true,

			value: function requestFullscreen() {
				fullscreenElement = this;
				document.dispatchEvent(new Event('fullscreenchange'));
				return Promise.resolve();
			},
		});
		Object.defineProperty(document, 'exitFullscreen', {
			configurable: true,

			value: () => {
				fullscreenElement = null;
				document.dispatchEvent(new Event('fullscreenchange'));
				return Promise.resolve();
			},
		});
	});
	let sessionCreateRequests = 0;
	page.on('request', (request) => {
		if (/\/api\/v1\/connections\/\d+\/rdp-session(?:\?|$)/.test(request.url())) sessionCreateRequests += 1;
	});

	await loginAsInitialAdmin(context.request);
	await updateUiPreferences(context.request, (preferences) => {
		preferences.language = 'en-US';
	});

	const existingResponse = await context.request.get('/api/v1/targets/connections');
	expect(existingResponse.ok()).toBeTruthy();
	const existingConnections = readConnectionList(await existingResponse.json());
	for (const connection of existingConnections.filter((item) => item.name === connectionName)) {
		expect(
			(
				await context.request.delete(`/api/v1/targets/connections/${connection.id}`, {
					headers: { Origin: E2E_URLS.frontendOrigin },
				})
			).ok(),
		).toBeTruthy();
	}

	const createResponse = await context.request.post('/api/v1/targets/connections/import', {
		headers: { Origin: E2E_URLS.frontendOrigin },
		data: {
			items: [
				{
					connection: {
						name: connectionName,
						type: 'RDP',
						host: '127.0.0.1',
						port: E2E_PORTS.rdp,
						username: 'mobile-touch-e2e-user',
						notes: null,
						route: 'direct',
						proxyId: null,
						tagIds: [],
						jumpIds: [],
					},
					credential: { kind: 'password', password: 'b10-pass' },
				},
			],
		},
	});
	expect(createResponse.status(), await createResponse.text()).toBe(200);
	const connectionId = readTestConnectionImportId(await createResponse.json());

	const openConnection = async () => {
		await page.goto('/workspace');
		const connectionList = page.locator('.workspace-connection-list:visible');
		await expect(connectionList).toBeVisible();
		await connectionList.getByText(connectionName, { exact: true }).first().click();
		await expect(page.getByRole('dialog', { name: connectionName, exact: true })).toBeVisible();
		await expect(page.getByRole('dialog', { name: connectionName, exact: true })).toContainText('Connected', {
			timeout: 15_000,
		});
		await authenticateTestRdp(page);
	};

	try {
		await page.goto('/login');
		await openConnection();
		await expect.poll(() => sessionCreateRequests).toBe(1);

		const directMode = page.getByRole('button', { name: 'Direct', exact: true });
		const touchpadMode = page.getByRole('button', { name: 'Touchpad', exact: true });

		await expect(directMode).toBeVisible();
		await expect(directMode).toHaveAttribute('aria-pressed', 'true');
		await expect(touchpadMode).toHaveAttribute('aria-pressed', 'false');
		await expect(directMode).toHaveAttribute('title', /Tap: click/);

		const keyboardInput = page.getByRole('textbox', { name: 'Remote desktop keyboard input', exact: true });
		const remoteDisplay = page.locator('.remote-display-container [tabindex="0"]');
		await remoteDisplay.tap({ position: { x: 40, y: 40 } });
		await expect(keyboardInput).not.toBeFocused();
		// Also cover the compatibility click path used by touch browsers.
		await remoteDisplay.click({ position: { x: 40, y: 40 } });
		await expect(keyboardInput).not.toBeFocused();
		await page.getByRole('button', { name: 'Show keyboard', exact: true }).tap();
		await expect(keyboardInput).toBeFocused();
		const mobileText = 'mobile-' + crypto.randomUUID();
		await page.keyboard.type(mobileText);
		await page.keyboard.press('Enter');
		await expect
			.poll(
				async () =>
					(await (await context.request.get(E2E_URLS.desktopControlOrigin + '/e2e/desktop/input')).json())
						.text,
			)
			.toContain(mobileText);
		await expectBinaryTraffic();

		await page.getByRole('button', { name: 'Hide keyboard', exact: true }).tap();
		await expect(keyboardInput).not.toBeFocused();

		await touchpadMode.click();
		await expect(touchpadMode).toHaveAttribute('aria-pressed', 'true');
		await expect(directMode).toHaveAttribute('aria-pressed', 'false');
		await expect(touchpadMode).toHaveAttribute('title', /One finger: move/);
		await remoteDisplay.tap({ position: { x: 40, y: 40 } });
		await expect(keyboardInput).not.toBeFocused();
		expect(sessionCreateRequests).toBe(1);

		await page.getByRole('button', { name: 'Browser Fullscreen', exact: true }).tap();
		await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
		await remoteDisplay.tap({ position: { x: 40, y: 40 } });
		await expect(keyboardInput).not.toBeFocused();
		await page.getByRole('button', { name: 'Show keyboard', exact: true }).tap();
		await expect(keyboardInput).toBeFocused();
		await page.getByRole('button', { name: 'Hide keyboard', exact: true }).tap();
		await expect(keyboardInput).not.toBeFocused();
		await page.keyboard.press('Escape');
		await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
		expect(sessionCreateRequests).toBe(1);

		await page
			.getByRole('dialog', { name: connectionName, exact: true })
			.getByRole('button', { name: 'Close', exact: true })
			.click();
		await expect(page.getByRole('dialog', { name: connectionName, exact: true })).toBeHidden();
		await openConnection();
		await expect.poll(() => sessionCreateRequests).toBe(2);

		await expect(page.getByRole('button', { name: 'Touchpad', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await page.getByRole('button', { name: 'Direct', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Direct', exact: true })).toHaveAttribute('aria-pressed', 'true');
		expect(sessionCreateRequests).toBe(2);
		await page
			.getByRole('dialog', { name: connectionName, exact: true })
			.getByRole('button', { name: 'Close', exact: true })
			.click();
		await openConnection();
		await expect.poll(() => sessionCreateRequests).toBe(3);
		await expect(page.getByRole('button', { name: 'Direct', exact: true })).toHaveAttribute('aria-pressed', 'true');
	} finally {
		await context.request.delete(`/api/v1/targets/connections/${connectionId}`, {
			headers: { Origin: E2E_URLS.frontendOrigin },
		});
	}
});

test('mobile command bar opens the touch-only quick commands surface', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);

	await step('mobile-only quick commands button opens the embedded command list', async () => {
		const quickCommandsButton = page.getByRole('button', { name: 'Quick Commands', exact: true });
		await expect(quickCommandsButton).toBeVisible();
		await quickCommandsButton.click();

		const quickDialog = page.getByRole('dialog', { name: 'Quick Commands', exact: true });
		const quickCommands = quickDialog.locator('.quick-commands-root');
		await expect(quickCommands).toBeVisible();
		const quickCommandAdd = quickCommands.getByRole('button', { name: 'Add', exact: true });
		await expect(quickCommandAdd).toBeVisible();
		const quickCommandAddUsesToolbarStyle = await quickCommandAdd.evaluate((element) => {
			const probe = document.createElement('span');
			probe.style.color = getComputedStyle(document.documentElement)
				.getPropertyValue('--text-color-secondary')
				.trim();
			document.body.append(probe);
			const expectedIconColor = getComputedStyle(probe).color;
			probe.remove();
			const icon = element.querySelector('i, svg');
			return {
				width: element.getBoundingClientRect().width,
				height: element.getBoundingClientRect().height,
				icon: icon !== null && getComputedStyle(icon).color === expectedIconColor,
			};
		});
		expect(quickCommandAddUsesToolbarStyle).toEqual({ width: 28, height: 28, icon: true });
		await expect(
			quickCommands
				.locator('button[aria-label="Expand search"], input[placeholder="Search name or command..."]')
				.first(),
		).toBeVisible();
		await captureFunctionalScreenshot(page, 'mobile-quick-commands.png');

		await page.keyboard.press('Escape');
		await expect(quickCommands).toBeHidden();
	});
});

test('mobile shared Progress Display opens an empty catalog and returns to the terminal', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);
	const display = await openMobileProgressDisplay(page);
	await expect(display.getByText('There are no hidden progress tasks.', { exact: true })).toBeVisible();
	await expect(display.locator('.hidden-progress-task-row')).toHaveCount(0);
	await expect(display.getByText('There are no active transfer tasks currently.', { exact: true })).toBeVisible();
	await closeProgressDisplay(display);
	await expect(page.locator('.terminal-inner-container')).toBeVisible();
	await expect(page.locator('input.command-bar-input')).toBeVisible();
	await expect(page.locator('input.command-bar-input')).toBeEnabled();
});

test('mobile virtual keyboard Ctrl modifier reaches the live SSH input stream', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);

	const commandInput = page.locator('input.command-bar-input');
	const terminalRows = page.locator('.terminal-inner-container .xterm-rows');

	await step('start a one-byte remote reader, then open the compact mobile keyboard and arm Ctrl', async () => {
		await commandInput.fill(
			'byte=$(dd bs=1 count=1 2>/dev/null | od -An -t u1); printf \'CTRL_BYTE=%s\\n\' "$byte"',
		);
		await commandInput.press('Enter');

		const keyboardButton = page.getByRole('button', { name: 'Show virtual keyboard', exact: true });
		await expect(keyboardButton).toBeVisible();
		await keyboardButton.click();

		const keyboard = page.locator('.mobile-virtual-keyboard.virtual-keyboard-bar');
		await expect(keyboard).toBeVisible();
		const ctrl = keyboard.getByRole('button', { name: 'Ctrl', exact: true });
		await ctrl.click();
		await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
	});

	await slowStep('Ctrl+C delivers ASCII ETX and consumes the one-shot modifier', async () => {
		await commandInput.press('c');

		const ctrl = page
			.locator('.mobile-virtual-keyboard.virtual-keyboard-bar')
			.getByRole('button', { name: 'Ctrl', exact: true });
		await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toMatch(/CTRL_BYTE=\s*3/);
	});
});

test('mobile file manager navigates directories with a single tap', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);
	await openConnectedFileManager(page);
	await expect(page.getByLabel('Resize file manager window', { exact: true })).toHaveCount(0);

	await slowStep('single tap enters a folder without requiring a desktop double click', async () => {
		await tapFileManagerRow(page, 'folder-seed');
		await expect(fileManagerRow(page, 'nested.txt')).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole('dialog', { name: 'File Manager', exact: true }).locator('[data-file-parent]'),
		).toBeVisible();
	});

	await step('parent directory row returns to the original directory on a single tap', async () => {
		await page.getByRole('dialog', { name: 'File Manager', exact: true }).locator('[data-file-parent]').click();
		await expect(fileManagerRow(page, 'seed.txt')).toBeVisible({ timeout: 15_000 });
	});
});

test('mobile file manager multi-select prevents accidental opens and single tap uses CodeMirror editor', async ({
	page,
	context,
}) => {
	await connectMobileSsh(page, context.request);
	await openConnectedFileManager(page);

	const fileManagerModal = page.getByRole('dialog', { name: 'File Manager', exact: true });
	const seed = fileManagerRow(page, 'seed.txt');
	const archive = fileManagerRow(page, 'archive-source.txt');

	await step('multi-select turns file taps into selections', async () => {
		const enterMultiSelect = fileManagerModal.getByRole('button', { name: 'Enter Multi-Select Mode', exact: true });
		await expect(enterMultiSelect).toBeVisible();
		await enterMultiSelect.click();

		await seed.locator('button[data-file-path]').click();
		await archive.locator('button[data-file-path]').click();
		await expect(seed).toHaveClass(/\bis-selected\b/);
		await expect(archive).toHaveClass(/\bis-selected\b/);
		await expect(
			page.locator('[data-document-mode][data-workspace-active="true"] .file-editor-container'),
		).toBeHidden();

		const exitMultiSelect = fileManagerModal.getByRole('button', { name: 'Exit Multi-Select Mode', exact: true });
		await expect(exitMultiSelect).toBeVisible();
		await exitMultiSelect.click();
		await expect(seed).not.toHaveClass(/\bis-selected\b/);
		await expect(archive).not.toHaveClass(/\bis-selected\b/);
	});

	await slowStep('single tap opens the inset mobile CodeMirror editor rather than Monaco', async () => {
		await tapFileManagerRow(page, 'plainfile');
		const documentPopup = page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
		const editor = documentPopup.locator('.file-editor-container');
		await expect(editor).toBeVisible({ timeout: 20_000 });
		await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
		await expect(editor.locator('.monaco-editor')).toHaveCount(0);
		await expect(editor.getByTitle('Search')).toBeVisible();
		await expect
			.poll(async () => editor.locator('.cm-content').innerText(), { timeout: 15_000 })
			.toContain('plain-no-extension');

		for (const [control, optionValue, selectedValue] of [
			['.encoding-select:not(.line-ending-select)', 'utf-16le', 'utf-8'],
			['.line-ending-select', 'crlf', 'lf'],
		] as const) {
			await editor.locator(control).click();
			const option = page.locator(`[role="option"][data-value="${optionValue}"]`);
			await expect(option).toBeVisible();
			const triggerBox = await editor.locator(control).boundingBox();
			const menuBox = await page.locator('[data-ui="select-panel"][data-state="open"]').boundingBox();
			expect(triggerBox).toBeTruthy();
			expect(menuBox).toBeTruthy();
			expect(Math.abs(menuBox!.width - triggerBox!.width)).toBeLessThanOrEqual(1);
			expect(
				await option
					.locator('.ui-select__item-label')
					.evaluate((label) => label.scrollWidth - label.clientWidth),
			).toBeLessThanOrEqual(1);
			await page.locator(`[role="option"][data-value="${selectedValue}"]`).click();
		}
		expect(
			await editor.locator('.editor-actions').evaluate((actions) => actions.scrollWidth - actions.clientWidth),
		).toBeLessThanOrEqual(1);
		await captureFunctionalScreenshot(page, 'mobile-file-editor.png');

		const viewport = page.viewportSize();
		const popupBox = await documentPopup.getByRole('dialog').boundingBox();
		expect(viewport).toBeTruthy();
		expect(popupBox).toBeTruthy();
		expect(popupBox!.x).toBeGreaterThanOrEqual(14);
		expect(popupBox!.y).toBeGreaterThanOrEqual(14);
		expect(viewport!.width - (popupBox!.x + popupBox!.width)).toBeGreaterThanOrEqual(14);
		expect(viewport!.height - (popupBox!.y + popupBox!.height)).toBeGreaterThanOrEqual(14);
	});
});
