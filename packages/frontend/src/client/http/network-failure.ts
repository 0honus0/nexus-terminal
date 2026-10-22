import { HttpRequestFailure } from './request-failure';
import { WebSocketConnectionFailure } from '../websocket/connection-failure';
import { logger } from '../logging/logger';
import { isAxiosError, isCancel } from 'axios';

let failureHandler: (() => void) | null = null;

export function setNetworkFailureHandler(handler: (() => void) | null): void {
	failureHandler = handler;
}

export function reportNetworkFailure(): void {
	try {
		failureHandler?.();
	} catch (cause) {
		logger.error({ err: cause }, 'Failed to publish HTTP network feedback');
	}
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
