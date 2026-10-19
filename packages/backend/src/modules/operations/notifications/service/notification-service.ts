import type { NotificationDeliveryOutcome } from '@nexus-terminal/shared/operations/notifications/values';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { randomUUID } from 'node:crypto';
import { OPERATION_EVENTS } from '@nexus-terminal/shared/operations/values';
import { NOTIFICATION_MAX_SETTINGS } from '@nexus-terminal/shared/operations/notifications/values';
import type { NotificationModel } from '../model/notification-model.js';
import type {
	NotificationActor,
	NotificationSetting,
	NotificationChange,
	NotificationConfig,
	NotificationConfigChange,
	SecretChange,
	NotificationDelivery,
} from '../model/notification-types.js';
import { OperationsFailure, NotificationCleanupFailure } from '../../operations-failure.js';

function admit(actor: NotificationActor): (identity: number | null) => void {
	return (id) => {
		if (id === null) {
			throw new OperationsFailure('unauthenticated');
		}
		if (id !== 1 || id !== actor.userId) {
			throw new OperationsFailure('forbidden');
		}
	};
}

function secret(change: SecretChange, previous: string | null): string | null {
	if (change.action === 'keep') {
		return previous;
	}
	if (change.action === 'clear') {
		return null;
	}
	if (!change.value || Buffer.byteLength(change.value, 'utf8') > 4096 || /[\r\n\0]/u.test(change.value)) {
		throw new OperationsFailure('invalid_input');
	}
	return change.value;
}

function url(value: string): void {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new OperationsFailure('invalid_input');
	}
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
		throw new OperationsFailure('invalid_input');
	}
}

function resolve(value: NotificationConfigChange, previous: NotificationConfig | null): NotificationConfig {
	if (value.kind === 'webhook') {
		url(value.url);
		return {
			kind: 'webhook',
			url: value.url,
			method: value.method,
			headers: value.headers.map((h) => ({
				name: h.name,
				value: secret(
					h.value,
					previous?.kind === 'webhook'
						? (previous.headers.find((old) => old.name.toLowerCase() === h.name.toLowerCase())?.value ??
								null)
						: null,
				),
			})),
			bodyTemplate: value.bodyTemplate,
		};
	}
	if (value.kind === 'email') {
		if (
			/[\r\n\0]/u.test(value.to + value.from + value.host + value.username) ||
			!value.to.includes('@') ||
			!value.from.includes('@') ||
			!value.host.trim()
		) {
			throw new OperationsFailure('invalid_input');
		}
		return {
			kind: 'email',
			to: value.to,
			from: value.from,
			host: value.host,
			port: value.port,
			secure: value.secure,
			username: value.username,
			password: secret(value.password, previous?.kind === 'email' ? previous.password : null),
			bodyTemplate: value.bodyTemplate,
		};
	}
	url(value.origin);
	const origin = new URL(value.origin);
	if (origin.origin !== value.origin) {
		throw new OperationsFailure('invalid_input');
	}
	const token = secret(value.botToken, previous?.kind === 'telegram' ? previous.botToken : null);
	if (token !== null && !/^[0-9]+:[A-Za-z0-9_-]+$/u.test(token)) {
		throw new OperationsFailure('invalid_input');
	}
	return {
		kind: 'telegram',
		origin: value.origin,
		chatId: value.chatId,
		botToken: token,
		bodyTemplate: value.bodyTemplate,
	};
}

export class NotificationService {
	private requested = false;
	private stopping = false;
	private pending: Promise<void> | null = null;
	private readonly controller = new AbortController();
	private readonly failures = new FailureSummary();
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: NotificationModel) {}

	async initialize(mode: 'startup' | 'restore'): Promise<void> {
		await this.model.recover({ discardQueued: mode === 'restore', suppressHistoricalFanout: mode === 'restore' });
		await this.fanout();
	}

	list(): Promise<NotificationSetting[]> {
		return this.model.list();
	}

	async change(
		actor: NotificationActor,
		id: string | null,
		version: number,
		change: NotificationChange,
	): Promise<NotificationSetting> {
		if (this.stopping) {
			throw new OperationsFailure('shutting_down');
		}
		if (
			!Number.isSafeInteger(version) ||
			version < 0 ||
			!change.name.trim() ||
			Buffer.byteLength(change.name, 'utf8') > 128 ||
			new Set(change.events).size !== change.events.length ||
			change.events.some((e) => !OPERATION_EVENTS.includes(e))
		) {
			throw new OperationsFailure('invalid_input');
		}
		const key = id ?? randomUUID();
		const value = await this.model.mutate(actor, key, admit(actor), (current, count, now) => {
			if ((current?.version ?? 0) !== version || (id !== null && current === null)) {
				throw new OperationsFailure('version_conflict');
			}
			if (version >= Number.MAX_SAFE_INTEGER) {
				throw new OperationsFailure('version_conflict');
			}
			if (current === null && count >= NOTIFICATION_MAX_SETTINGS) {
				throw new OperationsFailure('limit_exceeded');
			}
			return {
				id: key,
				version: version + 1,
				name: change.name,
				enabled: change.enabled,
				events: change.events.map((e) => e),
				config: resolve(change.config, current?.config ?? null),
				createdAt: current?.createdAt ?? now,
				updatedAt: now,
			};
		});
		if (value === null) {
			throw new OperationsFailure('internal_failure');
		}
		return value;
	}

	async delete(actor: NotificationActor, id: string, version: number): Promise<void> {
		if (this.stopping) {
			throw new OperationsFailure('shutting_down');
		}
		await this.model.mutate(actor, id, admit(actor), (current) => {
			if (!current) {
				throw new OperationsFailure('not_found');
			}
			if (current.version !== version) {
				throw new OperationsFailure('version_conflict');
			}
			return null;
		});
	}

	async testUnsaved(actor: NotificationActor, value: NotificationConfigChange): Promise<NotificationDelivery> {
		if (this.stopping) {
			throw new OperationsFailure('shutting_down');
		}
		const saved = await this.model.testConfig(actor, randomUUID(), resolve(value, null), (identity, pending) => {
			admit(actor)(identity);
			if (pending >= 4096) {
				throw new OperationsFailure('limit_exceeded');
			}
		});
		this.wake();
		return saved;
	}

	async test(actor: NotificationActor, id: string): Promise<NotificationDelivery> {
		if (this.stopping) {
			throw new OperationsFailure('shutting_down');
		}
		const value = await this.model.test(actor, id, randomUUID(), (identity, pending) => {
			admit(actor)(identity);
			if (pending >= 4096) {
				throw new OperationsFailure('limit_exceeded');
			}
		});
		this.wake();
		return value;
	}

	async fanout(): Promise<void> {
		if (this.stopping) {
			throw new OperationsFailure('shutting_down');
		}
		while (
			(await this.model.fanout((facts) => {
				const selected = facts.candidates
					.filter(
						(candidate) => candidate.createdAt <= facts.createdAt && candidate.events.includes(facts.event),
					)
					.map((candidate) => candidate.id);
				if (facts.pending + selected.length > 4096) {
					return null;
				}
				return selected;
			})) === 100
		) {
			if (this.stopping) {
				throw new OperationsFailure('shutting_down');
			}
		}
		this.wake();
	}

	async deliveries(
		offset: number,
		limit: number,
	): Promise<{ items: NotificationDelivery[]; nextOffset: number | null }> {
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset > 1000000 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 200
		) {
			throw new OperationsFailure('invalid_input');
		}
		const values = await this.model.deliveries(offset, limit + 1);
		return { items: values.slice(0, limit), nextOffset: values.length > limit ? offset + limit : null };
	}

	private wake(): void {
		this.requested = true;
		if (this.stopping || this.pending !== null) {
			return;
		}
		this.pending = Promise.resolve().then(() => this.drain());
		void this.pending.then(
			() => {
				this.pending = null;
				if (this.requested) {
					this.wake();
				}
			},
			(error) => {
				this.failures.record(error);
				this.quiesce();
				this.pending = null;
			},
		);
	}

	private async drain(): Promise<void> {
		this.requested = false;
		while (!this.stopping) {
			const next = await this.model.next();
			if (next === null) {
				return;
			}
			const deadline = AbortSignal.timeout(20000);
			const signal = AbortSignal.any([this.controller.signal, deadline]);
			const time = new Date(next.delivery.createdAt).toISOString();
			const body =
				next.config.bodyTemplate === null && next.config.kind === 'webhook'
					? JSON.stringify({ event: next.delivery.event, subjectId: next.subjectId, time })
					: (next.config.bodyTemplate ?? '{event} {subjectId} {time}').replace(
							/\{(event|subjectId|time)\}/gu,
							(_, field: string) =>
								field === 'event'
									? next.delivery.event
									: field === 'subjectId'
										? (next.subjectId ?? '')
										: time,
						);
			let status: NotificationDeliveryOutcome = 'sent';
			let cleanupFailure: NotificationCleanupFailure | null = null;
			try {
				await this.model.send(next, body, signal);
			} catch (error) {
				if (
					!(error instanceof OperationsFailure) ||
					(error.code !== 'delivery_failed' && error.code !== 'delivery_unknown')
				) {
					throw error;
				}
				status = error.code === 'delivery_failed' ? 'failed' : 'unknown';
				if (error instanceof NotificationCleanupFailure) {
					cleanupFailure = error;
					this.quiesce();
				}
			}
			try {
				await this.model.settle(next.delivery.id, status, 50000);
			} catch (error) {
				throw cleanupFailure === null
					? error
					: new AggregateError([cleanupFailure, error], 'Notification cleanup and settlement failed');
			}
			if (cleanupFailure !== null) {
				throw cleanupFailure;
			}
			if (!this.stopping) {
				await this.fanout();
			}
		}
	}

	quiesce(): void {
		this.stopping = true;
		this.controller.abort();
	}

	close(): Promise<void> {
		if (this.closePromise === null) {
			this.closePromise = Promise.resolve().then(async () => {
				if (this.pending) {
					// wake owns rejection recording; closing only waits for that same task.
					await Promise.allSettled([this.pending]);
				}
				const errors = this.failures.errors();
				if (errors.length) {
					throw new AggregateError(errors, 'Notification owner failed');
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}
