import type { AppearanceErrorCode } from '@nexus-terminal/shared/preferences/appearance/values';
import type { TerminalThemeErrorCode } from '@nexus-terminal/shared/preferences/themes/values';
import type { HtmlThemeErrorCode } from '@nexus-terminal/shared/preferences/html-themes/values';
import type { HttpRequestFailureCode, RequestOutcome } from '@/client/http/request-failure';

export type AppearanceFailureCode =
	AppearanceErrorCode | TerminalThemeErrorCode | HtmlThemeErrorCode | HttpRequestFailureCode | 'refresh_required';

export class AppearanceRequestFailure extends Error {
	constructor(
		readonly code: AppearanceFailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Appearance request failed', options);
		this.name = 'AppearanceRequestFailure';
	}
}

export function appearanceFailureKey(cause: unknown): string {
	if (!(cause instanceof AppearanceRequestFailure)) {
		return 'appearanceNext.failed';
	}
	if (cause.outcome === 'unknown') {
		return 'appearanceNext.unknown';
	}
	if (cause.code === 'version_conflict' || cause.code === 'source_changed') {
		return 'appearanceNext.conflict';
	}
	if (cause.code === 'refresh_required') {
		return 'appearanceNext.refreshRequired';
	}
	if (cause.code === 'invalid_input' || cause.code === 'limit_exceeded' || cause.code === 'unsupported_media_type') {
		return 'appearanceNext.invalid';
	}
	return 'appearanceNext.failed';
}
