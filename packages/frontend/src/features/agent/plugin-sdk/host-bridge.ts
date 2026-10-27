import { agentRecord, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentPluginRpcEnvelope } from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import type {
	AgentPluginRpcEnvelope,
	AgentPluginRpcResponse,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { requestPluginFrontendRpc } from '../api/plugin-runtime-api';
import { AgentManagementFailure } from '../model/management-failure';
import type { PluginFrontendDescriptor } from '../model/plugin-types';

const maxInFlight = 32;

/** Owns the iframe MessagePort and forwards the current Shared protocol under one expiring grant. */
export class PluginFrontendHostBridge {
	private readonly nonce = crypto.randomUUID();
	private readonly pending = new Map<string, AbortController>();
	private port: MessagePort | null = null;
	private lastSequence = 0;
	private connected = false;
	private closed = false;
	private handshake: Promise<void> | null = null;
	private resolveHandshake: (() => void) | null = null;
	private rejectHandshake: ((cause: Error) => void) | null = null;
	private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
	private expiryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly iframe: HTMLIFrameElement,
		private readonly descriptor: PluginFrontendDescriptor,
		private readonly onClosed?: () => void,
	) {}

	start(): Promise<void> {
		if (this.closed) {
			return Promise.reject(new Error('Plugin bridge closed'));
		}
		if (this.handshake) {
			return this.handshake;
		}
		this.handshake = new Promise<void>((resolve, reject) => {
			this.resolveHandshake = resolve;
			this.rejectHandshake = reject;
		});
		window.addEventListener('message', this.onReady);
		this.handshakeTimer = setTimeout(() => this.close(), this.descriptor.requestTimeoutMs);
		this.expiryTimer = setTimeout(
			() => this.close(),
			Math.max(0, Math.min(2147483647, this.descriptor.expiresAt - Date.now())),
		);
		return this.handshake;
	}

	private readonly onReady = (event: MessageEvent<unknown>): void => {
		if (this.closed || event.source !== this.iframe.contentWindow) {
			return;
		}
		try {
			const row = agentRecord(event.data, ['type', 'protocol']);
			if (row.type !== 'nexus.plugin.ready' || row.protocol !== 1) {
				return;
			}
		} catch {
			return;
		}
		if (this.port) {
			this.close();
			return;
		}
		const channel = new MessageChannel();
		this.port = channel.port1;
		this.port.addEventListener('message', this.onMessage);
		this.port.addEventListener('messageerror', this.onMessageError);
		this.port.start();
		try {
			this.iframe.contentWindow?.postMessage(
				{ type: 'nexus.plugin.init', protocol: 1, nonce: this.nonce, appId: this.descriptor.appId },
				'*',
				[channel.port2],
			);
		} catch {
			channel.port2.close();
			this.close();
		}
	};

	private readonly onMessageError = (): void => {
		this.close();
	};

	private readonly onMessage = (event: MessageEvent<unknown>): void => {
		if (this.closed) {
			return;
		}
		if (!this.connected) {
			try {
				const row = agentRecord(event.data, ['type', 'protocol', 'nonce', 'seq']);
				if (
					row.type !== 'nexus.plugin.ack' ||
					row.protocol !== 1 ||
					row.nonce !== this.nonce ||
					row.seq !== 0
				) {
					throw new Error('Invalid plugin handshake');
				}
				this.connected = true;
				if (this.handshakeTimer) {
					clearTimeout(this.handshakeTimer);
					this.handshakeTimer = null;
				}
				this.resolveHandshake?.();
				this.resolveHandshake = null;
				this.rejectHandshake = null;
			} catch {
				this.close();
			}
			return;
		}
		let request: AgentPluginRpcEnvelope;
		try {
			encodeAgentJson(event.data, this.descriptor.maxMessageBytes);
			request = readAgentPluginRpcEnvelope(event.data);
			if (
				request.nonce !== this.nonce ||
				request.seq <= this.lastSequence ||
				this.pending.has(request.id) ||
				this.descriptor.expiresAt <= Date.now()
			) {
				throw new Error('Invalid plugin sequence or identity');
			}
			this.lastSequence = request.seq;
		} catch {
			this.close();
			return;
		}
		if (this.pending.size >= maxInFlight) {
			this.post(this.failure(request, 'limit_exceeded'));
			return;
		}
		const abort = new AbortController();
		this.pending.set(request.id, abort);
		void this.dispatch(request, abort);
	};

	private failure(
		request: AgentPluginRpcEnvelope,
		code: 'limit_exceeded' | 'invalid_input' | 'operation_unknown',
	): AgentPluginRpcResponse {
		return {
			type: 'nexus.plugin.response',
			protocol: 1,
			nonce: request.nonce,
			id: request.id,
			seq: request.seq,
			ok: false,
			error: { code },
		};
	}

	private async dispatch(request: AgentPluginRpcEnvelope, abort: AbortController): Promise<void> {
		try {
			const result = await requestPluginFrontendRpc(this.descriptor, request, abort.signal);
			if (!this.closed && !abort.signal.aborted && this.pending.get(request.id) === abort) {
				this.post(result);
			}
		} catch (cause) {
			if (!this.closed && !abort.signal.aborted && this.pending.get(request.id) === abort) {
				const failure = cause instanceof AgentManagementFailure ? cause : null;
				this.post(
					this.failure(
						request,
						failure?.outcome === 'not_dispatched' ? 'invalid_input' : 'operation_unknown',
					),
				);
			}
		} finally {
			if (this.pending.get(request.id) === abort) {
				this.pending.delete(request.id);
			}
		}
	}

	private post(value: AgentPluginRpcResponse): void {
		if (this.closed || !this.connected || this.descriptor.expiresAt <= Date.now()) {
			return;
		}
		try {
			encodeAgentJson(value, Math.min(this.descriptor.maxMessageBytes, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES));
			this.port?.postMessage(value);
		} catch {
			this.close();
		}
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		window.removeEventListener('message', this.onReady);
		if (this.handshakeTimer) {
			clearTimeout(this.handshakeTimer);
			this.handshakeTimer = null;
		}
		if (this.expiryTimer) {
			clearTimeout(this.expiryTimer);
			this.expiryTimer = null;
		}
		for (const abort of this.pending.values()) {
			abort.abort();
		}
		this.pending.clear();
		this.port?.removeEventListener('message', this.onMessage);
		this.port?.removeEventListener('messageerror', this.onMessageError);
		this.port?.close();
		this.port = null;
		this.rejectHandshake?.(new Error('Plugin bridge closed'));
		this.resolveHandshake = null;
		this.rejectHandshake = null;
		this.onClosed?.();
	}
}
