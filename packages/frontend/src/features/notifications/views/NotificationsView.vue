<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { apiErrorMessage } from '@/client/http';
  import NotificationSettingForm from '../components/NotificationSettingForm.vue';
  import { useNotificationsStore } from '../store/notifications.store';
  import type { NotificationSetting, NotificationSettingInput } from '../model/notification';
  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useNotificationsStore();
  const { items, loading, error } = storeToRefs(store);
  const editing = ref<NotificationSetting | null>(null),
    formVisible = ref(false);
  onMounted(() => store.load());
  const openAdd = () => {
    editing.value = null;
    formVisible.value = true;
  };
  const openEdit = (item: NotificationSetting) => {
    editing.value = item;
    formVisible.value = true;
  };
  const save = async (input: NotificationSettingInput) => {
    try {
      await store.save(input, editing.value?.id);
      formVisible.value = false;
      feedback.notifySuccess(t('common.saved'));
    } catch (e) {
      feedback.notifyError(
        apiErrorMessage(
          e,
          t(editing.value ? 'notificationController.errorUpdateSetting' : 'notificationController.errorCreateSetting'),
        ),
      );
    }
  };
  const remove = async (item: NotificationSetting) => {
    if (
      !(await feedback.confirm({
        message: t('settings.notifications.confirmDelete', { name: item.name }),
        destructive: true,
      }))
    )
      return;
    try {
      await store.remove(item.id);
    } catch (e) {
      feedback.notifyError(apiErrorMessage(e, t('notificationController.errorDeleteSetting')));
    }
  };
</script>
<template>
  <div class="bg-background p-4 text-foreground">
    <div data-testid="notification-settings" class="mx-auto max-w-6xl p-0">
      <h2 class="mb-4 border-b border-border pb-2 text-xl font-semibold text-foreground">
        {{ t('settings.notifications.title') }}
      </h2>

      <div v-if="error" class="mb-4 rounded border-l-4 border-error bg-error/10 p-4 text-error">
        {{ error === 'notification-load-error' ? t('notificationController.errorFetchSettings') : error }}
      </div>
      <button
        v-if="!error"
        data-testid="notification-add-channel"
        type="button"
        class="mb-4 inline-flex items-center rounded bg-button px-4 py-2 text-sm font-medium text-button-text hover:bg-button-hover"
        @click="openAdd"
      >
        {{ t('settings.notifications.addChannel') }}
      </button>

      <div v-if="loading && items.length === 0 && !error" class="p-4 text-center text-text-secondary italic">
        <BaseSpinner class="mx-auto" />
      </div>
      <div
        v-else-if="!loading && !error && items.length === 0"
        class="mb-4 rounded border-l-4 border-blue-400 bg-blue-100 p-4 text-blue-700"
      >
        {{ t('settings.notifications.noChannels') }}
      </div>
      <div v-else-if="!loading && !error && items.length > 0" class="mt-4 grid gap-4">
        <article
          v-for="item in items"
          :key="item.id"
          class="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4 shadow-sm transition-shadow duration-200 hover:shadow-md"
        >
          <div class="flex-grow">
            <strong class="mb-1 block text-base font-semibold text-foreground">{{ item.name }}</strong>
            <div class="mb-2 flex items-center space-x-2">
              <span
                class="rounded-full border border-border bg-header px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-secondary"
                >{{ t(`settings.notifications.types.${item.channelType}`) }}</span
              >
              <span
                :class="[
                  'rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider',
                  item.enabled
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-warning/30 bg-warning/10 text-warning',
                ]"
                >{{ item.enabled ? t('common.enabled') : t('common.disabled') }}</span
              >
            </div>
            <small class="mt-1 block text-sm text-text-secondary">{{
              item.enabledEvents.length
                ? `${t('settings.notifications.triggers')}: ${item.enabledEvents.map((event) => t(`settings.notifications.events.${event}`)).join(', ')}`
                : t('settings.notifications.noEventsEnabled')
            }}</small>
          </div>
          <div class="flex shrink-0 items-center space-x-3">
            <button
              type="button"
              class="text-sm font-medium text-link hover:text-link-hover hover:underline"
              @click="openEdit(item)"
            >
              <i class="fas fa-pencil-alt mr-1 text-xs" aria-hidden="true" />{{ t('common.edit') }}
            </button>
            <button
              type="button"
              class="text-sm font-medium text-error hover:opacity-80 hover:underline"
              @click="remove(item)"
            >
              <i class="fas fa-trash-alt mr-1 text-xs" aria-hidden="true" />{{ t('common.delete') }}
            </button>
          </div>
        </article>
      </div>

      <div v-if="formVisible" class="mt-6 rounded-lg border border-border bg-background p-6 shadow-sm">
        <NotificationSettingForm :visible="formVisible" :setting="editing" @close="formVisible = false" @save="save" />
      </div>
    </div>
  </div>
</template>
