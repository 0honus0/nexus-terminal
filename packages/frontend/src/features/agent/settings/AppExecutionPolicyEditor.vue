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
		if (key === 'contextProfile') draft.value.contextProfile = view.value.effective.contextProfile;
		else if (key === 'contextCompactionMode')
			draft.value.contextCompactionMode = view.value.effective.contextCompactionMode;
		else draft.value[key] = view.value.effective[key];
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

	function selectProfile(value: 'normal' | 'extended'): void {
		if (!blocked.value) draft.value.contextProfile = value;
	}

	function selectCompaction(value: 'aggressive' | 'balanced' | 'conservative'): void {
		if (!blocked.value) draft.value.contextCompactionMode = value;
	}

	const currentProfile = computed(() => draft.value.contextProfile ?? view.value?.effective.contextProfile);
	const currentCompaction = computed(
		() => draft.value.contextCompactionMode ?? view.value?.effective.contextCompactionMode,
	);

	async function save(): Promise<void> {
		if (!blocked.value && dirty.value && invalidFields.value.size === 0) await savePolicy();
	}

	interface ProfileOption {
		value: 'normal' | 'extended';
		label: string;
		description: string;
		icon: string;
	}

	const profileOptions = computed<ProfileOption[]>(() => [
		{
			value: 'normal',
			label: t('agent.settings.executionPolicy.profile.normal'),
			description: t('agent.settings.executionPolicy.profileDesc.normal'),
			icon: 'fa-solid fa-shield-halved',
		},
		{
			value: 'extended',
			label: t('agent.settings.executionPolicy.profile.extended'),
			description: t('agent.settings.executionPolicy.profileDesc.extended'),
			icon: 'fa-solid fa-arrows-maximize',
		},
	]);

	interface CompactionOption {
		value: 'aggressive' | 'balanced' | 'conservative';
		label: string;
		description: string;
		icon: string;
	}

	const compactionOptions = computed<CompactionOption[]>(() => [
		{
			value: 'aggressive',
			label: t('agent.settings.executionPolicy.compaction.aggressive'),
			description: t('agent.settings.executionPolicy.compactionDesc.aggressive'),
			icon: 'fa-solid fa-bolt',
		},
		{
			value: 'balanced',
			label: t('agent.settings.executionPolicy.compaction.balanced'),
			description: t('agent.settings.executionPolicy.compactionDesc.balanced'),
			icon: 'fa-solid fa-scale-balanced',
		},
		{
			value: 'conservative',
			label: t('agent.settings.executionPolicy.compaction.conservative'),
			description: t('agent.settings.executionPolicy.compactionDesc.conservative'),
			icon: 'fa-solid fa-box-archive',
		},
	]);
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

			<div class="rounded-xl bg-header/25 p-4 sm:p-5 md:col-span-2 xl:col-span-3 transition-all">
				<div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
					<div class="flex items-center gap-2.5 min-w-0">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
						>
							<i class="fa-solid fa-arrows-split-up-and-left text-xs" aria-hidden="true"></i>
						</div>
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h4 class="text-xs font-semibold text-foreground">
									{{ t('agent.settings.executionPolicy.fields.contextProfile') }}
								</h4>
								<span
									v-if="hasOverride('contextProfile')"
									class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
								>
									<i class="fa-solid fa-pen-to-square text-[9px]" aria-hidden="true"></i>
									{{ t('agent.settings.executionPolicy.customOverride') }}
								</span>
								<span
									v-else
									class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/60 px-2 py-0.5 text-[10px] text-text-secondary"
								>
									<i
										class="fa-solid fa-link text-[9px] text-text-secondary/70"
										aria-hidden="true"
									></i>
									{{
										t('agent.settings.executionPolicy.profileInherited', {
											value: view.effective.contextProfile,
										})
									}}
								</span>
							</div>
							<p class="mt-0.5 text-[11px] text-text-secondary leading-relaxed">
								{{ t('agent.settings.executionPolicy.profileHint') }}
							</p>
						</div>
					</div>

					<label
						class="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-text-secondary hover:border-border hover:bg-card cursor-pointer transition-all select-none"
					>
						<UiCheckbox
							:model-value="hasOverride('contextProfile')"
							:disabled="blocked"
							@update:model-value="(value: boolean) => toggleOverride('contextProfile', value)"
						/>
						<span
							:class="
								hasOverride('contextProfile') ? 'font-medium text-foreground' : 'text-text-secondary'
							"
						>
							{{ t('agent.settings.executionPolicy.override') }}
						</span>
					</label>
				</div>

				<div class="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
					<button
						v-for="opt in profileOptions"
						:key="opt.value"
						type="button"
						:disabled="blocked"
						class="group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer focus:outline-none"
						:class="
							currentProfile === opt.value
								? hasOverride('contextProfile')
									? 'border-primary bg-primary/10 shadow-2xs ring-1 ring-primary/25'
									: 'border-border/90 bg-header/40 ring-1 ring-border/50'
								: 'border-border/60 bg-background/60 hover:border-border hover:bg-card/70'
						"
						@click="selectProfile(opt.value)"
					>
						<div>
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2">
									<div
										class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
										:class="
											currentProfile === opt.value && hasOverride('contextProfile')
												? 'bg-primary text-white shadow-2xs'
												: 'bg-header/70 text-text-secondary'
										"
									>
										<i :class="opt.icon" class="text-xs" aria-hidden="true"></i>
									</div>
									<span class="text-xs font-semibold text-foreground">{{ opt.label }}</span>
								</div>

								<div
									class="flex h-4 w-4 items-center justify-center rounded-full transition-all"
									:class="
										currentProfile === opt.value && hasOverride('contextProfile')
											? 'bg-primary text-white'
											: currentProfile === opt.value
												? 'border border-border/90 bg-background text-text-secondary'
												: 'border border-border/40 bg-transparent opacity-0 group-hover:opacity-40'
									"
								>
									<i class="fa-solid fa-check text-[9px]" aria-hidden="true"></i>
								</div>
							</div>

							<p class="mt-2 text-[11px] leading-relaxed text-text-secondary">
								{{ opt.description }}
							</p>
						</div>

						<div class="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
							<span
								v-if="currentProfile === opt.value && hasOverride('contextProfile')"
								class="font-medium text-primary flex items-center gap-1"
							>
								<i class="fa-solid fa-check text-[9px]"></i>
								{{ t('agent.settings.executionPolicy.customOverride') }}
							</span>
							<span
								v-else-if="currentProfile === opt.value"
								class="text-text-secondary/80 flex items-center gap-1"
							>
								<i class="fa-solid fa-link text-[8px]"></i>
								{{ t('agent.settings.executionPolicy.activeInherited') }}
							</span>
							<span
								v-else
								class="text-text-secondary/60 transition-colors group-hover:text-text-secondary"
							>
								{{ t('agent.settings.executionPolicy.clickToOverride') }}
							</span>
						</div>
					</button>
				</div>
			</div>

			<div
				class="rounded-xl border border-border/70 bg-header/20 p-4 sm:p-5 shadow-2xs md:col-span-2 xl:col-span-3 transition-all"
			>
				<div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border/50">
					<div class="flex items-center gap-2.5 min-w-0">
						<div
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
						>
							<i class="fa-solid fa-compress text-xs" aria-hidden="true"></i>
						</div>
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h4 class="text-xs font-semibold text-foreground">
									{{ t('agent.settings.executionPolicy.fields.contextCompactionMode') }}
								</h4>
								<span
									v-if="hasOverride('contextCompactionMode')"
									class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
								>
									<i class="fa-solid fa-pen-to-square text-[9px]" aria-hidden="true"></i>
									{{ t('agent.settings.executionPolicy.customOverride') }}
								</span>
								<span
									v-else
									class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/60 px-2 py-0.5 text-[11px] text-text-secondary"
								>
									<i
										class="fa-solid fa-link text-[9px] text-text-secondary/70"
										aria-hidden="true"
									></i>
									{{
										t('agent.settings.executionPolicy.compactionInherited', {
											value: view.effective.contextCompactionMode,
										})
									}}
								</span>
							</div>
							<p class="mt-0.5 text-[11px] text-text-secondary leading-relaxed">
								{{ t('agent.settings.executionPolicy.compactionHint') }}
							</p>
						</div>
					</div>

					<label
						class="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-text-secondary hover:border-border hover:bg-card cursor-pointer transition-all select-none"
					>
						<UiCheckbox
							:model-value="hasOverride('contextCompactionMode')"
							:disabled="blocked"
							@update:model-value="(value: boolean) => toggleOverride('contextCompactionMode', value)"
						/>
						<span
							:class="
								hasOverride('contextCompactionMode')
									? 'font-medium text-foreground'
									: 'text-text-secondary'
							"
						>
							{{ t('agent.settings.executionPolicy.override') }}
						</span>
					</label>
				</div>

				<div class="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
					<button
						v-for="opt in compactionOptions"
						:key="opt.value"
						type="button"
						:disabled="blocked"
						class="group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer focus:outline-none"
						:class="
							currentCompaction === opt.value
								? hasOverride('contextCompactionMode')
									? 'border-primary bg-primary/10 shadow-2xs ring-1 ring-primary/25'
									: 'border-border/90 bg-header/40 ring-1 ring-border/50'
								: 'border-border/60 bg-background/60 hover:border-border hover:bg-card/70'
						"
						@click="selectCompaction(opt.value)"
					>
						<div>
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2">
									<div
										class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
										:class="
											currentCompaction === opt.value && hasOverride('contextCompactionMode')
												? 'bg-primary text-white shadow-2xs'
												: 'bg-header/70 text-text-secondary'
										"
									>
										<i :class="opt.icon" class="text-xs" aria-hidden="true"></i>
									</div>
									<span class="text-xs font-semibold text-foreground">{{ opt.label }}</span>
								</div>

								<div
									class="flex h-4 w-4 items-center justify-center rounded-full transition-all"
									:class="
										currentCompaction === opt.value && hasOverride('contextCompactionMode')
											? 'bg-primary text-white'
											: currentCompaction === opt.value
												? 'border border-border/90 bg-background text-text-secondary'
												: 'border border-border/40 bg-transparent opacity-0 group-hover:opacity-40'
									"
								>
									<i class="fa-solid fa-check text-[9px]" aria-hidden="true"></i>
								</div>
							</div>

							<p class="mt-2 text-[11px] leading-relaxed text-text-secondary">
								{{ opt.description }}
							</p>
						</div>

						<div class="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
							<span
								v-if="currentCompaction === opt.value && hasOverride('contextCompactionMode')"
								class="font-medium text-primary flex items-center gap-1"
							>
								<i class="fa-solid fa-check text-[9px]"></i>
								{{ t('agent.settings.executionPolicy.customOverride') }}
							</span>
							<span
								v-else-if="currentCompaction === opt.value"
								class="text-text-secondary/80 flex items-center gap-1"
							>
								<i class="fa-solid fa-link text-[8px]"></i>
								{{ t('agent.settings.executionPolicy.activeInherited') }}
							</span>
							<span
								v-else
								class="text-text-secondary/60 transition-colors group-hover:text-text-secondary"
							>
								{{ t('agent.settings.executionPolicy.clickToOverride') }}
							</span>
						</div>
					</button>
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
