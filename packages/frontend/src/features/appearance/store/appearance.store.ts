import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { appearanceApi } from '../api/appearance-api';
import { themeApi } from '../api/theme-api';
import { htmlThemeApi } from '../api/html-theme-api';
import { AppearanceRequestFailure } from '../model/appearance-failure';
import { toAppearancePatch } from '../model/appearance-mapper';
import type {
	AppearanceSettings,
	AppearancePatch,
	TerminalTheme,
	LocalHtmlTheme,
	FontPreferenceKind,
} from '../model/appearance-types';
import { readAppearanceUiTheme } from '@nexus-terminal/shared/preferences/appearance/http-codec';
import { defaultWindowThemeColor, normalizeUiTheme } from '../config/default-theme';

let appliedThemeKeys = new Set<string>();

function applySettings(settings: AppearanceSettings | null): void {
	const theme = normalizeUiTheme(settings ? readAppearanceUiTheme(settings.customUiTheme) : {});
	for (const key of appliedThemeKeys) {
		if (!(key in theme)) {
			document.documentElement.style.removeProperty(key);
		}
	}
	appliedThemeKeys = new Set(Object.keys(theme));
	for (const [key, value] of Object.entries(theme)) {
		document.documentElement.style.setProperty(key, value);
	}
	let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!meta) {
		meta = document.createElement('meta');
		meta.name = 'theme-color';
		document.head.append(meta);
	}
	meta.content = settings?.windowThemeColor ?? defaultWindowThemeColor;
	const path = settings?.pageBackgroundImage;
	document.body.style.backgroundImage = path ? `url(${new URL(path, window.location.origin).href})` : 'none';
	document.body.style.backgroundSize = path ? 'cover' : '';
	document.body.style.backgroundPosition = path ? 'center' : '';
	document.body.style.backgroundRepeat = path ? 'no-repeat' : '';
	document.body.style.backgroundAttachment = path ? 'fixed' : '';
}

export const useAppearanceStore = defineStore('appearance', () => {
	const snapshot = shallowRef<AppearanceSettings | null>(null);
	const preview = shallowRef<AppearancePatch>({});
	const themes = shallowRef<TerminalTheme[]>([]);
	const localThemes = shallowRef<LocalHtmlTheme[]>([]);
	const customizerVisible = ref(false);
	const busy = ref(false);
	const blocked = ref(false);
	const error = shallowRef<unknown>(null);
	let scope = new AbortController();
	let revision = 0;
	let queue: Promise<unknown> = Promise.resolve();
	let pendingRead: Promise<void> | null = null;
	const settings = computed<Partial<AppearanceSettings>>(() =>
		snapshot.value ? { ...snapshot.value, ...preview.value } : {},
	);
	const version = computed(() => snapshot.value?.version ?? null);
	const loaded = computed(() => snapshot.value !== null);

	function reset(): void {
		scope.abort();
		scope = new AbortController();
		revision++;
		queue = Promise.resolve();
		pendingRead = null;
		snapshot.value = null;
		preview.value = {};
		themes.value = [];
		localThemes.value = [];
		customizerVisible.value = false;
		busy.value = false;
		blocked.value = false;
		error.value = null;
		applySettings(null);
	}

	function enqueue<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const signal = scope.signal;
		const task = queue.then(() => {
			if (signal.aborted) {
				throw new AppearanceRequestFailure('cancelled', 'not_dispatched');
			}
			return work(signal);
		});
		queue = task.catch(() => undefined);
		return task;
	}

	function load(recover = false, permission?: AbortSignal): Promise<void> {
		if (!recover && blocked.value) {
			return Promise.reject(new AppearanceRequestFailure('refresh_required', 'not_dispatched'));
		}
		if (!recover && loaded.value) {
			return Promise.resolve();
		}
		if (!recover && pendingRead) {
			return pendingRead;
		}
		const recoveryRevision = revision;
		const task = enqueue(async (owner) => {
			const signal = permission ? AbortSignal.any([owner, permission]) : owner;
			if (signal.aborted) {
				throw new AppearanceRequestFailure('cancelled', 'not_dispatched');
			}
			try {
				const value = await appearanceApi.load(signal);
				const results = await Promise.allSettled([
					themeApi.list(signal),
					htmlThemeApi.list(signal),
					htmlThemeApi.repository(signal),
				]);
				const failures = results.flatMap((entry) => (entry.status === 'rejected' ? [entry.reason] : []));
				if (failures.length) {
					throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Appearance reads failed');
				}
				const [themeResult, htmlResult, repoResult] = results;
				if (
					themeResult.status !== 'fulfilled' ||
					htmlResult.status !== 'fulfilled' ||
					repoResult.status !== 'fulfilled'
				) {
					throw new AppearanceRequestFailure('protocol_failure', 'unknown');
				}
				if (repoResult.value.version !== value.version || repoResult.value.url !== value.remoteHtmlPresetsUrl) {
					throw new AppearanceRequestFailure('version_conflict', 'confirmed');
				}
				if (signal.aborted) {
					throw new AppearanceRequestFailure('cancelled', 'not_dispatched');
				}
				snapshot.value = value;
				preview.value = {};
				themes.value = themeResult.value;
				localThemes.value = htmlResult.value;
				applySettings(value);
				if (recover && recoveryRevision !== revision) {
					throw new AppearanceRequestFailure('refresh_required', 'not_dispatched');
				}
				if (recover) {
					blocked.value = false;
					error.value = null;
				}
			} catch (cause) {
				if (!signal.aborted) {
					error.value = cause;
					blocked.value = true;
					revision++;
				}
				throw cause;
			}
		});
		pendingRead = task;
		void task
			.finally(() => {
				if (pendingRead === task) {
					pendingRead = null;
				}
			})
			.catch(() => undefined);
		return task;
	}

	function mutate<T>(
		work: (signal: AbortSignal) => Promise<T>,
		permission: AbortSignal,
		publish?: (value: T) => void,
	): Promise<T> {
		return enqueue(async (signal) => {
			if (permission.aborted) {
				throw new AppearanceRequestFailure('cancelled', 'not_dispatched');
			}
			if (blocked.value || !loaded.value) {
				throw new AppearanceRequestFailure('refresh_required', 'not_dispatched');
			}
			busy.value = true;
			try {
				const value = await work(AbortSignal.any([signal, permission]));
				if (!signal.aborted) {
					publish?.(value);
					error.value = null;
				}
				return value;
			} catch (cause) {
				if (!signal.aborted) {
					error.value = cause;
					if (
						!(cause instanceof AppearanceRequestFailure) ||
						cause.outcome === 'unknown' ||
						cause.code === 'version_conflict' ||
						cause.code === 'source_changed'
					) {
						revision++;
						blocked.value = true;
					}
				}
				throw cause;
			} finally {
				if (!signal.aborted) {
					busy.value = false;
				}
			}
		});
	}

	function accept(value: AppearanceSettings): void {
		snapshot.value = value;
		// In-flight font owners clear their own preview only after their latest write settles.
		applySettings(value);
	}

	function update(
		patch: AppearancePatch,
		expectedVersion: number,
		permission: AbortSignal,
	): Promise<AppearanceSettings> {
		const frozen = toAppearancePatch(patch, expectedVersion);
		return mutate((signal) => appearanceApi.update(frozen, expectedVersion, signal), permission, accept);
	}

	function saveFontPreference(
		kind: FontPreferenceKind,
		size: number,
		permission: AbortSignal,
	): Promise<AppearanceSettings> {
		const patch: AppearancePatch = {};
		switch (kind) {
			case 'terminal':
				patch.terminalFontSize = size;
				break;
			case 'mobile-terminal':
				patch.terminalFontSizeMobile = size;
				break;
			case 'editor':
				patch.editorFontSize = size;
				break;
			case 'mobile-editor':
				patch.mobileEditorFontSize = size;
				break;
		}
		return mutate(
			(signal) => {
				const current = snapshot.value;
				if (!current) throw new AppearanceRequestFailure('refresh_required', 'not_dispatched');
				// Font gestures are immediate preferences. Read the version when the serialized write starts,
				// after older gestures and writes to other font fields have committed.
				return appearanceApi.update(toAppearancePatch(patch, current.version), current.version, signal);
			},
			permission,
			accept,
		);
	}

	function previewSettings(patch: AppearancePatch): void {
		// Only local font previews are supported; durable state/version remain unchanged.
		const next: AppearancePatch = {};
		const font = patch.terminalFontSize ?? preview.value.terminalFontSize;
		if (font !== undefined) {
			next.terminalFontSize = font;
		}
		const mobileFont = patch.terminalFontSizeMobile ?? preview.value.terminalFontSizeMobile;
		if (mobileFont !== undefined) {
			next.terminalFontSizeMobile = mobileFont;
		}
		const editor = patch.editorFontSize ?? preview.value.editorFontSize;
		if (editor !== undefined) {
			next.editorFontSize = editor;
		}
		const mobileEditor = patch.mobileEditorFontSize ?? preview.value.mobileEditorFontSize;
		if (mobileEditor !== undefined) {
			next.mobileEditorFontSize = mobileEditor;
		}
		preview.value = next;
	}

	function clearFontPreview(kind: 'terminal' | 'editor' | 'mobile-editor'): void {
		const next = { ...preview.value };
		if (kind === 'terminal') {
			delete next.terminalFontSize;
			delete next.terminalFontSizeMobile;
		}
		if (kind === 'editor') {
			delete next.editorFontSize;
		}
		if (kind === 'mobile-editor') {
			delete next.mobileEditorFontSize;
		}
		preview.value = next;
	}

	return {
		saveFontPreference,
		clearFontPreview,
		snapshot,
		settings,
		version,
		loaded,
		themes,
		localThemes,
		customizerVisible,
		busy,
		blocked,
		error,
		reset,
		load,
		mutate,
		update,
		accept,
		previewSettings,

		openCustomizer: (): void => {
			customizerVisible.value = true;
		},

		closeCustomizer: (): void => {
			customizerVisible.value = false;
		},
	};
});
