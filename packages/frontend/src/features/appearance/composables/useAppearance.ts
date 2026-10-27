import { computed, type ComputedRef } from 'vue';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { useAppearanceStore } from '../store/appearance.store';
import type { AppearanceSettings, AppearancePatch, TerminalTheme, FontPreferenceKind } from '../model/appearance-types';

export interface AppearanceController {
	settings: ComputedRef<Readonly<Partial<AppearanceSettings>>>;
	themes: ComputedRef<readonly TerminalTheme[]>;
	version: ComputedRef<number | null>;
	customizerVisible: ComputedRef<boolean>;
	load(force?: boolean): Promise<void>;
	update(patch: AppearancePatch, expectedVersion: number, permission: AbortSignal): Promise<void>;
	saveFontPreference(kind: FontPreferenceKind, size: number, permission: AbortSignal): Promise<void>;
	clearFontPreview(kind: 'terminal' | 'editor' | 'mobile-editor'): void;
	previewSettings(patch: AppearancePatch): void;
	openCustomizer(): void;
	closeCustomizer(): void;
	reset(): void;
}

export function useAppearance(): AppearanceController {
	const store = useAppearanceStore();
	return {
		settings: computed(() => store.settings),
		themes: computed(() => store.themes),
		version: computed(() => store.version),
		customizerVisible: computed(() => store.customizerVisible),
		load: store.load,
		clearFontPreview: store.clearFontPreview,

		saveFontPreference: async (kind, size, permission): Promise<void> => {
			await store.saveFontPreference(kind, size, permission);
		},

		update: async (patch, version, permission): Promise<void> => {
			await store.update(patch, version, permission);
		},

		previewSettings: store.previewSettings,
		openCustomizer: store.openCustomizer,
		closeCustomizer: store.closeCustomizer,
		reset: store.reset,
	};
}

export const resetAppearanceCache = (): void => useAppearanceStore().reset();

registerAuthenticatedSessionReset('appearance-cache', resetAppearanceCache);
