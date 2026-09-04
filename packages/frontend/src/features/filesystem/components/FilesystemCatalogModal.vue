<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseFormField, BaseInput, BaseModal, BaseTabs } from '@/foundation/ui';
  import { writeClipboardText } from '@/foundation/browser';
  import { useFeedback } from '@/shared/feedback/public';
  import { useFilesystemCatalog } from '../composables/useFilesystemCatalog';
  import type { FavoritePath } from '../model/catalog';

  const props = defineProps<{ visible: boolean; currentPath: string }>();
  const emit = defineEmits<{ close: []; navigate: [path: string]; terminal: [path: string] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const catalog = useFilesystemCatalog();
  const tab = ref<'favorites' | 'history'>('favorites');
  const editing = ref<FavoritePath | null>(null);
  const formVisible = ref(false);
  const form = reactive({ name: '', path: '' });
  const tabs = computed(() => [
    { value: 'favorites' as const, label: t('favoritePaths.title') },
    { value: 'history' as const, label: t('pathHistory.title') },
  ]);

  onMounted(() => {
    void Promise.allSettled([catalog.loadFavorites(), catalog.loadHistory()]);
  });

  const openAdd = () => {
    editing.value = null;
    form.name = '';
    form.path = props.currentPath;
    formVisible.value = true;
  };
  const openEdit = (item: FavoritePath) => {
    editing.value = item;
    form.name = item.name ?? '';
    form.path = item.path;
    formVisible.value = true;
  };
  const save = async () => {
    const path = form.path.trim();
    if (!path) return;
    try {
      await catalog.saveFavorite({ id: editing.value?.id, path, name: form.name });
      feedback.notifySuccess(
        t(editing.value ? 'favoritePaths.notifications.updateSuccess' : 'favoritePaths.notifications.addSuccess'),
      );
      formVisible.value = false;
    } catch (cause) {
      feedback.notifyError(
        cause instanceof Error ? cause.message : t('favoritePaths.addEditForm.errors.genericSaveError'),
      );
    }
  };
  const removeFavorite = async (item: FavoritePath) => {
    if (
      !(await feedback.confirm({
        message: t('favoritePaths.confirmDelete', { name: item.name || item.path }),
        destructive: true,
      }))
    )
      return;
    try {
      await catalog.removeFavorite(item.id);
      feedback.notifySuccess(t('favoritePaths.notifications.deleteSuccess'));
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : t('favoritePaths.notifications.deleteError'));
    }
  };
  const navigateFavorite = async (item: FavoritePath) => {
    try {
      await catalog.useFavorite(item);
    } catch {
      feedback.notifyError(t('favoritePaths.notifications.markAsUsedError'));
    }
    emit('navigate', item.path);
    emit('close');
  };
  const copy = async (path: string) => {
    try {
      await writeClipboardText(path);
      feedback.notifySuccess(t('pathHistory.copiedSuccess'));
    } catch {
      feedback.notifyError(t('pathHistory.copiedError'));
    }
  };
</script>

<template>
  <BaseModal :visible="visible" panel-class="w-[min(720px,94vw)]" @close="emit('close')">
    <div class="flex min-h-0 max-h-[70vh] flex-col gap-3">
      <BaseTabs v-model="tab" :items="tabs" />
      <template v-if="tab === 'favorites'">
        <div class="flex gap-2">
          <BaseInput v-model="catalog.favoriteSearch.value" :placeholder="t('favoritePaths.searchPlaceholder')" />
          <BaseButton @click="catalog.setFavoriteSort(catalog.favoriteSort.value === 'name' ? 'lastUsedAt' : 'name')"
            >⇅</BaseButton
          >
          <BaseButton variant="primary" @click="openAdd">{{ t('favoritePaths.addNew') }}</BaseButton>
        </div>
        <p v-if="catalog.loadingFavorites.value" class="p-3 text-center text-text-secondary">
          {{ t('favoritePaths.loading') }}
        </p>
        <ul v-else class="min-h-0 flex-1 divide-y divide-border overflow-auto rounded border border-border">
          <li v-for="item in catalog.filteredFavorites.value" :key="item.id" class="flex items-center gap-2 p-3">
            <button class="min-w-0 flex-1 text-left" @click="navigateFavorite(item)">
              <strong class="block truncate">{{ item.name || item.path }}</strong>
              <span v-if="item.name" class="block truncate text-xs text-text-secondary">{{ item.path }}</span>
            </button>
            <BaseButton size="sm" @click="emit('terminal', item.path)">⌘</BaseButton>
            <BaseButton size="sm" @click="openEdit(item)">{{ t('common.edit') }}</BaseButton>
            <BaseButton size="sm" variant="danger" @click="removeFavorite(item)">{{ t('common.delete') }}</BaseButton>
          </li>
          <li v-if="!catalog.filteredFavorites.value.length" class="p-5 text-center text-sm text-text-secondary">
            {{ catalog.favoriteSearch.value ? t('favoritePaths.noResults') : t('favoritePaths.noFavorites') }}
          </li>
        </ul>
      </template>
      <template v-else>
        <div class="flex gap-2">
          <BaseInput v-model="catalog.historySearch.value" :placeholder="t('favoritePaths.searchPlaceholder')" />
          <BaseButton variant="danger" :disabled="!catalog.history.value.length" @click="catalog.clearHistory">{{
            t('common.clear')
          }}</BaseButton>
        </div>
        <p v-if="catalog.loadingHistory.value" class="p-3 text-center text-text-secondary">
          {{ t('pathHistory.loading') }}
        </p>
        <ul v-else class="min-h-0 flex-1 divide-y divide-border overflow-auto rounded border border-border">
          <li v-for="item in catalog.filteredHistory.value" :key="item.id" class="flex items-center gap-2 p-2">
            <button
              class="min-w-0 flex-1 truncate text-left font-mono text-sm"
              @click="
                emit('navigate', item.path);
                emit('close');
              "
            >
              {{ item.path }}
            </button>
            <BaseButton size="sm" @click="copy(item.path)">{{ t('pathHistory.copy') }}</BaseButton>
            <BaseButton size="sm" variant="danger" @click="catalog.removeHistory(item.id)">{{
              t('pathHistory.delete')
            }}</BaseButton>
          </li>
          <li v-if="!catalog.filteredHistory.value.length" class="p-5 text-center text-sm text-text-secondary">
            {{ t('pathHistory.empty') }}
          </li>
        </ul>
      </template>
    </div>
  </BaseModal>

  <BaseModal
    :visible="formVisible"
    :title="t(editing ? 'favoritePaths.addEditForm.editTitle' : 'favoritePaths.addEditForm.addTitle')"
    @close="formVisible = false"
  >
    <form class="space-y-4" @submit.prevent="save">
      <BaseFormField :label="t('favoritePaths.addEditForm.pathLabel')"><BaseInput v-model="form.path" /></BaseFormField>
      <BaseFormField :label="t('favoritePaths.addEditForm.nameLabel')"><BaseInput v-model="form.name" /></BaseFormField>
      <div class="flex justify-end gap-2">
        <BaseButton type="button" @click="formVisible = false">{{ t('common.cancel') }}</BaseButton
        ><BaseButton type="submit" variant="primary">{{ t('common.save') }}</BaseButton>
      </div>
    </form>
  </BaseModal>
</template>
