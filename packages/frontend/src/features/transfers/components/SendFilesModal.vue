<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  import { apiErrorMessage } from '@/client/http';
  import { useFeedback } from '@/shared/feedback/public';
  import { useConnections, type Connection } from '@/features/connections/public';
  import { useConnectionTags } from '@/features/tags/public';
  import { useServerTransfersStore } from '../store/serverTransfers.store';
  import type { SendFileSourceItem, ServerTransferMethod, ServerTransferTask } from '../model/serverTransfer';

  const props = defineProps<{
    visible: boolean;
    sourceConnectionId: number;
    items: readonly SendFileSourceItem[];
    initialTargetPath?: string;
  }>();
  const emit = defineEmits<{ close: []; sent: [task: ServerTransferTask] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const connections = useConnections();
  const tags = useConnectionTags();
  const transfers = useServerTransfersStore();
  const { loading: transferLoading } = storeToRefs(transfers);
  const search = ref('');
  const selected = ref(new Set<number>());
  const targetPath = ref('');
  const method = ref<ServerTransferMethod>('auto');
  const loadingOptions = ref(false);
  const error = ref('');
  const expandedGroups = ref<Record<string, boolean>>({});

  interface ConnectionGroup {
    id: string;
    name: string;
    connections: Connection[];
  }

  const tagNames = computed(() => new Map(tags.tags.value.map((tag) => [tag.id, tag.name])));
  const sshConnections = computed(() =>
    connections.connections.value.filter(
      (connection) => connection.type === 'SSH' && connection.id !== props.sourceConnectionId,
    ),
  );
  const groupedConnections = computed<ConnectionGroup[]>(() => {
    const groups = new Map<number, Connection[]>();
    const untagged: Connection[] = [];

    for (const connection of sshConnections.value) {
      if (!connection.tagIds.length) {
        untagged.push(connection);
        continue;
      }
      let matchedTag = false;
      for (const tagId of connection.tagIds) {
        if (!tagNames.value.has(tagId)) continue;
        matchedTag = true;
        const items = groups.get(tagId) ?? [];
        if (!items.some((item) => item.id === connection.id)) items.push(connection);
        groups.set(tagId, items);
      }
      if (!matchedTag) untagged.push(connection);
    }

    const result = [...groups.entries()]
      .map(([tagId, items]) => ({
        id: String(tagId),
        name: tagNames.value.get(tagId) ?? String(tagId),
        connections: items,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (untagged.length)
      result.push({ id: 'untagged', name: t('sendFilesModal.untaggedConnections'), connections: untagged });
    return result;
  });
  const filteredGroups = computed<ConnectionGroup[]>(() => {
    const q = search.value.trim().toLocaleLowerCase();
    if (!q) return groupedConnections.value;
    return groupedConnections.value
      .map((group) => {
        if (group.name.toLocaleLowerCase().includes(q)) return group;
        const matches = group.connections.filter((connection) =>
          (connection.name || connection.host).toLocaleLowerCase().includes(q),
        );
        return matches.length ? { ...group, connections: matches } : null;
      })
      .filter((group): group is ConnectionGroup => Boolean(group));
  });

  const toggle = (id: number) => {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
  };
  const isGroupSelected = (group: ConnectionGroup) =>
    Boolean(group.connections.length) && group.connections.every((connection) => selected.value.has(connection.id));
  const isGroupIndeterminate = (group: ConnectionGroup) => {
    const count = group.connections.filter((connection) => selected.value.has(connection.id)).length;
    return count > 0 && count < group.connections.length;
  };
  const toggleGroup = (group: ConnectionGroup) => {
    const next = new Set(selected.value);
    if (isGroupSelected(group)) group.connections.forEach((connection) => next.delete(connection.id));
    else group.connections.forEach((connection) => next.add(connection.id));
    selected.value = next;
  };
  const isGroupExpanded = (group: ConnectionGroup) => expandedGroups.value[group.id] ?? true;
  const toggleGroupExpansion = (group: ConnectionGroup) => {
    expandedGroups.value = {
      ...expandedGroups.value,
      [group.id]: !isGroupExpanded(group),
    };
  };
  const selectVisible = () => {
    const ids = filteredGroups.value.flatMap((group) => group.connections.map((connection) => connection.id));
    selected.value = new Set([...selected.value, ...ids]);
  };
  const clear = () => (selected.value = new Set());

  const loadOptions = async () => {
    loadingOptions.value = true;
    error.value = '';
    try {
      await Promise.all([connections.load(), tags.load()]);
    } catch (cause) {
      error.value = apiErrorMessage(cause, t('sendFilesModal.errorFetchingData'));
    } finally {
      loadingOptions.value = false;
    }
  };

  watch(
    () => props.visible,
    (visible) => {
      if (!visible) return;
      search.value = '';
      selected.value = new Set();
      expandedGroups.value = {};
      targetPath.value = props.initialTargetPath?.trim() || '';
      method.value = 'auto';
      void loadOptions();
    },
  );
  onMounted(() => props.visible && void loadOptions());

  const submit = async () => {
    error.value = '';
    const path = targetPath.value.trim();
    if (!selected.value.size || !path || !props.items.length) {
      error.value = t('sendFilesModal.validationError');
      return;
    }
    try {
      const task = await transfers.send({
        sourceConnectionId: props.sourceConnectionId,
        connectionIds: [...selected.value],
        sourceItems: [...props.items],
        remoteTargetPath: path,
        transferMethod: method.value,
      });
      feedback.notifySuccess(t('sendFilesModal.transferInitiatedGeneric'));
      emit('sent', task);
      emit('close');
    } catch (cause) {
      error.value = apiErrorMessage(cause, t('sendFilesModal.transferFailedError'));
    }
  };
</script>

<template>
  <OverlayPanel
    :visible="visible"
    :z-index="70"
    panel-class="max-w-2xl max-h-[90vh] flex flex-col p-6"
    role="dialog"
    :aria-modal="true"
    :aria-label="t('sendFilesModal.title')"
    @close="emit('close')"
  >
    <div class="mb-4 flex shrink-0 items-center justify-between border-b border-border pb-4">
      <h3 class="text-xl font-semibold">{{ t('sendFilesModal.title') }}</h3>
      <button
        type="button"
        class="text-text-secondary transition-colors hover:text-foreground"
        :aria-label="t('common.close')"
        @click="emit('close')"
      >
        <i class="fas fa-times text-xl" aria-hidden="true"></i>
      </button>
    </div>

    <div class="min-h-0 flex-grow space-y-4 overflow-y-auto pr-1">
      <div class="space-y-4">
        <input
          v-model="search"
          type="text"
          :placeholder="t('sendFilesModal.searchConnectionsPlaceholder')"
          class="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <div class="flex flex-col gap-4 sm:flex-row">
          <div class="flex-1">
            <label for="send-files-target-path" class="mb-1 block text-sm font-medium text-text-secondary">{{
              t('sendFilesModal.targetPathLabel')
            }}</label>
            <input
              id="send-files-target-path"
              v-model="targetPath"
              type="text"
              :placeholder="t('sendFilesModal.targetPathPlaceholder')"
              class="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div class="sm:w-48">
            <label for="send-files-transfer-method" class="mb-1 block text-sm font-medium text-text-secondary">{{
              t('sendFilesModal.transferMethodLabel')
            }}</label>
            <select
              id="send-files-transfer-method"
              v-model="method"
              class="w-full appearance-none rounded-md border border-border bg-background bg-no-repeat px-3 py-2 pr-8 text-foreground shadow-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              style="
                background-image: url('data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2016%2016%22%3E%3Cpath%20fill=%22none%22%20stroke=%22%236c757d%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%20stroke-width=%222%22%20d=%22M2%205l6%206%206-6%22/%3E%3C/svg%3E');
                background-position: right 0.75rem center;
                background-size: 16px 12px;
              "
            >
              <option value="auto">{{ t('sendFilesModal.transferMethodAuto') }}</option>
              <option value="rsync">{{ t('sendFilesModal.methodRsync') }}</option>
              <option value="scp">{{ t('sendFilesModal.methodScp') }}</option>
            </select>
          </div>
        </div>
      </div>

      <section class="max-h-72 space-y-4 overflow-y-auto rounded-md border border-border bg-header/30 p-4">
        <div class="flex items-center justify-end gap-2 text-[11px]">
          <button type="button" class="text-primary hover:underline" @click="selectVisible">
            {{ t('sendFilesModal.selectAll') }}
          </button>
          <span class="text-text-secondary" aria-hidden="true">·</span>
          <button type="button" class="text-text-secondary hover:text-foreground hover:underline" @click="clear">
            {{ t('sendFilesModal.clearSelection') }}
          </button>
        </div>

        <div v-if="loadingOptions" class="flex h-24 items-center justify-center text-text-secondary">
          <i class="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>{{ t('sendFilesModal.loadingConnections') }}
        </div>
        <div
          v-else-if="!sshConnections.length"
          class="flex h-24 flex-col items-center justify-center text-text-secondary"
        >
          <i class="fas fa-folder-open mb-2 text-2xl" aria-hidden="true"></i>
          <p>{{ t('sendFilesModal.noConnections') }}</p>
        </div>
        <div
          v-else-if="!filteredGroups.length"
          class="flex h-24 flex-col items-center justify-center text-text-secondary"
        >
          <i class="fas fa-search mb-2 text-2xl" aria-hidden="true"></i>
          <p>{{ t('sendFilesModal.noConnectionsFound') }}</p>
        </div>
        <div v-else class="space-y-3">
          <section v-for="group in filteredGroups" :key="group.id">
            <div class="group flex cursor-pointer items-center py-1.5" @click="toggleGroupExpansion(group)">
              <input
                :id="'send-files-group-' + group.id"
                type="checkbox"
                class="mr-1.5 h-4 w-4 cursor-pointer rounded border-border accent-primary focus:ring-primary"
                :checked="isGroupSelected(group)"
                :indeterminate="isGroupIndeterminate(group)"
                @change="toggleGroup(group)"
                @click.stop
              />
              <i
                :class="[
                  'fas mr-2 w-3 text-center text-xs text-text-secondary/80 transition-transform duration-150 group-hover:text-text-secondary',
                  isGroupExpanded(group) ? 'fa-chevron-down' : 'fa-chevron-right',
                ]"
                aria-hidden="true"
              ></i>
              <label
                :for="'send-files-group-' + group.id"
                class="cursor-pointer select-none text-sm font-semibold text-foreground"
                @click.stop
                >{{ group.name }} ({{ group.connections.length }})</label
              >
            </div>
            <ul v-show="isGroupExpanded(group)" class="space-y-0.5 pl-7">
              <li
                v-for="connection in group.connections"
                :key="connection.id"
                class="flex cursor-pointer items-center rounded-md p-2.5 transition-colors duration-150 hover:bg-primary/10"
                :class="selected.has(connection.id) ? 'bg-primary/20' : ''"
                @click="toggle(connection.id)"
              >
                <input
                  :id="'send-files-connection-' + connection.id"
                  type="checkbox"
                  class="mr-3 h-4 w-4 rounded border-border accent-primary focus:ring-primary"
                  :checked="selected.has(connection.id)"
                  @change="toggle(connection.id)"
                  @click.stop
                />
                <i class="fas fa-server mr-2.5 w-4 text-center text-text-secondary" aria-hidden="true"></i>
                <span class="min-w-0 flex-grow">
                  <span class="block truncate text-sm" :title="connection.name || connection.host">{{
                    connection.name || connection.host
                  }}</span>
                  <span class="block truncate text-[11px] text-text-secondary"
                    >{{ connection.username }}@{{ connection.host }}:{{ connection.port }}</span
                  >
                </span>
              </li>
            </ul>
          </section>
        </div>
      </section>

      <section class="space-y-1 rounded-md border border-border bg-header/30 p-3">
        <h3 class="text-sm font-semibold text-foreground">{{ t('sendFilesModal.itemsToSendTitle') }}</h3>
        <ul v-if="items.length" class="max-h-24 space-y-0.5 overflow-y-auto">
          <li v-for="item in items" :key="item.path" class="truncate text-xs text-text-secondary" :title="item.path">
            {{ item.name }}
          </li>
        </ul>
        <p v-else class="text-xs italic text-text-secondary">{{ t('sendFilesModal.noItemsSelected') }}</p>
      </section>

      <p v-if="error" class="rounded-md bg-error/10 p-2 text-sm text-error" role="alert">{{ error }}</p>
    </div>

    <div class="mt-auto flex shrink-0 items-center justify-end gap-3 border-t border-border pt-4">
      <button
        type="button"
        class="rounded-md border border-border bg-transparent px-4 py-2 text-text-secondary shadow-sm transition-colors hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        :disabled="transferLoading"
        @click="emit('close')"
      >
        {{ t('sendFilesModal.cancelButton') }}
      </button>
      <button
        type="button"
        class="rounded-md bg-button px-4 py-2 text-button-text shadow-sm transition hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="transferLoading || !items.length || !selected.size || !targetPath.trim()"
        @click="submit"
      >
        <i v-if="transferLoading" class="fas fa-spinner fa-spin mr-1" aria-hidden="true"></i
        >{{ t('sendFilesModal.sendButton') }}
      </button>
    </div>
  </OverlayPanel>
</template>
