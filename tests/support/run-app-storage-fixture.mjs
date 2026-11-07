import { randomUUID } from 'node:crypto';
import { SqliteRuntime } from '../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import {
	initializeAgentRunSchema,
	initializeAgentRunSteps,
} from '../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-schema.js';
import { initializeRunInputs } from '../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-input-migration.js';
import { initializeRunAppState } from '../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-app-state-schema.js';
import { migrateRunMessageLineage } from '../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-message-lineage-migration.js';
import {
	allowRunSuspension,
	initializeRunSuspensions,
} from '../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-suspension-schema.js';
import { SqliteRunAppStateStorage } from '../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-app-state-sql.js';
import { RunAppStateModel } from '../../packages/backend/dist/modules/agent/runs/model/run-app-state-model.js';
import { RunAppStateService } from '../../packages/backend/dist/modules/agent/runs/service/run-app-state-service.js';
import { RunChanges } from '../../packages/backend/dist/modules/agent/runs/model/run-changes.js';
import { initializeOperations } from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-schema.js';
import { sequenceOperations } from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-sequence-schema.js';
import {
	initializeOperationContents,
	SqliteOperationContentStorage,
} from '../../packages/backend/dist/modules/agent/operations/adapters/sqlite/operation-content-sql.js';
import { OperationContentModel } from '../../packages/backend/dist/modules/agent/operations/model/operation-content-model.js';
import { OperationContentService } from '../../packages/backend/dist/modules/agent/operations/service/operation-content-service.js';
import { finishRunApp } from '../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-app-terminal-sql.js';
import { contentHash } from './operation-storage-fixture.mjs';

/** Production Run/Operation/content/checkpoint DDL and transactions. Only unrelated
 * App/Thread/Child/Job parent facts are reduced; no authorization is substituted. */
export async function runAppStorageFixture(t) {
	const db = SqliteRuntime.openMemory();
	t.after(() => db.close());
	await db.exec(`PRAGMA foreign_keys=ON;
	 CREATE TABLE agent_apps(id TEXT,user_id INTEGER,enabled INTEGER,PRIMARY KEY(id,user_id));
	 CREATE TABLE agent_threads(id TEXT,user_id INTEGER,app_id TEXT,title TEXT,title_origin TEXT,version INTEGER,updated_at INTEGER,UNIQUE(id,user_id,app_id));
	 CREATE TABLE agent_run_children(run_id TEXT PRIMARY KEY,parent_id TEXT,request_hash TEXT,output_text TEXT);
	 CREATE TABLE agent_tool_jobs(id TEXT PRIMARY KEY,run_id TEXT,state TEXT);
	 CREATE TABLE agent_providers(id TEXT PRIMARY KEY);`);
	await initializeAgentRunSchema(db);
	await initializeAgentRunSteps(db);
	await allowRunSuspension(db);
	await initializeRunInputs(db);
	await initializeOperations(db);
	await sequenceOperations(db);
	await initializeOperationContents(db);
	await initializeRunAppState(db);
	await migrateRunMessageLineage(db);
	await initializeRunSuspensions(db);
	const changes = new RunChanges();
	const states = new RunAppStateService(new RunAppStateModel(new SqliteRunAppStateStorage(db), changes));
	const contents = new OperationContentService(new OperationContentModel(new SqliteOperationContentStorage(db)));
	const appId = randomUUID();
	await db.run('INSERT INTO agent_apps VALUES(?,1,1)', [appId]);
	let operationSequence = 0;

	async function create({
		userId = 1,
		application = appId,
		threadId = randomUUID(),
		sequence = 1,
		parentId = null,
	} = {}) {
		await db.run('INSERT OR IGNORE INTO agent_apps VALUES(?,?,1)', [application, userId]);
		await db.run("INSERT OR IGNORE INTO agent_threads VALUES(?,?,?,'New thread','pending',1,1)", [
			threadId,
			userId,
			application,
		]);
		const scope = { userId, appId: application, runId: randomUUID(), executionGeneration: randomUUID() };
		const creationHash = contentHash(scope.runId);
		await db.run("INSERT INTO agent_runs VALUES(?,?,?,?,?,?,'ask',1,'Current prompt',?,'[]',1,1,'running')", [
			scope.runId,
			userId,
			application,
			threadId,
			sequence,
			parentId === null ? 'root' : 'child',
			Date.now() + 60000,
		]);
		await db.run("INSERT INTO agent_run_executions VALUES(?,?,'open',1,1)", [
			scope.runId,
			scope.executionGeneration,
		]);
		await db.run('INSERT INTO agent_run_inputs VALUES(?,?,?,NULL)', [
			scope.runId,
			JSON.stringify({ kind: 'retired' }),
			JSON.stringify({ message: 'Current prompt' }),
		]);
		if (parentId === null) {
			await db.run(
				"INSERT INTO agent_command_idempotency VALUES(?,?,'create_run',?,?,?,'pending','created',1,1,1)",
				[userId, application, randomUUID(), creationHash, scope.runId],
			);
		} else {
			await db.run('INSERT INTO agent_run_children VALUES(?,?,?,NULL)', [scope.runId, parentId, creationHash]);
		}
		return { ...scope, threadId, sequence, creationHash };
	}

	function put(scope, text = '{"phase":"prepare"}', key = randomUUID()) {
		return contents.put(
			{ ...scope, operationId: null },
			scope.appId,
			key,
			'application/vnd.fixture.state+json',
			text,
			new AbortController().signal,
		);
	}

	async function receipt(scope, { state = 'completed', label = 'remote.readTextPage' } = {}) {
		const id = randomUUID();
		const binding = {
			kind: 'native',
			name: label,
			version: '1',
			summary: 'Fixture capability',
			risk: 'read',
			mutation: false,
			capability: 'context.read',
			requiredCapabilities: [],
			target: null,
		};
		await db.run(
			`INSERT INTO agent_operations(id,user_id,app_id,run_id,execution_generation,parent_id,caller_id,operation_key,request_hash,kind,label,binding_json,arguments_json,state,revision,result_json,failure_code,created_at,updated_at,sequence)
		 VALUES(?,?,?,?,?,NULL,?,?,?,'effect',?,?,'{}',?,1,?,?,1,1,?)`,
			[
				id,
				scope.userId,
				scope.appId,
				scope.runId,
				scope.executionGeneration,
				scope.appId,
				id,
				contentHash(id),
				label,
				JSON.stringify(binding),
				state,
				state === 'completed' ? '{}' : null,
				state === 'failed' ? 'forbidden' : null,
				++operationSequence,
			],
		);
		return id;
	}

	function finish(
		scope,
		terminal = { state: 'completed', outputJson: JSON.stringify({ kind: 'complete', outputs: [] }) },
	) {
		return db.transaction((tx) =>
			finishRunApp(
				tx,
				{
					userId: scope.userId,
					appId: scope.appId,
					runId: scope.runId,
					creationHash: scope.creationHash,
					executionGeneration: scope.executionGeneration,
					expectedVersion: 1,
					now: Date.now(),
				},
				terminal,
			),
		);
	}

	return { db, states, contents, create, put, receipt, finish };
}
