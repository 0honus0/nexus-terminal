import pino from 'pino';
import type { Logger, LogSeverity, LogThreshold, LogFact } from './logger.js';

export class PinoLogger implements Logger {
	private readonly output = pino(
		{
			level: 'info',
			base: null,
			timestamp: false,
			formatters: { level: (severity) => ({ severity }) },
		},
		pino.destination({ dest: 2, sync: true }),
	);

	setThreshold(level: LogThreshold): void {
		this.output.level = level;
	}

	write(severity: LogSeverity, code: string, facts: readonly LogFact[]): void {
		if (!this.output.isLevelEnabled(severity)) {
			return;
		}
		if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(code) || facts.length > 32) {
			throw new Error('Invalid log envelope');
		}
		const value = {
			time: Date.now(),
			severity,
			code,
			facts: facts.map((fact) => ({ name: fact.name, value: fact.value })),
		};
		const text = JSON.stringify(value);
		if (Buffer.byteLength(text, 'utf8') > 16384) {
			throw new Error('Log envelope too large');
		}
		this.output[severity]({ time: value.time, code: value.code, facts: value.facts });
	}
}
