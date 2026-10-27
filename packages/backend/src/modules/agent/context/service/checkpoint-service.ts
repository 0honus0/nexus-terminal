import type { ExecutionService } from '../../execution/service/execution-service.js';
import { randomUUID } from 'node:crypto';
import { AgentFailure } from '../../agent-failure.js';
import type { CheckpointModel } from '../model/checkpoint-model.js';
import type { ContextCheckpoint, CheckpointScope } from '../model/checkpoint-types.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { ContextService } from './context-service.js';

export class CheckpointService {
	constructor(
		private readonly model: CheckpointModel,
		private readonly settings: ExecutionService,
	) {}

	async create(operation: ToolOperation, summary: string): Promise<ContextCheckpoint> {
		if (
			!summary.trim() ||
			summary.includes('\0') ||
			Buffer.byteLength(summary, 'utf8') > 16384 ||
			Buffer.from(summary, 'utf8').toString('utf8') !== summary
		) {
			throw new AgentFailure('invalid_input');
		}
		const settings = await this.settings.frozen(operation.userId, operation.appId, operation.runId);
		const ratio =
			settings.contextCompactionMode === 'aggressive'
				? 0.35
				: settings.contextCompactionMode === 'balanced'
					? 0.5
					: 0.75;
		const checkpoint = await this.model.create(operation, randomUUID(), summary, Date.now(), (facts) => {
			if (facts.sourceMessages < 3 || Buffer.byteLength(summary, 'utf8') > facts.sourceBytes * ratio) {
				throw new AgentFailure('invalid_input');
			}
		});
		if (!checkpoint) {
			throw new AgentFailure('version_conflict');
		}
		return checkpoint;
	}

	async apply(scope: CheckpointScope, stepIndex: number, context: ContextService): Promise<void> {
		const checkpoint = await this.model.get(scope, stepIndex);
		if (checkpoint) {
			context.applyCheckpoint(checkpoint.summary, checkpoint.sourceMessages);
		}
	}
}
