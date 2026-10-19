import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { readThreadEntries } from './thread-entry-sql.js';
import type { StoredThreadEntries, StoredThreadEntryCursor } from '../../storage/context-storage.js';
import { checkpointRow } from './checkpoint-sql.js';
import { readContextSnapshot } from './context-row.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import {
	AGENT_RUN_STEP_MAX_TEXT_BYTES,
	AGENT_RUN_STATUSES,
	AGENT_RUN_STEP_STATES,
} from '@nexus-terminal/shared/agent/runs/values';
import { AGENT_TOOL_STATES } from '@nexus-terminal/shared/agent/tools/values';
import { currentParticipant, storedInteger, storedText } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { readStepProposals } from '../../../runs/adapters/sqlite/run-step-proposals.js';
import type {
	ContextStorage,
	StoredContextHistoryCommand,
	StoredContextHistoryFacts,
	StoredContextHistoryTurn,
	StoredContextHistoryBundle,
	StoredContextSource,
} from '../../storage/context-storage.js';

const HISTORY_SCOPE = `SELECT id FROM agent_runs WHERE user_id=? AND app_id=? AND thread_id=?
 AND run_kind='root' AND thread_sequence<? AND thread_sequence>?`;

function historyTurns(roots: SqlRow[], steps: SqlRow[], tools: SqlRow[]): StoredContextHistoryTurn[] {
	const turns = new Map<string, StoredContextHistoryTurn>();
	for (const row of roots) {
		const runId = storedText(row.id);
		const status = AGENT_RUN_STATUSES.find((value) => value === row.status);
		if (!status) {
			throw new Error('Corrupt historical Run status');
		}
		turns.set(runId, {
			source: {
				runId,
				version: storedInteger(row.version, 1),
				sequence: storedInteger(row.thread_sequence, 1),
				status,
			},
			input: storedText(row.input_text),
			steps: [],
		});
	}
	const indexes = new Map<string, Map<number, StoredContextHistoryTurn['steps'][number]>>();
	for (const row of steps) {
		const runId = storedText(row.run_id);
		const turn = turns.get(runId);
		const index = storedInteger(row.step_index, 1);
		const text = storedText(row.output_text);
		const bytes = storedInteger(row.text_bytes);
		const proposals = readStepProposals(row.proposals_json);
		const state = AGENT_RUN_STEP_STATES.find((value) => value === row.state);
		if (
			!turn ||
			index !== turn.steps.length + 1 ||
			!state ||
			(state === 'completed'
				? row.finish_reason !== 'stop' && row.finish_reason !== 'tool_calls'
				: row.finish_reason !== null) ||
			(row.finish_reason === 'tool_calls') !== proposals.length > 0 ||
			bytes > AGENT_RUN_STEP_MAX_TEXT_BYTES ||
			Buffer.byteLength(text) !== bytes ||
			(turn.steps.length > 0 &&
				(turn.steps[turn.steps.length - 1].state !== 'completed' ||
					turn.steps[turn.steps.length - 1].proposals.length === 0))
		) {
			throw new Error('Corrupt context history step');
		}
		const entry: StoredContextHistoryTurn['steps'][number] = { index, state, text, proposals, results: [] };
		turn.steps.push(entry);
		let byStep = indexes.get(runId);
		if (!byStep) {
			byStep = new Map();
			indexes.set(runId, byStep);
		}
		byStep.set(index, entry);
	}
	for (const row of tools) {
		const step = indexes.get(storedText(row.run_id))?.get(storedInteger(row.model_step_index, 1));
		const providerCallId = storedText(row.provider_call_id);
		const state = AGENT_TOOL_STATES.find((value) => value === row.state);
		if (
			!step ||
			!state ||
			(state === 'completed' && row.result_text === null) ||
			((state === 'inspected' || state === 'dispatched') && row.result_text !== null) ||
			!step.proposals.some((proposal) => proposal.providerCallId === providerCallId) ||
			step.results.some((result) => result.providerCallId === providerCallId)
		) {
			throw new Error('Corrupt context tool result');
		}
		step.results.push({
			providerCallId,
			state,
			content: row.result_text === null ? null : storedText(row.result_text),
		});
	}
	for (const turn of turns.values()) {
		const last = turn.steps[turn.steps.length - 1];
		if (
			turn.source.status === 'completed' &&
			(!last ||
				last.proposals.length !== 0 ||
				!last.text.trim() ||
				turn.steps.some(
					(step) =>
						step.state !== 'completed' ||
						step.results.length !== step.proposals.length ||
						step.results.some((result) => result.state !== 'completed'),
				))
		) {
			throw new Error('Incomplete completed context history');
		}
		for (const step of turn.steps) {
			if (
				step !== last &&
				(step.results.length !== step.proposals.length ||
					step.results.some((result) => result.state !== 'completed'))
			) {
				throw new Error('Incomplete context history continuation');
			}
			// Incomplete final steps retain only observed results, in proposal order.
			step.results = step.proposals.flatMap((proposal) =>
				step.results.filter((result) => result.providerCallId === proposal.providerCallId),
			);
		}
	}
	return [...turns.values()];
}

function sourceRow(row: SqlRow): StoredContextSource {
	const status = AGENT_RUN_STATUSES.find((value) => value === row.status);
	if (!status) {
		throw new Error('Corrupt context source status');
	}
	return {
		runId: storedText(row.id),
		version: storedInteger(row.version, 1),
		sequence: storedInteger(row.thread_sequence, 1),
		status,
	};
}

async function historySummary(
	tx: SqlExecutor,
	params: (string | number)[],
	sources: StoredContextSource[],
): Promise<{ content: string; coveredRuns: number } | null> {
	const candidates = await tx.all(
		"SELECT c.id,c.run_id,c.step_index FROM agent_context_checkpoints c JOIN agent_runs r ON r.id=c.run_id JOIN agent_run_tools t ON t.id=c.tool_id WHERE r.user_id=? AND r.app_id=? AND r.thread_id=? AND r.run_kind='root' AND r.thread_sequence<? AND t.state='completed' ORDER BY r.thread_sequence DESC,c.step_index DESC LIMIT 16",
		params.slice(0, 4),
	);
	for (const candidate of candidates) {
		const row = await tx.one('SELECT * FROM agent_context_checkpoints WHERE id=?', [storedText(candidate.id)]);
		const context = await tx.one(
			'SELECT content_json,content_hash FROM agent_model_contexts WHERE run_id=? AND step_index=?',
			[storedText(candidate.run_id), storedInteger(candidate.step_index, 1)],
		);
		if (!row || !context) {
			throw new Error('Checkpoint source disappeared');
		}
		const checkpoint = checkpointRow(row);
		const snapshot = readContextSnapshot(context);
		if (checkpoint.sourceHash !== context.content_hash || checkpoint.sourceMessages !== snapshot.messages.length) {
			throw new Error('Checkpoint source mismatch');
		}
		if (
			snapshot.sources.length > 0 &&
			snapshot.sources.length < sources.length &&
			JSON.stringify(snapshot.sources) === JSON.stringify(sources.slice(0, snapshot.sources.length))
		) {
			return { content: checkpoint.summary, coveredRuns: snapshot.sources.length };
		}
	}
	return null;
}

export class SqliteContextStorage implements ContextStorage {
	constructor(private readonly db: SqliteRuntime) {}

	readEntries(
		userId: number,
		appId: string,
		threadId: string,
		after: StoredThreadEntryCursor,
		limit: number,
	): Promise<StoredThreadEntries | null> {
		return this.db.transaction((tx) => readThreadEntries(tx, userId, appId, threadId, after, limit));
	}

	readHistory(
		command: StoredContextHistoryCommand,
		admit: (facts: StoredContextHistoryFacts) => void,
	): Promise<StoredContextHistoryBundle | null> {
		return this.db.transaction(async (tx) => {
			const current = await tx.one(
				'SELECT thread_id,thread_sequence,run_kind,version FROM agent_runs WHERE id=? AND user_id=? AND app_id=?',
				[command.runId, command.userId, command.appId],
			);
			if (
				!current ||
				current.version !== command.expectedVersion ||
				!(await currentParticipant(tx, command, Date.now))
			) {
				return null;
			}
			if (!command.includeThread) {
				return { sources: [], turns: [], summary: null };
			}
			if (current.run_kind !== 'root') {
				return null;
			}
			const params = [
				command.userId,
				command.appId,
				storedText(current.thread_id),
				storedInteger(current.thread_sequence, 1),
				0,
			];
			const total = await tx.one(
				'SELECT COUNT(*) AS count FROM agent_runs WHERE id IN (' + HISTORY_SCOPE + ')',
				params,
			);
			if (!total) {
				throw new Error('Missing source totals');
			}
			const sourceCount = storedInteger(total.count);
			admit({ sources: sourceCount, runs: 0, steps: 0, tools: 0, bytes: 0 });
			const sourceRows = await tx.all(
				'SELECT id,version,thread_sequence,status FROM agent_runs WHERE id IN (' +
					HISTORY_SCOPE +
					') ORDER BY thread_sequence',
				params,
			);
			const sources = sourceRows.map(sourceRow);
			if (sources.length !== sourceCount) {
				throw new Error('Context source count mismatch');
			}
			const summary = await historySummary(tx, params, sources);
			if (summary !== null) {
				params[4] = sources[summary.coveredRuns - 1].sequence;
			}
			const totals = await tx.one(
				'WITH history AS (' +
					HISTORY_SCOPE +
					') SELECT ' +
					'(SELECT COUNT(*) FROM history) AS runs,' +
					'(SELECT COUNT(*) FROM agent_run_model_steps s JOIN history h ON h.id=s.run_id) AS steps,' +
					'(SELECT COUNT(*) FROM agent_run_tools t JOIN history h ON h.id=t.run_id WHERE NOT EXISTS(SELECT 1 FROM agent_acp_permissions p WHERE p.tool_id=t.id)) AS tools,' +
					'(SELECT COALESCE(SUM(length(CAST(r.input_text AS BLOB))),0) FROM agent_runs r JOIN history h ON h.id=r.id)' +
					"+(SELECT COALESCE(SUM(length(CAST(e.text_delta AS BLOB))),0) FROM agent_run_model_step_events e JOIN history h ON h.id=e.run_id WHERE e.kind='text.delta')" +
					'+(SELECT COALESCE(SUM(length(CAST(s.proposals_json AS BLOB))),0) FROM agent_run_model_steps s JOIN history h ON h.id=s.run_id)' +
					'+(SELECT COALESCE(SUM(length(CAST(t.result_text AS BLOB))),0) FROM agent_run_tools t JOIN history h ON h.id=t.run_id WHERE NOT EXISTS(SELECT 1 FROM agent_acp_permissions p WHERE p.tool_id=t.id)) AS bytes',
				params,
			);
			if (!totals) {
				throw new Error('Missing context history totals');
			}
			const facts = {
				sources: sourceCount,
				runs: storedInteger(totals.runs),
				steps: storedInteger(totals.steps),
				tools: storedInteger(totals.tools),
				bytes:
					storedInteger(totals.bytes) + (summary === null ? 0 : Buffer.byteLength(summary.content, 'utf8')),
			};
			admit(facts);
			const roots = await tx.all(
				'SELECT id,version,thread_sequence,status,input_text FROM agent_runs WHERE id IN (' +
					HISTORY_SCOPE +
					') ORDER BY thread_sequence',
				params,
			);
			const steps = await tx.all(
				"SELECT s.run_id,s.step_index,s.state,s.finish_reason,s.proposals_json,s.text_bytes,COALESCE((SELECT group_concat(text_delta,'') FROM (SELECT e.text_delta FROM agent_run_model_step_events e WHERE e.run_id=s.run_id AND e.step_index=s.step_index AND e.kind='text.delta' ORDER BY e.sequence)),'') AS output_text FROM agent_run_model_steps s WHERE s.run_id IN (" +
					HISTORY_SCOPE +
					') ORDER BY s.run_id,s.step_index',
				params,
			);
			const tools = await tx.all(
				'SELECT t.run_id,t.model_step_index,t.provider_call_id,t.state,t.result_text FROM agent_run_tools t WHERE t.run_id IN (' +
					HISTORY_SCOPE +
					') AND NOT EXISTS(SELECT 1 FROM agent_acp_permissions p WHERE p.tool_id=t.id)',
				params,
			);
			if (roots.length !== facts.runs || steps.length !== facts.steps || tools.length !== facts.tools) {
				throw new Error('Context history totals do not match rows');
			}
			return { sources, turns: historyTurns(roots, steps, tools), summary };
		});
	}
}
