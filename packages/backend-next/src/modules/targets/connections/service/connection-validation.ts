import type { ConnectionMetadata } from '../model/connection-types.js';

export function validateId(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error('Invalid ID');
	}
}

export function validateConnection(data: ConnectionMetadata): ConnectionMetadata {
	if (!data.name.trim() || !data.host.trim() || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
		throw new Error('Invalid connection metadata');
	}
	if (!['SSH', 'RDP', 'VNC'].includes(data.type) || !['direct', 'proxy', 'jump'].includes(data.route)) {
		throw new Error('Invalid type or route');
	}
	if (
		(data.type !== 'RDP' &&
			(data.rdpRemoteApp !== null ||
				data.rdpRemoteAppDirectory !== null ||
				data.rdpRemoteAppArguments !== null)) ||
		(data.type === 'RDP' &&
			data.rdpRemoteApp === null &&
			(data.rdpRemoteAppDirectory !== null || data.rdpRemoteAppArguments !== null))
	) {
		throw new Error('RemoteApp options are only valid on RDP connections with an application');
	}
	if (
		(data.rdpRemoteApp !== null && (!data.rdpRemoteApp.trim() || data.rdpRemoteApp.length > 256)) ||
		(data.rdpRemoteAppDirectory !== null && data.rdpRemoteAppDirectory.length > 1024) ||
		(data.rdpRemoteAppArguments !== null && data.rdpRemoteAppArguments.length > 4096)
	) {
		throw new Error('Invalid RemoteApp settings');
	}
	for (const id of [...data.tagIds, ...data.jumpIds]) {
		validateId(id);
	}
	if (data.proxyId !== null) {
		validateId(data.proxyId);
	}
	return {
		...data,
		name: data.name.trim(),
		host: data.host.trim(),
		tagIds: [...data.tagIds],
		jumpIds: [...data.jumpIds],
	};
}

export function normalizeConnectionChanges(
	current: ConnectionMetadata,
	changes: Partial<ConnectionMetadata>,
): Partial<ConnectionMetadata> {
	const normalized = validateConnection({ ...current, ...changes });
	const patch: Partial<ConnectionMetadata> = {};
	if (changes.name !== undefined) {
		patch.name = normalized.name;
	}
	if (changes.type !== undefined) {
		patch.type = normalized.type;
	}
	if (changes.host !== undefined) {
		patch.host = normalized.host;
	}
	if (changes.port !== undefined) {
		patch.port = normalized.port;
	}
	if (changes.username !== undefined) {
		patch.username = normalized.username;
	}
	if (changes.route !== undefined) {
		patch.route = normalized.route;
	}
	if (changes.proxyId !== undefined) {
		patch.proxyId = normalized.proxyId;
	}
	if (changes.notes !== undefined) {
		patch.notes = normalized.notes;
	}
	if (changes.rdpRemoteApp !== undefined) {
		patch.rdpRemoteApp = normalized.rdpRemoteApp;
	}
	if (changes.rdpRemoteAppDirectory !== undefined) {
		patch.rdpRemoteAppDirectory = normalized.rdpRemoteAppDirectory;
	}
	if (changes.rdpRemoteAppArguments !== undefined) {
		patch.rdpRemoteAppArguments = normalized.rdpRemoteAppArguments;
	}
	if (changes.tagIds !== undefined) {
		patch.tagIds = normalized.tagIds;
	}
	if (changes.jumpIds !== undefined) {
		patch.jumpIds = normalized.jumpIds;
	}
	return patch;
}
