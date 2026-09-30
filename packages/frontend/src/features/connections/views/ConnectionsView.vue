<script setup lang="ts">
  import { computed, onActivated, onMounted, ref, watch } from 'vue';
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
  import { UiButton, UiInput, UiSelect, UiSwitch } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { useRuntimeFeatureCapabilities } from '@/shared/capabilities/public';
  import { preloadWorkspaceTerminalSurface } from '@/runtimes/workspace/public';
  import { useConnections } from '../composables/useConnections';
  import { connectionsApi } from '../api/connectionsApi';
  import ConnectionEditorModal from '../components/ConnectionEditorModal.vue';
  import BatchEditConnectionModal from '../components/BatchEditConnectionModal.vue';
  import type { ConnectionDto, ConnectionFormUpdate } from '../model/connection';
  const { t, locale } = useI18n();
  const router = useRouter();
  const feedback = useFeedback();
  const data = useConnections();
  const capabilities = useRuntimeFeatureCapabilities();
  const tags = capabilities.tags;
  const search = ref('');
  type SortField = 'lastConnected' | 'name' | 'type' | 'updated' | 'created';
  type SortOrder = 'asc' | 'desc';
  const validSorts = new Set<SortField>(['lastConnected', 'name', 'type', 'updated', 'created']);
  const sortStorage = {
    namespace: 'connections.sort',
    version: 1,
    codec: stringStorageCodec((value) => validSorts.has(value as SortField)),
    legacyKeys: ['connections_view_sort_by'],
  } as const;
  const orderStorage = {
    namespace: 'connections.sort-order',
    version: 1,
    codec: stringStorageCodec((value) => value === 'asc' || value === 'desc'),
    legacyKeys: ['connections_view_sort_order'],
  } as const;
  const tagStorage = {
    namespace: 'connections.tag',
    version: 1,
    codec: numberStorageCodec((value) => Number.isInteger(value) && value > 0),
    legacyKeys: ['connections_view_filter_tag'],
  } as const;
  const sort = ref<SortField>((readStoredValue(sortStorage) as SortField | undefined) ?? 'lastConnected');
  const sortOrder = ref<SortOrder>((readStoredValue(orderStorage) as SortOrder | undefined) ?? 'desc');
  const tagId = ref<number | ''>(readStoredValue(tagStorage) ?? '');
  const formVisible = ref(false);
  const editing = ref<ConnectionDto | null>(null);
  const batch = ref(false);
  const selected = ref(new Set<number>());
  const batchModal = ref(false);
  const testing = ref(new Set<number>());
  const testResults = ref(new Map<number, { success: boolean; message: string; latency?: number }>());
  const loadInitialData = async () => {
    const [connectionsResult, tagsResult] = await Promise.allSettled([data.load(), tags.load()]);
    if (connectionsResult.status === 'rejected') feedback.notifyError(t('connections.loadFailed'));
    if (tagsResult.status === 'rejected') feedback.notifyError(t('connections.tagLoadFailed'));
  };
  onMounted(() => void loadInitialData());
  onActivated(() => {
    void data.revalidate().catch(() => undefined);
    void tags.revalidate().catch(() => undefined);
  });
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
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true, locale: dateLocale });
  };

  const openAdd = () => {
    editing.value = null;
    formVisible.value = true;
  };
  const openEdit = (c: ConnectionDto) => {
    editing.value = c;
    formVisible.value = true;
  };
  const test = async (c: ConnectionDto) => {
    testing.value = new Set(testing.value).add(c.id);
    try {
      const result = await connectionsApi.test(c.id);
      testResults.value = new Map(testResults.value).set(c.id, result);
      feedback.notifySuccess(t('connections.test.success'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      testResults.value = new Map(testResults.value).set(c.id, { success: false, message });
      feedback.notifyError(t('connections.test.failed', { error: message }));
    } finally {
      const next = new Set(testing.value);
      next.delete(c.id);
      testing.value = next;
    }
  };
  const testAllFiltered = async () => {
    const ssh = filtered.value.filter((connection) => connection.type === 'SSH');
    await Promise.allSettled(ssh.map((connection) => test(connection)));
  };
  const connectAllFiltered = () => {
    const ids = filtered.value
      .filter((connection) => connection.type === 'SSH')
      .map((connection) => String(connection.id));
    if (!ids.length) return;
    preloadWorkspaceTerminalSurface();
    void router.push({ name: 'Workspace', query: { connectionId: ids } });
  };
  const tagNames = (connection: ConnectionDto) =>
    connection.tagIds
      .map((id) => tags.items.value.find((tag) => tag.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  const clone = async (c: ConnectionDto) => {
    try {
      await data.clone(c.id, t('connections.cloneName', { name: c.name || c.host }));
    } catch (cause) {
      feedback.notifyError(
        t('connections.errors.cloneFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
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
  const deleteSelected = async () => {
    const ids = [...selected.value];
    if (
      !(await feedback.confirm({
        message: t('connections.batchEdit.confirmMessage', { count: ids.length }),
        destructive: true,
      }))
    )
      return;

    const results = await Promise.allSettled(ids.map((id) => data.remove(id)));
    const failedIds = ids.filter((_, index) => results[index]?.status === 'rejected');
    const successCount = ids.length - failedIds.length;
    selected.value = new Set(failedIds);

    if (failedIds.length === 0) {
      await feedback.alert({ message: t('connections.batchEdit.successMessage') });
      return;
    }
    const message = t('connections.batchEdit.partialDeleteMessage', {
      successCount,
      errorCount: failedIds.length,
    });
    if (successCount > 0) feedback.notifyWarning(message);
    else feedback.notifyError(message);
  };
  const batchSave = async (update: ConnectionFormUpdate) => {
    const ids = [...selected.value];
    const results = await Promise.allSettled(ids.map((id) => data.update(id, update)));
    const failedIds = ids.filter((_, index) => results[index]?.status === 'rejected');
    const successCount = ids.length - failedIds.length;
    selected.value = new Set(failedIds);

    if (failedIds.length === 0) {
      batchModal.value = false;
      feedback.notifySuccess(t('connections.batchEdit.updateSuccessMessage', { count: successCount }));
      return;
    }
    const message = t('connections.batchEdit.partialUpdateMessage', {
      successCount,
      errorCount: failedIds.length,
    });
    if (successCount > 0) feedback.notifyWarning(message);
    else feedback.notifyError(message);
  };
  const connect = (c: ConnectionDto) => {
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
    <div class="mx-auto max-w-screen-lg">
      <h1 class="mb-6 text-2xl font-semibold">{{ t('nav.connections') }}</h1>

      <section class="ui-solid-panel min-h-[400px] overflow-hidden rounded-xl">
        <header class="flex flex-col items-stretch gap-3 border-b border-border/60 px-4 py-3">
          <h2 class="shrink-0 text-lg font-medium">{{ t('dashboard.connectionList') }} ({{ filtered.length }})</h2>
          <div class="flex w-full flex-wrap items-stretch gap-2 sm:items-center">
            <div class="mr-1 flex shrink-0 items-center">
              <label for="batch-edit-toggle" class="mr-2 text-sm font-medium text-text-secondary">{{
                t('connections.batchEdit.toggleLabel')
              }}</label>
              <UiSwitch
                v-model="batch"
                id="batch-edit-toggle"
                data-testid="batch-edit-toggle"
                @update:model-value="selected = new Set()"
              />
            </div>

            <div class="w-full sm:min-w-32 sm:flex-1">
              <UiInput
                v-model="search"
                data-testid="connections-search"
                type="text"
                :placeholder="t('dashboard.searchConnectionsPlaceholder')"
                class="w-full"
              />
            </div>
            <div class="w-full sm:w-36">
              <UiSelect v-model="tagId" class="w-full" :aria-label="t('dashboard.filterByTag')">
                <option value="">{{ t('dashboard.filterTags.all') }}</option>
                <option v-for="tag in tags.items.value" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
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
            <div class="ml-auto flex shrink-0 items-center gap-2">
              <UiButton
                appearance="soft"
                icon-only
                :aria-label="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
                :title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
                @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
              >
                <i
                  :class="['fas', sortOrder === 'asc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a', 'w-4 text-center']"
                  aria-hidden="true"
                />
              </UiButton>
              <UiButton
                data-testid="connections-add-button"
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

        <div v-if="batch" class="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
          <UiButton data-testid="batch-select-all" type="button" appearance="soft" density="compact" @click="selectAll">
            {{ t('connections.batchEdit.selectAll') }} ({{ selected.size }})
          </UiButton>
          <UiButton
            data-testid="batch-deselect-all"
            type="button"
            appearance="soft"
            density="compact"
            @click="deselectAll"
          >
            {{ t('connections.batchEdit.deselectAll') }}
          </UiButton>
          <UiButton
            data-testid="batch-invert-selection"
            type="button"
            appearance="soft"
            density="compact"
            @click="invert"
          >
            {{ t('connections.batchEdit.invertSelection') }}
          </UiButton>
          <UiButton
            data-testid="batch-edit-selected"
            type="button"
            :disabled="selected.size === 0"
            appearance="solid"
            density="compact"
            @click="batchModal = true"
          >
            <i class="fas fa-edit" aria-hidden="true" />{{ t('connections.batchEdit.editSelected') }}
          </UiButton>
          <UiButton
            data-testid="batch-delete-selected"
            type="button"
            :disabled="selected.size === 0"
            appearance="solid"
            tone="danger"
            density="compact"
            @click="deleteSelected"
          >
            <i class="fas fa-trash-alt" aria-hidden="true" />{{ t('connections.batchEdit.deleteSelectedButton') }}
          </UiButton>
        </div>

        <div class="p-4">
          <ul v-if="filtered.length" class="grid gap-4">
            <li
              v-for="c in filtered"
              :key="c.id"
              :data-testid="`connection-row-${c.id}`"
              class="connection-card ui-solid-item flex flex-col items-stretch justify-between gap-3 rounded-xl p-4 lg:flex-row lg:items-center lg:gap-4"
              :class="[
                selected.has(c.id) ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
                batch ? 'cursor-pointer' : '',
              ]"
              @click="batch && toggleSelected(c.id)"
            >
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="flex min-w-0 items-center text-base font-semibold" :title="c.name || c.host">
                    <i
                      :class="[
                        'fas',
                        c.type === 'VNC' ? 'fa-plug' : c.type === 'RDP' ? 'fa-desktop' : 'fa-server',
                        'mr-2 w-4 shrink-0 text-center text-text-secondary',
                      ]"
                      aria-hidden="true"
                    />
                    <span class="truncate">{{ c.name || c.host }}</span>
                  </span>
                  <span class="rounded-full bg-header/50 px-2 py-0.5 text-xs font-medium text-text-secondary">{{
                    c.type
                  }}</span>
                  <div v-if="tagNames(c).length" class="flex flex-wrap gap-1">
                    <span
                      v-for="name in tagNames(c)"
                      :key="name"
                      class="rounded-full border border-border/60 bg-card/20 px-1.5 py-0.5 text-xs text-text-secondary"
                      >{{ name }}</span
                    >
                  </div>
                </div>
                <span class="block truncate text-sm text-text-secondary" :title="`${c.username}@${c.host}:${c.port}`"
                  >{{ c.username }}@{{ c.host }}:{{ c.port }}</span
                >
                <span class="block text-xs text-text-secondary"
                  >{{ t('dashboard.lastConnected') }} {{ formatRelativeTime(c.lastConnectedAt) }}</span
                >
                <div v-if="c.notes" class="mt-1 text-xs text-text-secondary">
                  <span class="font-medium">{{ t('connections.form.notes') }}:</span>
                  <span class="break-words">{{ c.notes }}</span>
                </div>
                <div v-if="c.type === 'SSH' && testResults.get(c.id)" class="pt-1 text-xs">
                  <span v-if="testing.has(c.id)" class="text-text-secondary"
                    ><i class="fas fa-spinner fa-spin mr-1.5" />{{ t('connections.actions.testing') }}</span
                  >
                  <span v-else :class="testResults.get(c.id)?.success ? 'text-success' : 'text-error'"
                    ><i
                      :class="['fas', testResults.get(c.id)?.success ? 'fa-check-circle' : 'fa-times-circle', 'mr-1.5']"
                    />{{ testResults.get(c.id)?.message
                    }}<template v-if="testResults.get(c.id)?.latency != null">
                      · {{ testResults.get(c.id)?.latency }} ms</template
                    ></span
                  >
                </div>
              </div>
              <div
                class="connection-card-actions grid shrink-0 grid-cols-4 gap-2"
                :class="batch ? 'pointer-events-none' : ''"
              >
                <UiButton
                  v-if="c.type === 'SSH'"
                  data-testid="connection-row-test"
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
                  data-testid="connection-row-edit"
                  type="button"
                  density="comfortable"
                  :disabled="batch"
                  appearance="ghost"
                  tone="primary"
                  @click.stop="openEdit(c)"
                >
                  <i class="fas fa-pencil-alt mr-1" aria-hidden="true" />{{ t('connections.actions.edit') }}
                </UiButton>
                <UiButton
                  type="button"
                  density="comfortable"
                  :disabled="batch"
                  appearance="ghost"
                  @click.stop="clone(c)"
                >
                  <i class="fas fa-clone mr-1" aria-hidden="true" />{{ t('connections.actions.clone') }}
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
              </div>
            </li>
          </ul>
          <p v-else class="py-12 text-center text-text-secondary">{{ t('connections.noConnections') }}</p>
        </div>
      </section>
    </div>

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
      @close="batchModal = false"
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
  .connection-card-actions :deep(.ui-button) {
    min-width: 0;
    padding-inline: 0.375rem;
  }
  @container (max-width: 280px) {
    .connection-card-actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
