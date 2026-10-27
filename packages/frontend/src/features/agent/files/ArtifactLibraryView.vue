<script setup lang="ts">
	import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { RecycleScroller } from 'vue-virtual-scroller';
	import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
	import {
		UiButton,
		UiEmptyState,
		UiLoadingState,
		UiInlineNotice,
		UiOverlayPanel,
		UiSearchInput,
		UiSelect,
		type UiSelectOption,
	} from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import {
		createFilePreviewSession,
		loadFilePreview,
		previewKindFor,
		type FilePreviewSource,
	} from '@/features/file-preview/public';
	import { AGENT_ARTIFACT_CONTENT_TYPES } from '@nexus-terminal/shared/agent/artifacts/values';
	import { useArtifactLibrary } from '../composables/use-artifact-library';
	import { formatAgentDateTime } from '../locale-format';
	import type { ManagedArtifact } from '../model/artifact-types';
	import { createArtifactPreviewSource } from './artifact-preview-source';

	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t, locale } = useI18n();
	const { confirm } = useFeedback();
	const {
		apps,
		filters,
		items,
		storage,
		statsRequired,
		nextOffset,
		deleteTarget,
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
		download,
		cleanup,
	} = useArtifactLibrary(() => props.active);

	const busy = computed(() => operation.busy.value);
	const appNames = computed(() => new Map(apps.value.map((app) => [app.id, app.name])));

	const FilePreview = defineAsyncComponent(loadFilePreview);
	const previewSession = createFilePreviewSession();
	const previewMounted = ref(false);
	const previewVisible = ref(false);
	// 兜底源：预览内 Markdown 相对链接按文件名继续打开同批产物。
	const previewSource: FilePreviewSource = {
		read(path, options) {
			const name = path.split('/').pop() ?? path;
			const item = items.value.find((candidate) => candidate.name === name && candidate.status === 'ready');
			if (!item) return Promise.reject(new Error(t('agent.files.previewLoadFailed')));
			return createArtifactPreviewSource(item, t('agent.files.previewLoadFailed')).read(path, options);
		},
	};

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

	function operationMessage(value: string): string {
		return value === '' || value === 'saved' ? '' : t('agent.settings.appManagement.' + value);
	}

	const errorNotice = computed(() => operationMessage(operation.notice.value));
	const storageNotice = computed(() => operationMessage(storageOperation.notice.value));
	const appNotice = computed(() => operationMessage(appOperation.notice.value));
	const visibleError = computed(
		() => (cleanupUnknown.value ? '' : errorNotice.value) || storageNotice.value || appNotice.value,
	);

	const bytes = (value: number): string => {
		if (value < 1024) return `${value} B`;
		if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
		if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
		return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
	};

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

	function statusTone(status: ManagedArtifact['status']): string {
		if (status === 'ready') return 'bg-success/10 text-success';
		if (status === 'staging') return 'bg-warning/10 text-warning';
		if (status === 'unavailable') return 'bg-error/10 text-error';
		return 'bg-header text-text-secondary';
	}

	function appName(item: ManagedArtifact): string {
		return appNames.value.get(item.appId) ?? t('agent.files.unknownApp');
	}

	function formatCreatedAt(value: number): string {
		return formatAgentDateTime(locale.value, new Date(value));
	}

	function previewable(item: ManagedArtifact): boolean {
		return item.status === 'ready' && previewKindFor(item.name) !== 'unsupported';
	}

	async function openPreview(item: ManagedArtifact): Promise<void> {
		if (blocked.value || !previewable(item)) return;
		previewMounted.value = true;
		previewVisible.value = true;
		await previewSession.open(item.name, {
			scopeId: item.id,
			scopeLabel: appName(item),
			source: createArtifactPreviewSource(item, t('agent.files.previewLoadFailed')),
		});
	}

	function closePreview(): void {
		previewVisible.value = false;
	}

	let cleanupConfirmation: AbortController | null = null;

	function cancelCleanupConfirmation(): void {
		cleanupConfirmation?.abort();
		cleanupConfirmation = null;
	}

	function selectApp(value: unknown): void {
		if (typeof value !== 'string' || (value !== '' && !apps.value.some((app) => app.id === value))) return;
		filters.value.appId = value;
		void load();
	}

	function selectKind(value: unknown): void {
		const kind = value === '' ? '' : AGENT_ARTIFACT_CONTENT_TYPES.find((item) => item === value);
		if (kind === undefined) return;
		filters.value.kind = kind;
		void load();
	}

	function selectRetention(value: unknown): void {
		if (value !== 'all' && value !== 'retained' && value !== 'unretained') return;
		filters.value.retention = value;
		void load();
	}

	function resetFilters(): void {
		filters.value = { appId: '', kind: '', retention: 'all', query: '' };
		void load();
	}

	async function reloadAfterMutation(): Promise<void> {
		await Promise.all([load(), loadStorage()]);
	}

	async function retryReads(): Promise<void> {
		await load();
		if (statsRequired.value) await loadStorage();
		if (appOperation.refreshRequired.value) await loadApps();
	}

	async function toggleRetain(item: ManagedArtifact): Promise<void> {
		if (blocked.value) return;
		await retain(item);
		if (operation.notice.value === 'saved') await reloadAfterMutation();
	}

	function requestDelete(item: ManagedArtifact): void {
		if (blocked.value) return;
		deleteTarget.value = item;
	}

	async function confirmDelete(): Promise<void> {
		const target = deleteTarget.value;
		if (!target || blocked.value) return;
		await remove();
		if (deleteTarget.value === null) {
			await reloadAfterMutation();
			return;
		}
		if (operation.notice.value !== 'unknown') {
			deleteTarget.value = null;
			await load();
		}
	}

	async function runCleanup(): Promise<void> {
		const appId = filters.value.appId;
		if (!appId || blocked.value || cleanupUnknown.value) return;
		cancelCleanupConfirmation();
		const controller = new AbortController();
		cleanupConfirmation = controller;
		const accepted = await confirm({
			signal: controller.signal,
			title: t('agent.files.cleanup'),
			message: t('agent.files.cleanupPrompt'),
			confirmText: t('agent.files.cleanupConfirm'),
			cancelText: t('common.cancel'),
			destructive: true,
			tone: 'warning',
		});
		if (cleanupConfirmation === controller) cleanupConfirmation = null;
		if (!accepted || blocked.value) return;
		await cleanup(appId);
		if (cleanupResult.value !== null) await reloadAfterMutation();
	}

	function loadMore(): void {
		if (nextOffset.value !== null) void load(nextOffset.value);
	}

	watch(
		() => props.active,
		(active) => {
			if (active) return;
			cancelCleanupConfirmation();
			closePreview();
		},
	);
	onBeforeUnmount(() => {
		cancelCleanupConfirmation();
		previewSession.clear();
	});
</script>
<template>
	<section
		class="agent-file-library flex h-full min-h-0 flex-col overflow-hidden bg-background"
		:aria-label="t('agent.files.libraryLabel')"
	>
		<header class="shrink-0 border-b border-border/35 bg-background px-4 pb-3 pt-2.5 sm:px-5">
			<div class="flex flex-wrap items-center justify-between gap-2.5">
				<div class="flex min-w-0 items-center gap-2.5">
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/8 text-[11px] text-primary"
					>
						<i class="fa-regular fa-folder-open" aria-hidden="true"></i>
					</span>
					<div class="min-w-0">
						<h2 class="text-[13px] font-semibold tracking-tight text-foreground">
							{{ t('agent.hub.files') }}
						</h2>
						<p class="agent-file-hint mt-0.5 max-w-xl truncate text-[10.5px] leading-4 text-text-secondary">
							{{ t('agent.files.libraryHint') }}
						</p>
					</div>
				</div>

				<div class="flex flex-wrap items-center justify-end gap-2">
					<UiInlineNotice v-if="deleteTarget" class="max-w-xl" tone="danger" compact>
						<span class="font-medium text-foreground">
							{{
								t('agent.files.deletePrompt', {
									name: deleteTarget.name,
									bytes: bytes(deleteTarget.sizeBytes),
								})
							}}
						</span>
						<template #actions>
							<UiButton
								density="compact"
								appearance="ghost"
								:disabled="busy"
								@click="deleteTarget = null"
							>
								{{ t('common.cancel') }}
							</UiButton>
							<UiButton
								density="compact"
								appearance="soft"
								tone="danger"
								:disabled="blocked"
								@click="confirmDelete"
							>
								{{ t('agent.files.deleteConfirm') }}
							</UiButton>
						</template>
					</UiInlineNotice>

					<UiButton
						class="agent-file-cleanup"
						density="compact"
						appearance="soft"
						:disabled="blocked || !filters.appId || cleanupUnknown"
						:title="filters.appId ? t('agent.files.cleanup') : t('agent.files.cleanupSelectApp')"
						@click="runCleanup"
					>
						<template #leading>
							<i class="fa-solid fa-broom text-[9px]" aria-hidden="true"></i>
						</template>
						<span class="agent-file-cleanup-label">{{ t('agent.files.cleanup') }}</span>
					</UiButton>
				</div>
			</div>

			<div
				v-if="storage"
				class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-header/20 px-3 py-2"
			>
				<div class="agent-file-storage-usage flex min-w-0 flex-1 items-center gap-2.5">
					<i
						class="fa-solid fa-database hidden text-[10px] text-text-secondary/65 sm:block"
						aria-hidden="true"
					></i>
					<span class="shrink-0 text-[10.5px] font-medium text-text-secondary">
						{{ t('agent.files.storageOverview') }}
					</span>
					<span class="shrink-0 text-[10.5px] tabular-nums text-foreground">
						{{ bytes(storage.totalBytes) }}
						<span class="text-text-secondary/60">/ {{ bytes(storage.limitBytes) }}</span>
					</span>
					<div class="h-1 min-w-16 max-w-36 flex-1 overflow-hidden rounded-full bg-header">
						<div
							class="h-full rounded-full bg-primary transition-[width] duration-300"
							:style="{ width: `${storageUsagePercent}%` }"
						></div>
					</div>
					<span class="w-7 shrink-0 text-right text-[10.5px] tabular-nums text-text-secondary">
						{{ storageUsagePercent }}%
					</span>
				</div>

				<div class="agent-file-storage-facts flex flex-wrap items-center gap-x-3 gap-y-1">
					<span class="agent-file-storage-fact">
						<span class="text-text-secondary/75">{{ t('agent.files.protected') }}</span>
						<strong class="font-semibold tabular-nums text-foreground">{{
							bytes(storage.protectedBytes)
						}}</strong>
					</span>
					<span class="agent-file-storage-fact">
						<span class="text-text-secondary/75">{{ t('agent.files.reclaimable') }}</span>
						<strong class="font-semibold tabular-nums text-foreground">{{
							bytes(storage.reclaimableBytes)
						}}</strong>
					</span>
					<span class="agent-file-storage-fact">
						<span class="text-text-secondary/75">{{ t('agent.files.available') }}</span>
						<strong class="font-semibold tabular-nums text-foreground">{{ bytes(availableBytes) }}</strong>
					</span>
				</div>
			</div>

			<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
				<div class="agent-file-search flex min-w-0 flex-[1_1_13rem] items-center gap-1">
					<UiSearchInput
						v-model="filters.query"
						density="compact"
						class="min-w-0 flex-1"
						:aria-label="t('agent.files.search')"
						:placeholder="t('agent.files.search')"
						:disabled="busy"
						:clear-label="t('common.clear')"
						@keydown.enter.prevent="load()"
					/>
					<UiButton
						density="compact"
						appearance="ghost"
						icon-only
						:disabled="busy"
						:title="t('agent.files.searchAction')"
						:aria-label="t('agent.files.searchAction')"
						@click="load()"
					>
						<i class="fa-solid fa-arrow-right text-[8px]" aria-hidden="true"></i>
					</UiButton>
				</div>

				<div class="agent-file-filters flex min-w-0 items-center gap-1">
					<UiSelect
						:model-value="filters.kind"
						:aria-label="t('agent.files.filterLabels.type')"
						:options="fileKindOptions"
						:disabled="busy"
						density="compact"
						class="agent-file-filter"
						@update:model-value="selectKind"
					/>
					<UiSelect
						:model-value="filters.appId"
						:aria-label="t('agent.files.filterLabels.app')"
						:options="appOptions"
						:disabled="busy"
						density="compact"
						class="agent-file-filter agent-file-filter--app"
						@update:model-value="selectApp"
					/>
					<UiSelect
						:model-value="filters.retention"
						:aria-label="t('agent.files.filterLabels.status')"
						:options="retentionOptions"
						:disabled="busy"
						density="compact"
						class="agent-file-filter"
						@update:model-value="selectRetention"
					/>
				</div>

				<UiButton
					v-if="hasFilters"
					class="agent-file-reset shrink-0"
					density="compact"
					appearance="ghost"
					:disabled="busy"
					@click="resetFilters"
				>
					<template #leading>
						<i class="fa-solid fa-rotate-left text-[8px]" aria-hidden="true"></i>
					</template>
					<span class="agent-file-reset-label">{{ t('agent.files.resetFilters') }}</span>
				</UiButton>
			</div>

			<div v-if="visibleError" class="mt-2 flex justify-end">
				<UiButton
					type="button"
					appearance="ghost"
					density="compact"
					icon-only
					:disabled="busy"
					:aria-label="t('agent.operations.retry')"
					:title="t('agent.operations.retry')"
					@click="retryReads"
				>
					<i class="fa-solid fa-rotate-right text-[9px]" aria-hidden="true"></i>
				</UiButton>
			</div>

			<UiInlineNotice v-if="cleanupUnknown" class="mt-2" tone="warning" compact>
				<span class="min-w-0 flex-1">{{ t('agent.artifactManagement.cleanupUnknown') }}</span>
				<template #actions>
					<UiButton
						type="button"
						appearance="ghost"
						tone="warning"
						density="compact"
						icon-only
						:disabled="busy"
						:aria-label="t('agent.operations.retry')"
						:title="t('agent.operations.retry')"
						@click="retryReads"
					>
						<i class="fa-solid fa-rotate-right text-[9px]" aria-hidden="true"></i>
					</UiButton>
				</template>
			</UiInlineNotice>
			<UiInlineNotice
				v-if="cleanupResult && (cleanupResult.partial || cleanupResult.failedCount > 0)"
				class="mt-2"
				tone="warning"
				compact
			>
				{{
					t('agent.artifactManagement.result', {
						count: cleanupResult.deletedCount,
						bytes: cleanupResult.deletedBytes,
						skipped: cleanupResult.skippedCount,
						failed: cleanupResult.failedCount,
						partial: cleanupResult.partial,
					})
				}}
			</UiInlineNotice>
		</header>

		<div
			class="agent-file-list-surface mx-4 mb-3 mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/40 bg-card/15 sm:mx-5 sm:mb-4"
		>
			<div
				v-if="items.length > 0"
				class="agent-file-columns shrink-0 border-b border-border/35 bg-header/10 px-3 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-text-secondary/75"
			>
				<span>{{ t('agent.files.columns.name') }}</span>
				<span class="agent-file-source">{{ t('agent.files.columns.source') }}</span>
				<span class="agent-file-size">{{ t('agent.files.columns.size') }}</span>
				<span class="agent-file-header-status">{{ t('agent.files.columns.status') }}</span>
				<span class="text-right">{{ t('agent.files.columns.actions') }}</span>
			</div>

			<div v-if="items.length === 0 && !busy" class="flex min-h-0 flex-1 items-center justify-center p-5">
				<UiEmptyState
					class="agent-file-empty w-full max-w-96"
					:icon="hasFilters ? 'fa-solid fa-filter-circle-xmark' : 'fa-regular fa-folder-open'"
					:title="hasFilters ? t('agent.files.emptyTitle') : t('agent.files.emptyLibraryTitle')"
					:description="hasFilters ? t('agent.files.empty') : t('agent.files.emptyLibrary')"
				>
					<template v-if="hasFilters" #action>
						<UiButton density="compact" appearance="soft" :disabled="busy" @click="resetFilters">
							{{ t('agent.files.resetFilters') }}
						</UiButton>
					</template>
				</UiEmptyState>
			</div>

			<UiLoadingState
				v-else-if="busy && items.length === 0"
				class="min-h-0 flex-1"
				compact
				:bordered="false"
				:title="t('agent.files.loading')"
			/>

			<RecycleScroller
				v-else
				class="min-h-0 flex-1 overflow-y-auto"
				:items="items"
				:item-size="62"
				key-field="id"
			>
				<template #default="{ item }">
					<article
						class="agent-file-row group grid h-[62px] items-center border-b border-border/25 px-3 transition-colors hover:bg-header/35"
					>
						<div class="flex min-w-0 items-center gap-2.5">
							<div
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border text-[10px]"
								:class="kindPresentation[item.kind].tone"
							>
								<i class="fa-solid" :class="kindPresentation[item.kind].icon" aria-hidden="true"></i>
							</div>
							<div class="min-w-0">
								<div class="flex min-w-0 items-center gap-1.5">
									<span
										class="min-w-0 truncate text-[11px] font-semibold text-foreground"
										:title="item.name"
									>
										{{ item.name }}
									</span>
									<span
										v-if="extensionOf(item.name)"
										class="shrink-0 rounded bg-header/70 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-text-secondary"
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
								<div
									class="agent-file-meta mt-0.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-text-secondary/75"
								>
									<span class="agent-file-meta-source" :title="appName(item)">
										{{ appName(item) }}
									</span>
									<span class="agent-file-meta-type max-w-40 truncate" :title="item.mediaType">
										{{ item.mediaType }}
									</span>
									<span class="agent-file-meta-time shrink-0">{{
										formatCreatedAt(item.createdAt)
									}}</span>
									<span class="agent-file-meta-size shrink-0 tabular-nums">{{
										bytes(item.sizeBytes)
									}}</span>
									<span
										class="agent-file-meta-status shrink-0 rounded-md px-1 py-0.5 text-[9px] font-medium"
										:class="statusTone(item.status)"
									>
										{{ t(`agent.files.status.${item.status}`) }}
									</span>
								</div>
							</div>
						</div>

						<div class="agent-file-source min-w-0 text-[10.5px] text-text-secondary" :title="appName(item)">
							{{ appName(item) }}
						</div>
						<div class="agent-file-size text-[10.5px] tabular-nums text-text-secondary">
							{{ bytes(item.sizeBytes) }}
						</div>
						<div class="agent-file-status">
							<span
								class="inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium"
								:class="statusTone(item.status)"
							>
								{{ t(`agent.files.status.${item.status}`) }}
							</span>
						</div>
						<div class="flex items-center justify-end gap-0.5">
							<UiButton
								v-if="previewable(item)"
								class="agent-file-action"
								density="compact"
								appearance="ghost"
								icon-only
								:disabled="blocked"
								:aria-label="t('agent.files.preview')"
								:title="t('agent.files.preview')"
								@click="openPreview(item)"
							>
								<i class="fa-regular fa-eye text-[9px]" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								class="agent-file-action agent-file-action--primary"
								density="compact"
								appearance="ghost"
								icon-only
								:disabled="blocked || item.status !== 'ready'"
								:aria-label="item.retained ? t('agent.files.unretain') : t('agent.files.retain')"
								:title="item.retained ? t('agent.files.unretain') : t('agent.files.retain')"
								@click="toggleRetain(item)"
							>
								<i
									:class="item.retained ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'"
									aria-hidden="true"
								></i>
							</UiButton>
							<UiButton
								class="agent-file-action agent-file-action--danger"
								density="compact"
								appearance="ghost"
								icon-only
								:disabled="blocked || item.retained || item.status === 'deleted'"
								:aria-label="t('agent.files.delete')"
								:title="t('agent.files.delete')"
								@click="requestDelete(item)"
							>
								<i class="fa-regular fa-trash-can text-[9px]" aria-hidden="true"></i>
							</UiButton>
							<UiButton
								class="agent-file-action"
								density="compact"
								appearance="ghost"
								icon-only
								:disabled="blocked || item.status !== 'ready'"
								:aria-label="t('agent.files.download')"
								:title="t('agent.files.download')"
								@click="download(item)"
							>
								<i class="fa-solid fa-download text-[9px]" aria-hidden="true"></i>
							</UiButton>
						</div>
					</article>
				</template>
			</RecycleScroller>

			<footer v-if="nextOffset !== null" class="shrink-0 border-t border-border/35 bg-card/20 p-2 text-center">
				<UiButton density="compact" appearance="ghost" :disabled="busy" @click="loadMore">
					<template #leading>
						<i class="fa-solid fa-chevron-down text-[8px]" aria-hidden="true"></i>
					</template>
					{{ t('agent.files.loadMore') }}
				</UiButton>
			</footer>
		</div>

		<UiOverlayPanel
			:visible="previewVisible"
			:keep-mounted="true"
			teleport
			:z-index="60"
			:close-on-backdrop="true"
			:close-on-escape="true"
			:focus-on-open="true"
			:restore-focus="true"
			panel-class="flex h-[min(760px,90dvh)] w-full max-w-[1180px] min-h-0 flex-col overflow-hidden !p-0"
			overlay-class="p-2 sm:p-4"
			role="dialog"
			:aria-modal="true"
			:aria-label="t('agent.files.preview')"
			@close="closePreview"
		>
			<FilePreview
				v-if="previewMounted"
				class="min-h-0 flex-1"
				:source="previewSource"
				:session="previewSession"
				show-scope-label
				@hide="closePreview"
				@dismiss="closePreview"
			/>
		</UiOverlayPanel>
	</section>
</template>

<style scoped>
	.agent-file-storage-fact {
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
		font-size: 10px;
		white-space: nowrap;
	}

	.agent-file-storage-fact + .agent-file-storage-fact::before {
		content: '·';
		margin-inline-end: 7px;
		color: color-mix(in srgb, var(--text-color) 26%, transparent);
	}

	.agent-file-filters {
		flex: 0 0 auto;
	}

	.agent-file-filter {
		width: 5.5rem;
	}

	.agent-file-filter--app {
		width: 9.5rem;
	}

	.agent-file-columns,
	.agent-file-row {
		grid-template-columns: minmax(0, 1fr) minmax(8.5rem, 0.32fr) 68px 64px 118px;
		column-gap: 12px;
	}

	.agent-file-columns {
		display: grid;
		height: 30px;
		align-items: center;
	}

	.agent-file-row:last-child {
		border-bottom: 0;
	}

	.agent-file-source {
		display: -webkit-box;
		overflow: hidden;
		overflow-wrap: anywhere;
		line-height: 1.35;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
	}

	.agent-file-meta-source,
	.agent-file-meta-size {
		display: none;
	}

	.agent-file-meta-status {
		display: none;
	}

	.agent-file-action {
		color: var(--ui-text-muted);
	}

	.agent-file-action--primary:not(:disabled):hover {
		color: var(--link-active-color);
	}

	.agent-file-action--danger:not(:disabled):hover {
		color: var(--status-error-color);
	}

	.agent-file-empty {
		width: min(100%, 24rem);
		padding: 24px 20px;
	}

	@container agent-hub-window (max-width: 760px) {
		.agent-file-columns,
		.agent-file-row {
			grid-template-columns: minmax(0, 1fr) 58px 118px;
			column-gap: 8px;
		}

		.agent-file-source,
		.agent-file-size,
		.agent-file-meta-type {
			display: none;
		}

		.agent-file-meta {
			flex-wrap: wrap;
			column-gap: 0.4rem;
			row-gap: 0.05rem;
		}

		.agent-file-meta-source {
			display: block;
			flex: 1 0 100%;
			overflow: hidden;
			line-height: 1.3;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.agent-file-meta-size {
			display: inline;
		}

		.agent-file-filters {
			flex: 1 1 13rem;
		}

		.agent-file-filter {
			width: auto;
			min-width: 0;
			flex: 1 1 0;
		}

		.agent-file-reset {
			width: var(--ui-control-height);
			padding-inline: 0;
		}

		.agent-file-reset-label {
			display: none;
		}
	}

	@container agent-hub-window (max-width: 560px) {
		.agent-file-hint,
		.agent-file-cleanup-label {
			display: none;
		}

		.agent-file-cleanup {
			width: var(--ui-control-height);
			padding-inline: 0;
		}

		.agent-file-storage-usage {
			flex-basis: 100%;
		}

		.agent-file-storage-facts {
			padding-inline-start: 2px;
		}

		.agent-file-columns,
		.agent-file-row {
			grid-template-columns: minmax(0, 1fr) 118px;
		}

		.agent-file-status {
			display: none;
		}

		.agent-file-header-status {
			display: none;
		}

		.agent-file-meta-status {
			display: inline-flex;
		}
	}

	/* 行高固定 62px；窄容器里操作列占位更大，隐藏时间以免元信息折成三行裁掉“可用”徽标。 */
	@container agent-hub-window (max-width: 480px) {
		.agent-file-meta-time {
			display: none;
		}
	}
</style>
