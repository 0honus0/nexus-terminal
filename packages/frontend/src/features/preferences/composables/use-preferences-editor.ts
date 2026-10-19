import { computed, onMounted, reactive, ref, watch } from 'vue';
import { structurallyEqual } from '@/foundation/data';
import { useAuthenticatedViewScope } from '@/shared/session/public';
import { useFeedback, preferenceFailureMessage } from '@/shared/feedback/public';
import { usePreferences } from './usePreferences';
import { projectPreferences } from '../model/presentation-mapper';
import type { PreferencesPatch } from '../model/preferences-types';

/** A form retains the version of its own baseline while other consumers update the cache. */
export function usePreferencesEditor(translate: (key: string) => string) {
	const preferences = usePreferences();
	const feedback = useFeedback();
	const form = reactive(projectPreferences(preferences.values.value));
	const baseline = ref(projectPreferences(preferences.values.value));
	const version = ref(preferences.version.value);
	const loading = ref(true);
	const saving = ref(false);
	const needsRefresh = ref(true);
	const loadError = ref('');
	const dirty = computed(() => !structurallyEqual(form, baseline.value));
	const view = useAuthenticatedViewScope({
		onRevoke: () => {
			loading.value = false;
			saving.value = false;
			needsRefresh.value = true;
		},
	});

	function publish(): void {
		const value = projectPreferences(preferences.values.value);
		Object.assign(form, value);
		baseline.value = projectPreferences(value);
		version.value = preferences.version.value;
	}

	watch(
		preferences.values,
		() => {
			if (!dirty.value && !saving.value && !needsRefresh.value) publish();
		},
		{ flush: 'sync' },
	);

	async function refresh(): Promise<void> {
		if (loading.value && !needsRefresh.value) return;
		const signal = view.capture();
		if (signal.aborted) return;
		loading.value = true;
		loadError.value = '';
		try {
			await preferences.load(true);
			if (!view.isCurrent(signal)) return;
			publish();
			needsRefresh.value = false;
		} catch (cause) {
			if (!view.isCurrent(signal)) return;
			needsRefresh.value = true;
			loadError.value = preferenceFailureMessage(cause, translate);
			feedback.notifyError(loadError.value);
		} finally {
			if (view.isCurrent(signal)) loading.value = false;
		}
	}

	async function save(patch: PreferencesPatch): Promise<boolean> {
		if (saving.value || loading.value || needsRefresh.value) return false;
		const signal = view.capture();
		if (signal.aborted) return false;
		saving.value = true;
		try {
			await preferences.update(patch, version.value, signal);
			if (!view.isCurrent(signal)) return false;
			// Only our own confirmed write advances this form's baseline; unsaved groups remain drafts.
			baseline.value = projectPreferences(preferences.values.value);
			version.value = preferences.version.value;
			return true;
		} catch (cause) {
			if (!view.isCurrent(signal)) return false;
			needsRefresh.value = true;
			loadError.value = preferenceFailureMessage(cause, translate);
			feedback.notifyError(loadError.value);
			return false;
		} finally {
			if (view.isCurrent(signal)) saving.value = false;
		}
	}

	onMounted(() => refresh());
	return { form, baseline, loading, saving, needsRefresh, loadError, dirty, refresh, save, view, preferences };
}
