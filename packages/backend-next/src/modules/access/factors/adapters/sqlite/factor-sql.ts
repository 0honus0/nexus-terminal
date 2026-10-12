import { createHash } from 'node:crypto';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	FactorStorage,
	FactorChallengeRecord,
	PendingLoginRecord,
	PasskeyStorageRecord,
	PasskeyRegistrationWrite,
	PendingLoginWrite,
	ChallengeCapacity,
	CompleteFactorLogin,
	CompletePasskeyLogin,
} from '../../storage/factor-storage.js';

function revision(passwordHash: string): string {
	return createHash('sha256').update(passwordHash).digest('hex');
}

function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error('Corrupt factor state');
	}
	return value;
}

function storedBoolean(value: unknown): boolean {
	if (value !== 0 && value !== 1) {
		throw new Error('Corrupt factor flag');
	}
	return value === 1;
}

function storedText(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt factor state');
	}
	return value;
}

function readChallenge(row: Record<string, unknown>): FactorChallengeRecord {
	const kind = row.kind;
	if (kind !== 'totp_setup' && kind !== 'passkey_registration' && kind !== 'passkey_authentication') {
		throw new Error('Corrupt factor challenge');
	}
	return {
		kind,
		accountId: row.user_id === null ? null : integer(row.user_id),
		sessionDigest: row.session_digest === null ? null : storedText(row.session_digest),
		sourceIp: row.source_ip === null ? null : storedText(row.source_ip),
		passwordRevision: row.credential_revision === null ? null : storedText(row.credential_revision),
		challenge: storedText(row.challenge),
		origin: row.origin === null ? null : storedText(row.origin),
		rpId: row.rp_id === null ? null : storedText(row.rp_id),
		expiresAt: integer(row.expires_at),
	};
}

function readCredential(row: Record<string, unknown>): PasskeyStorageRecord {
	const transports: unknown = JSON.parse(storedText(row.transports));
	if (!Array.isArray(transports) || !transports.every((transport) => typeof transport === 'string')) {
		throw new Error('Corrupt passkey transports');
	}
	return {
		credentialId: storedText(row.credential_id),
		accountId: integer(row.user_id),
		publicKeyBase64: storedText(row.public_key),
		generation: storedText(row.generation),
		counter: integer(row.counter),
		transports: transports.map((transport: string) => transport),
		name: row.name === null ? null : storedText(row.name),
		backedUp: storedBoolean(row.backed_up),
		createdAt: integer(row.created_at),
		updatedAt: integer(row.updated_at),
		lastUsedAt: row.last_used_at === null ? null : integer(row.last_used_at),
	};
}

async function currentRevision(tx: SqlExecutor, accountId: number): Promise<string> {
	const account = await tx.one('SELECT password_hash FROM access_accounts WHERE id=?', [accountId]);
	return account ? revision(storedText(account.password_hash)) : '';
}

async function activeSession(tx: SqlExecutor, digest: string, accountId: number, now: number): Promise<boolean> {
	const active = await tx.one(
		`SELECT 1 AS ok FROM access_sessions s JOIN access_accounts a ON a.id=s.user_id
		WHERE s.token_digest=? AND s.user_id=? AND s.expires_at>? AND s.password_revision=?`,
		[digest, accountId, now, await currentRevision(tx, accountId)],
	);
	return active !== null;
}

async function currentPasswordEpoch(tx: SqlExecutor): Promise<string> {
	const row = await tx.one('SELECT revision FROM access_password_epoch WHERE id=1');
	if (!row) {
		throw new Error('Missing password epoch');
	}
	return String(integer(row.revision));
}

async function blocked(tx: SqlExecutor, source: string, enforce: boolean, now: number): Promise<boolean> {
	if (!enforce) {
		return false;
	}
	const record = await tx.one('SELECT blocked_until FROM access_login_attempts WHERE source=?', [source]);
	return record !== null && integer(record.blocked_until) > now;
}

export class SqliteFactorStorage implements FactorStorage {
	constructor(private readonly db: SqliteRuntime) {}

	revokeFlows(
		partialDigest: string | null,
		challengeDigest: string | null,
		setupDigest: string | null,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			if (partialDigest !== null) {
				await tx.run('DELETE FROM access_pending_logins WHERE token_digest=?', [partialDigest]);
			}
			if (challengeDigest !== null) {
				await tx.run('DELETE FROM access_factor_challenges WHERE token_digest=?', [challengeDigest]);
			}
			if (setupDigest !== null) {
				await tx.run('DELETE FROM access_factor_challenges WHERE token_digest=?', [setupDigest]);
			}
		});
	}

	storePending(
		command: PendingLoginWrite,
	): Promise<'stored' | 'credentials_changed' | 'rate_limited' | 'limit_exceeded' | 'cancelled'> {
		return this.db.transaction(async (tx) => {
			await tx.run('DELETE FROM access_pending_logins WHERE expires_at<=?', [Date.now()]);
			const count = await tx.one('SELECT COUNT(*) AS n FROM access_pending_logins');
			const replacing =
				command.previousDigest === null
					? null
					: await tx.one('SELECT 1 AS ok FROM access_pending_logins WHERE token_digest=?', [
							command.previousDigest,
						]);
			if (!count || (integer(count.n) >= command.maxPending && replacing === null)) {
				return 'limit_exceeded';
			}
			const account = await tx.one(
				'SELECT password_hash,two_factor_enabled,passkey_required FROM access_accounts WHERE id=?',
				[command.accountId],
			);
			if (
				!account ||
				account.password_hash !== command.passwordHash ||
				account.two_factor_enabled !== 1 ||
				account.passkey_required !== 0
			) {
				return 'credentials_changed';
			}
			if (await blocked(tx, command.source, command.enforceBan, Date.now())) {
				return 'rate_limited';
			}
			if (command.signal?.aborted || command.expiresAt <= Date.now()) {
				return 'cancelled';
			}
			if (command.previousDigest !== null) {
				await tx.run('DELETE FROM access_pending_logins WHERE token_digest=?', [command.previousDigest]);
			}
			await tx.run(
				`INSERT INTO access_pending_logins(token_digest,user_id,password_revision,remember_me,expires_at,created_at)
				VALUES(?,?,?,?,?,?)`,
				[
					command.tokenDigest,
					command.accountId,
					revision(command.passwordHash),
					command.rememberMe ? 1 : 0,
					command.expiresAt,
					Date.now(),
				],
			);
			return 'stored';
		});
	}

	async findPending(tokenDigest: string): Promise<PendingLoginRecord | null> {
		const record = await this.db.one(
			`SELECT p.user_id,p.password_revision,p.remember_me,p.expires_at,a.password_hash,a.two_factor_enabled
			FROM access_pending_logins p JOIN access_accounts a ON a.id=p.user_id WHERE p.token_digest=?`,
			[tokenDigest],
		);
		if (
			!record ||
			record.two_factor_enabled !== 1 ||
			record.password_revision !== revision(storedText(record.password_hash)) ||
			integer(record.expires_at) <= Date.now()
		) {
			return null;
		}
		return {
			accountId: integer(record.user_id),
			rememberMe: storedBoolean(record.remember_me),
			expiresAt: integer(record.expires_at),
		};
	}

	completeTotp(command: CompleteFactorLogin): Promise<'issued' | 'stale' | 'rate_limited'> {
		return this.db.transaction(async (tx) => {
			const record = await tx.one(
				`SELECT p.user_id,p.password_revision,p.remember_me,p.expires_at,a.password_hash,
				a.two_factor_enabled,a.totp_secret_encrypted,a.passkey_required
				FROM access_pending_logins p JOIN access_accounts a ON a.id=p.user_id WHERE p.token_digest=?`,
				[command.pendingDigest],
			);
			if (
				!record ||
				command.expiresAt <= Date.now() ||
				integer(record.expires_at) <= Date.now() ||
				record.password_revision !== revision(storedText(record.password_hash)) ||
				record.two_factor_enabled !== 1 ||
				record.passkey_required !== 0 ||
				record.totp_secret_encrypted !== command.expectedEncryptedSecret
			) {
				return 'stale';
			}
			if (await blocked(tx, command.source, command.enforceBan, Date.now())) {
				return 'rate_limited';
			}
			if (integer(record.expires_at) <= Date.now() || command.expiresAt <= Date.now()) {
				return 'stale';
			}
			await tx.run('DELETE FROM access_pending_logins WHERE token_digest=?', [command.pendingDigest]);
			await tx.run(
				`INSERT INTO access_sessions(token_digest,user_id,password_revision,remember_me,expires_at,created_at)
				VALUES(?,?,?,?,?,?)`,
				[
					command.tokenDigest,
					integer(record.user_id),
					storedText(record.password_revision),
					storedBoolean(record.remember_me) ? 1 : 0,
					command.expiresAt,
					Date.now(),
				],
			);
			if (command.enforceBan) {
				await tx.run('DELETE FROM access_login_attempts WHERE source=?', [command.source]);
			}
			return 'issued';
		});
	}

	storeChallenge(
		tokenDigest: string,
		oldDigest: string | null,
		challenge: FactorChallengeRecord,
		limits: ChallengeCapacity,
	): Promise<'stored' | 'unauthenticated' | 'limit_exceeded' | 'challenge_expired'> {
		return this.db.transaction(async (tx) => {
			const now = Date.now();
			await tx.run('DELETE FROM access_factor_challenges WHERE expires_at<=?', [now]);
			if (challenge.expiresAt <= Date.now()) {
				return 'challenge_expired';
			}
			if (
				challenge.sessionDigest !== null &&
				(challenge.accountId === null ||
					!(await activeSession(tx, challenge.sessionDigest, challenge.accountId, Date.now())))
			) {
				return 'unauthenticated';
			}
			const count = await tx.one('SELECT COUNT(*) AS n FROM access_factor_challenges');
			if (!count) {
				throw new Error('Missing factor challenge count');
			}
			if (challenge.kind === 'passkey_authentication' && challenge.sessionDigest === null) {
				// Anonymous challenges cannot consume the slots reserved for authenticated setup/registration.
				if (challenge.sourceIp === null) {
					return 'limit_exceeded';
				}
				const perSource = await tx.one(
					'SELECT COUNT(*) AS n FROM access_factor_challenges WHERE kind=? AND source_ip=?',
					[challenge.kind, challenge.sourceIp],
				);
				const anonymous = await tx.one(
					'SELECT COUNT(*) AS n FROM access_factor_challenges WHERE kind=? AND session_digest IS NULL',
					[challenge.kind],
				);
				const previous =
					oldDigest === null
						? null
						: await tx.one('SELECT source_ip,kind FROM access_factor_challenges WHERE token_digest=?', [
								oldDigest,
							]);
				const replaces =
					previous !== null && previous.source_ip === challenge.sourceIp && previous.kind === challenge.kind;
				if (
					!perSource ||
					!anonymous ||
					(integer(perSource.n) >= limits.maxPerSource && !replaces) ||
					(integer(anonymous.n) >= limits.maxAnonymous && !replaces)
				) {
					return 'limit_exceeded';
				}
			}

			if (integer(count.n) >= limits.maxChallenges) {
				const replacedByCookie =
					oldDigest === null
						? null
						: await tx.one(
								'SELECT 1 AS ok FROM access_factor_challenges WHERE token_digest=? AND kind=? AND source_ip IS ?',
								[oldDigest, challenge.kind, challenge.sourceIp],
							);
				const replacedBySession =
					challenge.sessionDigest === null
						? null
						: await tx.one(
								'SELECT 1 AS ok FROM access_factor_challenges WHERE session_digest=? AND kind=?',
								[challenge.sessionDigest, challenge.kind],
							);
				if (!replacedByCookie && !replacedBySession) {
					return 'limit_exceeded';
				}
			}

			if (oldDigest !== null) {
				await tx.run(
					'DELETE FROM access_factor_challenges WHERE token_digest=? AND kind=? AND source_ip IS ?',
					[oldDigest, challenge.kind, challenge.sourceIp],
				);
			}
			if (challenge.sessionDigest !== null) {
				await tx.run('DELETE FROM access_factor_challenges WHERE session_digest=? AND kind=?', [
					challenge.sessionDigest,
					challenge.kind,
				]);
			}
			const epoch =
				challenge.kind === 'passkey_authentication'
					? await currentPasswordEpoch(tx)
					: challenge.passwordRevision;
			await tx.run(
				`INSERT INTO access_factor_challenges(
					token_digest,kind,user_id,session_digest,source_ip,credential_revision,challenge,origin,rp_id,expires_at
				) VALUES(?,?,?,?,?,?,?,?,?,?)`,
				[
					tokenDigest,
					challenge.kind,
					challenge.accountId,
					challenge.sessionDigest,
					challenge.sourceIp,
					// Unknown username uses a sentinel to avoid authenticating another account.
					challenge.passwordRevision === 'no-account' ? 'no-account' : epoch,
					challenge.challenge,
					challenge.origin,
					challenge.rpId,
					challenge.expiresAt,
				],
			);
			return 'stored';
		});
	}

	async findChallenge(
		tokenDigest: string,
		kind: FactorChallengeRecord['kind'],
		now: number,
	): Promise<FactorChallengeRecord | null> {
		const record = await this.db.one(
			'SELECT * FROM access_factor_challenges WHERE token_digest=? AND kind=? AND expires_at>?',
			[tokenDigest, kind, now],
		);
		return record ? readChallenge(record) : null;
	}

	async consumeChallenge(tokenDigest: string, kind: FactorChallengeRecord['kind'], now: number): Promise<boolean> {
		const result = await this.db.run(
			'DELETE FROM access_factor_challenges WHERE token_digest=? AND kind=? AND expires_at>?',
			[tokenDigest, kind, now],
		);
		return result.changes === 1;
	}

	enableTotp(command: {
		sessionDigest: string;
		accountId: number;
		challengeDigest: string;
		encrypted: string;
	}): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const record = await tx.one(
				`SELECT challenge,expires_at FROM access_factor_challenges WHERE token_digest=? AND kind='totp_setup'
				AND user_id=? AND session_digest=? AND expires_at>?`,
				[command.challengeDigest, command.accountId, command.sessionDigest, Date.now()],
			);
			if (
				!record ||
				record.challenge !== command.encrypted ||
				!(await activeSession(tx, command.sessionDigest, command.accountId, Date.now()))
			) {
				return false;
			}
			if (integer(record.expires_at) <= Date.now()) {
				return false;
			}
			const updated = await tx.run(
				`UPDATE access_accounts SET totp_secret_encrypted=?,two_factor_enabled=1,updated_at=?
				WHERE id=? AND two_factor_enabled=0 AND totp_secret_encrypted IS NULL`,
				[command.encrypted, Date.now(), command.accountId],
			);
			if (updated.changes !== 1) {
				return false;
			}
			await tx.run('DELETE FROM access_factor_challenges WHERE token_digest=?', [command.challengeDigest]);
			return true;
		});
	}

	disableTotp(command: {
		sessionDigest: string;
		accountId: number;
		expectedHash: string;
		expectedSecret: string;
	}): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await activeSession(tx, command.sessionDigest, command.accountId, Date.now()))) {
				return false;
			}
			const updated = await tx.run(
				`UPDATE access_accounts SET two_factor_enabled=0,totp_secret_encrypted=NULL,updated_at=?
				WHERE id=? AND password_hash=? AND totp_secret_encrypted=? AND two_factor_enabled=1`,
				[Date.now(), command.accountId, command.expectedHash, command.expectedSecret],
			);
			if (updated.changes !== 1) {
				return false;
			}
			await tx.run('DELETE FROM access_pending_logins WHERE user_id=?', [command.accountId]);
			await tx.run('DELETE FROM access_factor_challenges WHERE user_id=?', [command.accountId]);
			return true;
		});
	}

	async getEncryptedTotp(accountId: number): Promise<string | null> {
		const record = await this.db.one(
			'SELECT totp_secret_encrypted FROM access_accounts WHERE id=? AND two_factor_enabled=1',
			[accountId],
		);
		return record
			? record.totp_secret_encrypted === null
				? null
				: storedText(record.totp_secret_encrypted)
			: null;
	}

	async listPasskeys(accountId: number): Promise<PasskeyStorageRecord[]> {
		const records = await this.db.all(
			'SELECT * FROM access_passkeys WHERE user_id=? ORDER BY created_at DESC,credential_id',
			[accountId],
		);
		return records.map(readCredential);
	}

	async getPasskey(credentialId: string): Promise<PasskeyStorageRecord | null> {
		const record = await this.db.one('SELECT * FROM access_passkeys WHERE credential_id=?', [credentialId]);
		return record ? readCredential(record) : null;
	}

	async hasPasskeys(accountId: number | null): Promise<boolean> {
		const query =
			accountId === null
				? 'SELECT 1 AS ok FROM access_passkeys LIMIT 1'
				: 'SELECT 1 AS ok FROM access_passkeys WHERE user_id=? LIMIT 1';
		return (await this.db.one(query, accountId === null ? [] : [accountId])) !== null;
	}

	completeRegistration(command: {
		challengeDigest: string;
		sessionDigest: string;
		accountId: number;
		credential: PasskeyRegistrationWrite;
	}): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const challenge = await tx.one(
				`SELECT expires_at FROM access_factor_challenges WHERE token_digest=?
				AND kind='passkey_registration' AND user_id=? AND session_digest=? AND expires_at>?`,
				[command.challengeDigest, command.accountId, command.sessionDigest, Date.now()],
			);
			if (!challenge || !(await activeSession(tx, command.sessionDigest, command.accountId, Date.now()))) {
				return false;
			}
			const exists = await tx.one('SELECT 1 AS ok FROM access_passkeys WHERE credential_id=?', [
				command.credential.credentialId,
			]);
			if (exists) {
				return false;
			}
			if (integer(challenge.expires_at) <= Date.now()) {
				return false;
			}
			await tx.run('DELETE FROM access_factor_challenges WHERE token_digest=?', [command.challengeDigest]);
			await tx.run(
				`INSERT INTO access_passkeys(
					credential_id,user_id,public_key,generation,counter,transports,
					name,backed_up,created_at,updated_at,last_used_at
				) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`,
				[
					command.credential.credentialId,
					command.accountId,
					command.credential.publicKeyBase64,
					command.credential.generation,
					command.credential.counter,
					JSON.stringify(command.credential.transports),
					command.credential.name,
					command.credential.backedUp ? 1 : 0,
					Date.now(),
					Date.now(),
				],
			);
			return true;
		});
	}

	completePasskeyLogin(command: CompletePasskeyLogin): Promise<'issued' | 'stale' | 'rate_limited'> {
		return this.db.transaction(async (tx) => {
			const challenge = await tx.one(
				`SELECT user_id,credential_revision,expires_at FROM access_factor_challenges WHERE token_digest=?
				AND kind='passkey_authentication' AND expires_at>?`,
				[command.challengeDigest, Date.now()],
			);
			if (
				!challenge ||
				command.expiresAt <= Date.now() ||
				challenge.credential_revision === 'no-account' ||
				challenge.credential_revision !== (await currentPasswordEpoch(tx)) ||
				(challenge.user_id !== null && challenge.user_id !== command.accountId)
			) {
				return 'stale';
			}

			const account = await tx.one('SELECT password_hash FROM access_accounts WHERE id=?', [command.accountId]);
			const credential = await tx.one(
				'SELECT counter,user_id,generation FROM access_passkeys WHERE credential_id=?',
				[command.credentialId],
			);
			const counterChanged = credential !== null && credential.counter !== command.expectedCounter;
			const generationChanged = credential !== null && credential.generation !== command.expectedGeneration;
			const counterRegressed =
				(command.nextCounter !== 0 || command.expectedCounter !== 0) &&
				command.nextCounter <= command.expectedCounter;
			if (
				!account ||
				!credential ||
				credential.user_id !== command.accountId ||
				counterChanged ||
				generationChanged ||
				counterRegressed
			) {
				return 'stale';
			}
			if (await blocked(tx, command.source, command.enforceBan, Date.now())) {
				return 'rate_limited';
			}
			if (integer(challenge.expires_at) <= Date.now() || command.expiresAt <= Date.now()) {
				return 'stale';
			}
			const updated = await tx.run(
				`UPDATE access_passkeys SET counter=?,last_used_at=?,updated_at=?
				WHERE credential_id=? AND counter=? AND generation=?`,
				[
					command.nextCounter,
					Date.now(),
					Date.now(),
					command.credentialId,
					command.expectedCounter,
					command.expectedGeneration,
				],
			);
			if (updated.changes !== 1) {
				return 'stale';
			}
			await tx.run('DELETE FROM access_factor_challenges WHERE token_digest=?', [command.challengeDigest]);
			await tx.run(
				`INSERT INTO access_sessions(token_digest,user_id,password_revision,remember_me,expires_at,created_at)
				VALUES(?,?,?,?,?,?)`,
				[
					command.tokenDigest,
					command.accountId,
					revision(storedText(account.password_hash)),
					command.rememberMe ? 1 : 0,
					command.expiresAt,
					Date.now(),
				],
			);
			if (command.enforceBan) {
				await tx.run('DELETE FROM access_login_attempts WHERE source=?', [command.source]);
			}
			return 'issued';
		});
	}

	renamePasskey(command: {
		sessionDigest: string;
		accountId: number;
		credentialId: string;
		name: string;
	}): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await activeSession(tx, command.sessionDigest, command.accountId, Date.now()))) {
				return false;
			}
			const updated = await tx.run(
				'UPDATE access_passkeys SET name=?,updated_at=? WHERE credential_id=? AND user_id=?',
				[command.name, Date.now(), command.credentialId, command.accountId],
			);
			return updated.changes === 1;
		});
	}

	deletePasskey(command: { sessionDigest: string; accountId: number; credentialId: string }): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			if (!(await activeSession(tx, command.sessionDigest, command.accountId, Date.now()))) {
				return false;
			}
			const deleted = await tx.run('DELETE FROM access_passkeys WHERE credential_id=? AND user_id=?', [
				command.credentialId,
				command.accountId,
			]);
			return deleted.changes === 1;
		});
	}
}
