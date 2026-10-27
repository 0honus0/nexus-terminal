import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { storedInteger } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import type { StoredTitleRecord } from '../../storage/title-storage.js';

/** Snapshot validation uses the same journal schema, including optional usage pairing. */
export function readThreadTitle(row: SqlRow): StoredTitleRecord {
	if (
		typeof row.run_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.run_id) ||
		typeof row.thread_id !== 'string' ||
		!AGENT_ID_PATTERN.test(row.thread_id)
	) {
		throw new Error('Corrupt title scope');
	}
	const state = row.state;
	if (
		state !== 'reserved' &&
		state !== 'dispatched' &&
		state !== 'completed' &&
		state !== 'failed' &&
		state !== 'unknown'
	) {
		throw new Error('Corrupt title state');
	}
	for (const key of ['creation_hash', 'request_hash']) {
		if (typeof row[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(row[key])) {
			throw new Error('Corrupt title identity');
		}
	}
	const threadVersion = storedInteger(row.thread_version, 1);
	storedInteger(row.estimated_tokens, 1);
	const created = storedInteger(row.created_at);
	if (storedInteger(row.updated_at) < created || (row.input_tokens === null) !== (row.output_tokens === null)) {
		throw new Error('Corrupt title accounting');
	}
	if (row.input_tokens !== null) {
		if (!Number.isSafeInteger(storedInteger(row.input_tokens) + storedInteger(row.output_tokens))) {
			throw new Error('Corrupt title usage total');
		}
	}
	if (typeof row.creation_hash !== 'string') {
		throw new Error('Corrupt title creation identity');
	}
	return { runId: row.run_id, threadId: row.thread_id, threadVersion, creationHash: row.creation_hash, state };
}
