import { onActivated, onDeactivated, watch } from 'vue';
import { isNetworkFailure } from '@/client/http/network-failure';
import type { NotificationKind } from '../model';
import { useNotificationStore } from '../store/notification.store';

export function useFeedbackMessage(
	message: () => string,
	kind: () => NotificationKind = () => 'error',
	cause: () => unknown = () => undefined,
): void {
	const notifications = useNotificationStore();
	let active = true;
	watch(
		[message, kind],
		([value, notificationKind]) => {
			if (active && value && (notificationKind !== 'error' || !isNetworkFailure(cause()))) {
				notifications.show(notificationKind, value);
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
