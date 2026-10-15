import { drainPreferences } from '../../preferences-lifecycle.js';
import { COMMAND_PAGE_MAX_ENTRIES, COMMAND_MAX_TAGS } from '@nexus-terminal/shared/preferences/commands/values';
import type { CommandModel } from '../model/command-model.js';
import type {
	CommandActor,
	CommandIdentity,
	CommandCount,
	CommandTask,
	CommandResult,
	CommandQuery,
	CommandPage,
	CommandTagPage,
} from '../model/command-types.js';
import { prepareCommandTask } from '../command-rules.js';
import { CommandFailure } from '../../command-failure.js';

const COLLECTION_LIMITS = { commands: 2000, tags: 200, associations: COMMAND_MAX_TAGS };

function admit(actor: CommandActor, identity: CommandIdentity): void {
	if (identity.userId === null) {
		throw new CommandFailure('unauthenticated');
	}
	if (identity.userId !== actor.userId) {
		throw new CommandFailure('forbidden');
	}
}

function admitCount(facts: CommandCount): void {
	if (facts.count >= COLLECTION_LIMITS[facts.collection]) {
		throw new CommandFailure('limit_exceeded');
	}
}

export class CommandService {
	private accepting = true;
	private readonly pending = new Set<Promise<unknown>>();
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: CommandModel) {}

	private run<T>(actor: CommandActor, work: () => Promise<T>): Promise<T> {
		if (!this.accepting || this.pending.size >= 16) {
			return Promise.reject(new CommandFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new CommandFailure('unauthenticated'));
		}
		const task = Promise.resolve().then(work);
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => undefined);
		return task;
	}

	private validateQuery(query: CommandQuery, maximum: number): void {
		if (
			!Number.isSafeInteger(query.offset) ||
			query.offset < 0 ||
			query.offset > maximum ||
			!Number.isSafeInteger(query.limit) ||
			query.limit < 1 ||
			query.limit > COMMAND_PAGE_MAX_ENTRIES
		) {
			throw new CommandFailure('invalid_input');
		}
	}

	list(actor: CommandActor, query: CommandQuery): Promise<CommandPage> {
		return this.run(actor, async () => {
			this.validateQuery(query, COLLECTION_LIMITS.commands);
			const rows = await this.model.list(actor.userId, {
				sortBy: query.sortBy,
				offset: query.offset,
				limit: query.limit + 1,
			});
			return {
				entries: rows.slice(0, query.limit),
				nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
			};
		});
	}

	listTags(actor: CommandActor, query: CommandQuery): Promise<CommandTagPage> {
		return this.run(actor, async () => {
			this.validateQuery(query, COLLECTION_LIMITS.tags);
			const rows = await this.model.listTags(actor.userId, {
				sortBy: query.sortBy,
				offset: query.offset,
				limit: query.limit + 1,
			});
			return {
				entries: rows.slice(0, query.limit),
				nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
			};
		});
	}

	mutate(actor: CommandActor, task: CommandTask): Promise<CommandResult> {
		return this.run(actor, () => {
			const command = prepareCommandTask(task);
			return this.model.mutate(
				actor,
				task,
				Math.floor(Date.now() / 1000),
				(identity) => admit(actor, identity),
				admitCount,
			);
		});
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = drainPreferences([...this.pending]);
		}
		return this.closePromise;
	}
}
