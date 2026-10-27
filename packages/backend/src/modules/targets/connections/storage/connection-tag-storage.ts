import type { SqlExecutor } from '../../../../platform/storage/sqlite/sql-types.js';

export class ConnectionTagStorageRefusal extends Error {
	constructor() {
		super('Connection reference not found');
		this.name = 'ConnectionTagStorageRefusal';
	}
}

export interface ConnectionTagWrite {
	tagId: number;
	connectionIds: number[];
}

export type ValidateConnectionTagCount = (count: number) => void;

/** Installed transaction participants; they never open a nested transaction. */
export interface ConnectionTagTransactionStorage {
	assign(
		tx: SqlExecutor,
		command: ConnectionTagWrite,
		replace: boolean,
		validateCount: ValidateConnectionTagCount,
	): Promise<void>;
	detach(tx: SqlExecutor, tagId: number): Promise<void>;
}
