import {
	agentRecord,
	readAgentId,
	InvalidAgentPayload,
	encodeAgentJson,
} from '@nexus-terminal/shared/agent/http-codec';
import type {
	AgentPluginFrontendSdk,
	AgentPluginUiRequestFailure,
} from '@nexus-terminal/shared/agent/plugins/frontend-sdk';
import type {
	AgentPluginUiEnvironment,
	AgentPluginUiHostInput,
	AgentPluginUiHostResult,
	AgentPluginUiHostFailure,
	AgentPluginUiClientMessage,
} from '@nexus-terminal/shared/agent/plugins/ui-events';
import {
	readAgentPluginUiEnvironment,
	readAgentPluginUiHostInput,
	readAgentPluginUiHostResult,
	readAgentPluginUiHostFailure,
} from '@nexus-terminal/shared/agent/plugins/ui-events-codec';
import type {
	AgentPluginUiStreamConsumer,
	AgentPluginUiStreamSource,
	AgentPluginUiStreamPage,
	AgentPluginUiStreamSubscription,
} from '@nexus-terminal/shared/agent/plugins/ui-streams';
import {
	readAgentPluginUiStreamSource,
	readAgentPluginUiStreamCommand,
	readAgentPluginUiStreamPage,
	readAgentPluginUiStreamFailure,
} from '@nexus-terminal/shared/agent/plugins/ui-streams-codec';
import { AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';

interface Pending {
	input: AgentPluginUiHostInput;
	mutation: boolean;
	dispatched: boolean;
	resolve(result: AgentPluginUiHostResult): void;
	reject(error: unknown): void;
	release(): void;
}

interface Stream {
	source: AgentPluginUiStreamSource;
	consumer: AgentPluginUiStreamConsumer;
	page: AgentPluginUiStreamPage | null;
	generation: number;
	revision: number;
	delivery: number;
	resolve(): void;
}

export class PluginUiRequestFailure extends Error implements AgentPluginUiRequestFailure {
	constructor(
		readonly code: AgentPluginUiHostFailure['code'],
		readonly outcome: AgentPluginUiHostFailure['outcome'],
	) {
		super(code);
		this.name = 'PluginUiRequestFailure';
	}
}

/** Browser client for the finite, authenticated UI capabilities on the original plugin port. */
export function createPluginUiClient(
	appId: string,
	post: (message: AgentPluginUiClientMessage) => void,
): {
	ui: AgentPluginFrontendSdk['ui'];
	handle(input: unknown): boolean;
	close(): void;
} {
	let environment: AgentPluginUiEnvironment | null = null;
	let closed = false;

	let readyResolve: (value: AgentPluginUiEnvironment) => void = () => {};

	let readyReject: (error: unknown) => void = () => {};

	const ready = new Promise<AgentPluginUiEnvironment>((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	void ready.catch(() => undefined);
	const pending = new Map<string, Pending>();
	const streams = new Map<string, Stream>();
	const environmentListeners = new Set<(value: AgentPluginUiEnvironment) => void>();
	const taskListeners = new Set<(runId: string) => void>();
	const closeListeners = new Set<() => void>();

	const close = () => {
		if (closed) return;
		closed = true;
		const failures: unknown[] = [];
		readyReject(new PluginUiRequestFailure('cancelled', 'not_dispatched'));
		for (const owner of pending.values()) {
			owner.release();
			owner.reject(
				new PluginUiRequestFailure(
					'cancelled',
					owner.dispatched ? (owner.mutation ? 'unknown' : 'confirmed') : 'not_dispatched',
				),
			);
		}
		pending.clear();
		for (const owner of streams.values()) {
			owner.page = null;
			owner.resolve();
		}
		streams.clear();
		for (const listener of closeListeners) {
			try {
				listener();
			} catch (error) {
				failures.push(error);
			}
		}
		environmentListeners.clear();
		taskListeners.clear();
		closeListeners.clear();
		if (failures.length) throw new AggregateError(failures, 'Plugin UI close callbacks failed');
	};

	const apply = (id: string, owner: Stream) => {
		const page = owner.page;
		if (closed || streams.get(id) !== owner || !page) return;
		let nextSource = owner.source;
		if (owner.source.kind === 'run' && page.value.type === 'update') {
			const previous = owner.source.cursor;
			nextSource = {
				kind: 'run',
				runId: owner.source.runId,
				cursor: {
					threadId: previous.threadId,
					entries: {
						runSequence: page.value.body.nextCursor.runSequence,
						messageOrdinal: page.value.body.nextCursor.messageOrdinal,
						chunkIndex: page.value.body.nextCursor.chunkIndex,
						textOffset: page.value.body.nextCursor.textOffset,
					},
					events: page.value.state?.events.nextCursor ?? previous.events,
					approvals: page.value.state
						? page.value.state.approvals.hasMore
							? page.value.state.approvals.nextCursor
							: null
						: previous.approvals,
				},
			};
		}
		if (!owner.consumer.apply(page.value, page.revision)) return;
		// A terminal Run or a thread change can unsubscribe synchronously during application.
		if (closed || streams.get(id) !== owner || owner.page !== page) return;
		owner.source = nextSource;
		owner.page = null;
		post(
			readAgentPluginUiStreamCommand({
				type: 'nexus.ui.stream.ack',
				id,
				generation: page.generation,
				revision: page.revision,
				delivery: page.delivery,
			}),
		);
	};

	const request = (
		input: AgentPluginUiHostInput,
		signal?: AbortSignal,
		file?: File,
	): Promise<AgentPluginUiHostResult> => {
		if (closed || signal?.aborted) return Promise.reject(new PluginUiRequestFailure('cancelled', 'not_dispatched'));
		const normalized = readAgentPluginUiHostInput(input);
		if (file !== undefined && normalized.kind !== 'artifact.upload') throw new InvalidAgentPayload();
		const id = crypto.randomUUID();
		encodeAgentJson({ type: 'nexus.ui.request', id, input: normalized }, AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
		return new Promise((resolve, reject) => {
			const mutation = normalized.kind !== 'artifact.selection.read' && normalized.kind !== 'feedback.confirm';

			const abort = () => {
				const owner = pending.get(id);
				if (!owner) return;
				pending.delete(id);
				owner.release();
				if (owner.dispatched) {
					try {
						post({ type: 'nexus.ui.cancel', id });
					} catch {
						// Cancellation cannot confirm that the admitted operation stopped.
					}
				}
				reject(
					new PluginUiRequestFailure(
						'cancelled',
						owner.dispatched ? (owner.mutation ? 'unknown' : 'confirmed') : 'not_dispatched',
					),
				);
			};

			pending.set(id, {
				input: normalized,
				mutation,
				dispatched: false,
				resolve,
				reject,

				release: () => signal?.removeEventListener('abort', abort),
			});
			signal?.addEventListener('abort', abort, { once: true });
			if (signal?.aborted) {
				abort();
				return;
			}
			try {
				if (file === undefined) post({ type: 'nexus.ui.request', id, input: normalized });
				else post({ type: 'nexus.ui.request', id, input: normalized, file });
				const owner = pending.get(id);
				if (owner) owner.dispatched = true;
			} catch (error) {
				pending.delete(id);
				signal?.removeEventListener('abort', abort);
				reject(error);
			}
		});
	};

	const subscribe = (consumer: AgentPluginUiStreamConsumer): AgentPluginUiStreamSubscription => {
		if (closed || !environment) throw new PluginUiRequestFailure('cancelled', 'not_dispatched');
		const source = readAgentPluginUiStreamSource(consumer.source());
		const id = crypto.randomUUID();

		let resolve: () => void = () => {};

		const completed = new Promise<void>((done) => {
			resolve = done;
		});
		const owner: Stream = { source, consumer, page: null, generation: 0, revision: 0, delivery: 0, resolve };
		streams.set(id, owner);
		try {
			post(readAgentPluginUiStreamCommand({ type: 'nexus.ui.stream.subscribe', id, source }));
		} catch (error) {
			streams.delete(id);
			resolve();
			throw error;
		}
		return {
			closed: completed,

			resume() {
				try {
					apply(id, owner);
				} catch (error) {
					streams.delete(id);
					owner.page = null;
					try {
						if (!closed) post(readAgentPluginUiStreamCommand({ type: 'nexus.ui.stream.unsubscribe', id }));
					} catch (cleanup) {
						throw new AggregateError([error, cleanup], 'Plugin UI application and unsubscribe failed');
					} finally {
						resolve();
					}
					throw error;
				}
			},

			close() {
				if (streams.get(id) !== owner) return;
				streams.delete(id);
				owner.page = null;
				try {
					if (!closed) post(readAgentPluginUiStreamCommand({ type: 'nexus.ui.stream.unsubscribe', id }));
				} finally {
					resolve();
				}
			},
		};
	};

	const handle = (input: unknown): boolean => {
		if (
			input === null ||
			typeof input !== 'object' ||
			!('type' in input) ||
			typeof input.type !== 'string' ||
			!input.type.startsWith('nexus.ui.')
		)
			return false;
		if (closed) return true;
		if (input.type === 'nexus.ui.environment') {
			const row = agentRecord(input, ['type', 'environment'], AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES);
			const next = readAgentPluginUiEnvironment(row.environment);
			if (next.appId !== appId) throw new InvalidAgentPayload();
			environment = next;
			readyResolve(readAgentPluginUiEnvironment(next));
			for (const listener of environmentListeners) listener(readAgentPluginUiEnvironment(next));
		} else if (input.type === 'nexus.ui.task.open') {
			const row = agentRecord(input, ['type', 'runId']);
			const runId = readAgentId(row.runId);
			for (const listener of taskListeners) listener(runId);
		} else if (input.type === 'nexus.ui.response' || input.type === 'nexus.ui.failure') {
			const row = agentRecord(
				input,
				input.type === 'nexus.ui.response' ? ['type', 'id', 'result'] : ['type', 'id', 'error'],
				AGENT_PLUGIN_MAX_FRONTEND_MESSAGE_BYTES,
			);
			const id = readAgentId(row.id);
			const owner = pending.get(id);
			if (!owner) return true;
			if (input.type === 'nexus.ui.response') {
				const result = readAgentPluginUiHostResult(row.result, owner.input, appId);
				pending.delete(id);
				owner.release();
				owner.resolve(result);
			} else {
				const failure = readAgentPluginUiHostFailure(row.error);
				pending.delete(id);
				owner.release();
				owner.reject(new PluginUiRequestFailure(failure.code, failure.outcome));
			}
		} else if (input.type === 'nexus.ui.stream.page') {
			if (!('id' in input)) throw new InvalidAgentPayload();
			const id = readAgentId(input.id);
			const owner = streams.get(id);
			if (!owner) return true;
			if (!environment || owner.page) throw new InvalidAgentPayload();
			const page = readAgentPluginUiStreamPage(input, owner.source, appId, environment.appVersion);
			if (
				page.delivery !== owner.delivery + 1 ||
				page.generation < owner.generation ||
				(page.generation === owner.generation ? page.revision !== owner.revision + 1 : page.revision !== 1) ||
				(page.generation > owner.generation && page.value.type === 'update' && page.value.state === null)
			)
				throw new InvalidAgentPayload();
			owner.generation = page.generation;
			owner.revision = page.revision;
			owner.delivery = page.delivery;
			owner.page = page;
			apply(id, owner);
		} else if (input.type === 'nexus.ui.stream.failure') {
			const failure = readAgentPluginUiStreamFailure(input);
			const owner = streams.get(failure.id);
			if (owner) {
				streams.delete(failure.id);
				owner.page = null;
				owner.resolve();
				owner.consumer.rejected(failure.code);
			}
		} else if (input.type === 'nexus.ui.closed') {
			agentRecord(input, ['type']);
			close();
		} else throw new InvalidAgentPayload();
		return true;
	};

	return {
		handle,
		close,
		ui: {
			ready,

			get environment() {
				return environment === null ? null : readAgentPluginUiEnvironment(environment);
			},

			onEnvironment(listener) {
				if (!closed) environmentListeners.add(listener);
				return () => {
					environmentListeners.delete(listener);
				};
			},

			onTaskOpen(listener) {
				if (!closed) taskListeners.add(listener);
				return () => {
					taskListeners.delete(listener);
				};
			},

			onClose(listener) {
				if (closed) listener();
				else closeListeners.add(listener);
				return () => {
					closeListeners.delete(listener);
				};
			},

			request,
			streams: { subscribe },
		},
	};
}
