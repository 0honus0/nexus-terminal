import pino from 'pino';
import { FRONTEND_LOG_LEVELS, type FrontendLogLevel } from '@nexus-terminal/shared/preferences/presentation/values';

const isLogLevel = (value: unknown): value is FrontendLogLevel =>
	typeof value === 'string' && FRONTEND_LOG_LEVELS.some((level) => level === value);

/** Error messages and custom properties can contain user input, URLs or credentials. */
const serializeError = (value: unknown): object => {
	if (!(value instanceof Error)) return { type: typeof value };
	const type = [
		'Error',
		'TypeError',
		'RangeError',
		'ReferenceError',
		'SyntaxError',
		'URIError',
		'EvalError',
		'AggregateError',
	].includes(value.name)
		? value.name
		: 'Error';
	const frames: Array<{ source: string; line: number; column: number }> = [];
	for (const frame of value.stack?.split('\n').slice(1) ?? []) {
		const location = /(https?:\/\/[^\s)]+):(\d+):(\d+)/.exec(frame);
		const source = location?.[1];
		if (!location || !source) continue;
		try {
			frames.push({ source: new URL(source).pathname, line: Number(location[2]), column: Number(location[3]) });
		} catch {
			// A malformed stack frame is not safe diagnostic context.
		}
	}
	return { type, frames };
};

export const logger = pino({
	level: 'info',
	// console.trace captures a stack for every frame/request and can dominate a busy terminal.
	browser: { asObject: true, serialize: ['err'], write: { trace: (entry: object) => console.debug(entry) } },
	serializers: { err: serializeError },
	redact: {
		paths: [
			'password',
			'passphrase',
			'secret',
			'token',
			'authorization',
			'cookie',
			'*.password',
			'*.passphrase',
			'*.secret',
			'*.token',
			'*.authorization',
			'*.cookie',
			'err.config.headers.Authorization',
			'err.config.headers.authorization',
		],
		censor: '[REDACTED]',
	},
});

export const setFrontendLogLevel = (value: unknown, announceChange = true): FrontendLogLevel => {
	const level = isLogLevel(value) ? value : 'info';
	const previousLevel = isLogLevel(logger.level) ? logger.level : 'info';
	if (level === previousLevel) return level;
	logger.level = level;
	if (announceChange) logger.info({ previousLevel, logLevel: level }, 'Frontend log level changed');
	return level;
};
