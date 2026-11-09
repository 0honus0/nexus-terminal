import { createHash } from 'node:crypto';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { readAccountRow } from '../../../accounts/adapters/sqlite/account-sql.js';
import { SqliteSessionStorage } from '../../../sessions/adapters/sqlite/session-sql.js';
import type {
	OidcStorage,
	OidcConfigurationRecord,
	OidcFlowRecord,
	OidcStorageFacts,
	OidcProviderRecord,
	OidcCompletionWrite,
	OidcCompletionDecision,
} from '../../storage/oidc-storage.js';

function string(value: unknown): string {
	if (typeof value !== 'string' || !value) {
		throw new Error('Corrupt OIDC text');
	}
	return value;
}

function nullable(value: unknown): string | null {
	return value === null ? null : string(value);
}

function number(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error('Corrupt OIDC integer');
	}
	return value;
}

function boolean(value: unknown): boolean {
	if (value !== 0 && value !== 1) {
		throw new Error('Corrupt OIDC boolean');
	}
	return value === 1;
}

function readConfiguration(row: Record<string, unknown>): OidcConfigurationRecord {
	const auth = row.client_authentication;
	if (auth !== 'none' && auth !== 'client_secret_basic' && auth !== 'client_secret_post') {
		throw new Error('Corrupt OIDC authentication');
	}
	return {
		revision: string(row.revision),
		userId: number(row.user_id),
		label: string(row.label),
		issuer: string(row.issuer),
		clientId: string(row.client_id),
		clientAuthentication: auth,
		secretCipher: nullable(row.secret_cipher),
		subject: nullable(row.subject),
	};
}

function readFlow(row: Record<string, unknown>): OidcFlowRecord {
	if (row.purpose !== 'login' && row.purpose !== 'binding') {
		throw new Error('Corrupt OIDC purpose');
	}
	return {
		cookieDigest: string(row.cookie_digest),
		revision: string(row.revision),
		purpose: row.purpose,
		sessionDigest: nullable(row.session_digest),
		passwordRevision: string(row.password_revision),
		redirectUri: string(row.redirect_uri),
		state: string(row.state),
		nonce: string(row.nonce),
		verifierCipher: string(row.verifier_cipher),
		rememberMe: boolean(row.remember_me),
		expiresAt: number(row.expires_at),
	};
}

export class SqliteOidcStorage implements OidcStorage {
	private readonly sessions: SqliteSessionStorage;

	constructor(private readonly db: SqliteRuntime) {
		this.sessions = new SqliteSessionStorage(db);
	}

	private async facts(tx: SqlExecutor, sessionDigest: string | null, source: string): Promise<OidcStorageFacts> {
		const row = await tx.one('SELECT * FROM access_oidc_configuration WHERE id=1');
		const configuration = row === null ? null : readConfiguration(row);
		const session =
			sessionDigest === null ? null : await this.sessions.validateInTransaction(tx, sessionDigest, Date.now);
		const userId = configuration?.userId ?? session?.userId;
		const accountRow =
			userId === undefined
				? await tx.one('SELECT * FROM access_accounts ORDER BY id LIMIT 1')
				: await tx.one('SELECT * FROM access_accounts WHERE id=?', [userId]);
		const account = accountRow === null ? null : readAccountRow(accountRow);
		const blocked = await tx.one('SELECT blocked_until FROM access_login_attempts WHERE source=?', [source]);
		return {
			configuration,
			sessionUserId: session?.userId ?? null,
			account:
				account === null
					? null
					: {
							id: account.id,
							passwordRevision: createHash('sha256').update(account.passwordHash).digest('hex'),
							passkeyRequired: account.passkeyRequired,
						},
			blockedUntil: blocked === null ? 0 : number(blocked.blocked_until),
		};
	}

	async readProvider(): Promise<OidcProviderRecord | null> {
		const row = await this.db.one(
			'SELECT c.label FROM access_oidc_configuration c JOIN access_accounts a ON a.id=c.user_id WHERE c.id=1 AND c.subject IS NOT NULL AND a.passkey_required=0',
		);
		return row === null ? null : { label: string(row.label) };
	}

	read(sessionDigest: string | null, source: string): Promise<OidcStorageFacts> {
		return this.db.transaction((tx) => this.facts(tx, sessionDigest, source));
	}

	configure(
		sessionDigest: string | null,
		decide: (facts: OidcStorageFacts) => OidcConfigurationRecord | null,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			const next = decide(await this.facts(tx, sessionDigest, ''));
			if (next === null) {
				return;
			}
			await tx.run(
				'DELETE FROM access_sessions WHERE token_digest IN (SELECT token_digest FROM access_oidc_sessions)',
			);
			await tx.run('DELETE FROM access_oidc_flows');
			await tx.run(
				`INSERT INTO access_oidc_configuration(id,revision,user_id,label,issuer,client_id,client_authentication,secret_cipher,subject) VALUES(1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,user_id=excluded.user_id,label=excluded.label,issuer=excluded.issuer,client_id=excluded.client_id,client_authentication=excluded.client_authentication,secret_cipher=excluded.secret_cipher,subject=excluded.subject`,
				[
					next.revision,
					next.userId,
					next.label,
					next.issuer,
					next.clientId,
					next.clientAuthentication,
					next.secretCipher,
					next.subject,
				],
			);
		});
	}

	begin(
		flow: OidcFlowRecord,
		previousCookieDigest: string | null,
		source: string,
		admit: (facts: OidcStorageFacts) => void,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, flow.sessionDigest, source));
			await tx.run('DELETE FROM access_oidc_flows WHERE expires_at<=? OR cookie_digest=?', [
				Date.now(),
				previousCookieDigest,
			]);
			await tx.run(
				'INSERT INTO access_oidc_flows(cookie_digest,revision,purpose,session_digest,password_revision,redirect_uri,state,nonce,verifier_cipher,remember_me,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
				[
					flow.cookieDigest,
					flow.revision,
					flow.purpose,
					flow.sessionDigest,
					flow.passwordRevision,
					flow.redirectUri,
					flow.state,
					flow.nonce,
					flow.verifierCipher,
					flow.rememberMe ? 1 : 0,
					flow.expiresAt,
				],
			);
		});
	}

	consume(cookieDigest: string, state: string, redirectUri: string): Promise<OidcFlowRecord | null> {
		return this.db.transaction(async (tx) => {
			await tx.run('DELETE FROM access_oidc_flows WHERE expires_at<=?', [Date.now()]);
			const row = await tx.one(
				'UPDATE access_oidc_flows SET consumed=1 WHERE cookie_digest=? AND state=? AND redirect_uri=? AND consumed=0 RETURNING *',
				[cookieDigest, state, redirectUri],
			);
			return row === null ? null : readFlow(row);
		});
	}

	complete(
		command: OidcCompletionWrite,
		decide: (facts: OidcStorageFacts, claimedExpiresAt: number | null) => OidcCompletionDecision,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, command.sessionDigest, command.source);
			const claimed = await tx.one(
				'SELECT expires_at FROM access_oidc_flows WHERE cookie_digest=? AND consumed=1',
				[command.cookieDigest],
			);
			const result = decide(facts, claimed === null ? null : number(claimed.expires_at));
			await tx.run('DELETE FROM access_oidc_flows WHERE cookie_digest=?', [command.cookieDigest]);
			if (facts.account === null) {
				throw new Error('OIDC admission failed to require account');
			}
			if (result.purpose === 'binding') {
				await tx.run('UPDATE access_oidc_configuration SET subject=?,revision=? WHERE id=1', [
					result.subject,
					result.revision,
				]);
				await tx.run('DELETE FROM access_oidc_flows');
				return;
			}
			await tx.run(
				'INSERT INTO access_sessions(token_digest,user_id,password_revision,remember_me,expires_at,created_at) VALUES(?,?,?,?,?,?)',
				[
					command.tokenDigest,
					facts.account.id,
					facts.account.passwordRevision,
					command.rememberMe ? 1 : 0,
					command.expiresAt,
					Date.now(),
				],
			);
			await tx.run('INSERT INTO access_oidc_sessions(token_digest) VALUES(?)', [command.tokenDigest]);
		});
	}

	async revokeIssued(tokenDigest: string): Promise<void> {
		await this.db.run('DELETE FROM access_sessions WHERE token_digest=?', [tokenDigest]);
	}

	async discard(cookieDigest: string): Promise<void> {
		await this.db.run('DELETE FROM access_oidc_flows WHERE cookie_digest=?', [cookieDigest]);
	}
}
