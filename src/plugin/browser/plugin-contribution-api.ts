import type { Component, MaybeRefOrGetter } from 'vue';
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

export interface PluginApplicationContribution extends Omit<PluginComponentContribution, 'component'> {
	readonly component: Component<PluginWindowProps> | Component<PluginComponentProps>;
	readonly multipleWindows?: boolean;
	readonly defaultWindowSize?: { readonly width: number; readonly height: number };
	readonly scrollMode?: 'content' | 'window';
	readonly scrollbarGutter?: 'auto' | 'stable';
}

export interface PluginContributions {
	readonly applications?: readonly PluginApplicationContribution[];
	readonly widgets?: readonly PluginComponentContribution[];
	readonly login?: readonly AuthLoginContribution[];
	readonly themes?: readonly UiTheme[];
}
