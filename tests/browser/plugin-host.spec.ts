import { expect, test } from './plugin-host-fixture.js';

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
	await launcher.click();
	const application = page.getByRole('region', { name: 'Counter', exact: true });
	await application.getByRole('button', { name: '加一' }).click();
	await expect(application.getByText('计数：1')).toBeVisible();
	await application.getByRole('button', { name: '最小化' }).click();
	await expect(application).toBeHidden();
	await launcher.click();
	await expect(application.getByText('计数：1')).toBeVisible();
	await application.getByRole('button', { name: '关闭应用' }).click();
	await expect(application).toHaveCount(0);
	await expect(widget.getByText('计数：0')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-lifecycle', 'activated,view-disposed');

	host.setPluginVersion(null);
	await expect(widget).toHaveCount(0);
	await expect(launcher).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute(
		'data-lifecycle',
		'activated,view-disposed,view-disposed,deactivated,plugin-disposed',
	);
	host.setPluginVersion('1.0.0');
	await expect(launcher).toBeVisible();
	await expect(widget.getByText('计数：0')).toBeVisible();
	host.setPluginVersion('1.0.1');
	await expect(page.locator('html')).toHaveAttribute(
		'data-lifecycle',
		'activated,view-disposed,view-disposed,deactivated,plugin-disposed,activated,view-disposed,deactivated,plugin-disposed,activated',
	);
	await expect(widget.getByText('计数：0')).toBeVisible();
	expect(errors).toEqual([]);
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

test('下拉选择框只淡入，弹层本身没有位移或缩放', async ({ page, host: _host }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.addInitScript(() => {
		const animate = Element.prototype.animate;
		Element.prototype.animate = function (...args: Parameters<typeof animate>) {
			const animation = Reflect.apply(animate, this, args) as Animation;
			if (this instanceof HTMLElement) {
				const effect = animation.effect as KeyframeEffect;
				const before = JSON.parse(this.dataset.testFrames ?? '[]') as Keyframe[][];
				this.dataset.testFrames = JSON.stringify([...before, effect.getKeyframes()]);
			}
			return animation;
		};
	});
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	await page.getByRole('combobox', { name: 'Language' }).click();
	const list = page.getByRole('listbox');
	await expect(list).toBeVisible();
	const frames = await list.evaluate((element) => {
		const popper = element.closest('[data-reka-popper-content-wrapper]');
		return [element, popper].flatMap(
			(target) => JSON.parse(target?.getAttribute('data-test-frames') ?? '[]') as Keyframe[][],
		);
	});
	expect(frames).toContainEqual(
		expect.arrayContaining([expect.objectContaining({ opacity: '0' }), expect.objectContaining({ opacity: '1' })]),
	);
	for (const frame of frames.flat()) {
		expect(frame.transform).toBeUndefined();
		expect(frame.translate).toBeUndefined();
		expect([undefined, 1]).toContain(frame.scale === undefined ? undefined : Number(frame.scale));
	}
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
	await market.getByRole('searchbox').fill('不存在');
	await expect(card).toHaveCount(0);
	await market.getByRole('searchbox').fill('远程文件');
	await card.click();
	const details = page.getByRole('dialog', { name: '插件详情' });
	await expect(details.getByText('管理远程文件和进程。')).toBeVisible();
	await details.getByRole('combobox', { name: '版本与来源' }).click();
	await page.getByRole('option', { name: '1.1.0 · Second source' }).click();
	await details.getByRole('button', { name: '预览安装' }).click();
	await expect(page.getByRole('dialog', { name: '预览安装' }).getByText('1.1.0 · Second source')).toBeVisible();
	await page.getByRole('dialog', { name: '预览安装' }).getByRole('button', { name: '安装', exact: true }).click();
	await expect(market.getByRole('heading', { name: '已安装插件' })).toBeVisible();
	await expect(market.getByRole('button', { name: pluginId })).toBeVisible();
	await expect(market.getByText('已完成', { exact: true })).toBeVisible();

	const repositoriesSection = market.getByRole('region', { name: '插件仓库' });
	await repositoriesSection.getByRole('textbox', { name: '仓库目录地址' }).fill('https://three.example/catalog.json');
	await repositoriesSection.getByRole('button', { name: '添加仓库' }).click();
	await expect(repositoriesSection.getByText('Third source')).toBeVisible();
});

test('应用窗口通过公开 SDK 登记标签及动作，并通过宿主发送 HTTP 与 WS', async ({ page, host: _host }) => {
	await page.route('**/api/plugins/*/items', (route) => route.fulfill({ body: 'fixture-http' }));
	await page.route('**/api/plugins/*/conflict', (route) =>
		route.fulfill({ status: 409, json: { type: 'about:blank', status: 409, code: 'TEST_PLUGIN_CONFLICT' } }),
	);
	await page.routeWebSocket('**/api/plugins/*/echo', (socket) => {
		socket.onMessage((message) => socket.send(message));
	});
	await page.goto('/?host-controls');
	await page.getByRole('button', { name: 'Counter', exact: true }).click();
	const window = page.getByRole('region', { name: 'Counter', exact: true });
	await window.getByRole('tab', { name: 'Two' }).click();
	await expect(window.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
	await window.getByRole('button', { name: 'Close tab Two' }).click();
	await expect(window.getByRole('tab', { name: 'Two' })).toHaveCount(0);
	await window.getByRole('button', { name: 'Probe host' }).click();
	await expect(window.getByText('fixture-http · fixture-frame · 0,255')).toBeVisible();
	await window.getByRole('button', { name: 'Close application' }).click();
	await expect(window).toHaveCount(0);
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
		await expect(card.getByRole('button', { name: 'Open ' + name, exact: true })).toBeVisible();
	}

	await market.getByRole('searchbox').fill('Logs');
	await expect(market.getByRole('button', { name: 'Manage Settings' })).toHaveCount(0);
	await market.getByRole('button', { name: 'Manage Logs' }).click();
	const details = page.getByRole('dialog', { name: 'Logs' });
	await expect(details.getByRole('button', { name: 'Uninstall' })).toHaveCount(0);
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

test('账户密码字段和保存按钮同行，保存按钮与退出登录右侧对齐', async ({ page, host: _host }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Settings', exact: true }).click();
	const settings = page.getByRole('region', { name: 'Settings', exact: true });
	const current = settings.getByLabel('Current password', { exact: true });
	const next = settings.getByLabel('New password', { exact: true });
	const update = settings.getByRole('button', { name: 'Change password', exact: true });
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
				second.x < save.x &&
				Math.abs(first.y + first.height - (save.y + save.height)) <= 2 &&
				Math.abs(second.y + second.height - (save.y + save.height)) <= 2 &&
				Math.abs(save.x + save.width - (signOut.x + signOut.width)) <= 2
			);
		})
		.toBe(true);
});
