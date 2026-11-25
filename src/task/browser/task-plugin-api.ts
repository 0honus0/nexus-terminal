import { v4 as uuid } from 'uuid';
import type { LogApi } from '../../log/browser/log-api.js';
import type { PluginViewApi } from '../../plugin/browser/plugin-view-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';

export interface PluginTaskOptions {
	readonly name?: string;
	readonly signal?: AbortSignal;
	/** 普通关闭等待任务，强制关闭通过视图信号取消。 */
	readonly view?: PluginViewApi;
}

export interface PluginTaskEvent {
	readonly id: string;
	readonly name?: string;
	readonly startedAt: number;
	readonly durationMs?: number;
	readonly mode: 'run' | 'background';
	readonly outcome?: 'succeeded' | 'failed' | 'cancelled';
}

export interface PluginTasksApi {
	run<Result>(work: (signal: AbortSignal) => Result | Promise<Result>, options?: PluginTaskOptions): Promise<Result>;
	background(name: string, work: (signal: AbortSignal) => unknown, options?: Pick<PluginTaskOptions, 'signal'>): void;
	on(event: 'started' | 'settled', listener: (event: PluginTaskEvent) => void): () => void;
}

export class TaskService {
	readonly #log: Pick<LogApi, 'report'>;

	constructor(log: Pick<LogApi, 'report'>) {
		this.#log = log;
	}

	bind(pluginId: string, scope: PluginScopeApi): PluginTasksApi {
		const { signal } = scope;
		const log = this.#log;
		const listeners = {
			started: new Set<(event: PluginTaskEvent) => void>(),
			settled: new Set<(event: PluginTaskEvent) => void>(),
		};
		scope.onDispose(() => {
			listeners.started.clear();
			listeners.settled.clear();
		});

		function report(code: string, userVisible = false): void {
			if (!signal.aborted) log.report({ source: pluginId, pluginId, level: 'error', code, userVisible });
		}

		function publish(name: keyof typeof listeners, event: PluginTaskEvent): void {
			for (const listener of listeners[name])
				void Promise.resolve()
					.then(async () => {
						if (!signal.aborted && listeners[name].has(listener)) await listener(event);
					})
					.catch(() => report('PLUGIN_TASK_LISTENER_FAILED'));
		}

		async function execute<Result>(
			mode: PluginTaskEvent['mode'],
			work: (signal: AbortSignal) => Result | Promise<Result>,
			{ name, signal: external, view }: PluginTaskOptions = {},
		): Promise<Result> {
			const active = AbortSignal.any([signal, ...(external ? [external] : []), ...(view ? [view.signal] : [])]);
			active.throwIfAborted();
			const start = performance.now();
			const task = Object.freeze({ id: uuid(), name, mode, startedAt: Date.now() });
			let outcome: PluginTaskEvent['outcome'] = 'failed';
			const release = view?.onBeforeClose(async (event) => {
				try {
					await pending;
				} catch {
					if (!active.aborted && !event.signal.aborted) event.preventDefault();
				}
			});
			const pending = Promise.resolve().then(async () => {
				active.throwIfAborted();
				const result = await work(active);
				active.throwIfAborted();
				return result;
			});
			publish('started', task);
			try {
				const result = await pending;
				outcome = 'succeeded';
				return result;
			} finally {
				release?.();
				publish(
					'settled',
					Object.freeze({
						...task,
						durationMs: performance.now() - start,
						outcome: active.aborted ? 'cancelled' : outcome,
					}),
				);
			}
		}

		return Object.freeze<PluginTasksApi>({
			run: (work, options) => execute('run', work, options),

			background(name, work, options) {
				void execute(
					'background',
					async (active) => {
						try {
							await work(active);
						} catch (cause) {
							if (!active.aborted) report('PLUGIN_BACKGROUND_TASK_FAILED', true);
							throw cause;
						}
					},
					{ name, signal: options?.signal },
				).catch(() => undefined);
			},

			on(event, listener) {
				signal.throwIfAborted();
				listeners[event].add(listener);
				return () => {
					listeners[event].delete(listener);
				};
			},
		});
	}
}
