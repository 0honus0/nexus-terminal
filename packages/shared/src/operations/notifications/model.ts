import type { OperationEvent } from '../values.js';
import type { NotificationDeliveryStatus } from './values.js';

export type NotificationConfigView =
	| {
			kind: 'webhook';
			url: string;
			method: 'GET' | 'POST' | 'PUT';
			headers: { name: string; hasValue: boolean }[];
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
			hasPassword: boolean;
			bodyTemplate: string | null;
	  }
	| { kind: 'telegram'; origin: string; chatId: string; hasBotToken: boolean; bodyTemplate: string | null };

export interface NotificationSettingView {
	id: string;
	version: number;
	name: string;
	enabled: boolean;
	events: OperationEvent[];
	config: NotificationConfigView;
	createdAt: number;
	updatedAt: number;
}

export interface NotificationDeliveryView {
	id: string;
	settingId: string | null;
	event: OperationEvent;
	status: NotificationDeliveryStatus;
	createdAt: number;
	updatedAt: number;
}
