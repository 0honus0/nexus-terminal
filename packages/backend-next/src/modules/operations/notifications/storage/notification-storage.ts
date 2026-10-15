import type { NotificationDeliveryOutcome } from '@nexus-terminal/shared/operations/notifications/values';
import type { OperationEvent } from '@nexus-terminal/shared/operations/values';
import type { NotificationDeliveryStatus } from '@nexus-terminal/shared/operations/notifications/values';

export type StoredNotificationConfig =
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

export interface StoredNotificationSetting {
	id: string;
	version: number;
	name: string;
	enabled: boolean;
	events: OperationEvent[];
	config: StoredNotificationConfig;
	createdAt: number;
	updatedAt: number;
}

export interface StoredNotificationDelivery {
	id: string;
	settingId: string | null;
	event: OperationEvent;
	status: NotificationDeliveryStatus;
	createdAt: number;
	updatedAt: number;
}

export interface StoredNotificationDispatch {
	delivery: StoredNotificationDelivery;
	config: StoredNotificationConfig;
	subjectId: string | null;
}

export interface StoredNotificationFanout {
	event: OperationEvent;
	createdAt: number;
	pending: number;
	candidates: { id: string; events: OperationEvent[]; createdAt: number }[];
}

export interface NotificationStorage {
	testConfig(
		id: string,
		digest: string,
		admit: (identity: number | null, pending: number) => void,
		config: StoredNotificationConfig,
		now: number,
	): Promise<StoredNotificationDelivery>;
	list(): Promise<StoredNotificationSetting[]>;
	mutate(
		id: string,
		digest: string,
		admit: (identity: number | null, pending: number) => void,
		change: (current: StoredNotificationSetting | null, count: number) => StoredNotificationSetting | null,
	): Promise<StoredNotificationSetting | null>;
	fanout(select: (facts: StoredNotificationFanout) => string[] | null): Promise<number>;
	test(
		id: string,
		digest: string,
		admit: (identity: number | null, pending: number) => void,
		deliveryId: string,
		now: number,
	): Promise<StoredNotificationDelivery>;
	recover(command: StoredNotificationRecovery): Promise<void>;
	next(now: number): Promise<StoredNotificationDispatch | null>;
	settle(id: string, status: NotificationDeliveryOutcome, now: number, retain: number): Promise<void>;
	deliveries(offset: number, limit: number): Promise<StoredNotificationDelivery[]>;
}

export interface StoredNotificationRecovery {
	discardQueued: boolean;
	suppressHistoricalFanout: boolean;
}
