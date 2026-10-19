export interface StoredProjectScope {
	userId: number;
	appId: string;
	runId: string;
	connectionId: number;
}

export interface StoredProjectBinding {
	directory: string;
	targetVersion: number;
	fingerprint: string;
}

export interface StoredProjectMutation {
	scope: StoredProjectScope;
	operationId: string;
	operationHash: string;
	policyRevision: number;
	binding: StoredProjectBinding | null;
}

export interface ToolProjectStorage {
	get(scope: StoredProjectScope): Promise<StoredProjectBinding | null>;
	change(command: StoredProjectMutation): Promise<boolean>;
}
