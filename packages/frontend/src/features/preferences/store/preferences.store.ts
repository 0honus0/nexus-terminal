import { defineStore } from 'pinia';
import { computed, watch } from 'vue';
import { setFrontendLogLevel } from '@/client/logging/logger';
import { PreferenceRequestFailure } from '@/client/preferences/preference-request';
import { usePresentationStore } from './presentation.store';
import {
	defaultPreferences,
	type PreferencesPatch,
	type UserPreferences,
	type PanelScaleKind,
	type WorkspacePreferenceKey,
} from '../model/preferences-types';
import { projectPreferences } from '../model/presentation-mapper';

export const usePreferencesStore = defineStore('preferences', () => {
	const presentation = usePresentationStore();
	const values = computed(() => presentation.snapshot?.preferences ?? defaultPreferences);
	const loaded = computed(() => presentation.snapshot !== null);
	const version = computed(() => presentation.snapshot?.version ?? 0);
	watch(
		() => values.value.frontendLogLevel,
		(level) => setFrontendLogLevel(level),
		{ immediate: true, flush: 'sync' },
	);

	async function load(force = false): Promise<UserPreferences> {
		const value = await presentation.load(force);
		if (presentation.blocked) throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
		return value.preferences;
	}

	async function update(
		patch: PreferencesPatch,
		expectedVersion = version.value,
		permission?: AbortSignal,
	): Promise<void> {
		if (!presentation.snapshot) throw new PreferenceRequestFailure('refresh_required', 'not_dispatched');
		const preferences = projectPreferences(values.value);
		Object.assign(preferences, patch);
		await presentation.update({ action: 'preferences', expectedVersion, preferences }, permission);
	}

	async function savePanelScale(kind: PanelScaleKind, scale: number, permission: AbortSignal): Promise<void> {
		await presentation.savePanelScale(kind, scale, permission);
	}

	async function saveWorkspacePreference(
		key: WorkspacePreferenceKey,
		value: boolean,
		permission: AbortSignal,
	): Promise<void> {
		await presentation.saveWorkspacePreference(key, value, permission);
	}

	return {
		values,
		version,
		loaded,
		load,
		update,
		savePanelScale,
		saveWorkspacePreference,
		reset: presentation.reset,
	};
});
