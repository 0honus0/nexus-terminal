import { AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS } from '@nexus-terminal/shared/agent/scope/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	StoredThreadEntries,
	StoredThreadEntryCursor,
	StoredThreadEntryHistory,
} from '../../storage/context-storage.js';
import { storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';

const ENTRY_SOURCE = `WITH entries AS (
 SELECT r.id AS run_id,r.thread_sequence AS run_sequence,0 AS message_ordinal,0 AS chunk_index,
 'user' AS role,0 AS operation_sequence,r.input_text AS body FROM agent_runs r WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND r.input_text<>''
 UNION ALL
 SELECT r.id,r.thread_sequence,m.ordinal,c.chunk_index+1,'assistant',m.operation_sequence,c.text
 FROM agent_runs r JOIN agent_app_messages m ON m.run_id=r.id
 JOIN agent_app_message_chunks c ON c.message_id=m.id
 WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND c.text<>''
)`;

const ENTRIES = `${ENTRY_SOURCE}
SELECT run_id,run_sequence,message_ordinal,chunk_index,role,operation_sequence,nexus_text_length(body) AS text_length,
 CASE WHEN (run_sequence,message_ordinal,chunk_index)=(?,?,?) THEN ? ELSE 0 END AS text_offset,
 nexus_text_slice(body,CASE WHEN (run_sequence,message_ordinal,chunk_index)=(?,?,?) THEN ? ELSE 0 END,?) AS fragment
FROM entries
WHERE (run_sequence,message_ordinal,chunk_index)>(?,?,?) OR
 ((run_sequence,message_ordinal,chunk_index)=(?,?,?) AND nexus_text_length(body)>?)
ORDER BY run_sequence,message_ordinal,chunk_index LIMIT ?`;

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
		after.messageOrdinal,
		after.chunkIndex,
		after.textOffset,
		after.runSequence,
		after.messageOrdinal,
		after.chunkIndex,
		after.textOffset,
		AGENT_THREAD_ENTRY_MAX_TEXT_CODE_POINTS,
		after.runSequence,
		after.messageOrdinal,
		after.chunkIndex,
		after.runSequence,
		after.messageOrdinal,
		after.chunkIndex,
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
			messageOrdinal: storedInteger(row.message_ordinal),
			chunkIndex: storedInteger(row.chunk_index),
			textOffset: storedInteger(row.text_offset) + Array.from(text).length,
		};
		if ((row.role === 'user') !== (position.messageOrdinal === 0 && position.chunkIndex === 0)) {
			throw new Error('Corrupt thread entry position');
		}
		items.push({
			runId: storedText(row.run_id),
			operationSequence: storedInteger(row.operation_sequence),
			role: row.role,
			position,
			text,
		});
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
					messageOrdinal: after.messageOrdinal,
					chunkIndex: after.chunkIndex,
					textOffset: after.textOffset,
				},
	};
}

// Select the page's positions before reading its potentially large persisted text bodies.
const PREVIOUS_ENTRIES = `WITH positions AS (
 SELECT r.id AS run_id,r.thread_sequence AS run_sequence,0 AS message_ordinal,0 AS chunk_index,'user' AS role,0 AS operation_sequence,NULL AS message_id
 FROM agent_runs r WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND r.input_text<>''
 UNION ALL
 SELECT r.id,r.thread_sequence,m.ordinal,c.chunk_index+1,'assistant',m.operation_sequence,m.id
 FROM agent_runs r JOIN agent_app_messages m ON m.run_id=r.id
 JOIN agent_app_message_chunks c ON c.message_id=m.id
 WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND c.text<>''
), recent AS MATERIALIZED (
 SELECT * FROM positions WHERE ?=1 OR (run_sequence,message_ordinal,chunk_index)<(?,?,?) OR
 ((run_sequence,message_ordinal,chunk_index)=(?,?,?) AND ?>0)
 ORDER BY run_sequence DESC,message_ordinal DESC,chunk_index DESC LIMIT ?
), bodies AS (
 SELECT recent.*,CASE WHEN recent.role='user' THEN r.input_text ELSE c.text END AS body
 FROM recent JOIN agent_runs r ON r.id=recent.run_id
 LEFT JOIN agent_app_message_chunks c ON c.message_id=recent.message_id AND c.chunk_index+1=recent.chunk_index
), bounded AS (
 SELECT *,CASE WHEN (run_sequence,message_ordinal,chunk_index)=(?,?,?)
 THEN MIN(?,nexus_text_length(body)) ELSE nexus_text_length(body) END AS end_offset FROM bodies
)
SELECT run_id,run_sequence,message_ordinal,chunk_index,role,operation_sequence,end_offset,
 MAX(0,end_offset-?) AS text_offset,nexus_text_slice(body,MAX(0,end_offset-?),MIN(end_offset,?)) AS fragment
FROM bounded ORDER BY run_sequence DESC,message_ordinal DESC,chunk_index DESC`;

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
	const bound = before ?? { runSequence: 0, messageOrdinal: 0, chunkIndex: 0, textOffset: 0 };
	const rows = await tx.all(PREVIOUS_ENTRIES, [
		userId,
		appId,
		threadId,
		userId,
		appId,
		threadId,
		before === null ? 1 : 0,
		bound.runSequence,
		bound.messageOrdinal,
		bound.chunkIndex,
		bound.runSequence,
		bound.messageOrdinal,
		bound.chunkIndex,
		bound.textOffset,
		limit + 1,
		bound.runSequence,
		bound.messageOrdinal,
		bound.chunkIndex,
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
			messageOrdinal: storedInteger(row.message_ordinal),
			chunkIndex: storedInteger(row.chunk_index),
			textOffset: end,
		};
		if ((row.role === 'user') !== (position.messageOrdinal === 0 && position.chunkIndex === 0)) {
			throw new Error('Corrupt thread history position');
		}
		items.push({
			runId: storedText(row.run_id),
			operationSequence: storedInteger(row.operation_sequence),
			role: row.role,
			position,
			text,
		});
		startCursor = {
			runSequence: position.runSequence,
			messageOrdinal: position.messageOrdinal,
			chunkIndex: position.chunkIndex,
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
