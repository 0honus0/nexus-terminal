import type {
	ConnectionMetadata,
	ConnectionMutation,
	ConnectionSnapshot,
} from './connections/model/connection-types.js';
import type { ConnectionImport } from './import/model/import-types.js';

export type {
	ConnectionMetadata,
	ConnectionMutation,
	ConnectionSnapshot,
} from './connections/model/connection-types.js';
export type { ConnectionImport } from './import/model/import-types.js';

export interface ConnectionCatalog {
	list(): Promise<ConnectionSnapshot[]>;
	get(id: number): Promise<ConnectionSnapshot | null>;
}

export interface ConnectionMutations {
	create(data: ConnectionMetadata): Promise<ConnectionSnapshot>;
	update(id: number, version: number, changes: Partial<ConnectionMetadata>): Promise<ConnectionMutation>;
	clone(id: number, name: string): Promise<ConnectionSnapshot | null>;
	delete(id: number): Promise<boolean>;
	setTags(id: number, version: number, tags: number[]): Promise<ConnectionMutation>;
	importOne(command: ConnectionImport): Promise<ConnectionSnapshot>;
	importMany(
		commands: ConnectionImport[],
	): Promise<Array<{ status: 'ok'; id: number } | { status: 'error'; error: string }>>;
}
