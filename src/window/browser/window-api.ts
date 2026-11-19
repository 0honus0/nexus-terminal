import { computed, shallowReactive, shallowRef, type Component } from 'vue';
import { useStorage } from '@vueuse/core';
import { z } from 'zod';
import { LayoutProfileSchema, resolveLayoutProfile } from '../../layout/layout-api.js';
import type { LogApi } from '../../log/browser/log-api.js';
import { PluginViewScope } from '../../plugin/browser/plugin-view-api.js';
import type { PluginComponentEntry } from '../../plugin/plugin-api.browser.js';

import { WindowChrome } from './window-chrome.js';
import type { PluginWindowApi, PluginWindowState } from './window-plugin-api.js';

export { default as WindowLayer } from './WindowLayer.vue';

const BoundsSchema = z.strictObject({
	x: z.number(),
	y: z.number(),
	width: z.number().positive(),
	height: z.number().positive(),
});

const PlacementsSchema = z.partialRecord(LayoutProfileSchema, z.record(z.string(), BoundsSchema));

export type WindowBounds = z.infer<typeof BoundsSchema>;

export interface WindowApplication {
	readonly key: string;
	readonly label: () => string;
	readonly icon?: Component;
	readonly color?: string;
	readonly plugin?: PluginComponentEntry;
	readonly multipleWindows?: boolean;
	readonly size?: Pick<WindowBounds, 'width' | 'height'>;
	readonly scrollMode?: 'content' | 'window';
	readonly scrollbarGutter?: 'auto' | 'stable';
}

export interface DesktopWindow {
	readonly id: number;
	readonly application: WindowApplication;
	readonly view?: PluginViewScope;
	readonly chrome?: WindowChrome;
	readonly pluginApi?: PluginWindowApi;
	readonly launcher?: HTMLElement;
	bounds: WindowBounds;
	minimized: boolean;
	maximized: boolean;
	closing: boolean;
	stack: number;
}

/** 位置和尺寸属于应用及布局分档，焦点和窗口实例只属于当前会话。 */
export class WindowApi {
	readonly #log: Pick<LogApi, 'report'>;
	readonly #items = shallowRef<readonly DesktopWindow[]>([]);
	readonly items = computed(() => this.#items.value);
	readonly #viewport = shallowRef({ width: 0, height: 0 });
	readonly profile = computed(() => resolveLayoutProfile(this.#viewport.value.width));
	readonly #positions;
	#nextId = 0;
	#nextStack = 0;
	#closed = false;
	readonly active = computed(() =>
		this.#items.value.reduce<DesktopWindow | undefined>(
			(top, item) => (!item.minimized && !item.closing && (!top || item.stack > top.stack) ? item : top),
			undefined,
		),
	);

	constructor(log: Pick<LogApi, 'report'>) {
		this.#log = log;
		this.#positions = useStorage('nexus.windows.bounds', {} as z.infer<typeof PlacementsSchema>, undefined, {
			writeDefaults: false,
			listenToStorageChanges: false,
			serializer: {
				read: (raw) => PlacementsSchema.parse(JSON.parse(raw)),

				write: JSON.stringify,
			},

			onError: () => this.#report('WINDOW_STORAGE_UNAVAILABLE', 'warn'),
		});
	}

	resize(width: number, height: number): void {
		if (width <= 0 || height <= 0) return;
		const previous = this.profile.value;
		this.#viewport.value = { width, height };
		if (this.profile.value !== previous) {
			for (const item of this.#items.value) item.bounds = this.#initialBounds(item.application);
		}
	}

	toggle(application: WindowApplication, launcher?: HTMLElement): void {
		const existing = this.#items.value.findLast(
			(item) => item.application.key === application.key && !item.closing,
		);
		if (!existing) this.open(application, launcher);
		else if (this.active.value === existing) existing.minimized = true;
		else this.focus(existing);
	}

	open(application: WindowApplication, launcher?: HTMLElement): void {
		if (this.#closed || application.plugin?.lifetime.signal.aborted) return;
		if (!application.multipleWindows) {
			const existing = this.#items.value.find(
				(item) => item.application.key === application.key && !item.closing,
			);
			if (existing) return this.focus(existing);
			// 快速重开时先移除已退出输入的旧窗口，避免同一个应用出现两套可见内容。
			this.#items.value = this.#items.value.filter((item) => item.application.key !== application.key);
		}
		const view =
			application.plugin &&
			new PluginViewScope(application.plugin, this.#log, (forced) => {
				this.#dismiss(item, forced);
			});
		const chrome = view && new WindowChrome(view.api, this.#log);
		const pluginApi: PluginWindowApi | undefined =
			view &&
			chrome &&
			Object.freeze({
				...view.api,
				state: computed<PluginWindowState>(() => ({
					focused: this.active.value === item,
					mode: item.minimized ? 'minimized' : item.maximized ? 'maximized' : 'normal',
				})),
				registerTabs: chrome.registerTabs.bind(chrome),
				registerActions: chrome.registerActions.bind(chrome),

				focus: () => {
					if (!view.signal.aborted) this.focus(item);
				},

				minimize: () => {
					if (!view.signal.aborted) item.minimized = true;
				},

				maximize: () => {
					if (view.signal.aborted) return;
					item.maximized = true;
					this.focus(item);
				},

				restore: () => {
					if (view.signal.aborted) return;
					item.maximized = false;
					this.focus(item);
				},
			});
		const item = shallowReactive<DesktopWindow>({
			id: ++this.#nextId,
			application,
			view,
			chrome,
			pluginApi,
			launcher,
			bounds: this.#initialBounds(application),
			minimized: false,
			maximized: false,
			closing: false,
			stack: ++this.#nextStack,
		});
		this.#items.value = [...this.#items.value, item];
	}

	focus(item: DesktopWindow): void {
		if (item.closing) return;
		item.minimized = false;
		item.stack = ++this.#nextStack;
	}

	requestClose(item: DesktopWindow): void {
		if (item.closing) return;
		if (item.view) void item.view.requestClose().catch(() => this.#report('WINDOW_CLOSE_FAILED', 'error'));
		else this.#dismiss(item, false);
	}

	finishExit(item: DesktopWindow): void {
		if (item.closing) this.#dismiss(item, true);
	}

	visibleBounds(item: DesktopWindow): WindowBounds {
		const { width, height } = this.#viewport.value;
		if (item.maximized || this.profile.value === 'compact') return { x: 0, y: 0, width, height };
		return this.#fit(item.bounds);
	}

	updateBounds(item: DesktopWindow, bounds: WindowBounds): void {
		if (!item.closing && !item.maximized && this.profile.value !== 'compact') item.bounds = this.#fit(bounds);
	}

	/** 只有明确的移动或缩放提交；视口投影、焦点与关闭不会重写存储。 */
	saveBounds(item: DesktopWindow): void {
		if (item.closing || item.maximized || this.profile.value === 'compact') return;
		const profile = this.profile.value;
		this.#positions.value = {
			...this.#positions.value,
			[profile]: { ...this.#positions.value[profile], [item.application.key]: { ...item.bounds } },
		};
	}

	close(): void {
		this.#closed = true;
		for (const item of this.#items.value) {
			if (item.view) void item.view.close().catch(() => this.#report('WINDOW_CLOSE_FAILED', 'error'));
		}
		this.#items.value = [];
	}

	#dismiss(item: DesktopWindow, forced: boolean): void {
		if (!forced && !item.minimized) item.closing = true;
		else this.#items.value = this.#items.value.filter((current) => current !== item);
	}

	#initialBounds(application: WindowApplication): WindowBounds {
		const saved = this.#positions.value[this.profile.value]?.[application.key];
		const offset = (this.#items.value.length % 6) * 26;
		return (
			saved ?? {
				x: 70 + offset,
				y: 24 + offset,
				width: application.size?.width ?? 880,
				height: application.size?.height ?? 600,
			}
		);
	}

	#fit(bounds: WindowBounds): WindowBounds {
		const viewport = this.#viewport.value;
		const width = Math.min(viewport.width, Math.max(320, bounds.width));
		const height = Math.min(viewport.height, Math.max(240, bounds.height));
		return {
			width,
			height,
			x: Math.min(viewport.width - width, Math.max(0, bounds.x)),
			y: Math.min(viewport.height - height, Math.max(0, bounds.y)),
		};
	}

	#report(code: string, level: 'warn' | 'error'): void {
		this.#log.report({ source: 'window', code, level, userVisible: level === 'error' });
	}
}
