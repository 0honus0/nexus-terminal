import type { HistoryErrorCode } from '@nexus-terminal/shared/preferences/history/values';

export class HistoryFailure extends Error {
	constructor(
		readonly code: HistoryErrorCode,
		options?: ErrorOptions,
	) {
		super('History failed: ' + code, options);
		this.name = 'HistoryFailure';
	}
}
