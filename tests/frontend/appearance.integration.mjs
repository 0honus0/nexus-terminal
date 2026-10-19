import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../packages/frontend/node_modules/vite/dist/node/index.js';
import { createApp } from '../../packages/backend/dist/bootstrap/create-app.js';

const { chromium } = createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test');
const directory = await mkdtemp(join(tmpdir(), 'nexus-f1-appearance-'));
const checks = [];
let app;
let vite;
let browser;
try {
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
			proxy: { '/api': { target: 'http://' + address, changeOrigin: false } },
		},
	});
	await vite.listen();
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
	const page = await browser.newPage({ acceptDownloads: true });
	page.setDefaultTimeout(15000);
	await page.goto(origin + '/login');
	await page.evaluate(async () => {
		const { createAccessApi } = await import('/src/features/auth/api/access-api.ts');
		const api = createAccessApi();
		await api.setup({
			username: 'admin',
			password: 'Appearance-fixture-2026!',
			confirmPassword: 'Appearance-fixture-2026!',
		});
		await api.login({ username: 'admin', password: 'Appearance-fixture-2026!', rememberMe: false });
	});
	await page.reload();
	await page.locator('.app-header a.nav-link[href="/"]').waitFor();
	const result = await page.evaluate(async () => {
		const { appearanceApi } = await import('/src/features/appearance/api/appearance-api.ts');
		const { themeApi } = await import('/src/features/appearance/api/theme-api.ts');
		const { htmlThemeApi } = await import('/src/features/appearance/api/html-theme-api.ts');
		const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
		const { AppearanceRequestFailure } = await import('/src/features/appearance/model/appearance-failure.ts');
		const store = useAppearanceStore();
		const checks = [];

		function ensure(value, message) {
			if (!value) {
				throw Error(message);
			}
		}

		async function refuses(work, code, outcome) {
			try {
				await work();
			} catch (cause) {
				ensure(
					cause instanceof AppearanceRequestFailure && cause.code === code && cause.outcome === outcome,
					'Wrong failure ' + cause.code + '/' + cause.outcome,
				);
				return;
			}
			throw Error('Expected failure ' + code);
		}

		await store.load(true);
		ensure(
			store.snapshot.version >= 1 && store.themes.length > 0 && store.localThemes.length >= 17,
			'Real default appearance/themes/HTML read',
		);
		checks.push(
			'real complete Shared defaults, terminal themes and HTML presets load into independent application owners',
		);
		const initial = store.snapshot;
		store.previewSettings({ terminalFontSize: 22 });
		ensure(
			store.settings.terminalFontSize === 22 &&
				store.snapshot.terminalFontSize === initial.terminalFontSize &&
				store.version === initial.version,
			'Preview must not change durable state',
		);
		store.clearFontPreview('terminal');
		ensure(store.settings.terminalFontSize === initial.terminalFontSize, 'Preview clears to authoritative value');
		await store.update(
			{ windowThemeColor: '#123456', terminalFontSize: 17, terminalCustomHtml: '<p>active copy</p>' },
			initial.version,
			new AbortController().signal,
		);
		ensure(store.version === initial.version + 1 && store.settings.terminalFontSize === 17, 'Real appearance CAS');
		checks.push(
			'preview is independent, explicit clear restores saved state and appearance CAS updates the actual version',
		);
		const colors = { foreground: '#ffffff', background: '#000000', selectionForeground: '#123456' };
		const theme = await themeApi.create('Fixture theme', colors);
		const changed = await themeApi.update(theme, 'Fixture edited', {
			foreground: '#eeeeee',
			background: '#111111',
		});
		ensure(
			changed.id === theme.id && changed.version === theme.version + 1 && changed.name === 'Fixture edited',
			'Theme original CAS',
		);
		await refuses(() => themeApi.update(theme, 'Stale', colors), 'version_conflict', 'confirmed');
		const imported = await themeApi.importFile(
			new File([JSON.stringify(colors)], 'Imported fixture.json', { type: 'application/json' }),
		);
		ensure(
			imported.name === 'Imported fixture' && imported.themeData.selectionForeground === '#123456',
			'Real multipart import',
		);
		await store.update({ activeTerminalThemeId: imported.id }, store.version, new AbortController().signal);
		await themeApi.remove(imported);
		await store.load(true);
		ensure(store.snapshot.activeTerminalThemeId === null, 'Delete updates active appearance transaction');
		await themeApi.remove(changed);
		checks.push(
			'real terminal CRUD, original CAS refusal, multipart import and active-theme transactional removal',
		);
		const png = Uint8Array.from(
			atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF3sAAAAASUVORK5CYII='),
			(value) => value.charCodeAt(0),
		);
		for (const kind of ['page', 'terminal']) {
			const image = await appearanceApi.uploadBackground(
				kind,
				new File([png], kind + '.png', { type: 'image/png' }),
				store.version,
			);
			const path =
				kind === 'page' ? image.appearance.pageBackgroundImage : image.appearance.terminalBackgroundImage;
			const response = await fetch(path);
			ensure(
				response.status === 200 && (await response.arrayBuffer()).byteLength === png.byteLength,
				'Background actual binary retrieval',
			);
			store.accept(image.appearance);
			const removed = await appearanceApi.removeBackground(kind, store.version);
			store.accept(removed.appearance);
			ensure(
				(kind === 'page' ? store.snapshot.pageBackgroundImage : store.snapshot.terminalBackgroundImage) ===
					null,
				'Background removed',
			);
		}
		checks.push('both real image upload/read/delete paths preserve bytes and shared appearance CAS');
		const html = await htmlThemeApi.create('测试 fixture.html', '<p>original</p>');
		const updated = await htmlThemeApi.update(html, '');
		ensure(updated.version > html.version && (await htmlThemeApi.read(html.name)) === '', 'Empty HTML is valid');
		await refuses(() => htmlThemeApi.update(html, 'stale'), 'version_conflict', 'confirmed');
		const copy = await htmlThemeApi.create('copy.html', '<p>copy</p>');
		ensure(
			(await htmlThemeApi.list()).some((value) => value.name === html.name && value.type === 'custom'),
			'Copy preserves source',
		);
		await htmlThemeApi.remove(updated);
		await htmlThemeApi.remove(copy);
		const repo = await htmlThemeApi.repository();
		const repoUpdated = await htmlThemeApi.updateRepository('https://github.com/example/themes', repo.version);
		ensure(
			repoUpdated.version === repo.version + 1 && repoUpdated.url === 'https://github.com/example/themes',
			'Repository uses shared CAS',
		);
		await htmlThemeApi.updateRepository(null, repoUpdated.version);
		await store.load(true);
		ensure(
			store.snapshot.terminalCustomHtml === '<p>active copy</p>',
			'Library mutations leave active copy unchanged',
		);
		checks.push(
			'real Unicode/empty HTML CRUD, original CAS, copy without source deletion and repository shared revision',
		);
		const revoked = new AbortController();
		revoked.abort();
		let dispatched = false;
		await refuses(
			() =>
				store.mutate(async () => {
					dispatched = true;
				}, revoked.signal),
			'cancelled',
			'not_dispatched',
		);
		ensure(!dispatched, 'Revoked intention dispatched');
		await refuses(
			() => appearanceApi.update({ terminalFontSize: 0 }, store.version),
			'invalid_input',
			'not_dispatched',
		);
		await refuses(
			() => themeApi.importFile(new File(['{"foreground":2}'], 'bad.json', { type: 'application/json' })),
			'invalid_input',
			'not_dispatched',
		);
		checks.push('revoked queued intent and malformed appearance/import inputs are refused before side effects');
		return checks;
	});
	checks.push(...result);
	let writes = 0;

	const lost = async (route) => {
		if (route.request().method() !== 'PUT') {
			await route.continue();
			return;
		}
		writes++;
		await route.fetch();
		await route.abort();
	};

	await page.route('**/api/v1/appearance', lost);
	const unknown = await page.evaluate(async () => {
		const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
		const store = useAppearanceStore();
		let code;
		let outcome;
		try {
			await store.update({ windowThemeColor: '#654321' }, store.version, new AbortController().signal);
		} catch (cause) {
			code = cause.code;
			outcome = cause.outcome;
		}
		let refused = false;
		try {
			await store.update({ windowThemeColor: '#654321' }, store.version, new AbortController().signal);
		} catch (cause) {
			refused = cause.code === 'refresh_required';
		}
		let implicit = false;
		try {
			await store.load();
		} catch (cause) {
			implicit = cause.code === 'refresh_required';
		}
		return { outcome, blocked: store.blocked, refused, implicit };
	});
	assert.deepEqual(unknown, { outcome: 'unknown', blocked: true, refused: true, implicit: true });
	assert.equal(writes, 1);
	await page.unroute('**/api/v1/appearance', lost);
	await page.evaluate(async () => {
		const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
		const store = useAppearanceStore();
		await store.load(true);
		if (store.blocked || store.snapshot.windowThemeColor !== '#654321')
			throw Error('Read recovery did not observe committed write');
	});
	checks.push(
		'actual committed appearance with lost response fences all writes and requires explicit read recovery without replay',
	);
	await page.goto(origin + '/settings');
	await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
	await page.locator('#windowThemeColorInput').fill('#ABCDEF');
	const formal = page.locator('#settings-panel-appearance');
	await formal.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForFunction(
		async () => (await (await fetch('/api/v1/appearance')).json()).windowThemeColor === '#ABCDEF',
	);
	checks.push('formal Settings appearance form uses Shared CAS and updates real server state');
	await page.locator('#windowThemeColorInput').fill('#112233');
	await page.evaluate(async () => {
		const { appearanceApi } = await import('/src/features/appearance/api/appearance-api.ts');
		const value = await appearanceApi.load();
		await appearanceApi.update({ windowThemeColor: '#445566' }, value.version);
	});
	await formal.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForFunction(async () => {
		const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
		return useAppearanceStore().blocked;
	});
	assert.equal(await page.locator('#windowThemeColorInput').inputValue(), '#112233');
	await formal.getByRole('button', { name: 'Refresh', exact: true }).click();
	await page.waitForFunction(() => document.querySelector('#windowThemeColorInput')?.value === '#445566');
	checks.push(
		'formal dirty appearance preserves the original revision, rejects concurrent overwrite and refresh discards the stale draft',
	);
	await formal.getByRole('button', { name: 'Customize Appearance', exact: true }).click();
	await page.locator('[data-ui=overlay]').getByRole('button', { name: 'Terminal Styles', exact: true }).click();
	await page.locator('[data-terminal-theme-panel]').getByRole('button', { name: 'New Theme', exact: true }).click();
	const themePanel = page.locator('[data-terminal-theme-panel]');
	await themePanel.getByLabel('Theme Name', { exact: true }).fill('Formal fixture theme');
	await themePanel.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForFunction(async () =>
		(await (await fetch('/api/v1/terminal-themes')).json()).some((value) => value.name === 'Formal fixture theme'),
	);
	checks.push('formal customizer terminal editor creates an actual theme through the original production view');
	assert.equal(await page.locator('[data-runtime-boundary]').count(), 0);
	const downloadEvent = page.waitForEvent('download');
	await page.evaluate(async () => {
		const { themeApi } = await import('/src/features/appearance/api/theme-api.ts');
		const themes = await themeApi.list();
		await themeApi.exportFile(themes.find((value) => value.name === 'Formal fixture theme'));
	});
	const download = await downloadEvent;
	assert.equal(download.suggestedFilename(), 'terminal-theme.json');
	const stream = await download.createReadStream();
	const chunks = [];
	for await (const chunk of stream) {
		chunks.push(chunk);
	}
	assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), {
		foreground: '#ffffff',
		background: '#000000',
	});
	checks.push('real theme export delivers complete strictly decoded color JSON under a safe fixed filename');
	await page.route('**/api/v1/appearance/html-presets/remote/list?*', async (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([
				{
					name: 'remote.html',
					downloadUrl: 'https://raw.githubusercontent.com/example/themes/main/remote.html',
				},
			]),
		}),
	);
	await page.route('**/api/v1/appearance/html-presets/remote/content?*', async (route) =>
		route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: '<p>remote fixture</p>' }),
	);
	const remote = await page.evaluate(async () => {
		const { htmlThemeApi } = await import('/src/features/appearance/api/html-theme-api.ts');
		const entries = await htmlThemeApi.listRemote('https://github.com/example/themes');
		return { entries, content: await htmlThemeApi.readRemote(entries[0].downloadUrl) };
	});
	assert.deepEqual(remote, {
		entries: [
			{ name: 'remote.html', downloadUrl: 'https://raw.githubusercontent.com/example/themes/main/remote.html' },
		],
		content: '<p>remote fixture</p>',
	});
	await page.unroute('**/api/v1/appearance/html-presets/remote/list?*');
	await page.unroute('**/api/v1/appearance/html-presets/remote/content?*');
	checks.push(
		'controlled remote catalog and strict UTF-8 text use the actual HTTP media contracts; no public repository was contacted',
	);

	const malformed = async (route) => {
		const response = await route.fetch();
		const value = await response.json();
		await route.fulfill({ response, body: JSON.stringify({ ...value, privateField: 'must not leak' }) });
	};

	await page.route('**/api/v1/appearance', malformed);
	const invalidRead = await page.evaluate(async () => {
		const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
		const store = useAppearanceStore();
		const before = store.version;
		let rejected = false;
		try {
			await store.load(true);
		} catch (cause) {
			rejected = cause.code === 'protocol_failure';
		}
		return {
			rejected,
			blocked: store.blocked,
			preserved: before === store.version,
			privateField: Reflect.has(store.snapshot, 'privateField'),
		};
	});
	assert.deepEqual(invalidRead, { rejected: true, blocked: true, preserved: true, privateField: false });
	await page.unroute('**/api/v1/appearance', malformed);
	await page.evaluate(async () => {
		const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
		await useAppearanceStore().load(true);
	});
	checks.push(
		'malformed successful wire data preserves prior authority, never publishes extra fields and blocks writes until explicit recovery',
	);
	let notifyRead;
	const reached = new Promise((resolve) => {
		notifyRead = resolve;
	});
	let releaseRead;
	const gate = new Promise((resolve) => {
		releaseRead = resolve;
	});

	const late = async (route) => {
		const response = await route.fetch();
		notifyRead();
		await gate;
		await route.fulfill({ response }).catch(() => undefined);
	};

	await page.route('**/api/v1/appearance', late);
	try {
		const pending = page.evaluate(async () => {
			const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
			try {
				await useAppearanceStore().load(true);
				return 'unexpected_success';
			} catch (cause) {
				return cause.code;
			}
		});
		await reached;
		await page.evaluate(async () => {
			const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
			useAppearanceStore().reset();
		});
		releaseRead();
		assert.equal(await pending, 'cancelled');
		assert.deepEqual(
			await page.evaluate(async () => {
				const { useAppearanceStore } = await import('/src/features/appearance/store/appearance.store.ts');
				const store = useAppearanceStore();
				return { snapshot: store.snapshot, loaded: store.loaded, blocked: store.blocked };
			}),
			{ snapshot: null, loaded: false, blocked: false },
		);
	} finally {
		releaseRead();
		await page.unroute('**/api/v1/appearance', late);
	}
	checks.push(
		'original authenticated store reset cancels in-flight reads and late responses cannot repopulate a new session',
	);
	console.log('Appearance: ' + checks.length + ' checks PASS\n' + checks.join('\n'));
} finally {
	const failures = [];
	for (const close of [
		() => browser?.close(),
		() => vite?.close(),
		() => app?.close(),
		() => rm(directory, { recursive: true, force: true }),
	]) {
		try {
			await close();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		throw new AggregateError(failures, 'Appearance fixture cleanup failed');
	}
}
