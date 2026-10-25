import { RunChanges } from './run-changes.js';
import { AgentFailure } from '../../agent-failure.js';
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
			throw new AgentFailure(error.cause.code);
		}
		throw error;
	}
}

export class RunCollaborationModel {
	constructor(
		private readonly owner: RunCollaborationStorage,
		private readonly changes = new RunChanges(),
	) {}

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

	async delegate(
		command: DelegateCommand,
		admit: (facts: ChildAdmissionFacts) => boolean,
	): Promise<ChildCreation | null> {
		const value = await this.changes.after(command.scope.userId, command.scope.appId, () =>
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
							children: facts.children,
							now: facts.now,
							dependencies: facts.dependencies.map(fromParticipant),
						}),
				),
			),
		);
		return value
			? {
					participant: fromParticipant(value.participant),
					providerId: value.providerId,
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
			await this.changes.after(scope.userId, scope.appId, () =>
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
		maxFacts: number,
	): Promise<CollaborationFact> {
		const value = await storage(() =>
			this.owner.writeFact(toAuthority(authority), key, text, expectedVersion, maxFacts),
		);
		if (typeof value === 'string') {
			throw new AgentFailure(value);
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
		return this.changes.after(authority.scope.userId, authority.scope.appId, () =>
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

	async read(authority: CollaborationAuthority, after: number, limit: number): Promise<CollaborationPage> {
		const page = await storage(() => this.owner.read(toAuthority(authority), after, limit));
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
			throw new AgentFailure(result);
		}
		return result;
	}
}
