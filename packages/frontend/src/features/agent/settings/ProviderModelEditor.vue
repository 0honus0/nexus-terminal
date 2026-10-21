<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { AGENT_REASONING_EFFORTS, type AgentReasoningEffort } from '@nexus-terminal/shared/agent/providers/values';
	import type { ProviderModelDraft } from '../model/provider-types';

	const model = defineModel<ProviderModelDraft>({ required: true });
	const { t } = useI18n();
	const optionalFlags = [
		'supportsImageInput',
		'supportsFileInput',
		'supportsPromptCacheKey',
		'reasoningMandatory',
	] as const;

	function optionalFlag(event: Event): boolean | undefined {
		if (!(event.target instanceof HTMLSelectElement)) {
			return undefined;
		}
		return event.target.value === 'unknown' ? undefined : event.target.value === 'yes';
	}

	function setProtocol(event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) {
			return;
		}
		const value = event.target.value;
		model.value.protocol = value === 'chat-completions' || value === 'responses' ? value : undefined;
	}

	function toggleEffort(effort: AgentReasoningEffort): void {
		const selected = new Set(model.value.reasoningEfforts);
		if (selected.has(effort)) {
			selected.delete(effort);
		} else {
			selected.add(effort);
		}
		model.value.reasoningEfforts =
			selected.size === 0 ? undefined : AGENT_REASONING_EFFORTS.filter((item) => selected.has(item));
		if (model.value.defaultReasoningEffort && !selected.has(model.value.defaultReasoningEffort)) {
			model.value.defaultReasoningEffort = undefined;
		}
		if (selected.size === 0) {
			model.value.reasoningMandatory = undefined;
		}
	}

	function setDefaultEffort(event: Event): void {
		if (!(event.target instanceof HTMLSelectElement)) {
			return;
		}
		const value = event.target.value;
		model.value.defaultReasoningEffort = model.value.reasoningEfforts?.find((effort) => effort === value);
	}
</script>

<template>
	<div class="grid gap-3 sm:grid-cols-2">
		<label class="space-y-1 text-sm"
			><span class="block">{{ t('agent.settings.providerManagement.modelId') }}</span>
			<input v-model="model.id" class="w-full rounded border border-border bg-background p-2" />
		</label>
		<label class="space-y-1 text-sm"
			><span class="block">{{ t('agent.settings.providers.protocol') }}</span>
			<select
				:value="model.protocol ?? 'inherit'"
				class="w-full rounded border border-border bg-background p-2"
				@change="setProtocol"
			>
				<option value="inherit">{{ t('agent.settings.providerManagement.inherit') }}</option>
				<option value="chat-completions">{{ t('agent.settings.providers.protocolChat') }}</option>
				<option value="responses">{{ t('agent.settings.providers.protocolResponses') }}</option>
			</select>
		</label>
		<label v-for="field in ['contextWindow', 'maxOutputTokens'] as const" :key="field" class="space-y-1 text-sm">
			<span class="block">{{ t('agent.settings.providers.' + field) }}</span>
			<input
				v-model.number="model[field]"
				type="number"
				min="1"
				step="1"
				class="w-full rounded border border-border bg-background p-2"
			/>
		</label>
		<label class="flex items-center gap-2 text-sm"
			><input v-model="model.supportsTools" type="checkbox" />{{ t('agent.settings.providers.tools') }}</label
		>
		<label v-for="field in optionalFlags" :key="field" class="space-y-1 text-sm">
			<span class="block">{{ t('agent.settings.providerManagement.' + field) }}</span>
			<select
				:value="model[field] === undefined ? 'unknown' : model[field] ? 'yes' : 'no'"
				class="w-full rounded border border-border bg-background p-2"
				@change="model[field] = optionalFlag($event)"
			>
				<option value="unknown">{{ t('agent.settings.providerManagement.unknownValue') }}</option>
				<option value="yes">{{ t('agent.settings.providerManagement.yes') }}</option>
				<option value="no">{{ t('agent.settings.providerManagement.no') }}</option>
			</select>
		</label>
		<fieldset class="space-y-2 text-sm sm:col-span-2">
			<legend>{{ t('agent.settings.providers.reasoningCapability') }}</legend>
			<div class="flex flex-wrap gap-3">
				<label v-for="effort in AGENT_REASONING_EFFORTS" :key="effort" class="flex items-center gap-1">
					<input
						type="checkbox"
						:checked="model.reasoningEfforts?.includes(effort) ?? false"
						@change="toggleEffort(effort)"
					/>{{ t('agent.ui.reasoningLevels.' + effort) }}
				</label>
			</div>
			<label class="block"
				>{{ t('agent.settings.providers.reasoningDefault') }}
				<select
					:value="model.defaultReasoningEffort ?? ''"
					class="ml-2 rounded border border-border bg-background p-2"
					@change="setDefaultEffort"
				>
					<option value="">{{ t('agent.settings.providers.reasoningNoDefault') }}</option>
					<option v-for="effort in model.reasoningEfforts" :key="effort" :value="effort">
						{{ t('agent.ui.reasoningLevels.' + effort) }}
					</option>
				</select>
			</label>
		</fieldset>
	</div>
</template>
