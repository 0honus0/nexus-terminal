<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseInput, BaseModal } from '@/foundation/ui';
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

  const filtered = computed(() => {
    const q = search.value.trim().toLocaleLowerCase();
    return props.connections.filter(
      (connection) =>
        !q || `${connection.name ?? ''} ${connection.username} ${connection.host}`.toLocaleLowerCase().includes(q),
    );
  });

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
  <BaseModal :visible="visible" :title="t('workspaceConnectionList.manageTags.title')" @close="emit('close')">
    <div v-if="tag" class="space-y-4">
      <BaseInput v-model="name" :aria-label="t('workspaceConnectionList.manageTags.tagName')" />
      <BaseInput v-model="search" :placeholder="t('workspaceConnectionList.manageTags.searchPlaceholder')" />
      <div class="flex flex-wrap gap-2">
        <BaseButton size="sm" @click="selectVisible">{{
          t('workspaceConnectionList.manageTags.selectAll')
        }}</BaseButton>
        <BaseButton size="sm" @click="deselectVisible">{{
          t('workspaceConnectionList.manageTags.deselectAll')
        }}</BaseButton>
        <BaseButton size="sm" @click="invertVisible">{{
          t('workspaceConnectionList.manageTags.invertSelection')
        }}</BaseButton>
      </div>
      <ul class="max-h-80 divide-y divide-border overflow-auto rounded border border-border">
        <li v-for="connection in filtered" :key="connection.id" class="flex items-center gap-3 p-2">
          <BaseCheckbox :model-value="selected.has(connection.id)" @update:model-value="toggle(connection.id)" />
          <button type="button" class="min-w-0 flex-1 text-left" @click="toggle(connection.id)">
            <span class="block truncate text-sm font-medium">{{ connection.name || connection.host }}</span>
            <span class="block truncate text-xs text-text-secondary"
              >{{ connection.username }}@{{ connection.host }}</span
            >
          </button>
        </li>
        <li v-if="!filtered.length" class="p-5 text-center text-sm text-text-secondary">
          {{ t('workspaceConnectionList.manageTags.noConnectionsFound') }}
        </li>
      </ul>
      <div class="flex justify-between gap-2">
        <BaseButton variant="danger" @click="removeTag">{{ t('common.delete') }}</BaseButton>
        <div class="flex gap-2">
          <BaseButton @click="emit('close')">{{ t('common.cancel') }}</BaseButton>
          <BaseButton variant="primary" :loading="saving" @click="save">{{ t('common.save') }}</BaseButton>
        </div>
      </div>
    </div>
  </BaseModal>
</template>
