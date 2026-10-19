import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	StoredCollaborationAuthority,
	StoredCollaborationFact,
	StoredCollaborationPage,
} from '../../storage/run-collaboration-storage.js';
import { CollaborationStorageRefusal } from '../../storage/run-collaboration-storage.js';
import {
	participant,
	collaborationAuthority,
	currentParticipant,
	storedInteger,
	storedText,
} from './run-participant-sql.js';

function fact(row: Record<string, unknown>): StoredCollaborationFact {
	if (
		Buffer.byteLength(storedText(row.fact_key), 'utf8') > 128 ||
		Buffer.byteLength(storedText(row.value_text), 'utf8') > 8192
	) {
		throw new Error('Corrupt collaboration fact bounds');
	}
	return {
		key: storedText(row.fact_key),
		value: storedText(row.value_text),
		version: storedInteger(row.version, 1),
		authorId: storedText(row.author_id),
	};
}

export class CollaborationDataSql {
	constructor(protected readonly db: SqliteRuntime) {}

	fact(input: StoredCollaborationAuthority, key: string): Promise<StoredCollaborationFact | null> {
		return this.db.transaction(async (tx) => {
			const owner = await collaborationAuthority(tx, input);
			const row = await tx.one(
				'SELECT fact_key,value_text,version,author_id FROM agent_run_facts WHERE root_id=? AND fact_key=?',
				[owner.rootId, key],
			);
			return row ? fact(row) : null;
		});
	}

	writeFact(
		input: StoredCollaborationAuthority,
		key: string,
		value: string,
		expectedVersion: number,
		maxFacts: number,
	): Promise<StoredCollaborationFact | 'version_conflict' | 'limit_exceeded'> {
		return this.db.transaction(async (tx) => {
			const owner = await collaborationAuthority(tx, input);
			const previous = await tx.one('SELECT result_json FROM agent_collaboration_effects WHERE operation_id=?', [
				input.operationId,
			]);
			if (previous) {
				throw new CollaborationStorageRefusal('version_conflict');
			}
			const row = await tx.one(
				'SELECT fact_key,value_text,version,author_id FROM agent_run_facts WHERE root_id=? AND fact_key=?',
				[owner.rootId, key],
			);
			if (
				expectedVersion === Number.MAX_SAFE_INTEGER ||
				(row ? storedInteger(row.version, 1) : 0) !== expectedVersion
			) {
				return 'version_conflict';
			}
			if (!row) {
				const count = await tx.one('SELECT COUNT(*) AS total FROM agent_run_facts WHERE root_id=?', [
					owner.rootId,
				]);
				if (!count || storedInteger(count.total) >= maxFacts) {
					return 'limit_exceeded';
				}
			}
			await tx.run(
				'INSERT INTO agent_run_facts(root_id,fact_key,value_text,version,author_id) VALUES(?,?,?,?,?) ON CONFLICT(root_id,fact_key) DO UPDATE SET value_text=excluded.value_text,version=excluded.version,author_id=excluded.author_id',
				[owner.rootId, key, value, expectedVersion + 1, owner.id],
			);
			await tx.run('INSERT INTO agent_collaboration_effects(operation_id,result_json) VALUES(?,?)', [
				input.operationId,
				JSON.stringify({ key, version: expectedVersion + 1 }),
			]);
			return { key, value, version: expectedVersion + 1, authorId: owner.id };
		});
	}

	send(
		input: StoredCollaborationAuthority,
		id: string,
		recipientId: string,
		body: string,
		expiresAt: number,
		maxMessages: number,
		maxBytes: number,
	): Promise<number> {
		return this.db.transaction(async (tx) => {
			const owner = await collaborationAuthority(tx, input);
			if (expiresAt <= Date.now()) {
				throw new CollaborationStorageRefusal('version_conflict');
			}
			const recipient = await participant(tx, {
				userId: input.scope.userId,
				appId: input.scope.appId,
				runId: recipientId,
			});
			if (
				!recipient ||
				recipient.rootId !== owner.rootId ||
				recipient.id === owner.id ||
				!(await currentParticipant(
					tx,
					{ userId: input.scope.userId, appId: input.scope.appId, runId: recipientId },
					Date.now,
				))
			) {
				throw new CollaborationStorageRefusal('version_conflict');
			}
			const existing = await tx.one('SELECT sequence FROM agent_run_mailbox WHERE message_id=?', [id]);
			if (existing) {
				throw new CollaborationStorageRefusal('version_conflict');
			}
			const total = await tx.one(
				'SELECT COUNT(*) AS total,COALESCE(SUM(length(CAST(body_text AS BLOB))),0) AS bytes FROM agent_run_mailbox WHERE root_id=?',
				[owner.rootId],
			);
			if (
				!total ||
				storedInteger(total.total) >= maxMessages ||
				storedInteger(total.bytes) + Buffer.byteLength(body, 'utf8') > maxBytes
			) {
				throw new CollaborationStorageRefusal('limit_exceeded');
			}
			const last = await tx.one(
				'SELECT COALESCE(MAX(sequence),0) AS last FROM agent_run_mailbox WHERE recipient_id=?',
				[recipientId],
			);
			if (!last) {
				throw new Error('Mailbox sequence missing');
			}
			const sequence = storedInteger(storedInteger(last.last) + 1, 1);
			if (expiresAt <= Date.now()) {
				throw new CollaborationStorageRefusal('version_conflict');
			}
			await tx.run(
				'INSERT INTO agent_run_mailbox(root_id,recipient_id,sequence,message_id,sender_id,body_text,expires_at) VALUES(?,?,?,?,?,?,?)',
				[owner.rootId, recipientId, sequence, id, owner.id, body, expiresAt],
			);
			return sequence;
		});
	}

	read(input: StoredCollaborationAuthority, after: number, limit: number): Promise<StoredCollaborationPage> {
		return this.db.transaction(async (tx) => {
			const owner = await collaborationAuthority(tx, input);
			const rows = await tx.all(
				'SELECT sequence,sender_id,body_text,expires_at FROM agent_run_mailbox WHERE recipient_id=? AND sequence>? ORDER BY sequence LIMIT ?',
				[owner.id, after, limit],
			);
			const cursor = await tx.one(
				'SELECT consumed_through,read_through FROM agent_run_mailbox_cursors WHERE run_id=?',
				[owner.id],
			);
			const last = await tx.one(
				'SELECT COALESCE(MAX(sequence),0) AS last FROM agent_run_mailbox WHERE recipient_id=?',
				[owner.id],
			);
			if (!last || after > storedInteger(last.last)) {
				throw new CollaborationStorageRefusal('invalid_input');
			}
			if (
				rows.length !== Math.min(limit, storedInteger(last.last) - after) ||
				rows.some(
					(row, index) =>
						storedInteger(row.sequence, 1) !== after + index + 1 ||
						Buffer.byteLength(storedText(row.body_text), 'utf8') > 8192,
				)
			) {
				throw new Error('Incomplete or corrupt mailbox page');
			}
			const nextCursor = rows.length ? storedInteger(rows[rows.length - 1].sequence, 1) : after;
			const consumedThrough = cursor ? storedInteger(cursor.consumed_through) : 0;
			const readThrough = cursor ? storedInteger(cursor.read_through) : 0;
			if (consumedThrough > readThrough || readThrough > storedInteger(last.last)) {
				throw new Error('Corrupt mailbox watermark');
			}
			// Only a contiguous scan may authorize a contiguous acknowledgement.
			if (after <= readThrough) {
				await tx.run(
					'INSERT INTO agent_run_mailbox_cursors(run_id,consumed_through,read_through) VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET read_through=MAX(read_through,excluded.read_through)',
					[owner.id, consumedThrough, nextCursor],
				);
			}
			return {
				messages: rows
					.filter((row) => storedInteger(row.expires_at) > Date.now())
					.map((row) => ({
						sequence: storedInteger(row.sequence, 1),
						senderId: storedText(row.sender_id),
						body: storedText(row.body_text),
						expiresAt: storedInteger(row.expires_at),
					})),
				nextCursor,
				consumedThrough,
			};
		});
	}

	consume(
		input: StoredCollaborationAuthority,
		through: number,
		expectedConsumed: number,
	): Promise<number | 'version_conflict'> {
		return this.db.transaction(async (tx) => {
			const owner = await collaborationAuthority(tx, input);
			const duplicate = await tx.one('SELECT 1 FROM agent_collaboration_effects WHERE operation_id=?', [
				input.operationId,
			]);
			if (duplicate) {
				return 'version_conflict';
			}
			const row = await tx.one(
				'SELECT consumed_through,read_through FROM agent_run_mailbox_cursors WHERE run_id=?',
				[owner.id],
			);
			if (
				!row ||
				storedInteger(row.consumed_through) !== expectedConsumed ||
				through < expectedConsumed ||
				through > storedInteger(row.read_through)
			) {
				return 'version_conflict';
			}
			const changed = await tx.run(
				'UPDATE agent_run_mailbox_cursors SET consumed_through=? WHERE run_id=? AND consumed_through=?',
				[through, owner.id, expectedConsumed],
			);
			if (changed.changes !== 1) {
				throw new Error('Lost mailbox consumption CAS');
			}
			await tx.run('INSERT INTO agent_collaboration_effects(operation_id,result_json) VALUES(?,?)', [
				input.operationId,
				JSON.stringify({ through }),
			]);
			return through;
		});
	}
}
