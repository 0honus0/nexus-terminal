import type { OperationEvent } from '../values.js';
import type { NotificationSettingView, NotificationDeliveryView } from './model.js';

export type NotificationSecretUpdate = { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export type NotificationConfigInput =
	| {
			kind: 'webhook';
			url: string;
			method: 'GET' | 'POST' | 'PUT';
			headers: { name: string; value: NotificationSecretUpdate }[];
			bodyTemplate: string | null;
	  }
	| {
			kind: 'email';
			to: string;
			from: string;
			host: string;
			port: number;
			secure: boolean;
			username: string;
			password: NotificationSecretUpdate;
			bodyTemplate: string | null;
	  }
	| {
			kind: 'telegram';
			origin: string;
			chatId: string;
			botToken: NotificationSecretUpdate;
			bodyTemplate: string | null;
	  };

export interface NotificationCreateRequest {
	name: string;
	enabled: boolean;
	events: OperationEvent[];
	config: NotificationConfigInput;
}

export interface NotificationUpdateRequest {
	expectedVersion: number;
	name: string;
	enabled: boolean;
	events: OperationEvent[];
	config: NotificationConfigInput;
}

export interface NotificationVersionRequest {
	expectedVersion: number;
}

export interface NotificationSettingResponse {
	setting: NotificationSettingView;
}

export interface NotificationListResponse {
	items: NotificationSettingView[];
}

export interface NotificationTestResponse {
	delivery: NotificationDeliveryView;
}

export interface NotificationDeliveriesResponse {
	items: NotificationDeliveryView[];
	nextOffset: number | null;
}

export interface NotificationUnsavedTestRequest {
	config: NotificationConfigInput;
}
