import type { ConnectionData, StoredConnection } from '../storage/connection-storage.js';
import type { ConnectionMetadata, ConnectionSnapshot } from './connection-types.js';

/** Explicit application/storage projection, even while field representations match. */
export function toStorage(value: ConnectionMetadata): ConnectionData {
	return {
		name: value.name,
		type: value.type,
		host: value.host,
		port: value.port,
		username: value.username,
		route: value.route,
		proxyId: value.proxyId,
		notes: value.notes,
		rdpRemoteApp: value.rdpRemoteApp,
		rdpRemoteAppDirectory: value.rdpRemoteAppDirectory,
		rdpRemoteAppArguments: value.rdpRemoteAppArguments,
		tagIds: [...value.tagIds],
		jumpIds: [...value.jumpIds],
	};
}

export function fromStorage(value: StoredConnection): ConnectionSnapshot {
	if (
		!Number.isSafeInteger(value.id) ||
		value.id <= 0 ||
		!Number.isSafeInteger(value.version) ||
		value.version < 1 ||
		!['SSH', 'RDP', 'VNC'].includes(value.type) ||
		!['direct', 'proxy', 'jump'].includes(value.route) ||
		!Array.isArray(value.tagIds) ||
		!Array.isArray(value.jumpIds)
	) {
		throw new Error('Corrupt connection record');
	}
	return {
		id: value.id,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		name: value.name,
		type: value.type,
		host: value.host,
		port: value.port,
		username: value.username,
		route: value.route,
		proxyId: value.proxyId,
		notes: value.notes,
		rdpRemoteApp: value.rdpRemoteApp,
		rdpRemoteAppDirectory: value.rdpRemoteAppDirectory,
		rdpRemoteAppArguments: value.rdpRemoteAppArguments,
		tagIds: [...value.tagIds],
		jumpIds: [...value.jumpIds],
	};
}
