import type { Scope } from '../agent.types';

export interface MemoryProvenancePort {
  assertRuntime(scope: Scope, runId: string, runtimeId: string): Promise<void>;
}
