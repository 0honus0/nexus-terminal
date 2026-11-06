import {
	AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES,
	AGENT_RUN_STREAM_MAX_JSON_BYTES,
} from '@nexus-terminal/shared/agent/runs/values';
import { logger } from '@/client/logging/logger';
import { openWebSocket } from '@/client/websocket';
import { clearPendingNetworkFailure, reportNetworkFailure } from '@/client/http/network-failure';
import {
	readAgentRunStreamEvent,
	readAgentRunStreamCommand,
	readAgentRunSubscription,
} from '@nexus-terminal/shared/agent/runs/events';
import type { NativeThreadScope } from '../model/native-thread-types';
import type { NativeRunSubscription, NativeRunStreamCursor, NativeRunUpdate } from '../model/native-run-types';
import type { AgentRunStreamCursor, AgentRunStreamUpdate } from '@nexus-terminal/shared/agent/runs/events';
import { fromNativeRunUpdate } from '../model/native-run-mapper';
import { AgentManagementFailure } from '../model/management-failure';

/** Direct committed text/status delivery with bounded receive buffering and cursor acknowledgements. */
export function subscribeNativeRun(
	scope: NativeThreadScope,
	runId: string,
	getCursor: () => NativeRunStreamCursor,
	onUpdate: (update: NativeRunUpdate) => boolean,
	onRejected: (cause: AgentManagementFailure) => void,
): NativeRunSubscription {
	const query = new URLSearchParams({ appId: scope.appId, appVersion: String(scope.appVersion), runId });
	const selected = readAgentRunSubscription(query);
	const networkSource = Symbol();
	const context = { appId: scope.appId, runId };
	let recovering = false;
	let disposed = false;
	let socket: WebSocket | null = null;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	let delay = 1000;
	const browserConnection =
		'connection' in navigator && navigator.connection instanceof EventTarget ? navigator.connection : undefined;

	let resume = () => {};

	function stopSocket(): void {
		resume = () => {};
		clearTimeout(retry);
		clearTimeout(deadline);
		const previous = socket;
		socket = null;
		if (previous) {
			previous.onopen = null;
			previous.onmessage = null;
			previous.onclose = null;
			previous.onerror = null;
			previous.close();
		}
	}

	function reject(code: 'forbidden' | 'protocol_failure'): void {
		if (code === 'protocol_failure') logger.error({ ...context, code }, 'Agent stream rejected');
		else logger.debug({ ...context, code }, 'Agent stream access revoked');
		stopSocket();
		disposed = true;
		clearPendingNetworkFailure(networkSource);
		onRejected(new AgentManagementFailure(code, 'not_dispatched'));
	}

	function reconnect(reason: 'open_failed' | 'send_failed' | 'deadline' | 'closed' | 'transport_error'): void {
		stopSocket();
		if (disposed || document.hidden) return;
		recovering = true;
		logger.warn({ ...context, reason, retryDelayMs: delay }, 'Agent stream reconnect scheduled');
		reportNetworkFailure(networkSource);
		retry = setTimeout(connect, delay + Math.floor(Math.random() * 250));
		delay = Math.min(delay * 2, 30_000);
	}

	function connect(): void {
		stopSocket();
		// Connectivity hints may remain offline even while this origin is reachable.
		if (disposed || document.hidden) return;
		let current: WebSocket;
		try {
			logger.debug(context, 'Agent stream connecting');
			current = openWebSocket('/ws/agent-runs?' + query.toString());
		} catch {
			reconnect('open_failed');
			return;
		}
		socket = current;
		let revision = 0;
		let cursor: AgentRunStreamCursor | null = null;
		const pending: Array<{ update: AgentRunStreamUpdate; bytes: number }> = [];
		let pendingBytes = 0;
		current.onopen = () => {
			if (socket !== current || disposed) return;
			let encoded: string;
			try {
				const initial = getCursor();
				cursor = {
					threadId: initial.threadId,
					events: initial.events,
					approvals: null,
					entries: {
						runSequence: initial.entries.runSequence,
						stepIndex: initial.entries.stepIndex,
						eventSequence: initial.entries.eventSequence,
						textOffset: initial.entries.textOffset,
					},
				};
				encoded = JSON.stringify(readAgentRunStreamCommand({ type: 'subscribe', cursor }));
			} catch {
				reject('protocol_failure');
				return;
			}
			try {
				current.send(encoded);
			} catch {
				reconnect('send_failed');
			}
		};
		resume = () => {
			while (socket === current && !disposed && pending.length > 0) {
				const item = pending[0];
				if (!item) return;
				try {
					if (item.update.state && item.update.state.run.version < getCursor().runVersion) {
						throw new AgentManagementFailure('protocol_failure', 'not_dispatched');
					}
					if (!onUpdate(fromNativeRunUpdate(item.update)) || disposed || socket !== current) return;
				} catch {
					reject('protocol_failure');
					return;
				}
				pending.shift();
				pendingBytes -= item.bytes;
				try {
					current.send(
						JSON.stringify(readAgentRunStreamCommand({ type: 'ack', revision: item.update.revision })),
					);
				} catch {
					reconnect('send_failed');
					return;
				}
			}
		};

		function armDeadline(): void {
			clearTimeout(deadline);
			deadline = setTimeout(() => {
				if (socket === current) reconnect('deadline');
			}, 45_000);
		}

		armDeadline();
		current.onmessage = (message: MessageEvent<unknown>) => {
			if (disposed || socket !== current) return;
			try {
				if (typeof message.data !== 'string')
					throw new AgentManagementFailure('protocol_failure', 'not_dispatched');
				const bytes = new TextEncoder().encode(message.data).length;
				if (bytes > AGENT_RUN_STREAM_MAX_JSON_BYTES)
					throw new AgentManagementFailure('protocol_failure', 'not_dispatched');
				const input: unknown = JSON.parse(message.data);
				if (!cursor) throw new AgentManagementFailure('protocol_failure', 'not_dispatched');
				const event = readAgentRunStreamEvent(input, selected, cursor);
				if (event.type === 'update') {
					if (
						pending.length >= AGENT_RUN_STREAM_MAX_IN_FLIGHT_PAGES ||
						pendingBytes + bytes > AGENT_RUN_STREAM_MAX_JSON_BYTES ||
						event.revision !== revision + 1 ||
						(revision === 0 && event.state === null)
					) {
						throw new AgentManagementFailure('protocol_failure', 'not_dispatched');
					}
					revision = event.revision;
					pending.push({ update: event, bytes });
					pendingBytes += bytes;
					cursor = {
						threadId: cursor.threadId,
						entries: {
							runSequence: event.body.nextCursor.runSequence,
							stepIndex: event.body.nextCursor.stepIndex,
							eventSequence: event.body.nextCursor.eventSequence,
							textOffset: event.body.nextCursor.textOffset,
						},
						events: event.state?.events.nextCursor ?? cursor.events,
						approvals: event.state
							? event.state.approvals.hasMore
								? event.state.approvals.nextCursor
								: null
							: cursor.approvals,
					};
					resume();
				}
				if (socket !== current || disposed) return;
				// A heartbeat cannot substitute for the first accepted task snapshot.
				if (revision > 0) {
					if (recovering) {
						logger.info(context, 'Agent stream recovered');
						recovering = false;
					}
					armDeadline();
					delay = 1000;
					clearPendingNetworkFailure(networkSource);
				}
			} catch {
				reject('protocol_failure');
			}
		};
		current.onclose = (event) => {
			if (socket !== current || disposed) return;
			if (event.code === 1008) reject('forbidden');
			else reconnect('closed');
		};
		current.onerror = () => {
			if (socket === current && !disposed) reconnect('transport_error');
		};
	}

	function onNetworkChange(): void {
		logger.debug({ ...context, online: navigator.onLine }, 'Agent stream network changed');
		delay = 1000;
		connect();
	}

	window.addEventListener('online', onNetworkChange);
	window.addEventListener('offline', onNetworkChange);
	browserConnection?.addEventListener('change', onNetworkChange);
	connect();
	return {
		resume: () => resume(),

		close() {
			logger.debug(context, 'Agent stream subscription closed');
			disposed = true;
			stopSocket();
			clearPendingNetworkFailure(networkSource);
			window.removeEventListener('online', onNetworkChange);
			window.removeEventListener('offline', onNetworkChange);
			browserConnection?.removeEventListener('change', onNetworkChange);
		},
	};
}
