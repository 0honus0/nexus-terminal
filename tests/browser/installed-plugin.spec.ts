import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { create as createArchive } from 'tar';
import { sql } from 'kysely';
import { pluginTablePrefix } from '../../src/database/node/database-api.js';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isIP, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, CDPSession } from '@playwright/test';
import { browserTest as test, expect } from './plugin-host-fixture.js';
import vue from '@vitejs/plugin-vue';
import { build, preview } from 'vite';
import { App } from '../../src/app/node/app.js';
import { BackupFileSchema, backupBase } from '../../src/backup/backup-http-types.js';
import { MarketplaceStorage } from '../../src/marketplace/node/marketplace-storage.js';
import {
	MarketplacePluginListSchema,
	MarketplaceRuntimeImpactSchema,
	MarketplacePreloginSchema,
	marketplacePreloginPath,
} from '../../src/marketplace/marketplace-http-types.js';
import {
	MarketplaceFrontendsTopic,
	MarketplaceOperationSchema,
	MarketplacePluginId,
} from '../../src/marketplace/marketplace-types.js';
import { inspectPluginPackage } from '../../src/plugin/plugin-api.node.js';
import { PluginScope } from '../../src/plugin/plugin-api.js';
import { settingsBase, SettingsSnapshotSchema } from '../../src/settings/settings-http-types.js';
import { SettingsTopic } from '../../src/settings/settings-types.js';
import { StateCommandSchema, StateMessageSchema, stateTopicKey } from '../../src/state/state-ws-types.js';
import { backendProxy } from '../../vite.config.js';

const pluginId = '@nexus-terminal/test';
const browserEntry = fileURLToPath(new URL('../fixtures/plugins/test/src/browser/index.ts', import.meta.url));
const marketplace = `/api/plugins/${encodeURIComponent(MarketplacePluginId)}/manager`;

async function buildPlugin(directory: string, version: string): Promise<void> {
	const output = join(directory, 'dist/browser');
	await mkdir(output, { recursive: true });
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({
			name: pluginId,
			version,
			type: 'module',
			peerDependencies: { 'nexus-terminal': '^1.0.0' },
			nexus: { kind: 'extension', entry: { frontend: 'dist/browser/index.mjs' } },
		}),
	);
	await build({
		configFile: false,
		publicDir: false,
		logLevel: 'error',
		plugins: [vue()],
		build: {
			lib: {
				entry: browserEntry,
				formats: ['es'],

				fileName: () => 'bundle.js',
			},
			outDir: output,
			emptyOutDir: true,
			rollupOptions: { external: ['vue', 'vue-i18n', 'nexus-terminal/browser', 'nexus-terminal/browser/ui'] },
		},
	});
	await writeFile(
		join(output, 'index.mjs'),
		`
		import { PluginLogInputSchema } from 'nexus-terminal/browser';
		import { activate as activateView } from './bundle.js';
		export { deactivate } from './bundle.js';
		export function activate(context) {
			context.app.log.report(PluginLogInputSchema.parse({ level: 'info', code: 'TEST_INSTALLED_FRONTEND' }));
			context.contribute({
				themes: [{ id: 'fixture', label: 'Fixture theme', mode: 'dark', tokens: { '--ui-primary': '#123456' } }],
			});
			return activateView(context);
		}
	`,
	);
	await mkdir(join(output, 'styles'));
	await writeFile(join(output, 'styles/demo.css'), ':root { --fixture-color: red; }');
	await writeFile(join(directory, 'private.js'), '// outside the browser artifact directory');
	await symlink(join(directory, 'private.js'), join(output, 'external.js'));
}

async function previewRuntimeImpact(request: APIRequestContext, origin: string) {
	const response = await request.get(
		`${origin}${marketplace}/plugins/${encodeURIComponent(pluginId)}/runtime-impact`,
	);
	expect(response.status()).toBe(200);
	return MarketplaceRuntimeImpactSchema.parse(await response.json());
}

async function setEnabled(request: APIRequestContext, origin: string, enabled: boolean): Promise<void> {
	const response = await request.patch(`${origin}${marketplace}/plugins/${encodeURIComponent(pluginId)}`, {
		data: enabled
			? { enabled: true }
			: { enabled: false, impactRevision: (await previewRuntimeImpact(request, origin)).revision },
	});
	expect(response.status()).toBe(202);
	const { id } = MarketplaceOperationSchema.parse(await response.json());
	await expect
		.poll(async () => {
			const current = await request.get(`${origin}${marketplace}/operations/${id}`);
			return MarketplaceOperationSchema.parse(await current.json()).state;
		})
		.toBe('succeeded');
}

const cdp = process.env.NEXUS_TEST_CDP;
const bind = cdp ? new URL(process.env.NEXUS_TEST_CDP_ORIGIN!).hostname : '127.0.0.1';
const peer = cdp ? new URL(cdp).hostname : bind;
if (isIP(bind) !== 4 || isIP(peer) !== 4) throw new Error('Invalid isolated browser binding');

function frontendOrigin(server: Awaited<ReturnType<typeof preview>>) {
	return 'http://' + bind + ':' + (server.httpServer.address() as AddressInfo).port;
}

async function serveFrontend(app: App, outDir: string) {
	await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
	return preview({
		logLevel: 'error',
		build: { outDir },
		plugins: [
			{
				name: 'isolated-browser-peer',

				configurePreviewServer(server) {
					server.middlewares.use((req, res, next) => {
						if (req.socket.remoteAddress === peer || req.socket.remoteAddress === bind) next();
						else {
							res.statusCode = 403;
							res.end();
						}
					});
					server.httpServer.prependListener('upgrade', (req, socket) => {
						if (req.socket.remoteAddress !== peer && req.socket.remoteAddress !== bind) socket.destroy();
					});
				},
			},
		],
		preview: { host: bind, port: 0, proxy: { '/api': backendProxy(app.services.get('http').origin) } },
	});
}

test('已安装插件的加载与撤销，以及内置设置和备份恢复', async ({ page, playwright }) => {
	test.setTimeout(60_000);
	const directory = await mkdtemp(join(tmpdir(), 'nexus-installed-browser-'));
	const app = new App({ dataDirectory: join(directory, 'data'), logLevel: 'fatal' });
	const scope = new PluginScope(() => {});
	const frontend = join(directory, 'app');
	let server: Awaited<ReturnType<typeof preview>> | undefined;
	let anonymous: APIRequestContext | undefined;
	let downloadSession: CDPSession | undefined;

	let releaseImports: () => void = () => {};

	try {
		const first = join(directory, 'first');
		const second = join(directory, 'second');
		await buildPlugin(first, '1.0.0');
		await buildPlugin(second, '2.0.0');
		await app.initialize();
		await app.startBuiltinPlugins();
		const database = app.services.get('database').bind(MarketplacePluginId, scope);
		const storage = new MarketplaceStorage(database);
		await storage.register(await inspectPluginPackage(first));
		await storage.setEnabled(pluginId, true);
		await app.startExternalPlugins();

		server = await serveFrontend(app, frontend);
		const origin = frontendOrigin(server);
		anonymous = await playwright.request.newContext();
		expect(
			(await anonymous.get(`${origin}/api/auth/state`, { headers: { origin: 'http://other.invalid' } })).status(),
		).toBe(403);

		const isEntry = (response: { url(): string }) => {
			const path = new URL(response.url()).pathname;
			return path.includes('/frontends/') && path.endsWith('/index.mjs');
		};

		const frontendTopic = stateTopicKey(MarketplaceFrontendsTopic);
		let deliveredGap = false;
		let resyncs = 0;
		let settingsSubscriptions = 0;
		await page.routeWebSocket('**/api/state/ws', (client) => {
			const host = client.connectToServer();
			host.onMessage((data) => {
				const frame = StateMessageSchema.parse(JSON.parse(String(data)));
				if (!deliveredGap && frame.type === 'patch' && stateTopicKey(frame.topic) === frontendTopic) {
					deliveredGap = true;
					client.send(
						JSON.stringify({
							...frame,
							baseRevision: frame.baseRevision + 1,
							revision: frame.revision + 1,
						}),
					);
				} else client.send(data);
			});
			client.onMessage((data) => {
				const command = StateCommandSchema.parse(JSON.parse(String(data)));
				if (command.type === 'resync' && stateTopicKey(command.topic) === frontendTopic) resyncs++;
				if (command.type === 'subscribe' && stateTopicKey(command.topic) === stateTopicKey(SettingsTopic))
					settingsSubscriptions++;
				host.send(data);
			});
		});
		const firstResponse = page.waitForResponse(isEntry);
		const sharedImports = new Promise<void>((resolve) => (releaseImports = resolve));
		let importRequests = 0;
		await page.route('**/assets/plugin-imports-*.js', async (route) => {
			importRequests++;
			await sharedImports;
			await route.continue();
		});
		await page.goto(origin);
		await page.getByRole('textbox', { name: 'Username' }).fill('owner');
		await expect(page).toHaveURL(origin + '/login');
		await page.getByLabel('Password', { exact: true }).fill('test-password');
		expect(importRequests).toBe(0);
		await page.getByRole('button', { name: 'Create account', exact: true }).click();
		await expect.poll(() => importRequests).toBe(1);
		await expect(page.getByRole('status', { name: 'Preparing your workspace' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
		releaseImports();
		const result = await firstResponse;
		await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
		await expect(page).toHaveURL(origin + '/');
		expect(result.status()).toBe(200);
		const firstURL = result.url();
		const etag = result.headers()['etag'];
		expect(etag).toBeTruthy();
		expect(result.headers()['cache-control']).toBe('private, no-cache');
		const conditional = { headers: { 'if-none-match': etag! } };
		const cached = await page.request.get(firstURL, conditional);
		expect(cached.status()).toBe(304);
		expect((await cached.body()).length).toBe(0);
		expect((await anonymous.get(firstURL, conditional)).status()).toBe(401);
		expect((await page.request.head(firstURL)).headers()['content-type']).toMatch(/javascript/u);
		expect((await page.request.get(new URL('styles/demo.css', firstURL).href)).headers()['content-type']).toMatch(
			/^text\/css/u,
		);
		expect((await page.request.get(new URL('external.js', firstURL).href)).status()).toBe(404);
		expect((await page.request.get(new URL('package.json', firstURL).href)).status()).toBe(404);

		const reloadResponse = page.waitForResponse(isEntry);
		const reload = await page.request.post(`${origin}${marketplace}/reload`, {
			data: { pluginId, impactRevision: (await previewRuntimeImpact(page.request, origin)).revision },
		});
		expect(reload.status()).toBe(202);
		const reloaded = await reloadResponse;
		expect(reloaded.status()).toBe(200);
		expect(reloaded.url()).not.toBe(firstURL);
		expect((await page.request.get(firstURL, conditional)).status()).toBe(404);

		const widget = page.getByRole('region', { name: 'Counter Widget' });
		await widget.getByRole('button', { name: 'Increment' }).click();
		await expect(widget.getByText('Count: 1')).toBeVisible();
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		const settings = page.getByRole('region', { name: 'Settings', exact: true });
		const html = page.locator('html');
		await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
		await settings.getByRole('button', { name: 'Dark', exact: true }).click();
		await expect(html).toHaveAttribute('data-ui-mode', 'dark');
		await expect
			.poll(
				async () =>
					SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json())
						.preferences.theme,
			)
			.toBe('dark');
		await settings.getByRole('button', { name: 'Close application' }).click();
		await page.getByRole('button', { name: 'Backup and Restore', exact: true }).click();
		const backup = page.getByRole('region', { name: 'Backup and Restore', exact: true });
		const exportPanel = backup.locator('.nexus-backup__sections').getByRole('region', { name: 'Export' });
		// Use a fresh directory for every run; existing filenames may be renamed by Chrome.
		const remoteDownloadDir = process.env.NEXUS_TEST_CDP_DOWNLOAD_DIR;
		if (remoteDownloadDir) {
			if (!cdp || !/^[a-z]:[\\/]/iu.test(remoteDownloadDir))
				throw new Error('Remote download assertions require a disposable absolute Windows directory');
			downloadSession = await page.context().browser()!.newBrowserCDPSession();
			const session = await page.context().newCDPSession(page);
			try {
				const { targetInfo } = await session.send('Target.getTargetInfo');
				const { browserContextIds } = await downloadSession.send('Target.getBrowserContexts');
				if (!targetInfo.browserContextId || !browserContextIds.includes(targetInfo.browserContextId))
					throw new Error('Download behavior must be scoped to a disposable context');
				await downloadSession.send('Browser.setDownloadBehavior', {
					behavior: 'allow',
					browserContextId: targetInfo.browserContextId,
					downloadPath: remoteDownloadDir,
					eventsEnabled: true,
				});
			} finally {
				await session.detach();
			}
		}

		await exportPanel.getByLabel('Password').fill('test-backup-password');
		const exported = page.waitForResponse(
			(response) =>
				new URL(response.url()).pathname === backupBase + '/export' && response.request().method() === 'POST',
		);
		const download = page.waitForEvent('download');
		await exportPanel.getByRole('button', { name: 'Export', exact: true }).click();
		const archive = await download;
		expect(archive.suggestedFilename()).toBe('nexus-backup.json');
		const response = await exported;
		expect(response.status()).toBe(200);
		const archiveData = BackupFileSchema.parse(await response.json());
		const archivePath = join(directory, 'nexus-backup.json');
		if (remoteDownloadDir) {
			const deadline = new AbortController();
			try {
				expect(
					await Promise.race([
						archive.failure(),
						delay(30000, undefined, { signal: deadline.signal }).then(() => {
							throw new Error('Remote download timed out');
						}),
					]),
				).toBeNull();
			} finally {
				deadline.abort();
			}
			const verifier = await page.context().newPage();
			try {
				await verifier.goto(origin);
				await verifier.setContent('<input type="file" id="fixture-download">');
				const session = await verifier.context().newCDPSession(verifier);
				try {
					const { root } = await session.send('DOM.getDocument');
					const { nodeId } = await session.send('DOM.querySelector', {
						nodeId: root.nodeId,
						selector: '#fixture-download',
					});
					await session.send('DOM.setFileInputFiles', {
						nodeId,
						files: [win32.join(remoteDownloadDir, 'nexus-backup.json')],
					});
					const expected = JSON.stringify(archiveData);
					const checked = await verifier
						.locator('input')
						.evaluate(async (input: HTMLInputElement, expected) => {
							const file = input.files?.[0];
							return { size: file?.size, matches: file ? (await file.text()) === expected : false };
						}, expected);
					expect(checked).toEqual({ size: Buffer.byteLength(expected), matches: true });
				} finally {
					await session.detach();
				}
			} finally {
				await verifier.close();
			}
			await writeFile(archivePath, JSON.stringify(archiveData));
		} else if (cdp) await writeFile(archivePath, JSON.stringify(archiveData));
		else await archive.saveAs(archivePath);
		expect(BackupFileSchema.parse(JSON.parse(await readFile(archivePath, 'utf8')))).toEqual(archiveData);

		const changed = await page.request.patch(origin + settingsBase, { data: { theme: 'light' } });
		expect(changed.ok()).toBe(true);
		expect(SettingsSnapshotSchema.parse(await changed.json()).preferences.theme).toBe('light');
		await expect(html).toHaveAttribute('data-ui-mode', 'light');

		const file = backup.getByLabel('Choose a backup file');
		await file.setInputFiles({
			name: 'broken.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{'),
		});
		const importPanel = backup.locator('.nexus-backup__sections').getByRole('region', { name: 'Import' });
		const previewButton = importPanel.getByRole('button', { name: 'Restore', exact: true });
		const preview = page.getByRole('dialog', { name: 'Restore', exact: true });
		const toast = page.locator('[data-ui="toast"]');

		await importPanel.getByLabel('Password').fill('wrong-password');
		await previewButton.click();
		await expect(toast.getByText('This backup file is invalid.')).toBeVisible();
		await expect(preview).toHaveCount(0);
		await file.setInputFiles({
			name: 'nexus-backup.json',
			mimeType: 'application/json',
			buffer: await readFile(archivePath),
		});
		await previewButton.click();
		await expect(toast.getByText('Could not open the backup with this password.')).toBeVisible();
		await expect(preview).toHaveCount(0);
		await expect(html).toHaveAttribute('data-ui-mode', 'light');

		await importPanel.getByLabel('Password').fill('test-backup-password');
		await previewButton.click();
		await expect(preview.getByText('@nexus-terminal/settings · 1 rows')).toBeVisible();
		expect(
			SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json()).preferences
				.theme,
		).toBe('light');
		await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(preview).toHaveCount(0);
		await expect(html).toHaveAttribute('data-ui-mode', 'light');
		expect(
			SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json()).preferences
				.theme,
		).toBe('light');
		await previewButton.click();
		await expect(preview.getByText('@nexus-terminal/settings · 1 rows')).toBeVisible();
		await preview.getByRole('button', { name: 'Restore', exact: true }).click();
		await expect(preview).toHaveCount(0);
		await expect(toast.getByText('Restore complete.', { exact: true })).toBeVisible();
		await expect(backup.getByRole('status')).toHaveCount(0);
		await expect(html).toHaveAttribute('data-ui-mode', 'dark');
		expect(
			SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json()).preferences
				.theme,
		).toBe('dark');
		await backup.getByRole('button', { name: 'Close application' }).press('Enter');
		await expect(backup).toHaveCount(0);
		await page.getByRole('button', { name: 'Logs', exact: true }).click();
		const logs = page.getByRole('region', { name: 'Logs', exact: true });
		const searchLogs = logs.getByRole('searchbox', { name: 'Search messages, sources or event codes' });
		const level = logs.getByRole('combobox', { name: 'Log level' });
		await searchLogs.fill('BACKUP_FILE_INVALID');
		const failedBackup = logs.locator('details').filter({ hasText: 'This backup file is invalid.' });
		await expect(failedBackup).toBeVisible();
		await failedBackup.locator('summary').press('Enter');
		await expect(failedBackup.locator('dd').filter({ hasText: 'BACKUP_FILE_INVALID' })).toBeVisible();
		await level.click();
		await page.getByRole('option', { name: 'Info', exact: true }).click();
		await expect(logs.getByText('No matching logs', { exact: true })).toBeVisible();
		await searchLogs.fill('BACKUP_RESTORED');
		await expect(logs.locator('details').filter({ hasText: 'Restore complete.' })).toBeVisible();
		await logs.getByRole('button', { name: 'Clear logs', exact: true }).click();
		await expect(logs.getByText('No logs yet', { exact: true })).toBeVisible();
		await expect(logs.getByRole('button', { name: 'Clear logs', exact: true })).toBeDisabled();
		await logs.getByRole('button', { name: 'Close application' }).press('Enter');
		await expect(logs).toHaveCount(0);
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		const themeSource = settings.getByRole('combobox', { name: 'Theme source' });
		await themeSource.click();
		await page.getByRole('option', { name: 'Fixture theme' }).click();
		await expect(html).toHaveCSS('--ui-primary', '#123456');
		await themeSource.click();
		await page.getByRole('option', { name: 'Built-in theme' }).click();
		await expect(html).not.toHaveCSS('--ui-primary', '#123456');
		await themeSource.click();
		await page.getByRole('option', { name: 'Fixture theme' }).click();

		await settings.getByRole('button', { name: 'Light', exact: true }).click();
		await expect(html).toHaveAttribute('data-ui-mode', 'light');
		await settings.getByRole('button', { name: 'System', exact: true }).click();
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(html).toHaveAttribute('data-ui-mode', 'dark');
		await page.emulateMedia({ colorScheme: 'light' });
		await expect(html).toHaveAttribute('data-ui-mode', 'light');

		await settings.getByRole('combobox', { name: 'Escape key action' }).click();
		await page.getByRole('option', { name: 'Close application' }).click();
		await expect
			.poll(
				async () =>
					SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json())
						.preferences.escapeAction,
			)
			.toBe('close');
		await expect(page.locator('[data-ui="select-content"]')).toHaveCount(0);
		const focusedControl = settings.getByRole('button', { name: 'System', exact: true });
		await focusedControl.focus();
		// 备份通知优先响应 Escape，最多四条。设置窗口随后响应 Escape。
		for (let remaining = 4; remaining > 0 && (await toast.isVisible()); remaining--) {
			await focusedControl.press('Escape');
			await expect(settings).toBeVisible();
		}
		await focusedControl.press('Escape');
		await expect(settings).toHaveCount(0);
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		const motion = page.getByRole('switch', { name: 'Motion effects' });
		const speed = page.getByRole('slider', { name: 'Animation speed' });
		await speed.press('ArrowRight');
		await expect(speed).toHaveAttribute('aria-valuenow', '1.3');
		await expect(page.locator('html')).toHaveCSS('--ui-motion-speed', '1.3');
		await motion.click();
		await expect(page.locator('html')).toHaveAttribute('data-ui-motion', 'reduced');
		await expect(speed).toHaveAttribute('data-disabled', '');
		await page.getByRole('combobox', { name: 'Language' }).click();
		await page.getByRole('option', { name: '简体中文' }).click();
		await expect(page.getByRole('switch', { name: '动态效果', exact: true })).not.toBeChecked();
		await page.getByRole('region', { name: '设置', exact: true }).getByRole('button', { name: '关闭应用' }).click();
		await expect(widget.getByText('计数：1')).toBeVisible();
		await expect
			.poll(
				async () =>
					SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json())
						.preferences.locale,
			)
			.toBe('zh');
		const saved = SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json());
		expect(saved.preferences).toEqual({
			locale: 'zh',
			theme: 'system',
			themeId: JSON.stringify([pluginId, 'fixture']),
			motionEffects: false,
			animationSpeed: 1.3,
			escapeAction: 'close',
			wallpaper: 'silk',
		});
		const secondTab = await page.context().newPage();
		try {
			await secondTab.goto(origin);
			await expect(secondTab.locator('html')).toHaveAttribute('lang', 'zh');
			await expect(secondTab.locator('html')).toHaveAttribute('data-ui-motion', 'reduced');
			await expect(secondTab.locator('html')).toHaveCSS('--ui-motion-speed', '1.3');
			await expect(secondTab.locator('html')).toHaveCSS('--ui-primary', '#123456');
		} finally {
			await secondTab.close();
		}

		await setEnabled(page.request, origin, false);
		await expect(widget).toHaveCount(0);
		await expect(html).not.toHaveCSS('--ui-primary', '#123456');
		expect(resyncs).toBe(1);
		expect((await page.request.get(firstURL)).status()).toBe(404);

		// 市场更新操作尚未接入；禁用后用测试库替换已准备好的安装记录。
		const replacement = await inspectPluginPackage(second);
		type TestTables = { plugins: { pluginId: string; version: string; directory: string } };
		await database.withClient((client) =>
			client
				.$extendTables<TestTables>()
				.updateTable('plugins')
				.set({ directory: replacement.directory, version: replacement.version })
				.where('pluginId', '=', pluginId)
				.execute(),
		);
		const secondResponse = page.waitForResponse(isEntry);
		await setEnabled(page.request, origin, true);
		const installed = await secondResponse;
		expect(installed.status()).toBe(200);
		expect(installed.url()).not.toBe(firstURL);
		await expect(widget.getByText('计数：0')).toBeVisible();
		await expect(html).toHaveCSS('--ui-primary', '#123456');
		expect((await page.request.get(firstURL)).status()).toBe(404);

		await page.getByRole('button', { name: '设置', exact: true }).click();
		await page.getByLabel('当前密码', { exact: true }).fill('test-password');
		await page.getByLabel('新密码', { exact: true }).fill('updated-test-password');
		await page.getByRole('button', { name: '保存密码', exact: true }).click();
		await expect(page.getByText('密码已修改。', { exact: true })).toBeVisible();
		await expect.poll(() => settingsSubscriptions).toBe(2);
		await expect(widget).toBeVisible();
		await expect.poll(async () => (await page.request.get(origin + settingsBase)).status()).toBe(200);
		await page.getByRole('button', { name: '退出登录' }).click();
		await expect(widget).toHaveCount(0);
		await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
		expect((await page.request.get(installed.url())).status()).toBe(401);
	} finally {
		releaseImports();
		await downloadSession?.detach().catch(() => undefined);
		await page.close();
		try {
			await Promise.all([server?.close(), anonymous?.dispose(), scope.close()]);
		} finally {
			try {
				await app.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	}
});

test('匿名阶段只加载就绪的登录插件和依赖，登录复用实例，注销清理后重建', async ({ page, playwright }) => {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-prelogin-browser-'));
	const app = new App({ dataDirectory: join(directory, 'data'), logLevel: 'fatal' });
	const scope = new PluginScope(() => {});
	const provider = '@test/login';
	const dependency = '@test/login-shared';
	const ordinary = '@test/private';
	let server: Awaited<ReturnType<typeof preview>> | undefined;
	let operator: APIRequestContext | undefined;

	try {
		const zod = JSON.stringify(import.meta.resolve('zod'));
		await app.initialize();
		await app.startBuiltinPlugins();
		const storage = new MarketplaceStorage(app.services.get('database').bind(MarketplacePluginId, scope));
		for (const [index, name] of [dependency, ordinary, provider].entries()) {
			const root = join(directory, `plugin-${index}`);
			await mkdir(join(root, 'browser'), { recursive: true });
			await writeFile(
				join(root, 'package.json'),
				JSON.stringify({
					name,
					version: '1.0.0',
					type: 'module',
					peerDependencies: { 'nexus-terminal': '^1.0.0' },
					nexus: {
						kind: 'extension',
						entry: { backend: 'backend.mjs', frontend: 'browser/index.mjs' },
						...(name === provider && { authMethods: true, dependsOn: { [dependency]: '^1.0.0' } }),
					},
				}),
			);
			await writeFile(
				join(root, 'backend.mjs'),
				name === provider
					? `
				import { z } from ${zod};
				const empty = z.strictObject({});
				export function activate(ctx) {
					ctx.authMethods.register({
						id: 'fixture', label: 'auth.fixture', routes: [{
							method: 'post', path: '/finish',
							input: z.strictObject({ proof: z.literal('fixture-only') }), output: empty,
							async handler(_input, _signal, { completeLogin }) { await completeLogin(); return {}; },
						}],
					});
					ctx.app.http.register([{
						method: 'post', path: '/pause', input: empty, output: empty,
						handler() {
							ctx.self.readiness.set({ state:'pending', reason:{ code:'PLUGIN_CONFIGURATION_REQUIRED' } });
							return {};
						},
					}]);
					ctx.self.readiness.set({ state:'ready' });
				}`
					: "export function activate(ctx) { ctx.self.readiness.set({ state: 'ready' }); }",
			);
			await writeFile(
				join(root, 'browser/index.mjs'),
				name === provider
					? `
				export function activate(ctx) {
					const root = document.documentElement;
					root.dataset.loginActivations = String(Number(root.dataset.loginActivations ?? 0) + 1);
					ctx.contribute({ login: [{
						id:'fixture', label:'Fixture sign-in',
						async start({ baseURL, signal, onComplete }) {
							const reply = await fetch(baseURL + 'finish', {
								method:'POST', signal, headers:{ 'content-type':'application/json' },
								body: JSON.stringify({ proof:'fixture-only' }),
							});
							if (!reply.ok) throw Error('FIXTURE_LOGIN_FAILED');
							await onComplete();
						},
					}] });
					ctx.self.readiness.set({ state:'ready' });
				}`
					: "export function activate(ctx) { ctx.self.readiness.set({ state: 'ready' }); }",
			);
			await storage.register(await inspectPluginPackage(root));
			await storage.setEnabled(name, true);
		}
		await app.startExternalPlugins();
		server = await serveFrontend(app, join(directory, 'app'));
		const origin = frontendOrigin(server);
		operator = await playwright.request.newContext({ baseURL: origin });
		expect(
			(
				await operator.post('/api/auth/initialize', { data: { username: 'owner', password: 'test-password' } })
			).status(),
		).toBe(201);

		const prelogin = `${origin}/api${marketplacePreloginPath}`;
		const { items } = MarketplacePreloginSchema.parse(await (await page.request.get(prelogin)).json());
		expect(items.map(({ pluginId }) => pluginId).sort()).toEqual([provider, dependency].sort());
		const entry = items.find(({ pluginId }) => pluginId === provider)?.entryURL;
		expect(entry).toBeTruthy();
		expect((await page.request.get(origin + entry)).status()).toBe(200);

		await page.goto(origin);
		const login = page.getByRole('button', { name: 'Fixture sign-in' });
		await expect(login).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-login-activations', '1');
		await page.getByRole('textbox', { name: 'Username' }).fill('owner');
		await page.getByLabel('Password', { exact: true }).fill('invalid-password');
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		const toast = page.locator('[data-ui="toast"]');
		await expect(toast.getByText('The username or password is incorrect.', { exact: true })).toBeVisible();
		await page.getByRole('combobox', { name: 'Language' }).click();
		await page.getByRole('option', { name: '简体中文' }).click();
		await expect(toast.getByText('用户名或密码不正确。', { exact: true })).toBeVisible();
		await login.click();
		await page.getByRole('button', { name: '设置', exact: true }).click();
		await expect(page).toHaveURL(origin + '/');
		await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-login-activations', '1');

		await page.getByRole('button', { name: '退出登录' }).click();
		await expect(login).toBeVisible();
		await expect(page).toHaveURL(origin + '/login');
		await expect(page.locator('html')).toHaveAttribute('data-login-activations', '2');

		expect((await operator.post(`/api/plugins/${encodeURIComponent(provider)}/pause`, { data: {} })).status()).toBe(
			200,
		);
		expect(MarketplacePreloginSchema.parse(await (await page.request.get(prelogin)).json()).items).toEqual([]);
		expect((await page.request.get(origin + entry)).status()).toBe(401);
		await expect(login).toHaveCount(0, { timeout: 8000 });
	} finally {
		await page.close();
		try {
			await Promise.all([server?.close(), operator?.dispose(), scope.close()]);
		} finally {
			try {
				await app.close();
			} finally {
				await rm(directory, { recursive: true, force: true });
			}
		}
	}
});

test('插件市场加载真实仓库，刷新失败保留目录，编辑和移除同步卡片', async ({ page }) => {
	const resources = new AsyncDisposableStack();
	const directory = await mkdtemp(join(tmpdir(), 'nexus-repository-browser-'));
	resources.defer(() => rm(directory, { recursive: true, force: true }));
	const app = new App({ dataDirectory: join(directory, 'data'), logLevel: 'fatal' });
	resources.defer(() => app.close());
	let version = '1.0.0';
	let valid = true;
	const requests: string[] = [];
	const readStarted = Promise.withResolvers<void>();
	const releaseOldReads = Promise.withResolvers<void>();
	const repository = createServer((request, response) => {
		const path = request.url ?? '/';
		requests.push(path);
		if (path !== '/catalog.json' && path !== '/replacement.json') {
			response.writeHead(404).end();
			return;
		}

		const id = path === '/catalog.json' ? '@test/repository-fixture' : '@test/replacement-fixture';
		response.setHeader('content-type', 'application/json');
		response.end(
			JSON.stringify(
				valid
					? [
							{
								id,
								versions: [
									{
										package: {
											name: id,
											version,
											type: 'module',
											peerDependencies: { 'nexus-terminal': '^1.0.0' },
											nexus: { kind: 'extension', entry: { backend: 'index.mjs' } },
										},
										distributions: [
											{
												tarball: 'http://' + request.headers.host + '/artifact.tgz',
												integrity: 'sha512-fixture',
											},
										],
									},
								],
							},
						]
					: { invalid: true },
			),
		);
	});
	resources.defer(() => {
		repository.closeAllConnections();
		if (repository.listening)
			return new Promise<void>((resolve, reject) => {
				repository.close((cause) => (cause ? reject(cause) : resolve()));
			});
	});

	try {
		repository.listen(0, '127.0.0.1');
		await once(repository, 'listening');
		const source = 'http://127.0.0.1:' + (repository.address() as AddressInfo).port;

		await app.initialize();
		await app.startBuiltinPlugins();
		await app.startExternalPlugins();
		const frontend = await serveFrontend(app, join(directory, 'app'));
		resources.defer(() => frontend.close());
		resources.defer(() => page.close());
		const origin = frontendOrigin(frontend);
		expect(
			(
				await page.request.post(origin + '/api/auth/initialize', {
					data: { username: 'owner', password: 'test-password' },
				})
			).status(),
		).toBe(201);

		// 暂缓变更前的目录读取，验证添加仓库后仍会启动一次新的读取。
		let holdOldReads = true;
		await page.route('**/api/plugins/' + encodeURIComponent(MarketplacePluginId) + '/plugins', async (route) => {
			if (!holdOldReads) return route.continue();
			const reply = await route.fetch();
			readStarted.resolve();
			await releaseOldReads.promise;
			await route.fulfill({ response: reply }).catch(() => undefined);
		});

		await page.goto(origin);
		await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
		const market = page.getByRole('region', { name: 'Plugin Marketplace', exact: true });
		const manage = market.getByRole('button', { name: 'Manage installed plugins', exact: true });
		await readStarted.promise;
		await manage.click();
		const repositories = market.getByRole('region', { name: 'Repositories', exact: true });
		await repositories.getByRole('textbox', { name: 'Repository catalog URL' }).fill(source + '/catalog.json');
		holdOldReads = false;
		await repositories.getByRole('button', { name: 'Add repository' }).click();

		const initial = market.getByRole('button', { name: 'View Repository Fixture', exact: true });
		const discover = market.getByRole('button', { name: 'Discover', exact: true });

		async function showVersion(expected: string) {
			await discover.click();
			await expect(initial.getByText('v' + expected)).toBeVisible();
			await manage.click();
		}

		await expect(repositories.getByText(source + '/catalog.json', { exact: true })).toBeVisible();
		releaseOldReads.resolve();
		await showVersion('1.0.0');
		expect(requests).toEqual(['/catalog.json']);

		const refresh = repositories.getByRole('button', { name: 'Refresh 127.0.0.1', exact: true });
		version = '1.1.0';
		await refresh.click();
		await expect(refresh).toBeEnabled();
		await showVersion('1.1.0');

		valid = false;
		await refresh.click();
		await expect(
			page.locator('[data-ui="toast"]').getByText('The repository returned an invalid catalog.'),
		).toBeVisible();
		await showVersion('1.1.0');

		valid = true;
		await repositories.getByRole('button', { name: 'Edit 127.0.0.1', exact: true }).click();
		const edit = page.getByRole('dialog', { name: 'Edit repository' });
		await edit.getByRole('textbox', { name: 'Repository name' }).fill('Local fixtures');
		await edit.getByRole('textbox', { name: 'Repository catalog URL' }).fill(source + '/replacement.json');
		await edit.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(edit).toHaveCount(0);
		await expect(repositories.getByText('Local fixtures', { exact: true })).toBeVisible();
		const replacement = market.getByRole('button', { name: 'View Replacement Fixture', exact: true });
		await discover.click();
		await expect(initial).toHaveCount(0);
		await expect(replacement).toHaveCount(0);
		await manage.click();
		const refreshReplacement = repositories.getByRole('button', { name: 'Refresh Local fixtures', exact: true });
		await refreshReplacement.click();
		await expect(refreshReplacement).toBeEnabled();
		await discover.click();
		await expect(replacement).toBeVisible();
		await manage.click();

		await repositories.getByRole('button', { name: 'Remove Local fixtures' }).click();
		const removal = page.getByRole('dialog', { name: 'Remove repository' });
		await removal.getByRole('contentinfo').getByRole('button', { name: 'Remove repository', exact: true }).click();
		await expect(removal).toHaveCount(0);
		await expect(repositories.getByText('Local fixtures')).toHaveCount(0);
		await discover.click();
		await expect(replacement).toHaveCount(0);
		expect(requests).toEqual(['/catalog.json', '/catalog.json', '/catalog.json', '/replacement.json']);
	} finally {
		releaseOldReads.resolve();
		await resources.disposeAsync();
	}
});

test('marketplace installs, updates and uninstalls actual packages with retained data', async ({ page }) => {
	test.setTimeout(90000);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await using resources = new AsyncDisposableStack();
	const directory = await mkdtemp(join(tmpdir(), 'nexus-marketplace-lifecycle-'));
	resources.defer(() => rm(directory, { recursive: true, force: true }));
	const app = new App({ dataDirectory: join(directory, 'data'), logLevel: 'fatal' });
	resources.defer(() => app.close());
	const id = '@test/lifecycle';
	const dependency = '@test/lifecycle-support';
	let catalog: unknown = [];
	const artifacts = new Map<string, Buffer>();
	const downloads: string[] = [];
	const rejectedDownloads: string[] = [];
	let rejectedPath: string | undefined;
	const repository = createServer((request, response) => {
		const path = request.url ?? '';
		if (path === '/catalog.json') {
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify(catalog));
		} else if (path === rejectedPath) {
			rejectedDownloads.push(path);
			response.writeHead(404).end();
		} else if (artifacts.has(path)) {
			downloads.push(path);
			response.end(artifacts.get(path));
		} else response.writeHead(404).end();
	});
	resources.defer(() => {
		repository.closeAllConnections();
		if (repository.listening) return new Promise<void>((resolve) => repository.close(() => resolve()));
	});
	repository.listen(0, '127.0.0.1');
	await once(repository, 'listening');
	const source = 'http://127.0.0.1:' + (repository.address() as AddressInfo).port;

	async function pack(name: string, version: string, code: string, dependsOn: Record<string, string> = {}) {
		const root = join(directory, name, version);
		await mkdir(root, { recursive: true });
		await writeFile(
			join(root, 'package.json'),
			JSON.stringify({
				name,
				version,
				displayName: name === id ? 'Lifecycle Fixture' : 'Lifecycle Support',
				type: 'module',
				peerDependencies: { 'nexus-terminal': '^1.0.0' },
				nexus: { kind: 'extension', entry: { backend: 'index.mjs' }, dependsOn },
			}),
		);
		await writeFile(join(root, 'index.mjs'), code);
		const { package: manifest } = await inspectPluginPackage(root);
		const file = join(root, 'artifact.tgz');
		await createArchive({ cwd: root, file, gzip: true, prefix: 'package/' }, ['package.json', 'index.mjs']);
		const bytes = await readFile(file);
		const path = '/' + encodeURIComponent(name) + '-' + version + '.tgz';
		artifacts.set(path, bytes);
		return {
			package: manifest,
			distributions: [
				{ tarball: source + path, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') },
			],
		};
	}

	const code = `
		export const backup = [{table: 'records', version: 1, keys: ['id'], fields: {id:'plain'}}];
		export const migrations = {async getMigrations() { return {initial: {async up(db) {
			await db.schema.createTable('records').addColumn('id', 'text', c => c.primaryKey()).execute();
		}}}; }};
		export async function activate(ctx) {
			await ctx.app.database.withClient(db => db.insertInto('records').values({id:'retained'}).onConflict(c => c.doNothing()).execute());
			ctx.self.readiness.set({state:'ready'});
		}
	`;
	const support = await pack(
		dependency,
		'1.0.0',
		"export function activate(ctx) { ctx.self.readiness.set({state:'ready'}); }",
	);
	const first = await pack(id, '1.0.0', code, { [dependency]: '^1.0.0' });
	const second = await pack(id, '2.0.0', code, { [dependency]: '^1.0.0' });
	catalog = [
		{ id: dependency, versions: [support] },
		{ id, versions: [first] },
	];
	await app.initialize();
	await app.startBuiltinPlugins();
	await app.startExternalPlugins();
	const frontend = await serveFrontend(app, join(directory, 'frontend'));
	resources.defer(() => frontend.close());
	resources.defer(() => page.close());
	const origin = frontendOrigin(frontend);
	await page.goto(origin);
	await page.getByLabel('Username', { exact: true }).fill('fixture-owner');
	await page.getByLabel('Password', { exact: true }).fill('test-password');
	await page.getByRole('button', { name: 'Create account', exact: true }).click();
	await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const market = page.getByRole('region', { name: 'Plugin Marketplace', exact: true });
	const manage = market.getByRole('button', { name: 'Manage installed plugins', exact: true });
	const discover = market.getByRole('button', { name: 'Discover', exact: true });
	await manage.click();
	const repositories = market.getByRole('region', { name: 'Repositories', exact: true });
	await repositories.getByRole('textbox', { name: 'Repository catalog URL' }).fill(source + '/catalog.json');
	await repositories.getByRole('button', { name: 'Add repository' }).click();
	await expect(repositories.getByText(source + '/catalog.json', { exact: true })).toBeVisible();
	await discover.click();
	const listing = market.getByRole('button', { name: 'View Lifecycle Fixture', exact: true });
	await listing.click();
	await page.getByRole('button', { name: 'Preview installation', exact: true }).click();
	const plan = page.getByRole('dialog', { name: 'Plugin installation' });
	await expect(plan.getByText(dependency, { exact: false })).toBeVisible();
	expect(downloads).toEqual([]);
	await plan.getByRole('button', { name: 'Install', exact: true }).click();
	await plan.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 15000 });
	const card = market
		.getByRole('article')
		.filter({ has: page.getByRole('button', { name: 'Manage Lifecycle Fixture', exact: true }) });
	await expect(card).toContainText('1.0.0');
	await expect(card.getByRole('status')).toHaveText('Available');
	await discover.click();
	await listing.focus();
	await listing.press('Enter');
	const discoveryDetail = page.getByRole('dialog', { name: 'Plugin details', exact: true });
	await discoveryDetail
		.getByRole('button', { name: 'Manage installed plugin', exact: true })
		.click({ timeout: 5000 });
	const management = page.getByRole('dialog', { name: 'Manage installed plugin', exact: true });
	await expect(management).toBeVisible();
	await management.getByRole('button', { name: 'Close application', exact: true }).click();
	await expect(management).toHaveCount(0);
	await expect(card.getByRole('button', { name: 'Manage Lifecycle Fixture', exact: true })).toBeFocused();
	await market.getByRole('searchbox', { name: 'Search plugins' }).fill('');
	expect(downloads).toHaveLength(2);
	const table = pluginTablePrefix(id) + 'records';
	const database = app.services.get('database');

	const records = () => database.withClient((db) => sql`select id from ${sql.id(table)}`.execute(db));

	expect((await records()).rows).toEqual([{ id: 'retained' }]);
	await database.withClient((db) => sql`insert into ${sql.id(table)} (id) values ('user-fixture')`.execute(db));

	catalog = [
		{ id: dependency, versions: [support] },
		{ id, versions: [first, second] },
	];
	await repositories.getByRole('button', { name: 'Refresh 127.0.0.1', exact: true }).click();
	const update = card.getByRole('button', { name: 'Update Lifecycle Fixture to 2.0.0', exact: true });
	const updatePath = '/' + encodeURIComponent(id) + '-2.0.0.tgz';
	rejectedPath = updatePath;
	await update.click();
	await plan.getByRole('button', { name: 'Update', exact: true }).click();
	await expect(plan.getByText('The plugin package could not be downloaded.', { exact: true })).toBeVisible();
	expect(rejectedDownloads).toEqual([updatePath]);
	expect(downloads).toHaveLength(2);
	const failedInstallations = await page.request.get(origin + marketplace + '/plugins');
	expect(failedInstallations.ok()).toBe(true);
	expect(
		MarketplacePluginListSchema.parse(await failedInstallations.json()).items.find((item) => item.pluginId === id),
	).toMatchObject({
		version: '1.0.0',
		enabled: true,
	});
	expect((await records()).rows).toEqual([{ id: 'retained' }, { id: 'user-fixture' }]);
	rejectedPath = undefined;
	await plan.getByRole('button', { name: 'Preview again', exact: true }).click();
	const secondTab = await page.context().newPage();
	resources.defer(() => secondTab.close());
	await secondTab.emulateMedia({ reducedMotion: 'reduce' });
	await secondTab.goto(origin);
	await secondTab.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const secondMarket = secondTab.getByRole('region', { name: 'Plugin Marketplace', exact: true });
	await secondMarket.getByRole('button', { name: 'Manage installed plugins', exact: true }).click();
	await secondMarket.getByRole('button', { name: 'Update Lifecycle Fixture to 2.0.0', exact: true }).click();
	const secondPlan = secondTab.getByRole('dialog', { name: 'Plugin installation' });
	const confirm = plan.getByRole('button', { name: 'Update', exact: true });
	const secondConfirm = secondPlan.getByRole('button', { name: 'Update', exact: true });
	await expect(confirm).toBeEnabled();
	await expect(secondConfirm).toBeEnabled();
	// Both tabs confirm the same preview before either POST reaches the host.
	// Release the real requests together; do not stub their responses.
	const gate = Promise.withResolvers<void>();
	let submitted = 0;
	const confirmURL = '**' + marketplace + '/install';
	for (const tab of [page, secondTab]) {
		await tab.route(confirmURL, async (route) => {
			if (++submitted === 2) gate.resolve();
			await gate.promise;
			await route.continue();
		});
	}
	try {
		await page.bringToFront();
		await confirm.click();
		await secondTab.bringToFront();
		await secondConfirm.click();
		await expect.poll(() => submitted).toBe(2);
		await expect
			.poll(
				async () => {
					const states = await Promise.all(
						[plan, secondPlan].map(async (dialog) => {
							if (await dialog.getByRole('button', { name: 'Done', exact: true }).isVisible())
								return 'success';
							if (
								await dialog
									.getByText('The plan changed. Preview it again.', { exact: true })
									.isVisible()
							)
								return 'stale';
							return 'pending';
						}),
					);
					return states.sort();
				},
				{ timeout: 15000 },
			)
			.toEqual(['stale', 'success']);
		if (await plan.getByRole('button', { name: 'Done', exact: true }).isVisible()) {
			await page.bringToFront();
			await plan.getByRole('button', { name: 'Done', exact: true }).click();
		} else {
			await page.bringToFront();
			await plan.getByRole('button', { name: 'Close application', exact: true }).click();
		}
	} finally {
		gate.resolve();
		await secondTab.close();
		await page.unroute(confirmURL);
	}

	await expect(card).toContainText('2.0.0');
	expect(downloads).toHaveLength(3);
	expect((await records()).rows).toEqual([{ id: 'retained' }, { id: 'user-fixture' }]);

	await market.getByRole('button', { name: 'Manage Lifecycle Support', exact: true }).click();
	const detail = page.getByRole('dialog', { name: 'Manage installed plugin', exact: true });
	await detail.getByRole('switch', { name: 'Enable plugin' }).click();
	const impactDialog = page.getByRole('dialog', { name: 'Disable plugin?', exact: true });
	await expect(impactDialog.getByText(id, { exact: true })).toBeVisible();
	await impactDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(impactDialog).toHaveCount(0);
	await expect(detail.getByRole('switch', { name: 'Enable plugin' })).toBeChecked();
	await detail.getByRole('button', { name: 'Close application' }).press('Enter');
	await card.getByRole('button', { name: 'Manage Lifecycle Fixture', exact: true }).click();
	const enable = detail.getByRole('switch', { name: 'Enable plugin' });
	await enable.click();
	const disable = page.getByRole('dialog', { name: 'Disable plugin?', exact: true });
	await expect(disable).toBeVisible();
	await disable.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(disable).toHaveCount(0);
	await expect(enable).toBeChecked();
	await enable.click();
	await disable.getByRole('button', { name: 'Disable', exact: true }).click();
	await expect(enable).not.toBeChecked();
	await expect(detail.getByText('Disabled', { exact: true })).toBeVisible();
	await enable.click();
	await expect(enable).toBeChecked();
	await expect(detail.getByText('Available', { exact: true })).toBeVisible();
	await detail.getByRole('button', { name: 'Reload', exact: true }).click();
	const reload = page.getByRole('dialog', { name: 'Reload plugin?', exact: true });
	await expect(reload).toBeVisible();
	const accepted = page.waitForResponse(
		(response) =>
			response.request().method() === 'POST' && new URL(response.url()).pathname === marketplace + '/reload',
	);
	await reload.getByRole('button', { name: 'Reload', exact: true }).click();
	const reloaded = await accepted;
	expect(reloaded.status()).toBe(202);
	const operation = MarketplaceOperationSchema.parse(await reloaded.json());
	await expect
		.poll(
			async () =>
				MarketplaceOperationSchema.parse(
					await (await page.request.get(origin + marketplace + '/operations/' + operation.id)).json(),
				).state,
		)
		.toBe('succeeded');
	await expect(detail.getByText('Available', { exact: true })).toBeVisible();
	expect((await records()).rows).toHaveLength(2);
	await detail.getByRole('button', { name: 'Uninstall', exact: true }).click();
	const uninstall = page.getByRole('dialog', { name: 'Uninstall', exact: true });
	const permanent = uninstall.getByRole('switch', { name: 'Permanently clear plugin data' });
	await expect(permanent).not.toBeChecked();
	await permanent.click();
	await expect(permanent).toBeChecked();
	await uninstall.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(uninstall).toHaveCount(0);
	await expect(detail).toBeVisible();
	expect((await records()).rows).toHaveLength(2);
	await detail.getByRole('button', { name: 'Uninstall', exact: true }).click();
	await expect(permanent).not.toBeChecked();
	await uninstall.getByRole('contentinfo').getByRole('button', { name: 'Uninstall', exact: true }).click();
	await expect(uninstall).toHaveCount(0);
	await expect(card).toHaveCount(0);
	const retained = market.getByText(id, { exact: true });
	await expect(retained).toBeVisible();
	expect((await records()).rows).toHaveLength(2);
	await market.getByRole('button', { name: 'Clear data', exact: true }).click();
	const clear = page.getByRole('dialog', { name: 'Clear data', exact: true });
	await clear.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(clear).toHaveCount(0);
	await expect(retained).toBeVisible();
	expect((await records()).rows).toHaveLength(2);
	await market.getByRole('button', { name: 'Clear data', exact: true }).click();
	await clear.getByRole('contentinfo').getByRole('button', { name: 'Clear data', exact: true }).click();
	await expect(clear).toHaveCount(0);
	await expect(retained).toHaveCount(0);
	await expect
		.poll(
			async () =>
				(
					await database.withClient((db) =>
						sql`select name from sqlite_schema where name = ${table}`.execute(db),
					)
				).rows,
		)
		.toEqual([]);
	await expect(
		market
			.getByRole('article')
			.filter({ has: page.getByRole('button', { name: 'Manage Lifecycle Support', exact: true }) })
			.getByRole('status'),
	).toHaveText('Available');
});
