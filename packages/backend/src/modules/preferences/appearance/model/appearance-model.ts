import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { AppearanceFailure } from '../../appearance-failure.js';
import type { AppearanceStorage, StoredAppearance, StoredAppearanceWrite } from '../storage/appearance-storage.js';
import type {
	AppearanceActor,
	AppearanceRecord,
	AppearanceSettings,
	AppearanceWriteFacts,
	AppearanceAccessResult,
} from './appearance-types.js';

export function fromStoredAppearance(row: StoredAppearance): AppearanceRecord {
	return {
		version: row.version,
		activeTerminalThemeId: row.activeThemeId,
		customUiTheme: copyUiTheme(row.settings.customUiTheme),
		terminalFontFamily: row.settings.terminalFontFamily,
		terminalFontSize: row.settings.terminalFontSize,
		terminalFontSizeMobile: row.settings.terminalFontSizeMobile,
		editorFontSize: row.settings.editorFontSize,
		editorFontFamily: row.settings.editorFontFamily,
		mobileEditorFontSize: row.settings.mobileEditorFontSize,
		terminalBackgroundId: row.settings.terminalBackgroundId,
		pageBackgroundId: row.settings.pageBackgroundId,
		terminalBackgroundEnabled: row.settings.terminalBackgroundEnabled,
		terminalBackgroundOverlayOpacity: row.settings.terminalBackgroundOverlayOpacity,
		terminalCustomHtml: row.settings.terminalCustomHtml,
		remoteHtmlPresetsUrl: row.settings.remoteHtmlPresetsUrl,
		windowThemeColor: row.settings.windowThemeColor,
		terminalTextStrokeEnabled: row.settings.terminalTextStrokeEnabled,
		terminalTextStrokeWidth: row.settings.terminalTextStrokeWidth,
		terminalTextStrokeColor: row.settings.terminalTextStrokeColor,
		terminalTextShadowEnabled: row.settings.terminalTextShadowEnabled,
		terminalTextShadowOffsetX: row.settings.terminalTextShadowOffsetX,
		terminalTextShadowOffsetY: row.settings.terminalTextShadowOffsetY,
		terminalTextShadowBlur: row.settings.terminalTextShadowBlur,
		terminalTextShadowColor: row.settings.terminalTextShadowColor,
	};
}

function toStorage(input: AppearanceSettings): StoredAppearanceWrite {
	return {
		activeThemeId: input.activeTerminalThemeId,
		settings: {
			customUiTheme: copyUiTheme(input.customUiTheme),
			terminalFontFamily: input.terminalFontFamily,
			terminalFontSize: input.terminalFontSize,
			terminalFontSizeMobile: input.terminalFontSizeMobile,
			editorFontSize: input.editorFontSize,
			editorFontFamily: input.editorFontFamily,
			mobileEditorFontSize: input.mobileEditorFontSize,
			terminalBackgroundId: input.terminalBackgroundId,
			pageBackgroundId: input.pageBackgroundId,
			terminalBackgroundEnabled: input.terminalBackgroundEnabled,
			terminalBackgroundOverlayOpacity: input.terminalBackgroundOverlayOpacity,
			terminalCustomHtml: input.terminalCustomHtml,
			remoteHtmlPresetsUrl: input.remoteHtmlPresetsUrl,
			windowThemeColor: input.windowThemeColor,
			terminalTextStrokeEnabled: input.terminalTextStrokeEnabled,
			terminalTextStrokeWidth: input.terminalTextStrokeWidth,
			terminalTextStrokeColor: input.terminalTextStrokeColor,
			terminalTextShadowEnabled: input.terminalTextShadowEnabled,
			terminalTextShadowOffsetX: input.terminalTextShadowOffsetX,
			terminalTextShadowOffsetY: input.terminalTextShadowOffsetY,
			terminalTextShadowBlur: input.terminalTextShadowBlur,
			terminalTextShadowColor: input.terminalTextShadowColor,
		},
	};
}

export class AppearanceModel {
	constructor(
		private readonly storage: AppearanceStorage,
		private readonly tokens: SessionTokens,
	) {}

	async access(
		actor: AppearanceActor,
		requestedThemeId: number | null,
		defaultPresetKey: string,
		admitIdentity: (userId: number | null) => void,
		decide: (facts: AppearanceWriteFacts) => AppearanceSettings | null,
	): Promise<AppearanceAccessResult> {
		let changed = false;
		let saved: StoredAppearance;
		try {
			saved = await this.storage.access(
				actor.userId,
				requestedThemeId,
				defaultPresetKey,
				{ sessionDigest: this.tokens.digest(actor.token), admit: admitIdentity },
				(facts) => {
					const decision = decide({
						current: facts.current === null ? null : fromStoredAppearance(facts.current),
						selectedThemeExists: facts.selectedThemeExists,
						defaultThemeId: facts.defaultThemeId,
					});
					changed = decision !== null;
					return decision === null ? null : toStorage(decision);
				},
			);
		} catch (cause) {
			if (cause instanceof AppearanceFailure) {
				throw cause;
			}
			if (cause instanceof SqliteFailure) {
				throw new AppearanceFailure(
					cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed'
						? 'operation_unknown'
						: 'storage_unavailable',
					{ cause },
				);
			}
			throw new AppearanceFailure('internal_failure', { cause });
		}
		try {
			return { value: fromStoredAppearance(saved), changed };
		} catch (cause) {
			throw new AppearanceFailure(changed ? 'operation_unknown' : 'internal_failure', { cause });
		}
	}
}

function copyUiTheme(input: Readonly<Record<string, string>>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(input)) {
		result[key] = value;
	}
	return result;
}
