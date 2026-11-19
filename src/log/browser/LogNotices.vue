<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiToastStack } from '../../ui/browser/ui-base-api.js';
	import type { UiToastItem } from '../../ui/browser/ui-component-types.js';
	import type { LogApi } from './log-api.js';

	const { log } = defineProps<{ log: Pick<LogApi, 'notices' | 'dismissNotice'> }>();
	const { t, te } = useI18n({ useScope: 'global' });
	const items = computed<UiToastItem[]>(() =>
		log.notices.value.map((notice) => {
			const key = `notices.${notice.code}`;
			return {
				id: notice.id,
				message: t(te(key) ? key : 'notices.operationFailed', { ...notice.params }),
				tone:
					notice.level === 'error' || notice.level === 'fatal'
						? 'error'
						: notice.level === 'warn'
							? 'warning'
							: 'info',
			};
		}),
	);
</script>

<template>
	<UiToastStack
		:items="items"
		:label="t('toast.label')"
		:close-label="t('toast.close')"
		:expand-label="t('toast.expand')"
		:collapse-label="t('toast.collapse')"
		:position-label="(position, total) => t('toast.position', { position, total })"
		@dismiss="(id) => log.dismissNotice(String(id))"
	/>
</template>
