import type { ConnectionMetadata } from '../model/connection-types.js';

export function validId(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid ID');
}

export function validateConnection(data: ConnectionMetadata): ConnectionMetadata {
	if (!data.name.trim() || !data.host.trim() || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535) {
		throw new Error('Invalid connection metadata');
	}
	if (!['SSH', 'RDP', 'VNC'].includes(data.type) || !['direct', 'proxy', 'jump'].includes(data.route)) {
		throw new Error('Invalid type or route');
	}
	for (const id of [...data.tagIds, ...data.jumpIds]) validId(id);
	if (data.proxyId !== null) validId(data.proxyId);
	return {
		...data,
		name: data.name.trim(),
		host: data.host.trim(),
		tagIds: [...data.tagIds],
		jumpIds: [...data.jumpIds],
	};
}
