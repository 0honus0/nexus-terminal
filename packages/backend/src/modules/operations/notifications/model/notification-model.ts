import type { NotificationRecovery } from './notification-types.js';
import type { NotificationDeliveryOutcome } from '@nexus-terminal/shared/operations/notifications/values';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import type { Delivery, DeliveryRequest } from '../../../../platform/delivery/delivery.js';
import { DeliveryFailure } from '../../../../platform/delivery/delivery.js';
import { operationsStorage } from '../../operations-storage-failure.js';
import { OperationsFailure, NotificationCleanupFailure } from '../../operations-failure.js';
import type {
	NotificationStorage,
	StoredNotificationConfig,
	StoredNotificationSetting,
	StoredNotificationDelivery,
} from '../storage/notification-storage.js';
import type {
	NotificationSetting,
	NotificationConfig,
	NotificationActor,
	NotificationDelivery,
	NotificationDispatch,
	NotificationFanout,
} from './notification-types.js';

function toStorageConfig(
	value: NotificationConfig,
	secret: (field: string, value: string | null) => string | null,
): StoredNotificationConfig {
	if (value.kind === 'webhook') {
		return {
			kind: 'webhook',
			url: value.url,
			method: value.method,
			headers: value.headers.map((h) => ({
				name: h.name,
				value: secret('header:' + h.name.toLowerCase(), h.value),
			})),
			bodyTemplate: value.bodyTemplate,
		};
	}
	if (value.kind === 'email') {
		return {
			kind: 'email',
			to: value.to,
			from: value.from,
			host: value.host,
			port: value.port,
			secure: value.secure,
			username: value.username,
			password: secret('password', value.password),
			bodyTemplate: value.bodyTemplate,
		};
	}
	return {
		kind: 'telegram',
		origin: value.origin,
		chatId: value.chatId,
		botToken: secret('botToken', value.botToken),
		bodyTemplate: value.bodyTemplate,
	};
}

function fromStorageConfig(
	value: StoredNotificationConfig,
	secret: (field: string, value: string | null) => string | null,
): NotificationConfig {
	if (value.kind === 'webhook') {
		return {
			kind: 'webhook',
			url: value.url,
			method: value.method,
			headers: value.headers.map((h) => ({
				name: h.name,
				value: secret('header:' + h.name.toLowerCase(), h.value),
			})),
			bodyTemplate: value.bodyTemplate,
		};
	}
	if (value.kind === 'email') {
		return {
			kind: 'email',
			to: value.to,
			from: value.from,
			host: value.host,
			port: value.port,
			secure: value.secure,
			username: value.username,
			password: secret('password', value.password),
			bodyTemplate: value.bodyTemplate,
		};
	}
	return {
		kind: 'telegram',
		origin: value.origin,
		chatId: value.chatId,
		botToken: secret('botToken', value.botToken),
		bodyTemplate: value.bodyTemplate,
	};
}

function delivery(value: StoredNotificationDelivery): NotificationDelivery {
	return {
		id: value.id,
		settingId: value.settingId,
		event: value.event,
		status: value.status,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export class NotificationModel {
	constructor(
		private readonly storage: NotificationStorage,
		private readonly secrets: SecretBox | null,
		private readonly tokens: SessionTokens,
		private readonly sender: Delivery,
	) {}

	private secret(id: string, encrypt: boolean, field: string, value: string | null): string | null {
		if (value === null) {
			return null;
		}
		if (!this.secrets) {
			throw new OperationsFailure('storage_unavailable');
		}
		const scope = 'notification:' + id + ':' + field;
		try {
			return encrypt ? this.secrets.encrypt(value, scope) : this.secrets.decrypt(value, scope);
		} catch (error) {
			throw new OperationsFailure('internal_failure', { cause: error });
		}
	}

	private fromStorage(value: StoredNotificationSetting): NotificationSetting {
		return {
			id: value.id,
			version: value.version,
			name: value.name,
			enabled: value.enabled,
			events: value.events.map((e) => e),
			config: fromStorageConfig(value.config, (field, v) => this.secret(value.id, false, field, v)),
			createdAt: value.createdAt,
			updatedAt: value.updatedAt,
		};
	}

	list(): Promise<NotificationSetting[]> {
		return operationsStorage(async () => (await this.storage.list()).map((v) => this.fromStorage(v)));
	}

	mutate(
		actor: NotificationActor,
		id: string,
		admit: (identity: number | null, pending: number) => void,
		change: (current: NotificationSetting | null, count: number, now: number) => NotificationSetting | null,
	): Promise<NotificationSetting | null> {
		return operationsStorage(async () => {
			const value = await this.storage.mutate(
				id,
				this.tokens.digest(actor.token),
				(id, pending) => admit(id, pending),
				(stored, count, now) => {
					const value = change(stored ? this.fromStorage(stored) : null, count, now);
					return value
						? {
								id: value.id,
								version: value.version,
								name: value.name,
								enabled: value.enabled,
								events: value.events.map((e) => e),
								config: toStorageConfig(value.config, (field, v) =>
									this.secret(value.id, true, field, v),
								),
								createdAt: value.createdAt,
								updatedAt: value.updatedAt,
							}
						: null;
				},
			);
			try {
				return value ? this.fromStorage(value) : null;
			} catch (error) {
				throw new OperationsFailure('operation_unknown', { cause: error });
			}
		});
	}

	async test(
		actor: NotificationActor,
		id: string,
		deliveryId: string,
		admit: (identity: number | null, pending: number) => void,
	): Promise<NotificationDelivery> {
		return delivery(
			await operationsStorage(() =>
				this.storage.test(
					id,
					this.tokens.digest(actor.token),
					(value, pending) => admit(value, pending),
					deliveryId,
				),
			),
		);
	}

	async testConfig(
		actor: NotificationActor,
		id: string,
		value: NotificationConfig,
		admit: (identity: number | null, pending: number) => void,
	): Promise<NotificationDelivery> {
		const stored = toStorageConfig(value, (field, v) => this.secret(id, true, field, v));
		return delivery(
			await operationsStorage(() =>
				this.storage.testConfig(
					id,
					this.tokens.digest(actor.token),
					(identity, pending) => admit(identity, pending),
					stored,
				),
			),
		);
	}

	fanout(select: (facts: NotificationFanout) => string[] | null): Promise<number> {
		return operationsStorage(() =>
			this.storage.fanout((facts) =>
				select({
					event: facts.event,
					createdAt: facts.createdAt,
					pending: facts.pending,
					candidates: facts.candidates.map((value) => ({
						id: value.id,
						events: value.events.map((event) => event),
						createdAt: value.createdAt,
					})),
				}),
			),
		);
	}

	recover(command: NotificationRecovery): Promise<void> {
		return operationsStorage(() =>
			this.storage.recover({
				discardQueued: command.discardQueued,
				suppressHistoricalFanout: command.suppressHistoricalFanout,
			}),
		);
	}

	async next(): Promise<NotificationDispatch | null> {
		return operationsStorage(async () => {
			const value = await this.storage.next();
			return value
				? {
						delivery: delivery(value.delivery),
						config: fromStorageConfig(value.config, (field, v) =>
							this.secret(value.delivery.settingId ?? value.delivery.id, false, field, v),
						),
						subjectId: value.subjectId,
					}
				: null;
		});
	}

	settle(id: string, status: NotificationDeliveryOutcome, retain: number): Promise<void> {
		return operationsStorage(() => this.storage.settle(id, status, retain));
	}

	async deliveries(offset: number, limit: number): Promise<NotificationDelivery[]> {
		return (await operationsStorage(() => this.storage.deliveries(offset, limit))).map(delivery);
	}

	async send(input: NotificationDispatch, body: string, signal: AbortSignal): Promise<void> {
		const cfg = input.config;
		let request: DeliveryRequest;
		if (cfg.kind === 'email') {
			request = {
				kind: 'smtp',
				host: cfg.host,
				port: cfg.port,
				secure: cfg.secure,
				username: cfg.username,
				password: cfg.password,
				to: cfg.to,
				from: cfg.from,
				subject: input.delivery.event,
				body,
			};
		} else if (cfg.kind === 'telegram') {
			if (cfg.botToken === null) {
				throw new OperationsFailure('delivery_failed');
			}
			request = {
				kind: 'http',
				url: cfg.origin + '/bot' + encodeURIComponent(cfg.botToken) + '/sendMessage',
				method: 'POST',
				headers: [{ name: 'content-type', value: 'application/json' }],
				body: JSON.stringify({ chat_id: cfg.chatId, text: body }),
			};
		} else {
			request = {
				kind: 'http',
				url: cfg.url,
				method: cfg.method,
				headers: cfg.headers
					.filter((h) => h.value !== null)
					.map((h) => ({ name: h.name, value: h.value ?? '' })),
				body: cfg.method === 'GET' ? null : body,
			};
		}
		try {
			await this.sender.send(request, signal);
		} catch (error) {
			if (error instanceof DeliveryFailure) {
				if (error.kind === 'cleanup_failed') {
					throw new NotificationCleanupFailure({ cause: error });
				}
				throw new OperationsFailure(error.kind === 'failed' ? 'delivery_failed' : 'delivery_unknown', {
					cause: error,
				});
			}
			throw new OperationsFailure('delivery_unknown', { cause: error });
		}
	}
}
