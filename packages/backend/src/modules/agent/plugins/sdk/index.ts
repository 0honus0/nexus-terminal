import type { AgentPluginContentPage } from '@nexus-terminal/shared/agent/plugins/content';
import {
	readAgentPluginModelResponse,
	readAgentPluginModelDescriptor,
} from '@nexus-terminal/shared/agent/plugins/app-runtime';
import {
	readAgentPluginRunInfo,
	readAgentPluginCheckpoint,
	readAgentPluginRunHistory,
	readAgentPluginTitleResult,
} from '@nexus-terminal/shared/agent/plugins/run-context';
import { createHash } from 'node:crypto';
import {
	readAgentPluginContentDraft,
	readAgentPluginContentPage,
	readAgentPluginContentReference,
} from '@nexus-terminal/shared/agent/plugins/content';
import type {
	AgentPluginCallContext,
	AgentPluginHandler,
	AgentPluginSetup,
} from '@nexus-terminal/shared/agent/plugins/backend-sdk';
import { InvalidAgentPayload, agentInteger, agentRecord, readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	AGENT_PLUGIN_RESOURCE_RELEASE_KEY,
	AGENT_PLUGIN_INSTANCE_PREPARE_KEY,
} from '@nexus-terminal/shared/agent/plugins/runtime';
import {
	readAgentPluginBinding,
	readAgentPluginDescription,
	readAgentPluginDirectoryPage,
	readAgentPluginInvocationReply,
	readAgentPluginRegistration,
	readAgentPluginInstanceEvent,
	pluginContractText,
} from '@nexus-terminal/shared/agent/plugins/registry-codec';
import {
	readAgentPluginCapabilityReply,
	readAgentPluginDispatchInput,
	readAgentPluginRuntimeContext,
} from '@nexus-terminal/shared/agent/plugins/runtime-codec';
import type { AgentPluginRegistrationDefinition } from '@nexus-terminal/shared/agent/plugins/registry';
import type { AgentOperationErrorCode } from '@nexus-terminal/shared/agent/values';
import type { AgentPluginRuntimeContext, AgentPluginRuntimeModule } from '@nexus-terminal/shared/agent/plugins/runtime';
import { readAgentPluginHostOperationResult } from '@nexus-terminal/shared/agent/plugins/host-operations-codec';
import {
	readAgentPluginInstanceSettings,
	readAgentPluginInstanceView,
} from '@nexus-terminal/shared/agent/plugins/settings-codec';
import {
	readAgentPluginTransportSession,
	readAgentPluginServiceTransportResult,
} from '@nexus-terminal/shared/agent/plugins/service-transport-codec';
import {
	readAgentPluginDataRecord,
	readAgentPluginDataPage,
	readAgentPluginDataWrite,
} from '@nexus-terminal/shared/agent/plugins/data';

export class PluginCapabilityFailure extends Error {
	constructor(readonly code: AgentOperationErrorCode) {
		super(code);
		this.name = 'PluginCapabilityFailure';
	}
}

/** This file is bundled as a public SDK asset; it has no dependency on Host business code. */
export function definePlugin(setup: (context: AgentPluginSetup) => void | Promise<void>): AgentPluginRuntimeModule {
	const handlers = new Map<
		string,
		{ definition: AgentPluginRegistrationDefinition; handler: AgentPluginHandler | null }
	>();
	const groups = new Map<string, Set<string>>();
	const cleanups: (() => void | Promise<void>)[] = [];
	const preparations: ((context: AgentPluginCallContext) => void | Promise<void>)[] = [];
	const active = new Map<AbortController, Promise<unknown>>();
	let identity: AgentPluginRuntimeContext | null = null;
	let accepting = false;
	let activated = false;
	let closing: Promise<void> | null = null;
	let registrationLane = Promise.resolve();
	const runCleanups = new Map<string, Map<string, () => void | Promise<void>>>();
	const runClosings = new Map<string, Promise<void>>();

	function releaseResources(runId: string): Promise<void> {
		const original = runClosings.get(runId);
		if (original) {
			return original;
		}
		const task = Promise.resolve().then(async () => {
			const captured = runCleanups.get(runId);
			const outcomes = await Promise.allSettled(
				[...(captured?.values() ?? [])].map((cleanup) => Promise.resolve().then(cleanup)),
			);
			const failures = outcomes.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
			if (failures.length) {
				throw new AggregateError(failures, 'Plugin Run cleanup failed');
			}
			if (runCleanups.get(runId) === captured) {
				runCleanups.delete(runId);
			}
		});
		runClosings.set(runId, task);
		void task.then(
			() => runClosings.delete(runId),
			() => undefined,
		);
		return task;
	}

	async function shutdown(): Promise<void> {
		accepting = false;
		for (const controller of active.keys()) {
			controller.abort();
		}
		// A cancelled handler may still own accepted Host requests or late resources.
		// Release them before running the instance's resource disposers.
		await Promise.allSettled([...active.values()]);
		await registrationLane;
		const failures: unknown[] = [];
		const runs = await Promise.allSettled([...runCleanups.keys()].map(releaseResources));
		for (const result of runs) {
			if (result.status === 'rejected') {
				failures.push(result.reason);
			}
		}
		for (const cleanup of cleanups.splice(0).reverse()) {
			try {
				await cleanup();
			} catch (error) {
				failures.push(error);
			}
		}
		handlers.clear();
		if (failures.length) {
			throw new AggregateError(failures, 'Plugin resources failed to close');
		}
	}

	return {
		async activate(input) {
			if (activated || closing) {
				throw new PluginCapabilityFailure('version_conflict');
			}
			activated = true;
			identity = readAgentPluginRuntimeContext(input.context);
			const snapshot = identity;
			try {
				await setup({
					identity: snapshot,

					register(value, handler) {
						const definition = readAgentPluginRegistration(value);
						if (
							accepting ||
							closing ||
							handlers.has(definition.key) ||
							(definition.kind === 'event' ? handler !== undefined : typeof handler !== 'function')
						) {
							throw new PluginCapabilityFailure('invalid_input');
						}
						const registration = { definition, handler: handler ?? null };
						handlers.set(definition.key, registration);
						return () => {
							if (accepting) {
								throw new PluginCapabilityFailure('version_conflict');
							}
							if (handlers.get(definition.key) === registration) {
								handlers.delete(definition.key);
							}
						};
					},

					onDispose(cleanup) {
						if (closing) {
							throw new PluginCapabilityFailure('provider_unavailable');
						}
						cleanups.push(cleanup);
					},

					onReady(prepare) {
						if (accepting || closing) {
							throw new PluginCapabilityFailure('version_conflict');
						}
						preparations.push(prepare);
					},
				});
			} catch (error) {
				closing ??= Promise.resolve().then(shutdown);
				try {
					await closing;
				} catch (cleanup) {
					throw new AggregateError([error, cleanup], 'Plugin activation and cleanup failed');
				}
				throw error;
			}
			accepting = true;
			return [...handlers.values()].map((value) => readAgentPluginRegistration(value.definition));
		},

		async dispatch(raw, bridge, parentSignal) {
			const input = readAgentPluginDispatchInput(raw);
			if (input.key === AGENT_PLUGIN_RESOURCE_RELEASE_KEY && input.scope.kind === 'lifecycle') {
				const command = agentRecord(JSON.parse(input.argumentsJson), ['runId']);
				await releaseResources(readAgentId(command.runId));
				return { resultJson: 'null' };
			}
			const registered = handlers.get(input.key);
			const preparing = input.key === AGENT_PLUGIN_INSTANCE_PREPARE_KEY && input.scope.kind === 'lifecycle';
			const handler = preparing
				? async (_value: unknown, context: AgentPluginCallContext) => {
						for (const prepare of preparations) {
							await prepare(context);
						}
						return null;
					}
				: registered?.handler;
			if (!accepting || !identity || !handler) {
				throw new PluginCapabilityFailure('provider_unavailable');
			}
			const controller = new AbortController();
			const signal = AbortSignal.any([parentSignal, controller.signal]);
			let transportOrdinal = 0;

			const request = async <T>(method: string, value: unknown, decode: (value: unknown) => T): Promise<T> => {
				if (method !== 'transport.session.close') {
					signal.throwIfAborted();
				}
				const inputJson = JSON.stringify(value);
				if (inputJson === undefined) {
					throw new InvalidAgentPayload();
				}
				const response = readAgentPluginCapabilityReply(await bridge.call({ method, inputJson }));
				if (!response.ok) {
					throw new PluginCapabilityFailure(response.code);
				}
				return decode(JSON.parse(response.valueJson));
			};

			const context: AgentPluginCallContext = {
				identity,
				scope: input.scope,
				signal,

				onResourcesDispose(key, cleanup) {
					if (input.scope.kind !== 'run' || runClosings.has(input.scope.runId)) {
						throw new PluginCapabilityFailure('forbidden');
					}
					const entries = runCleanups.get(input.scope.runId) ?? new Map();
					if (entries.has(key)) {
						return;
					}
					entries.set(key, cleanup);
					runCleanups.set(input.scope.runId, entries);
				},

				request,

				async replaceContributions(rawGroup, entries) {
					const group = pluginContractText(rawGroup);
					const prepared = entries.map((entry) => {
						const definition = readAgentPluginRegistration(entry.definition);
						if (
							definition.kind === 'event'
								? entry.handler !== undefined
								: typeof entry.handler !== 'function'
						) {
							throw new PluginCapabilityFailure('invalid_input');
						}
						return { definition, handler: entry.handler ?? null };
					});
					if (new Set(prepared.map((entry) => entry.definition.key)).size !== prepared.length) {
						throw new PluginCapabilityFailure('invalid_input');
					}
					const update = registrationLane.then(async () => {
						if (!accepting) {
							throw new PluginCapabilityFailure('provider_unavailable');
						}
						const previous = groups.get(group) ?? new Set<string>();
						const original = new Map(handlers);
						const next = new Map(handlers);
						for (const key of previous) {
							next.delete(key);
						}
						for (const entry of prepared) {
							const key = entry.definition.key;
							const existing = original.get(key);
							if (
								existing &&
								(!previous.has(key) ||
									JSON.stringify(existing.definition) !== JSON.stringify(entry.definition))
							) {
								throw new PluginCapabilityFailure('version_conflict');
							}
							next.set(key, existing ?? entry);
						}
						// Stage only after the entire inventory validates. Old handlers stay until Host commits.
						for (const [key, entry] of next) {
							if (!original.has(key)) {
								handlers.set(key, entry);
							}
						}
						try {
							await request(
								'registry.replace',
								{ definitions: [...next.values()].map((entry) => entry.definition) },
								(value) => agentInteger(agentRecord(value, ['revision']).revision),
							);
						} catch (error) {
							if (
								error instanceof PluginCapabilityFailure &&
								error.code !== 'operation_unknown' &&
								error.code !== 'storage_unavailable'
							) {
								for (const entry of prepared) {
									if (!original.has(entry.definition.key)) {
										handlers.delete(entry.definition.key);
									}
								}
							} else {
								accepting = false;
							}
							throw error;
						}
						for (const key of previous) {
							if (!next.has(key)) {
								handlers.delete(key);
							}
						}
						groups.set(group, new Set(prepared.map((entry) => entry.definition.key)));
					});
					registrationLane = update.then(
						() => undefined,
						() => undefined,
					);
					await update;
				},

				async contribute(raw, handler) {
					const definition = readAgentPluginRegistration(raw);
					if (definition.kind === 'event' ? handler !== undefined : typeof handler !== 'function') {
						throw new PluginCapabilityFailure('invalid_input');
					}
					const registration = { definition, handler: handler ?? null };

					const publish = async () => {
						if (!accepting || handlers.has(definition.key)) {
							throw new PluginCapabilityFailure('version_conflict');
						}
						handlers.set(definition.key, registration);
						try {
							await request(
								'registry.replace',
								{ definitions: [...handlers.values()].map((item) => item.definition) },
								(value) => agentInteger(agentRecord(value, ['revision']).revision),
							);
						} catch (error) {
							// An explicit refusal proves replacement did not commit. A lost
							// response fences this instance until its Host owner reconciles it.
							if (
								error instanceof PluginCapabilityFailure &&
								error.code !== 'operation_unknown' &&
								error.code !== 'storage_unavailable'
							) {
								handlers.delete(definition.key);
							} else {
								accepting = false;
							}
							throw error;
						}
					};

					const update = registrationLane.then(publish);
					registrationLane = update.then(
						() => undefined,
						() => undefined,
					);
					await update;
					return async () => {
						const remove = registrationLane.then(async () => {
							if (handlers.get(definition.key) !== registration) {
								return;
							}
							try {
								await request(
									'registry.replace',
									{
										definitions: [...handlers.values()]
											.filter((item) => item !== registration)
											.map((item) => item.definition),
									},
									(value) => agentInteger(agentRecord(value, ['revision']).revision),
								);
							} catch (error) {
								if (
									!(error instanceof PluginCapabilityFailure) ||
									error.code === 'operation_unknown' ||
									error.code === 'storage_unavailable'
								) {
									accepting = false;
								}
								throw error;
							}
							if (handlers.get(definition.key) === registration) {
								handlers.delete(definition.key);
							}
						});
						registrationLane = remove.then(
							() => undefined,
							() => undefined,
						);
						await remove;
					};
				},

				events: {
					emit: (value) => request('registry.emit', value, readAgentPluginInstanceEvent),

					wait: (entryId, afterRevision) =>
						request('registry.eventWait', { entryId, afterRevision }, readAgentPluginInstanceEvent),
				},
				directory: {
					discover: (query) => request('registry.discover', query, readAgentPluginDirectoryPage),

					describe: (entryId) => request('registry.describe', { entryId }, readAgentPluginDescription),

					bind: (entryId) => request('registry.bind', { entryId }, readAgentPluginBinding),

					invoke: (value) => request('registry.invoke', value, readAgentPluginInvocationReply),

					wait: (revision) =>
						request('registry.wait', { revision }, (value) =>
							agentInteger(agentRecord(value, ['revision']).revision),
						),
				},
				content: {
					async put(key, text, mediaType) {
						const draft = await request('content.open', { key, mediaType }, readAgentPluginContentDraft);
						let index = 0;
						for (let start = 0; start < text.length;) {
							let end = Math.min(text.length, start + 16384);
							const last = text.charCodeAt(end - 1);
							if (end < text.length && last >= 0xd800 && last <= 0xdbff) {
								end--;
							}
							await request(
								'content.append',
								{ id: draft.id, index: index++, text: text.slice(start, end) },
								readAgentPluginContentDraft,
							);
							start = end;
						}
						return request(
							'content.seal',
							{ id: draft.id, chunks: index, sha256: createHash('sha256').update(text).digest('hex') },
							readAgentPluginContentReference,
						);
					},

					read: (reference, index) =>
						request('content.read', { reference, index }, readAgentPluginContentPage),

					async text(reference) {
						const parts: string[] = [];
						let index: number | null = 0;
						do {
							const page: AgentPluginContentPage = await request(
								'content.read',
								{ reference, index },
								readAgentPluginContentPage,
							);
							parts.push(page.text);
							index = page.nextIndex;
						} while (index !== null);
						const text = parts.join('');
						if (
							Buffer.byteLength(text) !== reference.sizeBytes ||
							createHash('sha256').update(text).digest('hex') !== reference.sha256
						) {
							throw new InvalidAgentPayload();
						}
						return text;
					},
				},
				storage: {
					read: (namespace, key) =>
						request(
							'storage.read',
							{ namespace: pluginContractText(namespace), key: pluginContractText(key) },
							(value) => (value === null ? null : readAgentPluginDataRecord(value)),
						),

					list: (namespace, after) =>
						request(
							'storage.list',
							{
								namespace: pluginContractText(namespace),
								after: after === null ? null : pluginContractText(after),
							},
							readAgentPluginDataPage,
						),

					write: (input) =>
						request('storage.write', readAgentPluginDataWrite(input), readAgentPluginInvocationReply),
				},
				configuration: {
					read: (instanceId = context.identity.instanceId) =>
						request('configuration.read', { instanceId }, readAgentPluginInstanceSettings),

					list: () =>
						request('configuration.list', {}, (value) => {
							const row = agentRecord(value, ['instances']);
							if (!Array.isArray(row.instances)) {
								throw new InvalidAgentPayload();
							}
							const instances = row.instances.map(readAgentPluginInstanceView);
							if (new Set(instances.map((item) => item.id)).size !== instances.length) {
								throw new InvalidAgentPayload();
							}
							return instances;
						}),

					write: (instanceId, command) =>
						request('configuration.write', { instanceId, command }, readAgentPluginInvocationReply),
				},
				models: {
					invoke: (input) => request('models.invoke', input, readAgentPluginModelResponse),

					describe: (selection) => request('models.describe', selection, readAgentPluginModelDescriptor),
				},
				transport: {
					open: (operationKey) =>
						request('transport.session.open', { operationKey }, readAgentPluginTransportSession),

					call: (sessionId, command) =>
						request(
							'transport.session.call',
							{ sessionId, operationKey: 'io:' + transportOrdinal++, request: command },
							(value) => readAgentPluginServiceTransportResult(value, command),
						),

					close: (sessionId) =>
						request('transport.session.close', { sessionId }, (value) => {
							if (value !== null) {
								throw new InvalidAgentPayload();
							}
						}),
				},
				run: {
					setTitle: (input) => request('run.setTitle', input, readAgentPluginTitleResult),

					describe: () => request('run.describe', {}, readAgentPluginRunInfo),

					readCheckpoint: () =>
						request('run.readCheckpoint', {}, (value) =>
							value === null ? null : readAgentPluginCheckpoint(value),
						),

					checkpoint: (input) => request('run.checkpoint', input, readAgentPluginCheckpoint),

					history: (before) => request('run.history', { before }, readAgentPluginRunHistory),

					append: (input) =>
						request('run.append', input, (value) => {
							if (value !== null) {
								throw new InvalidAgentPayload();
							}
						}),
				},

				perform: (operationKey, value) =>
					request('host.perform', { operationKey, request: value }, (result) =>
						readAgentPluginHostOperationResult(result, value),
					),
			};
			const task = Promise.resolve().then(async () => {
				if (input.scope.kind === 'run') {
					// A resource expiry may dispose protocol caches while the App itself
					// remains alive. A new handler enters only after that exact close settles.
					await runClosings.get(input.scope.runId);
				}
				signal.throwIfAborted();
				const value = await handler(JSON.parse(input.argumentsJson), context);
				const resultJson = JSON.stringify(value);
				if (resultJson === undefined) {
					throw new InvalidAgentPayload();
				}
				return { resultJson };
			});
			active.set(controller, task);
			try {
				return await task;
			} catch (error) {
				if (error instanceof PluginCapabilityFailure) {
					return { errorCode: error.code };
				}
				if (error instanceof InvalidAgentPayload) {
					return { errorCode: 'invalid_input' };
				}
				if (signal.aborted && error === signal.reason) {
					return { errorCode: 'forbidden' };
				}
				throw error;
			} finally {
				active.delete(controller);
			}
		},

		health: () => accepting,

		quiesce() {
			accepting = false;
			for (const controller of active.keys()) {
				controller.abort();
			}
		},

		dispose() {
			closing ??= Promise.resolve().then(shutdown);
			return closing;
		},
	};
}
