import { createPluginUiClient } from './ui-client.js';
interface PluginMessageEvent {
	data: unknown;
	source?: unknown;
	ports: PluginMessagePort[];
}

interface PluginMessagePort {
	postMessage(value: unknown): void;
	start(): void;
	close(): void;
	addEventListener(type: string, listener: (event: PluginMessageEvent) => void): void;
	removeEventListener(type: string, listener: (event: PluginMessageEvent) => void): void;
}

declare const window: {
	parent: { postMessage(value: unknown, targetOrigin: string): void };
	addEventListener(type: string, listener: (event: PluginMessageEvent) => void, options?: { once: boolean }): void;
	removeEventListener(type: string, listener: (event: PluginMessageEvent) => void): void;
};

import { encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { AgentPluginFrontendModule } from '@nexus-terminal/shared/agent/plugins/frontend-sdk';
import { AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentHttpErrorCode } from '@nexus-terminal/shared/agent/values';
import {
	readAgentPluginInit,
	readAgentPluginControl,
	readAgentPluginCancelled,
	readAgentPluginStreamCommand,
	readAgentPluginStreamEvent,
	readAgentPluginFrontendInput,
	readAgentPluginRpcResponse,
} from '@nexus-terminal/shared/agent/plugins/frontend-rpc-codec';
import {
	AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
	AGENT_PLUGIN_RPC_TIMEOUT_MS,
} from '@nexus-terminal/shared/agent/plugins/values';
import type {
	AgentPluginReady,
	AgentPluginAck,
	AgentPluginFrontendInput,
	AgentPluginRpcEnvelope,
	AgentPluginFrontendResult,
} from '@nexus-terminal/shared/agent/plugins/frontend-events';

function belongsToApp(result: AgentPluginFrontendResult, appId: string): boolean {
	if ('appId' in result) {
		return result.appId === appId;
	}
	switch (result.method) {
		case 'agent.threads.history':
			return result.value.body.appId === appId;
		case 'agent.threads.list':
		case 'agent.runs.list':
			return result.value.items.every((item) => item.appId === appId);
		case 'agent.threads.create':
		case 'agent.threads.rename':
		case 'agent.threads.delete':
		case 'agent.approvals.resolve':
		case 'agent.threads.entries':
			return result.value.appId === appId;
		case 'agent.runs.get':
			return result.value === null || result.value.appId === appId;
		case 'agent.runs.create':
		case 'agent.runs.appendInput':
		case 'agent.runs.resume':
		case 'agent.runs.cancel':
		case 'agent.subagents.cancel':
			return result.value.run.appId === appId;
		case 'agent.approvals.list':
			return result.value.items.every((item) => item.appId === appId);
		default:
			return true;
	}
}

class PluginSdkFailure extends Error {
	constructor(
		readonly code: AgentHttpErrorCode | 'cancelled',
		readonly operationId: string | null,
		readonly outcomeUnknown: boolean,
	) {
		super(code);
		this.name = 'PluginSdkFailure';
	}
}

export async function connectNexusPlugin(): ReturnType<AgentPluginFrontendModule['connectNexusPlugin']> {
	const connection = await new Promise<{ port: PluginMessagePort; nonce: string; appId: string; expiresAt: number }>(
		(resolve, reject) => {
			const finish = (
				error: Error | null,
				value?: { port: PluginMessagePort; nonce: string; appId: string; expiresAt: number },
			) => {
				clearTimeout(timer);
				window.removeEventListener('message', receive);
				if (error) {
					reject(error);
				} else if (value) {
					resolve(value);
				}
			};

			const receive = (event: PluginMessageEvent) => {
				if (event.source !== window.parent) {
					return;
				}
				try {
					if (
						event.data === null ||
						typeof event.data !== 'object' ||
						!('type' in event.data) ||
						event.data.type !== 'nexus.plugin.init'
					) {
						return;
					}
					const row = readAgentPluginInit(event.data);
					if (row.protocol !== 4 || row.expiresAt <= Date.now() || event.ports.length !== 1) {
						throw new Error('invalid_input');
					}
					const nonce = row.nonce,
						port = event.ports[0];
					if (!port) {
						throw new Error('invalid_input');
					}
					const ack: AgentPluginAck = { type: 'nexus.plugin.ack', protocol: 4, nonce, seq: 0 };
					port.postMessage(ack);
					finish(null, { port, nonce, appId: row.appId, expiresAt: row.expiresAt });
				} catch (error) {
					for (const port of event.ports) {
						port.close();
					}
					finish(error instanceof Error ? error : new Error('invalid_input'));
				}
			};

			const timer = setTimeout(() => finish(new Error('provider_unavailable')), AGENT_PLUGIN_RPC_TIMEOUT_MS);
			window.addEventListener('message', receive);
			try {
				const ready: AgentPluginReady = { type: 'nexus.plugin.ready', protocol: 4 };
				window.parent.postMessage(ready, '*');
			} catch (error) {
				finish(error instanceof Error ? error : new Error('provider_unavailable'));
			}
		},
	);
	const pending = new Map<
		string,
		{
			request: AgentPluginRpcEnvelope;
			timer: ReturnType<typeof setTimeout>;
			resolve(value: AgentPluginFrontendResult): void;
			reject(error: Error): void;
			mutation: boolean;
			operationId: string | null;
			releaseAbort(): void;
		}
	>();
	const subscriptions = new Map<
		string,
		{
			stop: AbortController;
			task: Promise<void>;
			delivery: Promise<void>;
			runId: string;
			after: number;
			revision: number;
			generation: number;
			resolve(): void;
			reject(error: unknown): void;
			onEvents(page: AgentRunEventsResponse): void | Promise<void>;
			onFailure(error: Error): void | Promise<void>;
		}
	>();
	const subscriptionTasks = new Set<Promise<void>>();
	const subscriptionFailures: unknown[] = [];
	let droppedSubscriptionFailures = 0;
	let sequence = 0,
		closed = false;

	const recordSubscriptionFailure = (error: unknown) => {
		if (subscriptionFailures.length < 32) {
			subscriptionFailures.push(error);
		} else {
			droppedSubscriptionFailures++;
		}
	};

	const uiClient = createPluginUiClient(connection.appId, (message) => {
		if (closed) throw new PluginSdkFailure('provider_unavailable', null, false);
		try {
			connection.port.postMessage(message);
		} catch (error) {
			recordSubscriptionFailure(error);
			stopConnection();
			throw error;
		}
	});

	let expiryTimer: ReturnType<typeof setTimeout> | undefined;

	const stopConnection = () => {
		if (closed) {
			return;
		}
		closed = true;
		clearTimeout(expiryTimer);
		try {
			uiClient.close();
		} catch (error) {
			recordSubscriptionFailure(error);
		}
		try {
			if (sequence < Number.MAX_SAFE_INTEGER) {
				connection.port.postMessage(
					readAgentPluginControl({
						type: 'nexus.plugin.close',
						protocol: 4,
						nonce: connection.nonce,
						seq: ++sequence,
					}),
				);
			}
		} catch (error) {
			recordSubscriptionFailure(error);
		}
		for (const subscription of subscriptions.values()) {
			subscription.stop.abort();
			void subscription.delivery.then(subscription.resolve, subscription.reject);
		}
		subscriptions.clear();
		for (const item of pending.values()) {
			clearTimeout(item.timer);
			item.releaseAbort();
			item.reject(
				new PluginSdkFailure(
					item.mutation ? 'operation_unknown' : 'provider_unavailable',
					item.operationId,
					item.mutation,
				),
			);
		}
		pending.clear();
		try {
			connection.port.close();
		} catch (error) {
			recordSubscriptionFailure(error);
		}
		window.removeEventListener('pagehide', stopConnection);
	};

	const cancelRequest = (id: string) => {
		if (closed) {
			return;
		}
		if (sequence >= Number.MAX_SAFE_INTEGER) {
			stopConnection();
			return;
		}
		try {
			connection.port.postMessage(
				readAgentPluginControl({
					type: 'nexus.plugin.cancel',
					protocol: 4,
					nonce: connection.nonce,
					seq: ++sequence,
					id,
				}),
			);
		} catch {
			stopConnection();
		}
	};

	const request = async (
		input: AgentPluginFrontendInput,
		signal?: AbortSignal,
	): Promise<AgentPluginFrontendResult> => {
		if (closed || signal?.aborted || sequence >= Number.MAX_SAFE_INTEGER) {
			return Promise.reject(new PluginSdkFailure('provider_unavailable', null, false));
		}
		const normalized = readAgentPluginFrontendInput(input);
		const operationId =
			normalized.method === 'storage.put' ||
			normalized.method === 'storage.delete' ||
			normalized.method === 'intents.create' ||
			normalized.method === 'agent.threads.create' ||
			normalized.method === 'agent.threads.rename' ||
			normalized.method === 'agent.runs.create' ||
			normalized.method === 'agent.runs.appendInput' ||
			normalized.method === 'agent.runs.cancel' ||
			normalized.method === 'agent.runs.resume' ||
			normalized.method === 'agent.subagents.cancel' ||
			normalized.method === 'agent.approvals.resolve'
				? normalized.params.operationId
				: normalized.method === 'settings.write'
					? normalized.params.operationKey
					: normalized.method === 'intents.revoke'
						? normalized.params.receiptId
						: null;
		const mutation =
			operationId !== null ||
			normalized.method === 'agent.threads.delete' ||
			normalized.method === 'agent.memories.review' ||
			normalized.method === 'agent.artifacts.begin' ||
			normalized.method === 'agent.artifacts.retain' ||
			normalized.method === 'agent.artifacts.delete' ||
			normalized.method === 'agent.artifacts.attach';
		const id = crypto.randomUUID(),
			seq = ++sequence;
		const envelope: AgentPluginRpcEnvelope = {
			type: 'nexus.plugin.request',
			protocol: 4,
			nonce: connection.nonce,
			id,
			seq,
			request: normalized,
		};
		encodeAgentJson(envelope, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		return new Promise((resolve, reject) => {
			let dispatched = false;

			const releaseAbort = () => signal?.removeEventListener('abort', abort);

			const abort = () => {
				if (!pending.delete(id)) {
					return;
				}
				clearTimeout(timer);
				releaseAbort();
				if (dispatched) {
					cancelRequest(id);
				}
				reject(
					new PluginSdkFailure(
						mutation && dispatched ? 'operation_unknown' : 'provider_unavailable',
						operationId,
						mutation && dispatched,
					),
				);
			};

			const timer = setTimeout(() => {
				pending.delete(id);
				releaseAbort();
				if (dispatched) {
					cancelRequest(id);
				}
				reject(
					new PluginSdkFailure(
						mutation && dispatched ? 'operation_unknown' : 'provider_unavailable',
						operationId,
						mutation && dispatched,
					),
				);
			}, AGENT_PLUGIN_RPC_TIMEOUT_MS);
			pending.set(id, { request: envelope, timer, resolve, reject, mutation, operationId, releaseAbort });
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) {
				abort();
				return;
			}
			try {
				connection.port.postMessage(envelope);
				dispatched = true;
			} catch (error) {
				pending.delete(id);
				clearTimeout(timer);
				releaseAbort();
				reject(error instanceof Error ? error : new Error('invalid_input'));
			}
		});
	};

	const streamCommand = (
		value:
			| {
					command: 'subscribe';
					subscriptionId: string;
					generation: number;
					source: { kind: 'run-events'; runId: string; after: number };
			  }
			| { command: 'ack'; subscriptionId: string; generation: number; revision: number }
			| { command: 'unsubscribe'; subscriptionId: string; generation: number },
	) => {
		if (closed || sequence >= Number.MAX_SAFE_INTEGER) {
			throw new PluginSdkFailure('provider_unavailable', null, false);
		}
		const base = {
			type: 'nexus.plugin.stream',
			protocol: 4,
			nonce: connection.nonce,
			seq: ++sequence,
			subscriptionId: value.subscriptionId,
			generation: value.generation,
		};
		const message =
			value.command === 'subscribe'
				? {
						type: base.type,
						protocol: base.protocol,
						nonce: base.nonce,
						seq: base.seq,
						subscriptionId: base.subscriptionId,
						generation: base.generation,
						command: value.command,
						source: value.source,
					}
				: value.command === 'ack'
					? {
							type: base.type,
							protocol: base.protocol,
							nonce: base.nonce,
							seq: base.seq,
							subscriptionId: base.subscriptionId,
							generation: base.generation,
							command: value.command,
							revision: value.revision,
						}
					: {
							type: base.type,
							protocol: base.protocol,
							nonce: base.nonce,
							seq: base.seq,
							subscriptionId: base.subscriptionId,
							generation: base.generation,
							command: value.command,
						};
		connection.port.postMessage(readAgentPluginStreamCommand(message));
	};

	connection.port.addEventListener('message', (event: PluginMessageEvent) => {
		try {
			if (uiClient.handle(event.data)) {
				if (
					event.data !== null &&
					typeof event.data === 'object' &&
					'type' in event.data &&
					event.data.type === 'nexus.ui.closed'
				)
					stopConnection();
				return;
			}
		} catch (error) {
			recordSubscriptionFailure(error);
			stopConnection();
			return;
		}
		try {
			encodeAgentJson(event.data, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		} catch {
			stopConnection();
			return;
		}

		if (
			event.data !== null &&
			typeof event.data === 'object' &&
			'type' in event.data &&
			event.data.type === 'nexus.plugin.stream-event'
		) {
			if (!('subscriptionId' in event.data) || typeof event.data.subscriptionId !== 'string') {
				stopConnection();
				return;
			}
			const id = event.data.subscriptionId;
			const owner = subscriptions.get(id);
			if (!owner || owner.stop.signal.aborted) {
				return;
			}
			try {
				const value = readAgentPluginStreamEvent(event.data, {
					nonce: connection.nonce,
					subscriptionId: id,
					generation: owner.generation,
					runId: owner.runId,
					after: owner.after,
				});
				if (value.ok && value.revision !== owner.revision + 1) {
					throw new Error('Invalid subscription sequence');
				}
				if (value.ok) {
					// Validate following pages against the received cursor. Consumption
					// stays serialized below and ACK follows the actual callback.
					owner.revision = value.revision;
					owner.after = value.value.nextCursor;
				}
				owner.delivery = owner.delivery
					.then(async () => {
						if (owner.stop.signal.aborted || closed) {
							return;
						}
						if (!value.ok) {
							throw new PluginSdkFailure(value.error.code, null, false);
						}
						if (value.value.items.length > 0) {
							await owner.onEvents(value.value);
						}
						if (owner.stop.signal.aborted || closed || subscriptions.get(id) !== owner) {
							return;
						}
						streamCommand({
							command: 'ack',
							subscriptionId: id,
							generation: owner.generation,
							revision: value.revision,
						});
					})
					.catch(async (error: unknown) => {
						if (owner.stop.signal.aborted || closed) {
							recordSubscriptionFailure(error);
							owner.reject(error);
							return;
						}
						owner.stop.abort();
						subscriptions.delete(id);
						try {
							await owner.onFailure(
								error instanceof Error ? error : new PluginSdkFailure('internal_failure', null, false),
							);
							owner.resolve();
						} catch (callbackError) {
							const failure = new AggregateError(
								[error, callbackError],
								'Plugin subscription and failure callback failed',
							);
							recordSubscriptionFailure(failure);
							owner.reject(failure);
						}
					});
				void owner.delivery.catch(() => undefined);
			} catch {
				stopConnection();
			}
			return;
		}

		if (
			event.data === null ||
			typeof event.data !== 'object' ||
			!('id' in event.data) ||
			typeof event.data.id !== 'string'
		) {
			stopConnection();
			return;
		}
		const active = pending.get(event.data.id);
		if (!active) {
			return;
		}
		try {
			if ('type' in event.data && event.data.type === 'nexus.plugin.cancelled') {
				readAgentPluginCancelled(event.data, active.request);
				clearTimeout(active.timer);
				active.releaseAbort();
				pending.delete(active.request.id);
				active.reject(new PluginSdkFailure('cancelled', active.operationId, false));
				return;
			}
			const value = readAgentPluginRpcResponse(event.data, active.request);
			if (value.ok && value.result.method === 'host.appInfo' && value.result.value.appId !== connection.appId) {
				stopConnection();
				return;
			}
			if (
				value.ok &&
				((value.result.method === 'intents.create' && value.result.value.senderAppId !== connection.appId) ||
					(value.result.method === 'intents.listReceived' &&
						value.result.value.some((item) => item.receiverAppId !== connection.appId)))
			) {
				stopConnection();
				return;
			}
			if (value.ok && !belongsToApp(value.result, connection.appId)) {
				stopConnection();
				return;
			}

			clearTimeout(active.timer);
			active.releaseAbort();
			pending.delete(active.request.id);
			if (value.ok) {
				active.resolve(value.result);
			} else {
				active.reject(
					new PluginSdkFailure(
						value.error.code,
						active.operationId,
						active.mutation &&
							(value.error.code === 'operation_unknown' ||
								value.error.code === 'internal_failure' ||
								value.error.code === 'storage_unavailable'),
					),
				);
			}
		} catch {
			stopConnection();
		}
	});
	connection.port.addEventListener('messageerror', stopConnection);
	window.addEventListener('pagehide', stopConnection, { once: true });
	connection.port.start();

	const subscribe = (
		runId: string,
		after: number,
		onEvents: (page: AgentRunEventsResponse) => void | Promise<void>,
		onFailure: (error: Error) => void | Promise<void>,
	) => {
		if (closed) {
			throw new PluginSdkFailure('limit_exceeded', null, false);
		}
		const input = readAgentPluginFrontendInput({
			method: 'agent.runs.events',
			params: { runId, after, limit: AGENT_RUN_EVENT_MAX_LIMIT },
		});
		if (input.method !== 'agent.runs.events') {
			throw new PluginSdkFailure('invalid_input', null, false);
		}
		const id = crypto.randomUUID();

		let resolve = () => {};

		let reject = (_error: unknown) => {};

		const task = new Promise<void>((completed, failed) => {
			resolve = completed;
			reject = failed;
		});
		const owner = {
			stop: new AbortController(),
			task,
			delivery: Promise.resolve(),
			runId: input.params.runId,
			after: input.params.after,
			generation: 1,
			revision: 0,
			resolve,
			reject,
			onEvents,
			onFailure,
		};
		subscriptions.set(id, owner);
		subscriptionTasks.add(task);
		void task.then(
			() => {
				subscriptionTasks.delete(task);
			},
			(error: unknown) => {
				subscriptionTasks.delete(task);
				recordSubscriptionFailure(error);
			},
		);
		try {
			streamCommand({
				command: 'subscribe',
				subscriptionId: id,
				generation: owner.generation,
				source: { kind: 'run-events', runId: owner.runId, after: owner.after },
			});
		} catch (error) {
			subscriptions.delete(id);
			owner.reject(error);
		}
		return { id, closed: task };
	};

	const unsubscribe = async (id: string): Promise<void> => {
		const owner = subscriptions.get(id);
		if (!owner) {
			return;
		}
		owner.stop.abort();
		subscriptions.delete(id);
		try {
			if (!closed) {
				streamCommand({ command: 'unsubscribe', subscriptionId: id, generation: owner.generation });
			}
		} finally {
			await owner.delivery;
			owner.resolve();
		}
		await owner.task;
	};

	let closePromise: Promise<void> | null = null;

	const close = (): Promise<void> => {
		if (closePromise) {
			return closePromise;
		}
		const tasks = [...subscriptionTasks];
		closePromise = Promise.resolve().then(async () => {
			await Promise.allSettled(tasks);
			if (subscriptionFailures.length || droppedSubscriptionFailures) {
				throw new AggregateError(
					subscriptionFailures.slice(),
					'Plugin subscriptions failed to close; additional=' + droppedSubscriptionFailures,
				);
			}
		});
		void closePromise.catch(() => undefined);
		stopConnection();
		return closePromise;
	};

	const expireGrant = () => {
		if (closed) return;
		const remaining = connection.expiresAt - Date.now();
		if (remaining <= 0) {
			void close();
			return;
		}
		expiryTimer = setTimeout(expireGrant, Math.min(2147483647, remaining));
	};

	expireGrant();

	return Object.freeze({
		protocolVersion: 4,
		request,
		settings: {
			async read(signal?: AbortSignal) {
				const result = await request({ method: 'settings.read', params: {} }, signal);
				if (result.method !== 'settings.read') {
					throw new PluginSdkFailure('invalid_input', null, false);
				}
				return result.value;
			},

			async write(
				input: import('@nexus-terminal/shared/agent/plugins/settings').AgentPluginConfigurationWrite,
				signal?: AbortSignal,
			) {
				const result = await request(
					{
						method: 'settings.write',
						params: {
							operationKey: input.operationKey,
							expectedPackageRevision: input.expectedPackageRevision,
							expectedRevision: input.expectedRevision,
							schemaRevision: input.schemaRevision,
							documentJson: input.documentJson,
						},
					},
					signal,
				);
				if (result.method !== 'settings.write') {
					throw new PluginSdkFailure('invalid_input', input.operationKey, true);
				}
				return result.value;
			},
		},
		ui: uiClient.ui,
		agent: { runs: { subscribe, unsubscribe } },
		close,
	});
}

export { PluginUiRequestFailure } from './ui-client.js';
