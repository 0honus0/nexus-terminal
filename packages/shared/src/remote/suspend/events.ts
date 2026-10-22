import type { SuspendedSessionView } from './http.js';
import { readSuspendedSessionCatalog, InvalidSuspendedHttpPayload } from './http-codec.js';
import { SUSPENDED_CATALOG_MAX_JSON_BYTES } from './values.js';

export const SUSPENDED_STREAM_MAX_JSON_BYTES = SUSPENDED_CATALOG_MAX_JSON_BYTES + 1024;

export type SuspendedCatalogEvent =
	{ type: 'snapshot'; revision: number; sessions: SuspendedSessionView[] } | { type: 'heartbeat' };

export function readSuspendedCatalogEvent(value: unknown): SuspendedCatalogEvent {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new InvalidSuspendedHttpPayload();
	}
	const encoded = JSON.stringify(value);
	if (new TextEncoder().encode(encoded).length > SUSPENDED_STREAM_MAX_JSON_BYTES) {
		throw new InvalidSuspendedHttpPayload();
	}
	if ('type' in value && value.type === 'heartbeat' && Object.keys(value).length === 1) {
		return { type: 'heartbeat' };
	}
	if (
		!('type' in value) ||
		value.type !== 'snapshot' ||
		!('revision' in value) ||
		typeof value.revision !== 'number' ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 1 ||
		!('sessions' in value) ||
		Object.keys(value).length !== 3
	) {
		throw new InvalidSuspendedHttpPayload();
	}
	return {
		type: 'snapshot',
		revision: value.revision,
		sessions: readSuspendedSessionCatalog(value.sessions),
	};
}
