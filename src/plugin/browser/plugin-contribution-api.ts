import { toValue, type Component, type MaybeRef, type MaybeRefOrGetter } from 'vue';
import type { AuthLoginContribution } from '../../auth/browser/auth-plugin-api.js';
import type { UiTheme } from '../../ui/browser/ui-theme-types.js';
import type { PluginContextApi } from '../plugin-api.browser.js';

import type { PluginWindowProps } from '../../window/browser/window-plugin-api.js';
import type { PluginViewApi } from './plugin-view-api.js';

export interface PluginComponentProps {
	readonly context: PluginContextApi;
	/** 每次组件挂载有独立的信号与资源清理，切换应用视图时仍保留插件实例。 */
	readonly view: PluginViewApi;
}

export interface PluginComponentContribution {
	/** 在当前插件的同类贡献内唯一。宿主负责附加插件身份。 */
	readonly id: string;
	readonly label: MaybeRefOrGetter<string>;
	readonly component: Component<PluginComponentProps>;
}

export interface PluginApplicationTileProps extends PluginComponentProps {
	readonly size: { readonly columns: number; readonly rows: number };
	open(): void;
}

export interface PluginApplicationTileContribution {
	readonly component: Component<PluginApplicationTileProps>;
	/** 默认在 1×1 显示宿主启动图标。 */
	readonly showAtIconSize?: boolean;
}

export interface PluginApplicationContribution extends Omit<PluginComponentContribution, 'component' | 'label'> {
	/** 函数形式可使用宿主当前语言。未提供语言时返回默认名称。 */
	readonly label: MaybeRef<string> | ((locale?: string) => string);
	readonly component: Component<PluginWindowProps> | Component<PluginComponentProps>;
	readonly multipleWindows?: boolean;
	readonly tile?: PluginApplicationTileContribution;
	readonly defaultWindowSize?: { readonly width: number; readonly height: number };
	readonly scrollMode?: 'content' | 'window';
	readonly scrollbarGutter?: 'auto' | 'stable';
}

/** 桌面、窗口和管理入口使用同一个贡献名称。 */
export function resolveApplicationLabel(label: PluginApplicationContribution['label'], locale: string): string {
	return typeof label === 'function' ? label(locale) : toValue(label);
}

export interface PluginContributions {
	readonly applications?: readonly PluginApplicationContribution[];
	readonly widgets?: readonly PluginComponentContribution[];
	readonly login?: readonly AuthLoginContribution[];
	readonly themes?: readonly UiTheme[];
}
