import type { App } from 'vue';
import { logger } from '@/client/logging/logger';

let registered = false;

const sourcePath = (value: string): string | undefined => {
	try {
		return value ? new URL(value, window.location.href).pathname : undefined;
	} catch {
		return undefined;
	}
};

const pageContext = (): Record<string, unknown> => ({
	visibilityState: document.visibilityState,
	pathname: window.location.pathname,
});

export const registerGlobalRuntimeDiagnostics = (): void => {
	if (registered) return;
	registered = true;
	logger.info(pageContext(), 'Frontend runtime started');
	window.addEventListener('online', () => logger.info(pageContext(), 'Browser network online'));
	window.addEventListener('offline', () => logger.warn(pageContext(), 'Browser network offline'));
	document.addEventListener('visibilitychange', () => logger.debug(pageContext(), 'Frontend visibility changed'));
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
				err: event.error,
				source: 'window.error',
				filename: sourcePath(event.filename),
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
				err: event.reason,
				source: 'window.unhandledrejection',
				...pageContext(),
			},
			'Unhandled frontend promise rejection',
		);
	});
};

export const registerVueRuntimeDiagnostics = (app: App): void => {
	app.config.errorHandler = (err, _instance, phase) => {
		logger.error({ err, source: 'vue', phase }, 'Unhandled Vue error');
	};
};
