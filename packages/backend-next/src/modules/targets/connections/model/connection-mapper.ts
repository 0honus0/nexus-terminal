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

export function toStoragePatch(changes: Partial<ConnectionMetadata>): Partial<ConnectionData> {
	const patch: Partial<ConnectionData> = {};
	if (changes.name !== undefined) {
		patch.name = changes.name;
	}
	if (changes.type !== undefined) {
		patch.type = changes.type;
	}
	if (changes.host !== undefined) {
		patch.host = changes.host;
	}
	if (changes.port !== undefined) {
		patch.port = changes.port;
	}
	if (changes.username !== undefined) {
		patch.username = changes.username;
	}
	if (changes.route !== undefined) {
		patch.route = changes.route;
	}
	if (changes.proxyId !== undefined) {
		patch.proxyId = changes.proxyId;
	}
	if (changes.notes !== undefined) {
		patch.notes = changes.notes;
	}
	if (changes.rdpRemoteApp !== undefined) {
		patch.rdpRemoteApp = changes.rdpRemoteApp;
	}
	if (changes.rdpRemoteAppDirectory !== undefined) {
		patch.rdpRemoteAppDirectory = changes.rdpRemoteAppDirectory;
	}
	if (changes.rdpRemoteAppArguments !== undefined) {
		patch.rdpRemoteAppArguments = changes.rdpRemoteAppArguments;
	}
	if (changes.tagIds !== undefined) {
		patch.tagIds = [...changes.tagIds];
	}
	if (changes.jumpIds !== undefined) {
		patch.jumpIds = [...changes.jumpIds];
	}
	return patch;
}
