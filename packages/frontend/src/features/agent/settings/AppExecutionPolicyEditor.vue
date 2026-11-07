<script setup lang="ts">
	import { computed, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { structurallyEqual } from '@/foundation/data';
	import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
	import { AGENT_EXECUTION_INTEGER_KEYS } from '@nexus-terminal/shared/agent/governance/values';
	import type { AppPolicyOverrides } from '../model/app-management-types';
	import { useAppGovernance } from '../composables/use-app-governance';
	import QuantityInput from './QuantityInput.vue';
	import { formatQuantity, type QuantityType } from './quantity-format';
	import { useQuantityLabels } from './use-quantity-labels';
	const props = defineProps<{ appId: string; active: boolean }>();
	const { t } = useI18n();
	const quantityLabels = useQuantityLabels();
	const {
		policy: view,
		policyDraft: draft,
		policyOperation,
		loadPolicy,
		savePolicy,
	} = useAppGovernance(props.appId, 'policy', () => props.active);
	const invalidFields = ref(new Set<string>());
	watch(view, () => invalidFields.value.clear());
	const blocked = computed(() => policyOperation.busy.value || policyOperation.refreshRequired.value || !view.value);
	const dirty = computed(() => !structurallyEqual(draft.value, view.value?.overrides ?? {}));
	type NumericKey = (typeof AGENT_EXECUTION_INTEGER_KEYS)[number];
	const fields = AGENT_EXECUTION_INTEGER_KEYS.map((key): { key: NumericKey; type: QuantityType } => ({
		key,
		type: key.endsWith('Bytes') ? 'bytes' : key.endsWith('Seconds') ? 'seconds' : 'number',
	}));

	function hasOverride(key: keyof AppPolicyOverrides): boolean {
		return draft.value[key] !== undefined;
	}

	function toggleOverride(key: keyof AppPolicyOverrides, enabled: boolean): void {
		if (blocked.value || !view.value) return;
		invalidFields.value.delete(key);
		if (!enabled) {
			delete draft.value[key];
			return;
		}
		draft.value[key] = view.value.effective[key];
	}

	function setInteger(key: NumericKey, value: number | null): void {
		if (blocked.value) return;
		if (value === null || !Number.isSafeInteger(value) || value < 1) {
			invalidFields.value.add(key);
			return;
		}
		invalidFields.value.delete(key);
		draft.value[key] = value;
	}

	function effectiveValue(field: { key: NumericKey; type: QuantityType }): string {
		return formatQuantity(view.value?.effective[field.key], field.type, quantityLabels.value);
	}

	async function save(): Promise<void> {
		if (!blocked.value && dirty.value && invalidFields.value.size === 0) await savePolicy();
	}
</script>
<template>
	<div class="space-y-4">
		<UiButton
			v-if="policyOperation.refreshRequired.value || policyOperation.notice.value === 'failed'"
			type="button"
			:disabled="policyOperation.busy.value"
			@click="loadPolicy"
			>{{ t('agent.settings.appManagement.readPolicy') }}</UiButton
		>
		<div v-if="view" class="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
			<div v-for="field in fields" :key="field.key" class="rounded-xl bg-header/25 p-3.5">
				<div class="flex items-start justify-between gap-2">
					<div>
						<div class="text-xs font-semibold text-foreground">
							{{ t(`agent.settings.executionPolicy.fields.${field.key}`) }}
						</div>
						<div class="mt-0.5 text-[11px] text-text-secondary">
							{{ t('agent.settings.executionPolicy.effective', { value: effectiveValue(field) }) }}
						</div>
					</div>
					<label class="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none">
						<UiCheckbox
							:model-value="hasOverride(field.key)"
							:disabled="blocked"
							@update:model-value="(value: boolean) => toggleOverride(field.key, value)"
						/>
						<span>{{ t('agent.settings.executionPolicy.override') }}</span>
					</label>
				</div>
				<QuantityInput
					v-if="hasOverride(field.key)"
					:model-value="draft[field.key]"
					:aria-label="t('agent.settings.executionPolicy.fields.' + field.key)"
					@update:model-value="(value) => setInteger(field.key, value)"
					class="mt-2.5"
					:type="field.type"
					:min="1"
					:disabled="blocked"
				/>
				<div
					v-else
					class="mt-2.5 flex items-center gap-1.5 rounded-lg border border-border/50 bg-header/30 px-2.5 py-1.5 text-[11px] text-text-secondary"
				>
					<i class="fa-solid fa-link text-[9px] text-text-secondary/70" aria-hidden="true"></i>
					<span>{{ t('agent.settings.executionPolicy.inherited') }}</span>
				</div>
			</div>
		</div>

		<div class="flex items-center justify-end gap-2">
			<UiInfoHint v-if="!dirty" :text="t('agent.settings.disabledReason.noChanges')" />
			<UiButton
				:appearance="dirty ? 'solid' : 'soft'"
				:tone="dirty ? 'primary' : 'neutral'"
				type="button"
				:disabled="blocked || !dirty || invalidFields.size > 0"
				@click="save"
			>
				{{ t('common.save') }}
			</UiButton>
		</div>
	</div>
</template>
