import type {
	NotificationConfigView,
	NotificationSettingView,
	NotificationDeliveryView,
} from '@nexus-terminal/shared/operations/notifications/model';
import type {
	NotificationConfigInput,
	NotificationSecretUpdate,
	NotificationCreateRequest,
} from '@nexus-terminal/shared/operations/notifications/http';
import type {
	NotificationConfig,
	NotificationConfigChange,
	NotificationSetting,
	NotificationChange,
	NotificationDelivery,
	NotificationSecret,
} from './notification-types';

function fromConfig(value: NotificationConfigView): NotificationConfig {
	if (value.kind === 'webhook') {
		return {
			kind: 'webhook',
			url: value.url,
			method: value.method,
			headers: value.headers.map((header) => ({ name: header.name, hasValue: header.hasValue })),
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
			hasPassword: value.hasPassword,
			bodyTemplate: value.bodyTemplate,
		};
	}
	return {
		kind: 'telegram',
		origin: value.origin,
		chatId: value.chatId,
		hasBotToken: value.hasBotToken,
		bodyTemplate: value.bodyTemplate,
	};
}

export function fromNotification(value: NotificationSettingView): NotificationSetting {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		enabled: value.enabled,
		events: value.events.map((event) => event),
		config: fromConfig(value.config),
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function fromDelivery(value: NotificationDeliveryView): NotificationDelivery {
	return {
		id: value.id,
		settingId: value.settingId,
		event: value.event,
		status: value.status,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toSecret(value: NotificationSecret): NotificationSecretUpdate {
	if (value.action === 'replace') {
		return { action: 'replace', value: value.value };
	}
	return value.action === 'keep' ? { action: 'keep' } : { action: 'clear' };
}

export function toNotificationConfig(value: NotificationConfigChange): NotificationConfigInput {
	if (value.kind === 'webhook') {
		return {
			kind: 'webhook',
			url: value.url,
			method: value.method,
			headers: value.headers.map((header) => ({ name: header.name, value: toSecret(header.value) })),
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
			password: toSecret(value.password),
			bodyTemplate: value.bodyTemplate,
		};
	}
	return {
		kind: 'telegram',
		origin: value.origin,
		chatId: value.chatId,
		botToken: toSecret(value.botToken),
		bodyTemplate: value.bodyTemplate,
	};
}

export function toNotificationChange(value: NotificationChange): NotificationCreateRequest {
	return {
		name: value.name,
		enabled: value.enabled,
		events: value.events.map((event) => event),
		config: toNotificationConfig(value.config),
	};
}

export function toNotificationToggleChange(value: NotificationSetting): NotificationChange {
	const config = value.config;
	if (config.kind === 'webhook') {
		return {
			name: value.name,
			enabled: !value.enabled,
			events: value.events.map((event) => event),
			config: {
				kind: 'webhook',
				url: config.url,
				method: config.method,
				headers: config.headers.map((header) => ({ name: header.name, value: { action: 'keep' } })),
				bodyTemplate: config.bodyTemplate,
			},
		};
	}
	if (config.kind === 'email') {
		return {
			name: value.name,
			enabled: !value.enabled,
			events: value.events.map((event) => event),
			config: {
				kind: 'email',
				to: config.to,
				from: config.from,
				host: config.host,
				port: config.port,
				secure: config.secure,
				username: config.username,
				password: { action: 'keep' },
				bodyTemplate: config.bodyTemplate,
			},
		};
	}
	return {
		name: value.name,
		enabled: !value.enabled,
		events: value.events.map((event) => event),
		config: {
			kind: 'telegram',
			origin: config.origin,
			chatId: config.chatId,
			botToken: { action: 'keep' },
			bodyTemplate: config.bodyTemplate,
		},
	};
}

export function snapshotNotificationChange(value: NotificationChange): NotificationChange {
	return {
		name: value.name,
		enabled: value.enabled,
		events: value.events.map((event) => event),
		config: toNotificationConfig(value.config),
	};
}
