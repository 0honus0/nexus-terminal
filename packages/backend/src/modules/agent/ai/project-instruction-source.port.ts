import type { Scope } from '../agent.types';
import type { ToolContext } from '../capabilities/tool.types';

export interface ProjectInstructionSnapshot {
	path: string;
	scopePath: string;
	projectRoot: string;
	hash: string;
	content: string;
	sourceBytes: number;
	contentBytes: number;
	truncated: boolean;
	provenance: 'ssh';
	connectionId?: number;
}

export interface ProjectInstructionOmission {
	path: string;
	reason: 'source_too_large' | 'invalid_utf8' | 'total_budget' | 'too_many_files';
}

export interface ProjectInstructionProjection {
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
		context?: ToolContext,
	): Promise<ProjectInstructionProjection | null>;
}
