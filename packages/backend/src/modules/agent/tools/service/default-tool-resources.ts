import type { ToolRuntimeResources, ToolProtocolResources } from '../model/tool-runtime-types.js';
import type { ToolModel } from '../model/tool-model.js';
import type { ToolJobService } from './tool-job-service.js';
import type { BrowserService } from '../../integrations/service/browser-service.js';
import type { ToolJobScope } from '../model/tool-job-types.js';
import type { ToolResourceSnapshot } from '../model/tool-resource-types.js';
import { aggregateToolFailures, isAgentDrainFailure } from '../../agent-failure.js';

/** The aggregate owns no protocol algorithm; it closes the actual SSH, Job, protocol and Browser owners. */
export class DefaultToolResources implements ToolRuntimeResources {
	constructor(
		private readonly model: ToolModel,
		private readonly jobs: ToolJobService,
		private readonly protocols: ToolProtocolResources,
		private readonly browser: BrowserService,
	) {}

	activity(scope: ToolJobScope): () => void {
		return this.model.activity(scope);
	}

	resource(scope: ToolJobScope): ToolResourceSnapshot | null {
		const value = this.model.resource(scope);
		if (value === null) {
			return null;
		}
		return {
			id: value.id,
			runId: value.runId,
			phase: value.phase,
			createdAt: value.createdAt,
			lastUsedAt: value.lastUsedAt,
			connections: value.connections,
			files: value.files,
			operations: value.operations,
			targets: value.targets.map((id) => id),
			protocolSessions: this.protocols.count(scope),
			browserSessions: this.browser.sessionCount(scope),
		};
	}

	waitingOutputCount(scope: ToolJobScope): number {
		return this.jobs.waitingOutputCount(scope);
	}

	backgroundCount(scope: ToolJobScope): number {
		return this.jobs.backgroundCount(scope);
	}

	scopes(userId: number, appId: string): ToolJobScope[] {
		return this.model.scopes(userId, appId);
	}

	quiesceRun(scope: ToolJobScope): void {
		this.model.quiesceRun(scope);
	}

	async drainRun(scope: ToolJobScope): Promise<void> {
		const results = await Promise.allSettled([
			Promise.resolve().then(() => this.protocols.drainRun(scope)),
			Promise.resolve().then(() => this.jobs.drain(scope)),
			Promise.resolve().then(() => this.browser.drainRun(scope)),
		]);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		try {
			await this.model.drainRun(scope.runId);
		} catch (error) {
			failures.push(error);
		}
		this.model.settleDrain(scope, failures.some(isAgentDrainFailure));
		if (failures.length) {
			throw aggregateToolFailures(failures, 'Tool resources failed to drain');
		}
	}
}
