import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import { SqliteSessionStorage } from '../../../../../packages/backend/dist/modules/access/sessions/adapters/sqlite/session-sql.js';
import { SessionModel } from '../../../../../packages/backend/dist/modules/access/sessions/model/session-model.js';
import { SecureSessionTokens } from '../../../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';

test('Concurrent password failures atomically increment SQLite attempts and enforce the ban', async (t) => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const root = await mkdtemp(join(artifactRoot, 'nexus-owner-'));
	const db = SqliteRuntime.open(join(root, 'failures.db'));
	t.onTestFinished(() => db.close());
	await initializeSchema(db, applicationMigrations);
	const sessions = new SqliteSessionStorage(db);
	const model = new SessionModel(sessions, new SecureSessionTokens());
	const limits = { maxAttempts: 3, windowMs: 10000, banMs: 20000 };
	await Promise.all(Array.from({ length: 3 }, () => model.recordFailedPassword('regression-source', limits)));
	assert.equal(
		(await sessions.getLoginFailure('regression-source')).attempts,
		3,
		'concurrent failures must not lose increments',
	);
	assert.equal(await model.checkLoginAdmission('regression-source'), false);
});
