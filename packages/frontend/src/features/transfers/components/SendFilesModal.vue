<script setup lang="ts">
  import { computed, onMounted, ref, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import {
    BaseButton,
    BaseCheckbox,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseSelect,
    BaseSpinner,
  } from '@/foundation/ui';
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
  const targetPath = ref('/');
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
      targetPath.value = props.initialTargetPath?.trim() || '/';
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
  <BaseModal :visible="visible" :title="t('sendFilesModal.title')" :z-index="70" @close="emit('close')">
    <div class="space-y-4">
      <section>
        <h3 class="mb-2 text-sm font-semibold">{{ t('sendFilesModal.itemsToSendTitle') }}</h3>
        <ul v-if="items.length" class="max-h-28 space-y-1 overflow-auto rounded border border-border p-2 text-xs">
          <li v-for="item in items" :key="item.path" class="truncate" :title="item.path">
            {{ item.name }} · {{ item.path }}
          </li>
        </ul>
        <p v-else class="text-sm text-text-secondary">{{ t('sendFilesModal.noItemsSelected') }}</p>
      </section>

      <BaseFormField :label="t('sendFilesModal.targetPathLabel')">
        <BaseInput v-model="targetPath" :placeholder="t('sendFilesModal.targetPathPlaceholder')" />
      </BaseFormField>
      <BaseFormField :label="t('sendFilesModal.transferMethodLabel')">
        <BaseSelect v-model="method">
          <option value="auto">{{ t('sendFilesModal.transferMethodAuto') }}</option>
          <option value="rsync">{{ t('sendFilesModal.methodRsync') }}</option>
          <option value="scp">{{ t('sendFilesModal.methodScp') }}</option>
        </BaseSelect>
      </BaseFormField>

      <div class="flex items-center gap-2">
        <BaseInput v-model="search" :placeholder="t('sendFilesModal.searchConnectionsPlaceholder')" />
        <BaseButton size="sm" variant="ghost" @click="selectVisible">{{ t('sendFilesModal.selectAll') }}</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="clear">{{ t('sendFilesModal.clearSelection') }}</BaseButton>
      </div>
      <BaseSpinner v-if="loadingOptions" />
      <p v-else-if="!sshConnections.length" class="text-sm text-text-secondary">
        {{ t('sendFilesModal.noConnections') }}
      </p>
      <p v-else-if="!filteredGroups.length" class="text-sm text-text-secondary">
        {{ t('sendFilesModal.noConnectionsFound') }}
      </p>
      <div v-else class="max-h-64 space-y-2 overflow-auto rounded border border-border p-2">
        <section v-for="group in filteredGroups" :key="group.id" class="rounded border border-border/70">
          <header class="flex items-center gap-2 bg-header/50 px-2 py-1.5">
            <BaseCheckbox
              :model-value="isGroupSelected(group)"
              :indeterminate="isGroupIndeterminate(group)"
              @update:model-value="toggleGroup(group)"
            />
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold"
              :aria-expanded="isGroupExpanded(group)"
              @click="toggleGroupExpansion(group)"
            >
              <span class="w-3 shrink-0 text-center text-xs text-text-secondary" aria-hidden="true">
                {{ isGroupExpanded(group) ? '▾' : '▸' }}
              </span>
              <span class="truncate">{{ group.name }} ({{ group.connections.length }})</span>
            </button>
          </header>
          <ul v-if="isGroupExpanded(group)" class="divide-y divide-border/70">
            <li v-for="connection in group.connections" :key="connection.id" class="flex items-center gap-3 p-2 pl-7">
              <BaseCheckbox :model-value="selected.has(connection.id)" @update:model-value="toggle(connection.id)" />
              <button type="button" class="min-w-0 flex-1 text-left" @click="toggle(connection.id)">
                <span class="block truncate text-sm font-medium">{{ connection.name || connection.host }}</span>
                <span class="block truncate text-xs text-text-secondary">
                  {{ connection.username }}@{{ connection.host }}:{{ connection.port }}
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>

      <p v-if="error" class="text-sm text-error">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <BaseButton @click="emit('close')">{{ t('sendFilesModal.cancelButton') }}</BaseButton>
        <BaseButton
          variant="primary"
          :loading="transferLoading"
          :disabled="!items.length || !selected.size || !targetPath.trim()"
          @click="submit"
          >{{ t('sendFilesModal.sendButton') }}</BaseButton
        >
      </div>
    </div>
  </BaseModal>
</template>
