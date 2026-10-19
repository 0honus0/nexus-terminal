import { computed, onActivated, onMounted, ref, toRaw, watch } from 'vue';
import { useAuthenticatedViewScope } from '@/shared/session/use-authenticated-view-scope';
import { AGENT_EXECUTION_LIMIT_KEYS } from '@nexus-terminal/shared/agent/execution/values';
import {
	confirmExecutionHardLimits,
	getExecutionModelChoices,
	getExecutionSettings,
	previewExecutionHardLimits,
	saveExecutionSettings,
} from '../api/execution-api';
import { AgentManagementFailure } from '../model/management-failure';
import type {
	ExecutionLimits,
	ExecutionModelChoice,
	ExecutionSettings,
	HardLimitConfirmation,
} from '../model/execution-types';
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
	const confirmation = ref<HardLimitConfirmation | null>(null);
	const choices = ref<ExecutionModelChoice[]>([]);
	const busy = ref(false);
	const modelsBusy = ref(false);
	const modelsFailed = ref(false);
	const refreshRequired = ref(true);
	const notice = ref('');
	let generation = 0;
	let modelsGeneration = 0;
	const scope = useAuthenticatedViewScope({
		onRevoke() {
			generation += 1;
			modelsGeneration += 1;
			saved.value = null;
			draft.value = null;
			hardDraft.value = null;
			confirmation.value = null;
			choices.value = [];
			busy.value = false;
			modelsBusy.value = false;
			modelsFailed.value = false;
			refreshRequired.value = true;
			notice.value = '';
		},
	});
	const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(saved.value));
	const blocked = computed(() => busy.value || refreshRequired.value || draft.value === null);
	const hardChanged = computed(
		() =>
			saved.value !== null &&
			hardDraft.value !== null &&
			AGENT_EXECUTION_LIMIT_KEYS.some((key) => saved.value?.hardLimits[key] !== hardDraft.value?.[key]),
	);

	watch(
		hardDraft,
		() => {
			confirmation.value = null;
		},
		{ deep: true, flush: 'sync' },
	);

	function accept(value: ExecutionSettings): void {
		saved.value = value;
		// Both objects are local application state; wire conversion belongs to the API mapper.
		draft.value = structuredClone(toRaw(value));
		hardDraft.value = structuredClone(toRaw(value.hardLimits));
		confirmation.value = null;
		refreshRequired.value = false;
	}

	async function loadModels(): Promise<void> {
		if (modelsBusy.value) {
			return;
		}
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++modelsGeneration;
		modelsBusy.value = true;
		try {
			const result = await getExecutionModelChoices(signal);
			if (current !== modelsGeneration || !scope.isCurrent(signal)) {
				return;
			}
			choices.value = result;
			modelsFailed.value = false;
		} catch {
			if (current === modelsGeneration && scope.isCurrent(signal)) {
				modelsFailed.value = true;
			}
		} finally {
			if (current === modelsGeneration && scope.isCurrent(signal)) {
				modelsBusy.value = false;
			}
		}
	}

	async function perform(operation: 'read' | 'save' | 'preview' | 'confirm'): Promise<void> {
		if (busy.value || (operation !== 'read' && blocked.value)) {
			return;
		}
		const signal = scope.capture();
		if (!scope.isCurrent(signal)) {
			return;
		}
		const current = ++generation;
		const value = draft.value;
		const proposed = hardDraft.value;
		const pending = confirmation.value;
		if (operation === 'save' && !dirty.value) {
			return;
		}
		if (operation === 'preview' && (!proposed || !value || dirty.value || !hardChanged.value)) {
			return;
		}
		if (operation === 'confirm') {
			if (
				!pending ||
				!value ||
				!proposed ||
				dirty.value ||
				pending.expectedVersion !== value.version ||
				AGENT_EXECUTION_LIMIT_KEYS.some((key) => pending.proposed[key] !== proposed[key])
			) {
				return;
			}
			if (pending.expiresAt <= Date.now()) {
				confirmation.value = null;
				notice.value = 'expired';
				return;
			}
		}
		busy.value = true;
		notice.value = '';
		confirmation.value = null;
		try {
			if (operation === 'preview' && value && proposed) {
				const result = await previewExecutionHardLimits(
					value.version,
					structuredClone(toRaw(proposed)),
					signal,
				);
				if (current === generation && scope.isCurrent(signal)) {
					confirmation.value = result;
				}
				return;
			}
			let result: ExecutionSettings;
			if (operation === 'save' && value) {
				result = await saveExecutionSettings(structuredClone(toRaw(value)), signal);
			} else if (operation === 'confirm' && pending) {
				result = await confirmExecutionHardLimits(pending, signal);
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

	function loadInitial(): void {
		if (draft.value === null) {
			void perform('read');
			void loadModels();
		}
	}

	onMounted(loadInitial);
	onActivated(loadInitial);
	return {
		draft,
		hardDraft,
		confirmation,
		choices,
		busy,
		modelsBusy,
		modelsFailed,
		refreshRequired,
		notice,
		dirty,
		blocked,
		hardChanged,
		perform,
		loadModels,
	};
}
