<script setup lang="ts">
	import { computed, onActivated, onMounted, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
	import { useAuthSession } from '@/features/auth/public';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { formatDistanceToNow } from 'date-fns';
	import { enUS, ja, zhCN } from 'date-fns/locale';
	import {
		numberStorageCodec,
		readStoredValue,
		removeStoredValue,
		stringStorageCodec,
		writeStoredValue,
	} from '@/foundation/browser';
	import { UiActionGroup, UiButton, UiInput, UiSelect, UiSwitch } from '@/foundation/ui';
	import { useFeedback } from '@/shared/feedback/public';
	import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
	import { preloadWorkspaceTerminalSurface } from '@/runtimes/workspace/public';
	import { useConnectionManagement } from '../composables/use-connection-management';
	import ConnectionImportModal from '../components/ConnectionImportModal.vue';
	import ConnectionEditorModal from '../components/ConnectionEditorModal.vue';
	import BatchEditConnectionModal from '../components/BatchEditConnectionModal.vue';
	import HostKeyManagementModal from '../components/HostKeyManagementModal.vue';
	import type { ConnectionSummary } from '../model/connection-types';
	const { t, locale } = useI18n();
	const router = useRouter();
	const feedback = useFeedback();
	const {
		data,
		selected,
		batchModal,
		loading,
		message,
		testing,
		testResults,
		refresh,
		openBatch,
		clone,
		test,
		testAll,
		deleteSelected,
		batchSave,
		cancelBatch,
		appendTag,
		exportItems,
	} = useConnectionManagement();
	const importVisible = ref(false);
	const appendTagId = ref<number | null>(null);
	const capabilities = useRuntimeFeatureCapabilities();
	const tags = capabilities.tags;
	const search = ref('');
	type SortField = 'lastConnected' | 'name' | 'type' | 'updated' | 'created';
	type SortOrder = 'asc' | 'desc';

	function isSortField(value: unknown): value is SortField {
		return (
			value === 'lastConnected' ||
			value === 'name' ||
			value === 'type' ||
			value === 'updated' ||
			value === 'created'
		);
	}

	const sortStorage = {
		namespace: 'connections.sort',
		version: 1,
		codec: stringStorageCodec(isSortField),
	} as const;
	const orderStorage = {
		namespace: 'connections.sort-order',
		version: 1,
		codec: stringStorageCodec((value) => value === 'asc' || value === 'desc'),
	} as const;
	const tagStorage = {
		namespace: 'connections.tag',
		version: 1,
		codec: numberStorageCodec((value) => Number.isInteger(value) && value > 0),
	} as const;
	const storedSort = readStoredValue(sortStorage);
	const storedOrder = readStoredValue(orderStorage);
	const sort = ref<SortField>(isSortField(storedSort) ? storedSort : 'lastConnected');
	const sortOrder = ref<SortOrder>(storedOrder === 'asc' ? 'asc' : 'desc');
	const tagId = ref<number | ''>(readStoredValue(tagStorage) ?? '');
	const formVisible = ref(false);
	const editing = ref<ConnectionSummary | null>(null);
	const batch = ref(false);
	const hostKeysVisible = ref(false);
	const auth = useAuthSession();
	let loadGeneration = 0;

	const loadInitialData = async (): Promise<void> => {
		const current = ++loadGeneration;
		const [connectionsResult, tagsResult] = await Promise.allSettled([data.revalidate(), tags.revalidate()]);
		if (current !== loadGeneration) {
			return;
		}
		if (connectionsResult.status === 'rejected') {
			feedback.notifyError(t('connections.loadFailed'));
		}
		if (tagsResult.status === 'rejected') {
			feedback.notifyError(t('connections.tagLoadFailed'));
		}
	};

	onMounted(() => void loadInitialData());
	onActivated(() => void loadInitialData());

	function resetPanels(): void {
		loadGeneration++;
		formVisible.value = false;
		importVisible.value = false;
		hostKeysVisible.value = false;
		editing.value = null;
		appendTagId.value = null;
	}

	watch(() => (auth.isAuthenticated.value ? auth.user.value?.id : null), resetPanels, { flush: 'sync' });
	onDeactivated(resetPanels);
	onBeforeUnmount(resetPanels);
	const filtered = computed(() => {
		const q = search.value.toLowerCase().trim();
		const values = data.connections.value.filter((c) => {
			if (tagId.value !== '' && !c.tagIds.includes(tagId.value)) return false;
			return !q || `${c.name ?? ''} ${c.host} ${c.port} ${c.username} ${c.notes ?? ''}`.toLowerCase().includes(q);
		});
		const direction = sortOrder.value === 'asc' ? 1 : -1;
		return [...values].sort((a, b) => {
			if (sort.value === 'name') return (a.name ?? a.host).localeCompare(b.name ?? b.host) * direction;
			if (sort.value === 'type') return a.type.localeCompare(b.type) * direction;
			if (sort.value === 'updated') return (a.updatedAt - b.updatedAt) * direction;
			if (sort.value === 'created') return (a.createdAt - b.createdAt) * direction;
			const aTime = a.lastConnectedAt ?? (sortOrder.value === 'asc' ? Number.POSITIVE_INFINITY : -1);
			const bTime = b.lastConnectedAt ?? (sortOrder.value === 'asc' ? Number.POSITIVE_INFINITY : -1);
			return (aTime - bTime) * direction;
		});
	});
	watch(sort, (value) => writeStoredValue(sortStorage, value));
	watch(sortOrder, (value) => writeStoredValue(orderStorage, value));
	watch(tagId, (value) => {
		if (value === '') removeStoredValue(tagStorage);
		else writeStoredValue(tagStorage, value);
	});

	const formatRelativeTime = (timestamp: number | null): string => {
		if (!timestamp) return t('connections.status.never');
		const language = locale.value.split('-')[0];
		const dateLocale = language === 'zh' ? zhCN : language === 'ja' ? ja : enUS;
		return formatDistanceToNow(new Date(timestamp), { addSuffix: true, locale: dateLocale });
	};

	const openAdd = () => {
		editing.value = null;
		formVisible.value = true;
	};

	const openEdit = (c: ConnectionSummary) => {
		editing.value = c;
		formVisible.value = true;
	};

	const testAllFiltered = () => testAll(filtered.value.filter((item) => item.type === 'SSH'));

	const connectAllFiltered = () => {
		const ids = filtered.value
			.filter((connection) => connection.type === 'SSH')
			.map((connection) => String(connection.id));
		if (!ids.length) return;
		preloadWorkspaceTerminalSurface();
		void router.push({ name: 'Workspace', query: { connectionId: ids } });
	};

	const tagNames = (connection: ConnectionSummary) =>
		connection.tagIds
			.map((id) => tags.items.value.find((tag) => tag.id === id)?.name)
			.filter((name): name is string => Boolean(name));

	const toggleSelected = (id: number) => {
		const next = new Set(selected.value);
		next.has(id) ? next.delete(id) : next.add(id);
		selected.value = next;
	};

	const selectAll = () => {
		selected.value = new Set(filtered.value.map((c) => c.id));
	};

	const deselectAll = () => {
		selected.value = new Set();
	};

	const invert = () => {
		const next = new Set(selected.value);
		for (const c of filtered.value) next.has(c.id) ? next.delete(c.id) : next.add(c.id);
		selected.value = next;
	};

	const connect = (c: ConnectionSummary) => {
		if (c.type === 'RDP' || c.type === 'VNC') {
			capabilities.remoteDesktop.open({ id: c.id, name: c.name || c.host, type: c.type });
			return;
		}
		preloadWorkspaceTerminalSurface();
		return router.push({ name: 'Workspace', query: { connectionId: String(c.id) } });
	};
</script>
<template>
	<main class="p-4 text-foreground md:p-6 lg:p-8">
		<p v-if="message" role="status" class="my-3">{{ message }}</p>
		<p v-if="data.needsRefresh.value" class="my-3 text-text-secondary">
			{{ t('connections.failures.recovery_required') }}
		</p>
		<div class="mx-auto max-w-screen-lg">
			<h1 class="mb-6 text-2xl font-semibold">{{ t('nav.connections') }}</h1>

			<section class="ui-solid-panel min-h-[400px] overflow-hidden rounded-xl">
				<header class="flex flex-col items-stretch gap-3 border-b border-border/60 px-4 py-3">
					<h2 class="shrink-0 text-lg font-medium">
						{{ t('dashboard.connectionList') }} ({{ filtered.length }})
					</h2>
					<div class="flex w-full flex-wrap items-stretch gap-2 sm:items-center">
						<div class="mr-1 flex shrink-0 items-center">
							<label for="batch-edit-toggle" class="mr-2 text-sm font-medium text-text-secondary">{{
								t('connections.batchEdit.toggleLabel')
							}}</label>
							<UiSwitch
								v-model="batch"
								id="batch-edit-toggle"
								@update:model-value="selected = new Set()"
							/>
						</div>

						<div class="w-full sm:min-w-32 sm:flex-1">
							<UiInput
								v-model="search"
								type="text"
								:placeholder="t('dashboard.searchConnectionsPlaceholder')"
								class="w-full"
							/>
						</div>
						<div class="w-full sm:w-36">
							<UiSelect v-model="tagId" class="w-full" :aria-label="t('dashboard.filterByTag')">
								<option value="">{{ t('dashboard.filterTags.all') }}</option>
								<option v-for="tag in tags.items.value" :key="tag.id" :value="tag.id">
									{{ tag.name }}
								</option>
							</UiSelect>
						</div>
						<div class="w-full sm:w-36">
							<UiSelect v-model="sort" class="w-full" :aria-label="t('dashboard.sortBy')">
								<option value="lastConnected">{{ t('dashboard.sortOptions.lastConnected') }}</option>
								<option value="name">{{ t('dashboard.sortOptions.name') }}</option>
								<option value="type">{{ t('dashboard.sortOptions.type') }}</option>
								<option value="updated">{{ t('dashboard.sortOptions.updated') }}</option>
								<option value="created">{{ t('dashboard.sortOptions.created') }}</option>
							</UiSelect>
						</div>
						<div class="ml-auto flex flex-wrap shrink-0 items-center gap-2">
							<UiSelect
								v-if="selected.size"
								v-model="appendTagId"
								:aria-label="t('connections.appendTag')"
								><option :value="null">{{ t('connections.form.tags') }}</option>
								<option v-for="tag in tags.items.value" :key="tag.id" :value="tag.id">
									{{ tag.name }}
								</option></UiSelect
							><UiButton
								v-if="selected.size"
								:disabled="appendTagId === null || loading || data.needsRefresh.value"
								@click="appendTagId !== null && appendTag(appendTagId)"
								>{{ t('connections.appendTag') }}</UiButton
							><UiButton :disabled="loading || data.busy.value" @click="refresh">{{
								t('connections.refresh')
							}}</UiButton
							><UiButton :disabled="loading" @click="importVisible = true">{{
								t('connections.importTitle')
							}}</UiButton
							><UiButton
								:disabled="data.needsRefresh.value || loading"
								@click="
									exportItems(
										selected.size ? filtered.filter((item) => selected.has(item.id)) : filtered,
									)
								"
								>{{ t('connections.exportTitle') }}</UiButton
							>
							<UiButton type="button" appearance="soft" @click="hostKeysVisible = true">{{
								t('hostKeys.title')
							}}</UiButton>
							<UiButton
								appearance="soft"
								icon-only
								:aria-label="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
								:title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
								@click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
							>
								<i
									:class="[
										'fas',
										sortOrder === 'asc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a',
										'w-4 text-center',
									]"
									aria-hidden="true"
								/>
							</UiButton>
							<UiButton
								type="button"
								appearance="solid"
								icon-only
								:title="t('connections.addConnection')"
								@click="openAdd"
							>
								<i class="fas fa-plus" aria-hidden="true" />
							</UiButton>
							<UiButton
								type="button"
								appearance="solid"
								class="shrink-0"
								:disabled="!filtered.some((connection) => connection.type === 'SSH')"
								:title="t('connections.actions.testAllFiltered')"
								@click="testAllFiltered"
							>
								<i class="fas fa-check-double" aria-hidden="true" /><span class="hidden sm:inline">{{
									t('connections.actions.testAllFiltered')
								}}</span>
							</UiButton>
							<UiButton
								type="button"
								appearance="solid"
								class="shrink-0"
								:disabled="!filtered.some((connection) => connection.type === 'SSH')"
								@click="connectAllFiltered"
							>
								<i class="fas fa-network-wired" aria-hidden="true" /><span class="hidden sm:inline">{{
									t('connections.actions.connectAllFiltered')
								}}</span>
							</UiButton>
						</div>
					</div>
				</header>

				<UiActionGroup v-if="batch" layout="batch" class="border-b border-border/60 px-4 py-3">
					<UiButton type="button" appearance="soft" density="compact" @click="selectAll">
						{{ t('connections.batchEdit.selectAll') }} ({{ selected.size }})
					</UiButton>
					<UiButton type="button" appearance="soft" density="compact" @click="deselectAll">
						{{ t('connections.batchEdit.deselectAll') }}
					</UiButton>
					<UiButton type="button" appearance="soft" density="compact" @click="invert">
						{{ t('connections.batchEdit.invertSelection') }}
					</UiButton>
					<UiButton
						type="button"
						:disabled="selected.size === 0"
						appearance="solid"
						density="compact"
						@click="openBatch"
					>
						<i class="fas fa-edit" aria-hidden="true" />{{ t('connections.batchEdit.editSelected') }}
					</UiButton>
					<UiButton
						type="button"
						:disabled="selected.size === 0"
						appearance="solid"
						tone="danger"
						density="compact"
						@click="deleteSelected"
					>
						<i class="fas fa-trash-alt" aria-hidden="true" />{{
							t('connections.batchEdit.deleteSelectedButton')
						}}
					</UiButton>
				</UiActionGroup>

				<div class="p-4">
					<ul v-if="filtered.length" class="grid gap-4">
						<li
							v-for="c in filtered"
							:key="c.id"
							class="connection-card ui-solid-item flex flex-col items-stretch justify-between gap-3 rounded-xl p-4 lg:flex-row lg:items-center lg:gap-4"
							:class="[
								selected.has(c.id) ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
								batch ? 'cursor-pointer' : '',
							]"
							@click="batch && toggleSelected(c.id)"
						>
							<div class="min-w-0 flex-1 space-y-1">
								<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
									<span
										class="flex min-w-0 items-center text-base font-semibold"
										:title="c.name || c.host"
									>
										<i
											:class="[
												'fas',
												c.type === 'VNC'
													? 'fa-plug'
													: c.type === 'RDP'
														? 'fa-desktop'
														: 'fa-server',
												'mr-2 w-4 shrink-0 text-center text-text-secondary',
											]"
											aria-hidden="true"
										/>
										<span class="truncate">{{ c.name || c.host }}</span>
									</span>
									<span
										class="rounded-full bg-header/50 px-2 py-0.5 text-xs font-medium text-text-secondary"
										>{{ c.type }}</span
									>
									<div v-if="tagNames(c).length" class="flex flex-wrap gap-1">
										<span
											v-for="name in tagNames(c)"
											:key="name"
											class="rounded-full border border-border/60 bg-card/20 px-1.5 py-0.5 text-xs text-text-secondary"
											>{{ name }}</span
										>
									</div>
								</div>
								<span
									class="block truncate text-sm text-text-secondary"
									:title="`${c.username}@${c.host}:${c.port}`"
									>{{ c.username }}@{{ c.host }}:{{ c.port }}</span
								>
								<span class="block text-xs text-text-secondary"
									>{{ t('dashboard.lastConnected') }}
									{{ formatRelativeTime(c.lastConnectedAt) }}</span
								>
								<div v-if="c.notes" class="mt-1 text-xs text-text-secondary">
									<span class="font-medium">{{ t('connections.form.notes') }}:</span>
									<span class="break-words">{{ c.notes }}</span>
								</div>
								<div v-if="c.type === 'SSH' && testResults.get(c.id)" class="pt-1 text-xs">
									<span v-if="testing.has(c.id)" class="text-text-secondary"
										><i class="fas fa-spinner fa-spin mr-1.5" />{{
											t('connections.actions.testing')
										}}</span
									>
									<span v-else :class="testResults.get(c.id)?.success ? 'text-success' : 'text-error'"
										><i
											:class="[
												'fas',
												testResults.get(c.id)?.success ? 'fa-check-circle' : 'fa-times-circle',
												'mr-1.5',
											]"
										/>{{ testResults.get(c.id)?.message
										}}<template v-if="testResults.get(c.id)?.latencyMs != null">
											· {{ testResults.get(c.id)?.latencyMs }} ms</template
										></span
									>
								</div>
							</div>
							<UiActionGroup
								layout="card"
								class="connection-card-actions grid shrink-0 grid-cols-4 gap-2"
								:class="batch ? 'pointer-events-none' : ''"
							>
								<UiButton
									v-if="c.type === 'SSH'"
									type="button"
									density="comfortable"
									:disabled="batch || testing.has(c.id)"
									appearance="ghost"
									tone="primary"
									@click.stop="test(c)"
								>
									<i
										:class="[
											'fas',
											testing.has(c.id) ? 'fa-spinner fa-spin' : 'fa-vial',
											testing.has(c.id) ? '' : 'mr-1',
										]"
										aria-hidden="true"
									/><span v-if="!testing.has(c.id)">{{ t('connections.actions.test') }}</span>
								</UiButton>
								<UiButton
									type="button"
									density="comfortable"
									:disabled="batch"
									appearance="ghost"
									tone="primary"
									@click.stop="openEdit(c)"
								>
									<i class="fas fa-pencil-alt mr-1" aria-hidden="true" />{{
										t('connections.actions.edit')
									}}
								</UiButton>
								<UiButton
									type="button"
									density="comfortable"
									:disabled="batch"
									appearance="ghost"
									@click.stop="clone(c)"
								>
									<i class="fas fa-clone mr-1" aria-hidden="true" />{{
										t('connections.actions.clone')
									}}
								</UiButton>
								<UiButton
									type="button"
									density="comfortable"
									:disabled="batch"
									appearance="solid"
									tone="primary"
									@click.stop="connect(c)"
								>
									{{ t('connections.actions.connect') }}
								</UiButton>
							</UiActionGroup>
						</li>
					</ul>
					<p v-else class="py-12 text-center text-text-secondary">{{ t('connections.noConnections') }}</p>
				</div>
			</section>
		</div>

		<ConnectionImportModal :visible="importVisible" @close="importVisible = false" />
		<HostKeyManagementModal :visible="hostKeysVisible" @close="hostKeysVisible = false" />
		<ConnectionEditorModal
			:visible="formVisible"
			:connection="editing"
			@close="
				formVisible = false;
				editing = null;
			"
		/>
		<BatchEditConnectionModal
			:visible="batchModal"
			:count="selected.size"
			:loading="loading || data.needsRefresh.value"
			@close="cancelBatch"
			@save="batchSave"
		/>
	</main>
</template>

<style scoped>
	.connection-card {
		container-type: inline-size;
	}
	.connection-card-actions {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	@container (max-width: 280px) {
		.connection-card-actions {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
