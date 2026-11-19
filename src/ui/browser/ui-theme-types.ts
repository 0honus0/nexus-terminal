import type { MaybeRefOrGetter } from 'vue';

export type UiThemeMode = 'light' | 'dark';

/**
 * 开放的主题变量覆盖表；空对象合法，不要求主题重复提供所有内置默认值。
 * 内置 UI 使用的 --ui-* 变量默认允许主题覆盖，新增变量不需要修改本类型或登记清单。
 * 通用变量使用 --ui-primary 等语义名称；组件变量使用 --ui-button-background 等组件前缀。
 * 值为单个 CSS 自定义属性的值，例如颜色、阴影、字体或 var(...)，不传选择器和整段样式表。
 * 未覆盖的变量沿用相同 mode 的内置默认值；组件变量可通过 var(...) 引用通用变量。
 * 主题只覆盖外观，不替换组件结构、交互或业务逻辑，也不公开内部 DOM 和 CSS 类名。
 */
export type UiThemeTokens = Readonly<Record<`--ui-${string}`, string>>;

export interface UiTheme {
	/** 当前注册表内唯一标识；命名空间及提供方身份由上层装配，不在基础 UI 中推断。 */
	readonly id: string;
	/** 随本体语言响应式变化，不由主题维护第二套语言设置。 */
	readonly label: MaybeRefOrGetter<string>;
	/** 决定未覆盖变量使用哪套内置默认值。 */
	readonly mode: UiThemeMode;
	/** 仅提供本主题需要改变的变量；内置组件 CSS 由 UI 自身统一维护和导出。 */
	readonly tokens: UiThemeTokens;
}

export type UiRemoveRegistration = () => void;

/** 本体管理页面使用的主题信息，不向普通插件开放主题选择管理权限。 */
export interface AppUiThemeInfo {
	/** 宿主生成的完整标识，不与插件内 id 混用。 */
	readonly id: string;
	/** 内置项为 null，普通项为所属插件包名。 */
	readonly pluginId: string | null;
	readonly label: string;
	readonly mode: UiThemeMode;
	readonly builtin: boolean;
}

export interface AppUiState {
	/** 已保存的选择；插件尚未加载或暂时不可用时保留，便于恢复。 */
	readonly selectedThemeId: string;
	/** 当前实际样式，预览或回退时可能与已保存选择不同。 */
	readonly activeThemeId: string;
	/** 没有预览时为 null；预览不写入持久化选择。 */
	readonly previewThemeId: string | null;
}
