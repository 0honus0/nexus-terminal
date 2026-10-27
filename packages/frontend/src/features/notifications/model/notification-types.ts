import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import type { NotificationDeliveryStatus } from '@nexus-terminal/shared/operations/notifications/values';

export type NotificationSecret = { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export type NotificationConfig =
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

export type NotificationConfigChange =
	| {
			kind: 'webhook';
			url: string;
			method: 'GET' | 'POST' | 'PUT';
			headers: { name: string; value: NotificationSecret }[];
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
			password: NotificationSecret;
			bodyTemplate: string | null;
	  }
	| { kind: 'telegram'; origin: string; chatId: string; botToken: NotificationSecret; bodyTemplate: string | null };

export interface NotificationSetting {
	id: string;
	version: number;
	name: string;
	enabled: boolean;
	events: OperationEvent[];
	config: NotificationConfig;
	createdAt: number;
	updatedAt: number;
}

export interface NotificationChange {
	name: string;
	enabled: boolean;
	events: OperationEvent[];
	config: NotificationConfigChange;
}

export interface NotificationDelivery {
	id: string;
	settingId: string | null;
	event: OperationEvent;
	status: NotificationDeliveryStatus;
	createdAt: number;
	updatedAt: number;
}

export interface NotificationDeliveryPage {
	items: NotificationDelivery[];
	nextOffset: number | null;
}
