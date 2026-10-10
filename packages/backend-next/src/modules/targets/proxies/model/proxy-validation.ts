import { TargetFailure } from '../../target-failure.js';
import type { ProxyMetadata, ProxyCommandPatch } from './proxy-types.js';

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
	return {
		name: data.name.trim(),
		type: data.type,
		host: data.host.trim(),
		port: data.port,
		username: data.username,
	};
}

export function normalizeProxyChanges(current: ProxyMetadata, fields: Partial<ProxyMetadata>): ProxyCommandPatch {
	const normalized = validateProxyMetadata({
		name: fields.name ?? current.name,
		type: fields.type ?? current.type,
		host: fields.host ?? current.host,
		port: fields.port ?? current.port,
		username: fields.username === undefined ? current.username : fields.username,
	});
	const patch: ProxyCommandPatch = {};
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
