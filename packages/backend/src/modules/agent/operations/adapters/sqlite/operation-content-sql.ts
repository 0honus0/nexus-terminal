import { readAgentPluginAppOutcome } from '@nexus-terminal/shared/agent/plugins/app-outcome';
import { readAgentPluginContentReference } from '@nexus-terminal/shared/agent/plugins/content';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	OperationContentStorage,
	StoredContentChunk,
	StoredContentDraft,
	StoredContentScope,
	StoredContentWriteScope,
} from '../../storage/operation-content-storage.js';
import { OperationContentRefusal } from '../../storage/operation-content-storage.js';

function integer(input: unknown): number {
	if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
		throw new Error('Corrupt operation content integer');
	}
	return input;
}

function text(input: unknown): string {
	if (typeof input !== 'string') {
		throw new Error('Corrupt operation content text');
	}
	return input;
}

export function readStoredContentDraft(row: Record<string, unknown>): StoredContentDraft {
	if (
		(row.sealed !== 0 && row.sealed !== 1) ||
		!AGENT_ID_PATTERN.test(text(row.id)) ||
		!AGENT_ID_PATTERN.test(text(row.run_id)) ||
		(row.sealed === 1 ? typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256) : row.sha256 !== null)
	) {
		throw new Error('Corrupt operation content state');
	}
	return {
		id: text(row.id),
		runId: text(row.run_id),
		ownerId: text(row.owner_id),
		key: text(row.content_key),
		mediaType: text(row.media_type),
		chunks: integer(row.chunks),
		sealed: row.sealed === 1,
		sha256: row.sha256 === null ? null : text(row.sha256),
		sizeBytes: integer(row.size_bytes),
	};
}

async function find(tx: SqlExecutor, scope: StoredContentScope, id: string): Promise<StoredContentDraft | null> {
	const row = await tx.one(
		'SELECT * FROM agent_operation_contents WHERE id=? AND user_id=? AND app_id=? AND run_id=?',
		[id, scope.userId, scope.appId, scope.runId],
	);
	return row ? readStoredContentDraft(row) : null;
}

async function assertWritable(tx: SqlExecutor, scope: StoredContentWriteScope): Promise<void> {
	const row = await tx.one(
		`SELECT e.run_id FROM agent_run_executions e
	 JOIN agent_runs r ON r.id=e.run_id JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id
	 WHERE r.user_id=? AND r.app_id=? AND r.id=? AND e.generation=? AND
	 ((e.state='open' AND r.status IN ('pending','running') AND r.deadline_at>? AND a.enabled=1)
	 OR (e.state IN ('open','draining') AND ? IS NOT NULL AND EXISTS(
	 SELECT 1 FROM agent_operations o WHERE o.id=? AND o.run_id=r.id AND o.execution_generation=e.generation
	 AND o.user_id=r.user_id AND o.app_id=r.app_id AND o.state='dispatched')))`,
		[
			scope.userId,
			scope.appId,
			scope.runId,
			scope.executionGeneration,
			Date.now(),
			scope.operationId,
			scope.operationId,
		],
	);
	if (!row) {
		throw new OperationContentRefusal('version_conflict');
	}
}

export async function initializeOperationContents(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_operation_contents (
	 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,app_id TEXT NOT NULL,run_id TEXT NOT NULL,
	 owner_id TEXT NOT NULL,content_key TEXT NOT NULL,media_type TEXT NOT NULL,
	 chunks INTEGER NOT NULL DEFAULT 0 CHECK(chunks>=0),sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
	 sha256 TEXT CHECK(sha256 IS NULL OR length(sha256)=64),size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes>=0),
	 UNIQUE(run_id,owner_id,content_key),CHECK((sealed=1)=(sha256 IS NOT NULL)),
	 FOREIGN KEY(run_id,user_id,app_id) REFERENCES agent_runs(id,user_id,app_id) ON DELETE CASCADE
	) STRICT;
	CREATE TABLE agent_operation_content_chunks (
	 content_id TEXT NOT NULL REFERENCES agent_operation_contents(id) ON DELETE CASCADE,
	 chunk_index INTEGER NOT NULL CHECK(chunk_index>=0),text TEXT NOT NULL,
	 sha256 TEXT NOT NULL CHECK(length(sha256)=64),size_bytes INTEGER NOT NULL CHECK(size_bytes>=0),
	 PRIMARY KEY(content_id,chunk_index)
	) STRICT;`);
}

export class SqliteOperationContentStorage implements OperationContentStorage {
	constructor(private readonly db: SqliteRuntime) {}

	async exports(scope: StoredContentScope): Promise<{
		kind: 'complete' | 'suspend';
		references: import('../../storage/operation-content-storage.js').StoredContentReference[];
	} | null> {
		const row = await this.db.one(
			`SELECT r.status,i.output_json,s.input_request_json FROM agent_runs r
		 JOIN agent_run_inputs i ON i.run_id=r.id LEFT JOIN agent_run_suspensions s ON s.run_id=r.id AND s.run_version=r.version AND s.resumed_at IS NULL
		 WHERE r.id=? AND r.user_id=? AND r.app_id=?`,
			[scope.runId, scope.userId, scope.appId],
		);
		if (!row || (row.status !== 'completed' && row.status !== 'suspended')) {
			return null;
		}
		if (row.status === 'suspended') {
			const ref = readAgentPluginContentReference(JSON.parse(text(row.input_request_json)));
			return {
				kind: 'suspend',
				references: [{ id: ref.id, sha256: ref.sha256, sizeBytes: ref.sizeBytes, mediaType: ref.mediaType }],
			};
		}
		const result = readAgentPluginAppOutcome(JSON.parse(text(row.output_json)));
		if (result.kind !== 'complete') {
			throw new Error('Corrupt Run completion output');
		}
		return {
			kind: 'complete',
			references: result.outputs.map((ref) => ({
				id: ref.id,
				sha256: ref.sha256,
				sizeBytes: ref.sizeBytes,
				mediaType: ref.mediaType,
			})),
		};
	}

	open(
		scope: StoredContentWriteScope,
		ownerId: string,
		key: string,
		mediaType: string,
		id: string,
	): Promise<StoredContentDraft> {
		return this.db.transaction(async (tx) => {
			await assertWritable(tx, scope);
			const row = await tx.one(
				'SELECT * FROM agent_operation_contents WHERE user_id=? AND app_id=? AND run_id=? AND owner_id=? AND content_key=?',
				[scope.userId, scope.appId, scope.runId, ownerId, key],
			);
			if (row) {
				const current = readStoredContentDraft(row);
				if (current.mediaType !== mediaType) {
					throw new OperationContentRefusal('idempotency_conflict');
				}
				return current;
			}
			await tx.run(
				'INSERT INTO agent_operation_contents(id,user_id,app_id,run_id,owner_id,content_key,media_type) VALUES(?,?,?,?,?,?,?)',
				[id, scope.userId, scope.appId, scope.runId, ownerId, key, mediaType],
			);
			const result = await find(tx, scope, id);
			if (!result) {
				throw new Error('Created operation content missing');
			}
			return result;
		});
	}

	get(scope: StoredContentScope, id: string): Promise<StoredContentDraft | null> {
		return find(this.db, scope, id);
	}

	async readable(scope: StoredContentScope, id: string, includeThread: boolean): Promise<StoredContentDraft | null> {
		const row = await this.db.one(
			`SELECT c.* FROM agent_operation_contents c
		 JOIN agent_runs source ON source.id=c.run_id
		 JOIN agent_runs reader ON reader.user_id=c.user_id AND reader.app_id=c.app_id
		 WHERE c.id=? AND c.user_id=? AND c.app_id=? AND reader.id=? AND c.sealed=1
		 AND (c.run_id=reader.id OR (?=1 AND source.thread_id=reader.thread_id AND source.run_kind='root' AND reader.run_kind='root')
		 OR (source.status='completed' AND EXISTS(SELECT 1 FROM agent_run_children child JOIN agent_run_inputs input ON input.run_id=child.run_id,
		 json_each(input.output_json,'$.outputs') exported WHERE child.run_id=source.id AND child.parent_id=reader.id
		 AND json_extract(exported.value,'$.id')=c.id AND json_extract(exported.value,'$.sha256')=c.sha256
		 AND json_extract(exported.value,'$.sizeBytes')=c.size_bytes AND json_extract(exported.value,'$.mediaType')=c.media_type)))`,
			[id, scope.userId, scope.appId, scope.runId, includeThread ? 1 : 0],
		);
		return row === null ? null : readStoredContentDraft(row);
	}

	append(
		scope: StoredContentWriteScope,
		ownerId: string,
		id: string,
		chunk: StoredContentChunk,
	): Promise<StoredContentDraft> {
		return this.db.transaction(async (tx) => {
			await assertWritable(tx, scope);
			const current = await find(tx, scope, id);
			if (!current || current.ownerId !== ownerId) {
				throw new OperationContentRefusal('not_found');
			}
			const existing = await tx.one(
				'SELECT sha256,text FROM agent_operation_content_chunks WHERE content_id=? AND chunk_index=?',
				[id, chunk.index],
			);
			if (existing) {
				if (existing.sha256 !== chunk.sha256 || existing.text !== chunk.text) {
					throw new OperationContentRefusal('idempotency_conflict');
				}
				return current;
			}
			if (current.sealed || current.chunks !== chunk.index) {
				throw new OperationContentRefusal('version_conflict');
			}
			if (
				!Number.isSafeInteger(current.sizeBytes + chunk.sizeBytes) ||
				!Number.isSafeInteger(current.chunks + 1)
			) {
				throw new OperationContentRefusal('limit_exceeded');
			}
			await tx.run('INSERT INTO agent_operation_content_chunks VALUES(?,?,?,?,?)', [
				id,
				chunk.index,
				chunk.text,
				chunk.sha256,
				chunk.sizeBytes,
			]);
			await tx.run('UPDATE agent_operation_contents SET chunks=chunks+1,size_bytes=size_bytes+? WHERE id=?', [
				chunk.sizeBytes,
				id,
			]);
			const result = await find(tx, scope, id);
			if (!result) {
				throw new Error('Appended operation content missing');
			}
			return result;
		});
	}

	async chunk(scope: StoredContentScope, id: string, index: number): Promise<StoredContentChunk | null> {
		const row = await this.db.one(
			`SELECT c.* FROM agent_operation_content_chunks c JOIN agent_operation_contents p ON p.id=c.content_id
		 WHERE p.id=? AND p.user_id=? AND p.app_id=? AND p.run_id=? AND c.chunk_index=?`,
			[id, scope.userId, scope.appId, scope.runId, index],
		);
		return row
			? {
					index: integer(row.chunk_index),
					text: text(row.text),
					sha256: text(row.sha256),
					sizeBytes: integer(row.size_bytes),
				}
			: null;
	}

	seal(
		scope: StoredContentWriteScope,
		ownerId: string,
		id: string,
		chunks: number,
		sha256: string,
	): Promise<StoredContentDraft> {
		return this.db.transaction(async (tx) => {
			await assertWritable(tx, scope);
			const current = await find(tx, scope, id);
			if (!current || current.ownerId !== ownerId) {
				throw new OperationContentRefusal('not_found');
			}
			if (current.chunks !== chunks || (current.sealed && current.sha256 !== sha256)) {
				throw new OperationContentRefusal('version_conflict');
			}
			if (!current.sealed) {
				await tx.run('UPDATE agent_operation_contents SET sealed=1,sha256=? WHERE id=? AND sealed=0', [
					sha256,
					id,
				]);
			}
			const result = await find(tx, scope, id);
			if (!result) {
				throw new Error('Sealed operation content missing');
			}
			return result;
		});
	}
}
