import type { CollaborationWatch } from './run-collaboration-types.js';
import { RunChanges } from './run-changes.js';
import { AgentFailure } from '../../agent-failure.js';
import { CollaborationRefusal } from '../run-collaboration-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { CollaborationStorageRefusal } from '../storage/run-collaboration-storage.js';
import type {
	RunCollaborationStorage,
	StoredParticipant,
	StoredCollaborationAuthority,
} from '../storage/run-collaboration-storage.js';
import type {
	Participant,
	ParticipantScope,
	DelegateCommand,
	ChildAdmissionFacts,
	ChildCreation,
	CollaborationAuthority,
	CollaborationFact,
	CollaborationPage,
	MessageMetadataPage,
} from './run-collaboration-types.js';

function fromParticipant(value: StoredParticipant): Participant {
	return {
		id: value.id,
		version: value.version,
		rootId: value.rootId,
		parentId: value.parentId,
		status: value.status,
		profile: value.profile,
		output: value.output,
		outputBytes: value.outputBytes,
		tools: value.tools.map((name) => name),
		maxRequests: value.maxRequests,
		deadline: value.deadline,
		dependencies: value.dependencies.map((id) => id),
		dependencyMode: value.dependencyMode,
	};
}

function toScope(value: ParticipantScope) {
	return { userId: value.userId, appId: value.appId, runId: value.runId };
}

function toAuthority(value: CollaborationAuthority): StoredCollaborationAuthority {
	return {
		scope: toScope(value.scope),
		operationId: value.operationId,
		operationHash: value.operationHash,
		now: value.now,
	};
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await agentStorage(work);
	} catch (error) {
		// Domain refusals are not an unknown commit or a technical failure.
		if (error instanceof AgentFailure && error.cause instanceof CollaborationStorageRefusal) {
			throw new CollaborationRefusal(error.cause.code, { cause: error });
		}
		throw error;
	}
}

export class RunCollaborationModel {
	constructor(
		private readonly owner: RunCollaborationStorage,
		private readonly changes = new RunChanges(),
	) {}

	watch(scope: ParticipantScope, signal: AbortSignal, deadline: number): CollaborationWatch {
		let resolve = () => {};

		let reject: (error: unknown) => void = () => {};

		const changed = new Promise<void>((success, failed) => {
			resolve = success;
			reject = failed;
		});

		let off = () => {};

		let timer: ReturnType<typeof setTimeout> | undefined;
		let closed = false;

		const close = () => {
			if (closed) {
				return;
			}
			closed = true;
			clearTimeout(timer);
			off();
			signal.removeEventListener('abort', abort);
			resolve();
		};

		const abort = () => {
			reject(new AgentFailure('provider_unavailable', { cause: signal.reason }));
			close();
		};

		off = this.changes.subscribe(scope, close, () => {
			reject(new AgentFailure('provider_unavailable'));
			close();
		});
		if (closed) {
			// A stopped owner invokes the callback synchronously during subscription.
			off();
		} else {
			timer = setTimeout(close, Math.max(0, deadline - Date.now()));
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) {
				abort();
			}
		}
		void changed.catch(() => undefined);
		return { changed: changed, close };
	}

	async messageMetadata(scope: ParticipantScope, after: number, limit: number): Promise<MessageMetadataPage> {
		const page = await storage(() => this.owner.messageMetadata(toScope(scope), after, limit));
		return {
			items: page.items.map((item) => ({
				sequence: item.sequence,
				senderId: item.senderId,
				bodyBytes: item.bodyBytes,
				expiresAt: item.expiresAt,
			})),
			nextCursor: page.nextCursor,
		};
	}

	async participant(scope: ParticipantScope): Promise<Participant | null> {
		const value = await storage(() => this.owner.participant(toScope(scope)));
		return value ? fromParticipant(value) : null;
	}

	async children(scope: ParticipantScope): Promise<Participant[]> {
		return (await storage(() => this.owner.children(toScope(scope)))).map(fromParticipant);
	}

	async output(
		scope: ParticipantScope,
		childId: string,
		offset: number,
		maxBytes: number,
	): Promise<import('./run-collaboration-types.js').ChildOutputPage | null> {
		const value = await storage(() => this.owner.output(toScope(scope), childId, offset, maxBytes));
		if (value === null) {
			return null;
		}
		if (value.status === 'invalid_offset') {
			throw new AgentFailure('invalid_input');
		}
		return {
			sha256: value.sha256,
			originalBytes: value.originalBytes,
			offset: value.offset,
			nextOffset: value.nextOffset,
			text: value.text,
		};
	}

	async delegate(
		command: DelegateCommand,
		admit: (facts: ChildAdmissionFacts) => boolean,
	): Promise<ChildCreation | null> {
		const value = await this.changes.after(command.scope, () =>
			storage(() =>
				this.owner.delegate(
					{
						scope: toScope(command.scope),
						operationId: command.operationId,
						operationHash: command.operationHash,
						now: command.now,
						id: command.id,
						requestHash: command.requestHash,
						objective: command.objective,
						inputJson: command.inputJson,
						targets: command.targets.map((id) => id),
						profile: command.profile,
						tools: command.tools.map((name) => name),
						maxRequests: command.maxRequests,
						deadline: command.deadline,
						dependencies: command.dependencies.map((id) => id),
						dependencyMode: command.dependencyMode,
					},
					(facts) =>
						admit({
							parent: fromParticipant(facts.parent),
							selectedTargets: facts.selectedTargets.map((id) => id),
							activeChildIds: facts.activeChildIds.map((id) => id),
							now: facts.now,
							dependencies: facts.dependencies.map(fromParticipant),
						}),
				),
			),
		);
		return value
			? {
					participant: fromParticipant(value.participant),
					inputJson: value.inputJson,
					prompt: value.prompt,
					requestHash: value.requestHash,
					version: value.version,
					created: value.created,
				}
			: null;
	}

	async cancelChildren(
		scope: ParticipantScope,
		ids: string[] | null,
		authority: CollaborationAuthority | null = null,
	): Promise<string[]> {
		return (
			await this.changes.after(scope, () =>
				storage(() =>
					this.owner.cancelChildren(
						toScope(scope),
						ids === null ? null : ids.map((id) => id),
						Date.now(),
						authority === null ? null : toAuthority(authority),
					),
				),
			)
		).map((id) => id);
	}

	async fact(authority: CollaborationAuthority, key: string): Promise<CollaborationFact | null> {
		const value = await storage(() => this.owner.fact(toAuthority(authority), key));
		return value ? { key: value.key, value: value.value, version: value.version, authorId: value.authorId } : null;
	}

	async writeFact(
		authority: CollaborationAuthority,
		key: string,
		text: string,
		expectedVersion: number,
	): Promise<CollaborationFact> {
		const value = await storage(() => this.owner.writeFact(toAuthority(authority), key, text, expectedVersion));
		if (typeof value === 'string') {
			throw new CollaborationRefusal(value);
		}
		return { key: value.key, value: value.value, version: value.version, authorId: value.authorId };
	}

	send(
		authority: CollaborationAuthority,
		recipientId: string,
		body: string,
		expiresAt: number,
		maxMessages: number,
		maxBytes: number,
	): Promise<number> {
		return this.changes.after(authority.scope, () =>
			storage(() =>
				this.owner.send(
					toAuthority(authority),
					authority.operationId,
					recipientId,
					body,
					expiresAt,
					maxMessages,
					maxBytes,
				),
			),
		);
	}

	async read(
		authority: CollaborationAuthority,
		after: number,
		limit: number,
		maxBytes: number,
	): Promise<CollaborationPage> {
		const page = await storage(() => this.owner.read(toAuthority(authority), after, limit, maxBytes));
		return {
			messages: page.messages.map((value) => ({
				sequence: value.sequence,
				senderId: value.senderId,
				body: value.body,
				expiresAt: value.expiresAt,
			})),
			nextCursor: page.nextCursor,
			consumedThrough: page.consumedThrough,
		};
	}

	async consume(authority: CollaborationAuthority, through: number, expectedConsumed: number): Promise<number> {
		const result = await storage(() => this.owner.consume(toAuthority(authority), through, expectedConsumed));
		if (result === 'version_conflict') {
			throw new CollaborationRefusal(result);
		}
		return result;
	}
}
