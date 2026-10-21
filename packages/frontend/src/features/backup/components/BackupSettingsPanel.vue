<script setup lang="ts">
	import { ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiFormField, UiInput } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
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
	const exportMessage = ref('');
	const exportSuccess = ref(false);
	const importMessage = ref('');
	const importSuccess = ref(false);
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
	<section class="overflow-hidden rounded-xl border border-border bg-card shadow-sm" data-backup-settings>
		<h2 class="border-b border-border bg-header/60 px-6 py-4 text-lg font-semibold text-foreground">
			{{ t('settings.category.dataManagement') }}
		</h2>
		<div class="space-y-8 p-6">
			<section>
				<h3 class="mb-2 text-base font-semibold text-foreground">{{ t('settings.backup.title') }}</h3>
				<p class="mb-4 max-w-3xl text-sm text-text-secondary">{{ t('settings.backup.description') }}</p>
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
							<template #leading
								><i
									:class="backup.busy ? 'fas fa-spinner fa-spin' : 'fas fa-download'"
									aria-hidden="true"
								></i
							></template>
							{{ backup.busy ? t('common.loading') : t('settings.backup.export') }}
						</UiButton>
						<p
							v-if="exportMessage"
							:class="exportSuccess ? 'text-success' : 'text-error'"
							class="text-sm"
							role="status"
						>
							{{ exportMessage }}
						</p>
					</div>
				</form>
			</section>
			<section class="border-t border-border/60 pt-6">
				<h3 class="mb-2 text-base font-semibold text-foreground">{{ t('settings.backup.import') }}</h3>
				<p class="mb-4 max-w-3xl text-sm text-text-secondary">{{ t('settings.backup.importDescription') }}</p>
				<form class="space-y-3" data-backup-import @submit.prevent="importBackup">
					<UiFormField :label="t('settings.backup.backupFile')" for-id="backup-import-file" class="max-w-xl">
						<input
							id="backup-import-file"
							ref="importInput"
							type="file"
							class="block w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
							accept=".nexus-backup,application/octet-stream"
							required
							:disabled="backup.busy || backup.blocked"
							@change="selectFile"
						/>
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
							<template #leading
								><i
									:class="backup.busy ? 'fas fa-spinner fa-spin' : 'fas fa-upload'"
									aria-hidden="true"
								></i
							></template>
							{{ backup.busy ? t('common.loading') : t('settings.backup.import') }}
						</UiButton>
						<p
							v-if="importMessage"
							:class="importSuccess ? 'text-success' : 'text-error'"
							class="text-sm"
							role="status"
						>
							{{ importMessage }}
						</p>
					</div>
				</form>
			</section>
		</div>
	</section>
</template>
