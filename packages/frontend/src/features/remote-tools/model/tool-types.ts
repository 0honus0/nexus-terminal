import type {
	RemoteTool,
	ToolPackageManager,
	ToolPrivilege,
	ToolErrorCode,
} from '@nexus-terminal/shared/remote/tools/values';
import type { ServerTransferMethod } from '@nexus-terminal/shared/remote/transfers/server-values';

export type ToolRequirement =
	| { kind: 'tools'; targetId: number; tools: RemoteTool[] }
	| {
			kind: 'transfer';
			targetId: number;
			peerId: number;
			side: 'source' | 'target';
			method: ServerTransferMethod;
	  };

export interface ToolOffer {
	targetId: number;
	tools: RemoteTool[];
	missing: RemoteTool[];
	manager: ToolPackageManager | null;
	privilege: ToolPrivilege;
	planId: string | null;
	expiresAt: number | null;
}

export class ToolInstallFailure extends Error {
	constructor(
		readonly code: ToolErrorCode | 'protocol_failure',
		options?: ErrorOptions,
	) {
		super('Remote tool operation: ' + code, options);
	}
}
