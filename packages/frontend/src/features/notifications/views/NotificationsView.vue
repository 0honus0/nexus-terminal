<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseBadge, BaseButton, BasePanel, BaseSpinner } from '@/foundation/ui';
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
  <main data-testid="notification-settings" class="mx-auto w-full max-w-6xl p-6">
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-semibold">{{ t('settings.notifications.title') }}</h1>
      <BaseButton data-testid="notification-add-channel" variant="primary" @click="openAdd">{{
        t('settings.notifications.addChannel')
      }}</BaseButton>
    </div>
    <BaseSpinner v-if="loading" />
    <p v-else-if="error" class="text-error">
      {{ error === 'notification-load-error' ? t('notificationController.errorFetchSettings') : error }}
    </p>
    <p v-else-if="!items.length" class="text-text-secondary">{{ t('settings.notifications.noChannels') }}</p>
    <div v-else class="grid gap-4 md:grid-cols-2">
      <BasePanel v-for="item in items" :key="item.id"
        ><div class="flex items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">{{ item.name }}</h2>
              <BaseBadge>{{ t(`settings.notifications.types.${item.channelType}`) }}</BaseBadge>
            </div>
            <p class="mt-2 text-sm text-text-secondary">
              {{
                item.enabledEvents.length
                  ? item.enabledEvents.map((e) => t(`settings.notifications.events.${e}`)).join(', ')
                  : t('settings.notifications.noEventsEnabled')
              }}
            </p>
          </div>
          <BaseBadge :variant="item.enabled ? 'success' : 'neutral'">{{
            item.enabled ? t('common.enabled') : t('common.disabled')
          }}</BaseBadge>
        </div>
        <div class="mt-4 flex gap-2">
          <BaseButton size="sm" @click="openEdit(item)">{{ t('common.edit') }}</BaseButton
          ><BaseButton size="sm" variant="danger" @click="remove(item)">{{ t('common.delete') }}</BaseButton>
        </div></BasePanel
      >
    </div>
    <NotificationSettingForm :visible="formVisible" :setting="editing" @close="formVisible = false" @save="save" />
  </main>
</template>
