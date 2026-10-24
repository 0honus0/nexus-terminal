import type { CommandSort } from '@nexus-terminal/shared/preferences/commands/values';

export interface CommandActor {
	userId: number;
	token: string;
}

export interface CommandIdentity {
	userId: number | null;
}

export interface CommandCount {
	collection: 'commands' | 'tags' | 'associations';
	count: number;
}

export interface CommandQuery {
	sortBy: CommandSort;
	offset: number;
	limit: number;
}

export interface CommandPage {
	entries: CommandRecord[];
	nextOffset: number | null;
}

export interface CommandTagPage {
	entries: CommandTagRecord[];
	nextOffset: number | null;
}

export interface CommandInput {
	name: string | null;
	command: string;
	variables: Record<string, string>;
	tagIds: number[];
}

export interface CommandRecord {
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

export interface CommandTagRecord {
	id: number;
	version: number;
	name: string;
	createdAt: number;
	updatedAt: number;
}

export type CommandTask =
	| { action: 'create'; input: CommandInput }
	| { action: 'update'; id: number; expectedVersion: number; input: CommandInput }
	| { action: 'delete' | 'increment'; id: number; expectedVersion: number }
	| { action: 'create_tag'; name: string }
	| { action: 'update_tag'; id: number; expectedVersion: number; name: string }
	| { action: 'delete_tag'; id: number; expectedVersion: number }
	| {
			action: 'delete_group';
			id: number;
			expectedVersion: number;
			commands: Array<{ id: number; expectedVersion: number }>;
	  }
	| { action: 'assign_tag'; commands: Array<{ id: number; expectedVersion: number }>; tagId: number };

export type CommandResult =
	| { status: 'command'; value: CommandRecord }
	| { status: 'tag'; value: CommandTagRecord }
	| { status: 'deleted' }
	| { status: 'assigned'; count: number };
