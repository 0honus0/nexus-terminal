import { capturedResultHash, resultPage } from '../../context/result-rules.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import { validateAgentId, validateUserId } from '../../agent-validation.js';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentFailure, ToolExecutionUnknown, isAgentDrainFailure } from '../../agent-failure.js';
import type { RunCollaborationModel } from '../model/run-collaboration-model.js';
import type {
	Participant,
	ParticipantScope,
	CollaborationInput,
	CollaborationAuthority,
	CollaborationRuntime,
	DelegateCommand,
} from '../model/run-collaboration-types.js';
import type { ToolDefinition } from '../../tools/model/tool-types.js';
import { AGENT_COLLABORATION_MESSAGE_MAX_PAGE } from '@nexus-terminal/shared/agent/collaboration/values';
import type { MessageMetadataPage } from '../model/run-collaboration-types.js';
import type { CollaborationFact } from '../model/run-collaboration-types.js';
import type { ToolOperation } from '../model/run-tool-types.js';
import { toolDefinitions } from '../../tools/service/tool-definitions.js';
import { mayDelegate, isSettled, COLLABORATION_MAX_FACTS } from '../run-collaboration-rules.js';

function view(value: Participant) {
	return {
		id: value.id,
		parentId: value.parentId,
		status: value.status,
		profile: value.profile,
		output: value.output,
		outputBytes: value.outputBytes,
		outputTruncated: value.output !== null && Buffer.byteLength(value.output, 'utf8') < value.outputBytes,
		maxRequests: value.maxRequests,
		deadline: value.deadline,
	};
}

function factView(value: CollaborationFact | null) {
	return value ? { key: value.key, value: value.value, version: value.version, authorId: value.authorId } : null;
}

/** Same Run executor owns both Root and Child tasks; this service owns collaboration use cases. */
export class RunCollaborationService {
	constructor(
		private readonly model: RunCollaborationModel,
		private readonly runtime: CollaborationRuntime,
		private readonly settings: ExecutionService,
	) {}

	async listChildren(scope: ParticipantScope): Promise<Participant[] | null> {
		validateUserId(scope.userId);
		validateAgentId(scope.appId);
		validateAgentId(scope.runId);
		const owner = await this.model.participant(scope);
		if (!owner || owner.parentId !== null) {
			return null;
		}
		return this.model.children(scope);
	}

	async child(scope: ParticipantScope, childId: string): Promise<Participant | null> {
		const children = await this.listChildren(scope);
		return children?.find((child) => child.id === childId) ?? null;
	}

	async messageMetadata(
		scope: ParticipantScope,
		childId: string,
		after: number,
		limit: number,
	): Promise<MessageMetadataPage | null> {
		if (
			!Number.isSafeInteger(after) ||
			after < 0 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > AGENT_COLLABORATION_MESSAGE_MAX_PAGE
		) {
			throw new AgentFailure('invalid_input');
		}
		if (!(await this.child(scope, childId))) {
			return null;
		}
		return this.model.messageMetadata({ userId: scope.userId, appId: scope.appId, runId: childId }, after, limit);
	}

	definitions(owner: Participant | null): ToolDefinition[] {
		if (!owner) {
			throw new AgentFailure('not_found');
		}
		return toolDefinitions().filter((tool) => owner.parentId === null || owner.tools.includes(tool.name));
	}

	participant(scope: ParticipantScope): Promise<Participant | null> {
		return this.model.participant(scope);
	}

	async perform(
		input: CollaborationInput,
		operation: ToolOperation,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		const scope = { userId: operation.userId, appId: operation.appId, runId: operation.runId };
		const authority: CollaborationAuthority = {
			scope,
			operationId: operation.id,
			operationHash: operation.operationHash,
			now: Date.now(),
		};
		await validate();
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		const execution = await this.settings.frozen(scope.userId, scope.appId, scope.runId);
		let result: unknown;
		if (input.action === 'delegate') {
			result = await this.delegate(scope, input, operation, signal);
		} else if (input.action === 'list') {
			const children = await this.model.children(scope);
			const after = input.after === null ? -1 : children.findIndex((child) => child.id === input.after);
			if (input.after !== null && after < 0) {
				throw new AgentFailure('invalid_input');
			}
			const items = children.slice(after + 1, after + 1 + input.limit);
			result = {
				children: items.map(view),
				nextCursor: after + 1 + items.length < children.length ? (items.at(-1)?.id ?? null) : null,
			};
		} else if (input.action === 'output_read') {
			const text = await this.model.output(scope, input.childId);
			if (text === null) {
				throw new AgentFailure('not_found');
			}
			const page = resultPage(
				text,
				{
					toolCallId: input.childId,
					sha256: capturedResultHash(text),
					offset: input.offset,
					maxBytes: input.maxBytes,
				},
				execution.limits.maxToolOutputBytes,
			);
			result = {
				childId: input.childId,
				sha256: page.sha256,
				originalBytes: page.originalBytes,
				offset: page.offset,
				nextOffset: page.nextOffset,
				text: page.text,
				untrusted: true,
			};
		} else if (input.action === 'join' || input.action === 'cancel') {
			const parent = await this.model.participant(scope);
			const children = await this.model.children(scope);
			if (
				!parent ||
				parent.parentId !== null ||
				input.childIds.some((id) => !children.some((child) => child.id === id))
			) {
				throw new AgentFailure('invalid_input');
			}
			if (input.action === 'cancel') {
				await this.cancelChildren(scope, input.childIds, authority);
				result = {
					children: (await this.model.children(scope))
						.filter((child) => input.childIds.includes(child.id))
						.map(view),
				};
			} else {
				const deadline = Math.min(Date.now() + input.waitSeconds * 1000, parent.deadline);
				while (true) {
					await validate();
					const items = (await this.model.children(scope)).filter((child) =>
						input.childIds.includes(child.id),
					);
					const ready =
						input.mode === 'all'
							? items.every((child) => isSettled(child.status))
							: items.some((child) => isSettled(child.status));
					if (ready || Date.now() >= deadline) {
						result = { ready, children: items.map(view) };
						break;
					}
					await delay(Math.min(250, Math.max(1, deadline - Date.now())), undefined, { signal });
				}
			}
		} else if (input.action === 'send') {
			result = {
				sequence: await this.model.send(
					authority,
					input.recipientId,
					input.body,
					Date.now() + input.ttlSeconds * 1000,
					execution.limits.maxMessages,
					execution.limits.maxMessageBytes,
				),
			};
		} else if (input.action === 'read') {
			const page = await this.model.read(authority, input.after, input.limit);
			result = {
				messages: page.messages.map((message) => ({
					sequence: message.sequence,
					senderId: message.senderId,
					body: message.body,
					expiresAt: message.expiresAt,
				})),
				nextCursor: page.nextCursor,
				consumedThrough: page.consumedThrough,
			};
		} else if (input.action === 'consume') {
			result = { consumedThrough: await this.model.consume(authority, input.through, input.expectedConsumed) };
		} else if (input.action === 'fact_read') {
			result = { fact: factView(await this.model.fact(authority, input.key)) };
		} else {
			result = {
				fact: factView(
					await this.model.writeFact(
						authority,
						input.key,
						input.value,
						input.expectedVersion,
						COLLABORATION_MAX_FACTS,
					),
				),
			};
		}
		await validate();
		return JSON.stringify(result);
	}

	private async cancelChildren(
		scope: ParticipantScope,
		childIds: string[],
		authority: CollaborationAuthority,
	): Promise<void> {
		let cancelled: string[];
		try {
			cancelled = await this.model.cancelChildren(scope, childIds, authority);
		} catch (error) {
			if (!isAgentDrainFailure(error)) {
				throw error;
			}
			// A failed commit confirmation cannot prove the durable fence was absent.
			for (const id of childIds) {
				this.runtime.abort(scope, id);
			}
			try {
				await this.runtime.wait(childIds);
			} catch (cleanup) {
				throw new AgentFailure('operation_unknown', {
					cause: new AggregateError([error, cleanup], 'Child cancellation and drain failed'),
				});
			}
			throw error;
		}
		for (const id of cancelled) {
			this.runtime.abort(scope, id);
		}
		await this.runtime.wait(childIds);
	}

	private async delegate(
		scope: ParticipantScope,
		input: Extract<CollaborationInput, { action: 'delegate' }>,
		operation: ToolOperation,
		signal: AbortSignal,
	): Promise<ReturnType<typeof view>> {
		const frozen = await this.settings.frozen(scope.userId, scope.appId, scope.runId);
		return this.runtime.admit(async (admit) => {
			const parent = await this.model.participant(scope);
			if (!parent || parent.parentId !== null) {
				throw new AgentFailure('invalid_input');
			}
			const now = Date.now();
			const deadline = parent.deadline;
			const command: DelegateCommand = {
				scope,
				operationId: operation.id,
				operationHash: operation.operationHash,
				id: randomUUID(),
				requestHash: createHash('sha256')
					.update(
						JSON.stringify([
							operation.operationHash,
							input.profile,
							input.objective,
							input.targets,
							frozen.limits.maxModelRequests,
							deadline,
							input.dependencies,
							input.dependencyMode,
						]),
					)
					.digest('hex'),
				objective: input.objective,
				targets: input.targets.map((id) => id),
				profile: input.profile,
				tools: this.definitions(parent)
					.filter(
						(tool) =>
							!['collaboration_delegate', 'collaboration_join', 'collaboration_cancel'].includes(
								tool.name,
							),
					)
					.map((tool) => tool.name),
				maxRequests: frozen.limits.maxModelRequests,
				deadline,
				dependencies: input.dependencies.map((id) => id),
				dependencyMode: input.dependencyMode,
				now,
			};
			const child = await this.model.delegate(command, (facts) => {
				admit();
				return (
					new Set([...facts.activeChildIds, ...this.runtime.occupiedChildIds(scope)]).size <
						frozen.limits.maxChildren && mayDelegate(command, facts)
				);
			});
			if (!child) {
				throw new AgentFailure('version_conflict');
			}
			if (child.created) {
				if (
					signal.aborted ||
					!this.runtime.start(
						{
							deadlineAt: child.participant.deadline,
							userId: scope.userId,
							appId: scope.appId,
							runId: child.participant.id,
							providerId: child.providerId,
							version: child.version,
							prompt: child.prompt,
							requestHash: child.requestHash,
						},
						scope.runId,
					)
				) {
					await this.model.cancelChildren(scope, [child.participant.id]);
					throw new AgentFailure('provider_unavailable');
				}
			}
			return view(child.participant);
		}, frozen.limits.maxConcurrentRuns);
	}

	/** Wait only on existing earlier children; no cycles and no replay on restart. */
	async prepare(scope: ParticipantScope, signal: AbortSignal): Promise<Participant | null> {
		const owner = await this.model.participant(scope);
		if (!owner || (owner.status !== 'pending' && owner.status !== 'running') || Date.now() >= owner.deadline) {
			return null;
		}
		while (owner.dependencies.length) {
			if (signal.aborted || Date.now() >= owner.deadline) {
				return null;
			}
			const parent = await this.model.participant({
				userId: scope.userId,
				appId: scope.appId,
				runId: owner.rootId,
			});
			if (!parent || parent.status !== 'running') {
				return null;
			}
			const dependencies = (await this.model.children(scope)).filter((child) =>
				owner.dependencies.includes(child.id),
			);
			if (
				dependencies.length !== owner.dependencies.length ||
				(owner.dependencyMode === 'success' &&
					dependencies.some((child) => isSettled(child.status) && child.status !== 'completed'))
			) {
				return null;
			}
			if (dependencies.every((child) => isSettled(child.status))) {
				break;
			}
			try {
				await delay(250, undefined, { signal });
			} catch (error) {
				if (signal.aborted) {
					return null;
				}
				throw error;
			}
		}
		return owner;
	}

	async finishChildren(scope: ParticipantScope): Promise<void> {
		const children = await this.model.children(scope);
		const owner = await this.model.participant(scope);
		if (!owner || owner.parentId !== null) {
			return;
		}
		await this.runtime.wait(children.map((child) => child.id));
		if (
			(await this.model.children(scope)).some((child) => !isSettled(child.status) || child.status === 'unknown')
		) {
			throw new ToolExecutionUnknown();
		}
	}

	async abandon(scope: ParticipantScope): Promise<void> {
		const owner = await this.model.participant(scope);
		if (owner?.parentId !== null && owner?.parentId !== undefined && owner.status === 'pending') {
			await this.model.cancelChildren({ userId: scope.userId, appId: scope.appId, runId: owner.parentId }, [
				owner.id,
			]);
		}
	}

	async drain(scope: ParticipantScope): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.model.cancelChildren(scope, null)),
			Promise.resolve().then(() => this.runtime.drain(scope)),
		]);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw new AggregateError(failures, 'Child cancellation and cleanup failed');
		}
	}
}
