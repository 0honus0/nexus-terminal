import { randomUUID, createHash } from 'node:crypto';
import { SqliteRuntime } from '../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeOperations } from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-schema.js';
import { sequenceOperations } from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-sequence-schema.js';
import { initializeOperationAuthorities } from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-authority-schema.js';
import { initializeOperationArtifacts } from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-artifact-schema.js';
import {
	initializeOperationContents,
	SqliteOperationContentStorage,
} from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-content-sql.js';
import { SqliteOperationStorage } from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-sql.js';
import { OperationModel } from '../../packages/backend/dist/modules/agent/operations/model/operation-model.js';
import { OperationContentModel } from '../../packages/backend/dist/modules/agent/operations/model/operation-content-model.js';
import { OperationContentService } from '../../packages/backend/dist/modules/agent/operations/service/operation-content-service.js';
import { RunChanges } from '../../packages/backend/dist/modules/agent/runs/model/run-changes.js';

export const contentHash = (text) => createHash('sha256').update(text).digest('hex');

/** Real production operation/content DDL, row decoders, Models and SQL transactions.
 * Only unrelated App/Run facts and previously committed dispatch proofs are seeded.
 * HTTP dispatch authorization is exercised separately by the execution fixtures. */
export async function operationStorageFixture(t) {
	const db = SqliteRuntime.openMemory();
	t.after(() => db.close());
	await db.exec(`PRAGMA foreign_keys=ON;
	CREATE TABLE agent_apps(id TEXT,user_id INTEGER,enabled INTEGER,PRIMARY KEY(id,user_id));
	CREATE TABLE agent_runs(id TEXT PRIMARY KEY,user_id INTEGER,app_id TEXT,thread_id TEXT,run_kind TEXT,status TEXT,version INTEGER,deadline_at INTEGER,UNIQUE(id,user_id,app_id));
	CREATE TABLE agent_providers(id TEXT PRIMARY KEY);
	CREATE TABLE agent_artifacts(id TEXT PRIMARY KEY,user_id INTEGER,app_id TEXT,version INTEGER,sha256 TEXT,size_bytes INTEGER,ready_at INTEGER);
	CREATE TABLE agent_run_children(run_id TEXT,parent_id TEXT);
	CREATE TABLE agent_run_inputs(run_id TEXT,output_json TEXT);`);
	await initializeOperations(db);
	await sequenceOperations(db);
	await initializeOperationAuthorities(db);
	await initializeOperationArtifacts(db);
	await initializeOperationContents(db);
	const scope = { userId: 1, appId: randomUUID(), runId: randomUUID(), executionGeneration: randomUUID() };
	await db.run('INSERT INTO agent_apps VALUES(?,1,1)', [scope.appId]);
	await db.run("INSERT INTO agent_runs VALUES(?,1,?,?,'root','running',1,?)", [
		scope.runId,
		scope.appId,
		randomUUID(),
		Date.now() + 60000,
	]);
	await db.run("INSERT INTO agent_run_executions VALUES(?,?,'open',1,1)", [scope.runId, scope.executionGeneration]);
	const changes = new RunChanges();
	const storage = new SqliteOperationStorage(db);
	const model = new OperationModel(storage, () => {}, changes);
	const contents = new OperationContentService(new OperationContentModel(new SqliteOperationContentStorage(db)));
	const provider = {
		packageId: 'fixture.results',
		version: '1.0.0',
		packageHash: 'a'.repeat(64),
		publisherKeyId: 'ed25519:' + 'b'.repeat(64),
	};
	const participant = {
		id: randomUUID(),
		packageId: provider.packageId,
		generation: randomUUID(),
		configurationRevision: 0,
		packageRevision: 1,
	};
	let sequence = 0;

	async function insert({
		parentId = null,
		kind = 'effect',
		state = 'completed',
		label = 'remote.readTextPage',
		capability = 'file.read',
		capabilities = [],
		target = null,
		text = '{}',
		proof = true,
		binding: explicitBinding = null,
	} = {}) {
		const id = randomUUID();
		const binding =
			explicitBinding ??
			(kind === 'tool'
				? {
						kind: 'registry',
						key: label,
						summary: 'Fixture result capture',
						contract: 'fixture.results.tools',
						apiVersion: 1,
						package: provider,
						capabilities,
						binding: {
							id: randomUUID(),
							entryId: randomUUID(),
							instanceId: participant.id,
							generation: participant.generation,
							configurationRevision: 0,
							schemaSha256: 'c'.repeat(64),
						},
					}
				: {
						kind: 'native',
						name: label,
						version: '1',
						summary: 'Fixture native capture',
						risk: 'read',
						mutation: false,
						capability,
						requiredCapabilities: capabilities,
						target: target === null ? null : { ...target, fingerprint: 'fixture-target-' + target.id },
					});
		let resultJson = null;
		if (state === 'completed') {
			resultJson =
				kind === 'tool'
					? JSON.stringify({
							content: await contents.put(
								{ ...scope, operationId: null },
								participant.id,
								id,
								'application/json',
								text,
								new AbortController().signal,
							),
						})
					: text;
		}
		await db.run(
			`INSERT INTO agent_operations(id,user_id,app_id,run_id,execution_generation,parent_id,caller_id,operation_key,request_hash,kind,label,binding_json,arguments_json,state,revision,result_json,failure_code,created_at,updated_at,sequence)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			[
				id,
				scope.userId,
				scope.appId,
				scope.runId,
				scope.executionGeneration,
				parentId,
				participant.id,
				id,
				contentHash(id),
				kind,
				label,
				JSON.stringify(binding),
				'{}',
				state,
				1,
				resultJson,
				state === 'failed' ? 'forbidden' : null,
				1,
				1,
				++sequence,
			],
		);
		if (proof && state !== 'accepted') {
			await db.run('INSERT INTO agent_operation_authorities VALUES(?,?)', [
				id,
				JSON.stringify({
					policyRevision: 1,
					policyExecutionVersion: 1,
					denylistRevision: 1,
					settingsVersion: 1,
					instance: participant,
					ancestors: [],
					provider: null,
					target,
					modelReservation: null,
					approval: null,
				}),
			]);
		}
		return model.get(scope, participant.id, id);
	}

	return { db, scope, model, storage, contents, insert, changes, participant };
}
