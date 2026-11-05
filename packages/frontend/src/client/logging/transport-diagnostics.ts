import { logger } from './logger';

/** Transport metadata only: never record query strings, headers, bodies or exception text. */
export function beginHttpDiagnostic(method: string, url: string): (status: number | null, code?: string) => void {
	const path = new URL(url, window.location.href).pathname;
	const startedAt = performance.now();
	logger.trace({ method, path }, 'HTTP request dispatch');
	return (status, code) => {
		const context = { method, path, status, code, durationMs: Math.round(performance.now() - startedAt) };
		if (code === 'cancelled') logger.debug(context, 'HTTP request cancelled');
		else if (code || (status !== null && status >= 500)) logger.warn(context, 'HTTP request failed');
		else if (status !== null && status >= 400) logger.debug(context, 'HTTP request rejected');
		else logger.trace(context, 'HTTP request completed');
	};
}
