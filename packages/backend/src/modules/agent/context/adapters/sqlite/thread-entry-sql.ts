import { AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS } from '@nexus-terminal/shared/agent/scope/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredThreadEntries, StoredThreadEntryCursor } from '../../storage/context-storage.js';
import { storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';

const ENTRIES = `WITH entries AS (
 SELECT r.id AS run_id,r.thread_sequence AS run_sequence,0 AS step_index,0 AS event_sequence,
 'user' AS role,r.input_text AS body FROM agent_runs r WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root'
 UNION ALL
 SELECT r.id,r.thread_sequence,e.step_index,e.sequence,'assistant',e.text_delta
 FROM agent_runs r JOIN agent_run_model_step_events e ON e.run_id=r.id
 WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND e.kind='text.delta'
)
SELECT run_id,run_sequence,step_index,event_sequence,role,nexus_text_length(body) AS text_length,
 CASE WHEN (run_sequence,step_index,event_sequence)=(?,?,?) THEN ? ELSE 0 END AS text_offset,
 nexus_text_slice(body,CASE WHEN (run_sequence,step_index,event_sequence)=(?,?,?) THEN ? ELSE 0 END,?) AS fragment
FROM entries
WHERE (run_sequence,step_index,event_sequence)>(?,?,?) OR
 ((run_sequence,step_index,event_sequence)=(?,?,?) AND nexus_text_length(body)>?)
ORDER BY run_sequence,step_index,event_sequence LIMIT ?`;

export async function readThreadEntries(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	threadId: string,
	after: StoredThreadEntryCursor,
	limit: number,
): Promise<StoredThreadEntries | null> {
	const thread = await tx.one('SELECT id,app_id FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
		userId,
		appId,
		threadId,
	]);
	if (!thread) {
		return null;
	}
	const rows = await tx.all(ENTRIES, [
		userId,
		appId,
		threadId,
		userId,
		appId,
		threadId,
		after.runSequence,
		after.stepIndex,
		after.eventSequence,
		after.textOffset,
		after.runSequence,
		after.stepIndex,
		after.eventSequence,
		after.textOffset,
		AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS,
		after.runSequence,
		after.stepIndex,
		after.eventSequence,
		after.runSequence,
		after.stepIndex,
		after.eventSequence,
		after.textOffset,
		limit,
	]);
	const items: StoredThreadEntries['items'] = [];
	for (const row of rows) {
		if (row.role !== 'user' && row.role !== 'assistant') {
			throw new Error('Corrupt thread entry role');
		}
		const text = storedText(row.fragment);
		if (!text.length || Buffer.from(text, 'utf8').toString('utf8') !== text) {
			throw new Error('Corrupt thread fragment');
		}
		const position = {
			runSequence: storedInteger(row.run_sequence, 1),
			stepIndex: storedInteger(row.step_index),
			eventSequence: storedInteger(row.event_sequence),
			textOffset: storedInteger(row.text_offset) + Array.from(text).length,
		};
		if ((row.role === 'user') !== (position.stepIndex === 0 && position.eventSequence === 0)) {
			throw new Error('Corrupt thread entry position');
		}
		items.push({ runId: storedText(row.run_id), role: row.role, position, text });
		if (position.textOffset < storedInteger(row.text_length, 1)) {
			break;
		}
	}
	return {
		appId: storedText(thread.app_id),
		threadId: storedText(thread.id),
		items,
		nextCursor: items.length
			? items[items.length - 1].position
			: {
					runSequence: after.runSequence,
					stepIndex: after.stepIndex,
					eventSequence: after.eventSequence,
					textOffset: after.textOffset,
				},
	};
}
