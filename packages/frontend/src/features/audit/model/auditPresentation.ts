import type { AuditEntry } from './audit-types';

const ROUTE_SCOPES = [
	['/api/v1/path-history', 'pathHistory'],
	['/api/v1/command-history', 'commandHistory'],
	['/api/v1/targets/connections', 'connections'],
	['/api/v1/targets/proxies', 'proxies'],
	['/api/v1/targets/ssh-keys', 'sshKeys'],
	['/api/v1/targets/tags', 'tags'],
	['/api/v1/settings/notifications', 'notifications'],
	['/api/v1/settings', 'settings'],
	['/api/v1/agent', 'agent'],
	['/api/v1/auth', 'account'],
] as const;

const EVENT_SCOPES = [
	['LOGIN_', 'account'],
	['LOGOUT', 'account'],
	['PASSWORD_', 'account'],
	['2FA_', 'account'],
	['PASSKEY_', 'account'],
	['IP_BLOCKED', 'account'],
	['CONNECTION_', 'connections'],
	['SSH_CONNECT_', 'connections'],
	['SSH_SHELL_', 'connections'],
	['PROXY_', 'proxies'],
	['SSH_KEY_', 'sshKeys'],
	['TAG_', 'tags'],
	['NOTIFICATION_SETTING_', 'notifications'],
	['SETTINGS_', 'settings'],
	['CAPTCHA_', 'settings'],
	['IP_WHITELIST_', 'settings'],
	['AGENT_', 'agent'],
] as const;

export type AuditEventKind = 'security' | 'connection' | 'agent' | 'configuration' | 'activity';

export interface AuditEventVisual {
	kind: AuditEventKind;
	icon: string;
}

export function auditContextKey(log: AuditEntry): string | null {
	if (log.route !== null) {
		const routeScope = ROUTE_SCOPES.find(([prefix]) => log.route === prefix || log.route?.startsWith(prefix + '/'));
		if (routeScope) return `auditLog.scopes.${routeScope[1]}`;
	}
	return auditEventContextKey(log.event);
}

export function auditEventContextKey(event: string): string | null {
	const eventScope = EVENT_SCOPES.find(([prefix]) => event.startsWith(prefix));
	return eventScope ? `auditLog.scopes.${eventScope[1]}` : null;
}

export function auditEventVisual(event: string): AuditEventVisual {
	if (event === 'IP_BLOCKED') return { kind: 'security', icon: 'fa-solid fa-ban' };
	if (event.startsWith('LOGIN_') || event === 'LOGOUT' || event.startsWith('PASSKEY_')) {
		return { kind: 'security', icon: 'fa-solid fa-shield-halved' };
	}
	if (event === 'PASSWORD_CHANGED' || event.startsWith('2FA_') || event.startsWith('SSH_KEY_')) {
		return { kind: 'security', icon: 'fa-solid fa-key' };
	}
	if (event.startsWith('AGENT_')) return { kind: 'agent', icon: 'fa-solid fa-robot' };
	if (event.startsWith('SSH_CONNECT_') || event === 'SSH_SHELL_FAILURE') {
		return { kind: 'connection', icon: 'fa-solid fa-terminal' };
	}
	if (event.startsWith('CONNECTION_') || event.startsWith('REMOTE_')) {
		return { kind: 'connection', icon: 'fa-solid fa-server' };
	}
	if (event.startsWith('PROXY_')) return { kind: 'connection', icon: 'fa-solid fa-route' };
	if (event.startsWith('NOTIFICATION_')) return { kind: 'configuration', icon: 'fa-solid fa-bell' };
	if (event.startsWith('TAG_')) return { kind: 'configuration', icon: 'fa-solid fa-tags' };
	if (event.startsWith('SETTINGS_') || event.startsWith('CAPTCHA_') || event.startsWith('IP_WHITELIST_')) {
		return { kind: 'configuration', icon: 'fa-solid fa-sliders' };
	}
	if (event.startsWith('HTTP_MUTATION')) return { kind: 'activity', icon: 'fa-solid fa-pen-to-square' };
	if (event === 'DATABASE_MIGRATION' || event === 'ADMIN_SETUP_COMPLETE') {
		return { kind: 'configuration', icon: 'fa-solid fa-database' };
	}
	return { kind: 'activity', icon: 'fa-solid fa-clock-rotate-left' };
}
