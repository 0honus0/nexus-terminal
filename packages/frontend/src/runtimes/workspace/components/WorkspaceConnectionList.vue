<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseContextMenu, BaseSpinner } from '@/foundation/ui';
  import { ConnectionEditorModal, useConnections, type Connection } from '@/features/connections/public';
  import { useConnectionTags, type ConnectionTag } from '@/features/tags/public';
  import { useFeedback } from '@/shared/feedback/public';
  import WorkspaceTagGroupManager from './WorkspaceTagGroupManager.vue';
  import { focusRegistry } from '@/shared/focus/public';
  const props = withDefaults(defineProps<{ showTags?: boolean; activeConnectionId?: number | null }>(), {
    showTags: true,
    activeConnectionId: null,
  });
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
  <section
    ref="root"
    data-testid="workspace-connection-list"
    class="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
  >
    <div class="flex border-b border-border/50 p-2">
      <input
        ref="searchInput"
        v-model="search"
        data-focus-id="connectionListSearch"
        type="text"
        :placeholder="t('workspaceConnectionList.searchPlaceholder')"
        class="min-w-0 flex-1 rounded-lg border border-border/50 bg-input px-4 py-1.5 text-sm text-foreground shadow-sm transition duration-150 ease-in-out focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        @keydown="handleSearchKeydown"
      />
      <button
        type="button"
        class="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-0 bg-primary text-sm font-semibold text-white shadow-md transition-colors duration-200 hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        :title="t('connections.addConnection')"
        :aria-label="t('connections.addConnection')"
        @click="addConnection"
      >
        <i class="fas fa-plus" aria-hidden="true"></i>
      </button>
    </div>

    <div v-if="loading" class="flex h-full items-center justify-center text-text-secondary">
      <i class="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>{{ t('common.loading') }}
    </div>
    <div v-else-if="loadError" class="flex h-full items-center justify-center px-4 text-center text-error">
      <i class="fas fa-exclamation-triangle mr-2" aria-hidden="true"></i>{{ loadError }}
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto p-2">
      <div
        v-if="data.connections.value.length && !filtered.length && search"
        class="p-6 text-center text-text-secondary"
      >
        <i class="fas fa-search mb-2 text-xl" aria-hidden="true"></i>
        <p>{{ t('workspaceConnectionList.noResults', { searchTerm: search }) }}</p>
      </div>
      <div v-else-if="!data.connections.value.length" class="p-6 text-center text-text-secondary">
        <i class="fas fa-plug mb-2 text-xl" aria-hidden="true"></i>
        <p>{{ t('connections.noConnections') }}</p>
        <button
          type="button"
          class="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          @click="addConnection"
        >
          {{ t('connections.addFirstConnection') }}
        </button>
      </div>

      <template v-else-if="showTags">
        <section v-for="group in groups" :key="group.key" class="mb-1 last:mb-0">
          <header
            class="group flex cursor-pointer items-center rounded-md px-3 py-2 font-semibold text-foreground transition-colors duration-150 hover:bg-header/80"
            @click="toggleGroup(group.key)"
          >
            <i
              :class="['fas', isExpanded(group.key) ? 'fa-chevron-down' : 'fa-chevron-right']"
              class="mr-2 w-4 shrink-0 cursor-pointer text-center text-text-secondary transition-transform duration-200 ease-in-out group-hover:text-foreground"
              aria-hidden="true"
            ></i>
            <span class="inline-block min-w-0 truncate text-sm" :title="group.name">{{ group.name }}</span>
            <span class="ml-1 text-xs font-normal text-text-secondary">({{ group.connections.length }})</span>
            <div class="min-w-0 flex-1"></div>
            <button
              v-if="group.connections.some((connection) => connection.type === 'SSH')"
              type="button"
              class="ml-1 flex h-6 items-center justify-center rounded px-1 text-text-secondary opacity-0 transition-all duration-150 hover:bg-black/10 hover:text-primary group-hover:opacity-100 focus:opacity-100 focus:outline-none"
              :title="t('workspaceConnectionList.connectAllSshInGroupMenu')"
              @click.stop="connectGroup(group.connections)"
            >
              <i class="fas fa-network-wired fa-xs" aria-hidden="true"></i>
            </button>
            <button
              v-if="group.tagId !== null"
              type="button"
              class="ml-1 flex h-6 items-center justify-center rounded px-1 text-text-secondary opacity-0 transition-all duration-150 hover:bg-black/10 hover:text-primary group-hover:opacity-100 focus:opacity-100 focus:outline-none"
              :title="t('workspaceConnectionList.manageTags.menuItem')"
              @click.stop="manageGroup(group.tagId)"
            >
              <i class="fas fa-edit fa-xs" aria-hidden="true"></i>
            </button>
            <button
              v-if="group.tagId !== null && group.connections.length"
              type="button"
              class="ml-1 flex h-6 items-center justify-center rounded px-1 text-error/80 opacity-0 transition-all duration-150 hover:bg-error/10 hover:text-error group-hover:opacity-100 focus:opacity-100 focus:outline-none"
              :title="t('workspaceConnectionList.deleteAllConnectionsInGroupMenu')"
              @click.stop="deleteGroupConnections(group)"
            >
              <i class="fas fa-trash-alt fa-xs" aria-hidden="true"></i>
            </button>
          </header>

          <ul v-show="isExpanded(group.key)" class="m-0 list-none p-0 pl-3">
            <li
              v-for="connection in group.connections"
              :key="connection.id"
              :data-connection-id="connection.id"
              class="group my-0.5 flex cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-md py-2 pl-4 pr-3 text-ellipsis text-foreground transition-colors duration-150 hover:bg-primary/10"
              :class="{
                'bg-primary/20 font-medium': connection.id === props.activeConnectionId,
                'ring-1 ring-inset ring-primary/40': connection.id === highlightedId,
              }"
              @click.left="emit('open', connection)"
              @contextmenu.prevent="openContext($event, connection)"
            >
              <i
                :class="[
                  'fas',
                  connection.type === 'RDP' ? 'fa-desktop' : connection.type === 'VNC' ? 'fa-chalkboard' : 'fa-server',
                ]"
                class="mr-2.5 w-4 shrink-0 text-center text-text-secondary group-hover:text-primary"
                aria-hidden="true"
              ></i>
              <span class="min-w-0 flex-1 truncate text-sm" :title="connection.name || connection.host">
                {{ connection.name || connection.host }}
              </span>
            </li>
          </ul>
        </section>
      </template>

      <ul v-else class="m-0 list-none p-0">
        <li
          v-for="connection in filtered"
          :key="connection.id"
          :data-connection-id="connection.id"
          class="group my-0.5 flex cursor-pointer items-center overflow-hidden whitespace-nowrap rounded-md py-2 pl-4 pr-3 text-ellipsis text-foreground transition-colors duration-150 hover:bg-primary/10"
          :class="{
            'bg-primary/20 font-medium': connection.id === props.activeConnectionId,
            'ring-1 ring-inset ring-primary/40': connection.id === highlightedId,
          }"
          @click.left="emit('open', connection)"
          @contextmenu.prevent="openContext($event, connection)"
        >
          <i
            :class="[
              'fas',
              connection.type === 'RDP' ? 'fa-desktop' : connection.type === 'VNC' ? 'fa-chalkboard' : 'fa-server',
            ]"
            class="mr-2.5 w-4 shrink-0 text-center text-text-secondary group-hover:text-primary"
            aria-hidden="true"
          ></i>
          <span class="min-w-0 flex-1 truncate text-sm" :title="connection.name || connection.host">
            {{ connection.name || connection.host }}
          </span>
        </li>
      </ul>
    </div>

    <BaseContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="190" @close="context = null">
      <button class="context-item" @click="addConnection">
        <i class="fas fa-plus" aria-hidden="true"></i><span>{{ t('connections.addConnection') }}</span>
      </button>
      <button class="context-item" @click="editConnection(context.connection)">
        <i class="fas fa-edit" aria-hidden="true"></i><span>{{ t('connections.actions.edit') }}</span>
      </button>
      <button class="context-item" @click="cloneConnection(context.connection)">
        <i class="fas fa-clone" aria-hidden="true"></i><span>{{ t('connections.actions.clone') }}</span>
      </button>
      <button class="context-item text-error" @click="deleteConnection(context.connection)">
        <i class="fas fa-trash-alt" aria-hidden="true"></i><span>{{ t('connections.actions.delete') }}</span>
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
    display: flex;
    width: calc(100% - 0.5rem);
    margin-inline: 0.25rem;
    align-items: center;
    gap: 0.75rem;
    border-radius: 0.375rem;
    padding: 0.4rem 0.75rem;
    text-align: left;
    font-size: 0.875rem;
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .context-item i {
    width: 1rem;
    text-align: center;
    color: var(--text-secondary-color);
  }
  .context-item:hover,
  .context-item:focus-visible {
    background: color-mix(in srgb, var(--primary-color) 10%, transparent);
    color: var(--primary-color);
    outline: none;
  }
  .context-item.text-error i {
    color: currentColor;
  }
</style>
