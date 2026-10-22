import { agentStorage } from '../../agent-storage-failure.js';
import type { ThreadEntryCursor, ThreadEntries } from './context-types.js';
import type { RunModelMessage } from '../../runs/model/run-types.js';
import type { ContextStorage, StoredContextMessage, StoredContextSnapshot } from '../storage/context-storage.js';
import type {
	ContextSource,
	ContextHistoryCommand,
	ContextHistoryFacts,
	ContextHistoryTurn,
	ContextHistoryBundle,
} from './context-types.js';

/** The single application→context journal projection, consumed by RunStepModel. */
export function toStoredContext(messages: RunModelMessage[], sources: ContextSource[]): StoredContextSnapshot {
	return {
		messages: messages.map((message): StoredContextMessage => {
			if (message.role === 'user') {
				return { role: 'user', content: message.content };
			}
			if (message.role === 'tool') {
				return { role: 'tool', providerCallId: message.providerCallId, content: message.content };
			}
			return {
				role: 'assistant',
				content: message.content,
				proposals: message.proposals.map((proposal) => ({
					providerCallId: proposal.providerCallId,
					toolName: proposal.toolName,
					argumentsJson: proposal.argumentsJson,
				})),
				reasoning: message.reasoning.map((item) => ({
					id: item.id,
					encryptedContent: item.encryptedContent,
					summary: item.summary.map((text) => text),
				})),
			};
		}),
		sources: sources.map((source) => ({
			runId: source.runId,
			version: source.version,
			sequence: source.sequence,
			status: source.status,
		})),
	};
}

export class ContextModel {
	constructor(private readonly storage: ContextStorage) {}

	async entries(
		userId: number,
		appId: string,
		threadId: string,
		after: ThreadEntryCursor,
		limit: number,
	): Promise<ThreadEntries | null> {
		const value = await agentStorage(() =>
			this.storage.readEntries(
				userId,
				appId,
				threadId,
				{
					runSequence: after.runSequence,
					stepIndex: after.stepIndex,
					eventSequence: after.eventSequence,
					textOffset: after.textOffset,
				},
				limit,
			),
		);
		return value === null
			? null
			: {
					appId: value.appId,
					threadId: value.threadId,
					items: value.items.map((item) => ({
						runId: item.runId,
						role: item.role,
						text: item.text,
						position: {
							runSequence: item.position.runSequence,
							stepIndex: item.position.stepIndex,
							eventSequence: item.position.eventSequence,
							textOffset: item.position.textOffset,
						},
					})),
					nextCursor: {
						runSequence: value.nextCursor.runSequence,
						stepIndex: value.nextCursor.stepIndex,
						eventSequence: value.nextCursor.eventSequence,
						textOffset: value.nextCursor.textOffset,
					},
				};
	}

	async readHistory(
		command: ContextHistoryCommand,
		sourceLimit: number,
		fits: (facts: ContextHistoryFacts) => boolean,
	): Promise<ContextHistoryBundle | null> {
		const turns = await agentStorage(() =>
			this.storage.readHistory(
				{
					userId: command.userId,
					appId: command.appId,
					runId: command.runId,
					expectedVersion: command.expectedVersion,
					includeThread: command.includeThread,
				},
				sourceLimit,
				(facts) =>
					fits({
						sources: facts.sources,
						runs: facts.runs,
						steps: facts.steps,
						tools: facts.tools,
						bytes: facts.bytes,
					}),
			),
		);
		return turns === null
			? null
			: {
					sources: turns.sources.map((source) => ({
						runId: source.runId,
						version: source.version,
						sequence: source.sequence,
						status: source.status,
					})),
					summary:
						turns.summary === null
							? null
							: { content: turns.summary.content, coveredRuns: turns.summary.coveredRuns },
					turns: turns.turns.map((turn) => ({
						source: {
							runId: turn.source.runId,
							version: turn.source.version,
							sequence: turn.source.sequence,
							status: turn.source.status,
						},
						input: turn.input,
						steps: turn.steps.map((step) => ({
							index: step.index,
							state: step.state,
							text: step.text,
							proposals: step.proposals.map((proposal) => ({
								providerCallId: proposal.providerCallId,
								toolName: proposal.toolName,
								argumentsJson: proposal.argumentsJson,
							})),
							results: step.results.map((result) => ({
								providerCallId: result.providerCallId,
								state: result.state,
								content: result.content,
							})),
						})),
					})),
				};
	}
}
