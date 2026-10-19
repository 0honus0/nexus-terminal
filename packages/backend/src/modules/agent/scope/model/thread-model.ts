import { createHash } from 'node:crypto';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import type { ThreadStorage, StoredThreadAccessFacts } from '../storage/thread-storage.js';
import { ThreadStorageRefusal } from '../storage/thread-storage.js';
import { fromThreadRecord } from './thread-mapper.js';
import type { AgentThread } from './scope-types.js';
import type { ThreadAccess, ThreadMutation, ThreadAccessFacts } from './thread-types.js';

function fromAccessFacts(value: StoredThreadAccessFacts): ThreadAccessFacts {
	if (value.kind === 'session') {
		return {
			kind: value.kind,
			identityUserId: value.identityUserId,
			app:
				value.app === null
					? null
					: {
							version: value.app.version,
							enabled: value.app.enabled,
							declared: value.app.declared,
						},
		};
	}
	return {
		kind: value.kind,
		identityUserId: value.identityUserId,
		revision: value.revision,
		installed: value.installed,
		enabled: value.enabled,
		trusted: value.trusted,
	};
}

export class ThreadModel {
	constructor(
		private readonly storage: ThreadStorage,
		private readonly tokens: SessionTokens,
	) {}

	withAdmission<T>(
		access: ThreadAccess,
		admit: (facts: ThreadAccessFacts) => void,
		work: () => Promise<T>,
	): Promise<T> {
		return agentStorage(() =>
			this.storage.withAdmission(
				{
					kind: access.kind,
					userId: access.userId,
					appId: access.appId,
					digest: this.tokens.digest(access.token),
				},
				(facts) => admit(fromAccessFacts(facts)),
				work,
			),
		);
	}

	async list(
		access: ThreadAccess,
		after: string | null,
		limit: number,
		admit: (facts: ThreadAccessFacts) => void,
	): Promise<AgentThread[]> {
		const values = await agentStorage(() =>
			this.storage.list(
				{
					kind: access.kind,
					userId: access.userId,
					appId: access.appId,
					digest: this.tokens.digest(access.token),
				},
				after,
				limit,
				(facts) => admit(fromAccessFacts(facts)),
			),
		);
		return values.map(fromThreadRecord);
	}

	async mutate(
		access: ThreadAccess,
		input: ThreadMutation,
		admitCapacity: (threads: number, commands: number) => void,
		admit: (facts: ThreadAccessFacts) => void,
	): Promise<AgentThread> {
		const requestHash = createHash('sha256')
			.update(
				JSON.stringify(
					input.kind === 'create'
						? [1, input.kind, input.title]
						: [1, input.kind, input.threadId, input.expectedVersion, input.title],
				),
			)
			.digest('hex');
		const value = await agentStorage(async () => {
			try {
				return await this.storage.mutate(
					{
						kind: access.kind,
						userId: access.userId,
						appId: access.appId,
						digest: this.tokens.digest(access.token),
					},
					input.kind === 'create'
						? {
								kind: input.kind,
								operationId: input.operationId,
								title: input.title,
								requestHash,
								now: Date.now(),
							}
						: {
								kind: input.kind,
								operationId: input.operationId,
								threadId: input.threadId,
								expectedVersion: input.expectedVersion,
								title: input.title,
								requestHash,
								now: Date.now(),
							},
					(facts) => admit(fromAccessFacts(facts)),
					admitCapacity,
				);
			} catch (error) {
				if (error instanceof ThreadStorageRefusal) {
					throw new AgentFailure(error.code);
				}
				throw error;
			}
		});
		return fromThreadRecord(value);
	}
}
