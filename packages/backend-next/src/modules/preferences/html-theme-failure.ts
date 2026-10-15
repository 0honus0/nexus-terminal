import type { HtmlThemeErrorCode } from '@nexus-terminal/shared/preferences/html-themes/values';

export class HtmlThemeFailure extends Error {
	constructor(
		readonly code: HtmlThemeErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'HtmlThemeFailure';
	}
}

export class HtmlThemeResourceFailure extends HtmlThemeFailure {
	constructor(options?: ErrorOptions) {
		super('cleanup_failed', options);
		this.name = 'HtmlThemeResourceFailure';
	}
}
