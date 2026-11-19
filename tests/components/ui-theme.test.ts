import { expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import { createUiThemes } from '../../src/ui/browser/ui-theme-api.js';

const pluginId = '@test/theme';
const themeId = JSON.stringify([pluginId, 'night']);
const night = { id: 'night', label: 'Night', mode: 'dark' as const, tokens: { '--ui-primary': '#123456' } };

it('应用预览和保存的主题，撤销后恢复宿主原有变量和配色', async () => {
	const root = document.createElement('div');
	const selected = ref('');
	root.style.setProperty('--ui-primary', 'teal', 'important');
	root.dataset.uiThemeMode = 'light';
	const themes = createUiThemes(root, selected);
	try {
		const unregister = themes.scope(pluginId).registerTheme(night);
		themes.api.previewTheme(themeId);
		await nextTick();
		expect(root.style.getPropertyValue('--ui-primary')).toBe('#123456');
		expect(root.dataset.uiThemeMode).toBe('dark');
		expect(selected.value).toBe('');

		themes.api.cancelPreview();
		await nextTick();
		expect(root.style.getPropertyValue('--ui-primary')).toBe('teal');
		expect(root.style.getPropertyPriority('--ui-primary')).toBe('important');
		expect(root.dataset.uiThemeMode).toBe('light');

		await themes.api.selectTheme(themeId);
		expect(selected.value).toBe(themeId);
		unregister();
		await nextTick();
		expect(themes.api.state.value.activeThemeId).toBe('');
		expect(selected.value).toBe(themeId);
		themes.scope(pluginId).registerTheme(night);
		await nextTick();
		expect(root.style.getPropertyValue('--ui-primary')).toBe('#123456');
	} finally {
		themes.close();
	}
	expect(root.style.getPropertyValue('--ui-primary')).toBe('teal');
	expect(root.dataset.uiThemeMode).toBe('light');
});

it('登记后保留主题快照，宿主在覆盖期间改写的变量继续生效', async () => {
	const root = document.createElement('div');
	const themes = createUiThemes(root, ref(themeId));
	const tokens = { ...night.tokens };
	try {
		themes.scope(pluginId).registerTheme({ ...night, tokens });
		tokens['--ui-primary'] = '#fff';
		await nextTick();
		expect(root.style.getPropertyValue('--ui-primary')).toBe('#123456');
		root.style.setProperty('--ui-primary', 'coral');
	} finally {
		themes.close();
	}
	expect(root.style.getPropertyValue('--ui-primary')).toBe('coral');
	expect(() => themes.scope(pluginId).registerTheme(night)).toThrow('UI_THEME_NOT_INSTALLED');
});
