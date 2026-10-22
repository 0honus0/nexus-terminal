import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';
import { openSshd } from '../backend/remote/openssh-fixture.mjs';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-workspace-page-'));
const remote = join(directory, 'remote');
const checks = [];
let app;
let vite;
let browser;
let ssh;

async function until(read, accepts, description) {
	const deadline = performance.now() + 15000;
	let value;
	do {
		value = await read();
		if (accepts(value)) {
			return value;
		}
		await new Promise((resolve) => setTimeout(resolve, 30));
	} while (performance.now() < deadline);
	assert.fail(description + ': ' + JSON.stringify(value));
}

try {
	await mkdir(remote);
	await writeFile(join(remote, 'source.txt'), 'original full-page source\n');
	await writeFile(join(remote, 'preview.md'), '# Formal preview\n\nActual SFTP markdown content.\n');
	ssh = await openSshd(directory);
	const net = createNetServer();
	await new Promise((resolve) => net.listen(0, '127.0.0.1', resolve));
	const port = net.address().port;
	await new Promise((resolve) => net.close(resolve));
	const origin = 'http://127.0.0.1:' + port;
	app = await createApp(join(directory, 'app.db'), { encryptionKey: randomBytes(32) });
	const address = await app.listenHttp({
		publicOrigin: origin,
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: ['loopback'],
	});
	vite = await createServer({
		root: fileURLToPath(new URL('../../packages/frontend', import.meta.url)),
		configFile: fileURLToPath(new URL('../../packages/frontend/vite.config.ts', import.meta.url)),
		cacheDir: join(directory, 'vite-cache'),
		logLevel: 'error',
		server: {
			host: '127.0.0.1',
			port,
			strictPort: true,
			proxy: {
				'/api': { target: 'http://' + address, changeOrigin: false },
				'/ws/workspace': { target: 'ws://' + address, ws: true, changeOrigin: false },
				'/ws/uploads': { target: 'ws://' + address, ws: true, changeOrigin: false },
			},
		},
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ acceptDownloads: true });
	const controls = [];
	page.on('websocket', (socket) => {
		if (!socket.url().includes('/ws/workspace')) return;
		socket.on('framesent', ({ payload }) => {
			if (typeof payload === 'string') controls.push(JSON.parse(payload));
		});
	});
	page.setDefaultTimeout(15000);
	await page.goto(origin + '/login');
	await page.evaluate(
		async ({ port, user }) => {
			const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
			const api = createAccessApi();
			await api.setup({
				username: 'admin',
				password: 'Workspace-page-fixture-2026!',
				confirmPassword: 'Workspace-page-fixture-2026!',
			});
			await api.login({ username: 'admin', password: 'Workspace-page-fixture-2026!', rememberMe: false });
			const { connectionsApi } = await import('/src/features/connections/api/connections-api.ts');
			const result = await connectionsApi.importMany([
				{
					connection: {
						name: 'Full page SSH',
						type: 'SSH',
						host: '127.0.0.1',
						port,
						username: user,
						route: 'direct',
						proxyId: null,
						notes: null,
						tagIds: [],
						jumpIds: [],
					},
				},
			]);
			if (result[0].status !== 'ok') {
				throw Error('Fixture target creation failed');
			}
		},
		{ port: ssh.port, user: ssh.user },
	);
	await app.targets.hostKeys.confirm({ host: '127.0.0.1', port: ssh.port, fingerprint: ssh.fingerprint });
	const key = await app.targets.sshKeys.create({ name: 'Full page key', privateKey: ssh.privateKey });
	const target = (await app.targets.list())[0];
	assert.equal(
		(await app.targets.credentials.set(target.id, target.version, { kind: 'ssh_key', sshKeyId: key.id })).status,
		'updated',
	);
	await page.goto(origin + '/workspace?connectionId=' + target.id);
	await page.locator('[data-session-state="connected"]').waitFor();
	await page.evaluate(async () => {
		const { setLocale } = await import('/src/app/i18n/index.ts');
		setLocale('en-US');
	});
	const manager = page.locator('.file-manager-root').first();
	const pathInput = page.locator('[data-focus-id="fileManagerPathInput"]').first();

	async function navigate(path) {
		await pathInput.fill(path);
		await pathInput.press('Enter');
		await page.locator('tr[data-file-path="' + path + '/source.txt"]').count();
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
	const editor = page.locator('.monaco-editor').first();
	await editor.getByText('original full-page source', { exact: false }).first().waitFor();
	await editor.locator('.view-lines').click();
	await page.keyboard.press('ControlOrMeta+A');
	await page.keyboard.type('edited via formal Monaco and Shared Files', { delay: 15 });
	await page.keyboard.press('Enter');

	await page.getByRole('button', { name: 'Save', exact: true }).first().click();
	await until(
		() => readFile(join(remote, 'source.txt'), 'utf8'),
		(value) => value === 'edited via formal Monaco and Shared Files\n',
		'Formal editor saves real bytes',
	);
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
				if (cause.code === 'ENOENT') {
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
		.locator('.context-item')
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
				if (cause.code === 'ENOENT') {
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
	await page.locator('tr[data-file-path="' + remote + '/destination"]').dblclick();
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
				if (cause.code === 'ENOENT') {
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

	async function exists(path) {
		return stat(path).then(
			() => true,
			(cause) => {
				if (cause.code === 'ENOENT') return false;
				throw cause;
			},
		);
	}

	await navigate(remote);
	await page.locator('tr[data-file-path="' + remote + '/renamed.txt"]').click();
	await page.keyboard.press('ControlOrMeta+X');
	await page.locator('tr[data-file-path="' + remote + '/destination"]').dblclick();
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
	await page.locator('.context-item[aria-haspopup="menu"]').hover();
	await page
		.locator('.context-item')
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
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Settings' });
	});
	await confirmation.waitFor({ state: 'detached' });
	assert.equal(await readFile(join(remote, 'destination/upload.txt'), 'utf8'), 'actual full-page upload\n');
	checks.push(
		'leaving the formal Workspace cancels its original destructive confirmation without dispatching deletion',
	);

	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Workspace' });
	});
	await page.locator('[data-session-state="connected"]').waitFor();
	await page.locator('tr[data-file-path="' + remote + '/destination/upload.txt"]').waitFor();
	const uploadsBeforeRevocation = controls.filter((item) => item.type === 'upload.start').length;
	const lateChooserPromise = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: 'Upload File', exact: true }).first().click();
	const lateChooser = await lateChooserPromise;
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Settings' });
	});
	await lateChooser.setFiles({
		name: 'revoked-upload.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('must never dispatch'),
	});
	await page.evaluate(async () => {
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Workspace' });
	});
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
		.locator('.context-item')
		.filter({ hasText: /^Suspend Session$/ })
		.click();

	const catalog = () =>
		page.evaluate(async () => {
			const response = await fetch('/api/v1/ssh-suspend/suspended-sessions');
			if (!response.ok) throw Error('Suspended catalog failed: ' + response.status);
			return response.json();
		});

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
		.locator('.context-item')
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
		document
			.querySelector('.file-manager-root [aria-label="File Manager"][tabindex="0"]')
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
	});
	await page.waitForFunction(() => window.clipboardWaitStarted);
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Settings' });
		window.resolveClipboard([
			{
				types: ['image/png'],

				getType: async () => new Blob(['controlled stale image'], { type: 'image/png' }),
			},
		]);
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		Object.defineProperty(navigator.clipboard, 'read', { configurable: true, value: window.originalClipboardRead });
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Workspace' });
	});
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
	await page.evaluate(async () => {
		const { workspaceRuntimeRegistry } =
			await import('/src/runtimes/workspace/session/workspaceRuntimeRegistry.ts');
		const session = workspaceRuntimeRegistry.activeSession.value;
		const controller = session.transferController;
		const originalWait = controller.waitForTask;
		window.archiveResultHeld = false;
		controller.waitForTask = async (id) => {
			const task = await originalWait(id);
			if (task.kind !== 'decompress') return task;
			window.heldArchiveError = task.errorCode;
			window.archiveResultHeld = true;
			await new Promise((resolve) => {
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
		.locator('.context-item')
		.filter({ hasText: /^Decompress$/ })
		.click();
	await page.waitForFunction(() => window.archiveResultHeld);
	assert.equal(await page.evaluate(() => window.heldArchiveError), 'PASSWORD_REQUIRED');
	await page.evaluate(async () => {
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Settings' });
		window.releaseArchiveResult();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		window.restoreArchiveWait();
		await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push({ name: 'Workspace' });
	});
	assert.equal(await page.getByRole('dialog', { name: 'zip password required', exact: true }).count(), 0);
	checks.push(
		'real password-required archive result held until after leaving cannot reopen a password prompt in a later view',
	);

	console.log('Workspace formal files: ' + checks.length + ' checks PASS\n' + checks.join('\n'));
} catch (cause) {
	console.error('Completed checks', checks);
	console.error(cause);
	throw cause;
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() => ssh?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Workspace formal files fixture cleanup failed');
	}
}
