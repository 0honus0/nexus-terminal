import type { Scope } from '../../agent.types';

export interface SubagentExecutionHost {
  enqueueRootRun(runId: string, scope: Scope): Promise<void>;
  wakeChildScheduler(): void;
  cancelChildRuntime(runId: string, runtimeId: string): void;
}
