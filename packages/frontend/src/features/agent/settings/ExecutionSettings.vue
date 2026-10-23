<script setup lang="ts">
	import { computed } from 'vue';
	import { UiButton, UiFormField, UiInfoHint } from '@/foundation/ui';

	import { useI18n } from 'vue-i18n';
	import {
		AGENT_EXECUTION_LIMIT_KEYS,
		AGENT_EXECUTION_LIMIT_MAXIMA,
	} from '@nexus-terminal/shared/agent/execution/values';
	import type { useExecutionSettings } from '../composables/use-execution-settings';

	import QuantityInput from './QuantityInput.vue';
	import type { QuantityType } from './quantity-format';
	import type { ExecutionLimits } from '../model/execution-types';

	const props = defineProps<{
		editor: ReturnType<typeof useExecutionSettings>;
		section: 'budget' | 'runtime' | 'storage' | 'subagents';
	}>();
	const sectionKeys = {
		budget: [
			'maxModelRequests',
			'maxToolExecutions',
			'maxActiveSeconds',
			'toolTimeoutSeconds',
			'maxToolOutputBytes',
			'maxTokenReservations',
			'maxRecallItems',
			'maxRecallBytes',
		],
		runtime: ['maxConcurrentRuns', 'maxConcurrentModelCalls'],
		storage: ['maxSingleArtifactBytes', 'maxArtifactBytes', 'artifactTtlSeconds'],
		subagents: ['maxChildren', 'maxMessages', 'maxMessageBytes'],
	};
	const visibleKeys = computed(() =>
		AGENT_EXECUTION_LIMIT_KEYS.filter((key) => sectionKeys[props.section].includes(key)),
	);
	const sectionTitle = computed(
		() =>
			({
				budget: 'agent.settings.budget.title',
				runtime: 'agent.settings.performance.title',
				storage: 'agent.settings.groups.storage',
				subagents: 'agent.settings.subagents.title',
			})[props.section],
	);

	const { t } = useI18n();
	const { draft, hardDraft, busy, dirty, invalidLimits, setLimit, blocked, limitsChanged, hardChanged, perform } =
		props.editor;

	function quantityType(key: keyof ExecutionLimits): QuantityType {
		if (key.endsWith('Bytes')) return 'bytes';
		if (key.endsWith('Seconds')) return 'seconds';
		return key === 'maxTokenReservations' ? 'tokens' : 'number';
	}

	function setHardLimit(key: keyof ExecutionLimits, value: string | number | null): void {
		const parsed = typeof value === 'number' ? value : Number(value);
		if (Number.isFinite(parsed)) hardDraft.value![key] = parsed;
	}
</script>

<template>
	<section class="overflow-hidden rounded-2xl bg-card/65 shadow-xs" :aria-label="t(sectionTitle)">
		<div class="agent-settings-head flex min-w-0 items-start justify-between gap-3 px-4 pb-0 pt-4 sm:px-5 sm:pt-5">
			<div class="flex min-w-0 items-center gap-1.5">
				<h3 class="text-sm font-semibold text-foreground">{{ t(sectionTitle) }}</h3>
				<UiInfoHint :text="t('agent.settings.execution.description')" />
			</div>
			<UiButton
				v-if="draft && hardDraft"
				type="button"
				class="shrink-0"
				:appearance="dirty ? 'solid' : 'soft'"
				:tone="dirty ? 'primary' : 'neutral'"
				:loading="busy"
				:disabled="blocked || !dirty"
				data-execution-header-save
				@click="perform('save')"
			>
				{{ t('common.save') }}
			</UiButton>
		</div>
		<div class="space-y-4 p-4 sm:p-5">
			<template v-if="draft && hardDraft">
				<fieldset :disabled="blocked || hardChanged" class="space-y-4">
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<UiFormField
							v-for="key in visibleKeys"
							:key="key"
							:label="t('agent.settings.execution.limits.' + key)"
							class="rounded-xl bg-header/25 p-4"
						>
							<QuantityInput
								:model-value="invalidLimits.has(key) ? null : draft.limits[key]"
								:type="quantityType(key)"
								:min="1"
								:max="draft.hardLimits[key]"
								:aria-label="t('agent.settings.execution.limits.' + key)"
								:disabled="blocked || hardChanged"
								@update:model-value="setLimit(key, $event)"
							/>
							<span class="block text-xs text-text-secondary">{{
								t('agent.settings.execution.currentHard', { value: draft.hardLimits[key] })
							}}</span>
						</UiFormField>
					</div>
					<p v-if="section === 'subagents'" class="text-sm text-text-secondary">
						{{ t('agent.settings.subagents.inheritedLimits') }}
					</p>
				</fieldset>
				<details v-if="section === 'budget'" class="group space-y-3 rounded-xl bg-header/20 p-4">
					<summary
						class="flex cursor-pointer list-none select-none items-center gap-2 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden"
					>
						<i class="fa-solid fa-sliders text-xs text-text-secondary" aria-hidden="true"></i>
						<span>{{ t('agent.settings.execution.hardLimits') }}</span>
						<i
							class="fa-solid fa-chevron-down ml-auto text-[10px] text-text-secondary transition-transform group-open:rotate-180"
							aria-hidden="true"
						></i>
					</summary>
					<fieldset :disabled="blocked || limitsChanged" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<UiFormField
							v-for="key in AGENT_EXECUTION_LIMIT_KEYS"
							:key="key"
							:label="t('agent.settings.execution.limits.' + key)"
							class="rounded-xl bg-card/65 p-3"
						>
							<QuantityInput
								:model-value="hardDraft[key]"
								:type="quantityType(key)"
								:min="draft.limits[key]"
								:max="AGENT_EXECUTION_LIMIT_MAXIMA[key]"
								:aria-label="t('agent.settings.execution.limits.' + key)"
								:disabled="blocked || limitsChanged"
								@update:model-value="setHardLimit(key, $event)"
							/>
						</UiFormField>
					</fieldset>
				</details>
			</template>
		</div>
		<div v-if="draft && hardDraft" class="bg-header/20 px-4 py-3 sm:px-5">
			<span class="block min-w-0 text-xs leading-5" :class="dirty ? 'text-warning' : 'text-text-secondary'">{{
				t(dirty ? 'agent.settings.budget.unsavedChanges' : 'agent.settings.budget.readyNotice')
			}}</span>
		</div>
	</section>
</template>
