import type { Scope } from '../agent.types';

export interface ProjectInstructionSnapshot {
  path: string;
  scopePath: string;
  projectRoot: string;
  hash: string;
  content: string;
  sourceBytes: number;
  contentBytes: number;
  truncated: boolean;
  provenance: 'workspace';
}

export interface ProjectInstructionOmission {
  path: string;
  reason: 'source_too_large' | 'invalid_utf8' | 'total_budget' | 'too_many_files';
}

export interface ProjectInstructionProjection {
  workspaceId: string;
  generation: number;
  targetDirectories: string[];
  instructions: ProjectInstructionSnapshot[];
  omitted: ProjectInstructionOmission[];
}

export interface ProjectInstructionSourcePort {
  load(
    scope: Scope,
    runId: string,
    runtimeId: string,
    targetDirectories: readonly string[],
    signal?: AbortSignal,
  ): Promise<ProjectInstructionProjection | null>;
}
