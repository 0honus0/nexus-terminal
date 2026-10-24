import type {
	CommandStorage,
	StoredCommand,
	StoredCommandTag,
	StoredCommandTask,
	CommandAuthorization,
} from '../storage/command-storage.js';
import type {
	CommandRecord,
	CommandTagRecord,
	CommandTask,
	CommandResult,
	CommandActor,
	CommandIdentity,
	CommandCount,
	CommandQuery,
} from './command-types.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { CommandFailure } from '../../command-failure.js';

function variables(value: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		Object.defineProperty(result, key, { value: entry, enumerable: true });
	}
	return result;
}

function fromCommand(value: StoredCommand): CommandRecord {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		command: value.command,
		variables: variables(value.variables),
		tagIds: value.tagIds.map((id) => id),
		usageCount: value.usageCount,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function fromTag(value: StoredCommandTag): CommandTagRecord {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function toStorage(value: CommandTask): StoredCommandTask {
	switch (value.action) {
		case 'create':
			return {
				action: 'create',
				input: {
					name: value.input.name,
					command: value.input.command,
					variables: variables(value.input.variables),
					tagIds: value.input.tagIds.map((id) => id),
				},
			};
		case 'update':
			return {
				action: 'update',
				id: value.id,
				expectedVersion: value.expectedVersion,
				input: {
					name: value.input.name,
					command: value.input.command,
					variables: variables(value.input.variables),
					tagIds: value.input.tagIds.map((id) => id),
				},
			};
		case 'delete':
		case 'increment':
		case 'delete_tag':
			return { action: value.action, id: value.id, expectedVersion: value.expectedVersion };
		case 'delete_group':
			return {
				action: 'delete_group',
				id: value.id,
				expectedVersion: value.expectedVersion,
				commands: value.commands.map((row) => ({ id: row.id, expectedVersion: row.expectedVersion })),
			};
		case 'create_tag':
			return { action: 'create_tag', name: value.name };
		case 'update_tag':
			return { action: 'update_tag', id: value.id, expectedVersion: value.expectedVersion, name: value.name };
		case 'assign_tag':
			return {
				action: 'assign_tag',
				commands: value.commands.map((row) => ({ id: row.id, expectedVersion: row.expectedVersion })),
				tagId: value.tagId,
			};
	}
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof CommandFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			const unknown = cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed';
			throw new CommandFailure(unknown ? 'operation_unknown' : 'storage_unavailable', { cause });
		}
		throw new CommandFailure('internal_failure', { cause });
	}
}

export class CommandModel {
	constructor(
		private readonly storage: CommandStorage,
		private readonly tokens: SessionTokens,
	) {}

	async list(userId: number, query: CommandQuery): Promise<CommandRecord[]> {
		return (await storage(() => this.storage.list(userId, query.sortBy, query.offset, query.limit))).map(
			fromCommand,
		);
	}

	async listTags(userId: number, query: CommandQuery): Promise<CommandTagRecord[]> {
		return (await storage(() => this.storage.listTags(userId, query.offset, query.limit))).map(fromTag);
	}

	async mutate(
		actor: CommandActor,
		task: CommandTask,
		admit: (identity: CommandIdentity) => void,
		admitCount: (facts: CommandCount) => void,
	): Promise<CommandResult> {
		const result = await storage(() => {
			const authorization: CommandAuthorization = {
				sessionDigest: this.tokens.digest(actor.token),

				admit: (userId) => admit({ userId }),

				admitCount: (collection, count) => admitCount({ collection, count }),
			};
			return this.storage.mutate(actor.userId, toStorage(task), authorization);
		});
		if (result.status === 'not_found') {
			throw new CommandFailure('not_found');
		}
		if (result.status === 'version_conflict') {
			throw new CommandFailure('version_conflict');
		}
		if (result.status === 'name_conflict') {
			throw new CommandFailure('name_conflict');
		}
		if (result.status === 'limit_exceeded') {
			throw new CommandFailure('limit_exceeded');
		}
		try {
			switch (result.status) {
				case 'command':
					return { status: 'command', value: fromCommand(result.value) };
				case 'tag':
					return { status: 'tag', value: fromTag(result.value) };
				case 'deleted':
					return { status: 'deleted' };
				case 'assigned':
					return { status: 'assigned', count: result.count };
			}
		} catch (cause) {
			throw new CommandFailure('operation_unknown', { cause });
		}
	}
}
