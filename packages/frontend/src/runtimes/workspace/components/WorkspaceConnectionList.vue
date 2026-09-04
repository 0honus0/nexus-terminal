<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseContextMenu, BaseInput, BaseSpinner } from '@/foundation/ui';
  import { ConnectionEditorModal, useConnections, type Connection } from '@/features/connections/public';
  import { useConnectionTags, type ConnectionTag } from '@/features/tags/public';
  import { useFeedback } from '@/shared/feedback/public';
  import WorkspaceTagGroupManager from './WorkspaceTagGroupManager.vue';
  import { focusRegistry } from '@/shared/focus/public';
  const props = withDefaults(defineProps<{ showTags?: boolean }>(), { showTags: true });
  const emit = defineEmits<{ open: [connection: Connection]; openMany: [connections: Connection[]] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const data = useConnections();
  const tags = useConnectionTags();
  const root = ref<HTMLElement | null>(null);
  const searchInput = ref<{ focus?: () => void } | null>(null);
  const search = ref('');
  const highlightedId = ref<number | null>(null);
  const managerTag = ref<ConnectionTag | null>(null);
  const editorVisible = ref(false);
  const editorConnection = ref<Connection | null>(null);
  const context = ref<{ connection: Connection; x: number; y: number } | null>(null);
  const GROUPS_KEY = 'nexus.workspace.connectionGroups';
  const expanded = ref<Record<string, boolean>>({});
  try {
    expanded.value = JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}') as Record<string, boolean>;
  } catch {
    expanded.value = {};
  }
  let unregisterFocus: (() => void) | undefined;
  const loading = ref(true);
  const loadError = ref('');
  const load = async (): Promise<void> => {
    loading.value = true;
    loadError.value = '';
    try {
      await data.load();
      if (props.showTags) await tags.load();
    } catch (cause) {
      loadError.value = cause instanceof Error ? cause.message : t('workspaceConnectionList.loadFailed');
    } finally {
      loading.value = false;
    }
  };
  onMounted(() => {
    unregisterFocus = focusRegistry.register(
      'connectionListSearch',
      () => {
        searchInput.value?.focus?.();
        return true;
      },
      () => Boolean(root.value?.getClientRects().length),
    );
    void load();
  });
  onBeforeUnmount(() => unregisterFocus?.());
  watch(
    () => props.showTags,
    (value) => {
      if (value) void tags.load();
    },
  );
  const tagMap = computed(() => new Map(tags.tags.value.map((tag) => [tag.id, tag.name])));
  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase();
    return data.connections.value.filter(
      (connection) =>
        !q ||
        `${connection.name ?? ''} ${connection.host} ${connection.username} ${connection.tagIds.map((id) => tagMap.value.get(id) ?? '').join(' ')}`
          .toLowerCase()
          .includes(q),
    );
  });
  const groups = computed(() => {
    const result = new Map<number, Connection[]>();
    const untagged: Connection[] = [];
    for (const connection of filtered.value) {
      const ids = connection.tagIds.filter((id) => tagMap.value.has(id));
      if (!ids.length) untagged.push(connection);
      else for (const id of ids) result.set(id, [...(result.get(id) ?? []), connection]);
    }
    const tagged: Array<{ key: string; tagId: number | null; name: string; connections: Connection[] }> = [
      ...result.entries(),
    ].map(([tagId, connections]) => ({
      key: String(tagId),
      tagId,
      name: tagMap.value.get(tagId) ?? String(tagId),
      connections,
    }));
    if (untagged.length)
      tagged.push({ key: 'untagged', tagId: null, name: t('workspaceConnectionList.untagged'), connections: untagged });
    return tagged;
  });
  const isExpanded = (key: string) => expanded.value[key] !== false;
  const visibleConnections = computed(() => {
    const source = props.showTags
      ? groups.value.flatMap((group) => (isExpanded(group.key) ? group.connections : []))
      : filtered.value;
    const seen = new Set<number>();
    return source.filter((connection) => {
      if (seen.has(connection.id)) return false;
      seen.add(connection.id);
      return true;
    });
  });
  const scrollHighlightedIntoView = async () => {
    await nextTick();
    if (highlightedId.value === null) return;
    root.value
      ?.querySelector<HTMLElement>(`[data-connection-id="${highlightedId.value}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const moveHighlight = (delta: 1 | -1) => {
    const list = visibleConnections.value;
    if (!list.length) return;
    const current =
      highlightedId.value === null ? -1 : list.findIndex((connection) => connection.id === highlightedId.value);
    const next = current < 0 ? (delta > 0 ? 0 : list.length - 1) : (current + delta + list.length) % list.length;
    highlightedId.value = list[next]!.id;
    void scrollHighlightedIntoView();
  };
  const handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && highlightedId.value !== null) {
      const connection = visibleConnections.value.find((item) => item.id === highlightedId.value);
      if (connection) {
        event.preventDefault();
        emit('open', connection);
      }
      return;
    }
    if (event.key === 'Escape') highlightedId.value = null;
  };
  watch(search, () => {
    highlightedId.value = null;
  });
  watch(visibleConnections, (list) => {
    if (highlightedId.value !== null && !list.some((connection) => connection.id === highlightedId.value))
      highlightedId.value = null;
  });
  const toggleGroup = (key: string) => {
    expanded.value = { ...expanded.value, [key]: !isExpanded(key) };
    localStorage.setItem(GROUPS_KEY, JSON.stringify(expanded.value));
  };
  const connectGroup = (connections: Connection[]) => {
    const ssh = connections.filter((connection) => connection.type === 'SSH');
    if (ssh.length) emit('openMany', ssh);
  };
  const manageGroup = (tagId: number | null) => {
    if (tagId === null) return;
    managerTag.value = tags.tags.value.find((tag) => tag.id === tagId) ?? null;
  };
  const addConnection = () => {
    editorConnection.value = null;
    editorVisible.value = true;
  };
  const editConnection = (connection: Connection) => {
    context.value = null;
    editorConnection.value = connection;
    editorVisible.value = true;
  };
  const cloneConnection = async (connection: Connection) => {
    context.value = null;
    try {
      await data.clone(connection.id, t('connections.cloneName', { name: connection.name || connection.host }));
    } catch (cause) {
      feedback.notifyError(
        t('connections.errors.cloneFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
  const deleteConnection = async (connection: Connection) => {
    context.value = null;
    if (
      !(await feedback.confirm({
        message: t('connections.prompts.confirmDelete', { name: connection.name || connection.host }),
        destructive: true,
      }))
    )
      return;
    try {
      await data.remove(connection.id);
    } catch (cause) {
      feedback.notifyError(
        t('connections.errors.deleteFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    }
  };
  const openContext = (event: MouseEvent, connection: Connection) => {
    context.value = { connection, x: event.clientX, y: event.clientY };
  };
  const deleteGroupConnections = async (group: { tagId: number | null; name: string; connections: Connection[] }) => {
    if (group.tagId === null || !group.connections.length) return;
    if (
      !(await feedback.confirm({
        message: t('workspaceConnectionList.confirmDeleteAllConnectionsInGroup', {
          count: group.connections.length,
          groupName: group.name,
        }),
        destructive: true,
      }))
    )
      return;
    const results = await Promise.allSettled(group.connections.map((connection) => data.remove(connection.id)));
    const succeeded = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    if (succeeded > 0)
      feedback.notifySuccess(
        t('workspaceConnectionList.allConnectionsInGroupDeletedSuccess', { count: succeeded, groupName: group.name }),
      );
    if (failed > 0)
      feedback.notifyError(
        t('workspaceConnectionList.someConnectionsInGroupDeleteFailed', { count: failed, groupName: group.name }),
      );
    await data.load(true);
  };
</script>
<template>
  <section ref="root" data-testid="workspace-connection-list" class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex gap-2 border-b border-border p-2">
      <BaseInput
        ref="searchInput"
        v-model="search"
        data-focus-id="connectionListSearch"
        class="min-w-0 flex-1"
        :placeholder="t('workspaceConnectionList.searchPlaceholder')"
        @keydown="handleSearchKeydown"
      />
      <BaseButton size="sm" variant="primary" :title="t('connections.addConnection')" @click="addConnection"
        >+</BaseButton
      >
    </div>
    <BaseSpinner v-if="loading" class="m-4" />
    <p v-else-if="loadError" class="p-4 text-sm text-error">{{ loadError }}</p>
    <p v-else-if="!data.connections.value.length" class="p-4 text-sm text-text-secondary">
      {{ t('connections.noConnections') }}
    </p>
    <p v-else-if="!filtered.length" class="p-4 text-sm text-text-secondary">
      {{ t('workspaceConnectionList.noResults', { searchTerm: search }) }}
    </p>
    <div v-else class="min-h-0 flex-1 overflow-auto">
      <template v-if="showTags"
        ><section v-for="group in groups" :key="group.key" class="border-b border-border">
          <header class="flex items-center gap-1 bg-header/50 px-2 py-1 text-xs font-semibold text-text-secondary">
            <button type="button" class="min-w-0 flex-1 truncate text-left" @click="toggleGroup(group.key)">
              {{ isExpanded(group.key) ? '▾' : '▸' }} {{ group.name }} ({{ group.connections.length }})
            </button>
            <BaseButton
              v-if="group.connections.some((connection) => connection.type === 'SSH')"
              size="sm"
              variant="ghost"
              :title="t('workspaceConnectionList.connectAllSshInGroupMenu')"
              @click="connectGroup(group.connections)"
              >⇉</BaseButton
            >
            <BaseButton
              v-if="group.tagId !== null"
              size="sm"
              variant="ghost"
              :title="t('workspaceConnectionList.manageTags.menuItem')"
              @click="manageGroup(group.tagId)"
              >✎</BaseButton
            >
            <BaseButton
              v-if="group.tagId !== null && group.connections.length"
              size="sm"
              variant="ghost"
              :title="t('workspaceConnectionList.deleteAllConnectionsInGroupMenu')"
              @click="deleteGroupConnections(group)"
              >×</BaseButton
            >
          </header>
          <ul v-show="isExpanded(group.key)" class="divide-y divide-border">
            <li
              v-for="connection in group.connections"
              :key="connection.id"
              :data-connection-id="connection.id"
              class="flex items-center gap-2 p-2"
              :class="highlightedId === connection.id ? 'bg-primary/10' : ''"
              @contextmenu.prevent="openContext($event, connection)"
            >
              <button class="min-w-0 flex-1 text-left" type="button" @click="emit('open', connection)">
                <span class="block truncate text-sm font-medium">{{ connection.name || connection.host }}</span
                ><span class="block truncate text-xs text-text-secondary"
                  >{{ connection.type }} · {{ connection.username }}@{{ connection.host }}</span
                ></button
              ><BaseButton size="sm" @click="emit('open', connection)">{{ t('common.open') }}</BaseButton>
            </li>
          </ul>
        </section></template
      >
      <ul v-else class="divide-y divide-border">
        <li
          v-for="connection in filtered"
          :key="connection.id"
          :data-connection-id="connection.id"
          class="flex items-center gap-2 p-2"
          :class="highlightedId === connection.id ? 'bg-primary/10' : ''"
          @contextmenu.prevent="openContext($event, connection)"
        >
          <button class="min-w-0 flex-1 text-left" type="button" @click="emit('open', connection)">
            <span class="block truncate text-sm font-medium">{{ connection.name || connection.host }}</span
            ><span class="block truncate text-xs text-text-secondary"
              >{{ connection.type }} · {{ connection.username }}@{{ connection.host }}</span
            ></button
          ><BaseButton size="sm" @click="emit('open', connection)">{{ t('common.open') }}</BaseButton>
        </li>
      </ul>
    </div>
    <BaseContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="200" @close="context = null">
      <button
        class="context-item"
        @click="
          emit('open', context.connection);
          context = null;
        "
      >
        {{ t('common.open') }}
      </button>
      <button class="context-item" @click="editConnection(context.connection)">
        {{ t('connections.actions.edit') }}
      </button>
      <button class="context-item" @click="cloneConnection(context.connection)">
        {{ t('connections.actions.clone') }}
      </button>
      <button class="context-item text-error" @click="deleteConnection(context.connection)">
        {{ t('connections.actions.delete') }}
      </button>
    </BaseContextMenu>
    <ConnectionEditorModal
      :visible="editorVisible"
      :connection="editorConnection"
      @close="
        editorVisible = false;
        editorConnection = null;
      "
    />
    <WorkspaceTagGroupManager
      :visible="Boolean(managerTag)"
      :tag="managerTag"
      :connections="data.connections.value"
      @close="managerTag = null"
      @changed="load"
    />
  </section>
</template>

<style scoped>
  .context-item {
    display: block;
    width: 100%;
    border-radius: 0.25rem;
    padding: 0.4rem 0.55rem;
    text-align: left;
  }
  .context-item:hover {
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  }
</style>
