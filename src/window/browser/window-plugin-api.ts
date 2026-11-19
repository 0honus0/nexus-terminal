import type { Component, ComputedRef, MaybeRefOrGetter } from 'vue';
import type { PluginComponentProps } from '../../plugin/browser/plugin-contribution-api.js';
import type { PluginViewApi } from '../../plugin/browser/plugin-view-api.js';
import type { UiMenuItem } from '../../ui/browser/ui-component-types.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';

export interface WindowTab {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly closable?: boolean;
	readonly menu?: readonly UiMenuItem[];
}

export interface WindowTabsOptions {
	readonly items: MaybeRefOrGetter<readonly WindowTab[]>;
	readonly activeId: MaybeRefOrGetter<string | undefined>;
	readonly addLabel?: MaybeRefOrGetter<string>;
	onSelect(id: string): void | Promise<void>;
	onClose?(id: string): void | Promise<void>;
	onAdd?(): void | Promise<void>;
	onMenuSelect?(id: string, menuId: string): void | Promise<void>;
}

export interface WindowAction {
	readonly id: string;
	readonly label: string;
	readonly icon?: Component;
	readonly disabled?: boolean;
	readonly items?: readonly UiMenuItem[];
}

export interface WindowActionsOptions {
	readonly items: MaybeRefOrGetter<readonly WindowAction[]>;
	onSelect(id: string, menuId?: string): void | Promise<void>;
}

export interface PluginWindowState {
	readonly focused: boolean;
	readonly mode: 'normal' | 'minimized' | 'maximized';
}

/** 本次应用窗口的操作和顶栏贡献，登记随窗口关闭撤销。 */
export interface PluginWindowApi extends PluginViewApi {
	readonly state: ComputedRef<PluginWindowState>;
	registerTabs(options: WindowTabsOptions): () => void;
	registerActions(options: WindowActionsOptions): () => void;
	focus(): void;
	minimize(): void;
	maximize(): void;
	restore(): void;
}

export interface PluginWindowProps extends PluginComponentProps {
	readonly view: PluginWindowApi;
}

export interface PluginWindowLauncherApi {
	/** 打开本插件的应用。单窗口应用已有实例时恢复并聚焦。 */
	open(applicationId: string): void;
}

/** 浏览器插件先取得作用域绑定，桌面挂载后交付真正的窗口入口。 */
export class WindowLauncher {
	#open: ((key: string) => boolean) | undefined;

	attach(open: (key: string) => boolean): () => void {
		this.#open = open;
		return () => {
			if (this.#open === open) this.#open = undefined;
		};
	}

	bind(pluginId: string, { signal }: PluginScopeApi): PluginWindowLauncherApi {
		return Object.freeze<PluginWindowLauncherApi>({
			open: (applicationId) => {
				signal.throwIfAborted();
				if (!this.#open?.(`${pluginId}:applications:${applicationId}`))
					throw new CodedError('PLUGIN_APPLICATION_UNAVAILABLE');
			},
		});
	}
}
