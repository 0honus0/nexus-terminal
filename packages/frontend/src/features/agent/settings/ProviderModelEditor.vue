<script setup lang="ts">
	import { useId } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
	import { UiCheckbox, UiFormField, UiInput, UiSelect } from '@/foundation/ui';
	import type { UiSelectValue } from '@/foundation/ui';
	import type { ProviderModelDraft } from '../model/provider-types';

	defineProps<{
		errors?: { id?: string; contextWindow?: string; maxOutputTokens?: string };
	}>();

	const model = defineModel<ProviderModelDraft>({ required: true });
	const { t } = useI18n();
	const id = useId();
	const optionalFlags = [
		'supportsImageInput',
		'supportsFileInput',
		'supportsPromptCacheKey',
		'reasoningMandatory',
	] as const;

	function setOptionalFlag(field: (typeof optionalFlags)[number], value: UiSelectValue): void {
		model.value[field] = value === 'unknown' ? undefined : value === 'yes';
	}

	function setProtocol(value: UiSelectValue): void {
		model.value.protocol = value === 'chat-completions' || value === 'responses' ? value : undefined;
	}

	function setNumber(field: 'contextWindow' | 'maxOutputTokens', value: string | number | null): void {
		const parsed = typeof value === 'number' ? value : Number(value);
		model.value[field] = Number.isFinite(parsed) ? parsed : 0;
	}

	function setEffort(effort: AgentReasoningEffort, checked: boolean): void {
		const selected = new Set(model.value.reasoningEfforts);
		if (checked) selected.add(effort);
		else selected.delete(effort);
		model.value.reasoningEfforts =
			selected.size === 0 ? undefined : AGENT_REASONING_EFFORTS.filter((item) => selected.has(item));
		if (model.value.defaultReasoningEffort && !selected.has(model.value.defaultReasoningEffort)) {
			model.value.defaultReasoningEffort = undefined;
		}
		if (selected.size === 0) {
			model.value.reasoningMandatory = undefined;
		}
	}

	function setDefaultEffort(value: UiSelectValue): void {
		model.value.defaultReasoningEffort = model.value.reasoningEfforts?.find((effort) => effort === value);
	}
</script>

<template>
	<div class="grid gap-3 sm:grid-cols-2">
		<UiFormField
			:label="t('agent.settings.providerManagement.modelId')"
			:for-id="`${id}-model-id`"
			:error="errors?.id"
			required
		>
			<UiInput :id="`${id}-model-id`" v-model="model.id" autocomplete="off" spellcheck="false" />
		</UiFormField>
		<UiFormField :label="t('agent.settings.providers.protocol')" :for-id="`${id}-protocol`">
			<UiSelect
				:id="`${id}-protocol`"
				:model-value="model.protocol ?? 'inherit'"
				@update:model-value="setProtocol"
			>
				<option value="inherit">{{ t('agent.settings.providerManagement.inherit') }}</option>
				<option value="chat-completions">{{ t('agent.settings.providers.protocolChat') }}</option>
				<option value="responses">{{ t('agent.settings.providers.protocolResponses') }}</option>
			</UiSelect>
		</UiFormField>
		<UiFormField
			:label="t('agent.settings.providers.contextWindow')"
			:for-id="`${id}-context-window`"
			:error="errors?.contextWindow"
			required
		>
			<UiInput
				:id="`${id}-context-window`"
				:model-value="model.contextWindow"
				type="number"
				min="1"
				step="1"
				@update:model-value="setNumber('contextWindow', $event)"
			/>
		</UiFormField>
		<UiFormField
			:label="t('agent.settings.providers.maxOutputTokens')"
			:for-id="`${id}-max-output-tokens`"
			:error="errors?.maxOutputTokens"
			required
		>
			<UiInput
				:id="`${id}-max-output-tokens`"
				:model-value="model.maxOutputTokens"
				type="number"
				min="1"
				step="1"
				@update:model-value="setNumber('maxOutputTokens', $event)"
			/>
		</UiFormField>
		<label
			:for="`${id}-supports-tools`"
			class="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground"
		>
			<UiCheckbox :id="`${id}-supports-tools`" v-model="model.supportsTools" />
			<span>{{ t('agent.settings.providers.tools') }}</span>
		</label>
		<UiFormField
			v-for="field in optionalFlags"
			:key="field"
			:label="t('agent.settings.providerManagement.' + field)"
			:for-id="`${id}-${field}`"
		>
			<UiSelect
				:id="`${id}-${field}`"
				:model-value="model[field] === undefined ? 'unknown' : model[field] ? 'yes' : 'no'"
				@update:model-value="setOptionalFlag(field, $event)"
			>
				<option value="unknown">{{ t('agent.settings.providerManagement.unknownValue') }}</option>
				<option value="yes">{{ t('agent.settings.providerManagement.yes') }}</option>
				<option value="no">{{ t('agent.settings.providerManagement.no') }}</option>
			</UiSelect>
		</UiFormField>
		<fieldset class="space-y-3 rounded-xl bg-header/20 p-3.5 text-sm sm:col-span-2">
			<legend class="px-1 text-xs font-semibold text-foreground">
				{{ t('agent.settings.providers.reasoningCapability') }}
			</legend>
			<div class="flex flex-wrap gap-x-4 gap-y-2">
				<label
					v-for="effort in AGENT_REASONING_EFFORTS"
					:key="effort"
					class="flex cursor-pointer items-center gap-2 text-xs"
				>
					<UiCheckbox
						:model-value="model.reasoningEfforts?.includes(effort) ?? false"
						:aria-label="t('agent.ui.reasoningLevels.' + effort)"
						@update:model-value="setEffort(effort, $event)"
					/>
					{{ t('agent.ui.reasoningLevels.' + effort) }}
				</label>
			</div>
			<UiFormField :label="t('agent.settings.providers.reasoningDefault')" :for-id="`${id}-default-effort`">
				<UiSelect
					:id="`${id}-default-effort`"
					:model-value="model.defaultReasoningEffort ?? ''"
					:disabled="!model.reasoningEfforts?.length"
					@update:model-value="setDefaultEffort"
				>
					<option value="">{{ t('agent.settings.providers.reasoningNoDefault') }}</option>
					<option v-for="effort in model.reasoningEfforts" :key="effort" :value="effort">
						{{ t('agent.ui.reasoningLevels.' + effort) }}
					</option>
				</UiSelect>
			</UiFormField>
		</fieldset>
	</div>
</template>
