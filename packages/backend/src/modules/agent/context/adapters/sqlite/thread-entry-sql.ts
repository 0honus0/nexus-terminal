import { AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS } from '@nexus-terminal/shared/agent/scope/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	StoredThreadEntries,
	StoredThreadEntryCursor,
	StoredThreadEntryHistory,
} from '../../storage/context-storage.js';
import { storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';

const ENTRY_SOURCE = `WITH entries AS (
 SELECT r.id AS run_id,r.thread_sequence AS run_sequence,0 AS step_index,0 AS event_sequence,
 'user' AS role,r.input_text AS body FROM agent_runs r WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root'
 UNION ALL
 SELECT r.id,r.thread_sequence,e.step_index,e.sequence,'assistant',e.text_delta
 FROM agent_runs r JOIN agent_run_model_step_events e ON e.run_id=r.id
 WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND e.kind='text.delta'
)`;

const ENTRIES = `${ENTRY_SOURCE}
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

// Select the page's positions before reading its potentially large persisted text bodies.
const PREVIOUS_ENTRIES = `WITH positions AS (
 SELECT r.id AS run_id,r.thread_sequence AS run_sequence,0 AS step_index,0 AS event_sequence,'user' AS role
 FROM agent_runs r WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root'
 UNION ALL
 SELECT r.id,r.thread_sequence,e.step_index,e.sequence,'assistant'
 FROM agent_runs r JOIN agent_run_model_step_events e ON e.run_id=r.id
 WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND e.kind='text.delta'
), recent AS MATERIALIZED (
 SELECT * FROM positions WHERE ?=1 OR (run_sequence,step_index,event_sequence)<(?,?,?) OR
 ((run_sequence,step_index,event_sequence)=(?,?,?) AND ?>0)
 ORDER BY run_sequence DESC,step_index DESC,event_sequence DESC LIMIT ?
), bodies AS (
 SELECT recent.*,CASE WHEN recent.role='user' THEN r.input_text ELSE e.text_delta END AS body
 FROM recent JOIN agent_runs r ON r.id=recent.run_id
 LEFT JOIN agent_run_model_step_events e ON recent.role='assistant' AND e.run_id=recent.run_id
 AND e.step_index=recent.step_index AND e.sequence=recent.event_sequence
), bounded AS (
 SELECT *,CASE WHEN (run_sequence,step_index,event_sequence)=(?,?,?)
 THEN MIN(?,nexus_text_length(body)) ELSE nexus_text_length(body) END AS end_offset FROM bodies
)
SELECT run_id,run_sequence,step_index,event_sequence,role,end_offset,
 MAX(0,end_offset-?) AS text_offset,nexus_text_slice(body,MAX(0,end_offset-?),MIN(end_offset,?)) AS fragment
FROM bounded ORDER BY run_sequence DESC,step_index DESC,event_sequence DESC`;

export async function readPreviousThreadEntries(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	threadId: string,
	before: StoredThreadEntryCursor | null,
	limit: number,
): Promise<StoredThreadEntryHistory | null> {
	const thread = await tx.one('SELECT id,app_id FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
		userId,
		appId,
		threadId,
	]);
	if (!thread) {
		return null;
	}
	const bound = before ?? { runSequence: 0, stepIndex: 0, eventSequence: 0, textOffset: 0 };
	const rows = await tx.all(PREVIOUS_ENTRIES, [
		userId,
		appId,
		threadId,
		userId,
		appId,
		threadId,
		before === null ? 1 : 0,
		bound.runSequence,
		bound.stepIndex,
		bound.eventSequence,
		bound.runSequence,
		bound.stepIndex,
		bound.eventSequence,
		bound.textOffset,
		limit + 1,
		bound.runSequence,
		bound.stepIndex,
		bound.eventSequence,
		bound.textOffset,
		AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS,
		AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS,
		AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS,
	]);
	const items: StoredThreadEntries['items'] = [];
	let startCursor = bound;
	for (const row of rows.slice(0, limit)) {
		const text = storedText(row.fragment);
		const start = storedInteger(row.text_offset);
		const end = storedInteger(row.end_offset, 1);
		if (
			(row.role !== 'user' && row.role !== 'assistant') ||
			!text.length ||
			Buffer.from(text, 'utf8').toString('utf8') !== text ||
			Array.from(text).length !== end - start
		) {
			throw new Error('Corrupt thread history fragment');
		}
		const position = {
			runSequence: storedInteger(row.run_sequence, 1),
			stepIndex: storedInteger(row.step_index),
			eventSequence: storedInteger(row.event_sequence),
			textOffset: end,
		};
		if ((row.role === 'user') !== (position.stepIndex === 0 && position.eventSequence === 0)) {
			throw new Error('Corrupt thread history position');
		}
		items.push({ runId: storedText(row.run_id), role: row.role, position, text });
		startCursor = {
			runSequence: position.runSequence,
			stepIndex: position.stepIndex,
			eventSequence: position.eventSequence,
			textOffset: start,
		};
		if (start > 0) {
			break;
		}
	}
	items.reverse();
	return {
		startCursor,
		hasEarlier: rows.length > items.length || (items.length > 0 && startCursor.textOffset > 0),
		body: {
			appId: storedText(thread.app_id),
			threadId: storedText(thread.id),
			items,
			nextCursor: items.at(-1)?.position ?? bound,
		},
	};
}
