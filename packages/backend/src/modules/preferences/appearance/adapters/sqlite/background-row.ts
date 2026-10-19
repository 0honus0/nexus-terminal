import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import {
	BACKGROUND_MEDIA_TYPES,
	BACKGROUND_KINDS,
	BACKGROUND_MAX_BYTES,
	BACKGROUND_ID_PATTERN,
} from '@nexus-terminal/shared/preferences/appearance/values';
import type { StoredBackground } from '../../storage/background-storage.js';

export function backgroundRow(row: SqlRow): StoredBackground {
	const kind = BACKGROUND_KINDS.find((kind) => kind === row.kind);
	const mediaType = BACKGROUND_MEDIA_TYPES.find((type) => type === row.media_type);
	if (
		typeof row.id !== 'string' ||
		!BACKGROUND_ID_PATTERN.test(row.id) ||
		typeof row.user_id !== 'number' ||
		!Number.isSafeInteger(row.user_id) ||
		row.user_id < 1 ||
		!kind ||
		!mediaType ||
		typeof row.size_bytes !== 'number' ||
		!Number.isSafeInteger(row.size_bytes) ||
		row.size_bytes < 1 ||
		row.size_bytes > BACKGROUND_MAX_BYTES ||
		typeof row.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(row.sha256) ||
		typeof row.status !== 'string' ||
		!['pending', 'ready', 'retired'].includes(row.status)
	) {
		throw new Error('Corrupt background');
	}
	return { id: row.id, userId: row.user_id, kind, mediaType, sizeBytes: row.size_bytes, sha256: row.sha256 };
}
