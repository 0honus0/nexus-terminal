import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredContextSnapshot } from '../../storage/context-storage.js';
import { readCompaction } from './compaction-row.js';
import { AUTO_SUMMARY_PREFIX } from '../../compaction-values.js';

/** Expand only an exact, completed, same-Run prefix replacement before causal journal validation. */
export async function expandAutomaticContext(
	tx: SqlExecutor,
	runId: string,
	context: StoredContextSnapshot,
): Promise<StoredContextSnapshot> {
	const first = context.messages[0];
	if (first?.role !== 'user' || !first.content.startsWith(AUTO_SUMMARY_PREFIX)) {
		return context;
	}
	const suffix = first.content.slice(AUTO_SUMMARY_PREFIX.length);
	const id = suffix.slice(0, suffix.indexOf('\n'));
	if (!AGENT_ID_PATTERN.test(id)) {
		return context;
	}
	const row = await tx.one("SELECT * FROM agent_context_compactions WHERE id=? AND run_id=? AND state='completed'", [
		id,
		runId,
	]);
	if (row === null) {
		return context;
	}

	const run = await tx.one('SELECT input_text FROM agent_runs WHERE id=?', [runId]);
	if (!run) {
		throw new Error('Missing compaction Run');
	}
	const record = readCompaction(row);
	if (first.content !== AUTO_SUMMARY_PREFIX + record.id + '\n' + record.summary) {
		return context;
	}
	if (JSON.stringify(context.sources) !== JSON.stringify(record.source.sources)) {
		throw new Error('Compaction source identity changed');
	}
	const oldTail = record.source.messages.slice(record.cut);
	const keepsPrompt = oldTail.some((message) => message.role === 'user' && message.content === run.input_text);
	const offset = keepsPrompt ? 1 : 2;
	if (!keepsPrompt && (context.messages[1]?.role !== 'user' || context.messages[1].content !== run.input_text)) {
		throw new Error('Compaction lost current input');
	}
	if (JSON.stringify(oldTail) !== JSON.stringify(context.messages.slice(offset, offset + oldTail.length))) {
		throw new Error('Compaction changed retained tail');
	}
	return {
		messages: [...record.source.messages.slice(0, record.cut), ...context.messages.slice(offset)],
		sources: context.sources,
	};
}
