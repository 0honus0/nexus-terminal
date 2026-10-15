import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { StoredHistory } from '../../storage/history-storage.js';
import { HISTORY_TEXT_MAX_BYTES } from '@nexus-terminal/shared/preferences/history/values';

export function historyRow(row: SqlRow | null): StoredHistory {
	if (
		!row ||
		typeof row.id !== 'number' ||
		!Number.isSafeInteger(row.id) ||
		row.id < 1 ||
		typeof row.recorded_at !== 'number' ||
		!Number.isSafeInteger(row.recorded_at) ||
		row.recorded_at < 0 ||
		typeof row.text !== 'string' ||
		!row.text.trim() ||
		row.text.includes('\0') ||
		Buffer.from(row.text, 'utf8').toString('utf8') !== row.text ||
		Buffer.byteLength(row.text, 'utf8') > HISTORY_TEXT_MAX_BYTES
	) {
		throw new Error('Corrupt history record');
	}
	return { id: row.id, text: row.text, recordedAt: row.recorded_at };
}
