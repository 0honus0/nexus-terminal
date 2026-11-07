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

export type ProjectInput = { action: 'read' } | { action: 'write'; directory: string | null };
