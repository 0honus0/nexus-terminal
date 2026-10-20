<script setup lang="ts">
	import { useId } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput } from '@/foundation/ui';
	import {
		SETTINGS_MONITORING_MIN_SECONDS,
		SETTINGS_MONITORING_MAX_SECONDS,
	} from '@nexus-terminal/shared/preferences/configuration/values';
	import { useMonitoringConfiguration } from '../composables/use-monitoring-configuration';

	const { t } = useI18n();
	const configuration = useMonitoringConfiguration();
	const id = useId();
</script>

<template>
	<section class="rounded-lg border border-border p-4" data-monitoring-configuration>
		<h3 class="font-semibold">{{ t('settings.monitoring.title') }}</h3>
		<p class="mt-1 text-xs text-text-secondary">{{ t('settings.monitoring.hint') }}</p>
		<p v-if="configuration.snapshot.value?.pendingRestart" class="mt-1 text-xs" data-monitoring-effective>
			{{
				t('settings.monitoring.effective', {
					status: configuration.snapshot.value.effectiveMonitoring.statusIntervalSeconds,
					host: configuration.snapshot.value.effectiveMonitoring.hostIntervalSeconds,
				})
			}}
		</p>
		<p v-if="configuration.snapshot.value?.pendingRestart" class="mt-1 text-sm text-warning">
			{{ t('settings.monitoring.restart') }}
		</p>
		<form v-if="configuration.draft.value" class="mt-3 space-y-3" @submit.prevent="configuration.save">
			<UiFormField :label="t('settings.monitoring.status')" :for-id="`${id}-status`">
				<UiInput
					:id="`${id}-status`"
					v-model="configuration.draft.value.statusIntervalSeconds"
					type="number"
					:min="SETTINGS_MONITORING_MIN_SECONDS"
					:max="SETTINGS_MONITORING_MAX_SECONDS"
					step="1"
					:disabled="configuration.loading.value || configuration.needsRefresh.value"
					data-monitoring-status
				/>
			</UiFormField>
			<UiFormField :label="t('settings.monitoring.host')" :for-id="`${id}-host`">
				<UiInput
					:id="`${id}-host`"
					v-model="configuration.draft.value.hostIntervalSeconds"
					type="number"
					:min="SETTINGS_MONITORING_MIN_SECONDS"
					:max="SETTINGS_MONITORING_MAX_SECONDS"
					step="1"
					:disabled="configuration.loading.value || configuration.needsRefresh.value"
					data-monitoring-host
				/>
			</UiFormField>
			<UiButton
				type="submit"
				appearance="solid"
				tone="primary"
				:disabled="!configuration.canSave.value"
				data-monitoring-save
				>{{ t('common.save') }}</UiButton
			>
		</form>
		<UiButton
			v-if="configuration.needsRefresh.value && configuration.feedback.value && !configuration.loading.value"
			class="mt-3"
			@click="configuration.refresh"
			data-monitoring-refresh
			>{{ t('settings.monitoring.refresh') }}</UiButton
		>
		<p v-if="configuration.loading.value" class="mt-2 text-sm">{{ t('common.loading') }}</p>
		<p
			v-if="configuration.feedback.value"
			role="status"
			aria-live="polite"
			class="mt-2 text-sm"
			:class="configuration.feedback.value === 'saved' ? 'text-success' : 'text-error'"
			data-monitoring-feedback
		>
			{{ t(`settings.monitoring.feedback.${configuration.feedback.value}`) }}
		</p>
	</section>
</template>
