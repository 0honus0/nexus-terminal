/** Text websocket protocol; data bytes encoded as canonical base64. */
export type RemoteClientEvent =
	| { type: 'input'; data: string }
	| { type: 'resize'; columns: number; rows: number }
	| { type: 'consumed'; bytes: number }
	| { type: 'close' };

export type RemoteServerEvent =
	| { type: 'ready'; sessionId: string }
	| { type: 'data'; data: string; stream: 'stdout' | 'stderr' }
	| { type: 'drain' }
	| { type: 'blocked' }
	| { type: 'closed' }
	| {
			type: 'error';
			code: 'invalid_input' | 'unauthenticated' | 'not_found' | 'transport_overflow' | 'remote_unavailable';
	  };

/** Both sides must reject unknown fields and malformed frame variants. */
export class InvalidRemoteFrame extends Error {
	constructor() {
		super('invalid_remote_frame');
	}
}

function frame(value: unknown, allowed: readonly string[]): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new InvalidRemoteFrame();
	}
	const row = value as Record<string, unknown>;
	if (Object.keys(row).some((key) => !allowed.includes(key)) || allowed.some((key) => !Object.hasOwn(row, key))) {
		throw new InvalidRemoteFrame();
	}
	return row;
}

function integer(value: unknown, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new InvalidRemoteFrame();
	}
	return value;
}

function base64(value: unknown, maxBytes: number): string {
	if (
		typeof value !== 'string' ||
		value.length > Math.ceil(maxBytes / 3) * 4 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
	) {
		throw new InvalidRemoteFrame();
	}
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	if ((value.length / 4) * 3 - padding > maxBytes) {
		throw new InvalidRemoteFrame();
	}
	return value;
}

export function readRemoteClientEvent(value: unknown): RemoteClientEvent {
	const header = frameHeader(value);
	switch (header.type) {
		case 'input': {
			const row = frame(value, ['type', 'data']);
			return { type: 'input', data: base64(row.data, 32 * 1024) };
		}
		case 'resize': {
			const row = frame(value, ['type', 'columns', 'rows']);
			return { type: 'resize', columns: integer(row.columns, 500), rows: integer(row.rows, 300) };
		}
		case 'consumed': {
			const row = frame(value, ['type', 'bytes']);
			return { type: 'consumed', bytes: integer(row.bytes, 128 * 1024) };
		}
		case 'close':
			frame(value, ['type']);
			return { type: 'close' };
		default:
			throw new InvalidRemoteFrame();
	}
}

function frameHeader(value: unknown): { type: unknown } {
	if (value === null || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'type')) {
		throw new InvalidRemoteFrame();
	}
	return value as { type: unknown };
}

export function readRemoteServerEvent(value: unknown): RemoteServerEvent {
	const header = frameHeader(value);
	switch (header.type) {
		case 'ready': {
			const row = frame(value, ['type', 'sessionId']);
			if (
				typeof row.sessionId !== 'string' ||
				!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(row.sessionId)
			) {
				throw new InvalidRemoteFrame();
			}
			return { type: 'ready', sessionId: row.sessionId };
		}
		case 'data': {
			const row = frame(value, ['type', 'data', 'stream']);
			if (row.stream !== 'stdout' && row.stream !== 'stderr') {
				throw new InvalidRemoteFrame();
			}
			return { type: 'data', data: base64(row.data, 32 * 1024), stream: row.stream };
		}
		case 'drain':
		case 'blocked':
		case 'closed':
			frame(value, ['type']);
			return { type: header.type };
		case 'error': {
			const row = frame(value, ['type', 'code']);
			switch (row.code) {
				case 'invalid_input':
				case 'unauthenticated':
				case 'not_found':
				case 'transport_overflow':
				case 'remote_unavailable':
					return { type: 'error', code: row.code };
				default:
					throw new InvalidRemoteFrame();
			}
		}
		default:
			throw new InvalidRemoteFrame();
	}
}
