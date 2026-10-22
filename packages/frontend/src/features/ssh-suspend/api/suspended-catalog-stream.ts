import {
	readSuspendedCatalogEvent,
	SUSPENDED_STREAM_MAX_JSON_BYTES,
} from '@nexus-terminal/shared/remote/suspend/events';
import { openWebSocket, WebSocketConnectionFailure } from '@/client/websocket';
import { reportNetworkFailure } from '@/client/http/network-failure';
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
	let retryDelay = 1000;

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
		if (cause.code === 'request_failed') {
			reportNetworkFailure();
			cause = new SuspendedRequestFailure('request_failed', 'not_dispatched', undefined, {
				cause: new WebSocketConnectionFailure({ cause }),
			});
		}
		onUnavailable(cause);
		if (document.hidden || !navigator.onLine) {
			return;
		}
		retryTimer = setTimeout(connect, retryDelay + Math.floor(Math.random() * 250));
		retryDelay = Math.min(retryDelay * 2, 30_000);
	};

	const connect = () => {
		stopSocket();
		if (disposed || document.hidden || !navigator.onLine) {
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
				armDeadline();
				if (event.type === 'snapshot' && event.revision > revision) {
					revision = event.revision;
					retryDelay = 1000;
					onSnapshot(event.sessions.map(toSuspendedSession));
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
		if (!document.hidden && navigator.onLine) {
			retryDelay = 1000;
			connect();
		} else {
			stopSocket();
		}
	};

	document.addEventListener('visibilitychange', refreshConnection);
	window.addEventListener('online', refreshConnection);
	window.addEventListener('offline', refreshConnection);
	connect();
	return () => {
		disposed = true;
		stopSocket();
		document.removeEventListener('visibilitychange', refreshConnection);
		window.removeEventListener('online', refreshConnection);
		window.removeEventListener('offline', refreshConnection);
	};
}
