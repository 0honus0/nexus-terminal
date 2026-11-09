import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { applicationMigrations } from '../../../../../packages/backend/dist/bootstrap/schema.js';
import { registerAccessBackupExclusions } from '../../../../../packages/backend/dist/modules/access/register.js';
import { SqliteOidcStorage } from '../../../../../packages/backend/dist/modules/access/oidc/adapters/sqlite/oidc-sql.js';
import { LoginOptionsModel } from '../../../../../packages/backend/dist/modules/access/login-options/model/login-options-model.js';
import { OidcModel } from '../../../../../packages/backend/dist/modules/access/oidc/model/oidc-model.js';
import { SecureSessionTokens } from '../../../../../packages/backend/dist/platform/security/adapters/secure-session-tokens.js';
import { SecretBox } from '../../../../../packages/backend/dist/platform/security/secret-box.js';
import { SqliteFailure } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';

const tokens = new SecureSessionTokens();
const secrets = new SecretBox(Buffer.alloc(32, 9));
const redirectUri = 'https://nexus.example/login/oidc/callback';

function installationModel(db, overrides = {}, storage = new SqliteOidcStorage(db), configurationChanged = () => {}) {
	return new OidcModel(
		storage,
		tokens,
		secrets,
		{
			authorize: async () => {
				throw new Error('Unexpected protocol call');
			},

			verify: async () => {
				throw new Error('Unexpected protocol call');
			},
		},
		{
			issuer: 'https://id.example',
			clientId: 'nexus',
			clientAuthentication: 'none',
			clientSecret: null,
			label: 'Pocket ID',
			subject: null,
			...overrides,
		},
		configurationChanged,
	);
}

test('resident login options tolerate an empty installation and refresh after delayed environment setup', async () => {
	const db = SqliteRuntime.openMemory();
	let options;
	let changes = 0;
	try {
		await initializeSchema(db, applicationMigrations);
		const model = installationModel(db, { subject: 'bound-account' }, new SqliteOidcStorage(db), () => {
			changes++;
			options.invalidate();
		});
		options = new LoginOptionsModel(model, { hasPasskeys: async () => false });
		await model.initialize();
		assert.deepEqual(await options.read(), { oidcLabel: null, hasPasskeys: false });
		assert.deepEqual(await options.read(), { oidcLabel: null, hasPasskeys: false });
		assert.equal(changes, 0);
		await seed(db);
		options.invalidate();
		assert.deepEqual(await options.read(), { oidcLabel: 'Pocket ID', hasPasskeys: false });
		assert.deepEqual(await options.read(), { oidcLabel: 'Pocket ID', hasPasskeys: false });
		assert.equal(changes, 1);
	} finally {
		await options?.close();
		await db.close();
	}
});

test('OIDC installation waits for administrator setup and never binds the first unauthenticated caller', async () => {
	const db = SqliteRuntime.openMemory();
	try {
		await initializeSchema(db, applicationMigrations);
		const model = installationModel(db);
		await model.initialize();
		assert.equal(await model.provider(), null);
		assert.equal(await db.one('SELECT * FROM access_oidc_configuration'), null);
		const token = await seed(db);
		const settings = await model.settings(token);
		assert.equal(settings.bound, false);
		assert.equal(await model.provider(), null);
		await assert.rejects(
			model.start({
				purpose: 'login',
				token: null,
				previousCookie: null,
				revision: null,
				redirectUri,
				rememberMe: false,
				source: '',

				enforceBlock: () => false,

				signal: new AbortController().signal,
			}),
			(error) => error.code === 'invalid_credentials',
		);
	} finally {
		await db.close();
	}
});

test('OIDC installation retains an existing binding only for the same issuer and client', async () => {
	const f = await fixture();
	try {
		await f.finish(await f.start('binding'), 'binding');
		const before = await f.model.settings(f.token);
		const same = installationModel(f.db);
		await same.initialize();
		assert.equal((await same.settings(f.token)).revision, before.revision);
		assert.equal((await same.settings(f.token)).bound, true);
		const changed = installationModel(f.db, { issuer: 'https://another.example' });
		await changed.initialize();
		assert.equal((await changed.settings(f.token)).bound, false);
		assert.equal(await changed.provider(), null);
		assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM access_sessions')).count, 1);
	} finally {
		await f.db.close();
	}
});

test('OIDC installation keeps unknown write evidence and does not automatically replay it', async () => {
	const f = await fixture();
	try {
		let calls = 0;
		const configure = f.storage.configure.bind(f.storage);
		f.storage.configure = async (...args) => {
			calls += 1;
			await configure(...args);
			throw new SqliteFailure('commit_unknown', null);
		};
		const model = installationModel(f.db, { label: 'Deployment' }, f.storage);
		await assert.rejects(model.initialize(), (error) => error.code === 'operation_unknown');
		await assert.rejects(model.settings(f.token), (error) => error.code === 'operation_unknown');
		assert.equal(calls, 1);
		assert.equal((await f.db.one('SELECT label FROM access_oidc_configuration')).label, 'Deployment');
	} finally {
		await f.db.close();
	}
});

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

async function fixture(configurationChanged = () => {}) {
	const db = SqliteRuntime.openMemory();
	await initializeSchema(db, applicationMigrations);
	const token = await seed(db);
	const storage = new SqliteOidcStorage(db);
	let authorization;
	let gate = null;

	let verificationReached = () => {};

	const model = new OidcModel(
		storage,
		tokens,
		secrets,
		{
			async authorize(_configuration, input) {
				authorization = input;
				return 'https://id.example/authorize';
			},

			async verify() {
				verificationReached();
				if (gate) await gate;
				return { issuer: 'https://id.example', subject: 'subject-1' };
			},
		},
		null,
		configurationChanged,
	);
	await model.save(token, {
		revision: null,
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
	const base = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
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
			applicationMigrations.map((migration) => migration.version),
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

test('public OIDC metadata uses one read without a transaction and observes policy changes immediately', async () => {
	const f = await fixture();
	try {
		assert.equal(await f.model.provider(), null);
		const beforeBinding = await f.model.settings(f.token);
		await f.finish(await f.start('binding'), 'binding');
		const bound = await f.model.settings(f.token);
		assert.notEqual(bound.revision, beforeBinding.revision);
		const before = f.db.statistics.read();
		assert.equal(await f.model.provider(), 'Pocket ID');
		const after = f.db.statistics.read();
		assert.equal(after.execution.count - before.execution.count, 1);
		assert.equal(after.commit.count - before.commit.count, 0);
		await f.db.run('UPDATE access_accounts SET passkey_required=1');
		assert.equal(await f.model.provider(), null);
		await f.db.run('UPDATE access_accounts SET passkey_required=0');
		assert.equal(await f.model.provider(), 'Pocket ID');
		await f.model.unbind(f.token, bound.revision);
		assert.equal(await f.model.provider(), null);
	} finally {
		await f.db.close();
	}
});

test('v66 removes the visibility switch and preserves a previously hidden binding across upgrade and restart', async () => {
	const base = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(base, { recursive: true });
	const root = await mkdtemp(join(base, 'oidc-visibility-migration-'));
	const path = join(root, 'upgrade.sqlite');
	let db = SqliteRuntime.open(path);
	try {
		await initializeSchema(
			db,
			applicationMigrations.filter((migration) => migration.version < 66),
		);
		await seed(db);
		await db.run(
			'INSERT INTO access_oidc_configuration(id,revision,user_id,enabled,label,issuer,client_id,client_authentication,secret_cipher,subject) VALUES(1,?,1,0,?,?,?,?,?,?)',
			[tokens.issue(), 'Pocket ID', 'https://id.example', 'nexus', 'none', null, 'subject-1'],
		);
		const before = await db.one(
			'SELECT id,revision,user_id,label,issuer,client_id,client_authentication,secret_cipher,subject FROM access_oidc_configuration',
		);
		const sessions = await db.all('SELECT * FROM access_sessions');
		const markers = await db.all('SELECT * FROM schema_version ORDER BY version');
		await initializeSchema(db, applicationMigrations);
		assert.deepEqual(await db.one('SELECT * FROM access_oidc_configuration'), before);
		assert.deepEqual(await db.all('SELECT * FROM access_sessions'), sessions);
		assert.equal((await new SqliteOidcStorage(db).readProvider()).label, 'Pocket ID');
		const committed = await db.all('SELECT * FROM schema_version ORDER BY version');
		assert.deepEqual(committed.slice(0, markers.length), markers);
		assert.equal(committed.at(-1).signature, 'access-oidc-binding-visibility-20261109');
		await db.close();
		db = SqliteRuntime.open(path);
		await initializeSchema(db, applicationMigrations);
		assert.deepEqual(await db.all('SELECT * FROM schema_version ORDER BY version'), committed);
		assert.deepEqual(await db.one('SELECT * FROM access_oidc_configuration'), before);
		assert.equal((await db.one('PRAGMA integrity_check')).integrity_check, 'ok');
		assert.deepEqual(await db.all('PRAGMA foreign_key_check'), []);
	} finally {
		await db.close();
	}
});

test('unknown binding and configuration commits invalidate public login metadata without replaying writes', async () => {
	let methods;
	const f = await fixture(() => methods?.invalidate());
	methods = new LoginOptionsModel(f.model, { hasPasskeys: async () => false });
	try {
		assert.equal((await methods.read()).oidcLabel, null);
		const complete = f.storage.complete.bind(f.storage);
		f.storage.complete = async (...args) => {
			await complete(...args);
			throw new SqliteFailure('commit_unknown', null);
		};
		await assert.rejects(
			f.finish(await f.start('binding'), 'binding'),
			(error) => error.code === 'operation_unknown',
		);
		assert.equal((await methods.read()).oidcLabel, 'Pocket ID');
		const c = await f.model.settings(f.token);
		const configure = f.storage.configure.bind(f.storage);
		f.storage.configure = async (...args) => {
			await configure(...args);
			throw new SqliteFailure('commit_unknown', null);
		};
		await assert.rejects(
			f.model.save(f.token, {
				revision: c.revision,
				label: 'Updated SSO',
				issuer: c.issuer,
				clientId: c.clientId,
				clientAuthentication: c.clientAuthentication,
				secret: { action: 'clear' },
			}),
			(error) => error.code === 'operation_unknown',
		);
		assert.equal((await methods.read()).oidcLabel, 'Updated SSO');
	} finally {
		await methods.close();
		await f.db.close();
	}
});
