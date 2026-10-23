import { useI18n } from 'vue-i18n';
import { useFeedback, useFeedbackMessage } from '@/shared/feedback/public';
import { computed, nextTick, onActivated, onMounted, ref, toRaw } from 'vue';
import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
import { AGENT_EXECUTION_LIMIT_KEYS } from '@nexus-terminal/shared/agent/execution/values';
import { getExecutionSettings, saveExecutionHardLimits, saveExecutionSettings } from '../api/execution-api';
import { AgentManagementFailure } from '../model/management-failure';
import type { ExecutionLimits, ExecutionSettings } from '../model/execution-types';
import { agentHostEvents } from '../events/agent-host-events';

function failureNotice(cause: unknown, writing: boolean): string {
	if (!(cause instanceof AgentManagementFailure)) {
		return writing ? 'unknown' : 'failed';
	}
	if (cause.code === 'version_conflict') {
		return 'conflict';
	}
	if (cause.code === 'invalid_input') {
		return 'invalid';
	}
	return cause.outcome === 'unknown' && writing ? 'unknown' : 'failed';
}

export function useExecutionSettings() {
	const saved = ref<ExecutionSettings | null>(null);
	const draft = ref<ExecutionSettings | null>(null);
	const hardDraft = ref<ExecutionLimits | null>(null);

	const busy = ref(false);

	const refreshRequired = ref(true);
	const notice = ref('');
	let failureCause: unknown;

	const { t } = useI18n();
	const feedback = useFeedback();
	useFeedbackMessage(
		() => (notice.value ? t('agent.settings.execution.' + notice.value) : ''),
		() => (notice.value === 'saved' ? 'success' : 'error'),
		() => failureCause,
	);
	const invalidLimits = ref(new Set<keyof ExecutionLimits>());
	let generation = 0;

	const scope = useAuthenticatedViewScope({
		onRevoke() {
			generation += 1;

			saved.value = null;
			draft.value = null;
			hardDraft.value = null;

			busy.value = false;

			refreshRequired.value = true;
			notice.value = '';
			failureCause = undefined;
			invalidLimits.value.clear();
		},
	});
	const hardChanged = computed(
		() =>
			saved.value !== null &&
			hardDraft.value !== null &&
			AGENT_EXECUTION_LIMIT_KEYS.some((key) => saved.value?.hardLimits[key] !== hardDraft.value?.[key]),
	);
	const limitsChanged = computed(
		() =>
			saved.value !== null &&
			draft.value !== null &&
			(draft.value.enabled !== saved.value.enabled ||
				AGENT_EXECUTION_LIMIT_KEYS.some((key) => draft.value?.limits[key] !== saved.value?.limits[key])),
	);
	const dirty = computed(() => invalidLimits.value.size > 0 || limitsChanged.value || hardChanged.value);
	const blocked = computed(() => busy.value || refreshRequired.value || draft.value === null);

	function accept(value: ExecutionSettings): void {
		saved.value = value;
		// Both objects are local application state; wire conversion belongs to the API mapper.
		draft.value = structuredClone(toRaw(value));
		hardDraft.value = structuredClone(toRaw(value.hardLimits));
		invalidLimits.value.clear();
		refreshRequired.value = false;
	}

	function setLimit(key: keyof ExecutionLimits, value: number | null): void {
		if (blocked.value || hardChanged.value || !draft.value) return;
		if (value === null) {
			invalidLimits.value.add(key);
			return;
		}
		invalidLimits.value.delete(key);
		draft.value.limits[key] = value;
	}

	async function perform(operation: 'read' | 'save'): Promise<void> {
		if (busy.value || (operation !== 'read' && blocked.value)) {
			return;
		}
		if (operation === 'save' && invalidLimits.value.size > 0) {
			failureCause = undefined;
			notice.value = '';
			// Each rejected save is an action, including after the previous Toast was closed.
			feedback.notifyError(t('agent.settings.execution.invalid'));
			return;
		}
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++generation;
		const value = draft.value;
		const proposed = hardDraft.value;
		if (operation === 'save' && !dirty.value) {
			return;
		}
		busy.value = true;
		notice.value = '';
		failureCause = undefined;
		try {
			let result: ExecutionSettings;
			if (operation === 'save' && value) {
				result =
					hardChanged.value && proposed
						? await saveExecutionHardLimits(value.version, structuredClone(toRaw(proposed)), signal)
						: await saveExecutionSettings(structuredClone(toRaw(value)), signal);
			} else {
				result = await getExecutionSettings(signal);
			}
			if (current !== generation || !scope.isCurrent(signal)) {
				return;
			}
			accept(result);
			if (operation !== 'read') {
				notice.value = 'saved';
				agentHostEvents.emit('configuration-changed', { origin: 'local' });
			}
		} catch (cause) {
			if (current !== generation || !scope.isCurrent(signal)) {
				return;
			}
			failureCause = cause;
			const failure = cause instanceof AgentManagementFailure ? cause : null;
			notice.value = failureNotice(cause, operation !== 'read');
			if (operation !== 'read' && failure?.outcome !== 'not_dispatched') {
				refreshRequired.value = true;
			}
		} finally {
			if (current === generation && scope.isCurrent(signal)) {
				busy.value = false;
			}
		}
	}

	async function toggleEnabled(): Promise<void> {
		if (blocked.value || dirty.value || !draft.value) {
			return;
		}
		draft.value.enabled = !draft.value.enabled;
		await perform('save');
	}

	function loadInitial(): void {
		if (draft.value === null) {
			void perform('read');
		}
	}

	onMounted(loadInitial);
	onActivated(async () => {
		// Descendant KeepAlive hooks may run before the scope's activation hook.
		await nextTick();
		loadInitial();
	});
	return {
		saved,
		toggleEnabled,
		draft,
		hardDraft,

		busy,

		refreshRequired,
		notice,
		dirty,
		invalidLimits,
		setLimit,
		blocked,
		limitsChanged,
		hardChanged,
		perform,
	};
}
