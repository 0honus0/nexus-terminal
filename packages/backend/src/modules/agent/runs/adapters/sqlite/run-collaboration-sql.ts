import type {
	ProviderStorage,
	ProviderStoredRow,
	StoredModelReference,
} from '../../../providers/storage/provider-storage.js';
import type { StoredFrozenInput } from '../../storage/run-storage.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	RunCollaborationStorage,
	StoredParticipantScope,
	StoredParticipant,
	StoredDelegateCommand,
	StoredChildAdmissionFacts,
	StoredChildCreation,
	StoredCollaborationAuthority,
	StoredMessageMetadataPage,
} from '../../storage/run-collaboration-storage.js';
import { readRunSelection } from './run-selection.js';
import { nextThreadSequence } from './run-order.js';
import { participant, collaborationAuthority, storedText, storedInteger } from './run-participant-sql.js';
import { fenceRunChildren } from './run-child-fence.js';
import { CollaborationDataSql } from './run-collaboration-data-sql.js';

export async function children(tx: SqlExecutor, scope: StoredParticipantScope): Promise<StoredParticipant[]> {
	const owner = await participant(tx, scope);
	if (!owner) {
		return [];
	}
	const rows = await tx.all('SELECT run_id FROM agent_run_children WHERE parent_id=? ORDER BY run_id', [
		owner.rootId,
	]);
	const result: StoredParticipant[] = [];
	for (const row of rows) {
		const child = await participant(tx, {
			userId: scope.userId,
			appId: scope.appId,
			runId: storedText(row.run_id),
		});
		if (!child) {
			throw new Error('Missing child participant');
		}
		result.push(child);
	}
	return result;
}

export class SqliteRunCollaborationStorage extends CollaborationDataSql implements RunCollaborationStorage {
	constructor(
		db: SqliteRuntime,
		private readonly providers: ProviderStorage,
	) {
		super(db);
	}

	messageMetadata(scope: StoredParticipantScope, after: number, limit: number): Promise<StoredMessageMetadataPage> {
		return this.db.transaction(async (tx) => {
			const owner = await participant(tx, scope);
			if (!owner) {
				throw new Error('Missing mailbox participant');
			}
			const rows = await tx.all(
				'SELECT sequence,sender_id,length(CAST(body_text AS BLOB)) AS body_bytes,expires_at FROM agent_run_mailbox WHERE root_id=? AND recipient_id=? AND sequence>? ORDER BY sequence LIMIT ?',
				[owner.rootId, owner.id, after, limit],
			);
			const items = rows.map((row) => ({
				sequence: storedInteger(row.sequence, 1),
				senderId: storedText(row.sender_id),
				bodyBytes: storedInteger(row.body_bytes),
				expiresAt: storedInteger(row.expires_at, 1),
			}));
			return { items, nextCursor: items.at(-1)?.sequence ?? after };
		});
	}

	participant(scope: StoredParticipantScope): Promise<StoredParticipant | null> {
		return this.db.transaction((tx) => participant(tx, scope));
	}

	children(scope: StoredParticipantScope): Promise<StoredParticipant[]> {
		return this.db.transaction((tx) => children(tx, scope));
	}

	delegate(
		command: StoredDelegateCommand,
		admit: (facts: StoredChildAdmissionFacts) => boolean,
		resolve: (provider: ProviderStoredRow, reference: StoredModelReference) => StoredFrozenInput | null,
	): Promise<StoredChildCreation | null> {
		return this.db.transaction(async (tx) => {
			const parent = await collaborationAuthority(tx, command);
			const existing = await tx.one(
				'SELECT r.id,r.version,r.input_text,c.request_hash,f.provider_id FROM agent_run_children c JOIN agent_runs r ON r.id=c.run_id JOIN agent_run_frozen_inputs f ON f.run_id=r.id WHERE c.operation_id=?',
				[command.operationId],
			);
			if (existing) {
				const child = await participant(tx, {
					userId: command.scope.userId,
					appId: command.scope.appId,
					runId: storedText(existing.id),
				});
				if (!child || existing.request_hash !== command.requestHash) {
					return null;
				}
				return {
					participant: child,
					providerId: storedText(existing.provider_id),
					prompt: storedText(existing.input_text),
					requestHash: storedText(existing.request_hash),
					version: storedInteger(existing.version, 1),
					created: false,
				};
			}
			const row = await tx.one(
				'SELECT thread_id,selected_connections_json FROM agent_runs WHERE id=? AND user_id=? AND app_id=?',
				[command.scope.runId, command.scope.userId, command.scope.appId],
			);
			if (!row) {
				return null;
			}
			const peers = await children(tx, command.scope);
			const selected =
				command.model === null
					? null
					: await this.providers.snapshot(tx, command.scope.userId, command.model.providerId);
			const frozen = command.model === null ? null : selected === null ? null : resolve(selected, command.model);
			if (command.model !== null && frozen === null) {
				return null;
			}
			if (
				!admit({
					parent,
					selectedTargets: readRunSelection(row.selected_connections_json),
					now: Date.now(),
					children: peers.length,
					dependencies: peers.filter((peer) => command.dependencies.includes(peer.id)),
				})
			) {
				return null;
			}
			await tx.run(
				"INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,status,version,input_text,selected_connections_json,created_at,updated_at,deadline_at) VALUES(?,?,?,?,?,'child','pending',1,?,?,?,?,?)",
				[
					command.id,
					command.scope.userId,
					command.scope.appId,
					storedText(row.thread_id),
					await nextThreadSequence(tx, storedText(row.thread_id)),
					command.objective,
					JSON.stringify(command.targets),
					command.now,
					command.now,
					command.deadline,
				],
			);
			await tx.run(
				'INSERT INTO agent_run_children(run_id,parent_id,operation_id,request_hash,profile,tools_json,max_requests,dependencies_json,dependency_mode) VALUES(?,?,?,?,?,?,?,?,?)',
				[
					command.id,
					parent.id,
					command.operationId,
					command.requestHash,
					command.profile,
					JSON.stringify(command.tools),
					command.maxRequests,
					JSON.stringify(command.dependencies),
					command.dependencyMode,
				],
			);
			if (frozen === null) {
				await tx.run(
					'INSERT INTO agent_run_frozen_inputs(run_id,provider_id,provider_version,credential_revision,model_id,base_url,protocol,capabilities_json,execution_policy) SELECT ?,provider_id,provider_version,credential_revision,model_id,base_url,protocol,capabilities_json,execution_policy FROM agent_run_frozen_inputs WHERE run_id=?',
					[command.id, parent.id],
				);
			} else {
				await tx.run(
					'INSERT INTO agent_run_frozen_inputs(run_id,provider_id,provider_version,credential_revision,model_id,base_url,protocol,capabilities_json,execution_policy) VALUES(?,?,?,?,?,?,?,?,?)',
					[
						command.id,
						frozen.providerId,
						frozen.providerVersion,
						frozen.credentialRevision,
						frozen.modelId,
						frozen.baseUrl,
						frozen.protocol,
						JSON.stringify(frozen.capabilities),
						frozen.executionPolicy,
					],
				);
			}
			await tx.run(
				'INSERT INTO agent_run_execution_settings(run_id,settings_json) SELECT ?,settings_json FROM agent_run_execution_settings WHERE run_id=?',
				[command.id, parent.id],
			);
			await tx.run(
				"INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at) VALUES(?,1,'run.created',1,?)",
				[command.id, command.now],
			);
			const frozenRow = await tx.one('SELECT provider_id FROM agent_run_frozen_inputs WHERE run_id=?', [
				command.id,
			]);
			const child = await participant(tx, {
				userId: command.scope.userId,
				appId: command.scope.appId,
				runId: command.id,
			});
			if (!child || !frozenRow) {
				throw new Error('Child snapshot was not persisted');
			}
			return {
				participant: child,
				providerId: storedText(frozenRow.provider_id),
				prompt: command.objective,
				requestHash: command.requestHash,
				version: 1,
				created: true,
			};
		});
	}

	cancelChildren(
		scope: StoredParticipantScope,
		ids: string[] | null,
		now: number,
		authority: StoredCollaborationAuthority | null,
	): Promise<string[]> {
		return this.db.transaction(async (tx) => {
			const owner = authority ? await collaborationAuthority(tx, authority) : await participant(tx, scope);
			if (!owner || owner.parentId !== null) {
				return [];
			}
			return fenceRunChildren(tx, owner.id, now, ids);
		});
	}
}
