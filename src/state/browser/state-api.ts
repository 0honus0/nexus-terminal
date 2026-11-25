import { useWebSocket } from '@vueuse/core';
import jsonPatch from 'fast-json-patch';
import type { z } from 'zod';
import type { LogApi } from '../../log/browser/log-api.js';
import { CodedError } from '../../utils/error.js';
import {
	StateMessageSchema,
	StateTopicSchema,
	stateTopicKey,
	stateWebSocketPath,
	type StateCommand,
	type StateMessage,
	type StateTopic,
	type StateValue,
} from '../state-ws-types.js';

type Unconfirmed = 'disconnected' | 'unavailable' | 'resync';

interface StateObserver<Value> {
	updated(value: Value): void;
	unconfirmed(reason: Unconfirmed): void;
}

interface Cursor {
	readonly instanceId: string;
	readonly revision: number;
	readonly state: StateValue;
}

interface Subscription extends StateObserver<StateValue> {
	readonly topic: StateTopic;
	cursor?: Cursor;
	resyncing?: boolean;
	retry?: ReturnType<typeof setTimeout>;
}

interface StateOptions {
	readonly log: Pick<LogApi, 'report'>;
	readonly onSessionExpired: () => void;
}

/** 同一会话复用一条连接。每个主题独立校验快照、版本与 RFC 6902 补丁。 */
export class StateClient {
	readonly #subscriptions = new Map<string, Subscription>();
	readonly #transport;
	readonly #log: StateOptions['log'];
	#closed = false;

	constructor({ log, onSessionExpired }: StateOptions) {
		this.#log = log;
		const address = new URL(`/api${stateWebSocketPath}`, location.origin);
		address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
		this.#transport = useWebSocket(address.href, {
			immediate: false,
			autoConnect: false,
			autoClose: false,
			autoReconnect: { delay: (attempt) => Math.min(1000 * 2 ** Math.min(attempt - 1, 5), 30000) },

			onConnected: () => {
				for (const { topic } of this.#subscriptions.values()) this.#send('subscribe', topic);
			},

			onDisconnected: (_socket, event) => {
				if (this.#closed) return;
				if (event.code === 4001) {
					this.close();
					onSessionExpired();
					return;
				}
				for (const subscription of this.#subscriptions.values()) this.#invalidate(subscription, 'disconnected');
			},

			onError: () => this.#report('STATE_CONNECTION_FAILED'),

			onMessage: (_socket, event) => this.#message(event.data),
		});
	}

	subscribe<Schema extends z.ZodType>(
		topic: StateTopic,
		schema: Schema,
		observer: StateObserver<z.output<Schema>>,
	): () => void {
		if (this.#closed) throw new CodedError('STATE_CLIENT_CLOSED');
		const parsed = StateTopicSchema.parse(topic);
		const key = stateTopicKey(parsed);
		if (this.#subscriptions.has(key)) throw new CodedError('STATE_TOPIC_DUPLICATE');
		const subscription: Subscription = {
			topic: parsed,

			updated: (value) => observer.updated(schema.parse(value)),

			unconfirmed: (reason) => observer.unconfirmed(reason),
		};
		this.#subscriptions.set(key, subscription);
		this.#send('subscribe', parsed);
		return () => {
			if (this.#subscriptions.get(key) !== subscription) return;
			clearTimeout(subscription.retry);
			this.#subscriptions.delete(key);
			this.#send('unsubscribe', parsed);
		};
	}

	open(): void {
		if (this.#closed) throw new CodedError('STATE_CLIENT_CLOSED');
		if (this.#transport.status.value === 'CLOSED') this.#transport.open();
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const { retry } of this.#subscriptions.values()) clearTimeout(retry);
		this.#subscriptions.clear();
		this.#transport.close();
	}

	#message(data: unknown): void {
		if (this.#closed) return;
		let frame: StateMessage;
		try {
			frame = StateMessageSchema.parse(typeof data === 'string' ? JSON.parse(data) : undefined);
		} catch {
			this.#report('STATE_MESSAGE_INVALID');
			for (const subscription of this.#subscriptions.values()) this.#resync(subscription);
			return;
		}
		const subscription = this.#subscriptions.get(stateTopicKey(frame.topic));
		if (!subscription) return;
		if (frame.type === 'unavailable') {
			this.#invalidate(subscription, 'unavailable');
			// 内置主题可能晚于监听端口就绪。请求重新登记可在同一连接恢复该主题。
			this.#retry(subscription);
			return;
		}

		try {
			const last = subscription.cursor;
			if (frame.type === 'patch') {
				if (last?.instanceId === frame.instanceId && frame.revision <= last.revision) return;
				if (subscription.resyncing) return;
				if (
					!last ||
					frame.instanceId !== last.instanceId ||
					frame.baseRevision !== last.revision ||
					frame.revision !== last.revision + 1
				)
					throw new CodedError('STATE_VERSION_GAP');
			} else if (last?.instanceId === frame.instanceId && frame.revision < last.revision) return;

			const next =
				frame.type === 'snapshot'
					? frame.state
					: jsonPatch.applyPatch(last!.state, frame.changes, true, false, true).newDocument;
			subscription.updated(structuredClone(next));
			subscription.cursor = { instanceId: frame.instanceId, revision: frame.revision, state: next };
			subscription.resyncing = false;
			clearTimeout(subscription.retry);
		} catch {
			this.#report('STATE_TOPIC_SYNC_FAILED');
			if (subscription.resyncing && frame.type === 'snapshot') {
				// 无效重同步快照留待重新订阅，避免同步错误造成无限请求。
				this.#invalidate(subscription, 'resync');
				this.#retry(subscription);
			} else this.#resync(subscription);
		}
	}

	#resync(subscription: Subscription): void {
		if (subscription.resyncing || !this.#registered(subscription)) return;
		this.#invalidate(subscription, 'resync');
		if (!this.#registered(subscription)) return;
		subscription.resyncing = true;
		this.#send('resync', subscription.topic);
	}

	#registered(subscription: Subscription): boolean {
		return !this.#closed && this.#subscriptions.get(stateTopicKey(subscription.topic)) === subscription;
	}

	#retry(subscription: Subscription): void {
		if (!this.#registered(subscription)) return;
		clearTimeout(subscription.retry);
		subscription.retry = setTimeout(() => {
			if (this.#registered(subscription)) this.#send('subscribe', subscription.topic);
		}, 1000);
	}

	#invalidate(subscription: Subscription, reason: Unconfirmed): void {
		clearTimeout(subscription.retry);
		subscription.cursor = undefined;
		subscription.resyncing = false;
		subscription.unconfirmed(reason);
	}

	#send(type: StateCommand['type'], topic: StateTopic): void {
		// 断线期间不补发旧命令；重连按当前登记列表重新订阅。
		this.#transport.send(JSON.stringify({ type, topic }), false);
	}

	#report(code: string): void {
		if (!this.#closed) this.#log.report({ source: 'state', level: 'warn', code });
	}
}
