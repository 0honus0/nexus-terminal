import { computed, shallowReactive, shallowRef, toValue } from 'vue';
import type { LogApi } from '../../log/browser/log-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import type { WindowActionsOptions, WindowTabsOptions } from './window-plugin-api.js';

/** 分别维护一份标签登记和多组动作登记，执行前复核登记与条目仍然有效。 */
export class WindowChrome {
	readonly #scope: PluginScopeApi;
	readonly #log: Pick<LogApi, 'report'>;
	readonly #tabs = shallowRef<{ id: number; options: WindowTabsOptions }>();
	readonly #actions = shallowReactive(new Map<number, WindowActionsOptions>());
	readonly #pending = shallowReactive(new Set<string>());
	#sequence = 0;

	readonly tabs = computed(() => {
		const registration = this.#tabs.value;
		if (!registration) return;
		const { id, options } = registration;
		return {
			id,
			items: toValue(options.items),
			activeId: toValue(options.activeId),
			addLabel: toValue(options.addLabel),
		};
	});

	readonly actions = computed(() =>
		[...this.#actions].flatMap(([registration, options]) =>
			toValue(options.items).map((action) => ({
				registration,
				action,
				key: `${registration}:${action.id}`,
				busy: this.#pending.has(`${registration}:${action.id}`),
			})),
		),
	);

	constructor(scope: PluginScopeApi, log: Pick<LogApi, 'report'>) {
		this.#scope = scope;
		this.#log = log;
		scope.onDispose(() => {
			this.#tabs.value = undefined;
			this.#actions.clear();
			this.#pending.clear();
		});
	}

	registerTabs(options: WindowTabsOptions): () => void {
		this.#scope.signal.throwIfAborted();
		if (this.#tabs.value) throw new CodedError('WINDOW_TABS_ALREADY_REGISTERED');
		const registration = { id: ++this.#sequence, options };
		this.#tabs.value = registration;
		return () => {
			if (this.#tabs.value === registration) this.#tabs.value = undefined;
		};
	}

	registerActions(options: WindowActionsOptions): () => void {
		this.#scope.signal.throwIfAborted();
		const key = ++this.#sequence;
		this.#actions.set(key, options);
		return () => {
			this.#actions.delete(key);
		};
	}

	tab(registration: number, action: 'select' | 'close' | 'add' | 'menu', id?: string, menuId?: string): void {
		const current = this.#tabs.value;
		if (current?.id !== registration || this.#scope.signal.aborted) return;
		const { options } = current;
		const key = JSON.stringify(['tab', registration, action, id, menuId]);
		if (action === 'add') {
			if (options.onAdd && toValue(options.addLabel)) void this.#run(key, () => options.onAdd!());
			return;
		}
		const item = toValue(options.items).find((tab) => tab.id === id);
		if (!item || item.disabled) return;
		if (action === 'select') void this.#run(key, () => options.onSelect(item.id));
		if (action === 'close' && item.closable && options.onClose)
			void this.#run(key, () => options.onClose!(item.id));
		if (
			action === 'menu' &&
			menuId &&
			options.onMenuSelect &&
			item.menu?.some((entry) => entry.id === menuId && !entry.disabled)
		)
			void this.#run(key, () => options.onMenuSelect!(item.id, menuId));
	}

	action(registration: number, id: string, menuId?: string): void {
		const options = this.#actions.get(registration);
		const item = options && toValue(options.items).find((entry) => entry.id === id);
		if (!options || !item || item.disabled || this.#scope.signal.aborted) return;
		if (item.items ? !item.items.some((entry) => entry.id === menuId && !entry.disabled) : menuId !== undefined)
			return;
		void this.#run(`${registration}:${id}`, () => options.onSelect(id, menuId));
	}

	async #run(key: string, run: () => void | Promise<void>): Promise<void> {
		if (this.#pending.has(key)) return;
		this.#pending.add(key);
		try {
			await run();
		} catch {
			if (!this.#scope.signal.aborted)
				this.#log.report({ source: 'window', level: 'error', code: 'WINDOW_ACTION_FAILED' });
		} finally {
			this.#pending.delete(key);
		}
	}
}
