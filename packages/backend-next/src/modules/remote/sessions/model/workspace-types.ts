import type { SuspendedSessionStatus, SuspendedOwnershipState } from '@nexus-terminal/shared/remote/suspend/values';
import type { WorkspaceFileAttachment } from '../../files/model/file-types.js';

/** Instance-bound command scope, with no SSH transport or protocol channel. */
export interface WorkspaceMachineTaskScope {
	targetId: number;
	fingerprint: string;
	signal: AbortSignal;
	validate(): Promise<void>;
}

/** Application-owned identities and leases; never pass a WS channel into this model. */
export type WorkspacePhase =
	'opening' | 'attached' | 'detached' | 'resuming' | 'suspended' | 'suspend_resuming' | 'closing' | 'cleanup_unknown';

/** Management projection; never exposes a token, log path, SSH handle or fingerprint. */
export interface SuspendedWorkspaceView {
	id: string;
	originalWorkspaceId: string;
	connectionId: number;
	connectionName: string;
	suspendedAt: string;
	customName?: string;
	status: SuspendedSessionStatus;
	ownershipState: SuspendedOwnershipState;
	ownershipGeneration: number;
	ownershipLeaseExpiresAt?: number;
	attachedWorkspaceId?: string;
	disconnectedAt?: string;
}

export interface WorkspaceSnapshot {
	readonly workspaceId: string;
	readonly connectionId: number;
	readonly connectionName: string;
	readonly resumeToken: string;
	readonly attachmentGeneration: number;
	readonly terminalOffset: number;
	readonly lastConnectedAt: number;
}

export interface WorkspaceOutput {
	readonly bytes: Uint8Array;
	readonly stderr: boolean;
	readonly offset: number;
}

export interface WorkspaceLease extends WorkspaceSnapshot {
	/** Files/SFTP is independent: shell usability does not depend on its readiness. */
	readonly file: WorkspaceFileAttachment | null;
	readonly attachmentId: string;
}

export type WorkspaceFileState =
	| { kind: 'opening' }
	| { kind: 'ready'; file: WorkspaceFileAttachment }
	| { kind: 'failed'; reason: 'remote_unavailable' | 'operation_unknown' };

export interface WorkspaceReplay {
	readonly lease: WorkspaceLease;
	readonly replay: Uint8Array;
	readonly replayedBytes: number;
}

export class WorkspaceFailure extends Error {
	constructor(
		readonly code:
			| 'invalid_input'
			| 'unauthenticated'
			| 'forbidden'
			| 'not_found'
			| 'conflict'
			| 'limit_exceeded'
			| 'operation_unknown'
			| 'remote_unavailable',
		options?: ErrorOptions,
	) {
		super('Workspace ' + code, options);
		this.name = 'WorkspaceFailure';
	}
}

export type WorkspaceDirectoryEvent =
	| { type: 'queued'; requestId: string; path: string; waitingForPrompt: boolean }
	| { type: 'changed'; requestId: string; path: string }
	| { type: 'failed'; requestId: string; message: string };

export interface PreparedSuspendedWorkspace {
	readonly lease: WorkspaceLease;
	readonly resumedFrom: string;
	readonly history: Uint8Array;
	readonly historyAvailable: boolean;
	readonly ownershipGeneration: number;
	readonly ownershipLeaseExpiresAt: number;
}

export interface WorkspaceViewport {
	readonly columns: number;
	readonly rows: number;
}

export interface WorkspaceCheckpoint {
	write(data: Uint8Array | string): Promise<void>;
	resize(viewport: WorkspaceViewport): Promise<void>;
	reset(data: string, viewport: WorkspaceViewport): Promise<void>;
	snapshot(): Promise<{ data: string; columns: number; rows: number }>;
	dispose(): Promise<void>;
}

export interface WorkspaceLogSource {
	readonly bytes: AsyncIterable<Uint8Array>;
	release(): Promise<void>;
}

export interface WorkspaceLogDelivery {
	deliver(filename: string, bytes: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<void>;
}

export interface WorkspaceHistoryPage {
	readonly data: Uint8Array;
	readonly startOffset: number;
	readonly endOffset: number;
	readonly totalBytes: number;
	readonly oldestOffset: number;
}
