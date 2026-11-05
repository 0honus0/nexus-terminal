import { logger } from '@/client/logging/logger';

let registered = false;

const normalizeError = (value: unknown): Error => {
	if (value instanceof Error) return value;
	if (typeof value === 'string') return new Error(value);
	try {
		return new Error(JSON.stringify(value));
	} catch {
		return new Error(String(value));
	}
};

const pageContext = (): Record<string, unknown> => ({
	visibilityState: document.visibilityState,
	pathname: window.location.pathname,
});

export const registerGlobalRuntimeDiagnostics = (): void => {
	if (registered) return;
	registered = true;
	if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
		const observer = new PerformanceObserver((list) => {
			if (!logger.isLevelEnabled('trace') || document.hidden) return;
			const entries = list.getEntries();
			logger.trace(
				{
					...pageContext(),
					count: entries.length,
					totalDurationMs: Math.round(entries.reduce((total, entry) => total + entry.duration, 0)),
					longestDurationMs: Math.round(Math.max(0, ...entries.map((entry) => entry.duration))),
				},
				'Frontend main thread long tasks',
			);
		});
		observer.observe({ type: 'longtask', buffered: false });
	}

	window.addEventListener('error', (event) => {
		logger.error(
			{
				err: normalizeError(event.error ?? event.message),
				source: 'window.error',
				filename: event.filename || undefined,
				line: event.lineno || undefined,
				column: event.colno || undefined,
				...pageContext(),
			},
			'Unhandled frontend error',
		);
	});

	window.addEventListener('unhandledrejection', (event) => {
		logger.error(
			{
				err: normalizeError(event.reason),
				source: 'window.unhandledrejection',
				...pageContext(),
			},
			'Unhandled frontend promise rejection',
		);
	});
};
