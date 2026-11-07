import type { ToolRuntimeResources } from '../model/tool-runtime-types.js';
import type { ToolJobScope } from '../model/tool-job-types.js';
import type { ToolResourceSnapshot } from '../model/tool-resource-types.js';

/** Shared close ownership for final, idle and explicit shutdown. Successful idle closure may reopen later. */
export class RunToolResources {
	private readonly drains = new Map<string, Promise<void>>();

	constructor(private readonly resources: ToolRuntimeResources) {}

	activity(scope: ToolJobScope): () => void {
		return this.resources.activity(scope);
	}

	resource(scope: ToolJobScope): ToolResourceSnapshot | null {
		return this.resources.resource(scope);
	}

	waitingOutputCount(scope: ToolJobScope): number {
		return this.resources.waitingOutputCount(scope);
	}

	backgroundCount(scope: ToolJobScope): number {
		return this.resources.backgroundCount(scope);
	}

	scopes(userId: number, appId: string): ToolJobScope[] {
		return this.resources.scopes(userId, appId);
	}

	closeResource(scope: ToolJobScope, id: string): Promise<void> {
		return this.resource(scope)?.id === id ? this.drainRun(scope) : Promise.resolve();
	}

	drainRun(scope: ToolJobScope): Promise<void> {
		const current = this.drains.get(scope.runId);
		if (current) {
			return current;
		}
		const task = Promise.resolve().then(() => this.resources.drainRun(scope));
		this.drains.set(scope.runId, task);
		this.resources.quiesceRun(scope);
		void task.then(
			() => {
				if (this.drains.get(scope.runId) === task) {
					this.drains.delete(scope.runId);
				}
			},
			() => {},
		);
		return task;
	}
}
