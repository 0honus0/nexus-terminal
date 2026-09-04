import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { NotificationKind, UiNotification } from '../model';

const DEFAULT_TIMEOUT_MS = 3000;
const ERROR_DEDUPE_MS = 15_000;

export const useNotificationStore = defineStore('shared-notifications', () => {
  const notifications = ref<UiNotification[]>([]);
  const recentErrors = new Map<string, number>();
  let nextId = 1;

  const remove = (id: number): void => {
    notifications.value = notifications.value.filter((notification) => notification.id !== id);
  };

  const show = (kind: NotificationKind, message: string, timeoutMs = DEFAULT_TIMEOUT_MS): number | null => {
    if (kind === 'error') {
      const now = Date.now();
      const previous = recentErrors.get(message);
      if (previous !== undefined && now - previous < ERROR_DEDUPE_MS) return null;
      recentErrors.set(message, now);
      for (const [key, shownAt] of recentErrors) {
        if (now - shownAt >= ERROR_DEDUPE_MS) recentErrors.delete(key);
      }
    }

    const id = nextId++;
    notifications.value.push({ id, kind, message, timeoutMs });
    window.setTimeout(() => remove(id), timeoutMs);
    return id;
  };

  return {
    notifications,
    remove,
    show,
    success: (message: string, timeoutMs?: number) => show('success', message, timeoutMs),
    error: (message: string, timeoutMs?: number) => show('error', message, timeoutMs),
    info: (message: string, timeoutMs?: number) => show('info', message, timeoutMs),
    warning: (message: string, timeoutMs?: number) => show('warning', message, timeoutMs),
  };
});
