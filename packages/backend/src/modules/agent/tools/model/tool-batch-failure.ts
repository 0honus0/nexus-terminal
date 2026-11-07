import { ToolExecutionUnknown, ToolCleanupFailure } from '../../agent-failure.js';

/** Captured batch progress is retained with the original unknown operation, never replayed. */
export class ToolBatchExecutionUnknown extends ToolExecutionUnknown {
	constructor(
		readonly resultText: string,
		cause: unknown,
		readonly outputArtifactIds: string[] = [],
	) {
		super({ cause });
	}
}

/** Confirmed progress remains attributable while the original cleanup fence stays occupied. */
export class ToolBatchCleanupFailure extends ToolCleanupFailure {
	constructor(
		readonly resultText: string,
		cause: unknown,
		readonly outputArtifactIds: string[] = [],
	) {
		super({ cause });
	}
}
