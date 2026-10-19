<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { BACKEND_LOG_LEVELS } from '@nexus-terminal/shared/operations/logging/values';
	import { UiButton, UiFormField, UiSelect } from '@/foundation/ui';
	import { useBackendLogging } from '../composables/use-backend-logging';
	const { t } = useI18n();
	const { snapshot, level, busy, needsRefresh, message, execute } = useBackendLogging();
</script>
<template>
	<section class="space-y-3" data-backend-logging>
		<form class="space-y-3" @submit.prevent="execute(true)">
			<UiFormField :label="t('settings.logging.backendLabel')" for-id="backendLogLevelSelect">
				<UiSelect id="backendLogLevelSelect" v-model="level" :disabled="busy || needsRefresh">
					<option v-for="item in BACKEND_LOG_LEVELS" :key="item" :value="item">
						{{ item.toUpperCase() }}
					</option>
				</UiSelect>
			</UiFormField>
			<p v-if="snapshot" class="text-xs text-text-secondary">
				{{ t('settings.logging.effective', { level: snapshot.effectiveLevel.toUpperCase() }) }}
			</p>
			<UiButton type="submit" :disabled="busy || needsRefresh || level === snapshot?.level">{{
				t('common.save')
			}}</UiButton>
		</form>
		<UiButton :disabled="busy" @click="execute()">{{ t('common.refresh') }}</UiButton>
		<p v-if="message" role="status" class="text-sm">{{ message }}</p>
	</section>
</template>
