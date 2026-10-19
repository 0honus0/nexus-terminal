import type { SettingsErrorCode } from '@nexus-terminal/shared/preferences/configuration/values';

export class PreferencesFailure extends Error {
	constructor(
		readonly code: SettingsErrorCode,
		options?: ErrorOptions,
	) {
		super('Preferences failed: ' + code, options);
		this.name = 'PreferencesFailure';
	}
}
