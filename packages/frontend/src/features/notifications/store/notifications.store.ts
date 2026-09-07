import { ref } from 'vue';
import { defineStore } from 'pinia';
import { apiErrorMessage } from '@/client/http';
import { notificationsApi } from '../api/notificationsApi';
import type { NotificationSetting, NotificationSettingInput } from '../model/notification';
export const useNotificationsStore = defineStore('notifications', () => {
  const items = ref<NotificationSetting[]>([]),
    loading = ref(false),
    error = ref<string | null>(null);
  async function load() {
    loading.value = true;
    error.value = null;
    try {
      items.value = await notificationsApi.list();
    } catch (e) {
      error.value = apiErrorMessage(e, 'notification-load-error');
    } finally {
      loading.value = false;
    }
  }
  async function save(input: NotificationSettingInput, id?: number) {
    const saved = id ? await notificationsApi.update(id, input) : await notificationsApi.create(input);
    const index = items.value.findIndex((x) => x.id === saved.id);
    if (index >= 0) items.value[index] = saved;
    else items.value.push(saved);
    return saved;
  }
  async function remove(id: number) {
    await notificationsApi.remove(id);
    items.value = items.value.filter((x) => x.id !== id);
  }
  return { items, loading, error, load, save, remove };
});
