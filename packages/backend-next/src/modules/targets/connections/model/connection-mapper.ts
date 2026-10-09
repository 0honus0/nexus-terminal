import type { ConnectionData, StoredConnection } from '../storage/connection-storage.js';
import type { ConnectionMetadata, ConnectionSnapshot } from './connection-types.js';

/** Application and storage metadata currently share a representation. */
export function toStorage(value: ConnectionMetadata): ConnectionData {
	return { ...value, tagIds: [...value.tagIds], jumpIds: [...value.jumpIds] };
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
	return { ...value, tagIds: [...value.tagIds], jumpIds: [...value.jumpIds] };
}
