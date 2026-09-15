import { useNotificationsStore } from '../store/notifications.store';

export const resetNotificationsCache = (): void => useNotificationsStore().reset();
