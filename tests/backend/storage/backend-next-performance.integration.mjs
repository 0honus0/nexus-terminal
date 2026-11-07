import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../packages/backend/dist/bootstrap/schema.js';
import { SqliteAuditStorage } from '../../../packages/backend/dist/modules/operations/audit/adapters/sqlite/audit-sql.js';
import { SqliteNotificationStorage } from '../../../packages/backend/dist/modules/operations/notifications/adapters/sqlite/notification-sql.js';
import { SqliteAccountStorage } from '../../../packages/backend/dist/modules/access/accounts/adapters/sqlite/account-sql.js';
import { SqliteHistoryStorage } from '../../../packages/backend/dist/modules/preferences/history/adapters/sqlite/history-sql.js';
import { registerOperationsSnapshot } from '../../../packages/backend/dist/modules/operations/snapshots/adapters/sqlite/snapshot-registration.js';
import { ProviderModel } from '../../../packages/backend/dist/modules/agent/providers/model/provider-model.js';
import { RunChanges } from '../../../packages/backend/dist/modules/agent/runs/model/run-changes.js';
import { providerStorageDouble, threadStorageDouble } from '../../support/agent-storage-doubles.mjs';

async function database(t, version = applicationMigrations.length) {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACTS_ROOT ?? tmpdir(), 'nexus-performance-'));
	const db = SqliteRuntime.open(join(root, 'test.sqlite'));
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
	await initializeSchema(db, applicationMigrations.slice(0, version));
	return db;
}

function notice(key) {
	return {
		key,
		event: 'LOGIN_SUCCESS',
		createdAt: 1,
		userId: null,
		sourceIp: null,
		subjectId: null,
		route: null,
		statusCode: null,
	};
}

function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test('Performance: v4 upgrade preserves notification membership and independent migration signatures', async (t) => {
	const db = await database(t, 4);
	await db.exec(
		"INSERT INTO operations_audit(event_key,event,created_at) VALUES('settled','LOGIN_SUCCESS',1),('pending','LOGIN_SUCCESS',2); INSERT INTO operations_notification_fanout(audit_id) VALUES(1)",
	);
	const before = await db.all('SELECT * FROM schema_version ORDER BY version');
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(await db.all('SELECT * FROM schema_version WHERE version<=4 ORDER BY version'), before);
	assert.deepEqual(
		(await db.all('SELECT audit_id FROM operations_notification_pending')).map((row) => row.audit_id),
		[2],
	);
	const ledger = await db.all('SELECT * FROM schema_version ORDER BY version');
	await initializeSchema(db, applicationMigrations);
	assert.deepEqual(await db.all('SELECT * FROM schema_version ORDER BY version'), ledger);
	for (const [table, column, index] of [
		['agent_run_budget_reservations', 'root_id', 'agent_budget_reservation_root'],
		['agent_governance_approvals', 'run_id', 'agent_approval_run_lookup'],
		['agent_governance_approvals', 'tool_call_id', 'agent_approval_tool_lookup'],
		['agent_governance_resolution_keys', 'approval_id', 'agent_resolution_approval_lookup'],
		['agent_context_compactions', 'run_id', 'agent_compaction_run_lookup'],
	]) {
		const plan = await db.all(`EXPLAIN QUERY PLAN SELECT * FROM ${table} WHERE ${column}=?`, ['fixture']);
		assert.ok(
			plan.some((row) => row.detail.includes(index)),
			JSON.stringify(plan),
		);
	}
	assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
	assert.equal((await db.one('PRAGMA integrity_check')).integrity_check, 'ok');
});

test('Performance: pending fanout rollback, idempotency, empty queue and restore suppression', async (t) => {
	const db = await database(t);
	const audit = new SqliteAuditStorage(db);
	const notifications = new SqliteNotificationStorage(db);
	const saved = await audit.append(notice('event'));
	assert.equal((await audit.append(notice('event'))).created, false);
	await assert.rejects(
		notifications.fanout(() => {
			throw new Error('observer failure');
		}),
		/observer failure/,
	);
	assert.equal((await db.one('SELECT COUNT(*) AS n FROM operations_notification_pending')).n, 1);
	assert.equal(await notifications.fanout(() => []), 1);
	assert.equal(await notifications.fanout(() => assert.fail('Empty queue must not inspect settings')), 0);
	assert.equal((await db.one('SELECT COUNT(*) AS n FROM operations_notification_pending')).n, 0);
	const pending = await audit.append(notice('pending'));
	await audit.prune(0);
	assert.equal(await db.one('SELECT id FROM operations_audit WHERE id=?', [saved.record.id]), null);
	assert.ok(await db.one('SELECT id FROM operations_audit WHERE id=?', [pending.record.id]));
	await notifications.recover({ discardQueued: true, suppressHistoricalFanout: true });
	assert.equal(await notifications.fanout(() => assert.fail('Restore must not replay notices')), 0);
	const registration = registerOperationsSnapshot(null);
	const rows = new Map();
	for (const table of registration.tables) rows.set(table.name, await db.all('SELECT * FROM ' + table.name));
	registration.validate(rows);
	rows.set('operations_notification_pending', [{ audit_id: pending.record.id }]);
	assert.throws(() => registration.validate(rows));
	rows.set('operations_notification_pending', []);
	rows.set('operations_notification_fanout', []);
	assert.throws(() => registration.validate(rows));
});

test('Performance: state composition shares one transaction and keeps admission before commit', async (t) => {
	const db = await database(t);
	await db.exec('CREATE TABLE composition(id INTEGER PRIMARY KEY,value INTEGER)');
	let checks = 0;
	const before = db.statistics.read().commit.count;
	await db.withTransactionAdmission(
		async () => {
			checks++;
		},
		() =>
			db.composeTransaction(async () => {
				await db.transaction((tx) => tx.run('INSERT INTO composition VALUES(1,0)'));
				await Promise.all([
					db.one('SELECT value FROM composition'),
					db.transaction((tx) => tx.run('UPDATE composition SET value=1')),
				]);
			}),
	);
	assert.equal(checks, 2);
	assert.equal(db.statistics.read().commit.count - before, 1);
	assert.equal((await db.one('SELECT value FROM composition')).value, 1);
	const revoked = new Error('revoked');
	checks = 0;
	await assert.rejects(
		db.withTransactionAdmission(
			async () => {
				if (++checks === 2) throw revoked;
			},
			() =>
				db.composeTransaction(async () => {
					await db.run('UPDATE composition SET value=2');
				}),
		),
		(error) => error === revoked,
	);
	assert.equal((await db.one('SELECT value FROM composition')).value, 1);
});

test('Performance: caught, detached and late state participants cannot commit partial writes', async (t) => {
	const db = await database(t);
	await db.exec('CREATE TABLE composition(id INTEGER PRIMARY KEY)');
	const failure = new Error('participant failed');
	await assert.rejects(
		db.composeTransaction(async () => {
			await db.run('INSERT INTO composition VALUES(1)');
			await db
				.transaction(async () => {
					throw failure;
				})
				.catch(() => {});
		}),
		(error) => error === failure,
	);
	assert.deepEqual(await db.all('SELECT * FROM composition'), []);
	const started = deferred();
	const gate = deferred();
	let detached;
	const pending = db.composeTransaction(async () => {
		detached = db.transaction(async (tx) => {
			started.resolve();
			await gate.promise;
			await tx.run('INSERT INTO composition VALUES(2)');
		});
		await started.promise;
	});
	await started.promise;
	await new Promise((resolve) => setImmediate(resolve));
	gate.resolve();
	await assert.rejects(pending, (error) => error.kind === 'transaction');
	await detached;
	assert.deepEqual(await db.all('SELECT * FROM composition'), []);
	let later;
	await db.composeTransaction(async () => {
		later = () => db.run('INSERT INTO composition VALUES(3)');
	});
	// AsyncLocalStorage is inherited by the scheduled callback, not by a function created in the scope.
	const release = deferred();
	let late;
	await db.composeTransaction(async () => {
		late = release.promise.then(() => later());
	});
	release.resolve();
	await assert.rejects(late, (error) => error.kind === 'transaction');
	assert.deepEqual(await db.all('SELECT * FROM composition'), []);
	await assert.rejects(
		db.transaction(() => db.transaction(async () => undefined)),
		(error) => error.kind === 'transaction',
	);
});

test('Performance: Run notifications isolate unrelated runs but retain thread, child and app invalidation', async () => {
	const changes = new RunChanges();
	const scope = { userId: 1, appId: 'app' };
	const seen = [];
	let stopped = 0;
	const close = changes.subscribe(
		scope,
		(kind) => seen.push(kind),
		() => {
			stopped++;
		},
		(change) => ['root', 'child'].includes(change.runId) || change.threadId === 'thread',
	);
	changes.notify({ ...scope, runId: 'other' }, 'text');
	changes.notify({ ...scope, runId: 'root' }, 'text');
	changes.notify({ ...scope, runId: 'child' });
	changes.notify({ ...scope, threadId: 'thread' });
	changes.notify(scope);
	changes.notify({ userId: 2, appId: 'app' });
	const failure = new Error('commit not confirmed');
	await assert.rejects(
		changes.after({ ...scope, runId: 'root' }, async () => {
			throw failure;
		}),
		(error) => error === failure,
	);
	assert.deepEqual(seen, ['text', 'state', 'state', 'state', 'state']);
	changes.quiesce();
	assert.equal(stopped, 1);
	close();
});

test('Performance: Provider guards use typed generation facts and reject every stale credential state', async () => {
	let generation = { enabled: true, version: 4, credentialRevision: 2 };
	const storage = providerStorageDouble({ generation: async () => generation });
	const model = new ProviderModel(storage, null, null);
	const current = { userId: 1, id: 'provider', version: 4, credentialRevision: 2 };
	await model.guardCurrent(current);
	for (const value of [
		null,
		{ ...generation, enabled: false },
		{ ...generation, version: 5 },
		{ ...generation, credentialRevision: 3 },
	]) {
		generation = value;
		await assert.rejects(model.guardCurrent(current), (error) => error.code === 'provider_configuration_stale');
	}
	const threads = threadStorageDouble({ withState: async (_access, _admit, work) => work() });
	assert.equal(
		await threads.withState(
			{},
			() => {},
			async () => 7,
		),
		7,
	);
	await assert.rejects(threads.list(), /Unexpected storage call/);
});

test('Performance: history retention preserves the just-used old id at equal timestamps', async (t) => {
	const db = await database(t);
	await new SqliteAccountStorage(db).createInitialAdmin({ username: 'fixture', passwordHash: 'hash' });
	const history = new SqliteHistoryStorage(db);
	history.installTransactionIdentityReader(async () => 1);
	const actor = {
		sessionDigest: 'fixture',

		admit: (id) => assert.equal(id, 1),
	};

	const add = (text, retain = 3) => history.add({ userId: 1, kind: 'command', text, retain }, actor);

	await add('old');
	await add('middle');
	await add('new');
	await db.run('UPDATE preferences_history SET recorded_at=?', [Math.floor(Date.now() / 1000) + 3600]);
	const old = await add('old', 2);
	const values = await history.list(1, 'command', 0, 10);
	assert.deepEqual(
		values.map((row) => row.text),
		['old', 'new'],
	);
	assert.equal(values[0].id, old.id);
});

test('Performance: installed diagnostics route and Shared decoder agree on fields, units and errors', async (t) => {
	const { openHttpListener } = await import('../../../packages/backend/dist/platform/http/http-server.js');
	const { createDiagnosticRoutes } =
		await import('../../../packages/backend/dist/modules/system/interfaces/http/diagnostic-http.js');
	const { readHostDiagnosticResponse } =
		await import('../../../packages/shared/dist/system/diagnostics/http-codec.js');
	const { DIAGNOSTIC_MODULE_IDS, DIAGNOSTIC_RESOURCE_UNITS } =
		await import('../../../packages/shared/dist/system/diagnostics/values.js');
	const { HOST_DIAGNOSTIC_PATH } = await import('../../../packages/shared/dist/system/diagnostics/http.js');
	const { send } = await import('../remote/openssh-fixture.mjs');
	const value = {
		collectedAt: 1,
		process: {
			uptimeSeconds: 1,
			residentBytes: 1,
			heapUsedBytes: 1,
			runtimeVersion: 'v26',
			heapTotalBytes: 2,
			externalBytes: 0,
			arrayBufferBytes: 0,
			cpuUserSeconds: 0.2,
			cpuSystemSeconds: 0.1,
			gcCount: 0,
			gcDurationSeconds: 0,
		},
		database: { available: true, schemaVersion: 10 },
		modules: DIAGNOSTIC_MODULE_IDS.map((id) => ({
			id,
			status: id === 'storage' ? 'available' : 'not_instrumented',
			metrics:
				id === 'storage'
					? Object.entries(DIAGNOSTIC_RESOURCE_UNITS)
							.filter(([name]) => name.startsWith('database_'))
							.map(([name, unit]) => ({ name, unit, value: 1 }))
					: [],
		})),
	};
	const server = await openHttpListener({
		publicOrigin: 'http://127.0.0.1:0',
		bindHost: '127.0.0.1',
		port: 0,
		trustedProxies: [],
		routes: createDiagnosticRoutes({ collectAuthenticated: async () => value }),
	});
	t.after(() => server.close());
	const response = await send(server.address, '', 'GET', HOST_DIAGNOSTIC_PATH, undefined, { Host: '127.0.0.1:0' });
	assert.equal(response.status, 200);
	assert.deepEqual(readHostDiagnosticResponse(response.body), { diagnostics: value });
	const invalid = structuredClone(response.body);
	invalid.diagnostics.modules.find((module) => module.id === 'storage').metrics[0].unit = 'invalid';
	assert.throws(() => readHostDiagnosticResponse(invalid));
	invalid.diagnostics.extra = true;
	assert.throws(() => readHostDiagnosticResponse(invalid));
	const badQuery = await send(server.address, '', 'GET', HOST_DIAGNOSTIC_PATH + '?extra=1', undefined, {
		Host: '127.0.0.1:0',
	});
	assert.equal(badQuery.status, 400);
	assert.deepEqual(badQuery.body, { code: 'invalid_input' });
});
