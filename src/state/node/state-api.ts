import { randomUUID } from 'node:crypto';
import { addAbortListener } from 'node:events';
import jsonPatch, { type Operation } from 'fast-json-patch';
import type { WebSocket } from 'ws';
import type { z } from 'zod';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import type { WsApi } from '../../ws/node/ws-api.js';
import {
	StateCommandSchema,
	StateTopicSchema,
	StateValueSchema,
	stateTopicKey,
	stateWebSocketPath,
	type StateCommand,
	type StateMessage,
	type StateTopic,
	type StateValue,
} from '../state-ws-types.js';
import {
	PluginState,
	type PluginStateApi,
	type StatePublisherApi,
	type StateRegistration,
} from './state-plugin-api.js';

export type { StatePublisherApi, StateRegistration } from './state-plugin-api.js';

interface RegisteredTopic {
	readonly topic: StateTopic;
	readonly instanceId: string;
	readonly signal: AbortSignal;
	readonly subscribers: Set<StateConnection>;
	state: StateValue;
	revision: number;
}

interface StateConnection {
	readonly socket: WebSocket;
	readonly topics: Set<RegisteredTopic>;
}

interface StateOptions {
	readonly services: { readonly ws: Pick<WsApi, 'register'> };
}

const maxBufferedBytes = 1024 * 1024;

function toStateValue(value: unknown): StateValue {
	// 先按 JSON 序列化规则处理可选字段，再保存独立快照用于 diff。
	const data = JSON.stringify(value);
	if (data === undefined) throw new CodedError('STATE_VALUE_INVALID');
	return StateValueSchema.parse(JSON.parse(data));
}

function diff(previous: StateValue, current: StateValue): Operation[] {
	if (previous === current) return [];
	if (
		previous !== null &&
		current !== null &&
		typeof previous === 'object' &&
		typeof current === 'object' &&
		Array.isArray(previous) === Array.isArray(current)
	) {
		const changes = jsonPatch.compare(previous, current);
		// 对 JSON Patch 客户端会拒绝的路径，直接替换根值。
		if (!changes.some(({ path }) => /\/(?:__proto__|constructor\/prototype)(?:\/|$)/u.test(path))) return changes;
	}
	return [{ op: 'replace', path: '', value: current }];
}

/** 在已登录连接上按主题同步快照和 RFC 6902 增量。 */
export class StateApi {
	readonly #ws: Pick<WsApi, 'register'>;
	readonly #controller = new AbortController();
	readonly #topics = new Map<string, RegisteredTopic>();
	#unregister: (() => Promise<void>) | undefined;

	constructor({ services: { ws } }: StateOptions) {
		this.#ws = ws;
	}

	initialize(signal: AbortSignal): void {
		this.#controller.signal.throwIfAborted();
		signal.throwIfAborted();
		this.#unregister ??= this.#ws.register({
			path: stateWebSocketPath,
			maxPayload: 4096,
			handler: this.#connect,
		});
	}

	register<Schema extends z.ZodType>(options: StateRegistration<Schema>): StatePublisherApi<z.input<Schema>> {
		return this.#register(options, this.#controller.signal);
	}

	bind(ownerId: string, scope: PluginScopeApi): PluginStateApi {
		const signal = AbortSignal.any([this.#controller.signal, scope.signal]);
		signal.throwIfAborted();
		return new PluginState((options) => this.#register(options, signal, ownerId));
	}

	async close(): Promise<void> {
		this.#controller.abort(new CodedError('STATE_CLOSED'));
		await this.#unregister?.();
	}

	#register<Schema extends z.ZodType>(
		{ name, schema, initial, lifetime }: StateRegistration<Schema>,
		parent: AbortSignal,
		pluginId?: string,
	): StatePublisherApi<z.input<Schema>> {
		// 主题只持有内存，取消时同步撤销，无需等待异步资源释放。
		const signal = lifetime ? AbortSignal.any([parent, lifetime.signal]) : parent;
		signal.throwIfAborted();
		const topic = StateTopicSchema.parse({ name, ...(pluginId === undefined ? {} : { pluginId }) });
		const key = stateTopicKey(topic);
		const initialState = toStateValue(schema.parse(initial));
		// 自定义 Schema 的转换可能执行插件代码，登记前复核作用域和主题归属。
		signal.throwIfAborted();
		if (this.#topics.has(key)) throw new CodedError('STATE_TOPIC_DUPLICATE');
		const entry: RegisteredTopic = {
			topic,
			instanceId: randomUUID(),
			signal,
			subscribers: new Set(),
			state: initialState,
			revision: 0,
		};
		this.#topics.set(key, entry);
		addAbortListener(signal, () => this.#revoke(key, entry));
		return {
			publish: (value) => {
				entry.signal.throwIfAborted();
				const state = toStateValue(schema.parse(value));
				entry.signal.throwIfAborted();
				this.#publish(entry, state);
			},
		};
	}

	#revoke(key: string, entry: RegisteredTopic): void {
		this.#topics.delete(key);
		const data = this.#unavailable(entry.topic);
		for (const connection of entry.subscribers) {
			connection.topics.delete(entry);
			this.#send(connection.socket, data);
		}
		entry.subscribers.clear();
	}

	readonly #connect: Parameters<WsApi['register']>[0]['handler'] = (socket, { signal }) => {
		signal.throwIfAborted();
		const connection: StateConnection = { socket, topics: new Set() };

		const abort = addAbortListener(signal, () => this.#disconnect(connection));

		socket.once('close', () => {
			abort[Symbol.dispose]();
			this.#disconnect(connection);
		});
		socket.on('message', (data, binary) => {
			if (signal.aborted || socket.readyState !== socket.OPEN) return;
			let command: StateCommand;
			try {
				command = StateCommandSchema.parse(binary ? null : JSON.parse(data.toString()));
			} catch {
				socket.close(1008, 'INVALID_MESSAGE');
				return;
			}
			this.#command(connection, command);
		});
	};

	#disconnect(connection: StateConnection): void {
		for (const entry of connection.topics) entry.subscribers.delete(connection);
		connection.topics.clear();
	}

	#command(connection: StateConnection, { type, topic }: StateCommand): void {
		const entry = this.#topics.get(stateTopicKey(topic));
		if (type === 'unsubscribe') {
			if (entry) {
				connection.topics.delete(entry);
				entry.subscribers.delete(connection);
			}
			return;
		}
		if (!entry) {
			this.#send(connection.socket, this.#unavailable(topic));
			return;
		}
		if (type === 'subscribe') {
			connection.topics.add(entry);
			entry.subscribers.add(connection);
		}
		const message: StateMessage = {
			type: 'snapshot',
			topic: entry.topic,
			instanceId: entry.instanceId,
			revision: entry.revision,
			state: entry.state,
		};
		this.#send(connection.socket, JSON.stringify(message));
	}

	#unavailable(topic: StateTopic): string {
		const message: StateMessage = { type: 'unavailable', topic, code: 'STATE_TOPIC_UNAVAILABLE' };
		return JSON.stringify(message);
	}

	#publish(entry: RegisteredTopic, state: StateValue): void {
		const changes = diff(entry.state, state);
		if (!changes.length) return;
		const baseRevision = entry.revision++;
		entry.state = state;
		const message: StateMessage = {
			type: 'patch',
			topic: entry.topic,
			instanceId: entry.instanceId,
			baseRevision,
			revision: entry.revision,
			changes,
		};
		const data = JSON.stringify(message);
		for (const { socket } of entry.subscribers) this.#send(socket, data);
	}

	#send(socket: WebSocket, data: string): void {
		if (socket.readyState !== socket.OPEN) return;
		if (socket.bufferedAmount > maxBufferedBytes) {
			socket.close(4002, 'SLOW_CONSUMER');
			return;
		}
		socket.send(data);
	}
}
