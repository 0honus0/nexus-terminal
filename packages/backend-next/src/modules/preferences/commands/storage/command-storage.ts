import type { CommandSort } from '@nexus-terminal/shared/preferences/commands/values';

export interface StoredCommandInput {
	name: string | null;
	command: string;
	variables: Record<string, string>;
	tagIds: number[];
}

export interface StoredCommand {
	id: number;
	version: number;
	name: string | null;
	command: string;
	variables: Record<string, string>;
	tagIds: number[];
	usageCount: number;
	createdAt: number;
	updatedAt: number;
}

export interface StoredCommandTag {
	id: number;
	version: number;
	name: string;
	createdAt: number;
	updatedAt: number;
}

export type StoredCommandTask =
	| { action: 'create'; input: StoredCommandInput }
	| { action: 'update'; id: number; expectedVersion: number; input: StoredCommandInput }
	| { action: 'delete' | 'increment'; id: number; expectedVersion: number }
	| { action: 'create_tag'; name: string }
	| { action: 'update_tag'; id: number; expectedVersion: number; name: string }
	| { action: 'delete_tag'; id: number; expectedVersion: number }
	| { action: 'assign_tag'; commands: Array<{ id: number; expectedVersion: number }>; tagId: number };

export type StoredCommandResult =
	| { status: 'command'; value: StoredCommand }
	| { status: 'tag'; value: StoredCommandTag }
	| { status: 'deleted' }
	| { status: 'assigned'; count: number }
	| { status: 'not_found' | 'version_conflict' | 'name_conflict' | 'limit_exceeded' };

export interface CommandAuthorization {
	sessionDigest: string;
	admit(userId: number | null): void;
	admitCount(collection: 'commands' | 'tags' | 'associations', count: number): void;
}

export interface CommandStorage {
	list(userId: number, sortBy: CommandSort, offset: number, limit: number): Promise<StoredCommand[]>;
	listTags(userId: number, offset: number, limit: number): Promise<StoredCommandTag[]>;
	mutate(
		userId: number,
		task: StoredCommandTask,
		at: number,
		authorization: CommandAuthorization,
	): Promise<StoredCommandResult>;
}
