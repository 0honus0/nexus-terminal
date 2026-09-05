<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { formatDistanceToNow } from 'date-fns';
  import { enUS, ja, zhCN } from 'date-fns/locale';
  import { useFeedback } from '@/shared/feedback/public';
  import { useConnectionTags } from '@/features/tags/public';
  import { useConnections } from '../composables/useConnections';
  import { connectionsApi } from '../api/connectionsApi';
  import ConnectionEditorModal from '../components/ConnectionEditorModal.vue';
  import BatchEditConnectionModal from '../components/BatchEditConnectionModal.vue';
  import type { Connection, ConnectionInput, ConnectionUpdate } from '../model/connection';
  const { t, locale } = useI18n();
  const router = useRouter();
  const feedback = useFeedback();
  const data = useConnections();
  const tags = useConnectionTags();
  const search = ref('');
  type SortField = 'lastConnected' | 'name' | 'type' | 'updated' | 'created';
  type SortOrder = 'asc' | 'desc';
  const SORT_KEY = 'connections_view_sort_by';
  const ORDER_KEY = 'connections_view_sort_order';
  const TAG_KEY = 'connections_view_filter_tag';
  const validSorts = new Set<SortField>(['lastConnected', 'name', 'type', 'updated', 'created']);
  const storedSort = localStorage.getItem(SORT_KEY) as SortField | null;
  const storedOrder = localStorage.getItem(ORDER_KEY) as SortOrder | null;
  const storedTag = Number(localStorage.getItem(TAG_KEY));
  const sort = ref<SortField>(storedSort && validSorts.has(storedSort) ? storedSort : 'lastConnected');
  const sortOrder = ref<SortOrder>(storedOrder === 'asc' ? 'asc' : 'desc');
  const tagId = ref<number | ''>(Number.isInteger(storedTag) && storedTag > 0 ? storedTag : '');
  const formVisible = ref(false);
  const editing = ref<Connection | null>(null);
  const batch = ref(false);
  const selected = ref(new Set<number>());
  const batchModal = ref(false);
  const testing = ref(new Set<number>());
  const testResults = ref(new Map<number, { success: boolean; message: string; latency?: number }>());
  onMounted(() => Promise.all([data.load(), tags.load()]));
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
  watch(sort, (value) => localStorage.setItem(SORT_KEY, value));
  watch(sortOrder, (value) => localStorage.setItem(ORDER_KEY, value));
  watch(tagId, (value) => localStorage.setItem(TAG_KEY, value === '' ? '' : String(value)));

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
  const openEdit = (c: Connection) => {
    editing.value = c;
    formVisible.value = true;
  };
  const test = async (c: Connection) => {
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
    void router.push({ name: 'Workspace', query: { connectionId: ids } });
  };
  const tagNames = (connection: Connection) =>
    connection.tagIds
      .map((id) => tags.tags.value.find((tag) => tag.id === id)?.name)
      .filter((name): name is string => Boolean(name));
  const clone = async (c: Connection) => {
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
  const batchSave = async (update: ConnectionUpdate) => {
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
  const connect = (c: Connection) => router.push({ name: 'Workspace', query: { connectionId: String(c.id) } });
</script>
<template>
  <main class="bg-background p-4 text-foreground md:p-6 lg:p-8">
    <div class="mx-auto max-w-screen-lg">
      <h1 class="mb-6 text-2xl font-semibold">{{ t('nav.connections') }}</h1>

      <section class="min-h-[400px] overflow-hidden rounded-lg border border-border bg-background shadow">
        <header
          class="flex flex-col items-start justify-between gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center"
        >
          <h2 class="shrink-0 text-lg font-medium">{{ t('dashboard.connectionList') }} ({{ filtered.length }})</h2>
          <div class="flex w-full flex-wrap items-stretch gap-2 sm:w-auto sm:flex-nowrap sm:items-center">
            <div class="mr-1 flex items-center">
              <label for="batch-edit-toggle" class="mr-2 text-sm font-medium text-text-secondary">{{
                t('connections.batchEdit.toggleLabel')
              }}</label>
              <button
                id="batch-edit-toggle"
                data-testid="batch-edit-toggle"
                type="button"
                role="switch"
                :aria-checked="batch"
                class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                :class="batch ? 'bg-primary' : 'bg-gray-300'"
                @click="
                  batch = !batch;
                  selected = new Set();
                "
              >
                <span
                  aria-hidden="true"
                  class="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                  :class="batch ? 'translate-x-5' : 'translate-x-0'"
                />
              </button>
            </div>

            <input
              v-model="search"
              data-testid="connections-search"
              type="text"
              :placeholder="t('dashboard.searchConnectionsPlaceholder')"
              class="h-8 w-full rounded border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:w-48"
            />
            <select
              v-model="tagId"
              class="h-8 rounded border border-border bg-background px-2 py-1 pr-7 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :aria-label="t('dashboard.filterByTag')"
            >
              <option value="">{{ t('dashboard.filterTags.all') }}</option>
              <option v-for="tag in tags.tags.value" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
            </select>
            <select
              v-model="sort"
              class="h-8 rounded border border-border bg-background px-2 py-1 pr-7 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :aria-label="t('dashboard.sortBy')"
            >
              <option value="lastConnected">{{ t('dashboard.sortOptions.lastConnected') }}</option>
              <option value="name">{{ t('dashboard.sortOptions.name') }}</option>
              <option value="type">{{ t('dashboard.sortOptions.type') }}</option>
              <option value="updated">{{ t('dashboard.sortOptions.updated') }}</option>
              <option value="created">{{ t('dashboard.sortOptions.created') }}</option>
            </select>
            <button
              type="button"
              class="flex h-8 items-center justify-center rounded border border-border px-1.5 hover:bg-header focus:outline-none focus:ring-1 focus:ring-primary"
              :aria-label="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
              :title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
              @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
            >
              <i
                :class="['fas', sortOrder === 'asc' ? 'fa-arrow-up-a-z' : 'fa-arrow-down-z-a', 'w-4 text-center']"
                aria-hidden="true"
              />
            </button>
            <button
              data-testid="connections-add-button"
              type="button"
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-button text-button-text shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              :title="t('connections.addConnection')"
              @click="openAdd"
            >
              <i class="fas fa-plus !text-white" aria-hidden="true" />
            </button>
            <button
              type="button"
              :disabled="!filtered.some((connection) => connection.type === 'SSH')"
              class="flex h-8 shrink-0 items-center justify-center rounded-md bg-button px-3 py-1.5 text-sm text-button-text shadow-sm hover:bg-button-hover disabled:cursor-not-allowed disabled:opacity-50"
              :title="t('connections.actions.testAllFiltered')"
              @click="testAllFiltered"
            >
              <i class="fas fa-check-double mr-1 !text-white sm:mr-2" aria-hidden="true" /><span
                class="hidden sm:inline"
                >{{ t('connections.actions.testAllFiltered') }}</span
              >
            </button>
            <button
              type="button"
              :disabled="!filtered.some((connection) => connection.type === 'SSH')"
              class="flex h-8 shrink-0 items-center justify-center rounded-md bg-button px-3 py-1.5 text-sm text-button-text shadow-sm hover:bg-button-hover disabled:cursor-not-allowed disabled:opacity-50"
              @click="connectAllFiltered"
            >
              <i class="fas fa-network-wired mr-1 !text-white sm:mr-2" aria-hidden="true" /><span
                class="hidden sm:inline"
                >{{ t('connections.actions.connectAllFiltered') }}</span
              >
            </button>
          </div>
        </header>

        <div v-if="batch" class="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2">
          <button
            data-testid="batch-select-all"
            type="button"
            class="rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-text-secondary shadow-sm hover:bg-border hover:text-foreground"
            @click="selectAll"
          >
            {{ t('connections.batchEdit.selectAll') }} ({{ selected.size }})
          </button>
          <button
            data-testid="batch-deselect-all"
            type="button"
            class="rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-text-secondary shadow-sm hover:bg-border hover:text-foreground"
            @click="deselectAll"
          >
            {{ t('connections.batchEdit.deselectAll') }}
          </button>
          <button
            data-testid="batch-invert-selection"
            type="button"
            class="rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-text-secondary shadow-sm hover:bg-border hover:text-foreground"
            @click="invert"
          >
            {{ t('connections.batchEdit.invertSelection') }}
          </button>
          <button
            data-testid="batch-edit-selected"
            type="button"
            :disabled="selected.size === 0"
            class="rounded-md bg-button px-4 py-1.5 text-sm text-button-text shadow-sm hover:bg-button-hover disabled:cursor-not-allowed disabled:opacity-50"
            @click="batchModal = true"
          >
            <i class="fas fa-edit mr-1 !text-white" aria-hidden="true" />{{ t('connections.batchEdit.editSelected') }}
          </button>
          <button
            data-testid="batch-delete-selected"
            type="button"
            :disabled="selected.size === 0"
            class="rounded-md bg-red-600 px-4 py-1.5 text-sm text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            @click="deleteSelected"
          >
            <i class="fas fa-trash-alt mr-1.5 !text-white" aria-hidden="true" />{{
              t('connections.batchEdit.deleteSelectedButton')
            }}
          </button>
        </div>

        <div class="p-4">
          <ul v-if="filtered.length" class="space-y-3">
            <li
              v-for="c in filtered"
              :key="c.id"
              :data-testid="`connection-row-${c.id}`"
              class="flex items-center rounded border border-border/50 bg-header/50 p-3 transition duration-150"
              :class="[
                selected.has(c.id) ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
                batch ? 'cursor-pointer hover:bg-border/70' : 'hover:bg-border/30',
              ]"
              @click="batch && toggleSelected(c.id)"
            >
              <div class="mr-3 min-w-0 flex-1">
                <span class="flex items-center truncate font-medium" :title="c.name || c.host">
                  <i
                    :class="[
                      'fas',
                      c.type === 'VNC' ? 'fa-plug' : c.type === 'RDP' ? 'fa-desktop' : 'fa-server',
                      'mr-2 w-4 text-center text-text-secondary',
                    ]"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ c.name || c.host }}</span>
                </span>
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
                <div v-if="tagNames(c).length" class="mt-1.5 flex flex-wrap gap-1">
                  <span
                    v-for="name in tagNames(c)"
                    :key="name"
                    class="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-text-secondary"
                    >{{ name }}</span
                  >
                </div>
                <div
                  v-if="c.type === 'SSH' && testResults.get(c.id)"
                  class="mt-1.5 border-t border-border/30 pt-1 text-xs"
                >
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
              <div class="flex shrink-0 items-center space-x-2" @click.stop>
                <button
                  v-if="c.type === 'SSH'"
                  data-testid="connection-row-test"
                  type="button"
                  :disabled="batch || testing.has(c.id)"
                  class="flex h-9 items-center justify-center rounded-md border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
                  @click="test(c)"
                >
                  <i
                    :class="[
                      'fas',
                      testing.has(c.id) ? 'fa-spinner fa-spin' : 'fa-vial',
                      testing.has(c.id) ? '' : 'mr-1',
                    ]"
                    aria-hidden="true"
                  /><span v-if="!testing.has(c.id)">{{ t('connections.actions.test') }}</span>
                </button>
                <button
                  data-testid="connection-row-edit"
                  type="button"
                  :disabled="batch"
                  class="flex h-9 items-center justify-center rounded-md border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
                  @click="openEdit(c)"
                >
                  <i class="fas fa-pencil-alt mr-1" aria-hidden="true" />{{ t('connections.actions.edit') }}
                </button>
                <button
                  type="button"
                  :disabled="batch"
                  class="flex h-9 items-center justify-center rounded-md border border-border bg-transparent px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-border disabled:cursor-not-allowed disabled:opacity-50"
                  @click="clone(c)"
                >
                  <i class="fas fa-clone mr-1" aria-hidden="true" />{{ t('connections.actions.clone') }}
                </button>
                <button
                  type="button"
                  :disabled="batch"
                  class="flex h-9 items-center justify-center rounded-md bg-button px-4 py-2 text-sm font-medium text-button-text shadow-sm hover:bg-button-hover disabled:cursor-not-allowed disabled:opacity-50"
                  @click="connect(c)"
                >
                  {{ t('connections.actions.connect') }}
                </button>
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
