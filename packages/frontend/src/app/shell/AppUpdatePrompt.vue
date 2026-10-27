<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiDialog } from '@/foundation/ui';
	import { appUpdate, applyAppUpdate, dismissAppUpdate } from '../bootstrap/pwa';

	const { t } = useI18n();
	const visible = computed(() => appUpdate.available && !appUpdate.dismissed);

	const handleOpenChange = (open: boolean): void => {
		if (!open) dismissAppUpdate();
	};
</script>

<template>
	<UiDialog
		:open="visible"
		:title="t('appUpdate.title')"
		:description="t('appUpdate.description')"
		icon="fas fa-cloud-arrow-down"
		tone="primary"
		:close-on-interact-outside="false"
		:show-close="false"
		density="comfortable"
		panel-class="ui-update-prompt"
		@open-change="handleOpenChange"
	>
		<template #footer>
			<UiButton type="button" appearance="ghost" :disabled="appUpdate.applying" @click="dismissAppUpdate">
				{{ t('appUpdate.later') }}
			</UiButton>
			<UiButton
				type="button"
				appearance="solid"
				tone="primary"
				:loading="appUpdate.applying"
				@click="applyAppUpdate"
			>
				{{ t('appUpdate.apply') }}
			</UiButton>
		</template>
	</UiDialog>
</template>
