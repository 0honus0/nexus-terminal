import type { TerminalThemeErrorCode } from '@nexus-terminal/shared/preferences/themes/values';

export class ThemeFailure extends Error {
	constructor(
		readonly code: TerminalThemeErrorCode,
		options?: ErrorOptions,
	) {
		super('Theme operation failed: ' + code, options);
		this.name = 'ThemeFailure';
	}
}
