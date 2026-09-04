<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { BaseBadge, BaseButton, BaseInput, BaseSelect } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { useConnectionTags } from '@/features/tags/public';
  import { useConnections } from '../composables/useConnections';
  import { connectionsApi } from '../api/connectionsApi';
  import ConnectionEditorModal from '../components/ConnectionEditorModal.vue';
  import BatchEditConnectionModal from '../components/BatchEditConnectionModal.vue';
  import type { Connection, ConnectionInput, ConnectionUpdate } from '../model/connection';
  const { t } = useI18n();
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
  <main class="mx-auto max-w-7xl space-y-5 p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold">{{ t('nav.connections') }}</h1>
      <div class="flex gap-2">
        <BaseButton data-testid="connections-add-button" variant="primary" @click="openAdd">{{
          t('connections.addConnection')
        }}</BaseButton
        ><button
          data-testid="batch-edit-toggle"
          role="switch"
          :aria-checked="batch"
          class="rounded border border-border px-3 py-2 text-sm"
          @click="
            batch = !batch;
            selected = new Set();
          "
        >
          {{ t('connections.batchEdit.toggleLabel') }}
        </button>
      </div>
    </div>
    <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px_auto_auto_auto]">
      <BaseInput v-model="search" data-testid="connections-search" :placeholder="t('common.search')" />
      <BaseSelect v-model="tagId" :aria-label="t('dashboard.filterByTag')">
        <option value="">{{ t('dashboard.filterTags.all') }}</option>
        <option v-for="tag in tags.tags.value" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
      </BaseSelect>
      <BaseSelect v-model="sort" :aria-label="t('dashboard.sortBy')">
        <option value="lastConnected">{{ t('dashboard.sortOptions.lastConnected') }}</option>
        <option value="name">{{ t('dashboard.sortOptions.name') }}</option>
        <option value="type">{{ t('dashboard.sortOptions.type') }}</option>
        <option value="updated">{{ t('dashboard.sortOptions.updated') }}</option>
        <option value="created">{{ t('dashboard.sortOptions.created') }}</option>
      </BaseSelect>
      <BaseButton
        :title="t(sortOrder === 'asc' ? 'common.sortAscending' : 'common.sortDescending')"
        @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
      >
        {{ sortOrder === 'asc' ? '↑' : '↓' }}
      </BaseButton>
      <BaseButton :disabled="!filtered.some((connection) => connection.type === 'SSH')" @click="testAllFiltered">
        {{ t('connections.actions.testAllFiltered') }}
      </BaseButton>
      <BaseButton :disabled="!filtered.some((connection) => connection.type === 'SSH')" @click="connectAllFiltered">
        {{ t('connections.actions.connectAllFiltered') }}
      </BaseButton>
      <template v-if="batch"
        ><BaseButton data-testid="batch-select-all" @click="selectAll">{{
          t('connections.batchEdit.selectAll')
        }}</BaseButton
        ><BaseButton data-testid="batch-deselect-all" @click="deselectAll">{{
          t('connections.batchEdit.deselectAll')
        }}</BaseButton
        ><BaseButton data-testid="batch-invert-selection" @click="invert">{{
          t('connections.batchEdit.invertSelection')
        }}</BaseButton
        ><BaseButton data-testid="batch-edit-selected" :disabled="selected.size === 0" @click="batchModal = true">{{
          t('connections.batchEdit.editSelected')
        }}</BaseButton
        ><BaseButton
          data-testid="batch-delete-selected"
          variant="danger"
          :disabled="selected.size === 0"
          @click="deleteSelected"
          >{{ t('connections.batchEdit.deleteSelectedButton') }}</BaseButton
        ></template
      >
    </div>
    <ul class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <li
        v-for="c in filtered"
        :key="c.id"
        :data-testid="`connection-row-${c.id}`"
        class="rounded-lg border border-border bg-background p-4 shadow-sm"
        :class="selected.has(c.id) ? 'ring-2 ring-primary' : ''"
        @click="batch && toggleSelected(c.id)"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold">{{ c.name || c.host }}</h2>
            <p class="text-sm text-text-secondary">{{ c.type }} · {{ c.username }}@{{ c.host }}:{{ c.port }}</p>
            <p v-if="c.notes" class="mt-2 text-sm">{{ c.notes }}</p>
            <div v-if="tagNames(c).length" class="mt-2 flex flex-wrap gap-1">
              <BaseBadge v-for="name in tagNames(c)" :key="name">{{ name }}</BaseBadge>
            </div>
            <p
              v-if="testResults.get(c.id)"
              class="mt-2 text-xs"
              :class="testResults.get(c.id)?.success ? 'text-success' : 'text-error'"
            >
              {{ testResults.get(c.id)?.message
              }}<span v-if="testResults.get(c.id)?.latency != null"> · {{ testResults.get(c.id)?.latency }} ms</span>
            </p>
          </div>
          <span class="rounded bg-header px-2 py-1 text-xs">{{ c.authMethod }}</span>
        </div>
        <div class="mt-4 flex flex-wrap gap-2" @click.stop>
          <BaseButton size="sm" @click="connect(c)">{{ t('connections.actions.connect') }}</BaseButton
          ><BaseButton data-testid="connection-row-test" size="sm" :loading="testing.has(c.id)" @click="test(c)">{{
            t('connections.actions.test')
          }}</BaseButton
          ><BaseButton data-testid="connection-row-edit" size="sm" @click="openEdit(c)">{{
            t('connections.actions.edit')
          }}</BaseButton
          ><BaseButton size="sm" @click="clone(c)">{{ t('connections.actions.clone') }}</BaseButton>
        </div>
      </li>
    </ul>
    <p v-if="filtered.length === 0" class="py-12 text-center text-text-secondary">
      {{ t('connections.noConnections') }}
    </p>
    <ConnectionEditorModal
      :visible="formVisible"
      :connection="editing"
      @close="
        formVisible = false;
        editing = null;
      "
    /><BatchEditConnectionModal
      :visible="batchModal"
      :count="selected.size"
      @close="batchModal = false"
      @save="batchSave"
    />
  </main>
</template>
