<script setup lang="ts">
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput, UiSettingsGroup } from '@/foundation/ui';
	import { useFeedback, useFeedbackMessage } from '@/shared/feedback/public';
	import { useAuthenticatedViewScope } from '@/shared/session/public';
	import { BACKUP_MAX_FILE_BYTES } from '@nexus-terminal/shared/system/backups/values';
	import { BackupRequestFailure } from '../model/backup-types';
	import { useBackupStore } from '../store/backup.store';

	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t } = useI18n();
	const backup = useBackupStore();
	const feedback = useFeedback();
	const exportPassword = ref('');
	const importPassword = ref('');
	const importFile = ref<File | null>(null);
	const importInput = ref<HTMLInputElement | null>(null);
	let exportFailureCause: unknown;
	let importFailureCause: unknown;
	const exportMessage = ref('');
	const exportSuccess = ref(false);
	const importMessage = ref('');
	const importSuccess = ref(false);
	useFeedbackMessage(
		() => exportMessage.value,
		() => (exportSuccess.value ? 'success' : 'error'),
		() => exportFailureCause,
	);
	useFeedbackMessage(
		() => importMessage.value,
		() => (importSuccess.value ? 'success' : 'error'),
		() => importFailureCause,
	);
	const view = useAuthenticatedViewScope({
		available: () => props.active,

		onRevoke: clearDraft,
	});

	function clearDraft(): void {
		exportPassword.value = '';
		importPassword.value = '';
		importFile.value = null;
		if (importInput.value) {
			importInput.value.value = '';
		}
		exportMessage.value = '';
		exportSuccess.value = false;
		importMessage.value = '';
		importSuccess.value = false;
	}

	function failureMessage(cause: unknown, importing = false): string {
		if (!(cause instanceof BackupRequestFailure) || cause.outcome === 'unknown') {
			return t(importing ? 'settings.backup.unknown' : 'settings.backup.exportFailed');
		}
		if (cause.code === 'invalid_password') {
			return t('settings.backup.invalidPassword');
		}
		if (cause.code === 'invalid_input' || cause.code === 'limit_exceeded') {
			return t('settings.backup.invalidInput');
		}
		if (cause.code === 'busy' || cause.code === 'source_changed') {
			return t('settings.backup.busy');
		}
		return t('settings.backup.operationFailed');
	}

	async function exportBackup(): Promise<void> {
		const signal = view.capture();
		if (!exportPassword.value || signal.aborted || backup.busy || backup.blocked) {
			return;
		}
		const password = exportPassword.value;
		exportPassword.value = '';
		exportMessage.value = '';
		exportSuccess.value = false;
		try {
			await backup.exportFull(password, signal);
			if (view.isCurrent(signal)) {
				exportSuccess.value = true;
				exportMessage.value = t('settings.backup.exported');
			}
		} catch (cause) {
			if (view.isCurrent(signal)) {
				exportSuccess.value = false;
				exportFailureCause = cause;
				exportMessage.value = failureMessage(cause);
			}
		}
	}

	async function importBackup(): Promise<void> {
		const signal = view.capture();
		const file = importFile.value;
		const password = importPassword.value === '' ? null : importPassword.value;
		if (signal.aborted || backup.busy || backup.blocked) {
			return;
		}
		if (!file || file.size < 1 || file.size > BACKUP_MAX_FILE_BYTES) {
			importFailureCause = undefined;
			importMessage.value = t('settings.backup.invalidInput');
			importSuccess.value = false;
			return;
		}
		const confirmed = await feedback.confirm({
			message: t('settings.backup.confirmImport'),
			destructive: true,
			signal,
		});
		if (!confirmed || !view.isCurrent(signal)) {
			return;
		}
		clearDraft();
		try {
			await backup.importFull(file, password, signal);
			if (view.isCurrent(signal) && backup.state.status === 'restored') {
				importSuccess.value = true;
				importMessage.value = t('settings.backup.importedWithCounts', {
					rows: backup.state.receipt.restoredRows,
					files: backup.state.receipt.restoredFiles,
				});
			}
		} catch (cause) {
			if (view.isCurrent(signal)) {
				importSuccess.value = false;
				importFailureCause = cause;
				importMessage.value = failureMessage(cause, true);
			}
		}
	}

	function selectFile(event: Event): void {
		if (event.target instanceof HTMLInputElement) {
			importFile.value = event.target.files?.[0] ?? null;
			importMessage.value = '';
			importSuccess.value = false;
		}
	}
</script>

<template>
	<section class="settings-surface" data-backup-settings>
		<div class="ui-settings-grid">
			<UiSettingsGroup :title="t('settings.backup.title')" icon="fa-solid fa-file-export" tone="warning">
				<form class="space-y-3" data-backup-export @submit.prevent="exportBackup">
					<UiFormField
						:label="t('settings.backup.currentPassword')"
						for-id="backup-export-password"
						class="max-w-md"
					>
						<UiInput
							id="backup-export-password"
							v-model="exportPassword"
							type="password"
							autocomplete="current-password"
							required
							:disabled="backup.busy || backup.blocked"
						/>
					</UiFormField>
					<div class="flex flex-wrap items-center gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="backup.busy"
							:disabled="!exportPassword || backup.busy || backup.blocked"
						>
							<template #leading><i class="fas fa-download" aria-hidden="true"></i></template>
							{{ t('settings.backup.export') }}
						</UiButton>
					</div>
				</form>
			</UiSettingsGroup>
			<UiSettingsGroup :title="t('settings.backup.import')" icon="fa-solid fa-file-import" tone="info">
				<form class="space-y-3" data-backup-import @submit.prevent="importBackup">
					<UiFormField :label="t('settings.backup.backupFile')" for-id="backup-import-file">
						<input
							id="backup-import-file"
							ref="importInput"
							type="file"
							class="sr-only"
							accept=".nexus-backup,application/octet-stream"
							required
							:disabled="backup.busy || backup.blocked"
							@change="selectFile"
						/>
						<div class="flex min-w-0 flex-wrap items-center gap-2">
							<UiButton
								type="button"
								appearance="soft"
								tone="neutral"
								:disabled="backup.busy || backup.blocked"
								@click="importInput?.click()"
							>
								<template #leading><i class="fa-solid fa-folder-open" aria-hidden="true"></i></template>
								{{ t('settings.backup.chooseFile') }}
							</UiButton>
							<span class="min-w-0 truncate text-xs text-text-secondary">
								{{ importFile?.name || t('settings.backup.noFileSelected') }}
							</span>
						</div>
					</UiFormField>
					<UiFormField
						:label="t('settings.backup.backupPassword')"
						for-id="backup-import-password"
						class="max-w-md"
					>
						<UiInput
							id="backup-import-password"
							v-model="importPassword"
							type="password"
							autocomplete="off"
							:disabled="backup.busy || backup.blocked"
						/>
						<p class="text-xs text-text-secondary">{{ t('settings.backup.backupPasswordHelp') }}</p>
					</UiFormField>
					<div class="flex flex-wrap items-center gap-3">
						<UiButton
							type="submit"
							appearance="solid"
							tone="primary"
							:loading="backup.busy"
							:disabled="!importFile || backup.busy || backup.blocked"
						>
							<template #leading><i class="fas fa-upload" aria-hidden="true"></i></template>
							{{ t('settings.backup.import') }}
						</UiButton>
					</div>
				</form>
			</UiSettingsGroup>
		</div>
	</section>
</template>
