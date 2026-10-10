import type { TargetConnectionView } from './model.js';
import type { TargetErrorCode } from '../values.js';

export type TargetConnectionInput = Omit<TargetConnectionView, 'id' | 'version' | 'createdAt' | 'updatedAt'>;

export type TargetConnectionChanges = Partial<TargetConnectionInput>;

export type TargetCredentialInput = { kind: 'password'; password: string } | { kind: 'ssh_key'; sshKeyId: number };

export interface TargetImportInput {
	connection: TargetConnectionInput;
	inlineProxy?: {
		name: string;
		type: import('../proxies/values.js').ProxyType;
		host: string;
		port: number;
		username: string | null;
	};
	tagNames?: string[];
}

export type TargetCredentialMutation = { status: 'updated' } | { status: 'not_found' } | { status: 'version_conflict' };

export type TargetImportItem = { status: 'ok'; id: number } | { status: 'error'; code: TargetErrorCode };

export interface TargetConnectionUpdateRequest {
	version: number;
	changes: TargetConnectionChanges;
}

export interface TargetConnectionTagsRequest {
	version: number;
	tagIds: number[];
}

export interface TargetCredentialSetRequest {
	version: number;
	credential: TargetCredentialInput;
}

export interface TargetCredentialClearRequest {
	version: number;
}

export interface TargetConnectionCloneRequest {
	name: string;
}

/** A batch is also bounded by the complete connections HTTP body budget. */
export const TARGET_CONNECTION_IMPORT_MAX_ITEMS = 50;

export interface TargetConnectionImportRequest {
	items: TargetImportInput[];
}

export interface TargetConnectionImportResponse {
	items: TargetImportItem[];
}
