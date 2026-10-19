export interface TargetTagCreateRequest {
	name: string;
}

export interface TargetTagRenameRequest {
	version: number;
	name: string;
}

export interface TargetTagConnectionsRequest {
	connectionIds: number[];
}

export interface TargetTagConnectionsResponse {
	updated: true;
}
