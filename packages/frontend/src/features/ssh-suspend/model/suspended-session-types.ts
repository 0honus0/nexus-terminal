import type { SuspendedTerminationReason } from '@nexus-terminal/shared/remote/suspend/values';
import type {
	SuspendedSessionStatus,
	SuspendedOwnershipState,
	SuspendedHttpErrorCode,
} from '@nexus-terminal/shared/remote/suspend/values';
import type { RequestOutcome, HttpRequestFailureCode } from '@/client/http/request-failure';
import type { ComputedRef, Ref } from 'vue';

/** Catalog timestamps retain their canonical ISO representation; leases are Unix milliseconds. */
export interface SuspendedSession {
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

export interface MarkedSuspendedSessionState {
	workspaceId: string;
	connectionId: number;
	connectionName: string;
	markedAt: string;
}

export class SuspendedRequestFailure extends Error {
	constructor(
		readonly code: SuspendedHttpErrorCode | HttpRequestFailureCode,
		readonly outcome: RequestOutcome,
		readonly status?: number,
		options?: ErrorOptions,
	) {
		super('Suspended session request failed', options);
		this.name = 'SuspendedRequestFailure';
	}
}

export interface SuspendedSessionsLoadOptions {
	silent?: boolean;
	force?: boolean;
}

export interface SuspendedSessionsLoadResult {
	ok: boolean;
	status?: number;
}

export interface SuspendedSessionsController {
	sessions: Ref<SuspendedSession[]>;
	search: Ref<string>;
	loading: Ref<boolean>;
	error: Ref<string | null>;
	filtered: ComputedRef<SuspendedSession[]>;
	load(options?: SuspendedSessionsLoadOptions): Promise<SuspendedSessionsLoadResult>;
	recover(): Promise<SuspendedSessionsLoadResult>;
	startPolling(): void;
	stopPolling(): void;
	rename(session: SuspendedSession, name: string, signal?: AbortSignal): Promise<string>;
	remove(session: SuspendedSession, signal?: AbortSignal): Promise<void>;
	exportLog(id: string, signal?: AbortSignal): Promise<string>;
}

export interface SuspendedMarkResult {
	suspendedSessionId: string;
}

export interface SuspendedAutoTermination {
	suspendedSessionId: string;
	reason: SuspendedTerminationReason;
}

export interface SuspendedAutoTerminationViewModel extends SuspendedAutoTermination {
	name?: string;
}
