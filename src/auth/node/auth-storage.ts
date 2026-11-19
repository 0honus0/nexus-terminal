import { randomBytes } from 'node:crypto';
import { Store, type SessionData } from 'express-session';
import { sql } from 'kysely';
import type { MigrationProvider } from 'kysely/migration';
import type { DatabaseApi } from '../../database/node/database-api.js';
import { CodedError } from '../../utils/error.js';

declare module 'express-session' {
	interface SessionData {
		identityVersion?: number;
	}
}

type AuthTables = {
	nexus_account: { id: 'owner'; username: string; passwordHash: string; version: number };
	nexus_http_session: { id: string; expires: number; value: string };
	nexus_auth_secret: { id: 'session'; value: string };
};

export const authSessionMaxAge = 7 * 86_400_000;

const authMigrations: MigrationProvider = {
	async getMigrations() {
		return {
			'001_auth': {
				async up(db) {
					await db.schema
						.createTable('nexus_account')
						.addColumn('id', 'text', (column) => column.primaryKey().check(sql`id = 'owner'`))
						.addColumn('username', 'text', (column) => column.notNull())
						.addColumn('passwordHash', 'text', (column) => column.notNull())
						.addColumn('version', 'integer', (column) => column.notNull())
						.execute();
					await db.schema
						.createTable('nexus_http_session')
						.addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('expires', 'integer', (column) => column.notNull())
						.addColumn('value', 'text', (column) => column.notNull())
						.execute();
					await db.schema
						.createIndex('nexus_http_session_expires')
						.on('nexus_http_session')
						.column('expires')
						.execute();
					await db.schema
						.createTable('nexus_auth_secret')
						.addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('value', 'text', (column) => column.notNull())
						.execute();
				},
			},
		};
	},
};

/** 管理认证账号与会话签名密钥的持久化。 */
export class AuthStorage {
	readonly #database: Pick<DatabaseApi, 'withClient' | 'migrateHost'>;

	constructor(database: Pick<DatabaseApi, 'withClient' | 'migrateHost'>) {
		this.#database = database;
	}

	initialize(signal: AbortSignal): Promise<void> {
		return this.#database.migrateHost('nexus_auth', authMigrations, signal);
	}

	getOrCreateSessionSecret(): Promise<string> {
		return this.#database.withClient(async (client) => {
			const db = client.$extendTables<AuthTables>();
			await db
				.insertInto('nexus_auth_secret')
				.values({ id: 'session', value: randomBytes(32).toString('base64') })
				.onConflict((conflict) => conflict.column('id').doNothing())
				.execute();
			const secret = await db
				.selectFrom('nexus_auth_secret')
				.select('value')
				.where('id', '=', 'session')
				.executeTakeFirstOrThrow();
			return secret.value;
		});
	}

	getOwner(): Promise<AuthTables['nexus_account'] | undefined> {
		return this.#database.withClient((client) =>
			client
				.$extendTables<AuthTables>()
				.selectFrom('nexus_account')
				.selectAll()
				.where('id', '=', 'owner')
				.executeTakeFirst(),
		);
	}

	createOwner(username: string, passwordHash: string) {
		return this.#database.withClient((client) =>
			client
				.$extendTables<AuthTables>()
				.insertInto('nexus_account')
				.values({ id: 'owner', username, passwordHash, version: 1 })
				.onConflict((conflict) => conflict.column('id').doNothing())
				.returning(['id', 'username', 'version'])
				.executeTakeFirst(),
		);
	}

	changeOwnerPassword(expectedVersion: number, passwordHash: string): Promise<number | undefined> {
		const version = expectedVersion + 1;
		return this.#database.withClient((client) =>
			client
				.$extendTables<AuthTables>()
				.transaction()
				.execute(async (tx) => {
					const updated = await tx
						.updateTable('nexus_account')
						.set({ passwordHash, version })
						.where('id', '=', 'owner')
						.where('version', '=', expectedVersion)
						.executeTakeFirst();
					if (updated.numUpdatedRows !== 1n) return undefined;
					await tx.deleteFrom('nexus_http_session').execute();
					return version;
				}),
		);
	}
}

/** express-session 的存储通过本体数据库访问，连接随 App 关闭。 */
export class AuthSessionStore extends Store {
	readonly #database: Pick<DatabaseApi, 'withClient'>;

	constructor(database: Pick<DatabaseApi, 'withClient'>) {
		super();
		this.#database = database;
	}

	override get(id: string, callback: (error: unknown, value?: SessionData | null) => void): void {
		void this.#database
			.withClient(async (client) => {
				const row = await client
					.$extendTables<AuthTables>()
					.selectFrom('nexus_http_session')
					.select('value')
					.where('id', '=', id)
					.where('expires', '>', Date.now())
					.executeTakeFirst();
				return row ? (JSON.parse(row.value) as SessionData) : null;
			})
			.then((value) => callback(null, value), callback);
	}

	override set(id: string, value: SessionData, callback?: (error?: unknown) => void): void {
		void this.#database
			.withClient((client) =>
				client
					.$extendTables<AuthTables>()
					.transaction()
					.execute(async (tx) => {
						const owner = await tx
							.selectFrom('nexus_account')
							.select('version')
							.where('id', '=', 'owner')
							.executeTakeFirst();
						// 改密后迟到的请求不能把已经撤销的版本重新写入。
						if (!owner || owner.version !== value.identityVersion)
							throw new CodedError('AUTH_SESSION_EXPIRED');
						const now = Date.now();
						const expires = value.cookie.expires
							? new Date(value.cookie.expires).getTime()
							: now + authSessionMaxAge;
						await tx.deleteFrom('nexus_http_session').where('expires', '<=', now).execute();
						const row = { id, expires, value: JSON.stringify(value) };
						await tx
							.insertInto('nexus_http_session')
							.values(row)
							.onConflict((conflict) => conflict.column('id').doUpdateSet(row))
							.execute();
					}),
			)
			.then(
				() => callback?.(),
				(cause: unknown) => callback?.(cause),
			);
	}

	override destroy(id: string, callback?: (error?: unknown) => void): void {
		void this.#database
			.withClient((client) =>
				client.$extendTables<AuthTables>().deleteFrom('nexus_http_session').where('id', '=', id).execute(),
			)
			.then(
				() => callback?.(),
				(cause: unknown) => callback?.(cause),
			);
	}
}
