<script setup lang="ts">
	import { computed } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { UiButton, UiCheckbox, UiSelect, type UiSelectOption } from '@/foundation/ui';
	import { AGENT_ARTIFACT_CONTENT_TYPES } from '@nexus-terminal/shared/agent/artifacts/values';
	import { useArtifactLibrary } from '../composables/use-artifact-library';
	import { formatAgentDateTime } from '../locale-format';
	import type { ManagedArtifact } from '../model/artifact-types';
	import ArtifactAttachmentEditor from './ArtifactAttachmentEditor.vue';
	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });

	const { t, locale } = useI18n();
	const {
		apps,
		filters,
		items,
		storage,
		statsRequired,
		needsReload,
		offset,
		nextOffset,
		deleteTarget,
		uploadFile,
		uploadRecord,
		uploadUnknown,
		uploadAcknowledged,
		cleanupPlan,
		cleanupResult,
		cleanupUnknown,
		operation,
		appOperation,
		storageOperation,
		blocked,
		load,
		loadStorage,
		loadApps,
		retain,
		remove,
		upload,
		checkUpload,
		newUploadIntent,
		download,
		prepareCleanup,
		confirmCleanup,
		discardCleanup,
	} = useArtifactLibrary(() => props.active);

	function chooseFile(event: Event): void {
		if (event.target instanceof HTMLInputElement) {
			uploadFile.value = event.target.files?.[0] ?? null;
			event.target.value = '';
		}
	}

	function time(value: number | null): string {
		return value === null ? '—' : formatAgentDateTime(locale.value, new Date(value));
	}

	const bytes = (value: number): string => {
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
		if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
		return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
	};

	const storageUsagePercent = computed(() => {
		if (!storage.value || storage.value.limitBytes <= 0) return 0;
		return Math.min(100, Math.round((storage.value.totalBytes / storage.value.limitBytes) * 100));
	});

	const availableBytes = computed(() =>
		storage.value ? Math.max(0, storage.value.limitBytes - storage.value.totalBytes) : 0,
	);

	const hasFilters = computed(
		() =>
			Boolean(filters.value.query.trim()) ||
			Boolean(filters.value.appId) ||
			filters.value.retention !== 'all' ||
			filters.value.kind !== '',
	);

	const appOptions = computed<UiSelectOption[]>(() => [
		{ value: '', label: t('agent.files.allApps'), triggerLabel: t('agent.files.filterLabels.app') },
		...apps.value.map((app) => ({ value: app.id, label: app.name })),
	]);
	const fileKindOptions = computed<UiSelectOption[]>(() => [
		{ value: '', label: t('agent.files.kind.all'), triggerLabel: t('agent.files.filterLabels.type') },
		...AGENT_ARTIFACT_CONTENT_TYPES.map((value) => ({ value, label: t('agent.files.kind.' + value) })),
	]);
	const retentionOptions = computed<UiSelectOption[]>(() => [
		{ value: 'all', label: t('agent.files.allRetention'), triggerLabel: t('agent.files.filterLabels.status') },
		{ value: 'retained', label: t('agent.files.retained') },
		{ value: 'unretained', label: t('agent.files.unretained') },
	]);

	function resetFilters(): void {
		filters.value = { appId: '', kind: '', retention: 'all', query: '' };
		void load();
	}

	function selectApp(value: unknown): void {
		if (typeof value !== 'string' || (value !== '' && !apps.value.some((app) => app.id === value))) return;
		filters.value.appId = value;
		void load();
	}

	function selectKind(value: unknown): void {
		const kind = value === '' ? '' : AGENT_ARTIFACT_CONTENT_TYPES.find((kind) => kind === value);
		if (kind === undefined) return;
		filters.value.kind = kind;
		void load();
	}

	function selectRetention(value: unknown): void {
		if (value !== 'all' && value !== 'retained' && value !== 'unretained') return;
		filters.value.retention = value;
		void load();
	}

	function statusTone(status: ManagedArtifact['status']): string {
		if (status === 'ready') return 'bg-success/10 text-success';
		if (status === 'staging') return 'bg-warning/10 text-warning';
		if (status === 'unavailable') return 'bg-error/10 text-error';
		return 'bg-header text-text-secondary';
	}

	const extensionOf = (name: string): string => {
		const filename = name.split('/').at(-1) ?? name;
		const index = filename.lastIndexOf('.');
		if (index <= 0 || index === filename.length - 1) return '';
		return filename
			.slice(index + 1)
			.slice(0, 8)
			.toUpperCase();
	};

	const kindPresentation: Record<ManagedArtifact['kind'], { icon: string; tone: string }> = {
		image: { icon: 'fa-image', tone: 'border-primary/20 bg-primary/10 text-primary' },
		document: { icon: 'fa-file-lines', tone: 'border-info/20 bg-info/10 text-info' },
		code: { icon: 'fa-file-code', tone: 'border-success/20 bg-success/10 text-success' },
		archive: { icon: 'fa-file-zipper', tone: 'border-warning/20 bg-warning/10 text-warning' },
		media: { icon: 'fa-circle-play', tone: 'border-error/20 bg-error/10 text-error' },
		other: { icon: 'fa-file', tone: 'border-border bg-header text-text-secondary' },
	};
</script>
<template>
	<section
		class="h-full min-h-0 space-y-4 overflow-y-auto bg-background px-4 py-3 sm:px-5"
		:aria-label="t('agent.artifactManagement.title')"
	>
		<header class="flex flex-wrap items-center gap-3 border-b border-border/70 pb-3">
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-[11px] text-text-secondary"
			>
				<i class="fa-regular fa-folder-open" aria-hidden="true"></i>
			</div>
			<div class="min-w-0">
				<h3 class="text-sm font-semibold tracking-tight text-foreground">
					{{ t('agent.hub.files') }}
				</h3>
				<p class="mt-0.5 max-w-xl text-[11px] leading-4 text-text-secondary">
					{{ t('agent.files.libraryHint') }}
				</p>
			</div>
		</header>
		<p v-if="operation.notice.value" role="status">
			{{ t('agent.settings.appManagement.' + operation.notice.value) }}
		</p>
		<p v-if="needsReload || operation.refreshRequired.value" class="text-sm text-warning">
			{{ t('agent.settings.appManagement.refreshRequired') }}
		</p>
		<div class="flex flex-wrap gap-2">
			<UiButton
				v-if="needsReload || operation.refreshRequired.value || operation.notice.value === 'failed'"
				type="button"
				:disabled="operation.busy.value"
				@click="load()"
				>{{ t('agent.artifactManagement.reload') }}</UiButton
			>
			<UiButton
				v-if="
					statsRequired ||
					storageOperation.refreshRequired.value ||
					storageOperation.notice.value === 'failed'
				"
				type="button"
				:disabled="storageOperation.busy.value"
				@click="loadStorage"
				>{{ t('agent.artifactManagement.readStorage') }}</UiButton
			>
			<UiButton
				v-if="appOperation.refreshRequired.value || appOperation.notice.value === 'failed'"
				type="button"
				:disabled="appOperation.busy.value"
				@click="loadApps"
				>{{ t('agent.settings.appManagement.readApps') }}</UiButton
			>
		</div>
		<p v-if="appOperation.notice.value" role="alert">
			{{ t('agent.settings.appManagement.' + appOperation.notice.value) }}
		</p>
		<p v-if="storageOperation.notice.value" role="alert">
			{{ t('agent.settings.appManagement.' + storageOperation.notice.value) }}
		</p>
		<p v-if="statsRequired" class="text-sm text-text-secondary">{{ t('agent.artifactManagement.storageStale') }}</p>
		<div v-if="storage" class="mt-3 border-y border-border/60 bg-card/30 px-3 py-2.5">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div class="min-w-44 flex-1">
					<div class="flex items-center justify-between gap-3">
						<span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
							{{ t('agent.files.storageOverview') }}
						</span>
						<span class="text-[11px] font-medium text-foreground">
							{{ bytes(storage.totalBytes) }} / {{ bytes(storage.limitBytes) }}
						</span>
					</div>
					<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-header">
						<div
							class="h-full rounded-full bg-primary transition-[width] duration-300"
							:style="{ width: `${storageUsagePercent}%` }"
						></div>
					</div>
					<div class="mt-1.5 text-[11px] text-text-secondary">
						{{ t('agent.files.storageUsedPercent', { percent: storageUsagePercent }) }}
					</div>
				</div>

				<div class="grid min-w-full grid-cols-3 gap-2 sm:min-w-[360px] sm:flex-1">
					<div class="border-l border-border/60 px-3 py-1.5">
						<div class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
							{{ t('agent.files.protected') }}
						</div>
						<div class="mt-1 text-[11px] font-semibold text-foreground">
							{{ bytes(storage.protectedBytes) }}
						</div>
					</div>
					<div class="border-l border-border/60 px-3 py-1.5">
						<div class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
							{{ t('agent.files.reclaimable') }}
						</div>
						<div class="mt-1 text-[11px] font-semibold text-foreground">
							{{ bytes(storage.reclaimableBytes) }}
						</div>
					</div>
					<div class="border-l border-border/60 px-3 py-1.5">
						<div class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">
							{{ t('agent.files.available') }}
						</div>
						<div class="mt-1 text-[11px] font-semibold text-foreground">
							{{ bytes(availableBytes) }}
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="mt-3 flex items-center gap-2 border-t border-border/55 pt-2">
			<div
				class="group flex h-10 min-w-0 flex-1 items-center rounded-xl border border-border/65 bg-gradient-to-b from-card/80 to-background px-1.5 shadow-xs transition-[border-color,box-shadow] hover:border-border-hover focus-within:border-primary/30 focus-within:shadow-xs focus-within:ring-2 focus-within:ring-primary/15"
			>
				<span
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-header/45 text-text-secondary/80 transition-colors group-focus-within:bg-primary/8 group-focus-within:text-primary"
				>
					<i class="fa-solid fa-magnifying-glass text-[9px]" aria-hidden="true"></i>
				</span>
				<input
					v-model="filters.query"
					:aria-label="t('agent.artifactManagement.search')"
					:disabled="operation.busy.value"
					type="search"
					data-no-highlight
					class="h-full min-w-[8rem] flex-1 bg-transparent px-2.5 text-[11px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-text-secondary/45"
					:placeholder="t('agent.files.search')"
					@keydown.enter.prevent="load()"
				/>

				<div class="flex shrink-0 items-center gap-0.5 rounded-lg bg-background/35 p-0.5">
					<div class="w-[4.75rem]">
						<UiSelect
							:model-value="filters.kind"
							:aria-label="t('agent.artifactManagement.kind')"
							:disabled="operation.busy.value"
							:options="fileKindOptions"
							density="compact"
							:trigger-class="
								[
									'!h-8 !rounded-lg !border-0 !px-2.5 !shadow-none !ring-0 transition-colors',
									filters.kind === ''
										? '!bg-transparent !text-text-secondary hover:!bg-header/55 focus:!bg-header/55'
										: '!bg-header/70 !font-medium !text-foreground hover:!bg-header focus:!bg-header',
								].join(' ')
							"
							@update:model-value="selectKind"
						/>
					</div>
					<div class="w-[4.75rem]">
						<UiSelect
							:model-value="filters.appId"
							:aria-label="t('agent.artifactManagement.app')"
							:disabled="operation.busy.value"
							:options="appOptions"
							density="compact"
							:trigger-class="
								[
									'!h-8 !rounded-lg !border-0 !px-2.5 !shadow-none !ring-0 transition-colors',
									filters.appId === ''
										? '!bg-transparent !text-text-secondary hover:!bg-header/55 focus:!bg-header/55'
										: '!bg-header/70 !font-medium !text-foreground hover:!bg-header focus:!bg-header',
								].join(' ')
							"
							@update:model-value="selectApp"
						/>
					</div>
					<div class="w-[4.75rem]">
						<UiSelect
							:model-value="filters.retention"
							:aria-label="t('agent.artifactManagement.retention')"
							:disabled="operation.busy.value"
							:options="retentionOptions"
							density="compact"
							:trigger-class="
								[
									'!h-8 !rounded-lg !border-0 !px-2.5 !shadow-none !ring-0 transition-colors',
									filters.retention === 'all'
										? '!bg-transparent !text-text-secondary hover:!bg-header/55 focus:!bg-header/55'
										: '!bg-header/70 !font-medium !text-foreground hover:!bg-header focus:!bg-header',
								].join(' ')
							"
							@update:model-value="selectRetention"
						/>
					</div>
					<button
						type="button"
						class="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.055] text-text-secondary transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
						:disabled="operation.busy.value"
						:title="t('agent.files.searchAction')"
						@click="load()"
					>
						<i class="fa-solid fa-arrow-right text-[8px]" aria-hidden="true"></i>
					</button>
				</div>
			</div>

			<button
				v-if="hasFilters"
				type="button"
				class="flex h-8 shrink-0 items-center gap-1.5 px-1 text-[11px] font-medium text-text-secondary transition-colors hover:text-foreground disabled:opacity-50"
				:disabled="operation.busy.value"
				@click="resetFilters"
			>
				<i class="fa-solid fa-rotate-left text-[8px]" aria-hidden="true"></i>
				<span class="hidden sm:inline">{{ t('agent.files.resetFilters') }}</span>
			</button>
		</div>

		<div
			v-if="items.length"
			class="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] gap-3 border-b border-border px-2 py-2 text-[11px] font-semibold text-text-secondary sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5rem_5.5rem]"
		>
			<span>{{ t('agent.files.columns.name') }}</span
			><span class="hidden sm:block">{{ t('agent.files.columns.source') }}</span
			><span class="hidden sm:block">{{ t('agent.files.columns.size') }}</span
			><span>{{ t('agent.files.columns.status') }}</span
			><span>{{ t('agent.files.columns.actions') }}</span>
		</div>
		<div
			v-if="items.length === 0 && !operation.busy.value && !needsReload"
			class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center"
		>
			<div class="relative">
				<div class="absolute -inset-5 rounded-full bg-primary/8 blur-xl"></div>
				<div
					class="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-lg text-text-secondary shadow-sm"
				>
					<i
						:class="hasFilters ? 'fa-solid fa-filter-circle-xmark' : 'fa-regular fa-folder-open'"
						aria-hidden="true"
					></i>
				</div>
			</div>
			<p class="mt-4 text-xs font-semibold text-foreground">{{ t('agent.files.emptyTitle') }}</p>
			<p class="mt-1 max-w-xs text-[11px] leading-4 text-text-secondary">{{ t('agent.files.empty') }}</p>
			<button
				v-if="hasFilters"
				type="button"
				class="mt-3 rounded-xl border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-header"
				@click="resetFilters"
			>
				{{ t('agent.files.resetFilters') }}
			</button>
		</div>

		<article v-for="item in items" :key="item.id" class="border-b border-border/55 px-2 py-2 hover:bg-header/45">
			<div
				class="grid min-h-[58px] grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5rem_5.5rem]"
			>
				<div class="flex min-w-0 items-center gap-2.5">
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-[11px]"
						:class="kindPresentation[item.kind].tone"
					>
						<i class="fa-solid" :class="kindPresentation[item.kind].icon" aria-hidden="true"></i>
					</div>
					<div class="min-w-0">
						<div class="flex min-w-0 items-center gap-1.5">
							<h4 class="min-w-0 truncate text-[11px] font-semibold text-foreground" :title="item.name">
								{{ item.name }}
							</h4>
							<span
								v-if="extensionOf(item.name)"
								class="shrink-0 rounded bg-header px-1 py-0.5 text-[11px] font-semibold tracking-wide text-text-secondary"
							>
								{{ extensionOf(item.name) }}
							</span>
							<i
								v-if="item.retained"
								class="fa-solid fa-bookmark shrink-0 text-[8px] text-primary"
								:title="t('agent.files.retained')"
								aria-hidden="true"
							></i>
						</div>
						<div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary">
							<span class="max-w-44 truncate" :title="item.mediaType">{{ item.mediaType }}</span>
							<span aria-hidden="true">·</span>
							<span class="shrink-0">{{ time(item.createdAt) }}</span>
						</div>
					</div>
				</div>

				<span class="hidden truncate text-[11px] text-text-secondary sm:block">{{
					apps.find((app) => app.id === item.appId)?.name ?? '—'
				}}</span>
				<span class="hidden text-[11px] tabular-nums text-text-secondary sm:block">{{
					bytes(item.sizeBytes)
				}}</span>
				<span
					class="inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium"
					:class="statusTone(item.status)"
					>{{ t('agent.artifactManagement.status.' + item.status) }}</span
				>
				<div class="flex items-center justify-end gap-0.5">
					<button
						type="button"
						class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
						:disabled="blocked || item.status !== 'ready'"
						:aria-label="
							t(
								item.retained
									? 'agent.artifactManagement.releaseRetention'
									: 'agent.artifactManagement.retain',
							)
						"
						:title="
							t(
								item.retained
									? 'agent.artifactManagement.releaseRetention'
									: 'agent.artifactManagement.retain',
							)
						"
						@click="retain(item)"
					>
						<i
							:class="item.retained ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'"
							aria-hidden="true"
						></i>
					</button>
					<button
						type="button"
						class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-error/10 hover:text-error disabled:opacity-50"
						:disabled="blocked || item.retained || item.status === 'deleted'"
						:aria-label="t('common.delete')"
						:title="t('common.delete')"
						@click="deleteTarget = item"
					>
						<i class="fa-regular fa-trash-can text-[9px]" aria-hidden="true"></i>
					</button>
					<button
						type="button"
						class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary hover:bg-primary/10 hover:text-primary disabled:opacity-50"
						:disabled="blocked || item.status !== 'ready'"
						:aria-label="t('agent.artifactManagement.download')"
						:title="t('agent.artifactManagement.download')"
						@click="download(item)"
					>
						<i class="fa-solid fa-arrow-down-to-line text-[9px]" aria-hidden="true"></i>
					</button>
				</div>
			</div>
			<details class="text-xs">
				<summary class="cursor-pointer py-1 text-text-secondary">
					{{ t('agent.artifactManagement.attachments') }}
				</summary>
				<ArtifactAttachmentEditor
					:key="item.id"
					:artifact="item"
					:apps="apps"
					:disabled="blocked"
					@changed="load()"
				/>
			</details>
		</article>
		<div class="flex flex-wrap gap-2">
			<UiButton
				type="button"
				:disabled="operation.busy.value || offset === 0"
				@click="load(Math.max(0, offset - 20))"
				>{{ t('agent.settings.memoryManagement.previous') }}</UiButton
			>
			<UiButton
				type="button"
				:disabled="operation.busy.value || nextOffset === null"
				@click="nextOffset !== null && load(nextOffset)"
				>{{ t('agent.settings.memoryManagement.next') }}</UiButton
			>
		</div>
		<div v-if="deleteTarget" class="space-y-2 rounded border border-warning p-3">
			<p class="break-all">
				{{
					t('agent.files.deletePreview', {
						name: deleteTarget.name,
						bytes: bytes(deleteTarget.sizeBytes),
					})
				}}
			</p>
			<UiButton type="button" :disabled="blocked" @click="remove">{{ t('common.delete') }}</UiButton>
			<UiButton type="button" :disabled="operation.busy.value" @click="deleteTarget = null">{{
				t('common.cancel')
			}}</UiButton>
		</div>
		<form class="space-y-3 rounded border border-border p-3" @submit.prevent="upload">
			<h4>{{ t('agent.artifactManagement.upload') }}</h4>
			<p class="text-sm text-text-secondary">{{ t('agent.artifactManagement.uploadHelp') }}</p>
			<fieldset :disabled="blocked || uploadUnknown || !filters.appId" class="space-y-2">
				<input type="file" :aria-label="t('agent.artifactManagement.upload')" @change="chooseFile" />
				<p v-if="uploadFile" class="break-all text-xs">{{ uploadFile.name }} · {{ uploadFile.size }} B</p>
				<UiButton type="submit" :disabled="!uploadFile">{{ t('agent.artifactManagement.upload') }}</UiButton>
			</fieldset>
			<p v-if="uploadRecord" class="break-all text-xs">
				{{ uploadRecord.name }} ·
				{{ t('agent.artifactManagement.status.' + uploadRecord.status) }}
			</p>
			<UiButton
				v-if="uploadRecord && (uploadUnknown || uploadRecord.status === 'staging')"
				type="button"
				:disabled="operation.busy.value"
				@click="checkUpload"
				>{{ t('agent.artifactManagement.checkUpload') }}</UiButton
			>
			<template v-if="uploadUnknown">
				<p class="text-sm text-warning">{{ t('agent.artifactManagement.uploadUnknown') }}</p>
				<UiCheckbox v-model="uploadAcknowledged">{{
					t('agent.artifactManagement.acknowledgeUpload')
				}}</UiCheckbox>
				<UiButton type="button" :disabled="blocked || !uploadAcknowledged" @click="newUploadIntent">{{
					t('agent.artifactManagement.newUpload')
				}}</UiButton>
			</template>
		</form>
		<div class="space-y-3 rounded border border-border p-3">
			<h4>{{ t('agent.artifactManagement.cleanup') }}</h4>
			<p class="text-sm text-text-secondary">{{ t('agent.artifactManagement.cleanupHelp') }}</p>
			<UiButton
				type="button"
				:disabled="blocked || !filters.appId || cleanupUnknown || cleanupPlan !== null"
				@click="prepareCleanup"
				>{{ t('agent.artifactManagement.prepareCleanup') }}</UiButton
			>
			<template v-if="cleanupPlan">
				<p>
					{{
						t('agent.artifactManagement.plan', {
							count: cleanupPlan.selectedCount,
							bytes: cleanupPlan.selectedBytes,
							protected: cleanupPlan.protectedCount,
							expires: time(cleanupPlan.expiresAt),
						})
					}}
				</p>
				<p v-for="group in cleanupPlan.byApp" :key="group.appId" class="break-all text-xs">
					{{ apps.find((app) => app.id === group.appId)?.name ?? '—' }} · {{ group.count }} ·
					{{ bytes(group.bytes) }}
				</p>
				<UiButton type="button" :disabled="blocked || cleanupUnknown" @click="confirmCleanup">{{
					t('agent.artifactManagement.confirmCleanup')
				}}</UiButton>
				<UiButton type="button" :disabled="operation.busy.value || cleanupUnknown" @click="discardCleanup">{{
					t('common.cancel')
				}}</UiButton>
			</template>
			<p v-if="cleanupUnknown" class="text-sm text-warning">{{ t('agent.artifactManagement.cleanupUnknown') }}</p>
			<p v-if="cleanupResult">
				{{
					t('agent.artifactManagement.result', {
						count: cleanupResult.deletedCount,
						bytes: cleanupResult.deletedBytes,
						skipped: cleanupResult.skippedCount,
						failed: cleanupResult.failedCount,
						partial: cleanupResult.partial,
					})
				}}
			</p>
		</div>
	</section>
</template>
