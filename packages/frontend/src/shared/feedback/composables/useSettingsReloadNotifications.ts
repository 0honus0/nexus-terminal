import { onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsReloadStore } from '../store/settings-reload.store';
import { useNotificationStore } from '../store/notification.store';

export function useSettingsReloadNotifications(): void {
	const { t } = useI18n();
	const store = useSettingsReloadStore();
	const notifications = useNotificationStore();
	let notificationId: number | null = null;
	let disposed = false;

	function removeNotice(): void {
		if (notificationId !== null) notifications.remove(notificationId);
		notificationId = null;
	}

	async function reload(): Promise<void> {
		if (disposed) return;
		const result = await store.reloadPending();
		if (disposed) return;
		if (result.remaining === 0) {
			removeNotice();
		} else {
			showNotice(t('feedback.settingsReload.failed'), 'error');
		}
	}

	function showNotice(message: string, kind: 'warning' | 'error' = 'warning'): void {
		const nextId = notifications.show(kind, message, 0, {
			key: 'settings-reload',
			label: t('feedback.settingsReload.reload'),

			disabled: () => store.busy || disposed,

			onClick: () => {
				void reload();
			},
		});
		if (nextId !== null) {
			if (notificationId !== null && notificationId !== nextId) notifications.remove(notificationId);
			notificationId = nextId;
		}
	}

	watch(
		[() => store.promptOpen, () => store.pendingSignature],
		([open, signature]) => {
			if (!signature) {
				removeNotice();
			} else if (open) {
				showNotice(t('feedback.settingsReload.description', { count: store.pendingCount }));
				store.dismiss();
			}
		},
		{ immediate: true },
	);
	onBeforeUnmount(() => {
		disposed = true;
		removeNotice();
	});
}
