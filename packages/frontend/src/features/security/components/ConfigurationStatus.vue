<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton } from '@/foundation/ui';
	defineProps<{
		pendingRestart?: boolean;
		needsRefresh: boolean;
		loading: boolean;
		message: string;
		success: boolean;
	}>();
	defineEmits<{ refresh: [] }>();
	const { t } = useI18n();
</script>
<template>
	<div class="space-y-2 text-sm" role="status">
		<p v-if="pendingRestart" class="text-warning">{{ t('settings.configuration.restart') }}</p>
		<p v-if="message" :class="success ? 'text-success' : 'text-error'">{{ message }}</p>
		<UiButton v-if="needsRefresh" :loading="loading" @click="$emit('refresh')">{{ t('common.retry') }}</UiButton>
	</div>
</template>
