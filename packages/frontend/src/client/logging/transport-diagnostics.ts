import { logger } from './logger';

let nextRequestId = 0;

/** Transport metadata only: never record query strings, headers, bodies or exception text. */
export function beginHttpDiagnostic(method: string, url: string): (status: number | null, code?: string) => void {
	const path = new URL(url, window.location.href).pathname;
	const requestId = ++nextRequestId;
	const startedAt = performance.now();
	let finished = false;
	logger.debug({ requestId, method, path }, 'HTTP request dispatch');
	return (status, code) => {
		if (finished) return;
		finished = true;
		const context = {
			requestId,
			method,
			path,
			status,
			code,
			durationMs: Math.round(performance.now() - startedAt),
		};
		if (code === 'cancelled') logger.debug(context, 'HTTP request cancelled');
		else if (code === 'protocol_failure' || (status !== null && status >= 500))
			logger.error(context, 'HTTP request failed');
		else if (code) logger.warn(context, 'HTTP request failed');
		else if (status !== null && status >= 400) logger.debug(context, 'HTTP request rejected');
		else logger.debug(context, 'HTTP request completed');
	};
}
