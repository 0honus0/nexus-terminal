import { randomUUID } from 'node:crypto';
import { currentOperation } from '../../../operations/adapters/sqlite/current-operation-sql.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredOperationScope } from '../../../operations/storage/operation-storage.js';
import type {
	RunAppStateStorage,
	StoredAppCheckpoint,
	StoredAppMessageAppend,
} from '../../storage/run-app-state-storage.js';
import { RunAppStateRefusal } from '../../storage/run-app-state-storage.js';
import { readAgentPluginCheckpoint } from '@nexus-terminal/shared/agent/plugins/run-context';
import { storedInteger, storedText } from './run-participant-sql.js';

export function readStoredAppCheckpoint(json: unknown): StoredAppCheckpoint {
	const raw: unknown = JSON.parse(storedText(json));
	const value = readAgentPluginCheckpoint(raw);
	return {
		version: value.version,
		state: {
			id: value.state.id,
			sha256: value.state.sha256,
			sizeBytes: value.state.sizeBytes,
			mediaType: value.state.mediaType,
		},
		consumedOperationIds: value.consumedOperationIds.map((id) => id),
		pendingIntents: value.pendingIntents.map((intent) => ({
			operationKey: intent.operationKey,
			requestSha256: intent.requestSha256,
		})),
	};
}

async function assertOpen(tx: SqlReader, scope: StoredOperationScope, now: number): Promise<void> {
	const current = await tx.one(
		`SELECT r.id FROM agent_runs r JOIN agent_run_executions e ON e.run_id=r.id
	 JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id
	 WHERE r.id=? AND r.user_id=? AND r.app_id=? AND r.status='running' AND r.deadline_at>?
	 AND e.generation=? AND e.state='open' AND a.enabled=1`,
		[scope.runId, scope.userId, scope.appId, now, scope.executionGeneration],
	);
	if (!current) {
		throw new RunAppStateRefusal('forbidden');
	}
}

async function run(tx: SqlReader, scope: StoredOperationScope) {
	return tx.one(
		`SELECT r.id,r.run_kind,r.thread_id,r.input_text,r.thread_sequence,r.deadline_at,i.input_json,
	 t.version AS thread_version,t.title_origin,(SELECT resume_input_json FROM agent_run_suspensions s
	 WHERE s.run_id=r.id AND s.resumed_at IS NOT NULL ORDER BY s.run_version DESC LIMIT 1) AS resume_input_json
	 FROM agent_runs r JOIN agent_run_inputs i ON i.run_id=r.id JOIN agent_threads t
	 ON t.id=r.thread_id AND t.user_id=r.user_id AND t.app_id=r.app_id WHERE r.id=? AND r.user_id=? AND r.app_id=?`,
		[scope.runId, scope.userId, scope.appId],
	);
}

export class SqliteRunAppStateStorage implements RunAppStateStorage {
	constructor(private readonly db: SqliteRuntime) {}

	async describe(scope: StoredOperationScope) {
		const row = await run(this.db, scope);
		return row === null
			? null
			: {
					runId: storedText(row.id),
					threadId: storedText(row.thread_id),
					threadVersion: storedInteger(row.thread_version, 1),
					autoTitle: row.title_origin === 'pending',
					inputJson: storedText(row.input_json),
					resumeInputJson: row.resume_input_json === null ? null : storedText(row.resume_input_json),
					prompt: storedText(row.input_text),
					sequence: storedInteger(row.thread_sequence, 1),
					deadlineUnixMs: storedInteger(row.deadline_at, 1),
				};
	}

	async read(scope: StoredOperationScope): Promise<StoredAppCheckpoint | null> {
		const row = await this.db.one(
			`SELECT c.document_json FROM agent_app_checkpoints c JOIN agent_runs r ON r.id=c.run_id
		 WHERE r.id=? AND r.user_id=? AND r.app_id=?`,
			[scope.runId, scope.userId, scope.appId],
		);
		return row === null ? null : readStoredAppCheckpoint(row.document_json);
	}

	write(scope: StoredOperationScope, value: StoredAppCheckpoint, now: number): Promise<StoredAppCheckpoint> {
		return this.db.transaction(async (tx) => {
			await assertOpen(tx, scope, now);
			const current = await tx.one('SELECT version,document_json FROM agent_app_checkpoints WHERE run_id=?', [
				scope.runId,
			]);
			const json = JSON.stringify(value);
			if (current?.version === value.version && current.document_json === json) {
				return readStoredAppCheckpoint(current.document_json);
			}
			if ((current?.version ?? 0) !== value.version - 1 || value.version > Number.MAX_SAFE_INTEGER) {
				throw new RunAppStateRefusal('version_conflict');
			}
			const content = await tx.one(
				`SELECT id FROM agent_operation_contents WHERE id=? AND user_id=? AND app_id=?
			 AND run_id=? AND sealed=1 AND sha256=? AND size_bytes=? AND media_type=?`,
				[
					value.state.id,
					scope.userId,
					scope.appId,
					scope.runId,
					value.state.sha256,
					value.state.sizeBytes,
					value.state.mediaType,
				],
			);
			if (!content) {
				throw new RunAppStateRefusal('not_found');
			}
			for (const id of value.consumedOperationIds) {
				const receipt = await tx.one(
					`SELECT id FROM agent_operations WHERE id=? AND run_id=? AND user_id=? AND app_id=?
				 AND state IN ('completed','failed','cancelled')`,
					[id, scope.runId, scope.userId, scope.appId],
				);
				if (!receipt) {
					throw new RunAppStateRefusal('forbidden');
				}
			}
			await tx.run(
				`INSERT INTO agent_app_checkpoints(run_id,execution_generation,version,document_json,updated_at)
			 VALUES(?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET execution_generation=excluded.execution_generation,
			 version=excluded.version,document_json=excluded.document_json,updated_at=excluded.updated_at`,
				[scope.runId, scope.executionGeneration, value.version, json, now],
			);
			return readStoredAppCheckpoint(json);
		});
	}

	history(scope: StoredOperationScope, before: number | null, maxBytes: number) {
		return this.db.transaction(async (tx) => {
			const current = await run(tx, scope);
			if (!current) {
				throw new RunAppStateRefusal('not_found');
			}
			// Child private checkpoints are not Thread conversation history. Both the
			// reader and every source must be Root, matching the content-read boundary.
			if (current.run_kind !== 'root') {
				throw new RunAppStateRefusal('forbidden');
			}
			const ceiling = Math.min(
				before ?? storedInteger(current.thread_sequence),
				storedInteger(current.thread_sequence),
			);
			const items: { runId: string; sequence: number; checkpoint: StoredAppCheckpoint }[] = [];
			let bytes = 128;
			let cursor = ceiling;
			while (true) {
				const row = await tx.one(
					`SELECT r.id,r.thread_sequence,c.document_json FROM agent_runs r
				 JOIN agent_app_checkpoints c ON c.run_id=r.id WHERE r.user_id=? AND r.app_id=? AND r.thread_id=?
					 AND r.run_kind='root' AND r.thread_sequence<? AND r.status IN ('completed','failed','cancelled')
				 ORDER BY r.thread_sequence DESC LIMIT 1`,
					[scope.userId, scope.appId, storedText(current.thread_id), cursor],
				);
				if (!row) {
					return { items, nextBefore: null };
				}
				const item = {
					runId: storedText(row.id),
					sequence: storedInteger(row.thread_sequence, 1),
					checkpoint: readStoredAppCheckpoint(row.document_json),
				};
				const size = Buffer.byteLength(JSON.stringify(item)) + 1;
				if (bytes + size > maxBytes) {
					if (!items.length) {
						throw new Error('Checkpoint cannot fit its control page');
					}
					return { items, nextBefore: cursor };
				}
				items.push(item);
				bytes += size;
				cursor = item.sequence;
			}
		});
	}

	append(scope: StoredOperationScope, input: StoredAppMessageAppend, now: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			await assertOpen(tx, scope, now);
			if (input.operationId !== null) {
				const operation = await tx.one(
					`SELECT id FROM agent_operations WHERE id=? AND run_id=? AND user_id=? AND app_id=?
				 AND state IN ('dispatched','completed')`,
					[input.operationId, scope.runId, scope.userId, scope.appId],
				);
				if (!operation) {
					throw new RunAppStateRefusal('forbidden');
				}
			}
			let message = await tx.one(
				'SELECT id,chunks,operation_id FROM agent_app_messages WHERE run_id=? AND owner_id=? AND message_key=?',
				[scope.runId, input.ownerId, input.key],
			);
			if (!message) {
				if (input.index !== 0) {
					throw new RunAppStateRefusal('version_conflict');
				}
				const id = randomUUID();
				await tx.run(
					`INSERT INTO agent_app_messages(id,run_id,owner_id,message_key,ordinal,operation_id,chunks,created_at,operation_sequence)
				 SELECT ?,?,?,?,COALESCE(MAX(ordinal),0)+1,?,0,?,COALESCE((SELECT sequence FROM agent_operations WHERE id=?),
				 (SELECT MAX(sequence) FROM agent_operations WHERE run_id=?),0) FROM agent_app_messages WHERE run_id=?`,
					[
						id,
						scope.runId,
						input.ownerId,
						input.key,
						input.operationId,
						now,
						input.operationId,
						scope.runId,
						scope.runId,
					],
				);
				message = { id, chunks: 0, operation_id: input.operationId };
			}
			if (message.operation_id !== input.operationId) {
				throw new RunAppStateRefusal('idempotency_conflict');
			}
			const original = await tx.one(
				'SELECT text,sha256 FROM agent_app_message_chunks WHERE message_id=? AND chunk_index=?',
				[storedText(message.id), input.index],
			);
			if (original) {
				if (original.text !== input.text || original.sha256 !== input.sha256) {
					throw new RunAppStateRefusal('idempotency_conflict');
				}
				return;
			}
			if (message.chunks !== input.index) {
				throw new RunAppStateRefusal('version_conflict');
			}
			await tx.run(
				'INSERT INTO agent_app_message_chunks(message_id,chunk_index,text,sha256,created_at) VALUES(?,?,?,?,?)',
				[storedText(message.id), input.index, input.text, input.sha256, now],
			);
			await tx.run('UPDATE agent_app_messages SET chunks=chunks+1 WHERE id=?', [storedText(message.id)]);
		});
	}

	setTitle(
		scope: StoredOperationScope,
		operationId: string,
		operationHash: string,
		expectedThreadVersion: number,
		title: string,
		now: number,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const proof = await currentOperation(
				tx,
				{ userId: scope.userId, appId: scope.appId, runId: scope.runId, operationId, operationHash },
				{ labels: ['thread.title'] },
			);
			if (
				!proof ||
				proof.operation.scope.executionGeneration !== scope.executionGeneration ||
				proof.authority.instance.id !== scope.appId
			) {
				throw new RunAppStateRefusal('forbidden');
			}
			const result = await tx.run(
				`UPDATE agent_threads SET title=?,title_origin='automatic',version=version+1,updated_at=?
			 WHERE id=(SELECT thread_id FROM agent_runs WHERE id=? AND user_id=? AND app_id=?)
			 AND user_id=? AND app_id=? AND version=? AND title_origin='pending' AND version<?`,
				[
					title,
					now,
					scope.runId,
					scope.userId,
					scope.appId,
					scope.userId,
					scope.appId,
					expectedThreadVersion,
					Number.MAX_SAFE_INTEGER,
				],
			);
			return result.changes === 1;
		});
	}
}
