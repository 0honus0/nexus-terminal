import type { ToolJobScope } from './tool-job-types.js';
import type { ToolResourceSnapshot } from './tool-resource-types.js';

/** Protocol algorithms stay in plugins; the resource aggregate needs only close and accounting. */
export interface ToolProtocolResources {
	count(scope: ToolJobScope): number;
	drainRun(scope: ToolJobScope): Promise<void>;
}

/** Run-owned resource accounting is installed by the selected tool composition. */
export interface ToolRuntimeResources {
	activity(scope: ToolJobScope): () => void;
	resource(scope: ToolJobScope): ToolResourceSnapshot | null;
	waitingOutputCount(scope: ToolJobScope): number;
	backgroundCount(scope: ToolJobScope): number;
	scopes(userId: number, appId: string): ToolJobScope[];
	quiesceRun(scope: ToolJobScope): void;
	drainRun(scope: ToolJobScope): Promise<void>;
}
