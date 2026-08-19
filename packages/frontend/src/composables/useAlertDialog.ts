import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AlertDialog from '../components/common/AlertDialog.vue';
import { createApp, h } from 'vue';

interface AlertDialogOptions {
  title: string;
  message: string;
  okText?: string;
  onOk?: () => void | Promise<void>;
}

export function useAlertDialog() {
  const { t } = useI18n();

  const showAlertDialog = (options: AlertDialogOptions): Promise<void> => {
    return new Promise((resolve) => {
      const { title, message, okText, onOk } = options;

      const
        container = document.createElement('div');
      document.body.appendChild(container);

      const app = createApp({
        render: () =>
          h(AlertDialog, {
            visible: true,
            title,
            message,
            okText: okText || t('common.ok', '确定'),
            onOk: async () => {
              if (onOk) {
                await onOk();
              }
              app.unmount();
              container.remove();
              resolve();
            },
            'onUpdate:visible': (isVisible: boolean) => {
              if (!isVisible) {
                // This case handles closing via Escape key or clicking outside
                app.unmount();
                container.remove();
                resolve(); // Resolve promise when dialog is closed without explicit ok
              }
            },
          }),
      });

      // The caller already resolves localized strings through the parent app's i18n context.
      // Keep the transient alert app self-contained instead of calling useI18n() outside setup.
      app.mount(container);
    });
  };

  return {
    showAlertDialog,
  };
}