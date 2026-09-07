import { useDialogStore } from '../store/dialog.store';
import { useNotificationStore } from '../store/notification.store';

export const useFeedback = () => {
  const dialogs = useDialogStore();
  const notifications = useNotificationStore();

  return {
    confirm: dialogs.confirm,
    alert: dialogs.alert,
    setDialogLoading: dialogs.setLoading,
    notifySuccess: notifications.success,
    notifyError: notifications.error,
    notifyInfo: notifications.info,
    notifyWarning: notifications.warning,
  };
};
