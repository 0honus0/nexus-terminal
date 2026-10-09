import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import type { SettingsResponseDto, SettingsUpdateRequestDto } from '@nexus-terminal/protocol/settings';
import { httpClient } from '@/client/http';
import {
	defaultPreferences,
	type PreferenceKey,
	type PreferencesPatchDto,
	type PreferencesDto,
} from '../model/preferences';

const mergePreferences = (raw: SettingsResponseDto, fallbackLanguage: string): PreferencesDto => {
	const result = { ...defaultPreferences, language: fallbackLanguage };
	for (const key of Object.keys(defaultPreferences) as PreferenceKey[]) {
		const value = raw[key];
		if (value !== undefined) (result as Record<string, unknown>)[key] = value;
	}
	return result;
};

export const preferencesApi = {
	async load(fallbackLanguage = defaultPreferences.language): Promise<PreferencesDto> {
		const settings = await httpClient.get<SettingsResponseDto>('/settings');
		return mergePreferences(settings.data, fallbackLanguage);
	},

	async update(patch: PreferencesPatchDto): Promise<void> {
		if (!Object.keys(patch).length) return;
		const request: SettingsUpdateRequestDto = patch;
		await httpClient.put<MessageResponseDto>('/settings', request);
	},
};
