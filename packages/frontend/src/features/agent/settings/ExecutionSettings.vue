<script setup lang="ts">
	import { UiButton } from '@/foundation/ui';
	import { useI18n } from 'vue-i18n';
	import {
		AGENT_EXECUTION_LIMIT_KEYS,
		AGENT_EXECUTION_LIMIT_MAXIMA,
		AGENT_EXECUTION_PROFILE_MAX_REQUESTS,
	} from '@nexus-terminal/shared/agent/execution/values';
	import { useExecutionSettings } from '../composables/use-execution-settings';
	import type { ExecutionModel, ExecutionModelChoice } from '../model/execution-types';
	import { formatAgentDate } from '../locale-format';

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
		blocked,
		hardChanged,
		perform,
		loadModels,
	} = useExecutionSettings();

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
	<section
		class="space-y-4 rounded-xl border border-border bg-card p-4"
		:aria-label="t('agent.settings.execution.title')"
	>
		<h3 class="font-medium">{{ t('agent.settings.execution.title') }}</h3>
		<p class="text-sm text-text-secondary">{{ t('agent.settings.execution.description') }}</p>
		<p
			v-if="notice"
			:role="notice === 'saved' ? 'status' : 'alert'"
			class="text-sm"
			:class="notice === 'saved' ? 'text-success' : 'text-error'"
		>
			{{ t('agent.settings.execution.' + notice) }}
		</p>
		<p v-if="refreshRequired" class="text-sm text-warning">{{ t('agent.settings.execution.refreshRequired') }}</p>
		<UiButton type="button" :disabled="busy" @click="perform('read')">{{
			t('agent.settings.execution.read')
		}}</UiButton>
		<template v-if="draft && hardDraft">
			<fieldset :disabled="blocked || confirmation !== null" class="space-y-4">
				<label class="flex items-center gap-2"
					><input v-model="draft.enabled" type="checkbox" />{{ t('agent.settings.execution.enabled') }}</label
				>
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<label v-for="key in AGENT_EXECUTION_LIMIT_KEYS" :key="key" class="space-y-1 text-sm">
						<span class="block">{{ t('agent.settings.execution.limits.' + key) }}</span>
						<input
							v-model.number="draft.limits[key]"
							type="number"
							min="1"
							:max="draft.hardLimits[key]"
							step="1"
							:aria-label="t('agent.settings.execution.limits.' + key)"
							class="w-full rounded border border-border bg-background p-2"
						/>
						<span class="block text-xs text-text-secondary">{{
							t('agent.settings.execution.currentHard', { value: draft.hardLimits[key] })
						}}</span>
					</label>
				</div>
				<h4 class="font-medium">{{ t('agent.settings.execution.profiles') }}</h4>
				<p v-if="modelsFailed" role="alert" class="text-sm text-warning">
					{{ t('agent.settings.execution.modelsFailed') }}
				</p>
				<UiButton type="button" :disabled="modelsBusy" @click="loadModels">{{
					t('agent.settings.execution.readModels')
				}}</UiButton>
				<div
					v-for="profile in draft.profiles"
					:key="profile.name"
					class="space-y-3 border-t border-border pt-3"
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
								<option v-for="choice in choices" :key="choice.key" :value="explicitModel(choice)">
									{{ choice.label }} · v{{ choice.configurationVersion }}
								</option>
							</select>
						</label>
						<label class="space-y-1 text-sm"
							><span class="block">{{ t('agent.settings.execution.requests') }}</span
							><input
								v-model.number="profile.maxRequests"
								type="number"
								min="1"
								:max="Math.min(AGENT_EXECUTION_PROFILE_MAX_REQUESTS, draft.limits.maxModelRequests)"
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
				<UiButton type="button" :disabled="!dirty" @click="perform('save')">{{ t('common.save') }}</UiButton>
			</fieldset>
			<details class="space-y-3 border-t border-border pt-3">
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
	</section>
</template>
