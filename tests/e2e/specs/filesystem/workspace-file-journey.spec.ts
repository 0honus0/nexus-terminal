import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '../../support/real-ssh';
import type { Page } from '../../support/fixtures';
import { readSuspendedSessionCatalog } from '../../../../packages/shared/src/remote/suspend/http-codec';

declare global {
	interface Window {
		clipboardWaitStarted: boolean;
		originalClipboardRead: typeof navigator.clipboard.read;
		resolveClipboard: (items: ClipboardItem[]) => void;
		archiveResultHeld: boolean;
		heldArchiveError: unknown;
		releaseArchiveResult: () => void;
		restoreArchiveWait: () => void;
	}
}

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, description: string): Promise<T> {
	let observed: { value: T } | undefined;
	await expect
		.poll(
			async () => {
				const value = await read();
				observed = { value };
				return accepts(value);
			},
			{ message: description, timeout: 15000 },
		)
		.toBe(true);
	if (!observed) throw Error('Condition did not observe an actual result');
	return observed.value;
}

// A modal overlay blocks pointer navigation; exercise the actual router while it owns the dialog.
async function navigateApp(page: Page, name: string): Promise<void> {
	await page.evaluate(async (name) => {
		function object(value: unknown): value is Record<string, unknown> {
			return typeof value === 'object' && value !== null;
		}

		const root = document.querySelector('#app');
		const app: unknown = root && Reflect.get(root, '__vue_app__');
		if (!object(app) || !object(app.config) || !object(app.config.globalProperties))
			throw Error('Actual App missing');
		const router = app.config.globalProperties.$router;
		if (!object(router) || typeof router.push !== 'function') throw Error('Actual App router missing');
		await router.push({ name });
	}, name);
}

test('formal file manager edits, previews, transfers and archives real SFTP bytes and retains its original suspended PTY', async ({
	page,
	context,
	realSsh,
}) => {
	const remote = join(realSsh.directory, 'remote');
	await mkdir(remote);
	await writeFile(join(remote, 'source.txt'), 'original full-page source\n');
	await writeFile(join(remote, 'preview.md'), '# Formal preview\n\nActual SFTP markdown content.\n');
	const checks: string[] = [];
	const errors: string[] = [];
	page.on('pageerror', (cause) => errors.push(cause.message));
	const controls: { type: string }[] = [];
	page.on('websocket', (socket) => {
		if (new URL(socket.url()).pathname !== '/ws/workspace') return;
		socket.on('framesent', ({ payload }) => {
			if (typeof payload !== 'string') return;
			const value: unknown = JSON.parse(payload);
			if (typeof value !== 'object' || value === null || !('type' in value) || typeof value.type !== 'string')
				throw Error('Invalid actual Workspace control');
			controls.push({ type: value.type });
		});
	});
	await page.goto('/workspace?connectionId=' + realSsh.targetId);
	await page.locator('[data-session-state="connected"]').waitFor();
	const manager = page.locator('.file-manager-root').first();
	const pathInput = page.locator('[data-focus-id="fileManagerPathInput"]').first();

	async function navigate(path: string) {
		await pathInput.fill(path);
		await pathInput.press('Enter');
		await expect(pathInput).toHaveValue(path);
	}

	await navigate(remote);
	await page.locator('tr[data-file-path="' + remote + '/source.txt"]').waitFor();
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	checks.push('formal Workspace opens actual OpenSSH/SFTP and FileManager path navigation lists real isolated files');

	await page.getByRole('button', { name: 'New Folder', exact: true }).first().click();
	await page.locator('#fileManagerActionValue').fill('destination');
	await page.locator('#fileManagerActionValue').press('Enter');
	await page.locator('tr[data-file-path="' + remote + '/destination"]').waitFor();
	assert.equal((await stat(join(remote, 'destination'))).isDirectory(), true);
	await page.getByRole('button', { name: 'New File', exact: true }).first().click();
	await page.locator('#fileManagerActionValue').fill('created.txt');
	await page.locator('#fileManagerActionValue').press('Enter');
	await page.locator('tr[data-file-path="' + remote + '/created.txt"]').waitFor();
	assert.equal(await readFile(join(remote, 'created.txt'), 'utf8'), '');
	checks.push('formal new-folder and new-file dialogs create actual SFTP entries and refresh the same page');

	await page.locator('tr[data-file-path="' + remote + '/source.txt"]').dblclick();
	const popup = page.locator('[data-document-mode="editor"][data-workspace-active="true"]:visible');
	const editor = popup.locator('.monaco-editor');
	await editor.getByText('original full-page source', { exact: false }).first().waitFor();
	await editor.locator('.view-lines').click({ position: { x: 20, y: 10 } });
	await page.keyboard.press('ControlOrMeta+A');
	await page.keyboard.type('edited via formal Monaco and Shared Files', { delay: 15 });
	await page.keyboard.press('Enter');

	await popup.getByRole('button', { name: 'Save', exact: true }).click();
	await until(
		() => readFile(join(remote, 'source.txt'), 'utf8'),
		(value) => value === 'edited via formal Monaco and Shared Files\n',
		'Formal editor saves real bytes',
	);
	await popup.getByRole('button', { name: 'Close Editor', exact: true }).click();
	await expect(popup).toBeHidden();
	checks.push('formal Monaco document load/edit/save updates the actual remote file through Shared Files');

	await page.locator('tr[data-file-path="' + remote + '/preview.md"]').dblclick();
	await page
		.getByRole('dialog', { name: 'Open previews' })
		.getByRole('heading', { name: 'Formal preview', exact: true })
		.waitFor();
	checks.push('formal Markdown preview renders actual SFTP content through the production preview owner');
	await page.getByRole('button', { name: 'Close preview', exact: true }).last().click();

	const upload = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Upload File', exact: true }).first().click();
	await (
		await upload
	).setFiles({ name: 'upload.txt', mimeType: 'text/plain', buffer: Buffer.from('actual full-page upload\n') });
	await until(
		async () => {
			try {
				return await readFile(join(remote, 'upload.txt'), 'utf8');
			} catch (cause) {
				if ((cause instanceof Error && 'code' in cause ? cause.code : undefined) === 'ENOENT') {
					return null;
				}
				throw cause;
			}
		},
		(value) => value === 'actual full-page upload\n',
		'Formal upload publishes bytes',
	);
	await page.locator('tr[data-file-path="' + remote + '/upload.txt"]').waitFor();
	checks.push(
		'formal file chooser starts the real upload control/binary flow and publishes exact bytes before list refresh',
	);

	const download = page.waitForEvent('download');
	await page.locator('tr[data-file-path="' + remote + '/upload.txt"]').click({ button: 'right' });
	await page
		.getByRole('menuitem')
		.filter({ hasText: /^Download$/ })
		.click();
	const artifact = await download;
	assert.equal(artifact.suggestedFilename(), 'upload.txt');
	assert.equal(await readFile(await artifact.path(), 'utf8'), 'actual full-page upload\n');
	checks.push('formal download action consumes the actual browser ticket and delivers the complete remote bytes');

	await page.locator('tr[data-file-path="' + remote + '/created.txt"]').click();
	await page.keyboard.press('F2');
	await page.locator('#fileManagerActionValue').fill('renamed.txt');
	await page.locator('#fileManagerActionValue').press('Enter');
	await page.locator('tr[data-file-path="' + remote + '/renamed.txt"]').waitFor();
	assert.equal(
		await stat(join(remote, 'created.txt')).then(
			() => true,
			(cause) => {
				if ((cause instanceof Error && 'code' in cause ? cause.code : undefined) === 'ENOENT') {
					return false;
				}
				throw cause;
			},
		),
		false,
	);
	checks.push('formal rename keyboard action changes actual remote identity and refreshes the selected directory');

	await page.locator('tr[data-file-path="' + remote + '/upload.txt"]').click();
	await page.keyboard.press('ControlOrMeta+C');
	await page.locator('tr[data-file-path="' + remote + '/destination"]').click();
	await until(
		() => pathInput.inputValue(),
		(value) => value === remote + '/destination',
		'Navigate destination',
	);
	await pathInput.press('Tab');
	await page.keyboard.press('ControlOrMeta+V');
	await until(
		async () => {
			try {
				return await readFile(join(remote, 'destination/upload.txt'), 'utf8');
			} catch (cause) {
				if ((cause instanceof Error && 'code' in cause ? cause.code : undefined) === 'ENOENT') {
					return null;
				}
				throw cause;
			}
		},
		(value) => value === 'actual full-page upload\n',
		'Formal remote copy',
	);
	assert.equal(await readFile(join(remote, 'upload.txt'), 'utf8'), 'actual full-page upload\n');
	checks.push(
		'formal copy/paste uses the remote copy task, preserves its source and publishes exact destination bytes',
	);

	async function exists(path: string) {
		return stat(path).then(
			() => true,
			(cause) => {
				if ((cause instanceof Error && 'code' in cause ? cause.code : undefined) === 'ENOENT') return false;
				throw cause;
			},
		);
	}

	await navigate(remote);
	await page.locator('tr[data-file-path="' + remote + '/renamed.txt"]').click();
	await page.keyboard.press('ControlOrMeta+X');
	await page.locator('tr[data-file-path="' + remote + '/destination"]').click();
	await until(
		() => pathInput.inputValue(),
		(value) => value === remote + '/destination',
		'Move destination',
	);
	await manager.locator('[aria-label="File Manager"][tabindex="0"]').focus();
	await page.keyboard.press('ControlOrMeta+V');
	await until(() => exists(join(remote, 'destination/renamed.txt')), Boolean, 'Moved destination exists');
	assert.equal(await exists(join(remote, 'renamed.txt')), false);
	assert.equal(await readFile(join(remote, 'destination/renamed.txt'), 'utf8'), '');
	checks.push('formal cut/paste executes remote move and removes its original source');

	await page.locator('tr[data-file-path="' + remote + '/destination/upload.txt"]').click({ button: 'right' });
	await page.locator('[role="menuitem"][aria-haspopup="menu"]').hover();
	await page
		.getByRole('menuitem')
		.filter({ hasText: /^Compress to zip$/ })
		.click();
	await until(() => exists(join(remote, 'destination/upload.zip')), Boolean, 'Archive published');
	await page.locator('tr[data-file-path="' + remote + '/destination/upload.zip"]').waitFor();
	assert.ok((await stat(join(remote, 'destination/upload.zip'))).size > 0);
	checks.push('formal archive preset dispatches real SSH zip and refreshes the actual published archive');

	const renamedRow = page.locator('tr[data-file-path="' + remote + '/destination/renamed.txt"]');
	await renamedRow.click();
	await page.keyboard.press('Delete');
	const confirmation = page.getByRole('dialog').filter({ hasText: 'Are you sure you want to delete the file' });
	await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
	assert.equal(await exists(join(remote, 'destination/renamed.txt')), true);
	await renamedRow.click();
	await page.keyboard.press('Delete');
	await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
	await until(
		() => exists(join(remote, 'destination/renamed.txt')),
		(value) => !value,
		'Confirmed deletion',
	);
	await renamedRow.waitFor({ state: 'detached' });
	checks.push(
		'formal delete cancellation preserves remote data and separate confirmation removes only the selected entry',
	);

	await page.locator('tr[data-file-path="' + remote + '/destination/upload.txt"]').click();
	await page.keyboard.press('Delete');
	await confirmation.waitFor();
	await navigateApp(page, 'Settings');
	await confirmation.waitFor({ state: 'detached' });
	assert.equal(await readFile(join(remote, 'destination/upload.txt'), 'utf8'), 'actual full-page upload\n');
	checks.push(
		'leaving the formal Workspace cancels its original destructive confirmation without dispatching deletion',
	);

	await navigateApp(page, 'Workspace');
	await page.locator('[data-session-state="connected"]').waitFor();
	await page.locator('tr[data-file-path="' + remote + '/destination/upload.txt"]').waitFor();
	const uploadsBeforeRevocation = controls.filter((item) => item.type === 'upload.start').length;
	const lateChooserPromise = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Upload File', exact: true }).first().click();
	const lateChooser = await lateChooserPromise;
	await navigateApp(page, 'Settings');
	await lateChooser.setFiles({
		name: 'revoked-upload.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('must never dispatch'),
	});
	await page.evaluate(async () => {
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await navigateApp(page, 'Workspace');
	await page.locator('tr[data-file-path="' + remote + '/destination/upload.txt"]').waitFor();
	assert.equal(controls.filter((item) => item.type === 'upload.start').length, uploadsBeforeRevocation);
	assert.equal(await exists(join(remote, 'destination/revoked-upload.txt')), false);
	checks.push('a native file chooser completed after KeepAlive deactivation cannot start an upload in the next view');

	await page.locator('.xterm-helper-textarea').first().focus();
	await page.keyboard.type('printf "%s" "$BASHPID" > "' + remote + '/pty-before"');
	await page.keyboard.press('Enter');
	await until(() => exists(join(remote, 'pty-before')), Boolean, 'Original real shell identity');
	const originalPid = await readFile(join(remote, 'pty-before'), 'utf8');
	assert.match(originalPid, /^[0-9]+$/);
	const originalWorkspace = await page
		.locator('[role="tab"][data-session-id]')
		.first()
		.getAttribute('data-session-id');
	await page.locator('[role="tab"][data-session-id]').first().click({ button: 'right' });
	await page
		.getByRole('menuitem')
		.filter({ hasText: /^Suspend Session$/ })
		.click();

	const catalog = async () => {
		const response = await context.request.get('/api/v1/ssh-suspend/suspended-sessions');
		expect(response.status()).toBe(200);
		return readSuspendedSessionCatalog(await response.json());
	};

	const marked = await until(
		catalog,
		(items) => items.length === 1 && items[0].ownershipState === 'attached',
		'Real suspend registration',
	);
	const retainedId = marked[0].id;
	await page.getByRole('button', { name: 'Close Tab', exact: true }).first().click();
	await until(
		catalog,
		(items) => items.length === 1 && items[0].ownershipState === 'available',
		'Retained original PTY after tab close',
	);
	assert.equal(await page.locator('[data-session-id="' + originalWorkspace + '"]').count(), 0);
	await page.getByRole('button', { name: 'Suspended SSH Sessions', exact: true }).click();
	await page.locator('[data-suspend-id="' + retainedId + '"] .action-resume').click();
	await page.locator('[data-session-state="connected"]').waitFor();
	const resumed = await until(
		catalog,
		(items) => items.length === 1 && items[0].ownershipState === 'attached',
		'Resumed attachment acknowledged',
	);
	assert.equal(resumed[0].id, retainedId);
	assert.equal(resumed[0].originalWorkspaceId, originalWorkspace);
	assert.ok(resumed[0].ownershipGeneration > marked[0].ownershipGeneration);
	await page.locator('.xterm-helper-textarea').first().focus();
	await page.keyboard.type('printf "%s" "$BASHPID" > "' + remote + '/pty-after"');
	await page.keyboard.press('Enter');
	await until(() => exists(join(remote, 'pty-after')), Boolean, 'Resumed real shell identity');
	assert.equal(await readFile(join(remote, 'pty-after'), 'utf8'), originalPid);
	await navigate(remote + '/destination');
	await page.locator('tr[data-file-path="' + remote + '/destination/upload.txt"]').waitFor();
	assert.equal(await readFile(join(remote, 'destination/upload.txt'), 'utf8'), 'actual full-page upload\n');
	checks.push(
		'formal suspend/close/resume preserves the original real PTY and restores independently acknowledged Files access',
	);

	await page.locator('tr[data-file-path="' + remote + '/destination/upload.txt"]').click();
	await page.keyboard.press('F2');
	await page.locator('#fileManagerActionValue').fill('preserved-upload.txt');
	await page.locator('#fileManagerActionValue').press('Enter');
	await page.locator('tr[data-file-path="' + remote + '/destination/preserved-upload.txt"]').waitFor();
	await page.locator('tr[data-file-path="' + remote + '/destination/upload.zip"]').click({ button: 'right' });
	await page
		.getByRole('menuitem')
		.filter({ hasText: /^Decompress$/ })
		.click();
	await until(() => exists(join(remote, 'destination/upload.txt')), Boolean, 'Extracted exact source restored');
	assert.equal(await readFile(join(remote, 'destination/upload.txt'), 'utf8'), 'actual full-page upload\n');
	checks.push('formal decompression restores the original exact bytes from the real SSH archive');

	const clipboardUploads = controls.filter((item) => item.type === 'upload.start').length;
	await page.evaluate(() => {
		window.clipboardWaitStarted = false;
		window.originalClipboardRead = navigator.clipboard.read;
		Object.defineProperty(navigator.clipboard, 'read', {
			configurable: true,

			value: () => {
				window.clipboardWaitStarted = true;
				return new Promise((resolve) => {
					window.resolveClipboard = resolve;
				});
			},
		});
		const manager = document.querySelector('.file-manager-root [aria-label="File Manager"][tabindex="0"]');
		if (!manager) throw Error('Actual file manager missing');
		manager.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
	});
	await page.waitForFunction(() => window.clipboardWaitStarted);
	await navigateApp(page, 'Settings');
	await page.evaluate(async () => {
		window.resolveClipboard([
			new ClipboardItem({ 'image/png': new Blob(['controlled stale image'], { type: 'image/png' }) }),
		]);
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		Object.defineProperty(navigator.clipboard, 'read', { configurable: true, value: window.originalClipboardRead });
	});
	await navigateApp(page, 'Workspace');
	assert.equal(controls.filter((item) => item.type === 'upload.start').length, clipboardUploads);
	checks.push('controlled Clipboard API late image cannot upload after the original formal view is deactivated');

	await writeFile(join(remote, 'destination/secret.txt'), 'isolated encrypted archive fixture\n');
	execFileSync(
		'zip',
		[
			'-j',
			'-P',
			'isolated-fixture-password',
			join(remote, 'destination/protected.zip'),
			join(remote, 'destination/secret.txt'),
		],
		{ stdio: 'ignore' },
	);
	await manager.locator('[aria-label="File Manager"][tabindex="0"]').focus();
	await page.keyboard.press('F5');
	await page.locator('tr[data-file-path="' + remote + '/destination/protected.zip"]').waitFor();
	try {
		await page.evaluate(async () => {
			function object(value: unknown): value is Record<string, unknown> {
				return typeof value === 'object' && value !== null;
			}

			const visited = new Set<unknown>();

			function find(value: unknown): Record<string, unknown> | undefined {
				if (!object(value) || visited.has(value)) return;
				visited.add(value);
				if (object(value.component)) {
					const props = value.component.props;
					if (object(props) && object(props.session) && object(props.session.transferController))
						return props.session.transferController;
					const nested = find(value.component.subTree);
					if (nested) return nested;
				}
				if (Array.isArray(value.children)) {
					for (const child of value.children) {
						const found = find(child);
						if (found) return found;
					}
				}
			}

			const root = document.querySelector('#app');
			const controller = root && find(Reflect.get(root, '_vnode'));
			if (!controller || typeof controller.waitForTask !== 'function')
				throw Error('Actual rendered transfer controller missing');
			const originalWait = controller.waitForTask;
			window.archiveResultHeld = false;
			controller.waitForTask = async (id: unknown) => {
				const task: unknown = await originalWait.call(controller, id);
				if (!object(task)) throw Error('Actual transfer result missing');
				if (task.kind !== 'decompress') return task;
				window.heldArchiveError = task.errorCode;
				window.archiveResultHeld = true;
				await new Promise<void>((resolve) => {
					window.releaseArchiveResult = resolve;
				});
				return task;
			};
			window.restoreArchiveWait = () => {
				controller.waitForTask = originalWait;
			};
		});
		await page.locator('tr[data-file-path="' + remote + '/destination/protected.zip"]').click({ button: 'right' });
		await page
			.getByRole('menuitem')
			.filter({ hasText: /^Decompress$/ })
			.click();
		await page.waitForFunction(() => window.archiveResultHeld);
		assert.equal(await page.evaluate(() => window.heldArchiveError), 'PASSWORD_REQUIRED');
		await navigateApp(page, 'Settings');
		await page.evaluate(async () => {
			window.releaseArchiveResult();
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			window.restoreArchiveWait();
		});
		await navigateApp(page, 'Workspace');
		assert.equal(await page.getByRole('dialog', { name: 'zip password required', exact: true }).count(), 0);
		checks.push(
			'real password-required archive result held until after leaving cannot reopen a password prompt in a later view',
		);
	} finally {
		if (!page.isClosed())
			await page.evaluate(() => {
				window.releaseArchiveResult?.();
				window.restoreArchiveWait?.();
			});
	}

	expect(errors).toEqual([]);
	expect(checks).toHaveLength(17);
});
