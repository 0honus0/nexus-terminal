<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseInput, BaseModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { connectionTagsService, useConnectionTags, type ConnectionTag } from '@/features/tags/public';
  import { useConnections, type Connection } from '@/features/connections/public';

  const props = defineProps<{ visible: boolean; tag: ConnectionTag | null; connections: readonly Connection[] }>();
  const emit = defineEmits<{ close: []; changed: [] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const data = useConnections();
  const tags = useConnectionTags();
  const search = ref('');
  const selected = ref(new Set<number>());
  const name = ref('');
  const saving = ref(false);

  const modalTitle = computed(() =>
    props.tag
      ? `${t('workspaceConnectionList.manageTags.title')} - ${props.tag.name}`
      : t('workspaceConnectionList.manageTags.title'),
  );
  const filtered = computed(() => {
    const q = search.value.trim().toLocaleLowerCase();
    return props.connections
      .filter(
        (connection) =>
          !q || `${connection.name ?? ''} ${connection.username} ${connection.host}`.toLocaleLowerCase().includes(q),
      )
      .slice()
      .sort((a, b) => (a.name || a.host).localeCompare(b.name || b.host));
  });
  const protocolIcon = (connection: Connection): string => {
    if (connection.type === 'RDP') return 'fas fa-desktop';
    if (connection.type === 'VNC') return 'fas fa-plug';
    return 'fas fa-server';
  };

  watch(
    () => [props.visible, props.tag?.id] as const,
    ([visible]) => {
      if (!visible || !props.tag) return;
      search.value = '';
      name.value = props.tag.name;
      selected.value = new Set(
        props.connections
          .filter((connection) => connection.tagIds.includes(props.tag!.id))
          .map((connection) => connection.id),
      );
    },
  );

  const toggle = (id: number) => {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected.value = next;
  };
  const selectVisible = () => (selected.value = new Set([...selected.value, ...filtered.value.map((item) => item.id)]));
  const deselectVisible = () => {
    const visible = new Set(filtered.value.map((item) => item.id));
    selected.value = new Set([...selected.value].filter((id) => !visible.has(id)));
  };
  const invertVisible = () => {
    const next = new Set(selected.value);
    for (const connection of filtered.value) {
      if (next.has(connection.id)) next.delete(connection.id);
      else next.add(connection.id);
    }
    selected.value = next;
  };

  const save = async () => {
    if (!props.tag || saving.value) return;
    saving.value = true;
    try {
      const nextName = name.value.trim();
      if (nextName && nextName !== props.tag.name) await tags.rename(props.tag.id, nextName);
      await connectionTagsService.setConnections(props.tag.id, [...selected.value]);
      await data.load(true);
      emit('changed');
      emit('close');
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.value = false;
    }
  };

  const removeTag = async () => {
    if (!props.tag) return;
    if (
      !(await feedback.confirm({
        message: t('workspaceConnectionList.manageTags.confirmDeleteTag', { name: props.tag.name }),
        destructive: true,
      }))
    )
      return;
    try {
      await tags.remove(props.tag.id);
      await data.load(true);
      emit('changed');
      emit('close');
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
</script>

<template>
  <BaseModal
    :visible="visible"
    :title="modalTitle"
    panel-class="w-[min(672px,94vw)] max-h-[90dvh]"
    content-class="!py-0"
    @close="emit('close')"
  >
    <div v-if="tag" class="flex min-h-0 flex-col py-4">
      <div class="space-y-3 border-b border-border/50 px-4 pb-4">
        <label class="grid gap-1.5 text-sm text-text-secondary">
          <span>{{ t('workspaceConnectionList.manageTags.tagName') }}</span>
          <BaseInput v-model="name" :aria-label="t('workspaceConnectionList.manageTags.tagName')" />
        </label>

        <div class="flex items-center gap-2">
          <input
            v-model="search"
            type="text"
            :placeholder="t('workspaceConnectionList.manageTags.searchPlaceholder')"
            class="min-w-0 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button type="button" class="selection-action" @click="selectVisible">
            {{ t('workspaceConnectionList.manageTags.selectAll') }}
          </button>
          <button type="button" class="selection-action" @click="deselectVisible">
            {{ t('workspaceConnectionList.manageTags.deselectAll') }}
          </button>
          <button type="button" class="selection-action" @click="invertVisible">
            {{ t('workspaceConnectionList.manageTags.invertSelection') }}
          </button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4 pr-2">
        <div class="rounded-md border border-border bg-header/30 p-4">
          <ul v-if="filtered.length" class="m-0 list-none space-y-1 p-0">
            <li
              v-for="connection in filtered"
              :key="connection.id"
              class="flex cursor-pointer items-center rounded-md p-2.5 transition-colors duration-150 hover:bg-primary/10"
              :class="selected.has(connection.id) ? 'bg-primary/20' : ''"
              @click="toggle(connection.id)"
            >
              <input
                type="checkbox"
                class="mr-3 h-4 w-4 rounded border-border text-primary focus:ring-primary focus:ring-offset-0"
                :checked="selected.has(connection.id)"
                :aria-label="connection.name || connection.host"
                @change.stop="toggle(connection.id)"
                @click.stop
              />
              <i
                :class="[protocolIcon(connection), 'mr-2.5 w-4 shrink-0 text-center text-text-secondary']"
                aria-hidden="true"
              ></i>
              <span class="min-w-0 flex-1 truncate text-sm" :title="connection.name || connection.host">
                {{ connection.name || connection.host }}
              </span>
              <span class="ml-2 shrink-0 text-xs text-text-alt">({{ connection.type }})</span>
            </li>
          </ul>
          <div v-else class="flex min-h-40 flex-col items-center justify-center p-6 text-center text-text-secondary">
            <i class="fas fa-search mb-3 text-2xl" aria-hidden="true"></i>
            <p>{{ t('workspaceConnectionList.manageTags.noConnectionsFound') }}</p>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div v-if="tag" class="flex justify-end gap-3">
        <button type="button" class="footer-action footer-action--danger" @click="removeTag">
          {{ t('common.delete') }}
        </button>
        <button type="button" class="footer-action" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="button" class="footer-action footer-action--primary" :disabled="saving" @click="save">
          <i v-if="saving" class="fas fa-spinner fa-spin mr-1" aria-hidden="true"></i>{{ t('common.save') }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
  .selection-action,
  .footer-action {
    border: 1px solid var(--border-color);
    border-radius: 0.375rem;
    padding: 0.5rem 1rem;
    color: var(--text-secondary-color);
    font-size: 0.875rem;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease;
  }
  .selection-action:hover,
  .footer-action:hover:not(:disabled) {
    background: var(--border-color);
    color: var(--text-color);
  }
  .footer-action--danger {
    border-color: color-mix(in srgb, var(--error-color) 70%, transparent);
    color: var(--error-color);
  }
  .footer-action--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--error-color) 10%, transparent);
    color: var(--error-color);
  }
  .footer-action--primary {
    border-color: transparent;
    background: var(--button-bg-color);
    color: var(--button-text-color);
  }
  .footer-action--primary:hover:not(:disabled) {
    background: var(--button-hover-bg-color);
    color: var(--button-text-color);
  }
  .footer-action:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
</style>
