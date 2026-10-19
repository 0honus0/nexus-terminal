import {
	TARGET_PROXY_NAME_MAX_BYTES,
	TARGET_PROXY_HOST_MAX_BYTES,
	TARGET_PROXY_USERNAME_MAX_BYTES,
	TARGET_PROXY_PASSWORD_MAX_BYTES,
} from '@nexus-terminal/shared/targets/proxies/values';
import { validateTargetText } from '../target-validation.js';
import { TargetFailure } from '../target-failure.js';
import type { ProxyMetadata, ProxyChanges } from './model/proxy-types.js';

export function validateProxyPassword(value: string): string {
	validateTargetText(value, TARGET_PROXY_PASSWORD_MAX_BYTES);
	if (!value) {
		throw new TargetFailure('invalid_input');
	}
	return value;
}

/** Shared normalization for management and transaction-local import. */
export function validateProxyMetadata(data: ProxyMetadata): ProxyMetadata {
	if (
		typeof data.name !== 'string' ||
		!data.name.trim() ||
		typeof data.host !== 'string' ||
		!data.host.trim() ||
		(data.type !== 'HTTP' && data.type !== 'SOCKS5') ||
		!Number.isSafeInteger(data.port) ||
		data.port < 1 ||
		data.port > 65535 ||
		(data.username !== null && typeof data.username !== 'string')
	) {
		throw new TargetFailure('invalid_input');
	}
	const name = validateTargetText(data.name, TARGET_PROXY_NAME_MAX_BYTES, false).trim();
	const host = validateTargetText(data.host, TARGET_PROXY_HOST_MAX_BYTES, false).trim();
	if (data.username !== null) {
		validateTargetText(data.username, TARGET_PROXY_USERNAME_MAX_BYTES);
	}
	return {
		name,
		type: data.type,
		host,
		port: data.port,
		username: data.username,
	};
}

export function normalizeProxyChanges(current: ProxyMetadata, fields: Partial<ProxyMetadata>): ProxyChanges {
	const normalized = validateProxyMetadata({
		name: fields.name ?? current.name,
		type: fields.type ?? current.type,
		host: fields.host ?? current.host,
		port: fields.port ?? current.port,
		username: fields.username === undefined ? current.username : fields.username,
	});
	const patch: ProxyChanges = {};
	if (fields.name !== undefined) {
		patch.name = normalized.name;
	}
	if (fields.type !== undefined) {
		patch.type = normalized.type;
	}
	if (fields.host !== undefined) {
		patch.host = normalized.host;
	}
	if (fields.port !== undefined) {
		patch.port = normalized.port;
	}
	if (fields.username !== undefined) {
		patch.username = normalized.username;
	}
	return patch;
}
