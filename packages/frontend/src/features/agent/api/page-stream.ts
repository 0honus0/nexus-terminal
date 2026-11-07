import { readAgentRunStreamCommand, readAgentStreamFrame } from '@nexus-terminal/shared/agent/runs/events';
import type { AgentStreamSource } from '@nexus-terminal/shared/agent/runs/events';
import {
	AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES,
	AGENT_RUN_STREAM_MAX_JSON_BYTES,
} from '@nexus-terminal/shared/agent/runs/values';
import { openWebSocket } from '@/client/websocket';
import { logger } from '@/client/logging/logger';
import { clearPendingNetworkFailure, reportNetworkFailure } from '@/client/http/network-failure';

export interface AgentPageStreamConsumer {
	source(): AgentStreamSource;
	/** Returning false retains this bounded page until resume; source cursors advance only after application. */
	apply(value: unknown, revision: number): boolean;
	rejected(code: 'forbidden' | 'resync_required' | 'unavailable' | 'protocol_failure'): void;
}

export interface AgentPageStreamSubscription {
	resume(): void;
	/** Discard unconsumed transport pages and reopen from the consumer's last applied cursor. */
	resubscribe(): void;
	close(): void;
}

interface Subscription {
	id: string;
	generation: number;
	revision: number;
	firstDeadline: ReturnType<typeof setTimeout> | undefined;
	retry: ReturnType<typeof setTimeout> | undefined;
	retryDelay: number;
	bytes: number;
	pending: Array<{ value: unknown; revision: number; bytes: number }>;
	consumer: AgentPageStreamConsumer;
}

/** The page owns reconnects and transport; consumers own scope, decoding and durable-source cursors. */
class AgentPageStream {
	private readonly subscriptions = new Map<string, Subscription>();
	private readonly networkSource = Symbol();
	private socket: WebSocket | null = null;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private deadline: ReturnType<typeof setTimeout> | undefined;
	private delay = 1000;
	private attached = false;
	private readonly browserConnection =
		'connection' in navigator && navigator.connection instanceof EventTarget ? navigator.connection : undefined;

	subscribe(consumer: AgentPageStreamConsumer): AgentPageStreamSubscription {
		const owner: Subscription = {
			id: crypto.randomUUID(),
			generation: 0,
			revision: 0,
			firstDeadline: undefined,
			retry: undefined,
			retryDelay: 1000,
			bytes: 0,
			pending: [],
			consumer,
		};
		this.subscriptions.set(owner.id, owner);
		if (!this.attached) {
			this.attached = true;
			window.addEventListener('online', this.networkChanged);
			window.addEventListener('offline', this.networkChanged);
			document.addEventListener('visibilitychange', this.visibilityChanged);
			this.browserConnection?.addEventListener('change', this.networkChanged);
		}
		if (this.socket?.readyState === WebSocket.OPEN) this.start(owner);
		else if (!this.socket && !this.retry) this.connect();
		return {
			resume: () => this.drain(owner),

			resubscribe: () => this.resubscribe(owner),

			close: () => this.remove(owner),
		};
	}

	private send(value: unknown): void {
		if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Agent stream disconnected');
		this.socket.send(JSON.stringify(readAgentRunStreamCommand(value)));
	}

	private start(owner: Subscription): void {
		if (this.subscriptions.get(owner.id) !== owner) return;
		if (owner.generation >= Number.MAX_SAFE_INTEGER) {
			this.reject(owner, 'protocol_failure');
			return;
		}
		let command;
		try {
			owner.generation++;
			command = readAgentRunStreamCommand({
				type: 'subscribe',
				subscriptionId: owner.id,
				generation: owner.generation,
				source: owner.consumer.source(),
			});
		} catch {
			this.reject(owner, 'protocol_failure');
			return;
		}
		clearTimeout(owner.firstDeadline);
		owner.firstDeadline = setTimeout(() => this.restart(owner), 45_000);
		owner.revision = 0;
		owner.bytes = 0;
		owner.pending.length = 0;
		try {
			this.send(command);
		} catch {
			this.reconnect();
		}
	}

	private drain(owner: Subscription): void {
		while (this.subscriptions.get(owner.id) === owner && owner.pending.length > 0) {
			const item = owner.pending[0];
			if (!item) return;
			try {
				if (!owner.consumer.apply(item.value, item.revision)) return;
			} catch {
				this.reject(owner, 'protocol_failure');
				return;
			}
			if (this.subscriptions.get(owner.id) !== owner) return;
			owner.pending.shift();
			owner.bytes -= item.bytes;
			try {
				this.send({
					type: 'ack',
					subscriptionId: owner.id,
					generation: owner.generation,
					revision: item.revision,
				});
			} catch {
				this.reconnect();
				return;
			}
		}
	}

	private reject(owner: Subscription, code: Parameters<AgentPageStreamConsumer['rejected']>[0]): void {
		this.remove(owner);
		try {
			owner.consumer.rejected(code);
		} catch {
			logger.error({ subscriptionId: owner.id, code }, 'Agent stream rejection callback failed');
		}
	}

	private remove(owner: Subscription): void {
		if (this.subscriptions.get(owner.id) !== owner) return;
		this.subscriptions.delete(owner.id);
		clearTimeout(owner.firstDeadline);
		clearTimeout(owner.retry);
		owner.pending.length = 0;
		owner.bytes = 0;
		if (this.socket?.readyState === WebSocket.OPEN) {
			try {
				this.send({ type: 'unsubscribe', subscriptionId: owner.id, generation: owner.generation });
			} catch {
				this.reconnect();
			}
		}
		if (this.subscriptions.size === 0) {
			this.stopSocket();
			clearPendingNetworkFailure(this.networkSource);
			window.removeEventListener('online', this.networkChanged);
			window.removeEventListener('offline', this.networkChanged);
			document.removeEventListener('visibilitychange', this.visibilityChanged);
			this.browserConnection?.removeEventListener('change', this.networkChanged);
			this.attached = false;
		}
	}

	private resubscribe(owner: Subscription): void {
		if (this.subscriptions.get(owner.id) !== owner) return;
		clearTimeout(owner.retry);
		owner.retry = undefined;
		if (this.socket?.readyState !== WebSocket.OPEN) {
			this.connect();
			return;
		}
		try {
			if (owner.generation > 0)
				this.send({ type: 'unsubscribe', subscriptionId: owner.id, generation: owner.generation });
		} catch {
			this.reconnect();
			return;
		}
		this.start(owner);
	}

	private restart(owner: Subscription): void {
		if (this.subscriptions.get(owner.id) !== owner) return;
		clearTimeout(owner.firstDeadline);
		clearTimeout(owner.retry);
		owner.pending.length = 0;
		owner.bytes = 0;
		if (this.socket?.readyState !== WebSocket.OPEN || document.hidden) return;
		try {
			this.send({ type: 'unsubscribe', subscriptionId: owner.id, generation: owner.generation });
		} catch {
			this.reconnect();
			return;
		}
		owner.retry = setTimeout(
			() => {
				owner.retry = undefined;
				if (this.subscriptions.get(owner.id) === owner && this.socket?.readyState === WebSocket.OPEN)
					this.start(owner);
			},
			owner.retryDelay + Math.floor(Math.random() * 250),
		);
		owner.retryDelay = Math.min(owner.retryDelay * 2, 30_000);
	}

	private stopSocket(): void {
		clearTimeout(this.retry);
		this.retry = undefined;
		clearTimeout(this.deadline);
		for (const owner of this.subscriptions.values()) {
			clearTimeout(owner.firstDeadline);
			clearTimeout(owner.retry);
			owner.retry = undefined;
		}
		const previous = this.socket;
		this.socket = null;
		if (previous) {
			previous.onopen = null;
			previous.onmessage = null;
			previous.onclose = null;
			previous.onerror = null;
			previous.close();
		}
	}

	private reconnect(): void {
		this.stopSocket();
		if (this.subscriptions.size === 0 || document.hidden) return;
		reportNetworkFailure(this.networkSource);
		logger.debug(
			{ subscriptions: this.subscriptions.size, retryDelayMs: this.delay },
			'Agent page stream reconnect scheduled',
		);
		this.retry = setTimeout(
			() => {
				this.retry = undefined;
				this.connect();
			},
			this.delay + Math.floor(Math.random() * 250),
		);
		this.delay = Math.min(this.delay * 2, 30_000);
	}

	private armDeadline(): void {
		clearTimeout(this.deadline);
		this.deadline = setTimeout(() => this.reconnect(), 45_000);
	}

	private connect(): void {
		this.stopSocket();
		if (this.subscriptions.size === 0 || document.hidden) return;
		let socket: WebSocket;
		try {
			socket = openWebSocket('/ws/agent-runs');
		} catch {
			this.reconnect();
			return;
		}
		this.socket = socket;
		this.armDeadline();
		socket.onopen = () => {
			if (this.socket !== socket) return;
			for (const owner of this.subscriptions.values()) {
				if (this.socket !== socket) break;
				this.start(owner);
			}
		};
		socket.onmessage = (message: MessageEvent<unknown>) => {
			if (this.socket !== socket) return;
			try {
				if (typeof message.data !== 'string') throw new Error('Invalid Agent frame');
				const bytes = new TextEncoder().encode(message.data).length;
				if (bytes > AGENT_RUN_STREAM_MAX_JSON_BYTES) throw new Error('Oversized Agent frame');
				const input: unknown = JSON.parse(message.data);
				const frame = readAgentStreamFrame(input);
				this.armDeadline();
				if (frame.type === 'heartbeat') return;
				const owner = this.subscriptions.get(frame.subscriptionId);
				if (!owner || owner.generation !== frame.generation) return;
				if (frame.type === 'rejected') {
					if (frame.code === 'unavailable') {
						this.restart(owner);
						return;
					}
					this.reject(owner, frame.code);
					return;
				}
				if (
					frame.revision !== owner.revision + 1 ||
					owner.pending.length >= AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES ||
					owner.bytes + bytes > AGENT_RUN_STREAM_MAX_JSON_BYTES
				) {
					this.reject(owner, 'protocol_failure');
					return;
				}
				clearTimeout(owner.firstDeadline);
				clearTimeout(owner.retry);
				owner.retry = undefined;
				owner.retryDelay = 1000;
				owner.revision = frame.revision;
				owner.bytes += bytes;
				owner.pending.push({ value: frame.value, revision: frame.revision, bytes });
				this.drain(owner);
				if (this.socket !== socket) return;
				this.delay = 1000;
				clearPendingNetworkFailure(this.networkSource);
			} catch {
				for (const owner of [...this.subscriptions.values()]) this.reject(owner, 'protocol_failure');
			}
		};
		socket.onclose = (event) => {
			if (this.socket !== socket) return;
			if (event.code === 1008) {
				for (const owner of [...this.subscriptions.values()]) this.reject(owner, 'forbidden');
			} else this.reconnect();
		};
		socket.onerror = () => {
			if (this.socket === socket) this.reconnect();
		};
	}

	private readonly networkChanged = (): void => {
		this.delay = 1000;
		this.connect();
	};

	private readonly visibilityChanged = (): void => {
		if (document.hidden) this.stopSocket();
		else this.connect();
	};
}

const pageStream = new AgentPageStream();

export function subscribeAgentPageStream(consumer: AgentPageStreamConsumer): AgentPageStreamSubscription {
	return pageStream.subscribe(consumer);
}
