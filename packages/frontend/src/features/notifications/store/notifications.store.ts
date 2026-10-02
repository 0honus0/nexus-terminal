import { ref } from 'vue';
import { defineStore } from 'pinia';
import { apiErrorMessage } from '@/client/http';
import { notificationsApi } from '../api/notificationsApi';
import type { NotificationSettingDto, NotificationSettingCreateRequestDto } from '../model/notification';

export const useNotificationsStore = defineStore('notifications', () => {
  let loadGeneration = 0;
  const items = ref<NotificationSettingDto[]>([]),
    loading = ref(false),
    error = ref<string | null>(null);
  async function load() {
    const generation = loadGeneration;
    loading.value = true;
    error.value = null;
    try {
      const incoming = await notificationsApi.list();
      if (generation === loadGeneration) items.value = incoming;
    } catch (e) {
      if (generation === loadGeneration) error.value = apiErrorMessage(e, 'notification-load-error');
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }
  function reset() {
    loadGeneration += 1;
    items.value = [];
    loading.value = false;
    error.value = null;
  }
  async function save(input: NotificationSettingCreateRequestDto, id?: number) {
    const generation = loadGeneration;
    const saved = id ? await notificationsApi.update(id, input) : await notificationsApi.create(input);
    if (generation !== loadGeneration) return saved;
    const index = items.value.findIndex((x) => x.id === saved.id);
    if (index >= 0) items.value[index] = saved;
    else items.value.push(saved);
    return saved;
  }
  async function remove(id: number) {
    const generation = loadGeneration;
    await notificationsApi.remove(id);
    if (generation !== loadGeneration) return;
    items.value = items.value.filter((x) => x.id !== id);
  }
  return { items, loading, error, load, reset, save, remove };
});
