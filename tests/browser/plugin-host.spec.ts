import { randomUUID } from 'node:crypto';
import type { Locator } from '@playwright/test';
import { version as hostVersion } from '../../package.json' with { type: 'json' };
import { marketplaceFrontendBase } from '../../src/marketplace/marketplace-http-types.js';
import { MarketplacePluginId, type MarketplaceOperation } from '../../src/marketplace/marketplace-types.js';
import type { PluginRuntimeInfo } from '../../src/plugin/plugin-state-types.js';
import { expect, test } from './plugin-host-fixture.js';

for (const entryFails of [false, true]) {
	test(`桌面等待首批插件入口完成（入口失败：${entryFails}）`, async ({ page, host: _host }) => {
		const release = Promise.withResolvers<void>();
		let requested = false;
		await page.route('**' + marketplaceFrontendBase + '/*/*/index.js', async (route) => {
			requested = true;
			await release.promise;
			if (entryFails) await route.fulfill({ status: 503 });
			else await route.fallback();
		});

		await page.goto('/');
		const loading = page.getByRole('status', { name: 'Preparing your workspace' });
		const desktop = page.locator('.desktop-shell');
		try {
			await expect(loading).toBeVisible();
			await expect.poll(() => requested).toBe(true);
			await expect(desktop).toHaveCount(0);
		} finally {
			release.resolve();
		}

		await expect(loading).toHaveCount(0);
		await expect(desktop.getByRole('button', { name: 'Plugin Marketplace', exact: true })).toBeVisible();
		await expect(desktop.getByRole('button', { name: 'Counter', exact: true })).toHaveCount(entryFails ? 0 : 1);
	});
}

const installedPluginsPath = `**/api/plugins/${encodeURIComponent(MarketplacePluginId)}/manager/plugins`;

test('桌面首次渲染时市场卡片已有安装数量和正确尺寸', async ({ page, host: _host }) => {
	const requested = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	await page.route(installedPluginsPath, async (route) => {
		requested.resolve();
		await release.promise;
		await route.fallback();
	});
	await page.addInitScript(() => {
		const observer = new MutationObserver(() => {
			const tile = document.querySelector('[data-tile="builtin:marketplace"] .marketplace-tile');
			if (!tile) return;
			observer.disconnect();
			document.documentElement.dataset.firstTileCount = tile.querySelector('strong')?.textContent;
			document.documentElement.dataset.firstTileHeight = String(tile.getBoundingClientRect().height);
		});
		observer.observe(document, { childList: true, subtree: true });
	});

	await page.goto('/');
	const loading = page.getByRole('status', { name: 'Preparing your workspace' });
	const desktop = page.locator('.desktop-shell');
	try {
		await requested.promise;
		await expect(loading).toBeVisible();
		await expect(desktop).toHaveCount(0);
	} finally {
		release.resolve();
	}

	await expect(loading).toHaveCount(0);
	const tile = desktop.locator('.marketplace-tile');
	await expect(tile.locator('strong')).toHaveText('0');
	await expect(page.locator('html')).toHaveAttribute('data-first-tile-count', '0');
	const firstHeight = Number(await page.locator('html').getAttribute('data-first-tile-height'));
	const finalHeight = await tile.evaluate((element) => element.getBoundingClientRect().height);
	expect(firstHeight).toBeGreaterThan(0);
	expect(firstHeight).toBeCloseTo(finalHeight, 1);
});

test('插件数量读取超时后仍显示桌面', async ({ page, host: _host }) => {
	const release = Promise.withResolvers<void>();
	await page.route(installedPluginsPath, async (route) => {
		await release.promise;
		await route.fallback();
	});
	try {
		await page.goto('/');
		const loading = page.getByRole('status', { name: 'Preparing your workspace' });
		await expect(loading).toBeVisible();
		await expect(loading).toHaveCount(0, { timeout: 10_000 });
		await expect(page.locator('.marketplace-tile strong')).toHaveText('—');
	} finally {
		release.resolve();
	}
});

test('首份插件清单超时后仍可打开内置应用', async ({ page, host: _host }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.clock.install();
	await page.routeWebSocket('**/api/state/ws', () => {});
	await page.goto('/');

	const loading = page.getByRole('status', { name: 'Preparing your workspace' });
	const desktop = page.locator('.desktop-shell');
	await expect(loading).toBeVisible();
	await expect(desktop).toHaveCount(0);
	await page.clock.fastForward(15_000);
	await expect(loading).toHaveCount(0);
	await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible();
});

test('桌面空闲及指向入口时预加载窗口，点击复用并记录使用顺序', async ({ page, host: _host }) => {
	await page.addInitScript(() => {
		let next = 0;
		let loads = 0;
		const pending = new Map<number, IdleRequestCallback>();
		window.requestIdleCallback = (callback) => {
			pending.set(++next, callback);
			return next;
		};
		window.cancelIdleCallback = (id) => {
			pending.delete(id);
		};
		window.addEventListener('nexus:test:idle', () => {
			for (const [id, callback] of pending) {
				pending.delete(id);
				callback({
					didTimeout: false,

					timeRemaining: () => 20,
				});
			}
		});
		window.addEventListener('nexus:test:preloaded', () => {
			document.documentElement.dataset.preloads = String(++loads);
		});
	});
	await page.goto('/');
	const launcher = page.getByRole('button', { name: 'Counter', exact: true });
	const windowRegion = page.getByRole('region', { name: 'Counter', exact: true });
	const html = page.locator('html');
	await expect(launcher).toBeVisible();
	await expect(html).not.toHaveAttribute('data-preloads');
	await page.evaluate(() => window.dispatchEvent(new Event('nexus:test:idle')));
	await expect(html).toHaveAttribute('data-preloads', '1');
	await expect(windowRegion).toHaveCount(0);
	await launcher.click();
	await expect(windowRegion).toBeVisible();
	await expect(html).toHaveAttribute('data-preloads', '1');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('nexus.desktop.recent-applications')))
		.toBe('["@nexus-terminal/test:applications:counter"]');

	await page.reload();
	await launcher.hover();
	await expect(html).toHaveAttribute('data-preloads', '1');
	await expect(windowRegion).toHaveCount(0);
});

test('桌面应用图标悬浮时保持原位且不越过卡片边界', async ({ page, host: _host }) => {
	for (const viewport of [
		{ width: 1440, height: 768 },
		{ width: 650, height: 550 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/');
		const tile = page.getByRole('button', { name: 'Counter', exact: true });
		const icon = tile.locator('.application-tile__icon');
		await expect(icon).toBeVisible();
		await page.mouse.move(0, 0);
		const before = (await icon.boundingBox())!;
		await tile.hover();
		await expect(icon).toHaveCSS('filter', 'brightness(1.06)');
		await expect(icon).toHaveCSS('transform', 'none');
		const after = (await icon.boundingBox())!;
		const bounds = (await tile.boundingBox())!;
		expect(after.y).toBeCloseTo(before.y, 1);
		expect(after.y).toBeGreaterThanOrEqual(bounds.y - 0.1);
		expect(after.y + after.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.1);
	}
});

test('Vue 贡献随插件启停，关闭应用只清理当前视图', async ({ page, host }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.addInitScript(() => {
		document.documentElement?.setAttribute('data-lifecycle', '');
		window.addEventListener('nexus:test:lifecycle', (event) => {
			const root = document.documentElement;
			root.dataset.lifecycle = [root.dataset.lifecycle, (event as CustomEvent<string>).detail]
				.filter(Boolean)
				.join(',');
		});
	});
	await page.goto('/');
	const launcher = page.getByRole('button', { name: 'Counter', exact: true });
	const widget = page.getByRole('region', { name: 'Counter Widget' });
	await expect(launcher).toBeVisible();
	await expect(widget.getByText('Count: 0')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Plugin Marketplace', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Backup and Restore', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('combobox', { name: 'Language' }).click();
	await page.getByRole('option', { name: '简体中文' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'zh');
	await page.getByRole('region', { name: '设置', exact: true }).getByRole('button', { name: '关闭应用' }).click();
	await expect(page.getByRole('region', { name: '设置', exact: true })).toHaveCount(0);
	await expect(widget.getByText('计数：0')).toBeVisible();
	const localizedLauncher = page.getByRole('button', { name: '计数器', exact: true });
	await expect(localizedLauncher).toBeVisible();
	await localizedLauncher.click();
	const application = page.getByRole('region', { name: '计数器', exact: true });
	await expect(application.locator('.application-window__identity svg.lucide-square-terminal')).toBeVisible();
	await page.locator('.dock-reveal').evaluate((button: HTMLElement) => button.click());
	const dockEntry = page.getByRole('button', { name: '切换到计数器', exact: true });
	await expect(dockEntry.locator('svg.lucide-square-terminal')).toBeVisible();
	await application.getByRole('button', { name: '加一' }).click();
	await expect(application.getByText('计数：1')).toBeVisible();
	await application.getByRole('button', { name: '最小化' }).click();
	await expect(application).toBeHidden();
	await localizedLauncher.click();
	await expect(application.getByText('计数：1')).toBeVisible();
	await application.getByRole('button', { name: '关闭应用' }).click();
	await expect(application).toHaveCount(0);
	await expect(widget.getByText('计数：0')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-lifecycle', 'activated,view-disposed');

	host.setPluginVersion(null);
	await expect(widget).toHaveCount(0);
	await expect(localizedLauncher).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute(
		'data-lifecycle',
		'activated,view-disposed,view-disposed,deactivated,plugin-disposed',
	);
	host.setPluginVersion('1.0.0');
	await expect(localizedLauncher).toBeVisible();
	await expect(widget.getByText('计数：0')).toBeVisible();
	host.setPluginVersion('1.0.1');
	await expect(page.locator('html')).toHaveAttribute(
		'data-lifecycle',
		'activated,view-disposed,view-disposed,deactivated,plugin-disposed,activated,view-disposed,deactivated,plugin-disposed,activated',
	);
	await expect(widget.getByText('计数：0')).toBeVisible();
	expect(errors).toEqual([]);
});

test('插件 Toast 使用当前语言，停用后撤销该实例的提示', async ({ page, host }) => {
	await page.goto('/?plugin-notices');
	const widget = page.getByRole('region', { name: 'Counter Widget' });
	await expect(widget.getByText('Count: 0')).toBeVisible();
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const language = page.getByRole('combobox', { name: 'Language' });
	await expect(language).toBeVisible();

	const increment = () =>
		widget.getByRole('button', { name: 'Increment' }).evaluate((button: HTMLButtonElement) => button.click());

	await increment();
	const toast = page.locator('[data-ui="toast"]');
	await expect(toast.getByText('Saved 1 item(s).')).toBeVisible();

	const toastSize = () =>
		toast.evaluate((element) => {
			const body = element.querySelector('.ui-toast__message')!.getBoundingClientRect();
			return {
				textWidth: body.width,
				textHeight: body.height,
				cardHeight: element.getBoundingClientRect().height,
			};
		});

	const single = await toastSize();
	await increment();
	await expect(toast.locator('.ui-toast__page [aria-hidden="true"]').last()).toHaveText('1/2');
	const multiple = await toastSize();
	for (const key of ['textWidth', 'textHeight', 'cardHeight'] as const)
		expect(multiple[key]).toBeCloseTo(single[key], 2);
	const [above, between, below] = await toast.evaluate((element) => {
		const controls = element.querySelector('.ui-toast__controls')!.getBoundingClientRect();
		const close = element.querySelector('.ui-toast__close')!.getBoundingClientRect();
		const counter = element.querySelector('.ui-toast__page')!.getBoundingClientRect();
		return [close.top - controls.top, counter.top - close.bottom, controls.bottom - counter.bottom];
	});
	expect(between).toBeGreaterThan(4);
	expect(above).toBeCloseTo(between, 1);
	expect(below).toBeCloseTo(between, 1);
	await language.click();
	await page.getByRole('option', { name: '简体中文' }).click();
	await expect(toast.getByText('已保存 2 项。')).toBeVisible();

	host.setPluginVersion(null);
	await expect(toast.getByText('已保存 2 项。')).toHaveCount(0);
});

test('内置应用与外部插件管理弹窗使用统一宽度', async ({ page, host: _host }) => {
	await page.route(installedPluginsPath, (route) =>
		route.fulfill({
			json: {
				items: [
					{
						pluginId: '@nexus-terminal/test',
						version: '1.0.0',
						kind: 'application',
						hasBackend: false,
						source: { kind: 'local' },
						enabled: true,
						runtime: null,
						issue: null,
					},
				],
			},
		}),
	);

	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await page.goto('/');
		await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
		const market = page.getByRole('region', { name: 'Plugin Marketplace', exact: true });
		await market.getByRole('button', { name: 'Manage installed plugins' }).click();
		for (const [name, title] of [
			['Settings', 'Settings'],
			['Counter', 'Manage installed plugin'],
		]) {
			await market.getByRole('button', { name: 'Manage ' + name, exact: true }).click();
			const dialog = page.getByRole('dialog', { name: title, exact: true });
			await expect(dialog).toHaveAttribute('data-size', 'md');
			await expect(dialog).toHaveCSS('width', Math.min(560, width - 32) + 'px');
			await dialog.getByRole('button', { name: 'Close application' }).click();
			await expect(dialog).toHaveCount(0);
		}
	}
});

test('桌面缩放时保留格位、最小卡片高度与纵向滚动', async ({ page, host: _host }) => {
	const saved = Object.fromEntries(
		['compact', 'medium', 'wide'].map((profile) => [
			profile,
			{
				pages: [{ id: 'home', tiles: [{ key: 'builtin:log', label: 'Logs', x: 0, y: 4, w: 1, h: 1 }] }],
				hidden: ['builtin:marketplace', 'builtin:settings', 'builtin:backup'],
				current: 'home',
			},
		]),
	);
	await page.addInitScript((value) => localStorage.setItem('nexus.desktop.pages', JSON.stringify(value)), saved);
	await page.setViewportSize({ width: 390, height: 340 });
	await page.goto('/');
	const canvas = page.locator('.desktop-canvas');
	const tile = canvas.locator('[data-tile="builtin:log"] .application-tile');
	await expect(tile).toHaveCount(1);
	await expect.poll(async () => (await tile.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(90);
	await expect.poll(() => canvas.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(100);
	await canvas.hover();
	await page.mouse.wheel(0, 500);
	await expect.poll(() => canvas.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
	await expect(tile).toBeInViewport();
	for (const width of [720, 1440, 2560, 390]) {
		await page.setViewportSize({ width, height: 900 });
		await expect.poll(async () => (await tile.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(90);
		await expect.poll(async () => (await tile.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(114);
		await expect(canvas.locator('[data-tile="builtin:log"]')).toHaveAttribute('gs-y', '4');
	}
});

test('恢复归档桌面的分页、跨页移动和内置窗口布局', async ({ page, host: _host }) => {
	await page.goto('/');
	const desktop = page.locator('.desktop-shell');
	await expect(desktop.getByRole('button', { name: 'Logs', exact: true })).toBeVisible();
	await expect(desktop.locator('.desktop-canvas')).toHaveCSS('overflow-x', 'hidden');
	await expect(desktop.locator('.desktop-canvas')).toHaveCSS('overflow-y', 'auto');
	await expect(desktop.getByRole('button', { name: 'Next page' })).toHaveCSS('background-image', 'none');
	await desktop.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const marketplace = page.getByRole('region', { name: 'Plugin Marketplace', exact: true });
	const marketplaceBody = marketplace.locator('.application-window__body');
	await expect(marketplaceBody).toHaveCSS('scrollbar-gutter', 'stable');
	await marketplace.getByRole('button', { name: 'Manage installed plugins' }).click();
	await expect(marketplace.getByRole('heading', { name: 'Installed plugins' })).toBeVisible();
	await marketplace.getByRole('button', { name: 'Close application' }).click();
	const window = page.getByRole('region', { name: 'Settings', exact: true });
	await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(window.locator('[data-theme-option]')).toHaveCount(3);
	await expect(window.locator('.app-page-heading p, .ui-section__heading p')).toHaveCount(0);
	const slider = window.getByRole('slider', { name: 'Animation speed' });
	await slider.press('ArrowRight');
	await expect(slider).toHaveAttribute('aria-valuenow', '1.3');
	await window.getByRole('switch', { name: 'Motion effects' }).click();
	await expect(slider).toHaveAttribute('data-disabled', '');
	await window.getByRole('combobox', { name: 'Escape key action' }).click();
	await page.getByRole('option', { name: 'Close application' }).click();
	await page.keyboard.press('Escape');
	await expect(window).toHaveCount(0);

	const backup = page.getByRole('region', { name: 'Backup and Restore', exact: true });
	await desktop.getByRole('button', { name: 'Backup and Restore', exact: true }).click();
	await expect(backup.locator('.nexus-backup__sections')).toBeVisible();
	await expect(backup.locator('.nexus-backup__intro p, .ui-section__heading p, .ui-field p')).toHaveCount(0);
	await expect(desktop.locator('.backup-tile__caption')).toHaveCount(0);
	await expect(backup.getByLabel('Choose a backup file')).toHaveAttribute('accept', '.json');
	await backup.getByRole('button', { name: 'Close application' }).click();

	await desktop.locator('.dock-reveal').evaluate((button: HTMLElement) => button.click());
	await desktop.getByRole('button', { name: 'Edit desktop' }).click();
	await desktop.getByRole('button', { name: 'Add page' }).click();
	await expect(desktop.getByRole('status', { name: 'Page 2 of 2' })).toBeAttached();
	await desktop.getByRole('button', { name: 'Next page' }).click();
	await expect(desktop.getByRole('status', { name: 'Page 1 of 2' })).toBeAttached();
	await desktop.getByRole('button', { name: 'Page 1', exact: true }).click();
	const tile = desktop.locator('[data-tile="builtin:settings"]');
	await tile.locator('.desktop-tile__size').click();
	const dialog = page.getByRole('dialog', { name: 'Tile size' });
	await dialog.getByRole('combobox').click();
	await page.getByRole('option', { name: 'Page 2', exact: true }).click();
	await expect(tile).toHaveCount(0);
	await desktop.getByRole('button', { name: 'Page 2', exact: true }).click();
	await expect(tile).toHaveCount(1);
	await desktop.getByRole('button', { name: 'Remove page 2', exact: true }).click();
	await expect(desktop.getByRole('status', { name: 'Page 1 of 1' })).toBeAttached();
	await expect(tile).toHaveCount(1);
	await expect(desktop.getByRole('button', { name: 'Remove page 1', exact: true })).toBeDisabled();
});

test('桌面编辑控件使用当前应用名称，语言切换不修改保存的格位', async ({ page, host: _host }) => {
	await page.goto('/');
	const desktop = page.locator('.desktop-shell');
	const counter = desktop.locator('[data-tile="@nexus-terminal/test:applications:counter"]');
	await expect(counter.getByRole('button', { name: 'Counter', exact: true })).toBeVisible();
	const settings = desktop.locator('[data-tile="builtin:settings"]');
	const layout = await page.evaluate(() => localStorage.getItem('nexus.desktop.pages'));
	expect(layout).not.toBeNull();

	await settings.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('combobox', { name: 'Language' }).click();
	await page.getByRole('option', { name: '简体中文' }).click();
	await page.getByRole('region', { name: '设置', exact: true }).getByRole('button', { name: '关闭应用' }).click();

	await desktop.locator('.dock-reveal').evaluate((button: HTMLElement) => button.click());
	await desktop.getByRole('button', { name: '编辑桌面' }).click();
	await expect(counter.getByRole('button', { name: '移动计数器', exact: true })).toBeVisible();
	await expect(counter.getByRole('button', { name: '调整计数器大小', exact: true })).toBeVisible();
	await expect(settings.getByRole('button', { name: '移动设置', exact: true })).toBeVisible();
	await expect(settings.getByRole('button', { name: '调整设置大小', exact: true })).toBeVisible();
	expect(await page.evaluate(() => localStorage.getItem('nexus.desktop.pages'))).toBe(layout);

	// Reload still uses the saved English fallback labels, not a rewritten layout.
	await page.reload();
	await expect(counter.getByRole('button', { name: '计数器', exact: true })).toBeVisible();
	await desktop.locator('.dock-reveal').evaluate((button: HTMLElement) => button.click());
	await desktop.getByRole('button', { name: '编辑桌面' }).click();
	await expect(counter.getByRole('button', { name: '移动计数器', exact: true })).toBeVisible();
	expect(await page.evaluate(() => localStorage.getItem('nexus.desktop.pages'))).toBe(layout);
});

test('桌面卡片在编辑模式可以拖动并使用唯一的角落手柄缩放', async ({ page, host: _host }) => {
	await page.goto('/');
	const desktop = page.locator('.desktop-shell');
	const tile = desktop.locator('[data-tile="builtin:settings"]');
	const move = tile.getByRole('button', { name: 'Move Settings', exact: true });
	const resize = tile.locator('.desktop-tile__resize');
	const settings = page.getByRole('region', { name: 'Settings', exact: true });

	const reveal = () => desktop.locator('.dock-reveal').evaluate((button: HTMLElement) => button.click());

	async function drag(handle: Locator, dx: number, dy: number) {
		const box = (await handle.boundingBox())!;
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + dx, y + dy, { steps: 8 });
		await page.mouse.up();
	}

	await reveal();
	await desktop.getByRole('button', { name: 'Edit desktop' }).click();
	await expect(move).toBeVisible();
	const initial = (await tile.boundingBox())!;
	const row = Number(await tile.getAttribute('gs-y'));
	const width = Number((await tile.getAttribute('gs-w')) ?? '1');
	const height = Number((await tile.getAttribute('gs-h')) ?? '1');
	await drag(move, 0, (initial.height / height) * 2);
	await expect(tile).toHaveAttribute('gs-y', String(row + 2));
	await expect(settings).toHaveCount(0);

	await expect(tile.locator('.ui-resizable-handle')).toHaveCount(1);
	await expect(resize).toHaveClass(/\bui-resizable-se\b/u);
	await drag(resize, initial.width / width, 0);
	await expect(tile).toHaveAttribute('gs-w', String(width + 1));
	await expect(page.getByRole('dialog', { name: 'Tile size' })).toHaveCount(0);

	await reveal();
	await desktop.getByRole('button', { name: 'Finish editing' }).click();
	await expect(resize).toBeHidden();
	await tile.getByRole('button', { name: 'Settings', exact: true }).click();
	await expect(settings).toBeVisible();
	await settings.getByRole('button', { name: 'Close application' }).click();
	await expect(settings).toHaveCount(0);

	await reveal();
	await desktop.getByRole('button', { name: 'Edit desktop' }).click();
	await drag(move, 0, initial.height / height);
	await expect(tile).toHaveAttribute('gs-y', String(row + 3));
	await page.reload();
	await expect(tile).toHaveAttribute('gs-y', String(row + 3));
	await expect(tile).toHaveAttribute('gs-w', String(width + 1));
});

test('选择框保留淡入，下拉菜单默认直接展开，兼容旧布局菜单及显式淡入', async ({ page, host: _host }) => {
	const warnings: string[] = [];
	page.on('pageerror', (error) => warnings.push(error.stack ?? error.message));
	page.on('console', (event) => {
		if (event.type() === 'warning' || event.type() === 'error') warnings.push(event.text());
	});
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.addInitScript(() => {
		const animate = Element.prototype.animate;
		Element.prototype.animate = function (...args: Parameters<typeof animate>) {
			const animation = Reflect.apply(animate, this, args) as Animation;
			if (this instanceof HTMLElement) {
				const effect = animation.effect as KeyframeEffect;
				const before = JSON.parse(this.dataset.testFrames ?? '[]') as Keyframe[][];
				this.dataset.testFrames = JSON.stringify([...before, effect.getKeyframes()]);
				const popper = this.closest<HTMLElement>('[data-reka-popper-content-wrapper]');
				if (popper) this.dataset.testPopperTransform = popper.style.transform;
			}
			return animation;
		};
	});

	async function popupFrames(popup: Locator): Promise<Keyframe[][]> {
		await expect(popup).toBeVisible();
		return popup.evaluate((element) => {
			const popper = element.closest('[data-reka-popper-content-wrapper]');
			return [element, popper].flatMap(
				(target) => JSON.parse(target?.getAttribute('data-test-frames') ?? '[]') as Keyframe[][],
			);
		});
	}

	async function expectFade(popup: Locator): Promise<void> {
		const frames = await popupFrames(popup);
		expect(frames).toContainEqual(
			expect.arrayContaining([
				expect.objectContaining({ opacity: '0' }),
				expect.objectContaining({ opacity: '1' }),
			]),
		);
		for (const frame of frames.flat()) {
			expect(frame.transform).toBeUndefined();
			expect(frame.translate).toBeUndefined();
			expect(frame.scale).toBeUndefined();
		}
	}

	await page.goto('/?host-controls');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const language = page.getByRole('combobox', { name: 'Language' });
	await language.press('ArrowDown');
	const options = page.getByRole('listbox');
	await expect(options).toHaveAttribute('data-test-popper-transform', /^translate\([^%]+px, [^%]+px\)$/);
	await expect(options.locator('..')).not.toHaveAttribute('data-test-frames', /./);
	await expectFade(options);
	const fromTop = (await options.getAttribute('data-side')) === 'top';
	const selectFrames = await popupFrames(options);
	expect(selectFrames.flat()).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ clipPath: fromTop ? 'inset(18px -48px -48px)' : 'inset(-48px -48px 18px)' }),
			expect.objectContaining({ clipPath: 'inset(-48px)' }),
		]),
	);
	await expect(options.getByRole('option', { selected: true })).toBeFocused();
	await expect(options).toHaveCSS('clip-path', 'none');
	await page.keyboard.press('Escape');
	await expect(language).toBeFocused();
	await page
		.getByRole('region', { name: 'Settings', exact: true })
		.getByRole('button', { name: 'Close application' })
		.click();
	await page.getByRole('button', { name: 'Counter', exact: true }).click();
	for (const name of ['Fixture sort', 'Fixture layout']) {
		const trigger = page.getByRole('button', { name, exact: true });
		await trigger.click();
		const menu = page.getByRole('menu', { name });
		expect(await popupFrames(menu)).toEqual([]);
		await expect(menu).toHaveCSS('clip-path', 'none');
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(trigger).toBeFocused();
	}
	const fade = page.getByRole('button', { name: 'Fixture fade layout', exact: true });
	await fade.click();
	const fadeMenu = page.getByRole('menu', { name: 'Fixture fade layout' });
	await expectFade(fadeMenu);
	await page.keyboard.press('Escape');
	await expect(fadeMenu).toHaveCount(0);
	await expect(fade).toBeFocused();
	expect(warnings).toEqual([]);
});

test('系统减少动态效果时保留动画偏好，速度控件在动画可用时恢复', async ({ page, host: _host }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const settings = page.getByRole('region', { name: 'Settings', exact: true });
	const slider = settings.getByRole('slider', { name: 'Animation speed' });
	await expect(settings.getByRole('heading', { name: 'Animation', exact: true })).toBeVisible();
	await expect(settings.getByRole('switch', { name: 'Motion effects' })).toBeChecked();
	await expect(slider).toHaveAttribute('data-disabled', '');
	await expect(settings.getByText('Your system is set to reduce motion.')).toBeVisible();
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await expect(slider).not.toHaveAttribute('data-disabled', '');
	await expect(page.locator('html')).toHaveAttribute('data-ui-motion', 'full');
});

test('桌面卡片保留圆角键盘焦点，鼠标收起和关闭窗口不留下焦点圈', async ({ page, host: _host }) => {
	await page.goto('/');
	const launcher = page.locator('[data-tile="builtin:settings"]').getByRole('button', { name: 'Settings' });
	const settings = page.getByRole('region', { name: 'Settings', exact: true });

	await expect(launcher).toHaveCSS('border-radius', '21px');
	await launcher.click();
	const stack = await settings.evaluate((element) => getComputedStyle(element).zIndex);
	await settings.locator('.application-window__identity').click();
	await expect(settings).toHaveCSS('z-index', stack);
	await settings.getByRole('button', { name: 'Minimize' }).click();
	await expect(settings).toBeHidden();
	await expect(launcher).toHaveCSS('outline-style', 'none');

	await launcher.click();
	await settings.getByRole('button', { name: 'Close application' }).click();
	await expect(settings).toHaveCount(0);
	await expect(launcher).toHaveCSS('outline-style', 'none');

	await page.keyboard.press('Tab');
	await launcher.focus();
	await expect(launcher).toHaveCSS('outline-style', 'solid');
	await launcher.press('Enter');
	await expect(settings).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(settings).toBeHidden();
	await expect(launcher).toBeFocused();
	await expect(launcher).toHaveCSS('outline-style', 'solid');

	const icon = page.locator('[data-tile="builtin:log"]').getByRole('button', { name: 'Logs' });
	await icon.focus();
	await expect(icon).toHaveCSS('border-radius', '19px');
});

test('市场先显示缓存，官方仓库刷新后显示新目录', async ({ page, host: _host }) => {
	const id = '123e4567-e89b-42d3-a456-426614174005';
	const release = Promise.withResolvers<void>();
	let refreshed = false;

	await page.route('**/api/plugins/*/repositories', (route) =>
		route.fulfill({
			json: {
				items: [{ id, label: 'Nexus Terminal', url: 'https://example.test/catalog.json', official: true }],
			},
		}),
	);
	await page.route('**/api/plugins/*/repositories/' + id + '/refresh', async (route) => {
		expect(route.request().method()).toBe('POST');
		await release.promise;
		refreshed = true;
		await route.fulfill({ status: 204 });
	});
	await page.route('**/api/plugins/*/plugins', (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: '@test/official',
						versions: [
							{
								repositoryId: id,
								distributions: [],
								package: {
									name: '@test/official',
									version: refreshed ? '1.1.0' : '1.0.0',
									description: refreshed ? 'Refreshed catalog' : 'Cached catalog',
									type: 'module',
									peerDependencies: { 'nexus-terminal': '^1.0.0' },
									nexus: { kind: 'extension', entry: { backend: 'index.mjs' } },
								},
							},
						],
					},
				],
			},
		}),
	);

	await page.goto('/');
	await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const market = page.getByRole('region', { name: 'Plugin Marketplace', exact: true });
	try {
		await expect(market.getByText('Cached catalog')).toBeVisible();
	} finally {
		release.resolve();
	}
	await expect(market.getByText('Refreshed catalog')).toBeVisible();
});

test('刷新显示可更新版本，已安装卡片的更新和打开等宽并排', async ({ page, host }) => {
	const pluginId = '@nexus-terminal/test';
	const installedVersion = '0.0.1-dev.3';
	const newVersion = '0.0.1-dev.4';
	const official = { id: randomUUID(), url: 'https://example.com/catalog.json', label: 'Official', official: true };
	const other = { id: randomUUID(), url: 'https://other.example.com/catalog.json', label: 'Other', official: false };
	const target = { kind: 'repository', repositoryId: official.id, pluginId, version: newVersion };
	const manifest = {
		name: pluginId,
		displayName: 'Counter',
		type: 'module',
		peerDependencies: { 'nexus-terminal': '^1.0.0' },
		nexus: { kind: 'application', entry: { frontend: 'index.js' } },
	};
	let installed = installedVersion;
	let refreshed = 0;
	host.setPluginVersion(installedVersion);
	await page.route('**/api/plugins/*/repositories', (route) => route.fulfill({ json: { items: [official, other] } }));
	await page.route('**/api/plugins/*/repositories/*/refresh', (route) => {
		refreshed++;
		return route.fulfill({ status: 204 });
	});
	await page.route('**/api/plugins/*/plugins', (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: pluginId,
						versions: [
							{
								repositoryId: official.id,
								package: { ...manifest, version: refreshed > 1 ? newVersion : installedVersion },
							},
							{ repositoryId: other.id, package: { ...manifest, version: '2.0.0' } },
						],
					},
				],
			},
		}),
	);
	await page.route('**/api/plugins/*/manager/plugins', (route) =>
		route.fulfill({
			json: {
				items: [
					{
						pluginId,
						version: installed,
						kind: 'application',
						hasBackend: false,
						displayName: 'Counter',
						source: { ...target, version: installed },
						enabled: true,
						runtime: null,
						issue: null,
					},
				],
			},
		}),
	);
	await page.route('**/api/plugins/*/manager/install-plan', (route) => {
		expect(route.request().postDataJSON()).toEqual(target);
		return route.fulfill({
			json: {
				target,
				blockers: [],
				steps: [{ package: { ...manifest, version: newVersion }, source: target, action: 'update' }],
			},
		});
	});
	await page.route('**/api/plugins/*/manager/install', (route) => {
		const { plan, observationId } = route.request().postDataJSON();
		expect(plan.target).toEqual(target);
		installed = newVersion;
		host.setPluginVersion(newVersion);
		return route.fulfill({
			status: 202,
			json: {
				id: randomUUID(),
				observationId,
				change: { action: 'install', pluginId, target, revision: 'a'.repeat(64) },
				state: 'succeeded',
				createdAt: new Date().toISOString(),
				committed: true,
				completedPackages: [pluginId],
			},
		});
	});

	await page.goto('/');
	await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const market = page.getByRole('region', { name: 'Plugin Marketplace', exact: true });
	const listing = market.getByRole('button', { name: 'View Counter', exact: true });
	await expect(listing).toContainText('Installed');
	await expect.poll(() => refreshed).toBe(1);
	await market.getByRole('button', { name: 'Refresh', exact: true }).click();
	await expect(listing).toContainText('Update available');
	await listing.click();
	const catalogDetails = page.getByRole('dialog', { name: 'Plugin details' });
	await expect(catalogDetails.getByRole('combobox', { name: 'Version and source' })).toContainText(
		`${newVersion} · Official`,
	);
	await expect(catalogDetails.getByRole('button', { name: `Update to ${newVersion}` })).toBeEnabled();
	await catalogDetails.getByRole('button', { name: 'Manage installed plugin', exact: true }).click();
	const manage = page.getByRole('dialog', { name: 'Manage installed plugin', exact: true });
	await expect(manage).toBeVisible();
	await expect(manage.getByRole('button', { name: /Update/u })).toHaveCount(0);
	await manage.getByRole('button', { name: 'Close application' }).click();

	const card = market
		.getByRole('article')
		.filter({ has: page.getByRole('button', { name: 'Manage Counter', exact: true }) });
	const update = card.getByRole('button', { name: `Update Counter to ${newVersion}` });
	const open = card.getByRole('button', { name: 'Open Counter', exact: true });
	const before = (await update.boundingBox())!;
	const after = (await open.boundingBox())!;
	const status = (await card.getByRole('status').boundingBox())!;
	expect(before.x + before.width).toBeLessThan(after.x);
	expect(before.y).toBeCloseTo(after.y, 1);
	expect(before.width).toBeCloseTo(after.width, 1);
	expect(before.height).toBeCloseTo(after.height, 1);
	expect(status.x).toBeCloseTo(after.x, 1);
	expect(status.width).toBeCloseTo(after.width, 1);
	await update.click();
	const plan = page.getByRole('dialog', { name: 'Plugin installation' });
	await expect(plan.getByText(newVersion, { exact: false })).toBeVisible();
	expect(installed).toBe(installedVersion);
	await plan.getByRole('button', { name: 'Update', exact: true }).click();
	await plan.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(card).toContainText(newVersion);
	await expect(update).toHaveCount(0);
	await expect(open).toBeEnabled();
	await expect.poll(async () => (await card.getByRole('status').boundingBox())!.width).toBeCloseTo(status.width, 1);
});

test('市场卡片恢复本地化介绍，详情按来源和版本预览依赖计划', async ({ page, host: _host }) => {
	const pluginId = '@test/remote-tools';
	const sourceId = '123e4567-e89b-42d3-a456-426614174000';
	const alternateId = '123e4567-e89b-42d3-a456-426614174001';
	const manifest = {
		name: pluginId,
		version: '1.1.0',
		description: 'Manage remote files and processes.',
		type: 'module',
		peerDependencies: { 'nexus-terminal': '^1.0.0' },
		nexus: {
			kind: 'extension',
			icon: 'wrench',
			entry: { backend: 'index.mjs' },
			i18n: { zh: { description: '管理远程文件和进程。' } },
		},
	} as const;
	const repositories = [
		{ id: sourceId, label: 'First source', url: 'https://one.example/catalog.json', official: false },
		{ id: alternateId, label: 'Second source', url: 'https://two.example/catalog.json', official: false },
	] as const;

	let activeRepositories: readonly { id: string; label: string; url: string; official: boolean }[] = repositories;
	await page.route('**/api/plugins/*/repositories', async (route) => {
		if (route.request().method() === 'POST') {
			expect(route.request().postDataJSON()).toEqual({ url: 'https://three.example/catalog.json' });
			const item = {
				id: '123e4567-e89b-42d3-a456-426614174002',
				label: 'Third source',
				url: 'https://three.example/catalog.json',
				official: false,
			} as const;
			activeRepositories = [...activeRepositories, item];
			await route.fulfill({ status: 201, json: item });
		} else await route.fulfill({ json: { items: activeRepositories } });
	});
	await page.route('**/api/plugins/*/plugins', (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: pluginId,
						versions: repositories.map(({ id }) => ({
							package: manifest,
							repositoryId: id,
							distributions: [],
						})),
					},
				],
			},
		}),
	);
	await page.route('**/api/plugins/*/manager/install-plan', async (route) => {
		const source = { kind: 'repository', pluginId, version: manifest.version, repositoryId: alternateId };
		expect(route.request().postDataJSON()).toEqual(source);
		await route.fulfill({
			json: {
				target: source,
				blockers: [],
				steps: [{ package: manifest, action: 'install', source, repository: repositories[1] }],
			},
		});
	});

	let accepted = false;
	await page.route('**/api/plugins/*/manager/install', async (route) => {
		const { plan, observationId } = route.request().postDataJSON();
		expect(plan.target.repositoryId).toBe(alternateId);
		expect(plan.steps).toHaveLength(1);
		accepted = true;
		await route.fulfill({
			status: 202,
			json: {
				id: crypto.randomUUID(),
				observationId,
				change: { action: 'install', pluginId, target: plan.target, revision: '0'.repeat(64) },
				state: 'succeeded',
				createdAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				committed: true,
			},
		});
	});
	await page.route('**/api/plugins/*/manager/plugins', (route) =>
		route.fulfill({
			json: {
				items: accepted
					? [
							{
								pluginId,
								version: manifest.version,
								kind: manifest.nexus.kind,
								hasBackend: false,
								source: {
									kind: 'repository',
									repositoryId: alternateId,
									pluginId,
									version: manifest.version,
								},
								enabled: true,
								issue: null,
								runtime: null,
							},
						]
					: [],
			},
		}),
	);
	await page.route('**/api/plugins/*/manager/retained-data', (route) => route.fulfill({ json: { items: [] } }));
	await page.route('**/api/plugins/*/manager/install-attempts', (route) => route.fulfill({ json: { items: [] } }));

	await page.goto('/');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('combobox', { name: 'Language' }).click();
	await page.getByRole('option', { name: '简体中文' }).click();
	await page.getByRole('region', { name: '设置' }).getByRole('button', { name: '关闭应用' }).click();

	await page.getByRole('button', { name: '插件市场', exact: true }).click();
	const market = page.getByRole('region', { name: '插件市场' });
	const card = market.getByRole('button', { name: '查看 Remote Tools' });
	await expect(card.getByText('管理远程文件和进程。')).toBeVisible();
	await expect(card.locator('svg.lucide-wrench')).toBeVisible();
	const marketplaceSearch = market.getByRole('searchbox');
	await expect(marketplaceSearch).toHaveAttribute('id', /\S/u);
	await expect(marketplaceSearch).toHaveAccessibleName(/\S/u);
	await marketplaceSearch.fill('不存在');
	await expect(card).toHaveCount(0);
	await marketplaceSearch.fill('远程文件');
	await card.click();
	const details = page.getByRole('dialog', { name: '插件详情' });
	await expect(details.getByText('管理远程文件和进程。')).toBeVisible();
	await expect(details.locator('svg.lucide-wrench')).toBeVisible();
	await details.getByRole('combobox', { name: '版本与来源' }).click();
	await page.getByRole('option', { name: '1.1.0 · Second source' }).click();
	await details.getByRole('button', { name: '预览安装' }).click();
	const installation = page.getByRole('dialog', { name: '插件安装' });
	await expect(installation.getByText('1.1.0 · Second source', { exact: false })).toBeVisible();
	await installation.getByRole('button', { name: '安装', exact: true }).click();
	await installation.getByRole('button', { name: '完成', exact: true }).click();
	await expect(market.getByRole('heading', { name: '已安装插件' })).toBeVisible();
	await expect(market.getByRole('button', { name: '管理Remote Tools', exact: true })).toBeVisible();
	await expect(page.locator('[data-ui="toast"]').getByText(`已完成 ${pluginId} 的操作。`)).toBeVisible();

	const repositoriesSection = market.getByRole('region', { name: '插件仓库' });
	await repositoriesSection.getByRole('textbox', { name: '仓库目录地址' }).fill('https://three.example/catalog.json');
	await repositoriesSection.getByRole('button', { name: '添加仓库' }).click();
	await expect(repositoriesSection.getByText('Third source')).toBeVisible();
});

test('普通 HTTP 下应用窗口仍可运行 SDK 任务和宿主 HTTP 与 WS 请求', async ({ page, host: _host }) => {
	await page.addInitScript(() => {
		// Chromium 将测试用的回环地址视为安全源，模拟局域网 HTTP 缺失的原生方法。
		Object.defineProperty(crypto, 'randomUUID', { value: undefined });
		window.addEventListener(
			'nexus:test:background',
			() => document.documentElement.setAttribute('data-background-completed', ''),
			{ once: true },
		);
	});
	await page.route('**/api/plugins/*/items', (route) => route.fulfill({ body: 'fixture-http' }));
	await page.route('**/api/plugins/*/conflict', (route) =>
		route.fulfill({ status: 409, json: { type: 'about:blank', status: 409, code: 'TEST_PLUGIN_CONFLICT' } }),
	);
	await page.routeWebSocket('**/api/plugins/*/echo', (socket) => {
		socket.onMessage((message) => socket.send(message));
	});
	await page.goto('/?host-controls');
	await page.getByRole('button', { name: 'Counter', exact: true }).click();
	const application = page.getByRole('region', { name: 'Counter', exact: true });
	await application.getByRole('tab', { name: 'Two' }).click();
	await expect(application.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
	await expect(application.getByRole('tab', { name: 'Two' })).toHaveAttribute(
		'aria-description',
		'Marked for suspend',
	);
	await expect(application.locator(".window-tab[data-tone='info']")).toHaveCount(1);
	await expect(application.locator('.window-tabs__list')).toHaveCSS('flex-wrap', 'nowrap');

	await application.getByRole('button', { name: 'Close tab Two' }).click();
	await expect(application.getByRole('tab', { name: 'Two' })).toHaveCount(0);
	await application.getByRole('button', { name: 'Probe host' }).click();
	await expect(application.getByText('fixture-http · fixture-frame · 0,255')).toBeVisible();
	await expect(application.getByText('TEST_PLUGIN_CONFLICT')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-background-completed', '');
	await application.getByRole('button', { name: 'Close application' }).click();
	await expect(application).toHaveCount(0);
});

test('市场管理页展示内置应用，隐藏卡片后仍可打开和恢复显示', async ({ page, host: _host }) => {
	await page.goto('/');
	const tile = page.locator('[data-tile="builtin:log"]');
	await expect(tile.getByRole('button', { name: 'Logs', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const market = page.getByRole('region', { name: 'Plugin Marketplace' });
	await market.getByRole('button', { name: 'Manage installed plugins' }).click();
	for (const name of ['Plugin Marketplace', 'Settings', 'Logs', 'Backup and Restore']) {
		const main = market.getByRole('button', { name: 'Manage ' + name, exact: true });
		const card = market
			.getByRole('article')
			.filter({ has: page.getByRole('button', { name: 'Manage ' + name, exact: true }) });
		await expect(main).toBeVisible();
		await expect(card.getByRole('status')).toHaveText('Available');
		await expect(card.getByText(hostVersion, { exact: true })).toBeVisible();
		await expect(card.getByText('Built in', { exact: true })).toBeVisible();
		await expect(card.getByText('App', { exact: true })).toHaveCount(0);
		await expect(card.getByRole('switch')).toHaveCount(0);
		const open = card.getByRole('button', { name: 'Open ' + name, exact: true });
		await expect(open).toBeVisible();
		const badgeBounds = await card.getByRole('status').boundingBox();
		const openBounds = await open.boundingBox();
		expect(openBounds!.x).toBeCloseTo(badgeBounds!.x, 0);
		expect(openBounds!.width).toBeCloseTo(badgeBounds!.width, 0);
	}

	await market.getByRole('searchbox').fill('Logs');
	await expect(market.getByRole('button', { name: 'Manage Settings' })).toHaveCount(0);
	await market.getByRole('button', { name: 'Manage Logs' }).click();
	const details = page.getByRole('dialog', { name: 'Logs' });
	await expect(details.getByRole('button', { name: 'Uninstall' })).toHaveCount(0);
	await expect(details.getByText('Version ' + hostVersion, { exact: true })).toHaveCSS('font-size', '12px');
	await expect(details.getByText('Frontend activity in this browser session', { exact: true })).toBeVisible();
	await details.getByRole('switch', { name: 'Show on desktop' }).click();
	await expect(tile).toHaveCount(0);
	await details.getByRole('button', { name: 'Close application' }).click();
	await expect(details).toHaveCount(0);
	await market.getByRole('button', { name: 'Open Logs', exact: true }).click();
	const logs = page.getByRole('region', { name: 'Logs', exact: true });
	await expect(logs).toBeVisible();
	await logs.getByRole('button', { name: 'Close application' }).click();

	await market.getByRole('button', { name: 'Manage Logs' }).click();
	await expect(details.getByRole('switch', { name: 'Show on desktop' })).not.toBeChecked();
	await details.getByRole('switch', { name: 'Show on desktop' }).click();
	await expect(tile).toHaveCount(1);
	await expect.poll(() => tile.evaluate((element) => Number(element.getAttribute('gs-w') ?? 1))).toBe(1);
});

test('账户密码等宽排列，保存按钮在操作行，窄屏时控件占满宽度', async ({ page, host: _host }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const settings = page.getByRole('region', { name: 'Settings', exact: true });
	const current = settings.getByLabel('Current password', { exact: true });
	const next = settings.getByLabel('New password', { exact: true });
	for (const field of [current, next]) await expect(field).toHaveAttribute('id', /\S/u);
	await expect(current).toHaveAccessibleName('Current password');
	await expect(next).toHaveAccessibleName('New password');
	const brokenLabels = await settings
		.locator('label[for]')
		.evaluateAll((labels) =>
			labels.filter((label) => !(label as HTMLLabelElement).control).map((label) => label.textContent),
		);
	expect(brokenLabels).toEqual([]);
	const form = settings.getByRole('form', { name: 'Change password' });
	await expect(form).toHaveAccessibleDescription('Changing your password signs out other sessions on this server.');
	const update = form.getByRole('button', { name: 'Save password', exact: true });
	const logout = settings.getByRole('button', { name: 'Sign out', exact: true });
	await expect(update).toBeVisible();
	await expect(logout).toBeVisible();
	await expect
		.poll(async () => {
			const [first, second, save, signOut] = await Promise.all([
				current.boundingBox(),
				next.boundingBox(),
				update.boundingBox(),
				logout.boundingBox(),
			]);
			if (!first || !second || !save || !signOut) return false;
			return (
				first.x < second.x &&
				Math.abs(first.y - second.y) <= 2 &&
				Math.abs(first.width - second.width) <= 2 &&
				second.y + second.height < save.y &&
				Math.abs(save.x + save.width - (signOut.x + signOut.width)) <= 2
			);
		})
		.toBe(true);

	await page.setViewportSize({ width: 390, height: 844 });
	const fields = settings.locator('.account-fields');
	await expect
		.poll(async () => {
			const [first, second, save, form] = await Promise.all([
				current.boundingBox(),
				next.boundingBox(),
				update.boundingBox(),
				fields.boundingBox(),
			]);
			if (!first || !second || !save || !form) return false;
			return (
				first.y + first.height < second.y &&
				second.y + second.height < save.y &&
				Math.abs(save.x - form.x) <= 2 &&
				Math.abs(save.width - form.width) <= 2
			);
		})
		.toBe(true);
});

test('已安装卡片按清单区分应用与扩展，启用意图独立于运行状态', async ({ page, host }) => {
	const byId = (pluginId: string) => ({ pluginId, version: '0.0.1-dev.1' });

	const firstRequest = Promise.withResolvers<void>();
	const finishFirst = Promise.withResolvers<void>();
	let appEnabled = true;

	host.setPluginVersion('0.0.1-dev.1');
	await page.route('**/api/plugins/*/manager/plugins/*', async (route) => {
		const pluginId = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
		const { enabled, observationId } = route.request().postDataJSON();
		if (pluginId === '@nexus-terminal/test') {
			firstRequest.resolve();
			await finishFirst.promise;
			appEnabled = enabled;
		}
		const failed = pluginId === '@example/support';
		await route.fulfill({
			status: 202,
			json: {
				id: randomUUID(),
				observationId,
				change: { action: 'set-enabled', pluginId, enabled },
				state: failed ? 'failed' : 'succeeded',
				...(failed && { error: 'MARKETPLACE_OPERATION_FAILED' }),
				createdAt: new Date().toISOString(),
				committed: true,
			},
		});
	});
	await page.route('**/api/plugins/*/manager/plugins', (route) =>
		route.fulfill({
			json: {
				items: [
					{
						...byId('@nexus-terminal/test'),
						kind: 'application',
						icon: 'fingerprint',
						hasBackend: false,
						source: { kind: 'local' },
						enabled: appEnabled,
						runtime: null,
						issue: null,
					},
					{
						...byId('@example/support'),
						kind: 'extension',
						hasBackend: true,
						source: { kind: 'local' },
						enabled: true,
						runtime: {
							...byId('@example/support'),
							runtime: 'stopped',
							readiness: { state: 'pending' },
							issues: [{ code: 'PLUGIN_DEPENDENCY_NOT_READY', pluginId: '@example/provider' }],
						},
						issue: null,
					},
				],
			},
		}),
	);
	await page.goto('/');
	const launcher = page.getByRole('main').getByRole('button', { name: 'Counter', exact: true });
	await expect(launcher.locator('svg.lucide-fingerprint')).toBeVisible();
	await launcher.click();
	const counter = page.getByRole('region', { name: 'Counter', exact: true });
	await expect(counter.locator('.application-window__identity svg.lucide-fingerprint')).toBeVisible();
	await page.locator('.dock-reveal').evaluate((button: HTMLElement) => button.click());
	await expect(
		page.getByRole('button', { name: 'Switch to Counter' }).locator('svg.lucide-fingerprint'),
	).toBeVisible();
	await counter.getByRole('button', { name: 'Close application' }).click();
	await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const market = page.getByRole('region', { name: 'Plugin Marketplace' });
	await market.getByRole('button', { name: 'Manage installed plugins' }).click();
	const application = market.locator('article').filter({ has: page.getByRole('button', { name: 'Manage Counter' }) });
	await expect(application.getByRole('status')).toHaveText('Available');
	await expect(application.locator('svg.lucide-fingerprint')).toBeVisible();
	await expect(application.locator('[title="0.0.1-dev.1"]')).toHaveText('0.0.1-dev.1');
	await expect(application.getByRole('switch')).toHaveCount(0);
	await expect(application.getByText('App', { exact: true })).toHaveCount(0);
	await expect(application.getByRole('button', { name: 'Open Counter' })).toBeVisible();
	const extension = market.locator('article').filter({ has: page.getByRole('button', { name: 'Manage Support' }) });
	await expect(extension.getByRole('status')).toHaveText('Dependency blocked');
	await expect(extension.getByRole('switch')).toHaveCount(0);
	await expect(extension.getByText('Extension', { exact: true })).toHaveCount(0);
	await expect(extension.getByRole('button', { name: 'Open Support' })).toHaveCount(0);
	await expect(market.getByRole('heading', { name: 'Extensions', exact: true })).toBeVisible();
	const details = page.getByRole('dialog', { name: 'Manage installed plugin', exact: true });
	const enable = details.getByRole('switch', { name: 'Enable plugin', exact: true });
	const close = details.getByRole('button', { name: 'Close application' });
	const status = application.getByRole('status');

	const relativeStatusTop = () =>
		status.evaluate(
			(badge) => badge.getBoundingClientRect().top - badge.closest('article')!.getBoundingClientRect().top,
		);

	const initialStatusTop = await relativeStatusTop();

	try {
		await application.getByRole('button', { name: 'Manage Counter', exact: true }).click();
		await expect(details.getByRole('switch', { name: 'Show on desktop', exact: true })).toBeChecked();
		await expect(details.getByText('0.0.1-dev.1', { exact: true })).toHaveCSS('font-weight', '400');
		await expect(details.locator('footer').getByRole('button')).toHaveText(['Reload', 'Uninstall']);
		await expect(enable).toBeChecked();
		await enable.click();
		await firstRequest.promise;
		await expect(enable).toBeDisabled();
		await close.press('Enter');
		await extension.getByRole('button', { name: 'Manage Support', exact: true }).click();
		await expect(enable).toBeEnabled();
		await expect(enable).toBeChecked();
		await expect(details.getByRole('switch', { name: 'Show on desktop', exact: true })).toHaveCount(0);
		const supportRequest = page.waitForRequest(
			(request) => request.method() === 'PATCH' && request.url().endsWith(encodeURIComponent('@example/support')),
		);
		await enable.click();
		expect((await supportRequest).postDataJSON()).toMatchObject({ enabled: false });
		await close.press('Enter');
	} finally {
		finishFirst.resolve();
	}

	await expect(status).toHaveText('Disabled');
	await expect(application.getByRole('button', { name: 'Open Counter' })).toHaveCount(0);
	expect(await relativeStatusTop()).toBeCloseTo(initialStatusTop, 0);

	await expect(market.getByRole('heading', { name: 'Operations', exact: true })).toHaveCount(0);
	await market.getByRole('button', { name: 'Close application' }).click();
	await page.getByRole('button', { name: 'Logs', exact: true }).click();
	const logs = page.getByRole('region', { name: 'Logs', exact: true });
	const success = logs.locator('details').filter({ hasText: 'Completed the operation for @nexus-terminal/test.' });
	const failure = logs.locator('details').filter({ hasText: 'The marketplace operation failed.' });
	await success.locator('summary').click();
	await expect(success.locator('pre')).toContainText('"action": "set-enabled"');
	await expect(success.locator('pre')).toContainText('"enabled": false');
	await expect(success.locator('pre')).toContainText('"state": "succeeded"');
	await failure.locator('summary').click();
	await expect(failure.locator('pre')).toContainText('"pluginId": "@example/support"');
	await expect(failure.locator('pre')).toContainText('"state": "failed"');
	await expect(failure.locator('pre')).toContainText('"committed": true');
});

test('市场按清单显示插件名称，停用及刷新后仍随语言变化', async ({ page, host }) => {
	const pluginId = '@nexus-terminal/test';
	const version = '0.0.1-dev.1';
	let enabled = true;

	host.setPluginVersion(version);
	await page.route('**/api/plugins/*/manager/plugins', (route) =>
		route.fulfill({
			json: {
				items: [
					{
						pluginId,
						version,
						kind: 'application',
						hasBackend: false,
						displayName: 'Package name',
						localizedNames: { 'zh-CN': '清单名称' },
						source: { kind: 'local' },
						enabled,
						runtime: null,
						issue: null,
					},
				],
			},
		}),
	);
	await page.route('**/api/plugins/*/manager/plugins/' + encodeURIComponent(pluginId), async (route) => {
		const request = route.request().postDataJSON();
		enabled = request.enabled;
		host.setPluginVersion(enabled ? version : null);
		await route.fulfill({
			status: 202,
			json: {
				id: randomUUID(),
				observationId: request.observationId,
				change: { action: 'set-enabled', pluginId, enabled },
				state: 'succeeded',
				createdAt: new Date().toISOString(),
				committed: true,
			},
		});
	});

	await page.goto('/');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('combobox', { name: 'Language' }).click();
	await page.getByRole('option', { name: '简体中文' }).click();
	await page.getByRole('region', { name: '设置', exact: true }).getByRole('button', { name: '关闭应用' }).click();

	const market = page.getByRole('region', { name: '插件市场', exact: true });
	const card = market
		.getByRole('article')
		.filter({ has: page.getByRole('button', { name: '管理清单名称', exact: true }) });

	await page.getByRole('button', { name: '插件市场', exact: true }).click();
	await market.getByRole('button', { name: '管理已安装插件', exact: true }).click();
	await expect(card.getByRole('button', { name: '打开清单名称' })).toBeVisible();
	await card.getByRole('button', { name: '管理清单名称', exact: true }).click();
	const details = page.getByRole('dialog', { name: '管理已安装插件', exact: true });
	await expect(details.locator('.marketplace-managed-heading')).toHaveText(/^清单名称\s*可用$/u);
	await expect(details.locator('.marketplace-managed-package')).toHaveText(
		/^@nexus-terminal\/test\s*0\.0\.1-dev\.1$/u,
	);
	await details.getByRole('switch', { name: '启用插件', exact: true }).click();
	const visibility = details.getByRole('switch', { name: '在桌面显示', exact: true });
	await expect(visibility).toBeDisabled();
	await expect(visibility).not.toBeChecked();
	await details.getByRole('button', { name: '关闭应用' }).press('Enter');
	await expect(card.getByRole('status')).toHaveText('已停用');
	await expect(card.getByRole('button', { name: '打开清单名称' })).toHaveCount(0);

	await page.reload();
	await page.getByRole('button', { name: '插件市场', exact: true }).click();
	await market.getByRole('button', { name: '管理已安装插件', exact: true }).click();
	await expect(card.getByRole('status')).toHaveText('已停用');
	await card.getByRole('button', { name: '管理清单名称', exact: true }).click();
	await expect(visibility).toBeDisabled();
	await expect(visibility).not.toBeChecked();
	await details.getByRole('button', { name: '关闭应用' }).press('Enter');

	await market.getByRole('button', { name: '关闭应用' }).click();
	await page.getByRole('button', { name: '设置', exact: true }).click();
	await page.getByRole('combobox', { name: '语言' }).click();
	await page.getByRole('option', { name: 'English', exact: true }).click();
	await page
		.getByRole('region', { name: 'Settings', exact: true })
		.getByRole('button', { name: 'Close application' })
		.click();
	await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	await page.getByRole('button', { name: 'Manage installed plugins', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Manage Package name', exact: true })).toBeVisible();
});

test('市场等待远程目录并从依赖解析推进到配置完成', async ({ page, host }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const pluginId = '@nexus-terminal/test';
	const dependency = '@example/support';
	const version = '1.0.0';
	const repository = { id: randomUUID(), url: 'https://example.com/catalog.json', label: 'Official', official: true };
	const target = { kind: 'repository', repositoryId: repository.id, pluginId, version };
	const manifest = { version, type: 'module', peerDependencies: { 'nexus-terminal': '^1.0.0' } };
	const pack = {
		...manifest,
		name: pluginId,
		displayName: 'Counter',
		nexus: { kind: 'application', entry: { frontend: 'index.js' }, dependsOn: { [dependency]: '^1.0.0' } },
	};
	const support = {
		...manifest,
		name: dependency,
		displayName: 'Support',
		nexus: { kind: 'extension', entry: { frontend: 'index.js' } },
	};
	const catalogGate = Promise.withResolvers<void>();
	const planGate = Promise.withResolvers<void>();
	let catalogReady = false;
	let installed = false;
	const runtime: PluginRuntimeInfo = {
		pluginId,
		version,
		runtime: 'running',
		readiness: { state: 'pending', reason: { code: 'PLUGIN_CONFIGURATION_REQUIRED', applicationId: 'counter' } },
		issues: [],
	};
	let operation: MarketplaceOperation = {
		id: randomUUID(),
		change: { action: 'install', pluginId, target: { ...target, kind: 'repository' }, revision: 'a'.repeat(64) },
		state: 'running',
		createdAt: new Date().toISOString(),
		committed: false,
		step: { phase: 'download', pluginId: dependency },
	};
	await page.route('**/api/plugins/*/repositories', (route) => route.fulfill({ json: { items: [repository] } }));
	await page.route('**/api/plugins/*/repositories/*/refresh', async (route) => {
		await catalogGate.promise;
		catalogReady = true;
		await route.fulfill({ status: 204 });
	});
	await page.route('**/api/plugins/*/plugins', (route) =>
		route.fulfill({
			json: {
				items: catalogReady
					? [{ id: pluginId, versions: [{ repositoryId: repository.id, package: pack }] }]
					: [],
			},
		}),
	);
	await page.route('**/api/plugins/*/manager/install-plan', async (route) => {
		await planGate.promise;
		await route.fulfill({
			json: {
				target,
				steps: [
					{ package: support, source: { ...target, pluginId: dependency }, action: 'install' },
					{ package: pack, source: target, action: 'install' },
				],
				blockers: [],
				affected: Array.from({ length: 8 }, (_, index) => `@example/affected-${index}`),
			},
		});
	});
	await page.route('**/api/plugins/*/manager/install', (route) => {
		operation = { ...operation, observationId: route.request().postDataJSON().observationId };
		return route.fulfill({ status: 202, json: operation });
	});
	await page.route('**/api/plugins/*/manager/plugins', (route) =>
		route.fulfill({
			json: {
				items: installed
					? [
							{
								pluginId: dependency,
								version,
								kind: 'extension',
								hasBackend: false,
								source: { kind: 'local' },
								enabled: true,
								runtime: null,
								issue: null,
							},
							{
								pluginId,
								version,
								kind: 'application',
								hasBackend: true,
								source: target,
								enabled: true,
								runtime,
								issue: null,
							},
						]
					: [],
			},
		}),
	);

	await page.goto('/');
	await page.getByRole('button', { name: 'Plugin Marketplace', exact: true }).click();
	const market = page.getByRole('region', { name: 'Plugin Marketplace', exact: true });
	try {
		const loading = market.getByRole('status').filter({ hasText: 'Loading repositories…' });
		await expect(loading).toBeVisible();
		await expect(market.locator('.ui-loading-tiles__tile')).toHaveCount(4);
		const centered = await loading.evaluate((label) => {
			const content = label.parentElement!.getBoundingClientRect();
			const region = label.closest('.catalog-placeholder')!.getBoundingClientRect();
			return {
				x: content.left + content.width / 2 - (region.left + region.width / 2),
				y: content.top + content.height / 2 - (region.top + region.height / 2),
				height: region.height,
			};
		});
		expect(centered.x).toBeCloseTo(0, 0);
		expect(centered.y).toBeCloseTo(0, 0);
		expect(centered.height).toBeGreaterThan(132);
		await expect(market.getByText('No apps to discover yet')).toHaveCount(0);
	} finally {
		catalogGate.resolve();
	}
	await market.getByRole('button', { name: 'View Counter' }).click();
	await page.getByRole('button', { name: 'Preview installation' }).click();
	const dialog = page.getByRole('dialog', { name: 'Plugin installation' });
	const currentStage = dialog.locator('[aria-current="step"]');

	const layout = () =>
		dialog.evaluate((element) =>
			[element, ...element.querySelectorAll('.install-stages, .ui-dialog__footer')].map((part) => {
				const { x, y, width, height } = part.getBoundingClientRect();
				return { x, y, width, height };
			}),
		);

	let initialLayout: Awaited<ReturnType<typeof layout>>;
	try {
		await expect(currentStage).toHaveText(/Resolve dependencies/u);
		await expect(dialog.locator('[data-state="running"]')).toBeVisible();
		initialLayout = await layout();
	} finally {
		planGate.resolve();
	}

	const confirm = dialog.getByRole('button', { name: 'Install', exact: true });
	await expect(confirm).toBeVisible();
	expect(await layout()).toEqual(initialLayout);
	await dialog.getByText('@example/affected-7', { exact: true }).scrollIntoViewIfNeeded();
	const stageBody = dialog.locator('.install-stage-body');
	expect(await stageBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
	expect(await layout()).toEqual(initialLayout);
	const viewport = page.viewportSize()!;
	await page.setViewportSize({ ...viewport, height: 360 });
	await expect(dialog).toBeInViewport({ ratio: 1 });
	await expect(confirm).toBeInViewport({ ratio: 1 });
	await page.setViewportSize(viewport);
	expect(await layout()).toEqual(initialLayout);
	await confirm.click();
	await expect(currentStage).toHaveText(/Install packages/u);
	expect(await stageBody.evaluate((element) => element.scrollTop)).toBe(0);
	expect(await layout()).toEqual(initialLayout);
	const progress = dialog.locator('[data-ui="progress-row"]');
	await expect(progress.filter({ hasText: 'Support' })).toHaveAttribute('data-state', 'running');
	await expect(progress.filter({ hasText: 'Counter' })).toHaveAttribute('data-state', 'pending');
	operation = {
		...operation,
		committed: true,
		step: { phase: 'download', pluginId },
		completedPackages: [dependency],
	};
	host.setOperations([operation]);
	await expect(progress.filter({ hasText: 'Support' })).toHaveAttribute('data-state', 'succeeded');
	await expect(progress.filter({ hasText: 'Counter' })).toHaveAttribute('data-state', 'running');

	installed = true;
	host.setRuntime([runtime]);
	host.setOperations([{ ...operation, state: 'succeeded', completedPackages: [dependency, pluginId] }]);
	await expect(currentStage).toHaveText(/Check configuration/u);
	const openConfiguration = dialog.getByRole('button', { name: 'Open configuration' });
	await expect(dialog.getByRole('button', { name: 'Configure later' })).toBeVisible();
	expect(await layout()).toEqual(initialLayout);
	await openConfiguration.click();
	const configuration = page.getByRole('region', { name: 'Counter', exact: true });
	await expect(configuration).toBeVisible();
	await expect(dialog).toBeHidden();
	await expect(market.getByRole('button', { name: 'Installation progress' })).toHaveCount(0);
	await configuration.getByRole('button', { name: 'Close application' }).click();
	await expect(currentStage).toHaveText(/Check configuration/u);
	await expect(openConfiguration).toBeVisible();
	await openConfiguration.click();
	await expect(configuration).toBeVisible();
	host.setRuntime([{ ...runtime, readiness: { state: 'ready' } }]);
	await configuration.getByRole('button', { name: 'Close application' }).click();
	await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
	expect(await layout()).toEqual(initialLayout);
	await expect(dialog.getByRole('button', { name: 'Configure later' })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(dialog).toHaveCount(0);

	// The installed-list response still reports the earlier pending runtime.
	const card = market.locator('article').filter({ has: page.getByRole('button', { name: 'Manage Counter' }) });
	await expect(card.getByRole('status')).toHaveText('Available');
	await card.getByRole('button', { name: 'Manage Counter' }).click();
	const details = page.getByRole('dialog', { name: 'Manage installed plugin', exact: true });
	await expect(details.getByText('Available', { exact: true })).toBeVisible();
	host.setRuntime([runtime]);
	await expect(details.getByText('Needs setup', { exact: true })).toBeVisible();
	await details.getByRole('button', { name: 'Close application' }).click();
	await expect(card.getByRole('status')).toHaveText('Needs setup');
});
