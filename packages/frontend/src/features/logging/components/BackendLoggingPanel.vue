<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { BACKEND_LOG_LEVELS, type BackendLogLevel } from '@nexus-terminal/shared/operations/logging/values';
	import { UiSelect } from '@/foundation/ui';

	defineProps<{
		level: BackendLogLevel;
		busy: boolean;
		needsRefresh: boolean;
	}>();
	const emit = defineEmits<{ 'update:level': [level: BackendLogLevel] }>();
	const { t } = useI18n();
</script>
<template>
	<section data-backend-logging class="space-y-3">
		<span class="text-xs font-semibold text-foreground">{{ t('settings.logging.backendTitle') }}</span>
		<UiSelect
			id="backendLogLevelSelect"
			:model-value="level"
			:aria-label="t('settings.logging.backendLabel')"
			:disabled="busy || needsRefresh"
			@update:model-value="emit('update:level', $event as BackendLogLevel)"
		>
			<option v-for="item in BACKEND_LOG_LEVELS" :key="item" :value="item">
				{{ item.toUpperCase() }}
			</option>
		</UiSelect>
	</section>
</template>
