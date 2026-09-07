export type NotificationKind = 'success' | 'error' | 'info' | 'warning';

export interface UiNotification {
  id: number;
  kind: NotificationKind;
  message: string;
  timeoutMs: number;
}

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export interface AlertDialogOptions {
  title?: string;
  message: string;
  okText?: string;
}
