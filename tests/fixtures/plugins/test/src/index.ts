import type { MigrationProvider } from 'kysely/migration';
import { z } from 'zod';
import {
	HttpFailure,
	PluginCryptoFailureSchema,
	PluginLogInputSchema,
	type PluginContextApi,
} from 'nexus-terminal/node';
import {
	ListItemsInputSchema,
	ListItemsOutputSchema,
	type ListItemsInput,
	type ListItemsOutput,
} from './items-http-types.js';
import { PreferencesSnapshotSchema, type PreferencesSnapshot } from './preferences-types.js';

declare module 'nexus-terminal/node' {
	interface PluginServicesApi {
		'@nexus-terminal/test': { sample: { name(): string } };
	}
}

const itemsTable = 'items';

type Tables = { [itemsTable]: { id: string; label: string } };

export const migrations: MigrationProvider = {
	async getMigrations() {
		return {
			'001_items': {
				async up(db) {
					await db.schema
						.createTable(itemsTable)
						.addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('label', 'text', (column) => column.notNull())
						.execute();
				},
			},
		};
	},
};

export async function activate({ app, provide, self }: PluginContextApi): Promise<void> {
	const itemsState = app.state.register({
		name: 'items',
		schema: z.object({ count: z.number().int().nonnegative() }),
		initial: { count: 0 },
	});
	const items = await app.database.withClient(async (client) => {
		const db = client.$extendTables<Tables>();
		return db.transaction().execute(async (trx) => {
			await trx
				.insertInto(itemsTable)
				.values({ id: 'sample', label: 'sample' })
				.onConflict((conflict) => conflict.column('id').doNothing())
				.execute();
			return trx.selectFrom(itemsTable).selectAll().execute();
		});
	});
	itemsState.publish({ count: items.length });
	app.log.report(
		PluginLogInputSchema.parse({
			level: 'info',
			code: 'TEST_PLUGIN_DATABASE_READY',
			params: { rows: items.length },
		}),
	);
	provide('sample', { name: () => 'sample' });

	let preferences = PreferencesSnapshotSchema.parse({ revision: 0, preferences: { theme: 'system', locale: 'en' } });
	const preferencesState = app.state.register({
		name: 'preferences',
		schema: PreferencesSnapshotSchema,
		initial: preferences,
	});

	/** 测试输入代表已提交的快照，用来验证插件发布及过滤过期版本。 */
	function publishPreferences(snapshot: PreferencesSnapshot): PreferencesSnapshot {
		if (snapshot.revision > preferences.revision) {
			preferencesState.publish(snapshot);
			preferences = snapshot;
		}
		return preferences;
	}

	async function listItems({ limit }: ListItemsInput, signal: AbortSignal): Promise<ListItemsOutput> {
		const items = await app.database.withClient((client) =>
			client
				.$extendTables<Tables>()
				.selectFrom(itemsTable)
				.select(['id', 'label'])
				.orderBy('id')
				.limit(limit)
				.execute(),
		);
		signal.throwIfAborted();
		return { items };
	}

	async function checkCrypto({ value }: { value: string }): Promise<{ value: string }> {
		const options = { mode: 'local', context: 'test-item' } as const;
		const encrypted = await app.crypto.encrypt(new TextEncoder().encode(value), options);
		if (encrypted.isErr()) throw new HttpFailure(500, PluginCryptoFailureSchema.parse(encrypted.error).code);
		const decrypted = await app.crypto.decrypt(encrypted.value, options);
		if (decrypted.isErr()) throw new HttpFailure(500, PluginCryptoFailureSchema.parse(decrypted.error).code);
		return { value: new TextDecoder().decode(decrypted.value) };
	}

	const cryptoPayload = z.strictObject({ value: z.string().max(128) });
	const empty = z.strictObject({});
	app.http.register([
		{
			method: 'get',
			path: '/items',
			input: ListItemsInputSchema,
			output: ListItemsOutputSchema,
			handler: listItems,
		},
		{
			method: 'post',
			path: '/preferences',
			input: PreferencesSnapshotSchema,
			output: PreferencesSnapshotSchema,
			handler: publishPreferences,
		},
		{
			method: 'post',
			path: '/crypto',
			input: cryptoPayload,
			output: cryptoPayload,
			handler: checkCrypto,
		},
		{
			method: 'get',
			path: '/conflict',
			input: empty,
			output: empty,

			handler() {
				throw new HttpFailure(409, 'TEST_PLUGIN_CONFLICT');
			},
		},
	]);

	app.ws.register({
		path: '/echo',
		maxPayload: 1024,

		handler(socket) {
			socket.on('message', (data, binary) => socket.send(data, { binary }));
		},
	});
	self.readiness.set({ state: 'ready' });
}
