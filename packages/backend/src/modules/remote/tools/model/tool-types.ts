import type {
	RemoteTool,
	ToolPackageManager,
	ToolPrivilege,
	ToolErrorCode,
} from '@nexus-terminal/shared/remote/tools/values';
import { MachineMutationRejection } from '../../machines/model/mutation-types.js';
import type { ServerTransferMethod } from '@nexus-terminal/shared/remote/transfers/server-values';

export class RemoteToolFailure extends MachineMutationRejection {
	constructor(
		readonly code: ToolErrorCode,
		options?: ErrorOptions,
	) {
		super(
			'Remote tool operation: ' + code,
			code === 'operation_unknown' ? 'unknown' : code === 'installation_failed' ? 'failed' : 'not_started',
			options,
		);
	}
}

export type ToolCheckIntent =
	| { kind: 'tools'; targetId: number; tools: RemoteTool[] }
	| {
			kind: 'transfer';
			targetId: number;
			peerId: number;
			side: 'source' | 'target';
			method: ServerTransferMethod;
	  };

export interface ToolTransferCredential {
	kind: 'password' | 'private_key';
	hasPassphrase: boolean;
}

export interface ToolInspectionInput {
	targetId: number;
	tools: RemoteTool[];
}

export interface ToolInspection {
	targetId: number;
	fingerprint: string;
	tools: RemoteTool[];
	missing: RemoteTool[];
	manager: ToolPackageManager | null;
	privilege: ToolPrivilege;
}

export interface ToolCheckResult {
	inspection: ToolInspection;
	planId: string | null;
	expiresAt: number | null;
}

export interface ToolInstallScope {
	signal: AbortSignal;
	remaining(): number;
	validate(): Promise<void>;
}
