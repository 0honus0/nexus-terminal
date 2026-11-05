import { ToolExecutionUnknown } from '../../agent-failure.js';

/** Captured batch progress is retained with the original unknown operation, never replayed. */
export class ToolBatchExecutionUnknown extends ToolExecutionUnknown {
	constructor(
		readonly resultText: string,
		cause: unknown,
	) {
		super({ cause });
	}
}
