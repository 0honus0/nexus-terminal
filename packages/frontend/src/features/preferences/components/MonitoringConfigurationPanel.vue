<script setup lang="ts">
	import { useId } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiNumberInput, UiSettingsGroup } from '@/foundation/ui';
	import { useSettingsReloadSource } from '@/shared/feedback/public';
	import {
		SETTINGS_MONITORING_MIN_SECONDS,
		SETTINGS_MONITORING_MAX_SECONDS,
	} from '@nexus-terminal/shared/preferences/configuration/values';
	import { useMonitoringConfiguration } from '../composables/use-monitoring-configuration';

	const { t } = useI18n();
	const configuration = useMonitoringConfiguration();
	const id = useId();
	useSettingsReloadSource({
		id: 'preferences-monitoring-configuration',

		pending: () =>
			!configuration.loading.value && configuration.needsRefresh.value && Boolean(configuration.feedback.value),

		reload: configuration.refresh,
	});
</script>

<template>
	<UiSettingsGroup
		:title="t('settings.monitoring.title')"
		icon="fa-solid fa-gauge-high"
		tone="success"
		data-monitoring-configuration
	>
		<template #actions>
			<UiButton
				type="submit"
				form="monitoring-configuration-form"
				:appearance="configuration.canSave.value ? 'solid' : 'soft'"
				:tone="configuration.canSave.value ? 'primary' : 'neutral'"
				:disabled="!configuration.canSave.value"
				data-monitoring-save
				>{{ t('common.save') }}</UiButton
			>
		</template>
		<p v-if="configuration.snapshot.value" class="mt-1 text-xs" data-monitoring-effective>
			{{
				t('settings.monitoring.effective', {
					status: configuration.snapshot.value.effectiveMonitoring.statusIntervalSeconds,
					host: configuration.snapshot.value.effectiveMonitoring.hostIntervalSeconds,
				})
			}}
		</p>
		<form
			v-if="configuration.draft.value"
			id="monitoring-configuration-form"
			class="monitoring-configuration__form"
			@submit.prevent="configuration.save"
		>
			<UiFormField
				:label="t('settings.monitoring.status')"
				:for-id="`${id}-status`"
				class="monitoring-configuration__field"
			>
				<UiNumberInput
					:id="`${id}-status`"
					v-model="configuration.draft.value.statusIntervalSeconds"
					class="monitoring-configuration__input"
					icon="fa-regular fa-clock"
					:min="SETTINGS_MONITORING_MIN_SECONDS"
					:max="SETTINGS_MONITORING_MAX_SECONDS"
					step="1"
					:disabled="configuration.loading.value || configuration.needsRefresh.value"
					data-monitoring-status
				/>
			</UiFormField>
			<UiFormField
				:label="t('settings.monitoring.host')"
				:for-id="`${id}-host`"
				class="monitoring-configuration__field"
			>
				<UiNumberInput
					:id="`${id}-host`"
					v-model="configuration.draft.value.hostIntervalSeconds"
					class="monitoring-configuration__input"
					icon="fa-regular fa-clock"
					:min="SETTINGS_MONITORING_MIN_SECONDS"
					:max="SETTINGS_MONITORING_MAX_SECONDS"
					step="1"
					:disabled="configuration.loading.value || configuration.needsRefresh.value"
					data-monitoring-host
				/>
			</UiFormField>
		</form>
		<p v-if="configuration.loading.value" class="mt-2 text-sm">{{ t('common.loading') }}</p>
	</UiSettingsGroup>
</template>

<style scoped>
	.monitoring-configuration__form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 12px 20px;
		margin-top: 12px;
	}

	.monitoring-configuration__field {
		min-width: min(100%, 10rem);
		flex: 1 1 12rem;
		max-width: 16rem;
	}

	.monitoring-configuration__input {
		width: 100%;
	}
</style>
