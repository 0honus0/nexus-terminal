<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  import { useDeviceCapabilities } from '@/foundation/browser/useDeviceCapabilities';
  import { useFeedback } from '@/shared/feedback/public';
  import { useFilesystemCatalog } from '../composables/useFilesystemCatalog';
  import type { FavoritePath } from '../model/catalog';

  const PADDING = 8;
  const props = defineProps<{
    visible: boolean;
    currentPath: string;
    triggerElement?: HTMLElement | null;
  }>();
  const emit = defineEmits<{ close: []; navigate: [path: string]; terminal: [path: string] }>();
  const { t } = useI18n();
  const device = useDeviceCapabilities();
  const feedback = useFeedback();
  const catalog = useFilesystemCatalog();
  const panel = ref<HTMLElement | null>(null);
  const panelStyle = ref<Record<string, string>>({});
  const editing = ref<FavoritePath | null>(null);
  const formVisible = ref(false);
  const saving = ref(false);
  const errorMessage = ref('');
  const form = reactive({ name: '', path: '' });
  const sortIcon = computed(() => (catalog.favoriteSort.value === 'name' ? 'fas fa-sort-alpha-down' : 'fas fa-clock'));

  const updatePosition = async (): Promise<void> => {
    if (!props.visible || !props.triggerElement) return;
    await nextTick();
    if (!panel.value) return;
    const trigger = props.triggerElement.getBoundingClientRect();
    const width = panel.value.offsetWidth;
    const height = panel.value.offsetHeight;
    let top = trigger.bottom + 2;
    let left = trigger.left;
    if (top + height + PADDING > window.innerHeight) top = trigger.top - height - 2;
    top = Math.max(PADDING, Math.min(top, window.innerHeight - height - PADDING));
    left = Math.max(PADDING, Math.min(left, window.innerWidth - width - PADDING));
    panelStyle.value = { top: `${top}px`, left: `${left}px` };
  };
  const handleOutsidePointer = (event: MouseEvent): void => {
    if (!props.visible || formVisible.value) return;
    const target = event.target as Node;
    if (props.triggerElement?.contains(target) || panel.value?.contains(target)) return;
    emit('close');
  };
  const attachPositioning = (): void => {
    document.addEventListener('mousedown', handleOutsidePointer);
    window.addEventListener('resize', updatePosition);
  };
  const detachPositioning = (): void => {
    document.removeEventListener('mousedown', handleOutsidePointer);
    window.removeEventListener('resize', updatePosition);
  };

  watch(
    () => props.visible,
    async (visible) => {
      detachPositioning();
      if (!visible) return;
      catalog.favoriteSearch.value = '';
      try {
        await catalog.loadFavorites();
      } catch {
        feedback.notifyError(t('favoritePaths.notifications.fetchError'));
      }
      attachPositioning();
      await updatePosition();
    },
    { immediate: true },
  );
  watch(
    () => [catalog.filteredFavorites.value.length, catalog.favoriteSort.value] as const,
    () => void updatePosition(),
  );
  onBeforeUnmount(detachPositioning);

  const toggleSort = async (): Promise<void> => {
    await catalog.setFavoriteSort(catalog.favoriteSort.value === 'name' ? 'lastUsedAt' : 'name');
    await updatePosition();
  };
  const openAdd = (): void => {
    editing.value = null;
    form.name = '';
    form.path = '';
    errorMessage.value = '';
    formVisible.value = true;
  };
  const openEdit = (item: FavoritePath): void => {
    editing.value = item;
    form.name = item.name ?? '';
    form.path = item.path;
    errorMessage.value = '';
    formVisible.value = true;
  };
  const closeForm = (): void => {
    if (!saving.value) formVisible.value = false;
  };
  const save = async (): Promise<void> => {
    const path = form.path.trim();
    if (!path || saving.value) {
      if (!path) errorMessage.value = t('favoritePaths.addEditForm.validation.pathRequired');
      return;
    }
    saving.value = true;
    errorMessage.value = '';
    try {
      await catalog.saveFavorite({ id: editing.value?.id, path, name: form.name });
      feedback.notifySuccess(
        t(editing.value ? 'favoritePaths.notifications.updateSuccess' : 'favoritePaths.notifications.addSuccess'),
      );
      formVisible.value = false;
      await updatePosition();
    } catch (cause) {
      errorMessage.value =
        cause instanceof Error ? cause.message : t('favoritePaths.addEditForm.errors.genericSaveError');
    } finally {
      saving.value = false;
    }
  };
  const removeFavorite = async (item: FavoritePath): Promise<void> => {
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
      await updatePosition();
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : t('favoritePaths.notifications.deleteError'));
    }
  };
  const navigateFavorite = async (item: FavoritePath): Promise<void> => {
    try {
      await catalog.useFavorite(item);
    } catch {
      feedback.notifyError(t('favoritePaths.notifications.markAsUsedError'));
    }
    emit('navigate', item.path);
    emit('close');
  };
  const sendToTerminal = (item: FavoritePath): void => {
    emit('terminal', item.path);
    emit('close');
  };
</script>

<template>
  <div
    v-if="visible"
    ref="panel"
    data-testid="favorite-paths-popover"
    role="dialog"
    :aria-label="t('favoritePaths.title')"
    :style="panelStyle"
    class="fixed z-50 flex max-h-80 w-72 flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-lg md:w-80"
  >
    <div class="flex shrink-0 items-center gap-2 p-2">
      <div class="relative flex-grow">
        <input
          v-model="catalog.favoriteSearch.value"
          type="text"
          class="w-full rounded-md border border-border bg-input py-1.5 pl-2.5 pr-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
          :placeholder="t('favoritePaths.searchPlaceholder')"
        />
      </div>
      <button
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-sm text-text-secondary shadow-sm transition-colors duration-200 hover:bg-primary/10 hover:text-primary"
        :aria-label="t('favoritePaths.sortToggle')"
        @click="toggleSort"
      >
        <i :class="sortIcon" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-none bg-primary text-sm font-semibold text-white shadow-md transition-colors duration-200 hover:bg-button-hover"
        :title="t('favoritePaths.addNew')"
        :aria-label="t('favoritePaths.addNew')"
        @click="openAdd"
      >
        <i class="fas fa-plus text-base" aria-hidden="true"></i>
      </button>
    </div>

    <div class="min-h-0 flex-grow overflow-y-auto p-1 text-sm">
      <div
        v-if="catalog.loadingFavorites.value && !catalog.filteredFavorites.value.length"
        class="p-3 text-center text-text-secondary"
      >
        <i class="fas fa-spinner fa-spin mr-1" aria-hidden="true"></i>
        {{ t('favoritePaths.loading') }}
      </div>
      <div v-else-if="!catalog.filteredFavorites.value.length" class="p-3 text-center text-text-secondary">
        <i class="fas fa-star-half-alt mr-1" aria-hidden="true"></i>
        {{ catalog.favoriteSearch.value ? t('favoritePaths.noResults') : t('favoritePaths.noFavorites') }}
      </div>
      <ul v-else class="m-0 list-none p-0">
        <li
          v-for="item in catalog.filteredFavorites.value"
          :key="item.id"
          class="group flex cursor-pointer items-center justify-between rounded-md p-2 transition-colors duration-150 hover:bg-primary/10"
          :title="item.path"
        >
          <button
            type="button"
            class="mr-2 min-w-0 flex-grow overflow-hidden text-left"
            :aria-label="item.name || item.path"
            @click="navigateFavorite(item)"
          >
            <span class="block truncate font-medium text-foreground">{{ item.name || item.path }}</span>
            <span v-if="item.name" class="block truncate text-xs text-text-secondary">{{ item.path }}</span>
          </button>
          <div
            class="flex shrink-0 items-center gap-1 transition-opacity duration-150"
            :class="
              device.hasTouch.value ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            "
          >
            <button
              type="button"
              class="rounded p-1.5 text-text-secondary transition-colors hover:bg-black/10 hover:text-primary"
              :title="t('fileManager.actions.cdToTerminal')"
              :aria-label="t('fileManager.actions.cdToTerminal')"
              @click="sendToTerminal(item)"
            >
              <i class="fas fa-terminal text-xs" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="rounded p-1.5 text-text-secondary transition-colors hover:bg-black/10 hover:text-primary"
              :title="t('common.edit')"
              :aria-label="t('common.edit')"
              @click="openEdit(item)"
            >
              <i class="fas fa-pencil-alt text-xs" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="rounded p-1.5 text-text-secondary transition-colors hover:bg-black/10 hover:text-error"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
              @click="removeFavorite(item)"
            >
              <i class="fas fa-trash-alt text-xs" aria-hidden="true"></i>
            </button>
          </div>
        </li>
      </ul>
    </div>
  </div>

  <OverlayPanel
    :visible="formVisible"
    :z-index="60"
    panel-class="max-w-md flex flex-col p-6"
    role="dialog"
    :aria-modal="true"
    :aria-label="t(editing ? 'favoritePaths.addEditForm.editTitle' : 'favoritePaths.addEditForm.addTitle')"
    @close="closeForm"
  >
    <h2 class="m-0 mb-6 text-center text-xl font-semibold">
      {{ t(editing ? 'favoritePaths.addEditForm.editTitle' : 'favoritePaths.addEditForm.addTitle') }}
    </h2>
    <form class="flex-grow space-y-4 overflow-y-auto" @submit.prevent="save">
      <div>
        <label for="favPath-name" class="mb-1 block text-sm font-medium text-text-secondary">
          {{ t('favoritePaths.addEditForm.nameLabel') }}
        </label>
        <input
          id="favPath-name"
          v-model="form.name"
          type="text"
          :disabled="saving"
          class="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
          :placeholder="t('favoritePaths.addEditForm.namePlaceholder')"
        />
      </div>
      <div>
        <label for="favPath-path" class="mb-1 block text-sm font-medium text-text-secondary">
          {{ t('favoritePaths.addEditForm.pathLabel') }} <span class="ml-0.5 text-error">*</span>
        </label>
        <input
          id="favPath-path"
          v-model="form.path"
          type="text"
          required
          :disabled="saving"
          class="w-full rounded-md border border-border bg-input px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
          :placeholder="t('favoritePaths.addEditForm.pathPlaceholder')"
        />
      </div>
      <div v-if="errorMessage" class="rounded-md bg-error/10 p-2 text-sm text-error" role="alert">
        {{ errorMessage }}
      </div>
    </form>
    <div class="mt-8 flex justify-end border-t border-border/50 pt-4">
      <button
        type="button"
        class="mr-3 rounded-lg border border-border/50 bg-background px-5 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground disabled:opacity-50"
        :disabled="saving"
        @click="closeForm"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="rounded-lg border-none bg-primary px-5 py-2 text-sm font-semibold text-white shadow-md transition-colors duration-150 hover:bg-button-hover disabled:cursor-not-allowed disabled:opacity-70"
        :disabled="saving || !form.path.trim()"
        @click="save"
      >
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </div>
  </OverlayPanel>
</template>
