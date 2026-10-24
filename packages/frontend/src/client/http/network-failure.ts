import { HttpRequestFailure } from './request-failure';
import { WebSocketConnectionFailure } from '../websocket/connection-failure';
import { logger } from '../logging/logger';
import { isAxiosError, isCancel } from 'axios';

let failureHandler: (() => void) | null = null;

const READ_RECOVERY_GRACE_MS = 10_000;

interface PendingReadFeedback {
	timer?: ReturnType<typeof setTimeout>;
	revision: number;
	stopObserving?: () => void;
}

const pendingReads = new Map<string | symbol, PendingReadFeedback>();

function scheduleReadFailure(source: string | symbol): void {
	const pending = pendingReads.get(source);
	if (!pending || pending.timer !== undefined || document.hidden) return;
	const revision = ++pending.revision;
	const dueAt = Date.now() + READ_RECOVERY_GRACE_MS;
	pending.timer = setTimeout(() => {
		if (pendingReads.get(source) !== pending || pending.revision !== revision) return;
		pending.timer = undefined;
		if (document.hidden) return;
		// Frozen pages can run overdue timers before dispatching visibilitychange.
		if (Date.now() - dueAt > 1000) {
			scheduleReadFailure(source);
			return;
		}
		clearPendingNetworkFailure(source);
		reportNetworkFailure();
	}, READ_RECOVERY_GRACE_MS);
}

function syncReadFeedbackVisibility(): void {
	for (const [source, pending] of pendingReads) {
		clearTimeout(pending.timer);
		pending.timer = undefined;
		pending.revision += 1;
		scheduleReadFailure(source);
	}
}

export function setNetworkFailureHandler(handler: (() => void) | null): void {
	document.removeEventListener('visibilitychange', syncReadFeedbackVisibility);
	window.removeEventListener('pageshow', syncReadFeedbackVisibility);
	for (const source of pendingReads.keys()) clearPendingNetworkFailure(source);
	failureHandler = handler;
	if (handler) {
		document.addEventListener('visibilitychange', syncReadFeedbackVisibility);
		window.addEventListener('pageshow', syncReadFeedbackVisibility);
	}
}

/** Read sources get a recovery grace period; mutations always report immediately. */
export function reportNetworkFailure(readSource?: string | symbol, signal?: AbortSignal): void {
	if (readSource !== undefined) {
		if (!failureHandler || signal?.aborted) return;
		const pending: PendingReadFeedback = pendingReads.get(readSource) ?? { revision: 0 };
		pendingReads.set(readSource, pending);
		pending.stopObserving?.();
		pending.stopObserving = undefined;
		if (signal) {
			const cancel = () => {
				if (pendingReads.get(readSource) === pending && pending.stopObserving === stopObserving) {
					clearPendingNetworkFailure(readSource);
				}
			};

			const stopObserving = () => signal.removeEventListener('abort', cancel);

			pending.stopObserving = stopObserving;
			signal.addEventListener('abort', cancel, { once: true });
		}
		scheduleReadFailure(readSource);
		return;
	}
	try {
		failureHandler?.();
	} catch (cause) {
		logger.error({ err: cause }, 'Failed to publish HTTP network feedback');
	}
}

/** Cancels only pending read feedback, never a visible notification or a write outcome. */
export function clearPendingNetworkFailure(readSource: string | symbol): void {
	const pending = pendingReads.get(readSource);
	clearTimeout(pending?.timer);
	pending?.stopObserving?.();
	pendingReads.delete(readSource);
}

export function isNetworkFailure(value: unknown): boolean {
	const visited = new Set<Error>();
	while (value instanceof Error && !visited.has(value)) {
		visited.add(value);
		if (value instanceof HttpRequestFailure && value.code === 'request_failed') return true;
		if (value instanceof WebSocketConnectionFailure) return true;
		if (
			isAxiosError(value) &&
			!value.response &&
			!isCancel(value) &&
			['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(value.code ?? '')
		)
			return true;
		value = value.cause;
	}
	return false;
}
