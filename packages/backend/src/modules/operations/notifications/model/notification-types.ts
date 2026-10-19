import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import type { NotificationDeliveryStatus } from '@nexus-terminal/shared/operations/notifications/values';

export type NotificationConfig =
	| {
			kind: 'webhook';
			url: string;
			method: 'GET' | 'POST' | 'PUT';
			headers: { name: string; value: string | null }[];
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
			password: string | null;
			bodyTemplate: string | null;
	  }
	| { kind: 'telegram'; origin: string; chatId: string; botToken: string | null; bodyTemplate: string | null };

export type SecretChange = { action: 'keep' } | { action: 'clear' } | { action: 'replace'; value: string };

export type NotificationConfigChange =
	| {
			kind: 'webhook';
			url: string;
			method: 'GET' | 'POST' | 'PUT';
			headers: { name: string; value: SecretChange }[];
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
			password: SecretChange;
			bodyTemplate: string | null;
	  }
	| { kind: 'telegram'; origin: string; chatId: string; botToken: SecretChange; bodyTemplate: string | null };

export interface NotificationChange {
	name: string;
	enabled: boolean;
	events: OperationEvent[];
	config: NotificationConfigChange;
}

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

export interface NotificationActor {
	userId: number;
	token: string;
}

export interface NotificationDelivery {
	id: string;
	settingId: string | null;
	event: OperationEvent;
	status: NotificationDeliveryStatus;
	createdAt: number;
	updatedAt: number;
}

export interface NotificationDispatch {
	delivery: NotificationDelivery;
	config: NotificationConfig;
	subjectId: string | null;
}

export interface NotificationFanout {
	event: OperationEvent;
	createdAt: number;
	pending: number;
	candidates: { id: string; events: OperationEvent[]; createdAt: number }[];
}

export interface NotificationRecovery {
	discardQueued: boolean;
	suppressHistoricalFanout: boolean;
}
