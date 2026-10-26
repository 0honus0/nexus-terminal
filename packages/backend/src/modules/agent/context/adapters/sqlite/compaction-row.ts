import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { StoredCompaction } from '../../storage/compaction-storage.js';
import { readContextSnapshot } from './context-row.js';
import { storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';

export function readCompaction(row: Record<string, unknown>): StoredCompaction {
	const state = row.state;
	if (
		state !== 'reserved' &&
		state !== 'dispatched' &&
		state !== 'completed' &&
		state !== 'failed' &&
		state !== 'unknown'
	) {
		throw new Error('Invalid automatic compaction state');
	}
	const source = readContextSnapshot({ content_json: row.source_json, content_hash: row.source_hash });
	const cut = storedInteger(row.cut_index, 1);
	const summary = row.summary_text === null ? null : storedText(row.summary_text);
	const input = row.input_tokens === null ? null : storedInteger(row.input_tokens);
	const output = row.output_tokens === null ? null : storedInteger(row.output_tokens);
	storedInteger(row.estimated_tokens, 1);
	storedInteger(row.updated_at, storedInteger(row.created_at));
	if (
		![row.id, row.run_id, row.root_id].every(
			(value) => typeof value === 'string' && AGENT_ID_PATTERN.test(value),
		) ||
		cut >= source.messages.length ||
		source.messages[cut].role === 'tool' ||
		(state === 'completed') !== (summary !== null) ||
		(summary !== null && (!summary.trim() || Buffer.byteLength(summary, 'utf8') > 16384)) ||
		(input === null) !== (output === null) ||
		(input !== null && output !== null && !Number.isSafeInteger(input + output)) ||
		![row.request_hash, row.creation_hash].every(
			(value) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value),
		)
	) {
		throw new Error('Invalid automatic compaction document');
	}
	return {
		id: storedText(row.id),
		rootId: storedText(row.root_id),
		runId: storedText(row.run_id),
		stepIndex: storedInteger(row.step_index, 1),
		state,
		source,
		cut,
		summary,
		inputTokens: input,
		outputTokens: output,
	};
}
