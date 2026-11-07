import { pendingPluginConfiguration, savePluginConfiguration } from '../api/plugin-configuration-writes';
import { fromPluginConfiguration } from '../model/plugin-instance-mapper';
import { logger } from '@/client/logging/logger';
import { agentRecord, encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http-codec';
import { subscribeAgentPageStream } from '../../api/page-stream';
import type { PluginFrontendUiBridge } from './ui-bridge-types';
import {
	readAgentPluginStreamCommand,
	readAgentPluginControl,
	readAgentPluginRpcEnvelope,
} from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import type {
	AgentPluginRpcEnvelope,
	AgentPluginRpcResponse,
	AgentPluginStreamEvent,
	AgentPluginCancelled,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { requestPluginFrontendRpc } from './plugin-runtime-api';
import { AgentManagementFailure } from '../../model/management-failure';
import type { PluginFrontendDescriptor } from './plugin-runtime-types';

interface PluginStreamSubscription {
	generation: number;
	runId: string;
	after: number;
	revision: number;
	pending: number | null;
	nextCursor: number;
	expiry: ReturnType<typeof setTimeout> | undefined;
	transport: { resume(): void; close(): void };
}

/** Owns the iframe MessagePort and forwards the current Shared protocol under one expiring grant. */
export class PluginFrontendHostBridge {
	private readonly nonce = crypto.randomUUID();
	private readonly pending = new Map<string, AbortController>();
	private port: MessagePort | null = null;
	private readonly streams = new Map<string, PluginStreamSubscription>();
	private lastSequence = 0;
	private connected = false;
	private closed = false;
	private handshake: Promise<void> | null = null;
	private resolveHandshake: (() => void) | null = null;
	private rejectHandshake: ((cause: Error) => void) | null = null;
	private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
	private expiryTimer: ReturnType<typeof setTimeout> | null = null;
	private closePromise: Promise<void> | null = null;
	private readonly tasks = new Set<Promise<void>>();
	private readonly failures: unknown[] = [];

	constructor(
		private readonly iframe: HTMLIFrameElement,
		private readonly descriptor: PluginFrontendDescriptor,
		private readonly onClosed?: () => void,
		private readonly uiBridge?: PluginFrontendUiBridge,
		private readonly onSettingsWrite?: () => void,
	) {
		this.uiBridge?.setFailureHandler((error) => this.fail(error));
	}

	private recordFailure(error: unknown): void {
		if (this.failures.includes(error)) return;
		this.failures.push(error);
		logger.error({ appId: this.descriptor.appId, err: error }, 'Plugin frontend bridge failed');
	}

	private fail(error: unknown): void {
		this.recordFailure(error);
		void this.close();
	}

	private track(task: Promise<void>): void {
		this.tasks.add(task);
		void task.then(
			() => {
				this.tasks.delete(task);
			},
			(error: unknown) => {
				this.tasks.delete(task);
				this.fail(error);
			},
		);
	}

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
			if (row.type !== 'nexus.plugin.ready' || row.protocol !== 4) {
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
				{
					type: 'nexus.plugin.init',
					protocol: 4,
					nonce: this.nonce,
					appId: this.descriptor.appId,
					expiresAt: this.descriptor.expiresAt,
				},
				'*',
				[channel.port2],
			);
		} catch (error) {
			try {
				channel.port2.close();
			} catch (cause) {
				this.recordFailure(cause);
			}
			this.fail(error);
		}
	};

	private readonly onMessageError = (): void => {
		this.close();
	};

	private readonly onMessage = (event: MessageEvent<unknown>): void => {
		if (this.closed) {
			return;
		}
		if (this.descriptor.expiresAt <= Date.now()) {
			void this.close();
			return;
		}
		if (!this.connected) {
			try {
				const row = agentRecord(event.data, ['type', 'protocol', 'nonce', 'seq']);
				if (
					row.type !== 'nexus.plugin.ack' ||
					row.protocol !== 4 ||
					row.nonce !== this.nonce ||
					row.seq !== 0
				) {
					throw new Error('Invalid plugin handshake');
				}
				this.connected = true;
				if (this.port) this.uiBridge?.connect(this.port);
				if (this.handshakeTimer) {
					clearTimeout(this.handshakeTimer);
					this.handshakeTimer = null;
				}
				this.resolveHandshake?.();
				this.resolveHandshake = null;
				this.rejectHandshake = null;
			} catch (error) {
				this.fail(error);
			}
			return;
		}
		try {
			if (this.port && this.uiBridge?.handle(event.data, this.port)) return;
		} catch (error) {
			this.fail(error);
			return;
		}
		if (
			event.data !== null &&
			typeof event.data === 'object' &&
			'type' in event.data &&
			event.data.type === 'nexus.plugin.stream'
		) {
			this.streamMessage(event.data);
			return;
		}

		if (
			event.data !== null &&
			typeof event.data === 'object' &&
			'type' in event.data &&
			(event.data.type === 'nexus.plugin.cancel' || event.data.type === 'nexus.plugin.close')
		) {
			try {
				const command = readAgentPluginControl(event.data);
				if (
					command.nonce !== this.nonce ||
					command.seq <= this.lastSequence ||
					this.descriptor.expiresAt <= Date.now()
				)
					throw new Error('Invalid plugin control identity');
				this.lastSequence = command.seq;
				if (command.type === 'nexus.plugin.close') this.close();
				else this.pending.get(command.id)?.abort();
			} catch (error) {
				this.fail(error);
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
		} catch (error) {
			this.fail(error);
			return;
		}
		const abort = new AbortController();
		this.pending.set(request.id, abort);
		this.track(this.dispatch(request, abort));
	};

	private streamMessage(input: unknown): void {
		try {
			if (this.descriptor.purpose !== 'app') {
				throw new Error('Surface cannot subscribe to Run events');
			}
			encodeAgentJson(input, this.descriptor.maxMessageBytes);
			const command = readAgentPluginStreamCommand(input);
			if (
				command.nonce !== this.nonce ||
				command.seq <= this.lastSequence ||
				this.descriptor.expiresAt <= Date.now()
			) {
				throw new Error('Invalid plugin stream identity');
			}
			this.lastSequence = command.seq;
			const previous = this.streams.get(command.subscriptionId);
			if (command.command !== 'subscribe') {
				if (!previous || previous.generation !== command.generation) return;
				if (command.command === 'unsubscribe') {
					this.stopStream(command.subscriptionId);
					return;
				}
				if (previous.pending !== command.revision) throw new Error('Invalid plugin stream ACK');
				clearTimeout(previous.expiry);
				previous.expiry = undefined;
				previous.after = previous.nextCursor;
				previous.pending = null;
				previous.transport.resume();
				return;
			}
			if (previous && previous.generation >= command.generation)
				throw new Error('Invalid plugin stream generation');
			this.stopStream(command.subscriptionId);
			const owner: PluginStreamSubscription = {
				generation: command.generation,
				runId: command.source.runId,
				after: command.source.after,
				revision: 0,
				pending: null,
				nextCursor: command.source.after,
				expiry: undefined,
				transport: {
					resume() {},

					close() {},
				},
			};
			this.streams.set(command.subscriptionId, owner);

			const fail = (code: 'forbidden' | 'provider_unavailable' | 'not_found') => {
				if (this.streams.get(command.subscriptionId) !== owner) return;
				this.post({
					type: 'nexus.plugin.stream-event',
					protocol: 4,
					nonce: this.nonce,
					subscriptionId: command.subscriptionId,
					generation: owner.generation,
					ok: false,
					error: { code },
				});
				this.stopStream(command.subscriptionId);
			};

			owner.transport = subscribeAgentPageStream({
				source: () => ({
					kind: 'run-events',
					appId: this.descriptor.appId,
					grant: this.descriptor.grant,
					runId: owner.runId,
					after: owner.after,
				}),

				apply: (input) => {
					if (this.streams.get(command.subscriptionId) !== owner || this.closed) return false;
					if (owner.pending !== null) return false;
					const value = readAgentRunEventsResponse(input);
					if (value.items.some((event) => event.runId !== owner.runId))
						throw new Error('Invalid plugin Run scope');
					// A reconnect can replay the page retained for a still-running iframe callback.
					if (value.items.length > 0 && value.nextCursor <= owner.after) return true;
					if (
						value.items.some((event) => event.sequence <= owner.after) ||
						(value.items.length === 0 && value.nextCursor !== owner.after)
					)
						throw new Error('Invalid plugin source cursor');
					if (owner.revision >= Number.MAX_SAFE_INTEGER) throw new Error('Plugin stream sequence exhausted');
					owner.revision++;
					owner.pending = owner.revision;
					owner.nextCursor = value.nextCursor;
					this.post({
						type: 'nexus.plugin.stream-event',
						protocol: 4,
						nonce: this.nonce,
						subscriptionId: command.subscriptionId,
						generation: owner.generation,
						ok: true,
						revision: owner.revision,
						value,
					});
					owner.expiry = setTimeout(() => fail('provider_unavailable'), 60_000);
					return true;
				},

				rejected: (code) =>
					fail(
						code === 'forbidden'
							? 'forbidden'
							: code === 'resync_required'
								? 'not_found'
								: 'provider_unavailable',
					),
			});
		} catch (error) {
			this.fail(error);
		}
	}

	private stopStream(id: string): void {
		const owner = this.streams.get(id);
		if (!owner) return;
		this.streams.delete(id);
		clearTimeout(owner.expiry);
		owner.transport.close();
	}

	private failure(
		request: AgentPluginRpcEnvelope,
		code: 'limit_exceeded' | 'invalid_input' | 'operation_unknown' | 'forbidden',
	): AgentPluginRpcResponse {
		return {
			type: 'nexus.plugin.response',
			protocol: 4,
			nonce: request.nonce,
			id: request.id,
			seq: request.seq,
			ok: false,
			error: { code },
		};
	}

	private async invoke(request: AgentPluginRpcEnvelope, signal: AbortSignal): Promise<AgentPluginRpcResponse> {
		if (this.descriptor.purpose !== 'settings' || request.request.method !== 'settings.write') {
			return requestPluginFrontendRpc(this.descriptor, request, signal);
		}
		const command = request.request.params;
		try {
			const result = await savePluginConfiguration(
				this.descriptor.appId,
				this.descriptor.instanceId,
				{
					operationKey: command.operationKey,
					expectedPackageRevision: command.expectedPackageRevision,
					expectedRevision: command.expectedRevision,
					schemaRevision: command.schemaRevision,
					documentJson: command.documentJson,
				},
				async (_original, ownerSignal) => {
					// The session owns the original intent even when this iframe closes before its reply.
					const response = await requestPluginFrontendRpc(this.descriptor, request, ownerSignal);
					if (!response.ok) {
						const code = response.error.code;
						throw new AgentManagementFailure(
							code,
							code === 'operation_unknown' ||
								code === 'storage_unavailable' ||
								code === 'internal_failure'
								? 'unknown'
								: 'not_dispatched',
						);
					}
					if (
						response.result.method !== 'settings.write' ||
						response.result.value.instanceId !== this.descriptor.instanceId ||
						response.result.value.revision !== command.expectedRevision + 1 ||
						response.result.value.schemaRevision !== command.schemaRevision
					) {
						throw new AgentManagementFailure('protocol_failure', 'unknown');
					}
					return fromPluginConfiguration(response.result.value);
				},
			);
			return {
				type: 'nexus.plugin.response',
				protocol: 4,
				nonce: request.nonce,
				id: request.id,
				seq: request.seq,
				ok: true,
				result: {
					method: 'settings.write',
					value: {
						instanceId: result.instanceId,
						packageId: result.packageId,
						revision: result.revision,
						schemaRevision: result.schemaRevision,
						documentJson: result.documentJson,
					},
				},
			};
		} finally {
			if (pendingPluginConfiguration(this.descriptor.appId, this.descriptor.instanceId) !== null) {
				this.onSettingsWrite?.();
			}
		}
	}

	private async dispatch(request: AgentPluginRpcEnvelope, abort: AbortController): Promise<void> {
		let dispatched = false;
		try {
			if (
				this.descriptor.purpose === 'settings' &&
				request.request.method !== 'settings.read' &&
				request.request.method !== 'settings.write'
			) {
				this.post(this.failure(request, 'forbidden'));
				return;
			}
			const authorized = await this.uiBridge?.authorize?.(request.request, abort.signal);
			if (this.closed || abort.signal.aborted || this.pending.get(request.id) !== abort) return;
			if (authorized === false) {
				this.post({
					type: 'nexus.plugin.cancelled',
					protocol: 4,
					nonce: request.nonce,
					id: request.id,
					seq: request.seq,
				});
				return;
			}
			dispatched = true;
			const result = await this.invoke(request, abort.signal);
			if (result.ok && (result.result.method === 'settings.read' || result.result.method === 'settings.write')) {
				const instanceId =
					result.result.method === 'settings.read'
						? result.result.value.instance.id
						: result.result.value.instanceId;
				if (instanceId !== this.descriptor.instanceId) {
					throw new Error('Settings response belongs to another instance');
				}
			}
			if (!this.closed && !abort.signal.aborted && this.pending.get(request.id) === abort) {
				this.post(result);
			}
		} catch (cause) {
			if (!(cause instanceof AgentManagementFailure)) this.recordFailure(cause);
			if (!this.closed && !abort.signal.aborted && this.pending.get(request.id) === abort) {
				const failure = cause instanceof AgentManagementFailure ? cause : null;
				this.post(
					this.failure(
						request,
						!dispatched || failure?.outcome === 'not_dispatched' ? 'invalid_input' : 'operation_unknown',
					),
				);
			}
		} finally {
			if (this.pending.get(request.id) === abort) {
				this.pending.delete(request.id);
			}
		}
	}

	private post(value: AgentPluginRpcResponse | AgentPluginStreamEvent | AgentPluginCancelled): void {
		if (this.closed || !this.connected || this.descriptor.expiresAt <= Date.now()) {
			return;
		}
		try {
			encodeAgentJson(value, Math.min(this.descriptor.maxMessageBytes, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES));
			this.port?.postMessage(value);
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		const tasks = [...this.tasks];
		this.closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled(tasks);
			if (this.failures.length)
				throw new AggregateError(this.failures.slice(), 'Plugin frontend bridge failed to close');
		});
		void this.closePromise.catch((error: unknown) => {
			logger.error({ appId: this.descriptor.appId, err: error }, 'Plugin frontend close failed');
		});
		this.closed = true;

		const cleanup = (work: () => void) => {
			try {
				work();
			} catch (error) {
				this.recordFailure(error);
			}
		};

		for (const id of this.streams.keys()) cleanup(() => this.stopStream(id));
		cleanup(() => {
			const task = this.uiBridge?.close();
			if (task)
				tasks.push(
					task.catch((error: unknown) => {
						this.recordFailure(error);
					}),
				);
		});
		cleanup(() => window.removeEventListener('message', this.onReady));
		if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
		this.handshakeTimer = null;
		if (this.expiryTimer) clearTimeout(this.expiryTimer);
		this.expiryTimer = null;
		for (const abort of this.pending.values()) cleanup(() => abort.abort());
		this.pending.clear();
		cleanup(() => this.port?.removeEventListener('message', this.onMessage));
		cleanup(() => this.port?.removeEventListener('messageerror', this.onMessageError));
		cleanup(() => this.port?.close());
		this.port = null;
		cleanup(() => this.rejectHandshake?.(new Error('Plugin bridge closed')));
		this.resolveHandshake = null;
		this.rejectHandshake = null;
		cleanup(() => this.onClosed?.());
		return this.closePromise;
	}
}
