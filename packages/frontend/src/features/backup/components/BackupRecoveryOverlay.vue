<script setup lang="ts">
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiInlineLoading, UiModal } from '@/foundation/ui';
	import { useBackupStore } from '../store/backup.store';
	const { t } = useI18n();
	const backup = useBackupStore();

	function reload(): void {
		window.location.reload();
	}
</script>

<template>
	<UiModal
		:visible="backup.blocked"
		:title="t('settings.backup.restoreStateTitle')"
		:close-on-backdrop="false"
		:close-on-escape="false"
		focus-on-open
		:z-index="10000"
	>
		<div class="space-y-4" role="status" data-backup-recovery>
			<UiInlineLoading
				v-if="backup.state.status === 'restoring'"
				density="default"
				:label="t('settings.backup.restoring')"
			/>
			<template v-else-if="backup.state.status === 'restored'">
				<p>
					{{
						t('settings.backup.importedWithCounts', {
							rows: backup.state.receipt.restoredRows,
							files: backup.state.receipt.restoredFiles,
						})
					}}
				</p>
				<p v-if="backup.state.receipt.cleanupPending">{{ t('settings.backup.cleanupPending') }}</p>
				<UiButton type="button" @click="reload">{{ t('settings.backup.reload') }}</UiButton>
			</template>
			<template v-else-if="backup.state.status === 'unknown'">
				<p>{{ t('settings.backup.unknown') }}</p>
				<p>{{ t('settings.backup.unknownRecovery') }}</p>
			</template>
		</div>
	</UiModal>
</template>
