import { AGENT_THREAD_MAX_PAGE } from '@nexus-terminal/shared/agent/scope/values';
import { AGENT_SCOPE_MAX_NAME_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import { validateAgentId, validateUserId } from '../../agent-validation.js';
import { AgentFailure } from '../../agent-failure.js';
import type { ThreadModel } from '../model/thread-model.js';
import type {
	ThreadAccess,
	ThreadPage,
	ThreadMutation,
	ThreadAccessFacts,
	ThreadRemoval,
} from '../model/thread-types.js';
import type { AgentThread } from '../model/scope-types.js';

function admission(access: ThreadAccess, facts: ThreadAccessFacts): void {
	access.assertCurrent();
	if (facts.identityUserId !== access.userId) {
		throw new AgentFailure('unauthenticated');
	}
	if (access.kind === 'session' && facts.kind === 'session') {
		if (facts.app === null) {
			throw new AgentFailure('not_found');
		}
		if (!facts.app.enabled || !facts.app.declared) {
			throw new AgentFailure('app_disabled');
		}
		if (facts.app.version !== access.appVersion) {
			throw new AgentFailure('version_conflict');
		}
		return;
	}
	if (access.kind !== 'plugin' || facts.kind !== 'plugin') {
		throw new AgentFailure('forbidden');
	}
	if (!facts.installed || !facts.enabled || !facts.trusted) {
		throw new AgentFailure('forbidden');
	}
	if (facts.revision !== access.revision || access.expiresAt <= Date.now()) {
		throw new AgentFailure('version_conflict');
	}
}

export class ThreadService {
	constructor(private readonly model: ThreadModel) {}

	private validateAccess(access: ThreadAccess): void {
		validateUserId(access.userId);
		validateAgentId(access.appId);
		if (access.kind === 'session' && (!Number.isSafeInteger(access.appVersion) || access.appVersion < 1)) {
			throw new AgentFailure('invalid_input');
		}
	}

	withAdmission<T>(access: ThreadAccess, work: () => Promise<T>): Promise<T> {
		this.validateAccess(access);
		return this.model.withAdmission(access, (facts) => admission(access, facts), work);
	}

	async list(access: ThreadAccess, after: string | null, limit: number): Promise<ThreadPage> {
		this.validateAccess(access);
		if (after !== null) {
			validateAgentId(after);
		}
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGENT_THREAD_MAX_PAGE) {
			throw new AgentFailure('invalid_input');
		}
		const values = await this.model.list(access, after, limit + 1, (facts) => admission(access, facts));
		const items = values.slice(0, limit);
		return { items, nextCursor: values.length > limit ? items[items.length - 1].id : null };
	}

	mutate(access: ThreadAccess, input: ThreadMutation): Promise<AgentThread> {
		this.validateAccess(access);
		validateAgentId(input.operationId);
		if (
			typeof input.title !== 'string' ||
			!input.title.trim() ||
			Buffer.byteLength(input.title, 'utf8') > AGENT_SCOPE_MAX_NAME_BYTES ||
			Buffer.from(input.title, 'utf8').toString('utf8') !== input.title
		) {
			throw new AgentFailure('invalid_input');
		}
		if (input.kind === 'rename') {
			validateAgentId(input.threadId);
			if (
				!Number.isSafeInteger(input.expectedVersion) ||
				input.expectedVersion < 1 ||
				input.expectedVersion >= Number.MAX_SAFE_INTEGER
			) {
				throw new AgentFailure('invalid_input');
			}
		}
		const command: ThreadMutation =
			input.kind === 'create'
				? { kind: input.kind, operationId: input.operationId, title: input.title.trim() }
				: {
						kind: input.kind,
						operationId: input.operationId,
						title: input.title.trim(),
						threadId: input.threadId,
						expectedVersion: input.expectedVersion,
					};
		return this.model.mutate(
			access,
			command,
			(threads) => {
				if (input.kind === 'create' && threads >= 512) {
					throw new AgentFailure('limit_exceeded');
				}
			},
			(facts) => admission(access, facts),
		);
	}

	remove(access: ThreadAccess, input: ThreadRemoval): Promise<AgentThread> {
		this.validateAccess(access);
		validateAgentId(input.threadId);
		if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.remove(
			access,
			{ threadId: input.threadId, expectedVersion: input.expectedVersion },
			(facts) => {
				if (
					facts.runStatuses.some(
						(status) => status === 'pending' || status === 'running' || status === 'unknown',
					)
				) {
					throw new AgentFailure('active_run_conflict');
				}
				if (facts.maxMemoryVersion !== null && facts.maxMemoryVersion >= Number.MAX_SAFE_INTEGER) {
					throw new AgentFailure('version_conflict');
				}
				return { updatedAt: Date.now() };
			},
			(facts) => admission(access, facts),
		);
	}
}
