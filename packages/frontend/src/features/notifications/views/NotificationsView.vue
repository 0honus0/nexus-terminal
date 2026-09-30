<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { UiButton, UiEmptyState, UiSpinner } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { apiErrorMessage } from '@/client/http';
  import NotificationSettingForm from '../components/NotificationSettingForm.vue';
  import { useNotificationsStore } from '../store/notifications.store';
  import type { NotificationSettingDto, NotificationSettingCreateRequestDto } from '../model/notification';
  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useNotificationsStore();
  const { items, loading, error } = storeToRefs(store);
  const editing = ref<NotificationSettingDto | null>(null),
    formVisible = ref(false);
  onMounted(() => store.load());
  const openAdd = () => {
    editing.value = null;
    formVisible.value = true;
  };
  const openEdit = (item: NotificationSettingDto) => {
    editing.value = item;
    formVisible.value = true;
  };
  const save = async (input: NotificationSettingCreateRequestDto) => {
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
  const remove = async (item: NotificationSettingDto) => {
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
  <div class="p-4 text-foreground">
    <div data-testid="notification-settings" class="mx-auto max-w-6xl p-0">
      <h2 class="mb-4 border-b border-border pb-2 text-xl font-semibold text-foreground">
        {{ t('settings.notifications.title') }}
      </h2>

      <div v-if="error" class="mb-4 rounded border-l-4 border-error bg-error/10 p-4 text-error">
        {{ error === 'notification-load-error' ? t('notificationController.errorFetchSettings') : error }}
      </div>
      <UiButton
        v-if="!error"
        data-testid="notification-add-channel"
        type="button"
        appearance="solid"
        class="mb-4"
        @click="openAdd"
      >
        {{ t('settings.notifications.addChannel') }}
      </UiButton>

      <div v-if="loading && items.length === 0 && !error" class="p-4 text-center text-text-secondary italic">
        <UiSpinner class="mx-auto" />
      </div>
      <UiEmptyState
        v-else-if="!loading && !error && items.length === 0"
        class="mb-4"
        icon="fa-solid fa-bell-slash"
        :description="t('settings.notifications.noChannels')"
      />
      <div v-else-if="!loading && !error && items.length > 0" class="mt-4 grid gap-4">
        <article
          v-for="item in items"
          :key="item.id"
          class="ui-solid-item flex flex-col items-start justify-between gap-4 rounded-xl p-4 sm:flex-row"
        >
          <div class="min-w-0 flex-grow">
            <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <strong class="min-w-0 break-words text-base font-semibold text-foreground">{{ item.name }}</strong>
              <span
                class="rounded-full border border-border/60 bg-card/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-secondary"
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
            <small class="mt-1 block break-words text-sm text-text-secondary">{{
              item.enabledEvents.length
                ? `${t('settings.notifications.triggers')}: ${item.enabledEvents.map((event) => t(`settings.notifications.events.${event}`)).join(', ')}`
                : t('settings.notifications.noEventsEnabled')
            }}</small>
          </div>
          <div class="flex w-full shrink-0 items-center justify-end space-x-3 sm:w-auto">
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

      <div v-if="formVisible" class="ui-form-surface mt-6 rounded-xl p-4 sm:p-6">
        <NotificationSettingForm :visible="formVisible" :setting="editing" @close="formVisible = false" @save="save" />
      </div>
    </div>
  </div>
</template>
