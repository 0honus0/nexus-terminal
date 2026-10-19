import type { RemoteFileKind } from '@nexus-terminal/shared/remote/files/values';

export interface ProjectScope {
	userId: number;
	appId: string;
	runId: string;
	connectionId: number;
}

export interface ProjectBinding {
	directory: string;
	targetVersion: number;
	fingerprint: string;
}

export interface ProjectMutation {
	scope: ProjectScope;
	operationId: string;
	operationHash: string;
	policyRevision: number;
	binding: ProjectBinding | null;
}

export type ProjectInput =
	{ action: 'bind'; directory: string } | { action: 'read'; path: string | null } | { action: 'clear' };

export interface ProjectGuidance {
	path: string;
	scopePath: string;
	text: string;
	sha256: string;
}

export interface ProjectDirectoryEntry {
	name: string;
	kind: RemoteFileKind;
	size: number;
}

export interface ProjectInstruction {
	path: string;
	text: string;
	bytes: number;
	sha256: string;
}
