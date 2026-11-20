import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';
import vue from '@vitejs/plugin-vue';
import { build, preview } from 'vite';
import { App } from '../../src/app/node/app.js';
import { BackupFileSchema } from '../../src/backup/backup-http-types.js';
import { MarketplaceStorage } from '../../src/marketplace/node/marketplace-storage.js';
import { MarketplacePreloginSchema, marketplacePreloginPath } from '../../src/marketplace/marketplace-http-types.js';
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

async function setEnabled(request: APIRequestContext, origin: string, enabled: boolean): Promise<void> {
	const response = await request.patch(`${origin}${marketplace}/plugins/${encodeURIComponent(pluginId)}`, {
		data: { enabled },
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

async function serveFrontend(app: App, outDir: string) {
	await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
	return preview({
		logLevel: 'error',
		build: { outDir },
		preview: { host: '127.0.0.1', port: 0, proxy: { '/api': backendProxy(app.services.get('http').origin) } },
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
		const origin = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
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
		await page.getByLabel('Password', { exact: true }).fill('test-password');
		expect(importRequests).toBe(0);
		await page.getByRole('button', { name: 'Create account', exact: true }).click();
		await expect.poll(() => importRequests).toBe(1);
		await expect(page.getByRole('status', { name: 'Preparing your workspace' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
		releaseImports();
		const result = await firstResponse;
		await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
		expect(result.status()).toBe(200);
		const firstURL = result.url();
		expect((await anonymous.get(firstURL)).status()).toBe(401);
		expect((await page.request.head(firstURL)).headers()['content-type']).toMatch(/javascript/u);
		expect((await page.request.get(new URL('styles/demo.css', firstURL).href)).headers()['content-type']).toMatch(
			/^text\/css/u,
		);
		expect((await page.request.get(new URL('external.js', firstURL).href)).status()).toBe(404);
		expect((await page.request.get(new URL('package.json', firstURL).href)).status()).toBe(404);

		const reloadResponse = page.waitForResponse(isEntry);
		const reload = await page.request.post(`${origin}${marketplace}/reload`, { data: { pluginId } });
		expect(reload.status()).toBe(202);
		const reloaded = await reloadResponse;
		expect(reloaded.status()).toBe(200);
		expect(reloaded.url()).not.toBe(firstURL);
		expect((await page.request.get(firstURL)).status()).toBe(404);

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
		await exportPanel.getByLabel('Password').fill('test-backup-password');
		const download = page.waitForEvent('download');
		await exportPanel.getByRole('button', { name: 'Export', exact: true }).click();
		const archive = await download;
		expect(archive.suggestedFilename()).toBe('nexus-backup.json');
		const archivePath = await archive.path();
		expect(BackupFileSchema.parse(JSON.parse(await readFile(archivePath, 'utf8'))).format).toBe(1);

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
		const previewButton = importPanel.getByRole('button', { name: 'Preview restore' });
		const preview = page.getByRole('dialog', { name: 'Preview restore' });
		const toast = page.locator('[data-ui="toast"]');

		await importPanel.getByLabel('Password').fill('wrong-password');
		await previewButton.click();
		await expect(toast.getByText('This backup file is invalid.')).toBeVisible();
		await expect(preview).toHaveCount(0);
		await file.setInputFiles(archivePath);
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
		await preview.getByRole('button', { name: 'Restore', exact: true }).click();
		await expect(preview.getByRole('status')).toHaveText('Restore complete.');
		await expect(html).toHaveAttribute('data-ui-mode', 'dark');
		expect(
			SettingsSnapshotSchema.parse(await (await page.request.get(origin + settingsBase)).json()).preferences
				.theme,
		).toBe('dark');
		await preview.getByRole('button', { name: 'Close application' }).click();
		await backup.getByRole('button', { name: 'Close application' }).click();
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
		await page.getByRole('button', { name: '修改密码', exact: true }).click();
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
		const origin = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
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
		await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('data-login-activations', '1');

		await page.getByRole('button', { name: '退出登录' }).click();
		await expect(login).toBeVisible();
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
		const origin = 'http://127.0.0.1:' + (frontend.httpServer.address() as AddressInfo).port;
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

		async function showVersion(expected: string) {
			await manage.click();
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
		await manage.click();
		await expect(initial).toHaveCount(0);
		await expect(replacement).toHaveCount(0);
		await manage.click();
		const refreshReplacement = repositories.getByRole('button', { name: 'Refresh Local fixtures', exact: true });
		await refreshReplacement.click();
		await expect(refreshReplacement).toBeEnabled();
		await manage.click();
		await expect(replacement).toBeVisible();
		await manage.click();

		await repositories.getByRole('button', { name: 'Remove Local fixtures' }).click();
		const removal = page.getByRole('dialog', { name: 'Remove repository' });
		await removal.getByRole('contentinfo').getByRole('button', { name: 'Remove repository', exact: true }).click();
		await expect(removal).toHaveCount(0);
		await expect(repositories.getByText('Local fixtures')).toHaveCount(0);
		await manage.click();
		await expect(replacement).toHaveCount(0);
		expect(requests).toEqual(['/catalog.json', '/catalog.json', '/catalog.json', '/replacement.json']);
	} finally {
		releaseOldReads.resolve();
		await resources.disposeAsync();
	}
});
