import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import { useNotificationsStore } from '../store/notifications.store';

export const resetNotificationsCache = (): void => useNotificationsStore().reset();

registerAuthenticatedSessionReset('notifications-cache', resetNotificationsCache);
