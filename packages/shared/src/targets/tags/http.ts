export interface TargetTagCreateRequest {
	name: string;
}

export interface TargetTagRenameRequest {
	version: number;
	name: string;
}

export interface TargetTagDeleteResponse {
	deleted: true;
}
