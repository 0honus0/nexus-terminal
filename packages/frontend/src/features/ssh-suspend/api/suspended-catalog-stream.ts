import {
	readSuspendedCatalogEvent,
	SUSPENDED_STREAM_MAX_JSON_BYTES,
} from '@nexus-terminal/shared/remote/suspend/events';
import { openWebSocket, WebSocketConnectionFailure } from '@/client/websocket';
import { clearPendingNetworkFailure, reportNetworkFailure } from '@/client/http/network-failure';
import { toSuspendedSession } from '../model/suspended-session-mapper';
import { SuspendedRequestFailure, type SuspendedSession } from '../model/suspended-session-types';

export function subscribeSuspendedCatalog(
	onSnapshot: (sessions: SuspendedSession[]) => void,
	onUnavailable: (cause: SuspendedRequestFailure) => void,
): () => void {
	let disposed = false;
	let socket: WebSocket | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const networkFeedbackSource = Symbol();
	let retryDelay = 1000;
	const browserConnection =
		'connection' in navigator && navigator.connection instanceof EventTarget ? navigator.connection : undefined;

	const stopSocket = () => {
		clearTimeout(retryTimer);
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
	};

	const retry = (cause: SuspendedRequestFailure) => {
		stopSocket();
		if (disposed) {
			return;
		}
		if (document.hidden) {
			clearPendingNetworkFailure(networkFeedbackSource);
			return;
		}
		if (cause.code === 'request_failed') {
			reportNetworkFailure(networkFeedbackSource);
			cause = new SuspendedRequestFailure('request_failed', 'not_dispatched', undefined, {
				cause: new WebSocketConnectionFailure({ cause }),
			});
		} else {
			clearPendingNetworkFailure(networkFeedbackSource);
		}
		onUnavailable(cause);
		retryTimer = setTimeout(connect, retryDelay + Math.floor(Math.random() * 250));
		retryDelay = Math.min(retryDelay * 2, 30_000);
	};

	const connect = () => {
		stopSocket();
		// Browser connectivity hints can remain offline while this origin is reachable.
		// Only the actual transport result decides whether the visible catalog can load.
		if (disposed || document.hidden) {
			return;
		}
		let current: WebSocket;
		try {
			current = openWebSocket('/ws/suspended-sessions');
		} catch (cause) {
			retry(new SuspendedRequestFailure('request_failed', 'not_dispatched', undefined, { cause }));
			return;
		}
		socket = current;
		let revision = 0;
		let receivedSnapshot = false;

		const armDeadline = () => {
			clearTimeout(deadline);
			deadline = setTimeout(() => {
				if (socket === current) {
					retry(new SuspendedRequestFailure('request_failed', 'not_dispatched'));
				}
			}, 45_000);
		};

		armDeadline();
		current.onmessage = (message: MessageEvent<unknown>) => {
			if (socket !== current || disposed) {
				return;
			}
			try {
				if (
					typeof message.data !== 'string' ||
					new TextEncoder().encode(message.data).length > SUSPENDED_STREAM_MAX_JSON_BYTES
				) {
					throw new SuspendedRequestFailure('protocol_failure', 'not_dispatched');
				}
				const value: unknown = JSON.parse(message.data);
				const event = readSuspendedCatalogEvent(value);
				if (event.type === 'snapshot' && event.revision > revision) {
					receivedSnapshot = true;
					clearPendingNetworkFailure(networkFeedbackSource);
					revision = event.revision;
					retryDelay = 1000;
					onSnapshot(event.sessions.map(toSuspendedSession));
				}
				// Heartbeats prove transport activity, not delivery of the first catalog.
				if (receivedSnapshot) {
					armDeadline();
				}
			} catch (cause) {
				retry(new SuspendedRequestFailure('protocol_failure', 'not_dispatched', undefined, { cause }));
			}
		};
		current.onclose = (event) => {
			if (socket === current && !disposed) {
				retry(
					new SuspendedRequestFailure(event.code === 1008 ? 'forbidden' : 'request_failed', 'not_dispatched'),
				);
			}
		};
		current.onerror = () => {
			if (socket === current && !disposed) {
				retry(new SuspendedRequestFailure('request_failed', 'not_dispatched'));
			}
		};
	};

	const refreshConnection = () => {
		clearPendingNetworkFailure(networkFeedbackSource);
		if (!document.hidden) {
			retryDelay = 1000;
			connect();
		} else {
			stopSocket();
		}
	};

	document.addEventListener('visibilitychange', refreshConnection);
	window.addEventListener('pageshow', refreshConnection);
	window.addEventListener('online', refreshConnection);
	window.addEventListener('offline', refreshConnection);
	browserConnection?.addEventListener('change', refreshConnection);
	connect();
	return () => {
		disposed = true;
		stopSocket();
		clearPendingNetworkFailure(networkFeedbackSource);
		document.removeEventListener('visibilitychange', refreshConnection);
		window.removeEventListener('pageshow', refreshConnection);
		window.removeEventListener('online', refreshConnection);
		window.removeEventListener('offline', refreshConnection);
		browserConnection?.removeEventListener('change', refreshConnection);
	};
}
