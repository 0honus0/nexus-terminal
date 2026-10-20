<script setup lang="ts">
	import { computed } from 'vue';
	import { UiButton, UiInfoHint } from '@/foundation/ui';
	import { useI18n } from 'vue-i18n';
	import {
		AGENT_EXECUTION_LIMIT_KEYS,
		AGENT_EXECUTION_LIMIT_MAXIMA,
		AGENT_EXECUTION_PROFILE_MAX_REQUESTS,
	} from '@nexus-terminal/shared/agent/execution/values';
	import type { useExecutionSettings } from '../composables/use-execution-settings';
	import type { ExecutionModel, ExecutionModelChoice } from '../model/execution-types';
	import { formatAgentDate } from '../locale-format';
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

	const { t, locale } = useI18n();
	const {
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
		invalidLimits,
		setLimit,
		blocked,
		hardChanged,
		perform,
		loadModels,
	} = props.editor;

	function quantityType(key: keyof ExecutionLimits): QuantityType {
		if (key.endsWith('Bytes')) return 'bytes';
		if (key.endsWith('Seconds')) return 'seconds';
		return key === 'maxTokenReservations' ? 'tokens' : 'number';
	}

	function explicitModel(choice: ExecutionModelChoice): ExecutionModel {
		return {
			kind: 'explicit',
			providerId: choice.providerId,
			modelId: choice.modelId,
			configurationVersion: choice.configurationVersion,
		};
	}

	function isUnavailable(model: ExecutionModel): boolean {
		return (
			model.kind === 'explicit' &&
			!choices.value.some(
				(choice) =>
					choice.providerId === model.providerId &&
					choice.modelId === model.modelId &&
					choice.configurationVersion === model.configurationVersion,
			)
		);
	}
</script>

<template>
	<section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs" :aria-label="t(sectionTitle)">
		<div
			class="agent-settings-head flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3 sm:px-5 sm:py-3.5"
		>
			<div class="flex items-center gap-1.5">
				<h3 class="text-sm font-semibold text-foreground">{{ t(sectionTitle) }}</h3>
				<UiInfoHint :text="t('agent.settings.execution.description')" />
			</div>
		</div>
		<div class="space-y-4 p-4 sm:p-5">
			<p
				v-if="notice"
				:role="notice === 'saved' ? 'status' : 'alert'"
				class="text-sm"
				:class="notice === 'saved' ? 'text-success' : 'text-error'"
			>
				{{ t('agent.settings.execution.' + notice) }}
			</p>
			<p v-if="refreshRequired" class="text-sm text-warning">
				{{ t('agent.settings.execution.refreshRequired') }}
			</p>
			<UiButton
				v-if="(draft && refreshRequired) || notice === 'failed'"
				type="button"
				:disabled="busy"
				@click="perform('read')"
				>{{ t('agent.settings.execution.read') }}</UiButton
			>
			<template v-if="draft && hardDraft">
				<fieldset :disabled="blocked || confirmation !== null" class="space-y-4">
					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<label
							v-for="key in visibleKeys"
							:key="key"
							class="block space-y-1 rounded-lg bg-header/25 p-4 text-sm"
						>
							<span class="block text-xs font-semibold text-foreground">{{
								t('agent.settings.execution.limits.' + key)
							}}</span>
							<QuantityInput
								v-if="section === 'budget' || section === 'storage'"
								:model-value="invalidLimits.has(key) ? null : draft.limits[key]"
								:type="quantityType(key)"
								:min="1"
								:max="draft.hardLimits[key]"
								:aria-label="t('agent.settings.execution.limits.' + key)"
								:disabled="blocked || confirmation !== null"
								@update:model-value="setLimit(key, $event)"
							/>
							<input
								v-else
								v-model.number="draft.limits[key]"
								type="number"
								min="1"
								:max="draft.hardLimits[key]"
								step="1"
								:aria-label="t('agent.settings.execution.limits.' + key)"
								class="h-9 w-full rounded-lg border border-border bg-card px-3 text-xs text-foreground outline-none transition-colors focus:border-primary"
							/>
							<span class="block text-xs text-text-secondary">{{
								t('agent.settings.execution.currentHard', { value: draft.hardLimits[key] })
							}}</span>
						</label>
					</div>
					<template v-if="section === 'subagents'">
						<h4 class="font-medium">{{ t('agent.settings.execution.profiles') }}</h4>
						<p v-if="modelsFailed" role="alert" class="text-sm text-warning">
							{{ t('agent.settings.execution.modelsFailed') }}
						</p>
						<UiButton v-if="modelsFailed" type="button" :disabled="modelsBusy" @click="loadModels">{{
							t('agent.settings.execution.readModels')
						}}</UiButton>
						<div
							v-for="profile in draft.profiles"
							:key="profile.name"
							class="space-y-3 rounded-xl border border-border/80 bg-background/60 p-4 shadow-2xs"
						>
							<label class="flex items-center gap-2"
								><input v-model="profile.enabled" type="checkbox" />{{
									t('agent.settings.execution.profileNames.' + profile.name)
								}}</label
							>
							<div class="grid gap-3 sm:grid-cols-2">
								<label class="space-y-1 text-sm"
									><span class="block">{{ t('agent.settings.execution.model') }}</span>
									<select
										v-model="profile.model"
										class="w-full rounded border border-border bg-background p-2"
									>
										<option :value="{ kind: 'inherit' }">
											{{ t('agent.settings.execution.inherit') }}
										</option>
										<option
											v-if="isUnavailable(profile.model) && profile.model.kind === 'explicit'"
											:value="profile.model"
										>
											{{ profile.model.modelId }} · v{{ profile.model.configurationVersion }} —
											{{ t('agent.settings.execution.unavailable') }}
										</option>
										<option
											v-for="choice in choices"
											:key="choice.key"
											:value="explicitModel(choice)"
										>
											{{ choice.label }}
										</option>
									</select>
								</label>
								<label class="space-y-1 text-sm"
									><span class="block">{{ t('agent.settings.execution.requests') }}</span
									><input
										v-model.number="profile.maxRequests"
										type="number"
										min="1"
										:max="
											Math.min(
												AGENT_EXECUTION_PROFILE_MAX_REQUESTS,
												draft.limits.maxModelRequests,
											)
										"
										step="1"
										class="w-full rounded border border-border bg-background p-2"
								/></label>
								<label class="space-y-1 text-sm"
									><span class="block">{{ t('agent.settings.execution.seconds') }}</span
									><input
										v-model.number="profile.maxSeconds"
										type="number"
										min="1"
										:max="draft.limits.maxActiveSeconds"
										step="1"
										class="w-full rounded border border-border bg-background p-2"
								/></label>
								<label class="space-y-1 text-sm"
									><span class="block">{{ t('agent.settings.execution.tools') }}</span
									><textarea
										v-model="profile.toolsText"
										rows="3"
										class="w-full rounded border border-border bg-background p-2"
									/>
								</label>
							</div>
						</div>
					</template>
				</fieldset>
				<details v-if="section === 'budget'" class="space-y-3 border-t border-border pt-3">
					<summary class="cursor-pointer font-medium">{{ t('agent.settings.execution.hardLimits') }}</summary>
					<p class="text-sm text-text-secondary">{{ t('agent.settings.execution.hardDescription') }}</p>
					<fieldset :disabled="blocked || dirty" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<label v-for="key in AGENT_EXECUTION_LIMIT_KEYS" :key="key" class="space-y-1 text-sm">
							<span class="block">{{ t('agent.settings.execution.limits.' + key) }}</span>
							<input
								v-model.number="hardDraft[key]"
								type="number"
								:min="draft.limits[key]"
								:max="AGENT_EXECUTION_LIMIT_MAXIMA[key]"
								step="1"
								class="w-full rounded border border-border bg-background p-2"
							/>
						</label>
					</fieldset>
					<UiButton type="button" :disabled="blocked || dirty || !hardChanged" @click="perform('preview')">{{
						t('agent.settings.execution.preview')
					}}</UiButton>
					<div v-if="confirmation" class="space-y-2 text-sm">
						<p>
							{{
								t('agent.settings.execution.occupancy', {
									bytes: confirmation.occupiedArtifactBytes,
									runs: confirmation.activeRuns,
								})
							}}
						</p>
						<p>
							{{
								t('agent.settings.execution.expires', {
									date: formatAgentDate(locale, new Date(confirmation.expiresAt)),
								})
							}}
						</p>
						<UiButton type="button" :disabled="blocked || dirty" @click="perform('confirm')">{{
							t('agent.settings.execution.confirm')
						}}</UiButton>
						<UiButton type="button" :disabled="busy" @click="confirmation = null">{{
							t('common.cancel')
						}}</UiButton>
					</div>
				</details>
			</template>
		</div>
		<div
			v-if="draft && hardDraft"
			class="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-header/20 px-4 py-3 sm:px-5"
		>
			<span class="text-xs" :class="dirty ? 'text-warning' : 'text-text-secondary'">{{
				t(dirty ? 'agent.settings.budget.unsavedChanges' : 'agent.settings.budget.readyNotice')
			}}</span>
			<UiButton
				type="button"
				:appearance="dirty ? 'solid' : 'soft'"
				:tone="dirty ? 'primary' : 'neutral'"
				:disabled="blocked || confirmation !== null || !dirty"
				@click="perform('save')"
			>
				<i v-if="busy" class="fa-solid fa-spinner fa-spin text-xs" aria-hidden="true"></i>
				{{ t('common.save') }}
			</UiButton>
		</div>
	</section>
</template>
