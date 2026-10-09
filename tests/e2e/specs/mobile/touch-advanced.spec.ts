import { expect, test, type Locator, type Page } from '../../support/fixtures';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loginAsInitialAdmin } from '../../support/auth';
import {
	configureSshE2eSettings,
	connectTestSshFromConnectionsPage,
	ensureTestSshConnection,
	fileManagerRow,
	openConnectedFileManager,
	resetTestSshFilesystem,
} from '../../support/ssh';
import { captureFunctionalScreenshot, functionalScreenshotsEnabled } from '../../support/functional-screenshots';
import { slowStep, step } from '../../support/steps';

const M11_04A_EVIDENCE_DIR = process.env.M11_04A_EVIDENCE_DIR || '/tmp/nexus-m11-04a';

async function connectMobileSsh(page: Page, request: Parameters<typeof loginAsInitialAdmin>[0]): Promise<void> {
	await loginAsInitialAdmin(request);
	await configureSshE2eSettings(request);
	await resetTestSshFilesystem();
	const connectionId = await ensureTestSshConnection(request);
	await connectTestSshFromConnectionsPage(page, connectionId);
	await expect(page.locator('.terminal-inner-container')).toBeVisible({ timeout: 20_000 });
}

async function tapFileManagerRow(page: Page, filename: string): Promise<void> {
	const row = fileManagerRow(page, filename);
	await expect(row).toBeVisible();
	await row.locator('button[data-file-path]').click();
}

async function longPressFile(page: Page, filename: string): Promise<Locator> {
	const row = fileManagerRow(page, filename);
	await expect(row).toBeVisible();
	const box = await row.boundingBox();
	expect(box).toBeTruthy();
	const point = {
		x: box!.x + Math.min(box!.width - 8, Math.max(8, box!.width / 2)),
		y: box!.y + box!.height / 2,
	};

	await row.dispatchEvent('pointerdown', {
		pointerId: 1,
		pointerType: 'touch',
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX: point.x,
		clientY: point.y,
	});
	await page.waitForTimeout(620);
	await row.dispatchEvent('pointerup', {
		pointerId: 1,
		pointerType: 'touch',
		isPrimary: true,
		button: 0,
		buttons: 0,
		clientX: point.x,
		clientY: point.y,
	});

	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	return menu;
}

test('mobile upload explains arbitrary files and opens an unrestricted system picker', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);
	await openConnectedFileManager(page);
	await page.evaluate(() =>
		Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined }),
	);
	const menu = await longPressFile(page, 'archive-source.txt');
	await menu.getByRole('button', { name: 'Upload', exact: true }).click();
	const chooser = page.getByRole('dialog', { name: 'Upload files', exact: true });
	await expect(chooser).toBeVisible();
	await expect(chooser).toContainText('Choose any file type');
	await expect(chooser).toContainText('Photos and videos');
	const pickerPromise = page.waitForEvent('filechooser');
	await chooser.getByRole('button', { name: 'Choose files (any type)', exact: true }).click();
	const picker = await pickerPromise;
	expect(picker.isMultiple()).toBe(true);
	expect(await picker.element().getAttribute('accept')).toBeNull();
	await picker.setFiles({
		name: 'mobile-arbitrary-file.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('Mobile file chooser upload'),
	});
	await expect(fileManagerRow(page, 'mobile-arbitrary-file.txt')).toBeVisible({ timeout: 20_000 });
	await expect(chooser).toBeHidden();
});

for (const outcome of ['success', 'cancel', 'failure'] as const) {
	test(`mobile direct file picker ${outcome} preserves upload state and allows another selection`, async ({
		page,
		context,
	}) => {
		await connectMobileSsh(page, context.request);
		await openConnectedFileManager(page);
		await page.evaluate((result) => {
			Object.defineProperty(window, 'showOpenFilePicker', {
				configurable: true,

				value: async (options: { multiple: boolean }) => {
					if (!options.multiple) throw new Error('Picker must allow multiple files');
					if (result === 'cancel') throw new DOMException('Selection cancelled', 'AbortError');
					if (result === 'failure') throw new DOMException('Picker access denied', 'NotAllowedError');
					return [
						{
							getFile: async () =>
								new File(['Direct picker file bytes'], 'direct-picker.txt', { type: 'text/plain' }),
						},
					];
				},
			});
		}, outcome);
		const menu = await longPressFile(page, 'archive-source.txt');
		await menu.getByRole('button', { name: 'Upload', exact: true }).click();
		const chooser = page.getByRole('dialog', { name: 'Upload files', exact: true });
		await chooser.getByRole('button', { name: 'Choose files (any type)', exact: true }).click();
		await expect(chooser).toBeHidden();
		if (outcome === 'success') {
			await expect(fileManagerRow(page, 'direct-picker.txt')).toBeVisible({ timeout: 20_000 });
		} else {
			await expect(fileManagerRow(page, 'direct-picker.txt')).toHaveCount(0);
			if (outcome === 'failure')
				await expect(page.getByText('Picker access denied', { exact: true })).toBeVisible();
			else await expect(page.getByText('Selection cancelled', { exact: true })).toHaveCount(0);
			await page.evaluate(() =>
				Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined }),
			);
			const retryMenu = await longPressFile(page, 'archive-source.txt');
			await retryMenu.getByRole('button', { name: 'Upload', exact: true }).click();
			const nextPicker = page.waitForEvent('filechooser');
			await chooser.getByRole('button', { name: 'Choose files (any type)', exact: true }).click();
			await (
				await nextPicker
			).setFiles({
				name: 'picker-recovery.txt',
				mimeType: 'text/plain',
				buffer: Buffer.from('Recovered selection'),
			});
			await expect(fileManagerRow(page, 'picker-recovery.txt')).toBeVisible({ timeout: 20_000 });
		}
	});
}

test('mobile long-press menu flattens archive actions and creates a real ZIP', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);
	await openConnectedFileManager(page);

	await step('archive submenu items are flattened into the touch menu', async () => {
		const menu = await longPressFile(page, 'archive-source.txt');
		const menuItems = (await menu.locator('button').allTextContents()).map((text) =>
			text.replace(/\s+/g, ' ').trim(),
		);
		expect(menuItems).toEqual([
			'Download',
			'CutCtrl+X',
			'CopyCtrl+C',
			'Copy Path',
			'DeleteDelete',
			'RenameF2',
			'Compress to zip',
			'Compress to zip with password...',
			'Compress to tar.gz',
			'Compress to tar.bz2',
			'Send to...',
			'New FolderCtrl+Shift+N',
			'New File',
			'Upload',
			'Change Permissions',
			'RefreshF5',
		]);
		await expect(page.getByRole('menu')).toHaveCount(1);
		await captureFunctionalScreenshot(page, 'mobile-context-menu.png');
	});

	await slowStep('tapping the flattened ZIP action writes the archive over SFTP', async () => {
		await page.getByRole('menu').getByText('Compress to zip', { exact: true }).click();
		await expect(fileManagerRow(page, 'archive-source.zip')).toBeVisible({ timeout: 30_000 });
	});
});

test('mobile long-press file menu stays inside narrow 320 and 375 viewports', async ({ page, context }) => {
	const viewports = [
		{ name: '320x667', width: 320, height: 667 },
		{ name: '375x812', width: 375, height: 812 },
		{ name: '412x915', width: 412, height: 915 },
	];
	await mkdir(M11_04A_EVIDENCE_DIR, { recursive: true });
	await page.setViewportSize(viewports[0]);
	await connectMobileSsh(page, context.request);
	await openConnectedFileManager(page);
	await page.screenshot({ path: path.join(M11_04A_EVIDENCE_DIR, 'm11-04a-before-menu.png') });

	const metrics: Array<Record<string, unknown>> = [];
	for (const viewport of viewports) {
		await page.setViewportSize(viewport);
		const menu = await longPressFile(page, 'archive-source.txt');
		for (const label of [
			'Copy',
			'Cut',
			'Compress to zip',
			'Compress to tar.gz',
			'Compress to tar.bz2',
			'Compress to zip with password...',
			'Rename',
			'Change Permissions',
			'Delete',
		]) {
			await expect(menu.getByRole('button').filter({ hasText: label }).first()).toBeVisible();
		}
		await expect(page.getByRole('menu')).toHaveCount(1);

		const menuBox = await menu.boundingBox();
		const fileManager = page.getByRole('dialog', { name: 'File Manager', exact: true });
		const fileManagerBox = await fileManager.boundingBox();
		const menuMetrics = await menu.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			clientHeight: element.clientHeight,
			scrollHeight: element.scrollHeight,
		}));
		const documentScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
		expect(menuBox).toBeTruthy();
		expect(fileManagerBox).toBeTruthy();
		expect(menuMetrics.scrollWidth).toBeLessThanOrEqual(menuMetrics.clientWidth + 1);
		expect(documentScrollWidth).toBeLessThanOrEqual(viewport.width + 1);
		expect(menuBox!.x).toBeGreaterThanOrEqual(0);
		expect(menuBox!.y).toBeGreaterThanOrEqual(0);
		expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
		expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height + 1);
		expect(fileManagerBox!.x).toBeGreaterThanOrEqual(0);
		expect(fileManagerBox!.y).toBeGreaterThanOrEqual(0);
		expect(fileManagerBox!.x + fileManagerBox!.width).toBeLessThanOrEqual(viewport.width + 1);
		expect(fileManagerBox!.y + fileManagerBox!.height).toBeLessThanOrEqual(viewport.height + 1);
		await page.screenshot({ path: path.join(M11_04A_EVIDENCE_DIR, `m11-04a-menu-${viewport.name}.png`) });
		metrics.push({ viewport, menu: menuBox, fileManager: fileManagerBox, menuMetrics, documentScrollWidth });

		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
	}

	await writeFile(path.join(M11_04A_EVIDENCE_DIR, 'm11-04a-metrics.json'), JSON.stringify(metrics, null, 2), 'utf8');
});

test('mobile CodeMirror search opens from the editor header and highlights remote text', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);
	await openConnectedFileManager(page);

	await slowStep('single tap opens an inset mobile editor', async () => {
		await tapFileManagerRow(page, 'plainfile');
		const documentPopup = page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
		const editor = documentPopup.locator('.file-editor-container');
		await expect(editor).toBeVisible({ timeout: 20_000 });
		await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
		await expect(documentPopup.getByTitle('Resize editor window', { exact: true })).toHaveCount(0);
		const popupBox = await documentPopup.getByRole('dialog').boundingBox();
		const viewport = page.viewportSize();
		expect(popupBox).toBeTruthy();
		expect(viewport).toBeTruthy();
		expect(popupBox!.x).toBeGreaterThanOrEqual(14);
		expect(popupBox!.y).toBeGreaterThanOrEqual(14);
		expect(viewport!.width - (popupBox!.x + popupBox!.width)).toBeGreaterThanOrEqual(14);
		expect(viewport!.height - (popupBox!.y + popupBox!.height)).toBeGreaterThanOrEqual(14);
		await expect
			.poll(async () => editor.locator('.cm-content').innerText(), { timeout: 15_000 })
			.toContain('plain-no-extension');

		const searchBox = await editor.getByRole('button', { name: 'Search in document', exact: true }).boundingBox();
		const refreshBox = await editor.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
		const saveBox = await editor.getByRole('button', { name: 'Save', exact: true }).boundingBox();
		const actionsBox = await editor.locator('.editor-actions').boundingBox();
		expect(searchBox).toBeTruthy();
		expect(refreshBox).toBeTruthy();
		expect(saveBox).toBeTruthy();
		expect(actionsBox).toBeTruthy();
		const searchCenterY = searchBox!.y + searchBox!.height / 2;
		const refreshCenterY = refreshBox!.y + refreshBox!.height / 2;
		const saveCenterY = saveBox!.y + saveBox!.height / 2;
		expect(Math.abs(searchCenterY - refreshCenterY)).toBeLessThanOrEqual(1);
		expect(Math.abs(refreshCenterY - saveCenterY)).toBeLessThanOrEqual(1);
		expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(refreshBox!.x + 1);
		expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(actionsBox!.x + actionsBox!.width + 1);

		const contentAreaBox = await editor.locator('.editor-content-area').boundingBox();
		const codeMirrorBox = await editor.locator('.cm-editor').boundingBox();
		expect(contentAreaBox).toBeTruthy();
		expect(codeMirrorBox).toBeTruthy();
		expect(Math.abs(codeMirrorBox!.width - contentAreaBox!.width)).toBeLessThanOrEqual(1);
		expect(Math.abs(codeMirrorBox!.height - contentAreaBox!.height)).toBeLessThanOrEqual(1);

		const scroller = editor.locator('.cm-scroller');
		const scrollerBox = await scroller.boundingBox();
		expect(scrollerBox).toBeTruthy();
		await scroller.click({
			position: { x: Math.min(120, scrollerBox!.width - 10), y: Math.max(10, scrollerBox!.height - 24) },
		});
		await expect(editor.locator('.cm-editor')).toHaveClass(/cm-focused/);
	});

	await step('Search opens CodeMirror search UI and decorates the matching text', async () => {
		const editor = page
			.locator('[data-document-mode][data-workspace-active="true"]:visible .file-editor-container')
			.first();
		await editor.getByRole('button', { name: 'Search in document', exact: true }).click();
		const searchPanel = editor.locator('.cm-panel.cm-search');
		await expect(searchPanel).toBeVisible();
		const searchInput = searchPanel.locator('input[name="search"]');
		await expect(searchInput).toBeVisible();
		await searchInput.fill('plain-no-extension');
		await searchInput.press('End');
		await expect(searchInput).toHaveValue('plain-no-extension');
		await expect
			.poll(async () => editor.locator('.cm-searchMatch').count(), { timeout: 10_000 })
			.toBeGreaterThan(0);
		await captureFunctionalScreenshot(page, 'mobile-editor-search.png');
	});

	await step('closing the popup returns to the terminal instead of leaving an empty editor pane', async () => {
		const documentPopup = page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
		const editor = documentPopup.locator('.file-editor-container');
		await editor.getByTitle('Close Editor', { exact: true }).click();
		await expect(documentPopup).toBeHidden();
		await expect(page.locator('.file-editor-container:visible')).toHaveCount(0);
		await expect(page.locator('.terminal-inner-container')).toBeVisible();
	});
});

test('mobile Markdown preview edits and saves through CodeMirror', async ({ page, context }) => {
	await connectMobileSsh(page, context.request);
	await openConnectedFileManager(page);
	const filename = 'README-e2e.md';

	await slowStep('single tap keeps Markdown preview-first behavior on mobile', async () => {
		await tapFileManagerRow(page, filename);
		const preview = page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
		await expect(preview).toBeVisible({ timeout: 20_000 });
		await expect(preview.getByRole('heading', { name: 'Nexus Markdown E2E' })).toBeVisible();
		await expect(preview.locator('strong')).toHaveText('preview-ok');
		const editBox = await preview.getByRole('button', { name: 'Edit', exact: true }).boundingBox();
		expect(editBox).toBeTruthy();
		expect(editBox!.height).toBeGreaterThanOrEqual(40);
		await expect(preview.locator('.file-editor-container')).toBeHidden();
		await captureFunctionalScreenshot(page, 'mobile-markdown-preview.png');
	});

	await slowStep('Edit switches the preview to mobile CodeMirror and Save persists real SFTP bytes', async () => {
		const preview = page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
		await preview.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(preview).toHaveAttribute('data-document-mode', 'editor');

		const editor = preview.locator('.file-editor-container');
		await expect(editor).toBeVisible({ timeout: 20_000 });
		await expect(editor.locator('.codemirror-mobile-editor-container')).toBeVisible();
		await expect(editor.locator('.monaco-editor')).toHaveCount(0);

		const content = editor.locator('.cm-content');
		await expect.poll(async () => content.innerText(), { timeout: 15_000 }).toContain('Nexus Markdown E2E');
		await content.click();
		await content.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
		await page.keyboard.insertText('# Mobile Markdown E2E\n\n**mobile-save-ok**\n');
		await expect.poll(async () => content.innerText()).toContain('Mobile Markdown E2E');

		await editor.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(editor).toContainText('Save successful', { timeout: 15_000 });

		await preview.getByTitle('Close Editor', { exact: true }).click();
		await expect(editor).toBeHidden();
	});

	await step('reopening the file renders the just-saved Markdown preview', async () => {
		await tapFileManagerRow(page, filename);
		const preview = page.locator('[data-document-mode][data-workspace-active="true"]:visible').first();
		await expect(preview.getByRole('heading', { name: 'Mobile Markdown E2E' })).toBeVisible({ timeout: 20_000 });
		await expect(preview.locator('strong')).toHaveText('mobile-save-ok');
	});
});

test('mobile virtual keyboard sends modified navigation escape sequences and consumes modifiers', async ({
	page,
	context,
}) => {
	await connectMobileSsh(page, context.request);

	const commandInput = page.locator('.command-bar-command-input');
	const terminalRows = page.locator('.terminal-inner-container .xterm-rows');
	await page.getByRole('button', { name: 'Show virtual keyboard', exact: true }).click();
	const keyboard = page.locator('.mobile-virtual-keyboard.virtual-keyboard-bar');
	await expect(keyboard).toBeVisible();

	if (functionalScreenshotsEnabled()) {
		await commandInput.fill('clear');
		await commandInput.press('Enter');
		await commandInput.fill("printf 'Nexus mobile virtual keyboard\\n'");
		await commandInput.press('Enter');
		await expect
			.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
			.toContain('Nexus mobile virtual keyboard');
		await captureFunctionalScreenshot(page, 'mobile-virtual-keyboard.png');

		// Document both modifier states: Ctrl locked by a double tap, Alt armed for one key.
		const screenshotCtrl = keyboard.locator('[data-key="ctrl"]');
		const screenshotAlt = keyboard.locator('[data-key="alt"]');
		await screenshotCtrl.dblclick();
		await screenshotAlt.click();
		await expect(screenshotCtrl).toHaveAccessibleName('Ctrl (locked)');
		await expect(screenshotAlt).toHaveAttribute('aria-pressed', 'true');
		await captureFunctionalScreenshot(page, 'mobile-virtual-modifiers.png');
		await screenshotCtrl.click();
		// A second tap inside the double-tap window locks Alt instead of clearing it; one more tap clears a lock.
		await screenshotAlt.click();
		if ((await screenshotAlt.getAttribute('aria-pressed')) === 'true') await screenshotAlt.click();
		await expect(screenshotCtrl).toHaveAttribute('aria-pressed', 'false');
		await expect(screenshotAlt).toHaveAttribute('aria-pressed', 'false');
	}

	await slowStep('Alt+Left sends the xterm Alt cursor sequence and clears Alt after one key', async () => {
		await commandInput.fill(
			'bytes=$(dd bs=1 count=6 2>/dev/null | od -An -t u1); printf \'ALT_LEFT_BYTES=%s\\n\' "$bytes"',
		);
		await commandInput.press('Enter');

		const alt = keyboard.getByRole('button', { name: 'Alt', exact: true });
		await alt.click();
		await expect(alt).toHaveAttribute('aria-pressed', 'true');
		await keyboard.getByRole('button', { name: 'Left arrow', exact: true }).click();
		await expect(alt).toHaveAttribute('aria-pressed', 'false');
		await expect
			.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
			.toMatch(/ALT_LEFT_BYTES=\s*27\s+91\s+49\s+59\s+51\s+68/);
	});

	await slowStep('Ctrl+Alt+Del sends the modified Delete sequence and clears both modifiers', async () => {
		await commandInput.fill(
			'bytes=$(dd bs=1 count=6 2>/dev/null | od -An -t u1); printf \'CTRL_ALT_DEL_BYTES=%s\\n\' "$bytes"',
		);
		await commandInput.press('Enter');

		const ctrl = keyboard.getByRole('button', { name: 'Ctrl', exact: true });
		const alt = keyboard.getByRole('button', { name: 'Alt', exact: true });
		await ctrl.click();
		await alt.click();
		await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
		await expect(alt).toHaveAttribute('aria-pressed', 'true');
		await keyboard.getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
		await expect(alt).toHaveAttribute('aria-pressed', 'false');
		await expect
			.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
			.toMatch(/CTRL_ALT_DEL_BYTES=\s*27\s+91\s+51\s+59\s+55\s+126/);
	});
});

test('mobile virtual keyboard follows application cursor mode, pages function keys and locks modifiers', async ({
	page,
	context,
}) => {
	await connectMobileSsh(page, context.request);

	const commandInput = page.locator('.command-bar-command-input');
	const terminalRows = page.locator('.terminal-inner-container .xterm-rows');
	await page.getByRole('button', { name: 'Show virtual keyboard', exact: true }).click();
	const keyboard = page.locator('.mobile-virtual-keyboard.virtual-keyboard-bar');
	await expect(keyboard).toBeVisible();

	await slowStep('Up arrow sends SS3 while the remote application enables DECCKM', async () => {
		// The ready marker is split so the echoed command line never matches it.
		await commandInput.fill(
			"printf '\\033[?1h%s%s\\n' APP_MODE_ READY; bytes=$(dd bs=1 count=3 2>/dev/null | od -An -t u1); printf '\\033[?1l'; printf 'APP_UP_BYTES=%s\\n' \"$bytes\"",
		);
		await commandInput.press('Enter');
		await expect.poll(async () => terminalRows.innerText(), { timeout: 15_000 }).toMatch(/APP_MODE_READY/);
		await keyboard.getByRole('button', { name: 'Up arrow', exact: true }).click();
		await expect
			.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
			.toMatch(/APP_UP_BYTES=\s*27\s+79\s+65/);
	});

	await slowStep('Shift+F1 from the function page sends the xterm modified SS3 key', async () => {
		await commandInput.fill(
			'bytes=$(dd bs=1 count=6 2>/dev/null | od -An -t u1); printf \'SHIFT_F1_BYTES=%s\\n\' "$bytes"',
		);
		await commandInput.press('Enter');

		const fn = keyboard.getByRole('button', { name: 'Function keys', exact: true });
		await fn.click();
		await expect(fn).toHaveAttribute('aria-pressed', 'true');
		const shift = keyboard.getByRole('button', { name: 'Shift', exact: true });
		await shift.click();
		await keyboard.getByRole('button', { name: 'F1', exact: true }).click();
		await expect(shift).toHaveAttribute('aria-pressed', 'false');
		await expect
			.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
			.toMatch(/SHIFT_F1_BYTES=\s*27\s+91\s+49\s+59\s+50\s+80/);
		await fn.click();
		await expect(fn).toHaveAttribute('aria-pressed', 'false');
	});

	await slowStep('double-tapping Ctrl locks it across keys until it is tapped again', async () => {
		await commandInput.fill(
			// Hex without spaces keeps both sequences on one narrow mobile terminal row.
			"bytes=$(dd bs=1 count=12 2>/dev/null | od -An -t x1 | tr -d ' \\n'); printf 'CTRL_LOCK=%s\\n' \"$bytes\"",
		);
		await commandInput.press('Enter');

		const ctrl = keyboard.locator('[data-key="ctrl"]');
		await ctrl.dblclick();
		await expect(ctrl).toHaveAccessibleName('Ctrl (locked)');
		const left = keyboard.getByRole('button', { name: 'Left arrow', exact: true });
		await left.click();
		await left.click();
		await expect(ctrl).toHaveAttribute('aria-pressed', 'true');
		await expect
			.poll(async () => terminalRows.innerText(), { timeout: 15_000 })
			.toMatch(/CTRL_LOCK=1b5b313b35441b5b313b3544/);
		await ctrl.click();
		await expect(ctrl).toHaveAttribute('aria-pressed', 'false');
	});
});
