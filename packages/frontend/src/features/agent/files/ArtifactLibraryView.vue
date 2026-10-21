<script setup lang="ts">
	import { computed, ref } from 'vue';
	import { useI18n } from 'vue-i18n';
	import { RecycleScroller } from 'vue-virtual-scroller';
	import { UiSelect, type UiSelectOption } from '@/foundation/ui';
	import { AGENT_ARTIFACT_CONTENT_TYPES } from '@nexus-terminal/shared/agent/artifacts/values';
	import { useArtifactLibrary } from '../composables/use-artifact-library';
	import { formatAgentDateTime } from '../locale-format';
	import type { ManagedArtifact } from '../model/artifact-types';

	const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true });
	const { t, locale } = useI18n();
	const {
		apps,
		filters,
		items,
		storage,
		statsRequired,
		nextOffset,
		deleteTarget,
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
		download,
		prepareCleanup,
		confirmCleanup,
		discardCleanup,
	} = useArtifactLibrary(() => props.active);

	const deleteNotice = ref('');
	const cleanupNotice = ref('');
	const actionError = ref('');
	const busy = computed(() => operation.busy.value);
	const appNames = computed(() => new Map(apps.value.map((app) => [app.id, app.name])));

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
		() =>
			actionError.value ||
			(cleanupUnknown.value ? '' : errorNotice.value) ||
			storageNotice.value ||
			appNotice.value,
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

	function clearCleanupPreview(): void {
		if (cleanupPlan.value && !cleanupUnknown.value) discardCleanup();
	}

	function selectApp(value: unknown): void {
		if (typeof value !== 'string' || (value !== '' && !apps.value.some((app) => app.id === value))) return;
		clearCleanupPreview();
		filters.value.appId = value;
		void load();
	}

	function selectKind(value: unknown): void {
		const kind = value === '' ? '' : AGENT_ARTIFACT_CONTENT_TYPES.find((item) => item === value);
		if (kind === undefined) return;
		clearCleanupPreview();
		filters.value.kind = kind;
		void load();
	}

	function selectRetention(value: unknown): void {
		if (value !== 'all' && value !== 'retained' && value !== 'unretained') return;
		clearCleanupPreview();
		filters.value.retention = value;
		void load();
	}

	function resetFilters(): void {
		clearCleanupPreview();
		filters.value = { appId: '', kind: '', retention: 'all', query: '' };
		void load();
	}

	async function reloadAfterMutation(): Promise<void> {
		await Promise.all([load(), loadStorage()]);
	}

	async function retryReads(): Promise<void> {
		actionError.value = '';
		await load();
		if (statsRequired.value) await loadStorage();
		if (appOperation.refreshRequired.value) await loadApps();
	}

	async function toggleRetain(item: ManagedArtifact): Promise<void> {
		if (blocked.value) return;
		actionError.value = '';
		await retain(item);
		if (operation.notice.value === 'saved') await reloadAfterMutation();
		else actionError.value = errorNotice.value;
	}

	function requestDelete(item: ManagedArtifact): void {
		if (blocked.value) return;
		deleteNotice.value = '';
		actionError.value = '';
		deleteTarget.value = item;
	}

	async function confirmDelete(): Promise<void> {
		const target = deleteTarget.value;
		if (!target || blocked.value) return;
		actionError.value = '';
		await remove();
		if (deleteTarget.value === null) {
			deleteNotice.value = t('agent.files.deleteDone', { name: target.name });
			await reloadAfterMutation();
			return;
		}
		if (operation.notice.value !== 'unknown') {
			actionError.value = errorNotice.value;
			deleteTarget.value = null;
			await load();
		}
	}

	async function previewCleanup(): Promise<void> {
		if (blocked.value || !filters.value.appId || cleanupUnknown.value) return;
		actionError.value = '';
		cleanupNotice.value = '';
		await prepareCleanup();
		if (cleanupPlan.value === null && operation.notice.value !== 'saved') actionError.value = errorNotice.value;
	}

	async function finishCleanup(): Promise<void> {
		if (!cleanupPlan.value || blocked.value || cleanupUnknown.value) return;
		actionError.value = '';
		await confirmCleanup();
		if (cleanupPlan.value === null && cleanupResult.value !== null) {
			cleanupNotice.value = t('agent.files.cleanupDone', { count: cleanupResult.value.deletedCount });
			await reloadAfterMutation();
		} else if (!cleanupUnknown.value) {
			actionError.value = errorNotice.value;
		}
	}

	function loadMore(): void {
		if (nextOffset.value !== null) void load(nextOffset.value);
	}
</script>
<template>
	<section class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
		<header class="shrink-0 border-b border-border/70 bg-background px-4 py-3 sm:px-5">
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div class="flex min-w-0 items-center gap-3">
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-[11px] text-text-secondary"
					>
						<i class="fa-regular fa-folder-open" aria-hidden="true"></i>
					</div>
					<div class="min-w-0">
						<h2 class="text-sm font-semibold tracking-tight text-foreground">{{ t('agent.hub.files') }}</h2>
						<p class="mt-0.5 max-w-xl text-[11px] leading-4 text-text-secondary">
							{{ t('agent.files.libraryHint') }}
						</p>
					</div>
				</div>

				<div class="flex flex-wrap items-center justify-end gap-2">
					<span
						v-if="deleteNotice"
						class="rounded-xl bg-success/10 px-2.5 py-1.5 text-[11px] font-medium text-success"
					>
						<i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>
						{{ deleteNotice }}
					</span>

					<span
						v-if="cleanupNotice"
						class="rounded-xl bg-success/10 px-2.5 py-1.5 text-[11px] font-medium text-success"
					>
						<i class="fa-solid fa-circle-check mr-1" aria-hidden="true"></i>
						{{ cleanupNotice }}
					</span>

					<div
						v-if="deleteTarget"
						class="flex flex-wrap items-center gap-2 rounded-xl border border-error/30 bg-error/6 px-3 py-1.5 text-[11px] shadow-2xs"
					>
						<i class="fa-solid fa-trash-can text-error" aria-hidden="true"></i>
						<span class="font-medium text-foreground">
							{{
								t('agent.files.deletePreview', {
									name: deleteTarget.name,
									bytes: bytes(deleteTarget.sizeBytes),
								})
							}}
						</span>
						<div class="flex items-center gap-1 border-l border-error/20 pl-2">
							<button
								type="button"
								class="rounded-lg px-2 py-1 text-text-secondary transition-colors hover:bg-header hover:text-foreground disabled:opacity-50"
								:disabled="busy"
								@click="deleteTarget = null"
							>
								{{ t('common.cancel') }}
							</button>
							<button
								type="button"
								class="rounded-lg bg-error px-2.5 py-1 font-semibold text-white transition-colors hover:bg-error/90 disabled:opacity-50"
								:disabled="blocked"
								@click="confirmDelete"
							>
								{{ t('agent.files.deleteConfirm') }}
							</button>
						</div>
					</div>

					<button
						v-if="!cleanupPlan"
						type="button"
						class="flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-card px-3 text-[11px] font-medium text-text-secondary transition-colors hover:border-border-hover hover:bg-header hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
						:disabled="blocked || !filters.appId || cleanupUnknown"
						:title="filters.appId ? t('agent.files.cleanup') : t('agent.files.cleanupSelectApp')"
						@click="previewCleanup"
					>
						<i class="fa-solid fa-broom text-[9px]" aria-hidden="true"></i>
						{{ t('agent.files.cleanup') }}
					</button>

					<div
						v-else
						class="flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/8 px-3 py-1.5 text-[11px] shadow-2xs"
					>
						<i class="fa-solid fa-triangle-exclamation text-warning" aria-hidden="true"></i>
						<span class="font-medium text-foreground">
							{{
								t('agent.files.cleanupPreview', {
									count: cleanupPlan.selectedCount,
									bytes: bytes(cleanupPlan.selectedBytes),
									protected: cleanupPlan.protectedCount,
								})
							}}
						</span>
						<div class="flex items-center gap-1 border-l border-warning/25 pl-2">
							<button
								type="button"
								class="rounded-lg px-2 py-1 text-text-secondary transition-colors hover:bg-header hover:text-foreground disabled:opacity-50"
								:disabled="busy || cleanupUnknown"
								@click="discardCleanup"
							>
								{{ t('common.cancel') }}
							</button>
							<button
								type="button"
								class="rounded-lg bg-error px-2.5 py-1 font-semibold text-white transition-colors hover:bg-error/90 disabled:opacity-50"
								:disabled="blocked || cleanupUnknown"
								@click="finishCleanup"
							>
								{{ t('agent.files.cleanupConfirm') }}
							</button>
						</div>
					</div>
				</div>
			</div>

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
					class="group flex min-h-10 min-w-0 flex-1 flex-wrap items-center rounded-xl border border-border/65 bg-gradient-to-b from-card/80 to-background px-1.5 py-0.5 shadow-xs transition-[border-color,box-shadow] hover:border-border-hover focus-within:border-primary/30 focus-within:shadow-xs focus-within:ring-2 focus-within:ring-primary/15 sm:h-10 sm:flex-nowrap sm:py-0"
				>
					<span
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-header/45 text-text-secondary/80 transition-colors group-focus-within:bg-primary/8 group-focus-within:text-primary"
					>
						<i class="fa-solid fa-magnifying-glass text-[9px]" aria-hidden="true"></i>
					</span>
					<input
						v-model="filters.query"
						:aria-label="t('agent.files.search')"
						:disabled="busy"
						type="search"
						data-no-highlight
						class="h-9 min-w-0 flex-1 bg-transparent px-2.5 text-[11px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-text-secondary/45 sm:h-full sm:min-w-[8rem]"
						:placeholder="t('agent.files.search')"
						@keydown.enter.prevent="load()"
					/>

					<div
						class="order-last mt-1 flex w-full min-w-0 items-center gap-0.5 rounded-lg bg-background/35 p-0.5 sm:order-none sm:mt-0 sm:w-auto sm:shrink-0"
					>
						<div class="min-w-0 flex-1 sm:w-[4.75rem] sm:flex-none">
							<UiSelect
								:model-value="filters.kind"
								:aria-label="t('agent.files.filterLabels.type')"
								:options="fileKindOptions"
								:disabled="busy"
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
						<div class="min-w-0 flex-1 sm:w-[4.75rem] sm:flex-none">
							<UiSelect
								:model-value="filters.appId"
								:aria-label="t('agent.files.filterLabels.app')"
								:options="appOptions"
								:disabled="busy"
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
						<div class="min-w-0 flex-1 sm:w-[4.75rem] sm:flex-none">
							<UiSelect
								:model-value="filters.retention"
								:aria-label="t('agent.files.filterLabels.status')"
								:options="retentionOptions"
								:disabled="busy"
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
							:disabled="busy"
							:title="t('agent.files.searchAction')"
							:aria-label="t('agent.files.searchAction')"
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
					:disabled="busy"
					@click="resetFilters"
				>
					<i class="fa-solid fa-rotate-left text-[8px]" aria-hidden="true"></i>
					<span class="hidden sm:inline">{{ t('agent.files.resetFilters') }}</span>
				</button>
			</div>

			<div
				v-if="visibleError"
				class="mt-2 flex items-start gap-2 rounded-xl border border-error/20 bg-error/8 px-3 py-2 text-[11px] text-error"
				role="alert"
			>
				<i class="fa-solid fa-circle-exclamation mt-0.5" aria-hidden="true"></i>
				<span class="min-w-0 flex-1">{{ visibleError }}</span>
				<button
					type="button"
					class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-error/10 disabled:opacity-50"
					:disabled="busy"
					:aria-label="t('agent.operations.retry')"
					:title="t('agent.operations.retry')"
					@click="retryReads"
				>
					<i class="fa-solid fa-rotate-right text-[9px]" aria-hidden="true"></i>
				</button>
			</div>

			<p v-if="cleanupUnknown" class="mt-2 flex items-center gap-2 text-[11px] leading-4 text-warning">
				<i class="fa-solid fa-triangle-exclamation mr-1.5" aria-hidden="true"></i>
				<span class="min-w-0 flex-1">{{ t('agent.artifactManagement.cleanupUnknown') }}</span>
				<button
					type="button"
					class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-warning transition-colors hover:bg-warning/10 disabled:opacity-50"
					:disabled="busy"
					:aria-label="t('agent.operations.retry')"
					:title="t('agent.operations.retry')"
					@click="retryReads"
				>
					<i class="fa-solid fa-rotate-right text-[9px]" aria-hidden="true"></i>
				</button>
			</p>
			<p
				v-if="cleanupResult && (cleanupResult.partial || cleanupResult.failedCount > 0)"
				class="mt-2 text-[11px] leading-4 text-warning"
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
			</p>
		</header>

		<div v-if="items.length > 0" class="shrink-0 border-b border-border/60 bg-card/30 px-4">
			<div
				class="grid h-9 grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5rem_5.5rem]"
			>
				<span>{{ t('agent.files.columns.name') }}</span>
				<span class="hidden sm:block">{{ t('agent.files.columns.source') }}</span>
				<span class="hidden sm:block">{{ t('agent.files.columns.size') }}</span>
				<span>{{ t('agent.files.columns.status') }}</span>
				<span class="text-right">{{ t('agent.files.columns.actions') }}</span>
			</div>
		</div>

		<div
			v-if="items.length === 0 && !busy"
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

		<RecycleScroller
			v-else
			class="min-h-0 flex-1 overflow-y-auto px-4"
			:items="items"
			:item-size="58"
			key-field="id"
		>
			<template #default="{ item }">
				<article
					class="group grid h-[58px] grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 border-b border-border/55 px-2 transition-colors hover:bg-header/45 sm:grid-cols-[minmax(0,1fr)_7rem_5rem_5rem_5.5rem]"
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
								<span
									class="min-w-0 truncate text-[11px] font-semibold text-foreground"
									:title="item.name"
								>
									{{ item.name }}
								</span>
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
								<span class="shrink-0">{{ formatCreatedAt(item.createdAt) }}</span>
							</div>
						</div>
					</div>

					<div
						class="hidden min-w-0 truncate text-[11px] text-text-secondary sm:block"
						:title="appName(item)"
					>
						{{ appName(item) }}
					</div>
					<div class="hidden text-[11px] tabular-nums text-text-secondary sm:block">
						{{ bytes(item.sizeBytes) }}
					</div>
					<div>
						<span
							class="inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium"
							:class="statusTone(item.status)"
						>
							{{ t(`agent.files.status.${item.status}`) }}
						</span>
					</div>
					<div class="flex items-center justify-end gap-0.5">
						<button
							type="button"
							class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
							:disabled="blocked || item.status !== 'ready'"
							:aria-label="item.retained ? t('agent.files.unretain') : t('agent.files.retain')"
							:title="item.retained ? t('agent.files.unretain') : t('agent.files.retain')"
							@click="toggleRetain(item)"
						>
							<i
								:class="item.retained ? 'fa-solid fa-bookmark' : 'fa-regular fa-bookmark'"
								aria-hidden="true"
							></i>
						</button>
						<button
							type="button"
							class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-error/10 hover:text-error disabled:opacity-50"
							:disabled="blocked || item.retained || item.status === 'deleted'"
							:aria-label="t('agent.files.delete')"
							:title="t('agent.files.delete')"
							@click="requestDelete(item)"
						>
							<i class="fa-regular fa-trash-can text-[9px]" aria-hidden="true"></i>
						</button>
						<button
							type="button"
							class="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-header hover:text-foreground disabled:opacity-50"
							:disabled="blocked || item.status !== 'ready'"
							:aria-label="t('agent.files.download')"
							:title="t('agent.files.download')"
							@click="download(item)"
						>
							<i class="fa-solid fa-arrow-down-to-line text-[9px]" aria-hidden="true"></i>
						</button>
					</div>
				</article>
			</template>
		</RecycleScroller>

		<footer v-if="nextOffset !== null" class="shrink-0 border-t border-border/60 bg-card/35 p-2 text-center">
			<button
				type="button"
				class="rounded-xl px-4 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-header hover:text-foreground disabled:opacity-50"
				:disabled="busy"
				@click="loadMore"
			>
				<i class="fa-solid fa-chevron-down mr-1 text-[8px]" aria-hidden="true"></i>
				{{ t('agent.files.loadMore') }}
			</button>
		</footer>
	</section>
</template>
