import type {
	NotificationConfigInput,
	NotificationCreateRequest,
} from '@nexus-terminal/shared/operations/notifications/http';
import type {
	NotificationConfigView,
	NotificationSettingView,
	NotificationDeliveryView,
} from '@nexus-terminal/shared/operations/notifications/model';
import type {
	NotificationConfigChange,
	NotificationChange,
	SecretChange,
	NotificationSetting,
	NotificationDelivery,
} from '../../notifications/model/notification-types.js';
import type { AuditRecord } from '../../audit/model/audit-types.js';
import type { AuditView } from '@nexus-terminal/shared/operations/audit/model';

function secret(
	value: import('@nexus-terminal/shared/operations/notifications/http').NotificationSecretUpdate,
): SecretChange {
	return value.action === 'replace' ? { action: 'replace', value: value.value } : { action: value.action };
}

export function toNotificationConfigChange(value: NotificationConfigInput): NotificationConfigChange {
	if (value.kind === 'webhook') {
		return {
			kind: 'webhook',
			url: value.url,
			method: value.method,
			headers: value.headers.map((h) => ({ name: h.name, value: secret(h.value) })),
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
			password: secret(value.password),
			bodyTemplate: value.bodyTemplate,
		};
	}
	return {
		kind: 'telegram',
		origin: value.origin,
		chatId: value.chatId,
		botToken: secret(value.botToken),
		bodyTemplate: value.bodyTemplate,
	};
}

export function toNotificationChange(value: NotificationCreateRequest): NotificationChange {
	return {
		name: value.name,
		enabled: value.enabled,
		events: value.events.map((e) => e),
		config: toNotificationConfigChange(value.config),
	};
}

export function toNotificationView(value: NotificationSetting): NotificationSettingView {
	const cfg = value.config;
	let config: NotificationConfigView;
	if (cfg.kind === 'webhook') {
		config = {
			kind: 'webhook',
			url: cfg.url,
			method: cfg.method,
			headers: cfg.headers.map((h) => ({ name: h.name, hasValue: h.value !== null })),
			bodyTemplate: cfg.bodyTemplate,
		};
	} else if (cfg.kind === 'email') {
		config = {
			kind: 'email',
			to: cfg.to,
			from: cfg.from,
			host: cfg.host,
			port: cfg.port,
			secure: cfg.secure,
			username: cfg.username,
			hasPassword: cfg.password !== null,
			bodyTemplate: cfg.bodyTemplate,
		};
	} else {
		config = {
			kind: 'telegram',
			origin: cfg.origin,
			chatId: cfg.chatId,
			hasBotToken: cfg.botToken !== null,
			bodyTemplate: cfg.bodyTemplate,
		};
	}
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		enabled: value.enabled,
		events: value.events.map((e) => e),
		config,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toDeliveryView(value: NotificationDelivery): NotificationDeliveryView {
	return {
		id: value.id,
		settingId: value.settingId,
		event: value.event,
		status: value.status,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toAuditView(value: AuditRecord): AuditView {
	return {
		id: value.id,
		event: value.event,
		createdAt: value.createdAt,
		userId: value.userId,
		sourceIp: value.sourceIp,
		subjectId: value.subjectId,
		route: value.route,
		statusCode: value.statusCode,
	};
}
