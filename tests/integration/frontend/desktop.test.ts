import { effectScope, nextTick, type EffectScope } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopApi } from '../../../src/desktop/browser/desktop-api.js';

const layoutKey = 'nexus.desktop.pages';
const scopes: EffectScope[] = [];

function openDesktop() {
	const scope = effectScope();
	scopes.push(scope);
	const log = { report: vi.fn() };
	return { desktop: scope.run(() => new DesktopApi(log))!, log };
}

afterEach(() => {
	for (const scope of scopes.splice(0)) scope.stop();
	localStorage.clear();
});

it('损坏布局回退到默认桌面，用户编辑后才替换原记录', async () => {
	const invalid = '{"compact":{}}';
	localStorage.setItem(layoutKey, invalid);
	const { desktop, log } = openDesktop();
	const settings = { key: 'settings', label: 'Settings', w: 2, h: 1 };
	desktop.ensure('compact', [settings]);
	await nextTick();
	expect(desktop.page('compact').tiles).toEqual([{ ...settings, x: 0, y: 0 }]);
	expect(localStorage.getItem(layoutKey)).toBe(invalid);
	expect(log.report).toHaveBeenCalledWith(expect.objectContaining({ code: 'DESKTOP_STORAGE_UNAVAILABLE' }));

	desktop.addPage('compact');
	desktop.togglePin(settings.key);
	await nextTick();
	const reloaded = openDesktop().desktop;
	expect(reloaded.get('compact').pages).toEqual(desktop.get('compact').pages);
	expect(reloaded.page('compact').id).toBe(desktop.page('compact').id);
	expect(reloaded.pins.value).toEqual([settings.key]);
});

it('目标页满时保留全部格位，隐藏卡片和视口分档各自持久化', async () => {
	const { desktop, log } = openDesktop();
	const settings = { key: 'settings', label: 'Settings', w: 2, h: 1 };
	const fullPage = desktop.page('compact').id;
	desktop.add('compact', { key: 'full', label: 'Full', w: 4, h: 5 });
	desktop.addPage('compact');
	const secondPage = desktop.page('compact').id;
	desktop.add('compact', settings);
	expect(desktop.moveTile('compact', settings.key, fullPage)).toBe(false);
	desktop.removePage('compact', secondPage);
	expect(desktop.get('compact').pages).toHaveLength(2);
	expect(desktop.page('compact').tiles[0]?.key).toBe(settings.key);
	expect(log.report).toHaveBeenCalledTimes(2);
	expect(log.report).toHaveBeenLastCalledWith(
		expect.objectContaining({ code: 'DESKTOP_PAGE_FULL', userVisible: true }),
	);

	desktop.remove('compact', settings.key);
	desktop.ensure('wide', [settings]);
	await nextTick();
	const reloaded = openDesktop().desktop;
	reloaded.ensure('compact', [settings]);
	expect(reloaded.page('compact').tiles).toEqual([]);
	expect(reloaded.page('wide').tiles[0]?.key).toBe(settings.key);
});
