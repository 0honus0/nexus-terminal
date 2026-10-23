import type { RemoteTool, ToolErrorCode } from './values.js';
import type { ServerTransferMethod } from '../transfers/server-values.js';

export type RemoteToolCheckRequest =
	| { kind: 'tools'; targetId: number; tools: RemoteTool[] }
	| {
			kind: 'transfer';
			targetId: number;
			peerId: number;
			side: 'source' | 'target';
			method: ServerTransferMethod;
	  };

export interface RemoteToolInstallRequest {
	planId: string;
	password?: string;
}

export interface RemoteToolInstallResponse {
	targetId: number;
	ready: true;
}

export interface RemoteToolErrorResponse {
	code: ToolErrorCode;
}
