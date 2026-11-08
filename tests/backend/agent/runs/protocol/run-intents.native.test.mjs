import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createTestAgentApp } from '../support/native-agent-fixture.mjs';
import { send, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { ACCESS_SESSION_COOKIE_NAME } from '../../../../../packages/shared/dist/access/values.js';
import { SqliteExecutionStorage } from '../../../../../packages/backend/dist/modules/agent/execution/adapters/sqlite/execution-sql.js';
import { ExecutionModel } from '../../../../../packages/backend/dist/modules/agent/execution/model/execution-model.js';
import { ExecutionService } from '../../../../../packages/backend/dist/modules/agent/execution/service/execution-service.js';
import { createApp } from '../../../../../packages/backend/dist/bootstrap/create-app.js';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import { SqliteAccountStorage } from '../../../../../packages/backend/dist/modules/access/accounts/adapters/sqlite/account-sql.js';
import { SqliteProviderStorage } from '../../../../../packages/backend/dist/modules/agent/providers/adapters/sqlite/provider-sql.js';
import { SqliteSessionStorage } from '../../../../../packages/backend/dist/modules/access/sessions/adapters/sqlite/session-sql.js';
import { SessionModel } from '../../../../../packages/backend/dist/modules/access/sessions/model/session-model.js';
import { SecureSessionTokens } from '../../../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';

await test(
	'Dispatched Run intents replay exactly, reject conflicts, cancel once and retain scoped event cursors',
	{ timeout: 60000 },
	async (t) => {
		const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir();
		await mkdir(artifactRoot, { recursive: true });
		const root = await mkdtemp(join(artifactRoot, 'run-intents-'));
		const key = randomBytes(32);
		const dbPath = join(root, 'state.db');
		const db = SqliteRuntime.open(dbPath);
		let app;
		let providerRequestedCount = 0;
		const modelServer = createServer((_request, response) => {
			response.writeHead(200, { 'Content-Type': 'text/event-stream' });
			response.flushHeaders();
			providerRequestedCount++;
		});
		t.after(async () => {
			const failures = [];
			try {
				if (app) await app.close();
			} catch (error) {
				failures.push(error);
			}
			const outcomes = await Promise.allSettled([
				Promise.resolve().then(() => db.close()),
				Promise.resolve().then(() => {
					modelServer.closeAllConnections();
					return new Promise((resolve, reject) =>
						modelServer.close((error) => (error ? reject(error) : resolve())),
					);
				}),
			]);
			failures.push(...outcomes.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])));
			if (failures.length) throw new AggregateError(failures, 'Run intents fixture did not drain');
		});
		modelServer.listen(0, '127.0.0.1');
		await once(modelServer, 'listening');
		await initializeSchema(db, applicationMigrations);
		await new SqliteAccountStorage(db).createInitialAdmin({ username: 'regression', passwordHash: 'fixture-hash' });
		const provider = await new SqliteProviderStorage(db).create({
			id: randomUUID(),
			userId: 1,
			displayName: 'storage fixture',
			baseUrl: 'http://127.0.0.1:' + modelServer.address().port + '/v1',
			protocol: 'chat-completions',
			models: [{ id: 'fixture', contextWindow: 8192, maxOutputTokens: 256, supportsTools: false }],
			enabled: true,
			now: Date.now(),
		});
		const executionStorage = new SqliteExecutionStorage(db);
		const tokens = new SecureSessionTokens();
		executionStorage.installTransactionIdentityReader(async (_tx, digest) =>
			digest === tokens.digest('fixture-session') ? 1 : null,
		);
		const settings = new ExecutionService(new ExecutionModel(executionStorage, tokens), async () => undefined);
		const defaults = await settings.get(1);
		await settings.update({ userId: 1, token: 'fixture-session' }, defaults.version, true, defaults.limits);
		const fixtureSession = await new SessionModel(new SqliteSessionStorage(db), tokens).issue({
			accountId: 1,
			passwordHash: 'fixture-hash',
			rememberMe: false,
			expiresAt: Date.now() + 60_000,
			source: 'fixture',
			clearLoginAttempts: false,
		});
		assert.equal(fixtureSession.status, 'issued');
		await db.close();
		app = await createApp(dbPath, { encryptionKey: key });
		const fixtureOrigin = 'http://127.0.0.1:0';
		const address = await app.listenHttp({
			publicOrigin: fixtureOrigin,
			bindHost: '127.0.0.1',
			port: 0,
			trustedProxies: [],
		});

		const fixtureApi = (method, path, body, headers) =>
			send(address, ACCESS_SESSION_COOKIE_NAME + '=' + fixtureSession.token, method, path, body, {
				Host: new URL(fixtureOrigin).host,
				Origin: fixtureOrigin,
				...headers,
			});

		const agentApp = await createTestAgentApp(fixtureApi, root, 'regression', {
			selectedRootIds: [],
			uiPackageId: null,
		});
		if (!agentApp.enabled) {
			await app.agent.setAppEnabled(1, agentApp.id, true, agentApp.version);
		}
		const grantPath = '/api/v1/agent/apps/' + agentApp.id + '/grants';
		const grants = (await fixtureApi('GET', grantPath)).body;
		assert.equal(
			(
				await fixtureApi('PUT', grantPath, {
					expectedPolicyRevision: grants.policyRevision,
					grants: [{ capability: 'plugin.invoke', scope: { kind: 'global' } }],
				})
			).status,
			200,
		);
		const thread = await app.agent.createThread(1, agentApp.id, 'state');
		const intent = {
			userId: 1,
			appId: agentApp.id,
			threadId: thread.id,
			prompt: 'hello',
			approvalMode: 'ask',
			connectionIds: [],
			inputJson: JSON.stringify({
				model: {
					providerId: provider.id,
					modelId: 'fixture',
					configurationVersion: provider.version,
					reasoningEffort: null,
				},
				artifacts: [],
			}),
			operationKey: randomUUID(),
		};
		const createdRun = await app.agent.createRun(intent);
		assert.equal(createdRun.status, 'created');
		await until(
			async () => providerRequestedCount,
			(count) => count === 1,
			'Actual model request dispatched',
		);
		assert.equal((await app.agent.createRun(intent)).status, 'replayed');
		assert.equal((await app.agent.createRun({ ...intent, prompt: 'different' })).status, 'idempotency_conflict');
		assert.equal(
			(await app.agent.createRun({ ...intent, operationKey: randomUUID() })).status,
			'active_run_conflict',
		);
		const cancelIntent = {
			userId: 1,
			appId: agentApp.id,
			runId: createdRun.run.id,
			expectedVersion: (await app.agent.getRun(1, agentApp.id, createdRun.run.id)).version,
			operationKey: randomUUID(),
		};
		assert.equal((await app.agent.cancelRun({ ...cancelIntent, expectedVersion: 99 })).status, 'version_conflict');
		assert.equal((await app.agent.cancelRun(cancelIntent)).status, 'cancelled');
		assert.equal((await app.agent.cancelRun(cancelIntent)).status, 'replayed');
		assert.equal((await app.agent.getRun(1, agentApp.id, createdRun.run.id)).status, 'cancelled');
		assert.equal(await app.agent.getRun(2, agentApp.id, createdRun.run.id), null);
		const firstPage = await app.agent.listEvents(1, agentApp.id, createdRun.run.id, 0, 1);
		assert.equal(firstPage.items.length, 1);
		const nextPage = await app.agent.listEvents(1, agentApp.id, createdRun.run.id, firstPage.nextCursor, 1);
		assert.equal(nextPage.items.length, 1);
		assert.ok(nextPage.items[0].sequence > firstPage.nextCursor);

		assert.equal(providerRequestedCount, 1, 'Replay and conflict must not dispatch another model request');
	},
);
