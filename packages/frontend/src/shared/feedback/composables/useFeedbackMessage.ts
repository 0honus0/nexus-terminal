import { onActivated, onDeactivated, watch } from 'vue';
import { isNetworkFailure } from '@/client/http/network-failure';
import type { NotificationKind, UiNotificationAction } from '../model';
import { useNotificationStore } from '../store/notification.store';

export function useFeedbackMessage(
	message: () => string,
	kind: () => NotificationKind = () => 'error',
	cause: () => unknown = () => undefined,
	action: () => UiNotificationAction | undefined = () => undefined,
): void {
	const notifications = useNotificationStore();
	let active = true;
	watch(
		[message, kind, action],
		([value, notificationKind]) => {
			if (active && value && (notificationKind !== 'error' || !isNetworkFailure(cause()))) {
				const notificationAction = action();
				notifications.show(notificationKind, value, notificationAction ? 0 : undefined, notificationAction);
			}
		},
		{ immediate: true },
	);
	onActivated(() => {
		active = true;
	});
	onDeactivated(() => {
		active = false;
	});
}
