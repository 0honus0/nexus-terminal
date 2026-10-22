<script setup lang="ts">
	import { computed, onActivated, onMounted, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
	import { useAuthSession } from '@/features/auth/public';
	import { useRouter } from 'vue-router';
	import { useI18n } from 'vue-i18n';
	import { isNetworkFailure } from '@/client/http/network-failure';
	import { formatDistanceToNow } from 'date-fns';
	import { enUS, ja, zhCN } from 'date-fns/locale';
	import {
		numberStorageCodec,
		readStoredValue,
		removeStoredValue,
		stringStorageCodec,
		writeStoredValue,
	} from '@/foundation/browser';
	import { UiActionGroup, UiButton, UiInput, UiPopover, UiSelect, UiSwitch } from '@/foundation/ui';
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
		exportItems,
	} = useConnectionManagement();
	const importVisible = ref(false);
	const moreVisible = ref(false);
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
		if (connectionsResult.status === 'rejected' && !isNetworkFailure(connectionsResult.reason)) {
			feedback.notifyError(t('connections.loadFailed'));
		}
		if (tagsResult.status === 'rejected' && !isNetworkFailure(tagsResult.reason)) {
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
	const connectionTypeCounts = computed<Record<ConnectionSummary['type'], number>>(() => {
		const counts: Record<ConnectionSummary['type'], number> = { SSH: 0, RDP: 0, VNC: 0 };
		for (const connection of data.connections.value) {
			counts[connection.type] += 1;
		}
		return counts;
	});
	const connectionTypeSummary = computed(() => [
		{ type: 'SSH' as const, count: connectionTypeCounts.value.SSH, icon: 'fa-terminal' },
		{ type: 'RDP' as const, count: connectionTypeCounts.value.RDP, icon: 'fa-display' },
		{ type: 'VNC' as const, count: connectionTypeCounts.value.VNC, icon: 'fa-plug' },
	]);
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

	const exportCurrent = () =>
		exportItems(
			selected.value.size ? filtered.value.filter((item) => selected.value.has(item.id)) : filtered.value,
		);

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
	<main class="connections-page min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-9 lg:py-7">
		<div class="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
			<header class="connections-head">
				<div class="connections-head__top">
					<h1>{{ t('nav.connections') }}</h1>
					<div class="connections-head__actions">
						<UiPopover
							v-model:open="moreVisible"
							:ariaLabel="t('connections.moreActions')"
							:title="t('connections.moreActions')"
							align="end"
							surface="solid"
							icon-only
							triggerAppearance="soft"
							density="comfortable"
							panel-class="!w-56 !p-1.5"
						>
							<template #trigger>
								<i class="fas fa-ellipsis-h" aria-hidden="true" />
							</template>
							<template #panel="{ close }">
								<div class="flex flex-col gap-1">
									<UiButton
										type="button"
										appearance="ghost"
										class="w-full !justify-start gap-2"
										:disabled="loading || data.needsRefresh.value"
										@click="
											close();
											importVisible = true;
										"
									>
										<i class="fas fa-file-import w-4 text-center" aria-hidden="true" />
										{{ t('connections.importTitle') }}
									</UiButton>
									<UiButton
										type="button"
										appearance="ghost"
										class="w-full !justify-start gap-2"
										:disabled="loading || data.needsRefresh.value || !filtered.length"
										@click="
											close();
											exportCurrent();
										"
									>
										<i class="fas fa-file-export w-4 text-center" aria-hidden="true" />
										{{ t('connections.exportTitle') }}
									</UiButton>
									<UiButton
										type="button"
										appearance="ghost"
										class="w-full !justify-start gap-2"
										@click="
											close();
											hostKeysVisible = true;
										"
									>
										<i class="fas fa-key w-4 text-center" aria-hidden="true" />
										{{ t('hostKeys.title') }}
									</UiButton>
								</div>
							</template>
						</UiPopover>
						<UiButton
							type="button"
							appearance="solid"
							tone="primary"
							class="connection-add-button"
							@click="openAdd"
						>
							<i class="fas fa-plus" aria-hidden="true" />
							{{ t('connections.addConnection') }}
						</UiButton>
					</div>
				</div>

				<div class="connection-summary" role="group" :aria-label="t('dashboard.protocolDistribution')">
					<div class="connection-summary__stat connection-summary__stat--total">
						<span class="connection-summary__icon" aria-hidden="true">
							<i class="fas fa-link"></i>
						</span>
						<span class="connection-summary__label">{{ t('dashboard.totalConnections') }}</span>
						<strong class="connection-summary__value">{{ data.connections.value.length }}</strong>
					</div>
					<div
						v-for="item in connectionTypeSummary"
						:key="item.type"
						class="connection-summary__stat"
						:class="`connection-summary__stat--${item.type.toLowerCase()}`"
					>
						<span
							class="connection-summary__icon"
							:class="`connection-summary__icon--${item.type.toLowerCase()}`"
							aria-hidden="true"
						>
							<i :class="['fas', item.icon]"></i>
						</span>
						<span class="connection-summary__label">{{ item.type }}</span>
						<strong class="connection-summary__value">{{ item.count }}</strong>
					</div>
				</div>
			</header>

			<section class="connections-panel" :aria-labelledby="'connections-list-title'">
				<header class="connections-panel__head">
					<div class="connections-panel__title">
						<span class="connections-panel__mark" aria-hidden="true">
							<i class="fas fa-layer-group"></i>
						</span>
						<div class="min-w-0">
							<h2 id="connections-list-title">
								{{ t('dashboard.connectionList') }}
								<span class="connections-panel__count">{{ filtered.length }}</span>
							</h2>
						</div>
					</div>
					<div class="connections-panel__actions">
						<UiButton
							type="button"
							appearance="soft"
							density="comfortable"
							:disabled="!filtered.some((connection) => connection.type === 'SSH')"
							:aria-label="t('connections.actions.testAllFiltered')"
							@click="testAllFiltered"
						>
							<i class="fas fa-flask" aria-hidden="true" />
							{{ t('connections.actions.testAllFiltered') }}
						</UiButton>
						<UiButton
							type="button"
							appearance="soft"
							tone="primary"
							density="comfortable"
							:disabled="!filtered.some((connection) => connection.type === 'SSH')"
							:aria-label="t('connections.actions.connectAllFiltered')"
							@click="connectAllFiltered"
						>
							<i class="fas fa-network-wired" aria-hidden="true" />
							{{ t('connections.actions.connectAllFiltered') }}
						</UiButton>
					</div>
				</header>

				<div class="catalog-toolbar">
					<UiInput
						v-model="search"
						type="search"
						density="comfortable"
						class="connections-search"
						:placeholder="t('dashboard.searchConnectionsPlaceholder')"
						:aria-label="t('common.search')"
					>
						<template #leading><i class="fas fa-magnifying-glass" aria-hidden="true"></i></template>
					</UiInput>

					<div class="connections-tags">
						<UiSelect
							v-model="tagId"
							class="connections-tags__select"
							density="comfortable"
							text-align="center"
							:aria-label="t('dashboard.filterByTag')"
						>
							<option value="">{{ t('dashboard.filterTags.all') }}</option>
							<option v-for="tag in tags.items.value" :key="tag.id" :value="tag.id">
								{{ tag.name }}
							</option>
						</UiSelect>
					</div>

					<div class="connections-sort">
						<UiSelect
							v-model="sort"
							class="connections-sort__select"
							density="comfortable"
							text-align="center"
							:aria-label="t('dashboard.sortBy')"
						>
							<option value="lastConnected">{{ t('dashboard.sortOptions.lastConnected') }}</option>
							<option value="name">{{ t('dashboard.sortOptions.name') }}</option>
							<option value="type">{{ t('dashboard.sortOptions.type') }}</option>
							<option value="updated">{{ t('dashboard.sortOptions.updated') }}</option>
							<option value="created">{{ t('dashboard.sortOptions.created') }}</option>
						</UiSelect>
					</div>

					<UiButton
						type="button"
						appearance="soft"
						icon-only
						density="comfortable"
						class="connections-sort-order"
						:aria-label="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
						:title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
						@click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
					>
						<i
							:class="['fas', sortOrder === 'asc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a']"
							aria-hidden="true"
						></i>
					</UiButton>

					<div class="batch-toggle">
						<label for="batch-edit-toggle" class="batch-toggle__label"
							><i class="fas fa-list-check batch-toggle__icon" aria-hidden="true"></i>
							<span>{{ t('connections.batchEdit.toggleLabel') }}</span></label
						>
						<UiSwitch
							v-model="batch"
							id="batch-edit-toggle"
							:aria-label="t('connections.batchEdit.toggleLabel')"
							@update:model-value="selected = new Set()"
						/>
					</div>
				</div>
				<div v-if="data.needsRefresh.value" class="mb-3 flex justify-end">
					<UiButton type="button" density="compact" :disabled="loading || data.busy.value" @click="refresh">{{
						t('connections.refresh')
					}}</UiButton>
				</div>

				<div v-if="batch" class="batch-bar">
					<span class="batch-bar__summary">{{
						t('connections.batchEdit.selectedItems', { count: selected.size })
					}}</span>
					<UiActionGroup layout="batch" class="batch-bar__actions">
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
							tone="primary"
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
				</div>

				<ul v-if="filtered.length" class="connection-list">
					<li
						v-for="c in filtered"
						:key="c.id"
						class="connection-card"
						:class="[
							selected.has(c.id) ? 'ring-2 ring-primary/70 ring-offset-1 ring-offset-background' : '',
							batch ? 'connection-card--batch cursor-pointer' : '',
						]"
						:tabindex="batch ? 0 : undefined"
						@click="batch && toggleSelected(c.id)"
						@keydown.enter="batch && toggleSelected(c.id)"
						@keydown.space.prevent="batch && toggleSelected(c.id)"
					>
						<span
							v-if="batch"
							class="connection-select"
							:class="selected.has(c.id) ? 'connection-select--checked' : ''"
							aria-hidden="true"
						>
							<i :class="['fas', selected.has(c.id) ? 'fa-check' : 'fa-minus']"></i>
						</span>

						<span
							class="connection-type-icon"
							:class="`connection-type-icon--${c.type.toLowerCase()}`"
							aria-hidden="true"
						>
							<i
								:class="[
									'fas',
									c.type === 'SSH' ? 'fa-terminal' : c.type === 'RDP' ? 'fa-display' : 'fa-plug',
								]"
							></i>
						</span>

						<div class="connection-content">
							<div class="connection-heading">
								<strong class="connection-name" :title="c.name || c.host">{{
									c.name || c.host
								}}</strong>
								<div class="connection-badges connection-badges--inline">
									<span class="connection-protocol">{{ c.type }}</span>
									<span
										v-for="name in tagNames(c).slice(0, 3)"
										:key="name"
										class="connection-tag"
										:title="name"
										>{{ name }}</span
									>
									<span v-if="tagNames(c).length > 3" class="connection-tag connection-tag--more"
										>+{{ tagNames(c).length - 3 }}</span
									>
								</div>
							</div>
							<code class="connection-address" :title="`${c.username}@${c.host}:${c.port}`"
								>{{ c.username }}@{{ c.host }}:{{ c.port }}</code
							>
							<div class="connection-meta">
								<span class="connection-meta__item">
									<i class="fas fa-clock-rotate-left" aria-hidden="true"></i>
									{{ t('dashboard.lastConnected') }} {{ formatRelativeTime(c.lastConnectedAt) }}
								</span>
								<span
									v-if="c.notes"
									class="connection-meta__item connection-meta__notes"
									:title="c.notes"
								>
									<i class="fas fa-note-sticky" aria-hidden="true"></i>
									<span>{{ c.notes }}</span>
								</span>
								<span
									v-if="c.type === 'SSH' && (testing.has(c.id) || testResults.get(c.id))"
									class="connection-meta__item"
									:class="
										testing.has(c.id)
											? ''
											: testResults.get(c.id)?.success
												? 'connection-meta__item--success'
												: 'connection-meta__item--error'
									"
								>
									<i
										:class="[
											'fas',
											testing.has(c.id)
												? 'fa-spinner fa-spin'
												: testResults.get(c.id)?.success
													? 'fa-circle-check'
													: 'fa-circle-xmark',
										]"
										aria-hidden="true"
									></i>
									<span v-if="testing.has(c.id)">{{ t('connections.actions.testing') }}</span>
									<span v-else>
										{{ testResults.get(c.id)?.message
										}}<template v-if="testResults.get(c.id)?.latencyMs != null">
											· {{ testResults.get(c.id)?.latencyMs }} ms</template
										>
									</span>
								</span>
							</div>
						</div>

						<div class="connection-badges connection-badges--rail">
							<span class="connection-protocol">{{ c.type }}</span>
							<span
								v-for="name in tagNames(c).slice(0, 3)"
								:key="name"
								class="connection-tag"
								:title="name"
								>{{ name }}</span
							>
							<span v-if="tagNames(c).length > 3" class="connection-tag connection-tag--more"
								>+{{ tagNames(c).length - 3 }}</span
							>
						</div>

						<div class="row-actions" :class="batch ? 'pointer-events-none opacity-45' : ''">
							<UiButton
								v-if="c.type === 'SSH'"
								type="button"
								class="row-action row-action--test"
								density="comfortable"
								:disabled="batch || testing.has(c.id)"
								appearance="ghost"
								tone="primary"
								:aria-label="t('connections.actions.test')"
								:title="t('connections.actions.test')"
								@click.stop="test(c)"
							>
								<i
									:class="['fas', testing.has(c.id) ? 'fa-spinner fa-spin' : 'fa-flask']"
									aria-hidden="true"
								/>
								<span class="row-action__label">{{ t('connections.actions.test') }}</span>
							</UiButton>
							<UiButton
								type="button"
								class="row-action row-action--edit"
								density="comfortable"
								:disabled="batch"
								appearance="ghost"
								:aria-label="t('connections.actions.edit')"
								:title="t('connections.actions.edit')"
								@click.stop="openEdit(c)"
							>
								<i class="fas fa-pen" aria-hidden="true" />
								<span class="row-action__label">{{ t('connections.actions.edit') }}</span>
							</UiButton>
							<UiButton
								type="button"
								class="row-action row-action--clone"
								density="comfortable"
								:disabled="batch"
								appearance="ghost"
								:aria-label="t('connections.actions.clone')"
								:title="t('connections.actions.clone')"
								@click.stop="clone(c)"
							>
								<i class="fas fa-clone" aria-hidden="true" />
								<span class="row-action__label">{{ t('connections.actions.clone') }}</span>
							</UiButton>
							<UiButton
								type="button"
								density="comfortable"
								:disabled="batch"
								appearance="solid"
								tone="primary"
								class="row-action row-action--connect connection-connect"
								@click.stop="connect(c)"
							>
								<span class="row-action__label">{{ t('connections.actions.connect') }}</span>
								<i class="fas fa-arrow-right" aria-hidden="true" />
							</UiButton>
						</div>
					</li>
				</ul>

				<div v-else class="connection-empty">
					<span class="connection-empty__icon" aria-hidden="true"><i class="fas fa-link-slash"></i></span>
					<p v-if="loading">{{ t('common.loading') }}</p>
					<p v-else-if="search">{{ t('dashboard.noConnectionsMatchSearch') }}</p>
					<p v-else-if="tagId !== ''">{{ t('dashboard.noConnectionsWithTag') }}</p>
					<p v-else>{{ t('connections.noConnections') }}</p>
					<UiButton
						v-if="!loading && !search && tagId === ''"
						type="button"
						appearance="soft"
						tone="primary"
						@click="openAdd"
					>
						<i class="fas fa-plus" aria-hidden="true" />
						{{ t('connections.addFirstConnection') }}
					</UiButton>
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
	.connections-page {
		--connections-line: color-mix(in srgb, var(--border-color) 74%, transparent);
		--connections-line-strong: color-mix(in srgb, var(--border-color) 88%, transparent);
		--connections-accent-soft: color-mix(in srgb, var(--link-active-color) 10%, transparent);
		--connections-accent-border: color-mix(in srgb, var(--link-active-color) 24%, var(--border-color));
	}

	.connections-head {
		padding: 0 2px;
	}

	.connections-head__top {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.connections-head h1 {
		margin: 0;
		font-size: clamp(1.75rem, 2.25vw, 2.15rem);
		font-weight: 730;
		line-height: 1;
		letter-spacing: -0.04em;
	}

	.connection-summary {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		margin-top: 16px;
	}

	.connection-summary__stat {
		display: grid;
		grid-template-areas: 'icon label value';
		grid-template-columns: 38px minmax(0, 1fr) auto;
		min-width: 0;
		min-height: 82px;
		align-items: center;
		gap: 14px;
		padding: 14px 18px;
		border-radius: 14px;
		background: color-mix(in srgb, var(--card-bg-color) 78%, var(--app-bg-color));
	}

	.connection-summary__stat--total {
		background: color-mix(in srgb, var(--link-active-color) 6%, var(--card-bg-color));
	}

	.connection-summary__stat--ssh {
		background: color-mix(in srgb, var(--link-active-color) 4%, var(--card-bg-color));
	}

	.connection-summary__stat--rdp {
		background: color-mix(in srgb, #5f7cfa 5%, var(--card-bg-color));
	}

	.connection-summary__stat--vnc {
		background: color-mix(in srgb, #d8679b 5%, var(--card-bg-color));
	}

	.connection-summary__icon {
		grid-area: icon;
		display: grid;
		width: 38px;
		height: 38px;
		place-items: center;
		border: 0;
		border-radius: 11px;
		background: var(--connections-accent-soft);
		color: var(--link-active-color);
		font-size: 12px;
	}

	.connection-summary__icon--rdp {
		background: color-mix(in srgb, #5f7cfa 10%, transparent);
		color: color-mix(in srgb, #5f7cfa 76%, var(--text-color));
	}

	.connection-summary__icon--vnc {
		background: color-mix(in srgb, #d8679b 10%, transparent);
		color: color-mix(in srgb, #d8679b 76%, var(--text-color));
	}

	.connection-summary__label {
		grid-area: label;
		align-self: center;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 11px;
		line-height: 1.3;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.connection-summary__value {
		grid-area: value;
		align-self: center;
		font-size: 26px;
		font-weight: 690;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
	}

	.connections-head__actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
	}

	.connection-add-button {
		min-width: 0;
		white-space: nowrap;
	}

	.connections-panel {
		min-width: 0;
	}

	.connections-panel__head {
		display: flex;
		min-height: 80px;
		align-items: stretch;
		justify-content: space-between;
		gap: 16px;
		padding: 4px 2px 13px;
	}

	.connections-panel__title {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 10px;
	}

	.connections-panel__mark {
		display: grid;
		width: 28px;
		height: 28px;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 8px;
		background: var(--connections-accent-soft);
		color: var(--link-active-color);
		font-size: 10px;
	}

	.connections-panel__title h2 {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 7px;
		margin: 0;
		font-size: 13px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.connections-panel__count {
		display: inline-grid;
		min-width: 20px;
		height: 18px;
		place-items: center;
		padding-inline: 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
		font-size: 9px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}

	.connections-panel__actions {
		display: grid;
		width: clamp(112px, 11vw, 152px);
		min-height: 64px;
		flex: 0 0 auto;
		align-self: stretch;
		grid-template-rows: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}

	.connections-panel__actions > [data-ui-gen='2'] {
		width: 100%;
		height: auto;
		min-height: 30px;
		justify-content: center;
		gap: 6px;
		--ui-control-height: 100%;
		--ui-control-padding-inline: 9px;
		--ui-control-font-size: 11px;
	}

	.catalog-toolbar {
		display: grid;
		grid-template-areas: 'search tags sort order batch';
		grid-template-columns: minmax(180px, 1fr) 150px 138px 36px auto;
		align-items: center;
		gap: 8px;
		padding: 2px 2px 14px;
	}

	.connections-search {
		grid-area: search;
		min-width: 0;
		width: 100%;
	}

	.connections-tags {
		grid-area: tags;
		min-width: 0;
		width: 150px;
	}

	.connections-tags__select {
		width: 100%;
	}

	.connections-tags__select[data-ui-gen='2'] {
		--ui-control-font-size: 11px;
		--ui-control-padding-inline: 10px;
	}

	.connections-sort {
		grid-area: sort;
		width: 138px;
	}

	.connections-sort__select {
		width: 100%;
	}

	.connections-sort__select[data-ui-gen='2'] {
		--ui-control-font-size: 11px;
		--ui-control-padding-inline: 10px;
	}

	.connections-sort-order {
		grid-area: order;
	}

	.batch-toggle {
		grid-area: batch;
		display: inline-flex;
		height: 36px;
		align-items: center;
		gap: 8px;
		padding-inline: 10px;
		border: 0;
		border-radius: 10px;
		background: color-mix(in srgb, var(--text-color) 3.5%, transparent);
	}

	.batch-toggle__label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-color-secondary);
		font-size: 10.5px;
		font-weight: 570;
		white-space: nowrap;
		cursor: pointer;
	}

	.batch-toggle__icon {
		display: none;
		font-size: 10px;
	}

	.connections-notice {
		padding: 10px 16px;
		border-bottom: 1px solid var(--connections-line);
		font-size: 12px;
	}

	.connections-notice--warning {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		border-color: color-mix(in srgb, var(--status-warning-color) 24%, transparent);
		background: color-mix(in srgb, var(--status-warning-color) 9%, transparent);
		color: var(--status-warning-color);
	}

	.batch-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 16px;
		border-bottom: 1px solid var(--connections-accent-border);
		background: color-mix(in srgb, var(--link-active-color) 5%, var(--input-bg-color));
	}

	.batch-bar__summary {
		flex: 0 0 auto;
		color: var(--text-color-secondary);
		font-size: 10.5px;
		font-variant-numeric: tabular-nums;
	}

	.batch-bar__actions {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.connection-list {
		display: flex;
		container: connections-list / inline-size;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 14px 0 16px;
		list-style: none;
	}

	.connection-card {
		display: grid;
		grid-template-columns: 34px minmax(0, 1fr) auto;
		min-width: 0;
		min-height: 88px;
		align-items: center;
		gap: 13px;
		padding: 14px 18px;
		border: 0;
		border-radius: 13px;
		background: color-mix(in srgb, var(--text-color) 3.5%, transparent);
		box-shadow: inset 2px 0 0 transparent;
		transition:
			background-color 140ms ease,
			border-color 140ms ease,
			box-shadow 140ms ease;
	}

	.connection-card:hover {
		background: color-mix(in srgb, var(--link-active-color) 6%, var(--card-bg-color));
		box-shadow: inset 2px 0 0 color-mix(in srgb, var(--link-active-color) 62%, transparent);
	}

	.connection-card:focus-visible {
		outline: 2px solid var(--link-active-color);
		outline-offset: -2px;
	}

	.connection-card--batch {
		grid-template-columns: 18px 38px minmax(0, 1fr) auto;
	}

	.connection-select {
		display: grid;
		width: 16px;
		height: 16px;
		grid-row: 1 / -1;
		align-self: center;
		place-items: center;
		border: 1px solid var(--connections-line-strong);
		border-radius: 5px;
		background: color-mix(in srgb, var(--input-bg-color) 70%, transparent);
		color: transparent;
		font-size: 8px;
	}

	.connection-select--checked {
		border-color: var(--link-active-color);
		background: var(--link-active-color);
		color: var(--button-text-color);
	}

	.connection-type-icon {
		display: grid;
		width: 34px;
		height: 34px;
		align-self: center;
		place-items: center;
		border: 0;
		border-radius: 9px;
		font-size: 11px;
	}

	.connection-type-icon--ssh {
		background: var(--connections-accent-soft);
		color: var(--link-active-color);
	}

	.connection-type-icon--rdp {
		background: color-mix(in srgb, #5f7cfa 9%, transparent);
		color: color-mix(in srgb, #5f7cfa 80%, var(--text-color));
	}

	.connection-type-icon--vnc {
		background: color-mix(in srgb, #d8679b 9%, transparent);
		color: color-mix(in srgb, #d8679b 80%, var(--text-color));
	}

	.connection-content {
		display: grid;
		min-width: 0;
		gap: 6px;
	}

	.connection-heading {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
	}

	.connection-badges {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 6px;
	}

	.connection-badges--inline {
		flex-wrap: wrap;
	}

	.connection-badges--rail {
		display: none;
		width: 4.75rem;
		min-width: 4.75rem;
		flex-direction: column;
		align-self: stretch;
		justify-content: center;
		padding-left: 16px;
		gap: 6px;
	}

	.connection-name {
		min-width: 0;
		max-width: 24rem;
		overflow: hidden;
		font-size: 13px;
		font-weight: 660;
		line-height: 1.3;
		letter-spacing: -0.012em;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.connection-protocol,
	.connection-tag {
		display: inline-flex;
		max-width: 8rem;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 620;
		line-height: 1.4;
		letter-spacing: 0.02em;
	}

	.connection-badges--inline .connection-protocol,
	.connection-badges--inline .connection-tag {
		max-width: 7rem;
		padding: 1px 6px;
		font-size: 8.5px;
		font-weight: 650;
		line-height: 1.55;
		letter-spacing: 0.03em;
	}

	.connection-protocol {
		background: color-mix(in srgb, var(--text-color) 6%, transparent);
		color: var(--text-color-secondary);
	}

	.connection-tag {
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--link-active-color) 14%, var(--connections-line));
		background: color-mix(in srgb, var(--link-active-color) 7%, transparent);
		color: var(--link-active-color);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.connection-tag--more {
		border-color: var(--connections-line);
		background: transparent;
		color: var(--text-color-secondary);
	}

	.connection-address {
		display: block;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 10.5px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		line-height: 1.5;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.connection-meta {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 8px;
		overflow: hidden;
		color: var(--text-color-secondary);
		font-size: 9.5px;
		line-height: 1.55;
	}

	.connection-meta__item {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}

	.connection-meta__item + .connection-meta__item::before {
		width: 3px;
		height: 3px;
		flex: 0 0 auto;
		margin-right: 2px;
		border-radius: 50%;
		background: currentColor;
		content: '';
		opacity: 0.45;
	}

	.connection-meta__item i {
		flex: 0 0 auto;
		font-size: 8.5px;
		opacity: 0.8;
	}

	.connection-meta__notes {
		max-width: 34%;
		overflow: hidden;
	}

	.connection-meta__notes span {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.connection-meta__item--success {
		color: var(--status-success-color);
	}

	.connection-meta__item--error {
		color: var(--status-error-color);
	}

	.row-actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 4px;
	}

	.row-actions > [data-ui-gen='2'] {
		min-width: 0;
		border: 1px solid color-mix(in srgb, var(--connections-line) 72%, transparent);
		justify-content: center;
		--ui-control-gap: 5px;
		--ui-control-padding-inline: 8px;
	}

	.row-actions > [data-ui-gen='2']:not(.connection-connect) {
		background: color-mix(in srgb, var(--text-color) 2.5%, transparent);
	}

	.row-action__label {
		white-space: nowrap;
	}

	.connection-connect {
		min-width: 78px;
		justify-content: center;
		margin-left: 4px;
	}

	.row-actions > .connection-connect {
		border-color: color-mix(in srgb, var(--link-active-color) 36%, transparent);
	}

	.connection-empty {
		display: flex;
		min-height: 260px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 28px;
		color: var(--text-color-secondary);
		font-size: 12px;
		text-align: center;
	}

	.connection-empty__icon {
		display: grid;
		width: 42px;
		height: 42px;
		place-items: center;
		border: 1px solid var(--connections-line);
		border-radius: 13px;
		background: color-mix(in srgb, var(--input-bg-color) 66%, transparent);
		color: var(--text-color-secondary);
		font-size: 15px;
	}

	@media (max-width: 900px) {
		.catalog-toolbar {
			grid-template-areas:
				'search search search search'
				'tags sort order batch';
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px auto;
		}

		.connections-search {
			grid-column: 1 / -1;
		}

		.connections-tags,
		.connections-sort {
			width: 100%;
		}

		.batch-toggle {
			justify-self: end;
		}
	}

	@media (max-width: 860px) {
		.connection-summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 760px) {
		.connections-head h1 {
			font-size: 1.65rem;
		}

		.connections-panel__head {
			min-height: 82px;
			align-items: stretch;
			gap: 8px;
			padding: 2px 2px 11px;
		}

		.connections-panel__actions {
			width: clamp(108px, 26vw, 148px);
			min-height: 72px;
			gap: 6px;
		}

		.connections-panel__actions > [data-ui-gen='2'] {
			gap: 5px;
			--ui-control-height: 100%;
			--ui-control-padding-inline: 9px;
			--ui-control-font-size: 10.5px;
		}

		.catalog-toolbar {
			padding: 2px 2px 12px;
		}

		.connections-sort {
			width: 100%;
			min-width: 0;
		}

		.connections-sort-order {
			width: 36px;
		}

		.batch-toggle {
			justify-content: space-between;
		}

		.batch-bar {
			align-items: flex-start;
			flex-direction: column;
			padding-inline: 12px;
		}

		.batch-bar__actions {
			display: grid;
			width: 100%;
			grid-template-columns: repeat(6, minmax(0, 1fr));
			gap: 8px;
		}

		.batch-bar__actions > [data-ui-gen='2'] {
			width: 100%;
			min-width: 0;
			padding-inline: 6px;
			white-space: normal;
		}

		.batch-bar__actions > [data-ui-gen='2']:nth-child(-n + 3) {
			grid-column: span 2;
		}

		.batch-bar__actions > [data-ui-gen='2']:nth-child(n + 4) {
			grid-column: span 3;
		}

		.connection-list {
			padding: 12px 0 14px;
		}

		.connection-card,
		.connection-card--batch {
			grid-template-columns: 34px minmax(0, 1fr) auto;
			align-items: start;
			gap: clamp(9px, 1.6vw, 11px) clamp(8px, 1.6vw, 10px);
			padding: clamp(14px, 2.2vw, 17px) clamp(12px, 2vw, 14px);
		}

		.connection-card--batch {
			grid-template-columns: 18px 34px minmax(0, 1fr) auto;
		}

		.connection-card--batch .connection-select {
			grid-row: 1 / span 2;
		}

		.connection-heading {
			display: flex;
			align-items: center;
		}

		.connection-badges--inline {
			margin-left: auto;
			justify-content: flex-end;
			gap: clamp(5px, 1.2vw, 7px);
		}

		.connection-badges--rail {
			width: 5rem;
			max-width: min(38vw, 8.5rem);
			min-width: 5rem;
			flex-wrap: nowrap;
			align-self: stretch;
			justify-content: center;
			justify-self: end;
			gap: clamp(6px, 1.4vw, 8px);
		}

		.connection-name {
			max-width: 100%;
			font-size: clamp(15px, 3.2vw, 16px);
		}

		.connection-badges--inline .connection-protocol,
		.connection-badges--inline .connection-tag {
			max-width: min(32vw, 7rem);
			padding: 1px 6px;
			font-size: clamp(10px, 2.4vw, 11px);
		}

		.connection-badges--rail .connection-protocol,
		.connection-badges--rail .connection-tag {
			max-width: min(36vw, 8.5rem);
			padding: 4px 10px;
			font-size: clamp(11px, 3vw, 12.5px);
		}

		.connection-content {
			gap: clamp(8px, 1.8vw, 10px);
		}

		.connection-meta {
			flex-wrap: wrap;
			gap: clamp(7px, 1.5vw, 9px);
			overflow: visible;
			font-size: clamp(11px, 2.5vw, 12px);
		}

		.connection-address {
			font-size: clamp(12.5px, 2.8vw, 13px);
		}

		.connection-meta__notes {
			max-width: 100%;
			flex-basis: 100%;
		}

		.row-actions {
			grid-column: 1 / -1;
			display: flex;
			width: 100%;
			justify-content: stretch;
			gap: clamp(6px, 1.8vw, 10px);
			margin-top: 6px;
		}

		.connection-card--batch .row-actions {
			grid-column: 2 / -1;
		}

		.row-actions > [data-ui-gen='2'] {
			flex: 1 1 0;
			min-width: 0;
			padding-inline: clamp(6px, 1.5vw, 10px);
			--ui-control-height: 32px;
			--ui-control-padding-inline: clamp(6px, 1.5vw, 10px);
			--ui-control-font-size: 11px;
		}

		.row-actions > .connection-connect {
			flex: 0 0 auto;
			min-width: 68px;
			margin-left: 0;
			padding-inline: clamp(8px, 1.8vw, 12px);
		}
	}

	@media (max-width: 620px) {
		.connection-summary {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 8px;
		}

		.connection-summary__stat {
			min-height: 64px;
			grid-template-areas: 'label value';
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 6px;
			padding: 10px 11px;
		}

		.connection-summary__icon {
			display: none;
		}

		.connection-summary__label {
			font-size: 10px;
		}

		.connection-summary__value {
			font-size: 21px;
		}
	}

	@media (max-width: 560px) {
		.catalog-toolbar {
			grid-template-areas:
				'search search search search'
				'tags sort order batch';
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 36px auto;
			gap: 6px;
		}

		.connections-search {
			grid-column: 1 / -1;
		}

		.connections-tags {
			width: 100%;
		}

		.connections-tags__select[data-ui-gen='2'],
		.connections-sort__select[data-ui-gen='2'] {
			--ui-control-padding-inline: 8px;
			--ui-control-gap: 4px;
		}

		.batch-toggle {
			width: auto;
			height: 32px;
			justify-content: center;
			justify-self: end;
			padding-inline: 8px;
		}

		.batch-toggle__icon {
			display: inline-block;
		}

		.batch-toggle__label span {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}

		.connection-meta__item {
			max-width: 100%;
		}

		.row-actions {
			grid-column: 1 / -1;
			gap: clamp(6px, 3vw, 16px);
		}

		.connection-card--batch .row-actions {
			grid-column: 2 / -1;
		}

		.row-actions > [data-ui-gen='2'] {
			--ui-control-height: 30px;
		}

		.row-actions > .connection-connect {
			min-width: 62px;
			margin-left: 0;
		}
	}

	@media (max-width: 360px) {
		.connection-summary {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.connection-summary__stat {
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 4px;
			padding-inline: 8px;
		}

		.connection-summary__label {
			font-size: 10px;
		}

		.connection-summary__value {
			font-size: 19px;
		}

		.row-actions {
			gap: 6px;
		}

		.row-actions > .connection-connect {
			min-width: 60px;
		}
	}

	@media (max-width: 300px) {
		.row-actions {
			grid-column: 1 / -1;
			gap: 6px;
		}

		.connection-card--batch .row-actions {
			grid-column: 2 / -1;
			gap: 6px;
		}
	}

	@media (max-width: 359px) {
		.connection-card {
			grid-template-columns: 34px minmax(0, 1fr);
		}

		.connection-card--batch {
			grid-template-columns: 18px 34px minmax(0, 1fr);
		}
	}

	@media (min-width: 360px) and (max-width: 760px) {
		.connection-badges--inline {
			display: none;
		}

		.connection-badges--rail {
			display: flex;
		}
	}

	@media (max-width: 310px) {
		.connections-head__top {
			gap: 8px;
		}

		.connections-head h1 {
			flex: 1 1 auto;
			min-width: 0;
			white-space: nowrap;
		}

		.connection-add-button {
			width: 36px;
			min-width: 36px;
			padding-inline: 0;
			font-size: 0;
		}

		.connection-add-button i {
			font-size: 12px;
		}

		.catalog-toolbar {
			grid-template-areas:
				'search search'
				'tags batch'
				'sort order';
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.connections-tags,
		.connections-sort {
			width: 100%;
		}
	}

	@container connections-list (min-width: 340px) {
		.row-actions > .connection-connect {
			flex: 1 1 0;
			min-width: 0;
		}
	}

	@container connections-list (max-width: 339px) {
		.row-action--test .row-action__label,
		.row-action--edit .row-action__label,
		.row-action--clone .row-action__label {
			display: none;
		}

		.row-action--test,
		.row-action--edit,
		.row-action--clone {
			flex: 1 1 0;
			min-width: 32px;
			padding-inline: 0;
		}

		.row-actions > .connection-connect {
			flex: 0 0 auto;
			min-width: 68px;
		}
	}

	@container connections-list (max-width: 259px) {
		.connection-card {
			grid-template-columns: minmax(0, 1fr);
		}

		.connection-card--batch {
			grid-template-columns: 18px minmax(0, 1fr);
		}

		.connection-type-icon {
			display: none;
		}

		.row-actions {
			grid-column: 1 / -1;
		}

		.connection-card--batch .row-actions {
			grid-column: 2 / -1;
		}

		.row-action--connect .row-action__label {
			display: none;
		}

		.row-actions > .connection-connect {
			flex: 1 1 0;
			min-width: 32px;
			padding-inline: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.connection-card {
			transition: none;
		}
	}
</style>
