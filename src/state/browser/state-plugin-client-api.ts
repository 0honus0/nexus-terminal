import { effectScope, watch } from 'vue';
import { z } from 'zod';
import type { LogApi } from '../../log/browser/log-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import type { StateClient } from './state-api.js';
import { StateTopicSchema } from '../state-ws-types.js';

export type PluginStateUnconfirmed = 'disconnected' | 'unavailable' | 'resync' | 'invalid';

export interface PluginStateObserver<Value> {
	updated(value: Value): void;
	unconfirmed?(reason: PluginStateUnconfirmed): void;
}

export interface PluginStateClientApi {
	/** 在宿主的会话连接订阅本插件主题。每项订阅可单独撤销。 */
	subscribe<Schema extends z.ZodType>(
		name: string,
		schema: Schema,
		observer: PluginStateObserver<z.output<Schema>>,
		signal?: AbortSignal,
	): () => void;
}

type Status = { value: unknown } | { reason: PluginStateUnconfirmed };

interface Topic {
	current?: Status;
	readonly listeners: Set<(status: Status) => void>;
	close(): void;
}

export class StateClientService {
	readonly #client: () => Pick<StateClient, 'subscribe'> | undefined;
	readonly #log: Pick<LogApi, 'report'>;

	constructor(client: () => Pick<StateClient, 'subscribe'> | undefined, log: Pick<LogApi, 'report'>) {
		this.#client = client;
		this.#log = log;
	}

	bind(pluginId: string, scope: PluginScopeApi): PluginStateClientApi {
		const topics = new Map<string, Topic>();
		const service = this;
		return Object.freeze<PluginStateClientApi>({
			subscribe(name, schema, observer, signal) {
				const active = signal ? AbortSignal.any([signal, scope.signal]) : scope.signal;
				active.throwIfAborted();
				const identity = StateTopicSchema.parse({ pluginId, name });
				let topic = topics.get(name);
				if (!topic) {
					// 共享主题的生命周期属于所有订阅者，而非首次调用的组件。
					const topicScope = effectScope(true);
					const listeners = new Set<(status: Status) => void>();
					const entry: Topic = {
						listeners,

						close: () => topicScope.stop(),
					};

					function publish(status: Status): void {
						entry.current = status;
						for (const listener of [...listeners]) listener(status);
					}

					topicScope.run(() =>
						watch(
							service.#client,
							(client, _, onCleanup) => {
								if (scope.signal.aborted) return;
								publish({ reason: 'disconnected' });
								if (client)
									onCleanup(
										client.subscribe(identity, z.unknown(), {
											updated: (value) => publish({ value }),

											unconfirmed: (reason) => publish({ reason }),
										}),
									);
							},
							{ immediate: true },
						),
					);
					topics.set(name, entry);
					topic = entry;
				}
				const entry = topic;

				function listener(status: Status): void {
					if (active.aborted) return;
					try {
						if ('reason' in status) observer.unconfirmed?.(status.reason);
						else {
							// Zod 的 unknown/custom 可能按引用返回，观察者不能改写共享补丁基线。
							const parsed = schema.safeParse(structuredClone(status.value));
							if (parsed.success) observer.updated(parsed.data);
							else observer.unconfirmed?.('invalid');
						}
					} catch {
						service.#log.report({
							source: pluginId,
							pluginId,
							level: 'warn',
							code: 'PLUGIN_STATE_OBSERVER_FAILED',
						});
					}
				}

				function release(): void {
					if (!entry.listeners.delete(listener)) return;
					active.removeEventListener('abort', release);
					untrack();
					if (!entry.listeners.size) {
						entry.close();
						topics.delete(name);
					}
				}

				entry.listeners.add(listener);
				const untrack = scope.onDispose(release);
				active.addEventListener('abort', release, { once: true });
				if (active.aborted) release();
				else if (entry.current) listener(entry.current);
				return release;
			},
		});
	}
}
