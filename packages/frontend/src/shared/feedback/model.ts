export type NotificationKind = 'success' | 'error' | 'info' | 'warning';

export interface UiNotificationAction {
	key: string;
	label: string;
	disabled(): boolean;
	onClick(): void;
}

export interface UiNotification {
	id: number;
	kind: NotificationKind;
	message: string;
	timeoutMs: number;
	action?: UiNotificationAction;
}

export type DialogTone = 'primary' | 'danger' | 'warning';

export interface DialogDetail {
	label: string;
	value: string;
	mono?: boolean;
	tone?: 'default' | 'primary' | 'warning' | 'danger';
}

export interface ConfirmDialogOptions {
	checkbox?: {
		label: string;
		onChange(checked: boolean): void;
	};
	signal?: AbortSignal;
	title?: string;
	message: string;
	confirmText?: string;
	cancelText?: string;
	destructive?: boolean;
	tone?: DialogTone;
	icon?: string;
	details?: DialogDetail[];
}

export interface AlertDialogOptions {
	title?: string;
	message: string;
	okText?: string;
}

/** One settings owner that can restore its local read state without replaying writes. */
export interface SettingsReloadSource {
	id: string;
	pending(): boolean;
	reload(): Promise<void>;
}

export interface SettingsReloadResult {
	attempted: number;
	failed: number;
	remaining: number;
}
