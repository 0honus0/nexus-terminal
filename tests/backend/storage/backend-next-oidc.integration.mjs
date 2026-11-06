import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../packages/backend/dist/bootstrap/schema.js';
import { registerAccessBackupExclusions } from '../../../packages/backend/dist/modules/access/register.js';
import { SqliteOidcStorage } from '../../../packages/backend/dist/modules/access/oidc/adapters/sqlite/oidc-sql.js';
import { OidcModel } from '../../../packages/backend/dist/modules/access/oidc/model/oidc-model.js';
import { SecureSessionTokens } from '../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';
import { SecretBox } from '../../../packages/backend/dist/platform/security/secret-box.js';
import { SqliteFailure } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';

const tokens = new SecureSessionTokens();
const secrets = new SecretBox(Buffer.alloc(32, 9));
const redirectUri = 'https://nexus.example/login/oidc/callback';

async function seed(db) {
	const token = tokens.issue();
	await db.run('INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(1,?,?,?,?)', [
		'admin',
		'test-password-hash',
		Date.now(),
		Date.now(),
	]);
	await db.run(
		'INSERT INTO access_sessions(token_digest,user_id,password_revision,remember_me,expires_at,created_at) VALUES(?,1,?,0,?,?)',
		[
			tokens.digest(token),
			createHash('sha256').update('test-password-hash').digest('hex'),
			Date.now() + 3600000,
			Date.now(),
		],
	);
	return token;
}

async function fixture() {
	const db = SqliteRuntime.openMemory();
	await initializeSchema(db, applicationMigrations);
	const token = await seed(db);
	const storage = new SqliteOidcStorage(db);
	let authorization;
	let gate = null;

	let verificationReached = () => {};

	const model = new OidcModel(storage, tokens, secrets, {
		async authorize(_configuration, input) {
			authorization = input;
			return 'https://id.example/authorize';
		},

		async verify() {
			verificationReached();
			if (gate) await gate;
			return { issuer: 'https://id.example', subject: 'subject-1' };
		},
	});
	await model.save(token, {
		revision: null,
		enabled: true,
		label: 'Pocket ID',
		issuer: 'https://id.example',
		clientId: 'nexus',
		clientAuthentication: 'none',
		secret: { action: 'clear' },
	});

	const start = async (purpose) => {
		const configuration = await model.settings(token);
		const flow = await model.start({
			purpose,
			token: purpose === 'binding' ? token : null,
			previousCookie: null,
			revision: configuration.revision,
			redirectUri,
			rememberMe: false,
			source: '203.0.113.8',

			enforceBlock: () => true,

			signal: new AbortController().signal,
		});
		return { cookie: flow.cookie, state: authorization.state };
	};

	const finish = (flow, purpose, signal = new AbortController().signal) =>
		model.finish(
			flow.cookie,
			purpose === 'binding' ? token : null,
			redirectUri,
			{ code: 'single-code', state: flow.state, issuer: 'https://id.example', error: null },
			'203.0.113.8',
			() => true,
			signal,
			purpose,
		);

	return {
		db,
		token,
		storage,
		model,
		start,
		finish,

		setGate(value, reached) {
			gate = value;
			verificationReached = reached;
		},
	};
}

test('OIDC v3 -> v4 preserves data, records migration once and reopens', async () => {
	const base = process.env.NEXUS_TEST_ARTIFACTS_ROOT ?? tmpdir();
	await mkdir(base, { recursive: true });
	const root = await mkdtemp(join(base, 'oidc-migration-'));
	const path = join(root, 'upgrade.sqlite');
	let db = SqliteRuntime.open(path);
	try {
		await initializeSchema(db, applicationMigrations.slice(0, 3));
		await seed(db);
		const before = await db.all('SELECT * FROM schema_version ORDER BY version');
		await initializeSchema(db, applicationMigrations);
		assert.deepEqual(await db.all('SELECT * FROM schema_version WHERE version<4 ORDER BY version'), before);
		assert.equal((await db.one('SELECT COUNT(*) AS count FROM access_sessions')).count, 1);
		await db.close();
		db = SqliteRuntime.open(path);
		await initializeSchema(db, applicationMigrations);
		assert.deepEqual(
			(await db.all('SELECT version FROM schema_version ORDER BY version')).map((row) => row.version),
			[1, 2, 3, 4],
		);
		assert.equal((await db.one('PRAGMA integrity_check')).integrity_check, 'ok');
		assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
		for (const name of ['access_oidc_configuration', 'access_oidc_flows', 'access_oidc_sessions']) {
			assert.ok(registerAccessBackupExclusions().includes(name));
		}
	} finally {
		await db.close();
	}
});

test('OIDC flow expiry, password revision and required Passkey are enforced by the real transaction', async () => {
	const f = await fixture();
	try {
		const binding = await f.start('binding');
		const row = await f.db.one('SELECT * FROM access_oidc_flows');
		assert.ok(row.verifier_cipher.startsWith('v1.'));
		await f.db.run('UPDATE access_oidc_flows SET expires_at=?', [Date.now() - 1]);
		await assert.rejects(f.finish(binding, 'binding'), (error) => error.code === 'challenge_expired');
		await f.finish(await f.start('binding'), 'binding');
		const login = await f.start('login');
		await f.db.run('UPDATE access_accounts SET passkey_required=1');
		assert.equal(await f.model.provider(), null);
		await assert.rejects(f.finish(login, 'login'), (error) => error.code === 'invalid_credentials');
		await f.db.run('UPDATE access_accounts SET passkey_required=0');
		const changed = await f.start('login');
		await f.db.run("UPDATE access_accounts SET password_hash='changed-password-hash'");
		await assert.rejects(f.finish(changed, 'login'), (error) => error.code === 'invalid_credentials');
		assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM access_oidc_sessions')).count, 0);
	} finally {
		await f.db.close();
	}
});

test('OIDC cancellation and source ban during verification prevent issuance', async () => {
	const f = await fixture();
	let release;
	try {
		await f.finish(await f.start('binding'), 'binding');
		const signal = new AbortController();
		const login = await f.start('login');
		signal.abort();
		await assert.rejects(f.finish(login, 'login', signal.signal), (error) => error.code === 'challenge_expired');
		const second = await f.start('login');
		let reached;
		const verifying = new Promise((resolve) => {
			reached = resolve;
		});
		f.setGate(
			new Promise((resolve) => {
				release = resolve;
			}),
			reached,
		);
		const pending = f.finish(second, 'login');
		await verifying;
		await f.db.run(
			'INSERT INTO access_login_attempts(source,attempts,window_started_at,blocked_until,last_attempt_at) VALUES(?,1,?,?,?)',
			['203.0.113.8', Date.now(), Date.now() + 300000, Date.now()],
		);
		release();
		await assert.rejects(pending, (error) => error.code === 'forbidden');
		assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM access_oidc_sessions')).count, 0);
	} finally {
		release?.();
		await f.db.close();
	}
});

test('OIDC commit acknowledgement loss revokes the known, unissued bearer', async () => {
	const f = await fixture();
	try {
		await f.finish(await f.start('binding'), 'binding');
		const complete = f.storage.complete.bind(f.storage);
		f.storage.complete = async (...args) => {
			await complete(...args);
			throw new SqliteFailure('commit_unknown', null);
		};
		await assert.rejects(f.finish(await f.start('login'), 'login'), (error) => error.code === 'operation_unknown');
		assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM access_oidc_sessions')).count, 0);
		assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM access_sessions')).count, 1);
	} finally {
		await f.db.close();
	}
});
