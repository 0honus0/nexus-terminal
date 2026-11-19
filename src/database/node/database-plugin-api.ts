import type { Kysely } from 'kysely';

export interface PluginDatabaseApi {
	/** 使用逻辑表名。在回调内完成查询、事务或流式读取，客户端随插件实例释放。 */
	withClient<Result>(operation: (client: Kysely<unknown>) => Result | Promise<Result>): Promise<Result>;
}

interface PluginDatabaseConnection extends PluginDatabaseApi {
	initialize(signal: AbortSignal): Promise<void>;
}

/** 使用宿主分配的连接，等待查询结束后复查插件作用域。 */
export class PluginDatabase implements PluginDatabaseApi {
	readonly #connection: PluginDatabaseConnection;
	readonly #signal: AbortSignal;

	constructor(connection: PluginDatabaseConnection, signal: AbortSignal) {
		this.#connection = connection;
		this.#signal = signal;
	}

	async withClient<Result>(operation: (client: Kysely<unknown>) => Result | Promise<Result>): Promise<Result> {
		this.#signal.throwIfAborted();
		await this.#connection.initialize(this.#signal);
		const result = await this.#connection.withClient((client) => {
			this.#signal.throwIfAborted();
			return operation(client);
		});
		this.#signal.throwIfAborted();
		return result;
	}
}
