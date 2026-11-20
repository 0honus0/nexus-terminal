<script setup lang="ts">
	import { Archive, Download, ShieldCheck, Upload } from '@lucide/vue';
	import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import type { z } from 'zod';
	import type { LogApi } from '../../log/browser/log-api.js';
	import type { StateClient } from '../../state/browser/state-api.js';
	import {
		UiButton,
		UiDialog,
		UiField,
		UiInput,
		UiList,
		UiListItem,
		UiSection,
	} from '../../ui/browser/ui-components-api.js';
	import { CodedError } from '../../utils/error.js';
	import type { BackupApi } from './backup-api.js';
	import {
		BackupFileSchema,
		BackupJobSchema,
		BackupStatusTopic,
		type BackupPlanSchema,
		type BackupStatusSchema,
	} from '../backup-http-types.js';
	import './backup.css';

	const { api, log, state } = defineProps<{
		api: BackupApi;
		log: Pick<LogApi, 'report'>;
		state?: Pick<StateClient, 'subscribe'>;
	}>();
	const { t } = useI18n({ useScope: 'global' });
	const lifetime = new AbortController();
	const password = ref('');
	const restorePassword = ref('');
	const file = shallowRef<File>();
	const plan = shallowRef<{ preview: z.infer<typeof BackupPlanSchema>; archive: z.infer<typeof BackupFileSchema> }>();
	const job = shallowRef<z.infer<typeof BackupStatusSchema> | null>(null);
	const loading = ref<'export' | 'inspect' | 'restore'>();
	const dialog = ref(false);
	const busy = computed(() => !!loading.value || job.value?.state === 'restoring');

	function accept(next: typeof job.value): void {
		if (lifetime.signal.aborted || !next) return;
		if (job.value?.id === next.id && job.value.state !== 'restoring') return;
		const finished = job.value?.id === next.id && job.value.state === 'restoring' && next.state !== 'restoring';
		job.value = next;
		if (finished)
			log.report({
				source: 'backup',
				level: next.state === 'succeeded' ? 'info' : 'error',
				code: next.state === 'succeeded' ? 'BACKUP_RESTORED' : (next.error ?? 'BACKUP_RESTORE_FAILED'),
				userVisible: true,
			});
	}

	async function readStatus(): Promise<void> {
		const current = job.value;
		try {
			const { job: next } = await api.status(lifetime.signal);
			if (job.value === current) accept(next);
		} catch {
			// 状态主题能在重新连接后补上当前快照。
		}
	}

	watch(
		() => state,
		(client, _, onCleanup) => {
			if (!client) return;
			const unsubscribe = client.subscribe(BackupStatusTopic, BackupJobSchema, {
				updated: ({ job }) => accept(job),

				unconfirmed: () => {
					if (!lifetime.signal.aborted) void readStatus();
				},
			});
			onCleanup(unsubscribe);
			void readStatus();
		},
		{ immediate: true },
	);
	onScopeDispose(() => lifetime.abort());

	async function run(kind: NonNullable<typeof loading.value>, operation: () => Promise<void>): Promise<void> {
		if (busy.value) return;
		loading.value = kind;
		try {
			await operation();
		} catch (cause) {
			if (!lifetime.signal.aborted)
				log.report({
					source: 'backup',
					level: 'error',
					code: cause instanceof CodedError ? cause.code : 'BACKUP_REQUEST_FAILED',
					userVisible: true,
				});
			if (kind === 'restore') void readStatus();
		} finally {
			loading.value = undefined;
		}
	}

	function choose(event: Event): void {
		file.value = (event.target as HTMLInputElement).files?.[0];
		plan.value = undefined;
	}

	async function exportFile(): Promise<void> {
		await run('export', async () => {
			const archive = await api.exportFile(password.value, lifetime.signal);
			password.value = '';
			const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: 'application/json' }));
			try {
				const link = document.createElement('a');
				link.href = url;
				link.download = 'nexus-backup.json';
				link.click();
			} finally {
				setTimeout(() => URL.revokeObjectURL(url), 0);
			}
			log.report({ source: 'backup', level: 'info', code: 'BACKUP_EXPORTED', userVisible: true });
		});
	}

	async function inspect(): Promise<void> {
		await run('inspect', async () => {
			if (!file.value) return;
			if (file.value.size > 1_900_000) throw new CodedError('BACKUP_TOO_LARGE');
			const contents = await file.value.text();
			let fileData: unknown;
			try {
				fileData = JSON.parse(contents);
			} catch {
				throw new CodedError('BACKUP_FILE_INVALID');
			}
			const result = BackupFileSchema.safeParse(fileData);
			if (!result.success) throw new CodedError('BACKUP_FILE_INVALID');
			lifetime.signal.throwIfAborted();
			const preview = await api.preview(result.data, restorePassword.value, lifetime.signal);
			plan.value = { preview, archive: result.data };
			dialog.value = true;
		});
	}

	async function restore(): Promise<void> {
		await run('restore', async () => {
			const selection = plan.value;
			if (!selection) return;
			accept(
				await api.restore(selection.archive, restorePassword.value, selection.preview.token, lifetime.signal),
			);
			restorePassword.value = '';
			plan.value = undefined;
			void readStatus();
		});
	}
</script>

<template>
	<main class="nexus-backup">
		<header class="nexus-backup__intro">
			<span class="nexus-backup__symbol"><Archive :size="28" /></span>
			<div>
				<h1>{{ t('backup.title') }}</h1>
				<p>{{ t('backup.description') }}</p>
			</div>
		</header>
		<div class="nexus-backup__sections">
			<UiSection
				appearance="panel"
				:title="t('backup.tile.export')"
				:aria-label="t('backup.tile.export')"
				:description="t('backup.exportHint')"
				:icon="Download"
			>
				<UiField :label="t('auth.password')" :hint="t('backup.passwordHint')" v-slot="field">
					<div class="nexus-backup__form-row">
						<UiInput
							:id="field.id"
							v-model="password"
							:aria-describedby="field.describedby"
							type="password"
							autocomplete="new-password"
							:disabled="busy"
						/>
						<UiButton
							class="backup-action"
							tone="primary"
							appearance="solid"
							:loading="loading === 'export'"
							:disabled="busy || !password"
							@click="exportFile"
							><template #leading><Download :size="17" /></template
							>{{ t('backup.tile.export') }}</UiButton
						>
					</div>
				</UiField>
			</UiSection>
			<UiSection
				appearance="panel"
				:title="t('backup.tile.import')"
				:aria-label="t('backup.tile.import')"
				:description="t('backup.tile.restoreHint')"
				:icon="Upload"
			>
				<label class="nexus-backup__file" :data-disabled="busy || undefined">
					<Upload :size="22" aria-hidden="true" /><span :title="file?.name">{{
						file?.name ?? t('backup.file')
					}}</span>
					<input
						type="file"
						name="backup-file"
						accept=".json"
						:aria-label="t('backup.file')"
						:disabled="busy"
						@change="choose"
					/>
				</label>
				<UiField :label="t('auth.password')" v-slot="field">
					<div class="nexus-backup__form-row">
						<UiInput
							:id="field.id"
							v-model="restorePassword"
							type="password"
							autocomplete="off"
							:disabled="busy"
						/>
						<UiButton
							class="backup-action"
							:loading="loading === 'inspect'"
							:disabled="busy || !file || !restorePassword"
							@click="inspect"
							><template #leading><ShieldCheck :size="17" /></template>{{ t('backup.inspect') }}</UiButton
						>
					</div>
				</UiField>
			</UiSection>
		</div>
		<p v-if="job" role="status">{{ t('backup.status.' + job.state) }}</p>
		<UiDialog
			v-model:open="dialog"
			class="backup-dialog"
			:title="t('backup.inspect')"
			:close-label="t('closeApplication')"
			:close-disabled="loading === 'restore'"
			persistence-key="backup.preview"
		>
			<template v-if="plan">
				<p>{{ t('backup.restoreWarning') }}</p>
				<UiSection
					v-if="plan.preview.installs.length"
					:title="t('backup.installPlugins')"
					:description="t('backup.installHint')"
				>
					<UiList>
						<UiListItem
							v-for="{ pluginId, version, repository } in plan.preview.installs"
							:key="pluginId"
							:title="pluginId"
							:description="version + ' · ' + repository"
						/>
					</UiList>
				</UiSection>
				<UiList
					><UiListItem
						v-for="entry in plan.preview.tables"
						:key="entry.pluginId + ':' + entry.table"
						:title="entry.table"
						:description="t('backup.rows', { pluginId: entry.pluginId, count: entry.rows })"
				/></UiList>
			</template>
			<p v-else-if="job" role="status">{{ t('backup.status.' + job.state) }}</p>
			<template v-if="plan" #footer>
				<UiButton tone="danger" :loading="loading === 'restore'" @click="restore">{{
					t('backup.tile.restore')
				}}</UiButton>
			</template>
		</UiDialog>
	</main>
</template>
