import { writeSync } from 'node:fs';
import type { Logger, LogSeverity, LogThreshold, LogFact } from './logger.js';
const RANK: Record<LogThreshold, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export class NativeLogger implements Logger {
	private threshold: LogThreshold = 'info';

	setThreshold(level: LogThreshold): void {
		this.threshold = level;
	}

	write(severity: LogSeverity, code: string, facts: readonly LogFact[]): void {
		if (RANK[severity] < RANK[this.threshold]) {
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
		writeSync(2, text + '\n');
	}
}
