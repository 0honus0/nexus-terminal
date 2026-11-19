import { CodedError } from '../../utils/error.js';
import {
	computed,
	inject,
	onScopeDispose,
	provide,
	ref,
	shallowReactive,
	toValue,
	watchEffect,
	type ComputedRef,
	type InjectionKey,
	type Ref,
} from 'vue';
import type { AppUiThemeInfo, AppUiState, UiRemoveRegistration, UiTheme } from './ui-theme-types.js';
import type { UiErrorCode } from './ui-error-types.js';

/**
 * UI 模块供 App 使用的主题管理 API，不加入插件 Context 或公开 SDK。
 * 响应式接收主题登记、撤销及语言变化，不轮询插件状态。
 * 本体负责保存选择和启动恢复；启动先有内置主题，加载可用后应用已保存主题。
 * 只更新样式变量，不替换组件、根容器或应用外壳，不改变组件及业务状态。
 * 切换、取消预览及主题撤销时，先清除旧主题自身的覆盖，再应用新主题的覆盖。
 * 保留内置默认变量，不清除其他来源的样式；新主题未提供的变量自然使用内置默认值。
 *
 * 选择通过宿主注入的响应式引用读写；持久化、跨客户端同步和失败回退由设置模块负责。
 */
export interface UiThemeApi {
	readonly themes: ComputedRef<readonly AppUiThemeInfo[]>;
	readonly state: ComputedRef<AppUiState>;
	/** 验证并立即更新选择；后台保存由宿主设置模块协调。 */
	selectTheme(id: string): Promise<void>;
	/** 临时应用主题，不保存；不存在的主题明确报错。 */
	previewTheme(id: string): void;
	/** 取消预览，恢复已保存主题；不可用时使用内置主题。 */
	cancelPreview(): void;
}

/** 宿主内部主题登记器，不通过插件 SDK 暴露；插件在 contributes.themes 提供描述。 */
export interface UiApi {
	registerTheme(theme: UiTheme): UiRemoveRegistration;
}

/** 变量覆盖与主题选择分开；作用域退出清除自身覆盖，不操作组件或其他来源的样式。 */
export function createUiThemes(root: HTMLElement, selected: Ref<string>) {
	const themes = shallowReactive(new Map<string, { pluginId: string; theme: UiTheme }>());
	const preview = ref<string | null>(null);
	const owned = new Map<string, { value: string; priority: string; applied: string }>();
	let mode: { before: string | undefined; applied: string } | undefined;
	let closed = false;

	function release(): void {
		for (const [name, { value, priority, applied }] of owned) {
			if (root.style.getPropertyValue(name) !== applied || root.style.getPropertyPriority(name)) continue;
			if (value) root.style.setProperty(name, value, priority);
			else root.style.removeProperty(name);
		}
		owned.clear();
		if (mode && root.dataset.uiThemeMode === mode.applied) {
			if (mode.before === undefined) delete root.dataset.uiThemeMode;
			else root.dataset.uiThemeMode = mode.before;
		}
		mode = undefined;
	}

	const stop = watchEffect(() => {
		const theme = themes.get(preview.value ?? selected.value)?.theme;
		release();
		if (!theme) return;
		for (const [name, token] of Object.entries(theme.tokens)) {
			const value = root.style.getPropertyValue(name);
			const priority = root.style.getPropertyPriority(name);
			root.style.setProperty(name, token);
			owned.set(name, { value, priority, applied: root.style.getPropertyValue(name) });
		}
		// mode 默认值由设置模块提供；外部主题只在选中期间覆盖它。
		mode = { before: root.dataset.uiThemeMode, applied: theme.mode };
		root.dataset.uiThemeMode = theme.mode;
	});
	const api: UiThemeApi = {
		themes: computed(() =>
			[...themes].map(([id, { pluginId, theme }]) => ({
				id,
				pluginId,
				label: toValue(theme.label),
				mode: theme.mode,
				builtin: false,
			})),
		),
		state: computed(() => ({
			selectedThemeId: selected.value,
			activeThemeId: themes.has(preview.value ?? selected.value) ? (preview.value ?? selected.value) : '',
			previewThemeId: preview.value,
		})),

		async selectTheme(id) {
			if (id && !themes.has(id)) throw new CodedError<UiErrorCode>('UI_THEME_UNAVAILABLE');
			selected.value = id;
			preview.value = null;
		},

		previewTheme(id) {
			if (!themes.has(id)) throw new CodedError<UiErrorCode>('UI_THEME_UNAVAILABLE');
			preview.value = id;
		},

		cancelPreview() {
			preview.value = null;
		},
	};
	return {
		api,

		scope(pluginId: string): UiApi {
			return {
				registerTheme({ id: themeId, label, mode, tokens }) {
					if (closed) throw new CodedError<UiErrorCode>('UI_THEME_NOT_INSTALLED');
					const id = JSON.stringify([pluginId, themeId]);
					if (themes.has(id)) throw new CodedError<UiErrorCode>('UI_THEME_DUPLICATE');
					const snapshot = Object.freeze({ ...tokens });
					for (const [key, value] of Object.entries(snapshot))
						if (!key.startsWith('--ui-') || typeof value !== 'string')
							throw new CodedError<UiErrorCode>('UI_THEME_INVALID_TOKEN');
					const registration = { pluginId, theme: { id: themeId, label, mode, tokens: snapshot } };
					themes.set(id, registration);
					return () => {
						if (themes.get(id) === registration) {
							themes.delete(id);
							if (preview.value === id) preview.value = null;
						}
					};
				},
			};
		},

		close() {
			if (closed) return;
			closed = true;
			stop();
			release();
			themes.clear();
		},
	};
}

const themesKey: InjectionKey<ReturnType<typeof createUiThemes>> = Symbol('app.ui.themes');

/** 本体只装配一份主题状态，内置贡献与已安装插件共享，内部注册器不经 SDK 提供。 */
export function provideUiThemes(root: HTMLElement, selected: Ref<string>) {
	const themes = createUiThemes(root, selected);
	provide(themesKey, themes);
	onScopeDispose(themes.close);
	return themes;
}

export function useUiThemes() {
	const themes = inject(themesKey);
	if (!themes) throw new CodedError<UiErrorCode>('UI_THEME_NOT_INSTALLED');
	return themes;
}
