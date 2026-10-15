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
}

declare const window: {
	parent: { postMessage(value: unknown, targetOrigin: string): void };
	addEventListener(type: string, listener: (event: PluginMessageEvent) => void, options?: { once: boolean }): void;
	removeEventListener(type: string, listener: (event: PluginMessageEvent) => void): void;
};

import { encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import type { AgentRunEventsResponse } from '@nexus-terminal/shared/agent/runs/http';
import type { AgentPluginFrontendSdk } from '@nexus-terminal/shared/agent/plugins/frontend-sdk';
import { AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentHttpErrorCode } from '@nexus-terminal/shared/agent/values';
import {
	readAgentPluginInit,
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
	switch (result.method) {
		case 'agent.threads.list':
		case 'agent.runs.list':
			return result.value.items.every((item) => item.appId === appId);
		case 'agent.threads.create':
		case 'agent.threads.rename':
		case 'agent.approvals.resolve':
		case 'agent.threads.entries':
			return result.value.appId === appId;
		case 'agent.runs.get':
			return result.value === null || result.value.appId === appId;
		case 'agent.runs.create':
		case 'agent.runs.appendInput':
		case 'agent.runs.cancel':
		case 'agent.subagents.cancel':
			return result.value.run.appId === appId;
		case 'agent.approvals.list':
			return result.value.every((item) => item.appId === appId);
		default:
			return true;
	}
}

class PluginSdkFailure extends Error {
	constructor(
		readonly code: AgentHttpErrorCode,
		readonly operationId: string | null,
		readonly outcomeUnknown: boolean,
	) {
		super(code);
		this.name = 'PluginSdkFailure';
	}
}

export async function connectNexusPlugin(): Promise<AgentPluginFrontendSdk> {
	const connection = await new Promise<{ port: PluginMessagePort; nonce: string; appId: string }>(
		(resolve, reject) => {
			const finish = (error: Error | null, value?: { port: PluginMessagePort; nonce: string; appId: string }) => {
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
					if (row.protocol !== 1 || event.ports.length !== 1) {
						throw new Error('invalid_input');
					}
					const nonce = row.nonce,
						port = event.ports[0];
					const ack: AgentPluginAck = { type: 'nexus.plugin.ack', protocol: 1, nonce, seq: 0 };
					port.postMessage(ack);
					finish(null, { port, nonce, appId: row.appId });
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
				const ready: AgentPluginReady = { type: 'nexus.plugin.ready', protocol: 1 };
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
	const subscriptions = new Map<string, { stop: AbortController; task: Promise<void> }>();
	const subscriptionFailures: unknown[] = [];
	let droppedSubscriptionFailures = 0;
	let sequence = 0,
		closed = false;

	const stopConnection = () => {
		if (closed) {
			return;
		}
		closed = true;
		for (const subscription of subscriptions.values()) {
			subscription.stop.abort();
		}
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
		connection.port.close();
		window.removeEventListener('pagehide', stopConnection);
	};

	const request = async (
		input: AgentPluginFrontendInput,
		signal?: AbortSignal,
	): Promise<AgentPluginFrontendResult> => {
		if (closed || signal?.aborted || pending.size >= 32 || sequence >= Number.MAX_SAFE_INTEGER) {
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
			normalized.method === 'agent.subagents.cancel' ||
			normalized.method === 'agent.approvals.resolve'
				? normalized.params.operationId
				: normalized.method === 'intents.revoke'
					? normalized.params.receiptId
					: null;
		const mutation = operationId !== null;
		const id = crypto.randomUUID(),
			seq = ++sequence;
		const envelope: AgentPluginRpcEnvelope = {
			type: 'nexus.plugin.request',
			protocol: 1,
			nonce: connection.nonce,
			id,
			seq,
			request: normalized,
		};
		encodeAgentJson(envelope, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		return new Promise((resolve, reject) => {
			const releaseAbort = () => signal?.removeEventListener('abort', abort);

			const abort = () => {
				if (!pending.delete(id)) {
					return;
				}
				clearTimeout(timer);
				releaseAbort();
				reject(
					new PluginSdkFailure(
						mutation ? 'operation_unknown' : 'provider_unavailable',
						operationId,
						mutation,
					),
				);
			};

			const timer = setTimeout(() => {
				pending.delete(id);
				releaseAbort();
				reject(
					new PluginSdkFailure(
						mutation ? 'operation_unknown' : 'provider_unavailable',
						operationId,
						mutation,
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
			} catch (error) {
				pending.delete(id);
				clearTimeout(timer);
				releaseAbort();
				reject(error instanceof Error ? error : new Error('invalid_input'));
			}
		});
	};

	connection.port.addEventListener('message', (event: PluginMessageEvent) => {
		try {
			encodeAgentJson(event.data, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		} catch {
			stopConnection();
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
		if (closed || subscriptions.size >= 8) {
			throw new PluginSdkFailure('limit_exceeded', null, false);
		}
		const input = readAgentPluginFrontendInput({
			method: 'agent.runs.events',
			params: { runId, after, limit: AGENT_RUN_EVENT_MAX_LIMIT },
		});
		if (input.method !== 'agent.runs.events') {
			throw new PluginSdkFailure('invalid_input', null, false);
		}
		const id = crypto.randomUUID(),
			stop = new AbortController();
		const owner = { stop, task: Promise.resolve() };
		subscriptions.set(id, owner);
		owner.task = Promise.resolve()
			.then(async () => {
				let cursor = input.params.after;
				while (!stop.signal.aborted && !closed) {
					const result = await request(
						{
							method: 'agent.runs.events',
							params: { runId: input.params.runId, after: cursor, limit: input.params.limit },
						},
						stop.signal,
					);
					if (stop.signal.aborted || closed || subscriptions.get(id) !== owner) {
						return;
					}
					if (result.method !== 'agent.runs.events') {
						throw new PluginSdkFailure('internal_failure', null, false);
					}
					cursor = result.value.nextCursor;
					if (result.value.items.length) {
						await onEvents(result.value);
					}
					if (stop.signal.aborted || closed) {
						return;
					}
					await new Promise<void>((resolve) => {
						const finish = () => {
							clearTimeout(timer);
							stop.signal.removeEventListener('abort', finish);
							resolve();
						};

						const timer = setTimeout(finish, 500);
						stop.signal.addEventListener('abort', finish, { once: true });
						if (stop.signal.aborted) {
							finish();
						}
					});
				}
			})
			.catch(async (error: unknown) => {
				if (!stop.signal.aborted && !closed) {
					try {
						await onFailure(
							error instanceof Error ? error : new PluginSdkFailure('internal_failure', null, false),
						);
					} catch (callbackError) {
						const failure = new AggregateError(
							[error, callbackError],
							'Plugin subscription and failure callback failed',
						);
						if (subscriptionFailures.length < 32) {
							subscriptionFailures.push(failure);
						} else {
							droppedSubscriptionFailures++;
						}
						throw failure;
					}
				}
			})
			.finally(() => {
				if (subscriptions.get(id) === owner) {
					subscriptions.delete(id);
				}
			});
		void owner.task.catch(() => undefined);
		return { id, closed: owner.task };
	};

	const unsubscribe = async (id: string): Promise<void> => {
		const owner = subscriptions.get(id);
		if (owner) {
			owner.stop.abort();
			await owner.task;
		}
	};

	let closePromise: Promise<void> | null = null;

	const close = (): Promise<void> => {
		if (closePromise) {
			return closePromise;
		}
		const tasks = [...subscriptions.values()].map((owner) => owner.task);
		stopConnection();
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
		return closePromise;
	};

	return Object.freeze({ protocolVersion: 1, request, agent: { runs: { subscribe, unsubscribe } }, close });
}
